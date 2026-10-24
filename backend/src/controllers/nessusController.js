const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { unionSql } = require('../utils/inventoryUnion');
const { getSetting, setSetting } = require('../services/settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { audit } = require('../services/auditService');
const { connect, run } = require('../utils/sshVerify');
const { linuxInstall, windowsInstall, verifyCommand } = require('../utils/winInstall');
const { bad, notFound } = require('../utils/httpError');

const DEFAULTS = { linux_package_url: '', windows_msi_url: '', manager_host: '', manager_port: 8834, groups: '', linking_key_enc: null };

exports.list = async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, COALESCE(n.installed, FALSE) AS agent_installed, n.version AS agent_version, n.last_checked_at, n.notes AS agent_notes
     FROM (${unionSql('id, vm_name, hostname, ip_address, os_type, server_status', 'is_deleted = FALSE AND is_decommissioned = FALSE')}) u
     LEFT JOIN nessus_status n ON n.source = u.source AND n.asset_id = u.id ORDER BY u.source, u.id`);
  res.json(rows.filter((r) => req.user.pages.has(pageKey(r.source))));
};

async function findRecord(req) {
  if (!req.user.pages.has(pageKey(req.params.source))) throw notFound('Record not found');
  const { rows } = await db.query(
    `SELECT r.id, r.vm_name, r.hostname, r.ip_address, r.os_type FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id
     WHERE p.slug = $1 AND r.id = $2 AND r.is_deleted = FALSE`, [req.params.source, req.params.id]);
  if (!rows[0]) throw notFound('Record not found');
  return rows[0];
}

exports.setStatus = async (req, res) => {
  await findRecord(req);
  await db.query(
    `INSERT INTO nessus_status (source, asset_id, installed, version, notes, last_checked_at) VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, version = EXCLUDED.version, notes = EXCLUDED.notes, last_checked_at = now()`,
    [req.params.source, req.params.id, !!req.body.installed, req.body.version || null, req.body.notes || null]);
  audit(req, 'update', 'nessus_status', req.params.id, { source: req.params.source, installed: !!req.body.installed });
  res.json({ ok: true });
};

exports.getConfig = async (req, res) => {
  const { linking_key_enc, ...c } = await getSetting('nessus', DEFAULTS);
  res.json({ ...c, has_linking_key: !!linking_key_enc });
};
exports.putConfig = async (req, res) => {
  const cur = await getSetting('nessus', DEFAULTS);
  for (const k of ['linux_package_url', 'windows_msi_url', 'manager_host', 'groups']) if (req.body[k] !== undefined) cur[k] = String(req.body[k]).trim();
  if (req.body.manager_port !== undefined) cur.manager_port = parseInt(req.body.manager_port, 10) || 8834;
  if (req.body.linking_key) cur.linking_key_enc = encrypt(req.body.linking_key);
  await setSetting('nessus', cur);
  audit(req, 'update', 'nessus_config');
  res.json({ ok: true });
};

/** Install (or just verify) the agent over SSH. Credentials are used for this call only and never stored. */
exports.install = async (req, res) => {
  const a = await findRecord(req);
  const host = a.ip_address || a.hostname;
  if (!host) throw bad('The asset has no IP address or hostname to connect to');
  const os = req.body.os || (/windows/i.test(a.os_type || '') ? 'windows' : 'linux');
  const cfg = await getSetting('nessus', DEFAULTS);
  const ssh = await connect({ host, port: req.body.ssh_port || 22, username: req.body.ssh_username, password: req.body.ssh_password });
  try {
    let log = null;
    if (!req.body.verify_only) {
      const cmd = os === 'windows' ? windowsInstall({ ...cfg, linking_key: decrypt(cfg.linking_key_enc) }) : linuxInstall({ ...cfg, linking_key: decrypt(cfg.linking_key_enc) });
      const r = await run(ssh, cmd);
      log = { code: r.code, stderr: String(r.stderr || '').slice(-1500) };
      if (r.code !== 0) { audit(req, 'nessus_install_failed', req.params.source, a.id, { host, code: r.code }); return res.status(502).json({ error: 'Install command failed', log }); }
    }
    const v = await run(ssh, verifyCommand(os));
    const m = String(v.stdout).match(/(\d+\.\d+\.\d+)/);
    const installed = v.code === 0 && !!m;
    await db.query(
      `INSERT INTO nessus_status (source, asset_id, installed, version, last_checked_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, version = EXCLUDED.version, last_checked_at = now()`,
      [req.params.source, a.id, installed, m ? m[1] : null]);
    audit(req, req.body.verify_only ? 'nessus_verify' : 'nessus_install', req.params.source, a.id, { host, installed });
    res.json({ ok: true, installed, version: m ? m[1] : null, log });
  } finally { ssh.dispose(); }
};
