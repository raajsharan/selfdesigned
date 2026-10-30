const svc = require('../services/endpointCentralService');
const db = require('../config/db');
const { unionSql } = require('../utils/inventoryUnion');
const { audit } = require('../services/auditService');
const groups = require('../services/ecGroupService');
const { bad } = require('../utils/httpError');

const macKey = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
const shortName = (n) => String(n || '').trim().toLowerCase().split('.')[0];
/** Found / not found in our records: MAC first, then IP, then host name. Returns (item) => boolean. */
async function inventoryMatcher() {
  const { rows } = await db.query(unionSql('hostname, vm_name, ip_address, mac_address', 'is_deleted = FALSE'));
  const macs = new Set(); const ips = new Set(); const names = new Set();
  for (const r of rows) { if (macKey(r.mac_address)) macs.add(macKey(r.mac_address)); if (r.ip_address) ips.add(r.ip_address); [r.hostname, r.vm_name].forEach((n) => n && names.add(shortName(n))); }
  return (x) => (macKey(x.mac_address) && macs.has(macKey(x.mac_address))) || (x.ip_address && ips.has(x.ip_address)) || (!!x.name && names.has(shortName(x.name)));
}
const lower = (v) => String(v || '').toLowerCase();

/** Computers with live / agent status and their custom groups. Filtered and paged here so a large estate stays fast. */
exports.computers = async (req, res) => {
  const q = req.query; const all = await svc.listComputers({ force: q.refresh === '1' });
  const idx = await groups.membershipIndex();
  const withGroups = all.map((c) => ({ ...c, groups: (c.resource_id !== null && idx.byId.get(String(c.resource_id))) || idx.byName.get(idx.short(c.name)) || [] }));
  const summary = { total: withGroups.length, live: 0, down: 0, unknown: 0, not_installed: 0, failed: 0 };
  for (const c of withGroups) {
    if (c.live_status === 1) summary.live++; else if (c.live_status === 2) summary.down++; else summary.unknown++;
    if (c.agent_install_status === 21) summary.not_installed++; else if (c.agent_install_status === 29) summary.failed++;
  }
  const needle = lower(q.q).trim(); const gid = q.group;
  const rows = withGroups.filter((c) => (!needle || [c.name, c.ip_address, c.mac_address, c.os, c.branch_office].some((v) => lower(v).includes(needle)))
    && (!q.live || String(c.live_status) === q.live) && (!q.install || String(c.agent_install_status) === q.install)
    && (!q.office || (q.office === '(none)' ? !c.branch_office : c.branch_office === q.office))
    && (!gid || (gid === 'none' ? !c.groups.length : c.groups.some((g) => String(g.id) === gid))));
  const pageSize = Math.min(500, Math.max(10, parseInt(q.pageSize, 10) || 50)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, summary, groups_synced: idx.synced,
    offices: [...new Set(withGroups.map((c) => c.branch_office).filter(Boolean))].sort() });
};

exports.groups = async (req, res) => res.json({ groups: await groups.listGroups(), sync: groups.progress(), auto: await groups.scheduler.getSettings() });
exports.groupMembers = async (req, res) => {
  const rows = await groups.groupMembers(req.params.id); const found = await inventoryMatcher();
  res.json(rows.map((m) => ({ ...m, in_inventory: !!found({ name: m.name }) })));
};
exports.syncStart = async (req, res) => {
  const { progress } = groups.startSync({ force: req.body.force === true });
  audit(req, 'endpoint_central_group_sync', 'endpoint_central', null, { force: req.body.force === true });
  res.status(202).json(progress);
};
exports.syncState = async (req, res) => res.json(groups.progress());
exports.putAutoSync = async (req, res) => {
  const s = await groups.scheduler.saveSettings(req.body); audit(req, 'update', 'endpoint_central_group_autosync', null, { enabled: s.enabled, interval_minutes: s.interval_minutes }); res.json(s);
};
exports.staged = async (req, res) => {
  const status = parseInt(req.query.status || '3', 10);
  if (![1, 2, 3].includes(status)) throw bad('status must be 1 (approved), 2 (denied) or 3 (pending)');
  const rows = await svc.listStaged(status, { force: req.query.refresh === '1' }); const found = await inventoryMatcher();
  res.json(rows.map((r) => ({ ...r, in_inventory: !!found(r) })));
};

exports.software = async (req, res) => res.json(await svc.listSoftware());
exports.getConfig = async (req, res) => res.json(await svc.getConfig());
exports.putConfig = async (req, res) => { const c = await svc.saveConfig(req.body); audit(req, 'update', 'endpoint_central_config', null, { auth_mode: c.auth_mode }); res.json(c); };
exports.test = async (req, res) => { await svc.testConnection(); res.json({ ok: true }); };
exports.login = async (req, res) => { const r = await svc.login(req.user.id); audit(req, 'endpoint_central_login', 'endpoint_central', null, { otp_required: r.otp_required }); res.json(r); };
exports.otp = async (req, res) => { const r = await svc.submitOtp(req.user.id, req.body.otp); audit(req, 'endpoint_central_login', 'endpoint_central', null, { otp: true }); res.json(r); };

/** Inventory assets annotated with their ManageEngine agent state (matched on hostname / IP / MAC). */
exports.softwareStatus = async (req, res) => {
  const cfg = await svc.getConfig();
  let agents = []; let error = null;
  if (cfg.base_url && (cfg.has_api_key || cfg.session_active)) {
    try { agents = await svc.listComputers(); } catch (e) { error = e.message; }
  } else error = 'Endpoint Central is not configured or the session has expired';
  const short = (n) => String(n || '').trim().toLowerCase().split('.')[0];
  const macK = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const byName = new Map(agents.map((a) => [short(a.name), a])); const byIp = new Map(agents.filter((a) => a.ip_address).map((a) => [a.ip_address, a]));
  const byMac = new Map(agents.filter((a) => a.mac_address).map((a) => [macK(a.mac_address), a]));
  const { rows } = await db.query(
    `SELECT t.*, l.installed AS local_installed, l.last_checked_at AS local_checked_at, l.check_error AS local_error
     FROM (${unionSql('id, vm_name, hostname, ip_address, mac_address, os_type, server_status, location', 'is_deleted = FALSE AND is_decommissioned = FALSE')}) t
     LEFT JOIN me_agent_status l ON l.source = t.source AND l.asset_id = t.id ORDER BY t.source, t.id`);
  res.json({ configured: !error, error, rows: rows.filter((a) => req.user.pages.has(`page:${a.source}`)).map((a) => {
    const m = byMac.get(macK(a.mac_address)) || byName.get(short(a.hostname)) || byName.get(short(a.vm_name)) || byIp.get(a.ip_address);
    // Endpoint Central is the source of truth when it knows the asset; otherwise fall back to our own last check.
    let state;
    if (m && m.status !== 'Unknown') state = m.status === 'Live' ? 'healthy' : 'down';
    else if (a.local_error) state = 'failed';
    else if (a.local_installed) state = 'installed';
    else if (!error || a.local_checked_at) state = 'not_installed';
    else state = 'not_checked';
    return {
      ...a, agent_state: state, agent_status: m ? (m.status === 'Live' ? 'Healthy' : m.status) : null, agent_version: m ? m.agent_version : null,
      last_contact: m ? m.last_contact : null, last_checked_at: a.local_checked_at, check_error: a.local_error, in_ec: !!m,
    };
  }) });
};
