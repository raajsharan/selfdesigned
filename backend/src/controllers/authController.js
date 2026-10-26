const bcrypt = require('bcrypt');
const db = require('../config/db');
const { signToken, resolveAccess } = require('../middleware/auth');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');

const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_RULE = 'Password must be at least 8 characters and include upper-case, lower-case and a number';
// Compared against when the email is unknown so response time doesn't reveal which accounts exist.
// Generated at startup so it is always a valid hash with the same cost factor as real ones.
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 12);

const NOTIFY_KEYS = ['email_alerts', 'weekly_report', 'security_alerts', 'product_updates'];
const INFO_KEYS = ['job_title', 'phone', 'location', 'bio'];
const INFO_MAX = { job_title: 128, phone: 32, location: 128, bio: 500 };
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const PHOTO_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_MAX = 600000;   // characters of base64 (~450 KB); the browser shrinks photos far below this

async function profile(user) {
  const access = await resolveAccess(user);
  const { rows } = await db.query('SELECT username, company, photo_data_url, profile, created_at, last_login_at FROM users WHERE id = $1', [user.id]);
  const x = rows[0] || {}; const p = x.profile || {};
  return {
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, can_view_passwords: user.can_view_passwords,
      username: x.username || null, company: x.company || null, photo: x.photo_data_url || null, created_at: x.created_at, last_login_at: x.last_login_at,
      info: Object.fromEntries(INFO_KEYS.map((k) => [k, p.info?.[k] || ''])),
      notifications: Object.fromEntries(NOTIFY_KEYS.map((k) => [k, p.notifications?.[k] ?? k !== 'product_updates'])) },
    pages: [...access.pages], can_write: access.write,
  };
}

exports.login = async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(req.body.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) {
    audit(null, 'login_failed', 'user', null, { email });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  audit({ user, ip: req.ip }, 'login', 'user', user.id);
  res.json({ token: signToken(user), ...(await profile(user)) });
};

exports.me = async (req, res) => res.json(await profile(req.user));

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Self-service profile update. Only the sections present in the body are changed. */
exports.updateProfile = async (req, res) => {
  const b = req.body; const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (b.full_name !== undefined) add('full_name', text(b.full_name, 255) || null);
  if (b.company !== undefined) add('company', text(b.company, 255) || null);
  if (b.email !== undefined) {
    const email = text(b.email, 255).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address');
    add('email', email);
  }
  if (b.username !== undefined) {
    const u = text(b.username, 64);
    if (u && !USERNAME_RE.test(u)) throw bad('User name must be 3-32 letters, digits, dots, dashes or underscores');
    add('username', u || null);
  }
  if (b.photo !== undefined) {
    if (b.photo && (!PHOTO_RE.test(b.photo) || b.photo.length > PHOTO_MAX)) throw bad('Photo must be a PNG, JPEG, WebP or GIF image under 450 KB');
    add('photo_data_url', b.photo || null);
  }
  const patch = {};   // whole sections of users.profile, merged at the top level in one assignment
  const section = (name, keys, clean) => {
    if (!b[name] || typeof b[name] !== 'object') return;
    patch[name] = Object.fromEntries(keys.map((k) => [k, clean(k, b[name][k])]));
  };
  section('info', INFO_KEYS, (k, v) => text(v, INFO_MAX[k]));
  section('notifications', NOTIFY_KEYS, (k, v) => v === true);
  if (Object.keys(patch).length) { vals.push(JSON.stringify(patch)); sets.push(`profile = profile || $${vals.length}::jsonb`); }
  if (!sets.length) throw bad('Nothing to update');
  vals.push(req.user.id);
  try { await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals); }
  catch (e) {
    if (e.code === '23505') throw bad(/username/.test(e.constraint || '') ? 'That user name is already taken' : 'That email address is already in use');
    throw e;
  }
  audit(req, 'update_profile', 'user', req.user.id, { fields: Object.keys(b).filter((k) => k !== 'photo') });
  res.json(await profile(req.user));
};

exports.changePassword =async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!STRONG.test(new_password)) throw bad(PASSWORD_RULE);
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current_password, rows[0].password_hash))) throw bad('Current password is incorrect');
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(new_password, 12), req.user.id]);
  audit(req, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
};

exports.PASSWORD_RULE = PASSWORD_RULE;
exports.STRONG = STRONG;
