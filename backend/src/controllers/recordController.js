// Generic engine for every user-designed "records" page. Field definitions come from page.config.
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { encrypt, decrypt } = require('../utils/crypto');
const { bad, notFound, conflict } = require('../utils/httpError');
const { sendCsv } = require('../utils/csv');
const { audit } = require('../services/auditService');
const teams = require('../services/teamsNotificationService');
const decommissionSvc = require('../services/decommissionService');
const { validateTag, nextFreeTags } = require('../services/tagRangeService');
const { ROLE_COLUMNS, promote, roleKeys } = require('../services/pageService');
const { unionSql } = require('../utils/inventoryUnion');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fieldsOf = (page) => page.config.fields || [];
const display = (r) => r.vm_name || r.hostname || r.ip_address || `#${r.id}`;
const META_SORT = { _created_at: 'r.created_at', _updated_at: 'r.updated_at' };

function normalizeMac(v) {
  const hex = String(v).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!/^[0-9A-F]{12}$/.test(hex)) throw bad('MAC address is not valid (expected 6 pairs of hex digits)');
  return hex.match(/../g).join(':');
}

/** Is a conditionally-shown field currently visible for this data? */
function isVisible(f, data) {
  if (!f.showIf) return true;
  const v = data[f.showIf.key]; const want = f.showIf.value;
  if (want === true) return v === true;
  if (want === false) return !v;
  return String(v ?? '') === String(want);
}

