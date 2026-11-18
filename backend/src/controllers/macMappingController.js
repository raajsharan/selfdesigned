// MAC -> IP mapping files. An administrator uploads CSV / XLSX files (MAC Address + IP Address, optionally LAN Segment, VLAN Group, Data Retrieved);
// each upload is stored separately and the MAC lookup combines them: the newest file wins when a MAC is in more than one.
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const path = require('path');
const db = require('../config/db');
const { audit } = require('../services/auditService');
const { bad, notFound } = require('../utils/httpError');

const MAX_ROWS = 200000;
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
// Column names are detected, not fixed: "MAC Address", "mac", "Hardware Addr" ... all work.
const HEADERS = { mac: /mac|hardware.?addr/i, ip: /^ip$|^ipv4|ip.?addr|^address$/i, lan: /(?<!v)lan|segment|subnet/i, vlan: /vlan/i, data: /data|retriev|collect|last.?seen|date|time/i };

const cellText = (c) => {
  const v = c && c.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') return String(v.text ?? v.result ?? (Array.isArray(v.richText) ? v.richText.map((x) => x.text).join('') : '')).trim();
  return String(v).trim();
};
const normMac = (s) => { const hex = String(s).toUpperCase().replace(/[^0-9A-F]/g, ''); return /^[0-9A-F]{12}$/.test(hex) ? hex : null; };
const fmtMac = (hex) => hex.match(/../g).join(':');

/** Reads the first sheet of a csv / xlsx upload into { rows: [{mac, ip, lan, vlan, data}], columns, skipped }. */
async function parse(file) {
  const wb = new ExcelJS.Workbook();
  const isCsv = path.extname(file.originalname).toLowerCase() === '.csv';
  try { if (isCsv) await wb.csv.read(Readable.from(file.buffer)); else await wb.xlsx.load(file.buffer); } catch { throw bad(`Could not read "${file.originalname}": is it a valid ${isCsv ? 'CSV' : 'Excel (.xlsx)'} file?`); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad('The file has no sheet');
  if (ws.rowCount > MAX_ROWS + 1) throw bad(`The file has more than ${MAX_ROWS.toLocaleString()} rows`);
  // The header is the first of the top rows that names both a MAC and an IP column.
  let head = null; const cols = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !head; r++) {
    const found = {};
    ws.getRow(r).eachCell((cell, n) => {
      const t = cellText(cell);
      for (const [k, re] of Object.entries(HEADERS)) if (!found[k] && re.test(t) && !Object.values(found).some((f) => f.n === n)) found[k] = { n, name: t };
    });
    if (found.mac && found.ip) { head = r; Object.assign(cols, found); }
  }
  if (!head) throw bad('The file must have a MAC Address column and an IP Address column in its header row');
  const seen = new Set(); const rows = []; let skipped = 0;
  for (let r = head + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const macHex = normMac(cellText(row.getCell(cols.mac.n))); const ip = cellText(row.getCell(cols.ip.n)).split(/[\s,;]+/)[0];
    if (!macHex && !ip) continue;                                    // an empty line is not a problem
    if (!macHex || !IPV4.test(ip)) { skipped++; continue; }
    if (seen.has(macHex)) continue;                                  // inside one file the first row for a MAC wins
    seen.add(macHex);
    rows.push({ mac: macHex, ip, lan: cols.lan ? cellText(row.getCell(cols.lan.n)).slice(0, 128) : '', vlan: cols.vlan ? cellText(row.getCell(cols.vlan.n)).slice(0, 128) : '', data: cols.data ? cellText(row.getCell(cols.data.n)).slice(0, 255) : '' });
  }
  return { rows, skipped, columns: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name.slice(0, 80)])) };
}

exports.list = async (req, res) => {
  const { rows } = await db.query('SELECT id, filename, row_count, skipped, columns, uploaded_by_email, uploaded_at FROM mac_mapping_files ORDER BY uploaded_at DESC, id DESC');
  res.json({ files: rows, totals: { files: rows.length, entries: rows.reduce((n, f) => n + f.row_count, 0) } });
};

