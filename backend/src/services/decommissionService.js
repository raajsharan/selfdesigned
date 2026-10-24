const db = require('../config/db');
const { unionSql } = require('../utils/inventoryUnion');
const { notFound, conflict, bad } = require('../utils/httpError');
const { roleKeys, promote } = require('./pageService');
const teams = require('./teamsNotificationService');

const displayName = (r) => r.vm_name || r.hostname || r.ip_address || `#${r.id}`;

/** Frees the asset tag and IP for reuse and writes the permanent log row, atomically. */
async function decommission(page, recordId, reason, user) {
  const rk = roleKeys(page);
  const rec = await db.withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM inventory_records WHERE id = $1 AND page_id = $2 AND is_deleted = FALSE AND is_decommissioned = FALSE FOR UPDATE', [recordId, page.id]);
    if (!rows[0]) throw notFound('Active record not found');
    const r = rows[0];
    const snapshot = { page: page.slug, ...r.data, _secret_fields: Object.keys(r.secrets || {}) };   // ciphertext is never copied into the log
    await c.query(
      `INSERT INTO decommission_log (source, asset_id, asset_name, asset_snapshot, asset_tag, ip_address, reason, decommissioned_by_id, decommissioned_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [page.slug, r.id, displayName(r), JSON.stringify(snapshot), r.asset_tag, r.ip_address, reason || null, user.id, user.email]);
    const data = { ...r.data };
    if (rk.asset_tag) delete data[rk.asset_tag];
    if (rk.ip) delete data[rk.ip];
    const cols = promote(page, data);
    await c.query('UPDATE inventory_records SET data = $2, asset_tag = $3, ip_address = $4, is_decommissioned = TRUE, decommissioned_at = now(), updated_by = $5, updated_at = now() WHERE id = $1',
      [r.id, JSON.stringify(data), cols.asset_tag, cols.ip_address, user.id]);
    return r;
  });
  teams.notify('asset_decommissioned', { title: `Record decommissioned: ${displayName(rec)}`, status: 'attention',
    facts: [['Page', page.title], ['Released tag', rec.asset_tag], ['Released IP', rec.ip_address], ['Reason', reason], ['By', user.email]] });
  return rec;
}

/** Reclaims the tag/IP if still free; otherwise refuses so nothing is silently duplicated. */
async function reactivate(logId, user) {
  const out = await db.withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM decommission_log WHERE id = $1 FOR UPDATE', [logId]);
    const log = rows[0];
    if (!log) throw notFound('Log entry not found');
    if (log.reactivated_at) throw conflict('Already reactivated');
    const pr = await c.query('SELECT * FROM inventory_pages WHERE slug = $1', [log.source]);
    if (!pr.rows[0]) throw bad('The page this record belonged to has been deleted, so it cannot be reactivated');
    const page = pr.rows[0];
    const rr = await c.query('SELECT * FROM inventory_records WHERE id = $1 AND page_id = $2 AND is_decommissioned = TRUE FOR UPDATE', [log.asset_id, page.id]);
    if (!rr.rows[0]) throw bad('The original record no longer exists (it was purged), so it cannot be reactivated');

    for (const [col, val, label] of [['asset_tag', log.asset_tag, 'asset tag'], ['ip_address', log.ip_address, 'IP address']]) {
      if (!val) continue;
      const clash = await c.query(
        `SELECT source FROM (${unionSql(col + ', is_deleted, is_decommissioned', 'TRUE')}) t WHERE ${col} = $1 AND is_deleted = FALSE AND is_decommissioned = FALSE LIMIT 1`, [val]);
      if (clash.rows[0]) throw conflict(`The ${label} ${val} is now in use by another record in "${clash.rows[0].source}"`);
    }
    const rk = roleKeys(page);
    const data = { ...rr.rows[0].data };
    if (rk.asset_tag && log.asset_tag) data[rk.asset_tag] = log.asset_tag;
    if (rk.ip && log.ip_address) data[rk.ip] = log.ip_address;
    const cols = promote(page, data);
    await c.query('UPDATE inventory_records SET data = $2, asset_tag = $3, ip_address = $4, is_decommissioned = FALSE, decommissioned_at = NULL, updated_by = $5, updated_at = now() WHERE id = $1',
      [rr.rows[0].id, JSON.stringify(data), cols.asset_tag, cols.ip_address, user.id]);
    await c.query('UPDATE decommission_log SET reactivated_by_id = $2, reactivated_by_email = $3, reactivated_at = now() WHERE id = $1', [logId, user.id, user.email]);
    return { log, page };
  });
  teams.notify('asset_reactivated', { title: `Record reactivated: ${out.log.asset_name}`, status: 'good',
    facts: [['Page', out.page.title], ['Restored tag', out.log.asset_tag], ['Restored IP', out.log.ip_address], ['By', user.email]] });
  return out.log;
}

async function listDecommissioned({ q, source, limit = 200, offset = 0 } = {}) {
  const params = []; let where = 'TRUE';
  if (source) { params.push(source); where += ` AND l.source = $${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (l.asset_name ILIKE $${params.length} OR l.asset_tag ILIKE $${params.length} OR l.ip_address ILIKE $${params.length} OR l.reason ILIKE $${params.length})`; }
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT l.id, l.source, l.asset_id, l.asset_name, l.asset_tag, l.ip_address, l.reason, l.decommissioned_by_email, l.decommissioned_at,
            l.reactivated_by_email, l.reactivated_at, p.title AS source_title
     FROM decommission_log l LEFT JOIN inventory_pages p ON p.slug = l.source WHERE ${where}
     ORDER BY l.decommissioned_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows;
}

module.exports = { decommission, reactivate, listDecommissioned };