function coerce(f, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  switch (f.type) {
    case 'number': { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${f.label} must be a number`); return n; }
    case 'boolean': return v === true || ['true', 'yes', '1', 'y'].includes(String(v).toLowerCase());
    case 'date': { const d = v instanceof Date ? v : new Date(v); if (Number.isNaN(d.getTime())) throw bad(`${f.label} is not a valid date`); return d.toISOString().slice(0, 10); }
    case 'ip': {
      const s = String(v).trim();
      if (!/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(s)) throw bad(`${f.label} must be an IP address like 192.168.1.1`);
      return s;
    }
    default: { const s = String(v).trim().slice(0, f.type === 'textarea' ? 5000 : 255); return f.role === 'mac' ? normalizeMac(s) : s; }
  }
}

const sanitize = (r, page) => ({
  id: r.id, page: page.slug, data: r.data, secret_keys: Object.keys(r.secrets || {}), is_decommissioned: r.is_decommissioned,
  decommissioned_at: r.decommissioned_at, created_at: r.created_at, updated_at: r.updated_at,
});

/** Turn a request body into validated {data, secrets} patches (only keys that were sent). */
function pick(page, input) {
  const data = {}; const secrets = {}; const clear = [];
  for (const f of fieldsOf(page)) {
    const raw = input?.[f.key];
    if (f.type === 'password') {
      if (typeof raw === 'string' && raw !== '') secrets[f.key] = encrypt(raw);
      else if (raw === null) clear.push(f.key);
      continue;
    }
    const v = coerce(f, raw);
    if (v !== undefined) data[f.key] = v;
  }
  return { data, secrets, clear };
}

/** Apply hidden-field cleanup and required checks to the final merged record. */
function finalize(page, data, secrets) {
  for (const f of fieldsOf(page)) {
    if (!isVisible(f, data)) { delete data[f.key]; delete secrets[f.key]; continue; }
    if (!f.required || f.type === 'boolean') continue;      // a required yes/no field makes no sense: it always has a value
    const empty = f.type === 'password' ? !secrets[f.key] : (data[f.key] === undefined || data[f.key] === null || data[f.key] === '');
    if (empty) throw bad(`${f.label} is required`);
  }
}

/** Asset tag and IP must be unique among active records of every page. */
async function assertGlobalUnique(client, id, cols) {
  for (const [col, label] of [['asset_tag', 'Asset tag'], ['ip_address', 'IP address']]) {
    if (!cols[col]) continue;
    const { rows } = await client.query(
      `SELECT r.id, p.title FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id
       WHERE r.${col} = $1 AND r.is_deleted = FALSE AND r.is_decommissioned = FALSE AND r.id IS DISTINCT FROM $2 LIMIT 1`, [cols[col], id]);
    if (rows[0]) throw conflict(`${label} ${cols[col]} is already used on "${rows[0].title}"`);
  }
}
/** Fields flagged "unique" must be unique within their own page. */
async function assertFieldUnique(client, page, id, data) {
  for (const f of fieldsOf(page).filter((x) => x.unique && x.type !== 'password')) {
    const v = data[f.key];
    if (v === undefined || v === null || v === '') continue;
    const { rows } = await client.query(
      `SELECT 1 FROM inventory_records WHERE page_id = $1 AND is_deleted = FALSE AND is_decommissioned = FALSE AND data->>$2 = $3 AND id IS DISTINCT FROM $4 LIMIT 1`,
      [page.id, f.key, String(v), id]);
    if (rows[0]) throw conflict(`${f.label} "${v}" is already used on this page`);
  }
}

async function insertRecord(client, page, input, user) {
  const { data, secrets } = pick(page, input);
  for (const k of Object.keys(data)) if (data[k] === null) delete data[k];
  finalize(page, data, secrets);
  const cols = promote(page, data);
  await validateTag(cols.department, cols.asset_tag);
  await assertGlobalUnique(client, null, cols); await assertFieldUnique(client, page, null, data);
  const names = Object.values(ROLE_COLUMNS);
  const { rows } = await client.query(
    `INSERT INTO inventory_records (page_id, data, secrets, ${names.join(',')}, created_by, updated_by)
     VALUES ($1,$2,$3,${names.map((_, i) => `$${i + 4}`).join(',')},$${names.length + 4},$${names.length + 4}) RETURNING *`,
    [page.id, JSON.stringify(data), JSON.stringify(secrets), ...names.map((c) => cols[c]), user.id]);
  return rows[0];
}

async function updateRecord(client, page, id, input, user) {
  const { rows: cur } = await client.query('SELECT * FROM inventory_records WHERE id = $1 AND page_id = $2 AND is_deleted = FALSE FOR UPDATE', [id, page.id]);
  if (!cur[0]) throw notFound('Record not found');
  const patch = pick(page, input);
  const data = { ...cur[0].data }; const secrets = { ...cur[0].secrets };
  for (const [k, v] of Object.entries(patch.data)) { if (v === null) delete data[k]; else data[k] = v; }
  Object.assign(secrets, patch.secrets); patch.clear.forEach((k) => delete secrets[k]);
  finalize(page, data, secrets);
  const cols = promote(page, data);
  if (!cur[0].is_decommissioned) {
    await validateTag(cols.department, cols.asset_tag);
    await assertGlobalUnique(client, id, cols); await assertFieldUnique(client, page, id, data);
  } else { cols.asset_tag = null; cols.ip_address = null; }   // decommissioned records hold no tag / IP
  const names = Object.values(ROLE_COLUMNS);
  const { rows } = await client.query(
    `UPDATE inventory_records SET data = $1, secrets = $2, ${names.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_by = $${names.length + 3}, updated_at = now()
     WHERE id = $${names.length + 4} RETURNING *`,
    [JSON.stringify(data), JSON.stringify(secrets), ...names.map((c) => cols[c]), user.id, id]);
  const changed = Object.keys({ ...cur[0].data, ...data }).filter((k) => JSON.stringify(cur[0].data[k]) !== JSON.stringify(data[k]));
  for (const k of Object.keys({ ...cur[0].secrets, ...secrets })) if (cur[0].secrets[k] !== secrets[k]) changed.push(`${k} (password)`);
  return { before: cur[0], after: rows[0], changed };
}

// ----------------------------------------------------------------------------------- list / read
function buildWhere(page, q) {
  const p = [page.id]; const w = ['r.page_id = $1', 'r.is_deleted = FALSE'];
  const show = q.show || 'active';
  if (show === 'active') w.push('r.is_decommissioned = FALSE'); else if (show === 'decommissioned') w.push('r.is_decommissioned = TRUE');
  const keys = new Set(fieldsOf(page).filter((f) => f.type !== 'password').map((f) => f.key));
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith('f_') || !keys.has(k.slice(2)) || v === '' || v === undefined) continue;
    p.push(k.slice(2), String(v)); w.push(`r.data->>$${p.length - 1} = $${p.length}`);
  }
  if (q.q) { p.push(`%${String(q.q).replace(/[%_\\]/g, '\\$&')}%`); w.push(`EXISTS (SELECT 1 FROM jsonb_each_text(r.data) e WHERE e.value ILIKE $${p.length})`); }
  return { where: w.join(' AND '), params: p };
}

function orderBy(page, sort, order) {
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  if (META_SORT[sort]) return `${META_SORT[sort]} ${dir}, r.id DESC`;
  const f = fieldsOf(page).find((x) => x.key === sort && x.type !== 'password');
  if (!f) return 'r.updated_at DESC, r.id DESC';
  const expr = f.type === 'number' ? `CASE WHEN r.data->>'${f.key}' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (r.data->>'${f.key}')::numeric END` : `r.data->>'${f.key}'`;   // key is validated by KEY_RE
  return `${expr} ${dir} NULLS LAST, r.id DESC`;
}

exports.list = async (req, res) => {
  const page = req.page;
  const pageNo = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || page.config.table?.pageSize || 25));
  const { where, params } = buildWhere(page, req.query);
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM inventory_records r WHERE ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT r.* FROM inventory_records r WHERE ${where} ORDER BY ${orderBy(page, req.query.sort || page.config.table?.sort?.key, req.query.order || page.config.table?.sort?.order)} LIMIT ${pageSize} OFFSET ${(pageNo - 1) * pageSize}`, params);
  res.json({ rows: rows.map((r) => sanitize(r, page)), total, page: pageNo, pageSize });
};

exports.filterOptions = async (req, res) => {
  const out = {};
  for (const key of req.page.config.table?.filters || []) {
    const f = fieldsOf(req.page).find((x) => x.key === key);
    if (!f) continue;
    if (f.type === 'boolean') { out[key] = ['true', 'false']; continue; }
    if (f.type === 'select' && f.options?.length) { out[key] = f.options; continue; }
    const { rows } = await db.query(`SELECT DISTINCT data->>$2 AS v FROM inventory_records WHERE page_id = $1 AND is_deleted = FALSE AND data->>$2 IS NOT NULL ORDER BY 1 LIMIT 300`, [req.page.id, key]);
    out[key] = rows.map((r) => r.v);
  }
  res.json(out);
};

exports.getOne = async (req, res) => {
  const { rows } = await db.query('SELECT * FROM inventory_records WHERE id = $1 AND page_id = $2 AND is_deleted = FALSE', [req.params.id, req.page.id]);
  if (!rows[0]) throw notFound('Record not found');
  res.json(sanitize(rows[0], req.page));
};

exports.create = async (req, res) => {
  const row = await db.withTx((c) => insertRecord(c, req.page, req.body.data || {}, req.user));
  audit(req, 'create', `page:${req.page.slug}`, row.id, { name: display(row) });
  teams.notify('asset_created', { title: `New record: ${display(row)}`, status: 'good',
    facts: [['Page', req.page.title], ['IP', row.ip_address], ['MAC', row.mac_address], ['Asset tag', row.asset_tag], ['By', req.user.email]] });
  res.status(201).json(sanitize(row, req.page));
};

exports.update = async (req, res) => {
  const { after, changed } = await db.withTx((c) => updateRecord(c, req.page, req.params.id, req.body.data || {}, req.user));
  audit(req, 'update', `page:${req.page.slug}`, after.id, { name: display(after), changed });
  if (changed.length) teams.notify('asset_updated', { title: `Record updated: ${display(after)}`, status: 'info', facts: [['Page', req.page.title], ['Changed', changed.join(', ')], ['By', req.user.email]] });
  res.json(sanitize(after, req.page));
};

exports.remove = async (req, res) => {
  const { rowCount } = await db.query('UPDATE inventory_records SET is_deleted = TRUE, deleted_at = now(), deleted_by = $3 WHERE id = $1 AND page_id = $2 AND is_deleted = FALSE', [req.params.id, req.page.id, req.user.id]);
  if (!rowCount) throw notFound('Record not found');
  audit(req, 'delete', `page:${req.page.slug}`, req.params.id);
  res.json({ ok: true });
};

exports.decommission = async (req, res) => {
  const r = await decommissionSvc.decommission(req.page, req.params.id, req.body.reason, req.user);
  audit(req, 'decommission', `page:${req.page.slug}`, r.id, { name: display(r), reason: req.body.reason });
  res.json({ ok: true });
};

exports.revealSecret = async (req, res) => {
  const f = fieldsOf(req.page).find((x) => x.key === req.params.key && x.type === 'password');
  if (!f) throw notFound('Not a password field');
  const { rows } = await db.query('SELECT secrets, vm_name, hostname, ip_address, id FROM inventory_records WHERE id = $1 AND page_id = $2 AND is_deleted = FALSE', [req.params.id, req.page.id]);
  if (!rows[0]) throw notFound('Record not found');
  audit(req, 'view_password', `page:${req.page.slug}`, req.params.id, { name: display(rows[0]), field: f.key });
  res.json({ password: decrypt(rows[0].secrets[f.key]) });
};

// ----------------------------------------------------------------------------------- bulk
exports.bulk = async (req, res) => {
  const { action, value } = req.body; const page = req.page; const rk = roleKeys(page);
  const ids = [...new Set(req.body.ids.map(Number))];
  let affected = 0; let detail = {};
  if (action === 'status') {
    if (!rk.status) throw bad('This page has no field with the Status role');
    if (!value) throw bad('A status value is required');
    await db.withTx(async (c) => {
      const { rows } = await c.query('SELECT id, data FROM inventory_records WHERE id = ANY($1::bigint[]) AND page_id = $2 AND is_deleted = FALSE FOR UPDATE', [ids, page.id]);
      for (const r of rows) {
        const data = { ...r.data, [rk.status]: String(value) };
        await c.query('UPDATE inventory_records SET data = $2, server_status = $3, updated_by = $4, updated_at = now() WHERE id = $1', [r.id, JSON.stringify(data), String(value).slice(0, 64), req.user.id]);
        affected++;
      }
    });
  } else if (action === 'delete') {
    affected = (await db.query('UPDATE inventory_records SET is_deleted = TRUE, deleted_at = now(), deleted_by = $1 WHERE id = ANY($2::bigint[]) AND page_id = $3 AND is_deleted = FALSE', [req.user.id, ids, page.id])).rowCount;
  } else if (action === 'assign_tags') {
    if (!rk.asset_tag || !rk.department) throw bad('Assigning tags needs fields with the Asset tag and Department roles on this page');
    const assigned = [];
    await db.withTx(async (c) => {
      const { rows } = await c.query(`SELECT id, data, department FROM inventory_records WHERE id = ANY($1::bigint[]) AND page_id = $2 AND is_deleted = FALSE AND (asset_tag IS NULL OR asset_tag = '') ORDER BY id`, [ids, page.id]);
      for (const r of rows) {
        if (!r.department) continue;
        const [tag] = await nextFreeTags(r.department, 1, c);
        await c.query('UPDATE inventory_records SET data = $2, asset_tag = $3, updated_by = $4, updated_at = now() WHERE id = $1', [r.id, JSON.stringify({ ...r.data, [rk.asset_tag]: tag }), tag, req.user.id]);
        assigned.push({ id: r.id, tag });
      }
    });
    affected = assigned.length; detail = { assigned };
  } else throw bad('Unknown bulk action');
  audit(req, `bulk_${action}`, `page:${page.slug}`, null, { count: affected, ids });
  res.json({ ok: true, affected, ...detail });
};

// ----------------------------------------------------------------------------------- export / import
const plainFields = (page) => fieldsOf(page).filter((f) => f.type !== 'password');

exports.exportCsv = async (req, res) => {
  const { where, params } = buildWhere(req.page, { ...req.query, show: req.query.show || 'all' });
  const { rows } = await db.query(`SELECT r.* FROM inventory_records r WHERE ${where} ORDER BY r.id LIMIT 50000`, params);
  audit(req, 'export', `page:${req.page.slug}`, null, { rows: rows.length });
  const fs = plainFields(req.page);
  sendCsv(res, `${req.page.slug}-${new Date().toISOString().slice(0, 10)}.csv`, [...fs.map((f) => ({ key: f.key, label: f.label })), { key: '_state', label: 'Decommissioned' }],
    rows.map((r) => ({ ...r.data, _state: r.is_decommissioned ? 'Yes' : '' })));
};

exports.templateXlsx = async (req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(req.page.title.slice(0, 30));
  ws.addRow(plainFields(req.page).map((f) => f.label + (f.required ? ' *' : '')));
  ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 22; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.page.slug}-template.xlsx"`);
  await wb.xlsx.write(res); res.end();
};

function cellText(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')).trim();
  return String(v).trim();
}

/** Parse the first sheet into plan rows: create / merge / error. Nothing is written. */
async function planImport(page, buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw bad('Could not read the workbook - is it a valid .xlsx file?'); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad('The workbook has no sheets');
  if (ws.rowCount > 5001) throw bad('Imports are limited to 5000 rows');
  const fs = plainFields(page); const lookup = new Map();
  for (const f of fs) { lookup.set(norm(f.label), f); lookup.set(norm(f.key), f); }
  const colMap = {};
  ws.getRow(1).eachCell((cell, n) => { const f = lookup.get(norm(cellText(cell).replace(/\*$/, ''))); if (f) colMap[n] = f; });
  if (!Object.keys(colMap).length) throw bad('No column heading matched a field on this page. Download the template for the expected headings.');
  const missing = fs.filter((f) => f.required && !Object.values(colMap).includes(f)).map((f) => f.label);
  if (missing.length) throw bad(`The sheet is missing required column(s): ${missing.join(', ')}`);

  const rk = roleKeys(page); const uniqueKeys = fs.filter((f) => f.unique).map((f) => f.key);
  const plan = []; const seen = new Set();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const raw = {};
    for (const [n, f] of Object.entries(colMap)) { const t = f.type === 'date' && row.getCell(+n).value instanceof Date ? row.getCell(+n).value : cellText(row.getCell(+n)); if (t !== '') raw[f.key] = t; }
    if (!Object.keys(raw).length) continue;
    try {
      const { data } = pick(page, raw);
      let existing = null;
      if (rk.asset_tag && data[rk.asset_tag]) existing = (await db.query('SELECT * FROM inventory_records WHERE page_id = $1 AND asset_tag = $2 AND is_deleted = FALSE LIMIT 1', [page.id, data[rk.asset_tag]])).rows[0];
      if (!existing && rk.mac && data[rk.mac]) existing = (await db.query('SELECT * FROM inventory_records WHERE page_id = $1 AND upper(mac_address) = $2 AND is_deleted = FALSE LIMIT 1', [page.id, data[rk.mac]])).rows[0];
      for (const k of uniqueKeys) if (!existing && data[k] !== undefined) existing = (await db.query('SELECT * FROM inventory_records WHERE page_id = $1 AND data->>$2 = $3 AND is_deleted = FALSE LIMIT 1', [page.id, k, String(data[k])])).rows[0];
      // Two rows in one file that identify the same record would overwrite each other, so flag the later one.
      const identity = existing ? [`id:${existing.id}`] : [rk.mac && data[rk.mac], rk.asset_tag && data[rk.asset_tag], ...uniqueKeys.map((k) => data[k])].filter(Boolean).map((v) => `v:${v}`);
      if (identity.some((k) => seen.has(k))) throw bad('Duplicate of an earlier row in this file');
      identity.forEach((k) => seen.add(k));
      const merged = { ...(existing ? existing.data : {}), ...data }; const mergedSecrets = { ...(existing ? existing.secrets : {}) };
      finalize(page, merged, mergedSecrets);
      const cols = promote(page, merged);
      await validateTag(cols.department, cols.asset_tag);
      await assertGlobalUnique(db, existing && existing.id, cols); await assertFieldUnique(db, page, existing && existing.id, merged);
      const changes = existing ? Object.keys(data).filter((k) => JSON.stringify(existing.data[k]) !== JSON.stringify(data[k])).map((k) => ({ field: k, from: existing.data[k] ?? null, to: data[k] })) : [];
      plan.push({ row: r, action: existing ? 'merge' : 'create', id: existing ? existing.id : null, data, changes });
    } catch (e) { plan.push({ row: r, action: 'error', errors: [e.message], data: raw }); }
  }
  return plan;
}

