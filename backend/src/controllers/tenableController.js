const ExcelJS = require('exceljs');
const db = require('../config/db');
const { loadInventoryIndex, macKey } = require('../services/reconcileService');
const { sendCsv } = require('../utils/csv');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const short = (n) => String(n || '').trim().toLowerCase().split('.')[0];
const HEADERS = {
  hostname: ['name', 'dnsname', 'hostname', 'netbiosname', 'fqdn', 'assetname', 'host'], ip_address: ['ipaddress', 'ip', 'ipv4address', 'ipv4', 'ipaddresses'],
  mac_address: ['macaddress', 'mac', 'macaddresses'], os: ['operatingsystem', 'os', 'operatingsystems'],
  critical: ['critical'], high: ['high'], medium: ['medium'], low: ['low'], last_seen: ['lastseen', 'lastobserved', 'lastscan', 'lastscanned'],
};
const text = (c) => {
  const v = c && c.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')).trim();
  return String(v).trim();
};

exports.report = async (req, res) => {
  const cur = (await db.query('SELECT * FROM tenable_imports WHERE is_current ORDER BY id DESC LIMIT 1')).rows[0];
  const idx = await loadInventoryIndex();
  const allowed = (r) => req.user.pages.has(`page:${r.source}`);                       // only pages this user may open
  const source = req.query.source && idx.rows.some((a) => a.source === req.query.source) ? req.query.source : null;
  const inv = idx.rows.filter((a) => allowed(a) && (!source || a.source === source));
  const t = cur ? (await db.query('SELECT * FROM tenable_assets WHERE import_id = $1', [cur.id])).rows : [];

  const tByMac = new Map(); const tByIp = new Map(); const tByName = new Map();
  for (const a of t) {
    for (const m of String(a.mac_address || '').split(/[,;\s]+/).filter(Boolean)) tByMac.set(macKey(m), a);
    for (const ip of String(a.ip_address || '').split(/[,;\s]+/).filter(Boolean)) tByIp.set(ip, a);
    if (a.hostname) tByName.set(short(a.hostname), a);
  }
  const matchedTenable = new Set(); const matched = []; const notIn = [];
  for (const a of inv) {
    const hit = tByMac.get(macKey(a.mac_address)) || (a.ip_address && tByIp.get(a.ip_address)) || tByName.get(short(a.hostname)) || tByName.get(short(a.vm_name));
    if (hit) { matchedTenable.add(hit.id); matched.push({ ...a, tenable: { critical: hit.critical, high: hit.high, medium: hit.medium, low: hit.low, last_seen: hit.last_seen } }); }
    else notIn.push(a);
  }
  // Tenable-only is only meaningful against the whole estate, so it ignores the source filter.
  const allInvHit = (a) => (idx.byMac.has(macKey(a.mac_address)) || (a.ip_address && idx.byIp.has(a.ip_address)) || idx.byName.has(short(a.hostname)));
  const tenableOnly = source ? [] : t.filter((a) => !matchedTenable.has(a.id) && !allInvHit(a)).map(({ raw, ...r }) => r);
  const mapAsset = (a) => ({ source: a.source, id: a.id, name: a.vm_name || a.hostname, hostname: a.hostname, ip_address: a.ip_address, mac_address: a.mac_address, os_type: a.os_type, asset_tag: a.asset_tag, department: a.department, tenable: a.tenable });
  res.json({ import: cur || null, stats: { matched: matched.length, not_in_tenable: notIn.length, tenable_only: tenableOnly.length, inventory_total: inv.length, tenable_total: t.length,
      coverage_percent: inv.length ? Math.round((matched.length / inv.length) * 1000) / 10 : null },
    matched: matched.map(mapAsset), not_in_tenable: notIn.map(mapAsset), tenable_only: tenableOnly });
};

exports.reportCsv = async (req, res) => {
  const r = await (async () => { let out; await exports.report({ query: req.query, user: req.user }, { json: (v) => { out = v; } }); return out; })();
  const tab = ['matched', 'not_in_tenable', 'tenable_only'].includes(req.query.tab) ? req.query.tab : 'matched';
  audit(req, 'export', 'tenable', null, { tab });
  sendCsv(res, `tenable-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
    [['source', 'Inventory'], ['name', 'Name'], ['hostname', 'Hostname'], ['ip_address', 'IP'], ['mac_address', 'MAC'], ['os_type', 'OS'], ['asset_tag', 'Asset tag'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([key, label]) => ({ key, label })),
    r[tab].map((a) => ({ ...a, ...(a.tenable || {}), name: a.name || a.hostname, os_type: a.os_type || a.os })));
};

exports.import = async (req, res) => {
  if (!req.file) throw bad('Attach the Tenable export (.xlsx) in the "file" field');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('Could not read the workbook'); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad('The workbook has no sheets');
  if (ws.rowCount > 100001) throw bad('Too many rows (max 100,000)');
  const col = {};
  ws.getRow(1).eachCell((c, n) => { const h = norm(text(c)); for (const [k, names] of Object.entries(HEADERS)) if (names.includes(h) && !col[k]) col[k] = n; });
  if (!col.hostname && !col.ip_address) throw bad('The sheet needs a hostname/name or an IP address column');
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const g = (k) => (col[k] ? text(row.getCell(col[k])) : '');
    if (!g('hostname') && !g('ip_address')) continue;
    const ls = g('last_seen');
    rows.push({ hostname: g('hostname') || null, ip_address: g('ip_address') || null, mac_address: g('mac_address') || null, os: g('os') || null,
      critical: parseInt(g('critical'), 10) || 0, high: parseInt(g('high'), 10) || 0, medium: parseInt(g('medium'), 10) || 0, low: parseInt(g('low'), 10) || 0,
      last_seen: ls && !Number.isNaN(Date.parse(ls)) ? new Date(ls).toISOString() : null });
  }
  if (!rows.length) throw bad('No data rows found');
  const importId = await db.withTx(async (c) => {
    await c.query('UPDATE tenable_imports SET is_current = FALSE');
    const { rows: imp } = await c.query('INSERT INTO tenable_imports (filename, row_count, imported_by) VALUES ($1,$2,$3) RETURNING id', [req.file.originalname.slice(0, 255), rows.length, req.user.email]);
    for (let i = 0; i < rows.length; i += 500) {
      const b = rows.slice(i, i + 500);
      await c.query(
        `INSERT INTO tenable_assets (import_id, hostname, ip_address, mac_address, os, critical, high, medium, low, last_seen)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::timestamptz[])`,
        [imp[0].id, b.map((x) => x.hostname), b.map((x) => x.ip_address), b.map((x) => x.mac_address), b.map((x) => x.os), b.map((x) => x.critical), b.map((x) => x.high), b.map((x) => x.medium), b.map((x) => x.low), b.map((x) => x.last_seen)]);
    }
    return imp[0].id;
  });
  audit(req, 'import', 'tenable', importId, { rows: rows.length, file: req.file.originalname });
  res.status(201).json({ ok: true, import_id: importId, rows: rows.length });
};
