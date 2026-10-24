const svc = require('../services/endpointCentralService');
const db = require('../config/db');
const { unionSql } = require('../utils/inventoryUnion');
const { audit } = require('../services/auditService');

exports.agents = async (req, res) => res.json(await svc.listAgents({ force: req.query.refresh === '1' }));
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
    try { agents = await svc.listAgents(); } catch (e) { error = e.message; }
  } else error = 'Endpoint Central is not configured or the session has expired';
  const short = (n) => String(n || '').trim().toLowerCase().split('.')[0];
  const macK = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const byName = new Map(agents.map((a) => [short(a.name), a])); const byIp = new Map(agents.filter((a) => a.ip_address).map((a) => [a.ip_address, a]));
  const byMac = new Map(agents.filter((a) => a.mac_address).map((a) => [macK(a.mac_address), a]));
  const { rows } = await db.query(`SELECT * FROM (${unionSql('id, vm_name, hostname, ip_address, mac_address, os_type, server_status', 'is_deleted = FALSE AND is_decommissioned = FALSE')}) t ORDER BY source, id`);
  res.json({ configured: !error, error, rows: rows.filter((a) => req.user.pages.has(`page:${a.source}`)).map((a) => {
    const m = byMac.get(macK(a.mac_address)) || byName.get(short(a.hostname)) || byName.get(short(a.vm_name)) || byIp.get(a.ip_address);
    return { ...a, agent_status: !error ? (m ? (m.status === 'Live' ? 'Healthy' : m.status) : 'Not installed') : 'Unknown', agent_version: m ? m.agent_version : null, last_contact: m ? m.last_contact : null };
  }) });
};
