const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { BUILTIN_ROLES, EDITABLE_BUILTIN, PAGES, pageKey } = require('../config/pages');
const asyncHandler = require('../utils/asyncHandler');

/** Work out which pages a user may open and whether they may write. */
async function resolveAccess(user) {
  let pages; let write;
  const dyn = (await db.query('SELECT slug FROM inventory_pages')).rows.map((r) => pageKey(r.slug));   // every designed page
  const valid = new Set([...PAGES, ...dyn]);
  if (BUILTIN_ROLES[user.role]) {
    pages = new Set([...BUILTIN_ROLES[user.role].pages, ...(BUILTIN_ROLES[user.role].dynamic ? dyn : [])]);
    write = BUILTIN_ROLES[user.role].write;
    if (EDITABLE_BUILTIN.has(user.role)) {   // an administrator customised this built-in role
      const { rows } = await db.query('SELECT pages, can_write FROM builtin_role_overrides WHERE name = $1', [user.role]);
      if (rows[0]) { pages = new Set(rows[0].pages.filter((p) => valid.has(p))); write = rows[0].can_write; }
    }
  } else {
    const { rows } = await db.query('SELECT pages, can_write FROM roles WHERE name = $1', [user.role]);
    pages = new Set((rows[0] ? rows[0].pages : []).filter((p) => valid.has(p)));
    write = rows[0] ? rows[0].can_write : false;
  }
  for (const [page, allowed] of Object.entries(user.page_overrides || {})) {
    if (!valid.has(page)) continue;
    if (allowed) pages.add(page); else pages.delete(page);
  }
  if (user.role === 'superadmin') valid.forEach((p) => pages.add(p));
  return { pages, write };
}

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }

  // Always re-read the user so deactivation / role / flag changes apply immediately.
  const { rows } = await db.query(
    'SELECT id, email, full_name, role, is_active, can_view_passwords, page_overrides FROM users WHERE id = $1', [payload.sub]);
  const u = rows[0];
  if (!u || !u.is_active) return res.status(401).json({ error: 'Account unavailable' });
  const access = await resolveAccess(u);
  req.user = { ...u, pages: access.pages, canWrite: access.write, isSuper: u.role === 'superadmin' };
  next();
});

/** Restrict to specific roles. */
const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient role' });

/** Page-level access. Anything other than GET/HEAD additionally needs write permission. */
const requirePageAccess = (pageKey) => (req, res, next) => {
  if (!req.user.pages.has(pageKey)) return res.status(403).json({ error: 'You do not have access to this page' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.user.canWrite) {
    return res.status(403).json({ error: 'Read-only access' });
  }
  next();
};

/** Re-checks the flag in the DB on every call (not trusting anything cached). */
const requirePasswordAccess = asyncHandler(async (req, res, next) => {
  const { rows } = await db.query('SELECT can_view_passwords, role FROM users WHERE id = $1 AND is_active', [req.user.id]);
  // The superadmin may always reveal passwords.
  if (!rows[0] || !(rows[0].can_view_passwords || rows[0].role === 'superadmin')) return res.status(403).json({ error: 'You are not allowed to view passwords' });
  next();
});

const signToken = (user) =>
  jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

module.exports = { authenticate, authorize, requirePageAccess, requirePasswordAccess, signToken, resolveAccess };