exports.importXlsx = async (req, res) => {
  if (!req.file) throw bad('Attach an .xlsx file in the "file" field');
  const page = req.page; const plan = await planImport(page, req.file.buffer);
  const summary = { create: 0, merge: 0, error: 0 }; plan.forEach((p) => { summary[p.action] += 1; });
  const rk = roleKeys(page);
  if (req.query.mode !== 'commit') {
    return res.json({ mode: 'preview', summary, rows: plan.map((p) => ({ row: p.row, action: p.action, changes: p.changes, errors: p.errors,
      preview: { name: p.data[rk.name] ?? p.data[rk.hostname] ?? Object.values(p.data)[0], ip: p.data[rk.ip], mac: p.data[rk.mac], tag: p.data[rk.asset_tag] } })) });
  }
  if (summary.error && req.query.skip_errors !== 'true') throw bad(`${summary.error} row(s) have errors. Fix them or import with "skip errors".`);
  const allowed = new Set((req.query.actions || 'create,merge').split(','));
  let created = 0; let merged = 0;
  await db.withTx(async (c) => {
    for (const p of plan) {
      if (!allowed.has(p.action)) continue;
      if (p.action === 'create') { await insertRecord(c, page, p.data, req.user); created++; }
      if (p.action === 'merge') { await updateRecord(c, page, p.id, p.data, req.user); merged++; }
    }
  });
  audit(req, 'import', `page:${page.slug}`, null, { created, merged, skipped: summary.error });
  res.json({ mode: 'commit', created, merged, skipped: summary.error });
};

