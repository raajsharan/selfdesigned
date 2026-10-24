const db = require('../config/db');
const { BUILTIN_ROLES } = require('../config/pages');
const { allPageKeys } = require('../services/pageService');
const { audit } = require('../services/auditService');
const { bad, notFound, conflict } = require('../utils/httpError');

const cleanPages = (arr, valid) => [...new Set((arr || []).filter((p) => valid.has(p)))];

exports.list = async (req, res) => {
  const { keys, dynamic } = await allPageKeys();
  const builtin = Object.entries(BUILTIN_ROLES)
    .filter(([name]) => name !== 'superadmin' || req.user.isSuper)
    .map(([name, r]) => ({ name, label: r.label, pages: [...r.pages, ...(r.dynamic ? dynamic.map((d) => d.key) : [])], can_write: r.write, builtin: true }));
  const { rows } = await db.query('SELECT id, name, description, pages, can_write FROM roles ORDER BY name');
  res.json({ roles: [...builtin, ...rows.map((r) => ({ ...r, label: r.name, builtin: false }))], pages: keys, dynamic_pages: dynamic });
};

exports.create = async (req, res) => {
  const { name, description, pages, can_write } = req.body;
  const valid = new Set((await allPageKeys()).keys);
  if (BUILTIN_ROLES[name]) throw conflict('That name is reserved for a built-in role');
  const { rows } = await db.query(
    'INSERT INTO roles (name, description, pages, can_write) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, description || null, JSON.stringify(cleanPages(pages, valid)), !!can_write]);
  audit(req, 'create', 'role', rows[0].id, { name });
  res.status(201).json(rows[0]);
};

exports.update = async (req, res) => {
  const valid = new Set((await allPageKeys()).keys);
  const { rows } = await db.query(
    'UPDATE roles SET description = $1, pages = $2, can_write = $3 WHERE id = $4 RETURNING *',
    [req.body.description || null, JSON.stringify(cleanPages(req.body.pages, valid)), !!req.body.can_write, req.params.id]);
  if (!rows[0]) throw notFound('Role not found');
  audit(req, 'update', 'role', rows[0].id, { name: rows[0].name });
  res.json(rows[0]);
};

exports.remove = async (req, res) => {
  const { rows } = await db.query('SELECT name FROM roles WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Role not found');
  const used = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE role = $1', [rows[0].name]);
  if (used.rows[0].n) throw bad(`${used.rows[0].n} user(s) still have this role`);
  await db.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
  audit(req, 'delete', 'role', req.params.id, { name: rows[0].name });
  res.json({ ok: true });
};
