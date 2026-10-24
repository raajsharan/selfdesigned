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

async function profile(user) {
  const access = await resolveAccess(user);
  return {
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, can_view_passwords: user.can_view_passwords },
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

exports.changePassword = async (req, res) => {
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