// ----------------------------------------------------------------------------------- "view" pages (e.g. All records)
const colValue = (data, keys) => { for (const k of keys) { const v = data[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

async function runView(req, maxPageSize = 200) {
  const cfg = req.page.config; const q = req.query;
  const pageNo = Math.max(1, parseInt(q.page, 10) || 1); const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(q.pageSize, 10) || cfg.pageSize || 25));
  if (!cfg.sources?.length) return { rows: [], total: 0, page: 1, pageSize };
  // Only pages this user may open contribute rows.
  const { rows: srcs } = await db.query('SELECT id, slug, title FROM inventory_pages WHERE slug = ANY($1)', [cfg.sources]);
  const allowed = srcs.filter((s) => req.user.pages.has(pageKey(s.slug)));
  const ids = allowed.map((s) => s.id);
  const p = [ids]; const w = ['r.page_id = ANY($1)', 'r.is_deleted = FALSE'];
  const show = q.show || 'active';
  if (show === 'active') w.push('r.is_decommissioned = FALSE'); else if (show === 'decommissioned') w.push('r.is_decommissioned = TRUE');
  if (q._page) { const s = allowed.find((x) => x.slug === q._page); p.push(s ? s.id : -1); w.push(`r.page_id = $${p.length}`); }
  for (const col of cfg.columns || []) {
    const v = q[`f_${col.id}`]; if (v === undefined || v === '' || !(cfg.filters || []).includes(col.id)) continue;
    p.push(col.keys, String(v)); w.push(`COALESCE(${col.keys.map((_, i) => `NULLIF(r.data->>($${p.length - 1}::text[])[${i + 1}], '')`).join(', ')}) = $${p.length}`);
  }
  if (q.q) { p.push(`%${String(q.q).replace(/[%_\\]/g, '\\$&')}%`); w.push(`EXISTS (SELECT 1 FROM jsonb_each_text(r.data) e WHERE e.value ILIKE $${p.length})`); }
  const where = w.join(' AND ');
  const total = (await db.query(`SELECT COUNT(*)::int n FROM inventory_records r WHERE ${where}`, p)).rows[0].n;
  const sortCol = (cfg.columns || []).find((c) => c.id === q.sort && c.keys.length);
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const order = sortCol ? `COALESCE(${sortCol.keys.map((k) => `NULLIF(r.data->>'${k}', '')`).join(', ')}) ${dir} NULLS LAST, r.id` : 'r.updated_at DESC, r.id DESC';   // keys validated by KEY_RE
  const { rows } = await db.query(`SELECT r.id, r.page_id, r.data, r.is_decommissioned, r.updated_at FROM inventory_records r WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(pageNo - 1) * pageSize}`, p);
  const byId = new Map(allowed.map((s) => [s.id, s]));
  return { rows: rows.map((r) => ({ id: r.id, page_slug: byId.get(r.page_id).slug, page_title: byId.get(r.page_id).title, data: r.data, is_decommissioned: r.is_decommissioned, updated_at: r.updated_at })), total, page: pageNo, pageSize };
}
exports.viewList = async (req, res) => res.json(await runView(req));

exports.viewFilterOptions = async (req, res) => {
  const cfg = req.page.config; const out = {};
  const { rows: srcs } = await db.query('SELECT id, slug FROM inventory_pages WHERE slug = ANY($1)', [cfg.sources || []]);
  const ids = srcs.filter((s) => req.user.pages.has(pageKey(s.slug))).map((s) => s.id);
  for (const id of cfg.filters || []) {
    const col = cfg.columns.find((c) => c.id === id); if (!col) continue;
    const { rows } = await db.query(`SELECT DISTINCT COALESCE(${col.keys.map((k) => `NULLIF(data->>'${k}', '')`).join(', ')}) AS v FROM inventory_records WHERE page_id = ANY($1) AND is_deleted = FALSE ORDER BY 1 LIMIT 300`, [ids]);
    out[id] = rows.map((r) => r.v).filter((v) => v !== null);
  }
  res.json(out);
};

exports.viewExport = async (req, res) => {
  const payload = await runView({ page: req.page, user: req.user, query: { ...req.query, page: 1, pageSize: 50000 } }, 50000);
  audit(req, 'export', `page:${req.page.slug}`, null, { rows: payload.rows.length });
  const cols = req.page.config.columns || [];
  sendCsv(res, `${req.page.slug}-${new Date().toISOString().slice(0, 10)}.csv`, cols.map((c) => ({ key: c.id, label: c.label })),
    payload.rows.map((r) => Object.fromEntries(cols.map((c) => [c.id, c.id === '_page' ? r.page_title : colValue(r.data, c.keys)]))));
};

/** Used by discovery "add to inventory". */
exports.createFromData = async (page, data, user) => {
  const row = await db.withTx((c) => insertRecord(c, page, data, user));
  return row;
};
exports.display = display;

/** Recompute promoted columns for every record after a page's role mapping changes. */
exports.rebuildPromoted = async (page) => {
  const names = Object.values(ROLE_COLUMNS);
  await db.withTx(async (c) => {
    const { rows } = await c.query('SELECT id, data, is_decommissioned FROM inventory_records WHERE page_id = $1', [page.id]);
    for (const r of rows) {
      const cols = promote(page, r.data);
      if (r.is_decommissioned) { cols.asset_tag = null; cols.ip_address = null; }
      await c.query(`UPDATE inventory_records SET ${names.map((n, i) => `${n} = $${i + 2}`).join(', ')} WHERE id = $1`, [r.id, ...names.map((n) => cols[n])]);
    }
  });
};
