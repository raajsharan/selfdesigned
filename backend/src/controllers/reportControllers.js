// Dashboard, weekly report, compliance config, data health and reconcile.
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const EXCLUDED_STATUSES = ['NA', 'Not in Scope'];   // left out of every compliance total
const { getSetting, setSetting } = require('../services/settingsService');
const { loadInventoryIndex, classify } = require('../services/reconcileService');
const { unionSql } = require('../utils/inventoryUnion');
const { sendCsv } = require('../utils/csv');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');

const COMPLIANCE_DEFAULT = {
  patch_threshold_days: 30, patch_target_percent: 90, stale_days: 180, report_day: 1,
  sections: { inventory_totals: true, status_breakdown: true, patching: true, extended: true },
};
exports.getCompliance = async (req, res) => res.json(await getSetting('compliance', COMPLIANCE_DEFAULT));
exports.putCompliance = async (req, res) => {
  const b = req.body; const cur = await getSetting('compliance', COMPLIANCE_DEFAULT);
  const v = {
    patch_threshold_days: Math.min(365, Math.max(1, parseInt(b.patch_threshold_days, 10) || cur.patch_threshold_days)),
    patch_target_percent: Math.min(100, Math.max(1, parseInt(b.patch_target_percent, 10) || cur.patch_target_percent)),
    stale_days: Math.min(3650, Math.max(1, parseInt(b.stale_days, 10) || cur.stale_days)),
    report_day: Math.min(6, Math.max(0, Number.isInteger(b.report_day) ? b.report_day : cur.report_day)),
    sections: { ...cur.sections, ...Object.fromEntries(Object.keys(cur.sections).filter((k) => typeof (b.sections || {})[k] === 'boolean').map((k) => [k, b.sections[k]])) },
  };
  await setSetting('compliance', v);
  audit(req, 'update', 'compliance_config');
  res.json(v);
};

async function weeklyReport(user) {
  const cfg = await getSetting('compliance', COMPLIANCE_DEFAULT);
  const inventories = [];
  const ext = { os_type: {}, department: {}, location: {}, patching_type: {} };
  const pages = (await db.query("SELECT id, slug, title FROM inventory_pages WHERE kind = 'records' ORDER BY sort_order, id")).rows
    .filter((p) => !user || user.pages.has(pageKey(p.slug)));
  for (const pg of pages) {
    const scope = 'page_id = $1 AND is_deleted = FALSE AND is_decommissioned = FALSE';
    const { rows: st } = await db.query(`SELECT COALESCE(server_status,'Unspecified') AS status, COUNT(*)::int AS n FROM inventory_records WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC`, [pg.id]);
    // "NA" and "Not in Scope" are listed in the breakdown but never counted toward totals or compliance.
    const inScope = st.filter((s) => !EXCLUDED_STATUSES.includes(s.status));
    const total = inScope.reduce((a, s) => a + s.n, 0);
    const { rows: pt } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE last_patched_at >= current_date - $2::int)::int AS patched, COUNT(*)::int AS n
       FROM inventory_records WHERE ${scope} AND COALESCE(server_status,'') <> ALL($3)`, [pg.id, cfg.patch_threshold_days, EXCLUDED_STATUSES]);
    const decom = (await db.query('SELECT COUNT(*)::int n FROM inventory_records WHERE page_id = $1 AND is_deleted = FALSE AND is_decommissioned = TRUE', [pg.id])).rows[0].n;
    for (const col of Object.keys(ext)) {
      const { rows } = await db.query(`SELECT COALESCE(${col},'Unspecified') AS k, COUNT(*)::int AS n FROM inventory_records WHERE ${scope} AND COALESCE(server_status,'') <> ALL($2) GROUP BY 1`, [pg.id, EXCLUDED_STATUSES]);
      rows.forEach((r) => { ext[col][r.k] = (ext[col][r.k] || 0) + r.n; });
    }
    inventories.push({ key: pg.slug, label: pg.title, total, excluded: st.filter((s) => EXCLUDED_STATUSES.includes(s.status)).reduce((a, s) => a + s.n, 0),
      decommissioned: decom, statuses: st,
      patched: pt[0].patched, patched_percent: pt[0].n ? Math.round((pt[0].patched / pt[0].n) * 1000) / 10 : null });
  }
  const sum = (k) => inventories.reduce((a, i) => a + i[k], 0);
  const patched = sum('patched'); const total = sum('total');
  return {
    generated_at: new Date().toISOString(), config: cfg, excluded_statuses: EXCLUDED_STATUSES,
    totals: { assets: total, patched, patched_percent: total ? Math.round((patched / total) * 1000) / 10 : null, decommissioned: sum('decommissioned'),
      meets_target: total ? (patched / total) * 100 >= cfg.patch_target_percent : null },
    inventories,
    extended: Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, Object.entries(v).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)])),
  };
}
exports.weeklyReport = async (req, res) => res.json(await weeklyReport(req.user));
exports.weeklyReportCsv = async (req, res) => {
  const r = await weeklyReport(req.user);
  sendCsv(res, `weekly-report-${new Date().toISOString().slice(0, 10)}.csv`,
    [{ key: 'inventory', label: 'Inventory' }, { key: 'total', label: 'In-scope assets' }, { key: 'excluded', label: 'Excluded (NA / Not in Scope)' },
     { key: 'decommissioned', label: 'Decommissioned' }, { key: 'patched', label: `Patched within ${r.config.patch_threshold_days}d` }, { key: 'patched_percent', label: 'Patched %' }],
    r.inventories.map((i) => ({ ...i, inventory: i.label })));
};

exports.dashboard = async (req, res) => {
  const counts = [];
  const pages = (await db.query("SELECT id, slug, title, kind FROM inventory_pages ORDER BY sort_order, id")).rows.filter((p) => req.user.pages.has(pageKey(p.slug)));
  for (const p of pages.filter((x) => x.kind === 'records')) {
    const { rows } = await db.query('SELECT COUNT(*) FILTER (WHERE NOT is_decommissioned)::int AS active, COUNT(*) FILTER (WHERE is_decommissioned)::int AS decommissioned FROM inventory_records WHERE page_id = $1 AND is_deleted = FALSE', [p.id]);
    counts.push({ key: p.slug, label: p.title, ...rows[0] });
  }
  const one = async (sql) => (await db.query(sql)).rows[0];
  const [vm, px, mig, tenable] = await Promise.all([
    one('SELECT COUNT(*)::int AS n FROM vmware_vms'), one('SELECT COUNT(*)::int AS n FROM proxmox_vms'),
    one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE migration_status = 'Migrated')::int AS migrated FROM migration_vms`),
    one('SELECT imported_at, row_count FROM tenable_imports WHERE is_current ORDER BY id DESC LIMIT 1'),
  ]);
  const recent = req.user.pages.has('admin-audit')
    ? (await db.query('SELECT id, user_email, action, entity, entity_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 8')).rows : [];
  res.json({ inventories: counts, discovery: { vmware: vm.n, proxmox: px.n }, migration: mig, tenable: tenable || null, recent });
};

