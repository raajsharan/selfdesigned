const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { toCsv } = require('../utils/csv');
const { getSetting, setSetting } = require('./settingsService');
const { bad, notFound } = require('../utils/httpError');

// Tables included in CSV backups. Users/secrets are covered by pg_dump only.
const CSV_TABLES = ['inventory_pages', 'inventory_records', 'dropdown_values', 'department_tag_ranges',
  'migration_projects', 'migration_custom_fields', 'migration_hosts', 'migration_vms', 'decommission_log', 'audit_logs'];
const RESTORABLE = CSV_TABLES.filter((t) => !['decommission_log', 'audit_logs'].includes(t));   // immutable / append-only
const SECRET_COL = /password|secret|token|hash/i;
const dir = () => process.env.CSV_BACKUP_DIR || '/var/backups/inventory';

async function columns(table) {
  const { rows } = await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [table]);
  return rows.map((r) => r.column_name);
}

async function tableCsv(table) {
  if (!CSV_TABLES.includes(table)) throw bad('Unknown table');
  const cols = (await columns(table)).filter((c) => !SECRET_COL.test(c));
  const { rows } = await db.query(`SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM ${table} ORDER BY 1`);
  return toCsv(cols.map((c) => ({ key: c, label: c })), rows);
}

function pgEnv() {
  const u = new URL(db.connectionString);
  return { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
}

async function record(kind, file, size, status, error, by) {
  const { rows } = await db.query('INSERT INTO backup_history (kind, path, size_bytes, status, error, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [kind, file, size, status, error, by]);
  return rows[0];
}

async function createPgDump(by) {
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), `pgdump-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  return new Promise((resolve) => {
    // Password travels in the environment, not argv, so it is not visible in `ps`.
    execFile(process.env.PG_DUMP_PATH || 'pg_dump', ['-F', 'c', '-f', file], { env: pgEnv(), timeout: 10 * 60000 }, async (err) => {
      if (err) return resolve(await record('pg_dump', file, null, 'failed', String(err.message).slice(0, 500), by));
      resolve(await record('pg_dump', file, fs.statSync(file).size, 'ok', null, by));
    });
  });
}

async function createCsvSet(by) {
  const out = path.join(dir(), `csv-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  let size = 0;
  for (const t of CSV_TABLES) { const csv = await tableCsv(t); fs.writeFileSync(path.join(out, `${t}.csv`), csv); size += Buffer.byteLength(csv); }
  return record('csv', out, size, 'ok', null, by);
}

async function parseCsv(buffer) {
  const wb = new ExcelJS.Workbook();
  const { Readable } = require('stream');
  const ws = await wb.csv.read(Readable.from(buffer));
  const header = []; ws.getRow(1).eachCell((c, n) => { header[n] = String(c.value ?? '').replace(/^\ufeff/, ''); });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const o = {}; let any = false;
    header.forEach((h, n) => { if (!h) return; const v = ws.getRow(r).getCell(n).value; o[h] = v === null || v === undefined || v === '' ? null : (typeof v === 'object' ? (v.text ?? v.result ?? String(v)) : v); if (o[h] !== null) any = true; });
    if (any) rows.push(o);
  }
  return rows;
}

/** Insert rows that do not exist yet (by id); existing rows are never overwritten. */
async function restoreTable(table, rows) {
  if (!RESTORABLE.includes(table)) throw bad(`Table "${table}" cannot be restored from CSV`);
  const valid = new Set(await columns(table));
  let inserted = 0;
  await db.withTx(async (c) => {
    for (const row of rows) {
      const cols = Object.keys(row).filter((k) => valid.has(k) && !SECRET_COL.test(k));
      if (!cols.length) continue;
      const r = await c.query(`INSERT INTO ${table} (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`, cols.map((k) => (row[k] === null ? null : String(row[k]))));
      inserted += r.rowCount;
    }
    if (valid.has('id')) await c.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${table}), 1))`);
  });
  return inserted;
}

async function restoreFromHistory(id) {
  const { rows } = await db.query('SELECT * FROM backup_history WHERE id = $1', [id]);
  const h = rows[0];
  if (!h || h.kind !== 'csv' || h.status !== 'ok') throw notFound('Only a successful CSV backup can be restored from history');
  const base = path.resolve(dir());
  if (!path.resolve(h.path).startsWith(base + path.sep)) throw bad('Backup path is outside the backup directory');
  const result = {};
  for (const t of RESTORABLE) { const f = path.join(h.path, `${t}.csv`); if (fs.existsSync(f)) result[t] = await restoreTable(t, await parseCsv(fs.readFileSync(f))); }
  return result;
}

// ---- schedule
const SCHED_DEFAULT = { enabled: false, interval_hours: 24, last_run: null };
let timer = null;
function startScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const s = await getSetting('backup_schedule', SCHED_DEFAULT);
      if (!s.enabled || (s.last_run && Date.now() - new Date(s.last_run).getTime() < s.interval_hours * 3600000)) return;
      await setSetting('backup_schedule', { ...s, last_run: new Date().toISOString() });
      await createPgDump('scheduler'); await createCsvSet('scheduler');
    } catch (e) { console.error('[backup-scheduler]', e.message); }
  }, 5 * 60000);
  timer.unref();
}

module.exports = { CSV_TABLES, RESTORABLE, tableCsv, createPgDump, createCsvSet, parseCsv, restoreTable, restoreFromHistory, startScheduler,
  getSchedule: () => getSetting('backup_schedule', SCHED_DEFAULT),
  saveSchedule: async (b) => { const c = await getSetting('backup_schedule', SCHED_DEFAULT); return setSetting('backup_schedule', { ...c, enabled: !!b.enabled, interval_hours: Math.min(720, Math.max(1, parseInt(b.interval_hours, 10) || c.interval_hours)) }); },
  history: async () => (await db.query('SELECT * FROM backup_history ORDER BY id DESC LIMIT 100')).rows };
