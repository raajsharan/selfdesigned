// Field Library: reusable field definitions for the Page Designer. Using one on a page copies it, so later edits here never change a page.
const db = require('../config/db');
const svc = require('../services/pageService');
const { audit } = require('../services/auditService');
const { bad, notFound, conflict } = require('../utils/httpError');

const meta = () => ({ roles: Object.entries(svc.ROLE_LABELS).map(([key, label]) => ({ key, label })), types: svc.FIELD_TYPES });
const shape = (r) => ({ id: r.id, key: r.key, ...r.def });

/** Validate one definition with the same rules the Page Designer applies. Conditions and dependencies belong to a page, so they are dropped. */
function clean(body) {
  const { showIf, dependsOn, ...rest } = body || {};   // eslint-disable-line no-unused-vars
  if (!String(rest.label || '').trim()) throw bad('A label is required');
  const [f] = svc.cleanFields([rest]);
  const { key, ...def } = f;
  return { key, def };
}

exports.list = async (req, res) => {
  const { rows } = await db.query('SELECT * FROM field_library ORDER BY sort_order, id');
  res.json({ fields: rows.map(shape), ...meta() });
};

exports.create = async (req, res) => {
  const { key, def } = clean(req.body);
  if ((await db.query('SELECT 1 FROM field_library WHERE key = $1', [key])).rowCount) throw conflict(`A library field with the key "${key}" already exists`);
  const { rows } = await db.query('INSERT INTO field_library (key, def, sort_order) VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM field_library)) RETURNING *', [key, JSON.stringify(def)]);
  audit(req, 'create', 'field_library', rows[0].id, { name: def.label });
  res.status(201).json(shape(rows[0]));
};

exports.update = async (req, res) => {
  const { key, def } = clean(req.body);
  const dup = await db.query('SELECT 1 FROM field_library WHERE key = $1 AND id <> $2', [key, req.params.id]);
  if (dup.rowCount) throw conflict(`A library field with the key "${key}" already exists`);
  const { rows } = await db.query('UPDATE field_library SET key = $1, def = $2, updated_at = now() WHERE id = $3 RETURNING *', [key, JSON.stringify(def), req.params.id]);
  if (!rows[0]) throw notFound('Field not found');
  audit(req, 'update', 'field_library', rows[0].id, { name: def.label });
  res.json(shape(rows[0]));
};

exports.remove = async (req, res) => {
  const { rows } = await db.query('DELETE FROM field_library WHERE id = $1 RETURNING def', [req.params.id]);
  if (!rows[0]) throw notFound('Field not found');
  audit(req, 'delete', 'field_library', req.params.id, { name: rows[0].def.label });
  res.json({ ok: true });
};