// ---- Data health ------------------------------------------------------------------------
exports.dataHealth = async (req, res) => {
  const cfg = await getSetting('compliance', COMPLIANCE_DEFAULT);
  const live = 'is_deleted = FALSE AND is_decommissioned = FALSE';
  const cols = 'id, vm_name, hostname, ip_address, mac_address, asset_tag, updated_at';
  const q = async (where, params = []) => (await db.query(`SELECT * FROM (${unionSql(cols, `${live} AND ${where}`)}) t ORDER BY source, id LIMIT 200`, params)).rows;
  const dupMacs = (await db.query(
    `SELECT upper(mac_address) AS mac, COUNT(*)::int AS n, json_agg(json_build_object('source', source, 'id', id, 'name', COALESCE(vm_name, hostname))) AS assets
     FROM (${unionSql('id, vm_name, hostname, mac_address', live)}) t GROUP BY upper(mac_address) HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 200`)).rows;
  const issues = {
    missing_ip: await q("(ip_address IS NULL OR ip_address = '')"),
    missing_tag: await q("(asset_tag IS NULL OR asset_tag = '')"),
    stale: await q('updated_at < now() - ($1::int * interval \'1 day\')', [cfg.stale_days]),
    duplicate_macs: dupMacs,
  };
  // Only pages this user may open contribute rows.
  const ok = (r) => req.user.pages.has(pageKey(r.source));
  for (const k of ['missing_ip', 'missing_tag', 'stale']) issues[k] = issues[k].filter(ok);
  issues.duplicate_macs = issues.duplicate_macs.map((d) => ({ ...d, assets: d.assets.filter((a) => req.user.pages.has(pageKey(a.source))) })).filter((d) => d.assets.length > 1);
  res.json({ stale_days: cfg.stale_days, counts: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.length])), issues });
};

// ---- Reconcile ----------------------------------------------------------------------------
exports.reconcile = async (req, res) => {
  const idx = await loadInventoryIndex();
  const vms = [
    ...(await db.query('SELECT id, name, ip_address AS ip, mac_addresses AS macs, power_state FROM vmware_vms')).rows.map((v) => ({ ...v, discovery: 'vmware' })),
    ...(await db.query("SELECT id, name, ip_address AS ip, mac_addresses AS macs, status AS power_state FROM proxmox_vms WHERE NOT is_template")).rows.map((v) => ({ ...v, discovery: 'proxmox' })),
  ];
  const not_in_inventory = []; const drift = []; const matchedIds = new Set();
  for (const vm of vms) {
    const c = classify(vm, idx);
    if (c.status === 'not_in_inventory') not_in_inventory.push(vm);
    else { matchedIds.add(`${c.asset.source}:${c.asset.id}`); if (c.status === 'drift') drift.push({ ...vm, ...c }); }
  }
  // Inventory VMs that discovery never saw (physical servers are excluded: they are not VMs).
  // Pages marked "exclude from reconcile" (e.g. physical servers, which are not VMs) are skipped.
  const skip = new Set((await db.query("SELECT slug FROM inventory_pages WHERE config->>'reconcile' = 'false'")).rows.map((r) => r.slug));
  const inventory_not_discovered = idx.rows.filter((a) => !skip.has(a.source) && req.user.pages.has(pageKey(a.source)) && !matchedIds.has(`${a.source}:${a.id}`)).slice(0, 500);
  res.json({ summary: { discovered: vms.length, not_in_inventory: not_in_inventory.length, drift: drift.length, inventory_not_discovered: inventory_not_discovered.length },
    not_in_inventory: not_in_inventory.slice(0, 500), drift: drift.slice(0, 500), inventory_not_discovered });
};
