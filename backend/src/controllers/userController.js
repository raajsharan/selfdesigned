const bcrypt = require('bcrypt');
const db = require('../config/db');
const { BUILTIN_ROLES } = require('../config/pages');
const { allPageKeys } = require('../services/pageService');
const { STRONG, PASSWORD_RULE } = require('./authController');
const { audit } = require('../services/auditService');
const { bad, notFound, forbidden } = require('../utils/httpError');

const PUBLIC = 'id, email, full_name, role, is_active, can_view_passwords, page_overrides, last_login_at, created_at';

async function assertRoleAssignable(req, role) {
  if (role === 'superadmin' && !req.user.isSuper) throw forbidden('Only a superadmin can assign the superadmin role');
  if (BUILTIN_ROLES[role]) return;
  const { rows } = await db.query('SELECT 1 FROM roles WHERE name = $1', [role]);
  if (!rows[0]) throw bad(`Unknown role "${role}"`);
}

exports.list = async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC} FROM users ${req.user.isSuper ? '' : "WHERE role <> 'superadmin'"} ORDER BY lower(email)`);
  res.json(rows);
};

exports.create = async (req, res) => {
  const { email, full_name, password, role = 'viewer' } = req.body;
  if (!STRONG.test(password)) throw bad(PASSWORD_RULE);
  await assertRoleAssignable(req, role);
  const { rows } = await db.query(
    `INSERT INTO users (email, full_name, password_hash, role, can_view_passwords) VALUES ($1,$2,$3,$4,$5) RETURNING ${PUBLIC}`,
    [email.trim().toLowerCase(), full_name || null, await bcrypt.hash(password, 12), role, !!req.body.can_view_passwords && role !== 'viewer']);
  audit(req, 'create', 'user', rows[0].id, { email: rows[0].email, role });
  res.status(201).json(rows[0]);
};

exports.update = async (req, res) => {
  const { rows: cur } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  // A non-superadmin must not even learn that the superadmin exists.
  if (!cur[0] || (cur[0].role === 'superadmin' && !req.user.isSuper)) throw notFound('User not found');
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (req.body.full_name !== undefined) add('full_name', req.body.full_name);
  if (req.body.role !== undefined) {
    await assertRoleAssignable(req, req.body.role);
    if (cur[0].id === req.user.id && req.body.role !== cur[0].role) throw bad('You cannot change your own role');
    add('role', req.body.role);
  }
  if (req.body.is_active !== undefined) {
    if (cur[0].id === req.user.id && !req.body.is_active) throw bad('You cannot deactivate your own account');
    if (cur[0].role === 'superadmin' && !req.body.is_active) throw bad('The superadmin cannot be deactivated');
    add('is_active', !!req.body.is_active);
  }
  if (req.body.password) {
    if (!STRONG.test(req.body.password)) throw bad(PASSWORD_RULE);
    add('password_hash', await bcrypt.hash(req.body.password, 12));
  }
  if (!sets.length) return res.json(cur[0]);
  vals.push(req.params.id);
  const { rows } = await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING ${PUBLIC}`, vals);
  audit(req, 'update', 'user', rows[0].id, { email: rows[0].email, fields: Object.keys(req.body).filter((k) => k !== 'password') });
  res.json(rows[0]);
};

exports.remove = async (req, res) => {
  const { rows } = await db.query('SELECT id, role, email FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0] || (rows[0].role === 'superadmin' && !req.user.isSuper)) throw notFound('User not found');
  if (rows[0].role === 'superadmin') throw forbidden('The superadmin cannot be deleted');
  if (rows[0].id === req.user.id) throw bad('You cannot delete your own account');
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  audit(req, 'delete', 'user', rows[0].id, { email: rows[0].email });
  res.json({ ok: true });
};

// ---- Per-user page control ----------------------------------------------------------
exports.pageControlList = async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, email, full_name, role, can_view_passwords, page_overrides FROM users
     ${req.user.isSuper ? '' : "WHERE role <> 'superadmin'"} ORDER BY lower(email)`);
  const { keys, dynamic } = await allPageKeys();
  res.json({ users: rows, pages: keys, dynamic_pages: dynamic });
};

exports.pageControlUpdate = async (req, res) => {
  const { rows: cur } = await db.query('SELECT id, role, email FROM users WHERE id = $1', [req.params.id]);
  if (!cur[0] || (cur[0].role === 'superadmin' && !req.user.isSuper)) throw notFound('User not found');
  const overrides = {}; const valid = new Set((await allPageKeys()).keys);
  for (const [k, v] of Object.entries(req.body.page_overrides || {})) if (valid.has(k) && typeof v === 'boolean') overrides[k] = v;
  await db.query('UPDATE users SET page_overrides = $1, can_view_passwords = $2, updated_at = now() WHERE id = $3',
    [JSON.stringify(overrides), !!req.body.can_view_passwords, req.params.id]);
  audit(req, 'update_page_control', 'user', cur[0].id, { email: cur[0].email, overrides, can_view_passwords: !!req.body.can_view_passwords });
  res.json({ ok: true });
};
