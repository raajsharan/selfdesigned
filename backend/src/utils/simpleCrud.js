const db = require('../config/db');
const { audit } = require('../services/auditService');
const { notFound } = require('./httpError');

/**
 * Tiny CRUD controller for flat lookup tables.
 * cols: whitelist of writable columns. Identifiers come from this trusted list, values via $n params.
 */
module.exports = function simpleCrud({ table, entity, cols, orderBy = 'id', label = (r) => r.id }) {
  const pick = (body) => cols.filter((c) => body[c] !== undefined).map((c) => [c, body[c] === '' ? null : body[c]]);
  return {
    list: async (req, res) => res.json((await db.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`)).rows),
    create: async (req, res) => {
      const f = pick(req.body);
      const { rows } = await db.query(
        `INSERT INTO ${table} (${f.map(([c]) => c).join(',')}) VALUES (${f.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, f.map(([, v]) => v));
      audit(req, 'create', entity, rows[0].id, { name: label(rows[0]) });
      res.status(201).json(rows[0]);
    },
    update: async (req, res) => {
      const f = pick(req.body);
      if (!f.length) return res.json({ ok: true });
      const { rows } = await db.query(
        `UPDATE ${table} SET ${f.map(([c], i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${f.length + 1} RETURNING *`, [...f.map(([, v]) => v), req.params.id]);
      if (!rows[0]) throw notFound();
      audit(req, 'update', entity, rows[0].id, { name: label(rows[0]) });
      res.json(rows[0]);
    },
    remove: async (req, res) => {
      const { rows } = await db.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [req.params.id]);
      if (!rows[0]) throw notFound();
      audit(req, 'delete', entity, rows[0].id, { name: label(rows[0]) });
      res.json({ ok: true });
    },
  };
};
