// Decommissioned page, recycle bin and cross-page search.
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { unionSql } = require('../utils/inventoryUnion');
const decommissionSvc = require('../services/decommissionService');
const { audit } = require('../services/auditService');
const { notFound, conflict, bad, forbidden } = require('../utils/httpError');

exports.decommissionedList = async (req, res) => {
  const rows = await decommissionSvc.listDecommissioned({ q: req.query.q, source: req.query.source });
  // A user only sees log rows for pages they can open (rows whose page was deleted stay visible to all with access to this screen).
  res.json(rows.filter((r) => !r.source_title || req.user.pages.has(pageKey(r.source))));
};

exports.reactivate = async (req, res) => {
  const { rows } = await db.query('SELECT l.source, (p.id IS NOT NULL) AS page_exists FROM decommission_log l LEFT JOIN inventory_pages p ON p.slug = l.source WHERE l.id = $1', [req.params.id]);
  // If the page was deleted there is nothing to guard: the service explains why it cannot be reactivated.
  if (rows[0] && rows[0].page_exists && !req.user.pages.has(pageKey(rows[0].source))) throw forbidden('You do not have access to that page');
  const log = await decommissionSvc.reactivate(req.params.id, req.user);
  audit(req, 'reactivate', `page:${log.source}`, log.asset_id, { name: log.asset_name });
  res.json({ ok: true });
};

exports.recycleList = async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, p.slug AS source, p.title AS page_title, r.vm_name, r.hostname, r.ip_address, r.mac_address, r.asset_tag, r.deleted_at, r.data
     FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id WHERE r.is_deleted = TRUE ORDER BY r.deleted_at DESC LIMIT 500`);
  res.json(rows.filter((r) => req.user.pages.has(pageKey(r.source))));
};

async function deletedRecord(req) {
  const { rows } = await db.query(
    'SELECT r.id, r.asset_tag, r.ip_address, p.slug FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id WHERE r.id = $1 AND r.is_deleted = TRUE', [req.params.id]);
  if (!rows[0] || !req.user.pages.has(pageKey(rows[0].slug))) throw notFound('Deleted record not found');
  return rows[0];
}

exports.recycleRestore = async (req, res) => {
  const r = await deletedRecord(req);
  // The tag/IP may have been reused while this record sat in the bin.
  for (const col of ['asset_tag', 'ip_address']) {
    if (!r[col]) continue;
    const hit = await db.query(`SELECT source FROM (${unionSql(`${col}, is_deleted, is_decommissioned`)}) t WHERE ${col} = $1 AND is_deleted = FALSE AND is_decommissioned = FALSE LIMIT 1`, [r[col]]);
    if (hit.rows[0]) throw conflict(`Cannot restore: ${col === 'asset_tag' ? 'asset tag' : 'IP address'} ${r[col]} is now used on "${hit.rows[0].source}"`);
  }
  await db.query('UPDATE inventory_records SET is_deleted = FALSE, deleted_at = NULL, deleted_by = NULL, updated_by = $2, updated_at = now() WHERE id = $1', [r.id, req.user.id]);
  audit(req, 'restore', `page:${r.slug}`, r.id);
  res.json({ ok: true });
};

exports.recyclePurge = async (req, res) => {
  const r = await deletedRecord(req);
  await db.query('DELETE FROM inventory_records WHERE id = $1 AND is_deleted = TRUE', [r.id]);
  audit(req, 'purge', `page:${r.slug}`, r.id);
  res.json({ ok: true });
};

exports.search = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw bad('Enter at least 2 characters');
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await db.query(
    `SELECT r.id, p.slug AS source, p.title AS source_label, r.vm_name, r.hostname, r.ip_address, r.mac_address, r.asset_tag, r.server_status, r.department, r.is_decommissioned, r.data
     FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id
     WHERE r.is_deleted = FALSE AND EXISTS (SELECT 1 FROM jsonb_each_text(r.data) e WHERE e.value ILIKE $1)
     ORDER BY p.sort_order, r.id LIMIT 300`, [like]);
  res.json(rows.filter((r) => req.user.pages.has(pageKey(r.source))));
};