exports.upload = async (req, res) => {
  if (!req.file) throw bad('Attach a .csv or .xlsx file in the "file" field');
  const p = await parse(req.file);
  if (!p.rows.length) throw bad(`No usable rows: every row needs a valid MAC address and an IPv4 address (${p.skipped} row(s) were skipped)`);
  const name = path.basename(req.file.originalname).slice(0, 255);
  const id = await db.withTx(async (c) => {
    const f = (await c.query('INSERT INTO mac_mapping_files (filename, row_count, skipped, columns, uploaded_by, uploaded_by_email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, p.rows.length, p.skipped, JSON.stringify(p.columns), req.user.id, req.user.email])).rows[0].id;
    for (let i = 0; i < p.rows.length; i += 2000) {
      const b = p.rows.slice(i, i + 2000);
      await c.query(`INSERT INTO mac_mapping_entries (file_id, mac, mac_key, ip, lan_segment, vlan_group, data_retrieved)
                     SELECT $1, t.mac, t.mk, t.ip, NULLIF(t.lan, ''), NULLIF(t.vlan, ''), NULLIF(t.dr, '')
                     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS t(mac, mk, ip, lan, vlan, dr)`,
      [f, b.map((x) => fmtMac(x.mac)), b.map((x) => x.mac), b.map((x) => x.ip), b.map((x) => x.lan), b.map((x) => x.vlan), b.map((x) => x.data)]);
    }
    return f;
  });
  audit(req, 'upload', 'mac_mapping', id, { name, rows: p.rows.length, skipped: p.skipped });
  res.status(201).json({ id, filename: name, rows: p.rows.length, skipped: p.skipped, columns: p.columns });
};

exports.remove = async (req, res) => {
  const { rows } = await db.query('DELETE FROM mac_mapping_files WHERE id = $1 RETURNING filename', [req.params.id]);
  if (!rows[0]) throw notFound('File not found');
  audit(req, 'delete', 'mac_mapping', req.params.id, { name: rows[0].filename });
  res.json({ ok: true });
};

exports.clear = async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM mac_mapping_files');
  audit(req, 'clear', 'mac_mapping', null, { files: rowCount });
  res.json({ ok: true, deleted: rowCount });
};

/** Mapping rows whose MAC contains `key` (hex digits only), the newest file first per MAC. Used by the MAC lookup. */
exports.lookup = async (key) => (await db.query(
  `SELECT DISTINCT ON (e.mac_key) e.mac, e.ip, e.lan_segment, e.vlan_group, e.data_retrieved, f.filename, f.uploaded_at
   FROM mac_mapping_entries e JOIN mac_mapping_files f ON f.id = e.file_id WHERE e.mac_key LIKE $1
   ORDER BY e.mac_key, f.uploaded_at DESC, f.id DESC LIMIT 200`, [`%${key}%`])).rows;

const macKeyOf = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');

/** mac_key -> { ip, lan_segment, vlan_group, filename } for these MAC addresses; the newest file wins. */
exports.lookupMacs = async (macs) => {
  const keys = [...new Set(macs.map(macKeyOf).filter((k) => k.length === 12))];
  if (!keys.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (e.mac_key) e.mac_key, e.ip, e.lan_segment, e.vlan_group, f.filename FROM mac_mapping_entries e JOIN mac_mapping_files f ON f.id = e.file_id
     WHERE e.mac_key = ANY($1::text[]) ORDER BY e.mac_key, f.uploaded_at DESC, f.id DESC`, [keys]);
  return new Map(rows.map((r) => [r.mac_key, r]));
};
exports.macKeyOf = macKeyOf;

/**
 * Fills the empty IP addresses of discovered VMs from the MAC mapping files, and keeps earlier fills current (an IP that came from the mapping
 * follows the mapping: changed when a newer file says otherwise, removed when no file knows the MAC any more). A discovered IP is never touched.
 * `table` is a trusted constant ('vmware_vms' | 'proxmox_vms'). Resolves to { filled, changed, cleared }.
 */
exports.fillVmIps = async (table, serverId) => {
  const where = serverId ? 'AND server_id = $1' : '';
  const { rows } = await db.query(
    `SELECT id, ip_address, ip_source, mac_addresses FROM ${table}
     WHERE (ip_address IS NULL OR ip_address = '' OR ip_source = 'mac_mapping') AND cardinality(mac_addresses) > 0 ${where}`, serverId ? [serverId] : []);
  if (!rows.length) return { filled: 0, changed: 0, cleared: 0 };
  const map = await exports.lookupMacs(rows.flatMap((r) => r.mac_addresses));
  const set = []; const clear = []; let filled = 0; let changed = 0;
  for (const r of rows) {
    const hit = r.mac_addresses.map((m) => map.get(macKeyOf(m))).find(Boolean);
    if (hit) { if (r.ip_address !== hit.ip) { set.push([r.id, hit.ip]); if (r.ip_source === 'mac_mapping') changed++; else filled++; } }
    else if (r.ip_source === 'mac_mapping') clear.push(r.id);
  }
  for (let i = 0; i < set.length; i += 1000) {
    const b = set.slice(i, i + 1000);
    await db.query(`UPDATE ${table} v SET ip_address = t.ip, ip_source = 'mac_mapping' FROM unnest($1::bigint[], $2::text[]) AS t(id, ip) WHERE v.id = t.id`, [b.map((x) => x[0]), b.map((x) => x[1])]);
  }
  if (clear.length) await db.query(`UPDATE ${table} SET ip_address = NULL, ip_source = NULL WHERE id = ANY($1::bigint[])`, [clear]);
  return { filled, changed, cleared: clear.length };
};
