const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { unionSql } = require('../utils/inventoryUnion');
const { getSetting, setSetting } = require('../services/settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { audit } = require('../services/auditService');
const { runAsset } = require('../services/nessusAnsibleService');
const { windowsDir } = require('../services/ansibleRunner');
const agentJobs = require('../services/agentJobs');
const { notFound } = require('../utils/httpError');

// One set of install settings for every location. `login_*_fields` name the record fields that hold each asset's own login.
const DEFAULTS = {
  linux_package_url: '', windows_msi_source: '', windows_dest_dir: 'C:\\Temp\\NessusAgent', manager_host: '', manager_port: 8834, groups: '', linking_key_enc: null,
  login_user_fields: 'ssh_username, username, login', login_pass_fields: 'ssh_password, password',
};
const merged = async () => ({ ...DEFAULTS, ...(await getSetting('nessus', DEFAULTS)) });

exports.list = async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, COALESCE(n.installed, FALSE) AS agent_installed, n.version AS agent_version, n.last_checked_at, n.notes AS agent_notes, n.check_error,
            CASE WHEN n.last_checked_at IS NULL THEN 'not_checked' WHEN n.check_error IS NOT NULL THEN 'failed'
                 WHEN n.installed THEN 'installed' ELSE 'not_installed' END AS agent_state
     FROM (${unionSql('id, vm_name, hostname, ip_address, os_type, server_status, location', 'is_deleted = FALSE AND is_decommissioned = FALSE')}) u
     LEFT JOIN nessus_status n ON n.source = u.source AND n.asset_id = u.id ORDER BY u.source, u.id`);
  res.json(rows.filter((r) => req.user.pages.has(pageKey(r.source))));
};

exports.setStatus = async (req, res) => {
  const { rows } = await db.query(
    `SELECT 1 FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id WHERE p.slug = $1 AND r.id = $2 AND r.is_deleted = FALSE`, [req.params.source, req.params.id]);
  if (!rows[0] || !req.user.pages.has(pageKey(req.params.source))) throw notFound('Record not found');
  await db.query(
    `INSERT INTO nessus_status (source, asset_id, installed, version, notes, last_checked_at) VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, version = EXCLUDED.version, notes = EXCLUDED.notes, last_checked_at = now(), check_error = NULL`,
    [req.params.source, req.params.id, !!req.body.installed, req.body.version || null, req.body.notes || null]);
  audit(req, 'update', 'nessus_status', req.params.id, { source: req.params.source, installed: !!req.body.installed });
  res.json({ ok: true });
};

exports.getConfig = async (req, res) => {
  const { linking_key_enc, ...c } = await merged();
  res.json({ ...c, has_linking_key: !!linking_key_enc });
};
exports.putConfig = async (req, res) => {
  const cur = await merged();
  for (const k of ['linux_package_url', 'windows_msi_source', 'windows_dest_dir', 'manager_host', 'groups', 'login_user_fields', 'login_pass_fields']) if (req.body[k] !== undefined) cur[k] = String(req.body[k]).trim();
  if (req.body.manager_port !== undefined) cur.manager_port = parseInt(req.body.manager_port, 10) || 8834;
  if (req.body.linking_key) cur.linking_key_enc = encrypt(req.body.linking_key);
  await setSetting('nessus', cur);
  audit(req, 'update', 'nessus_config');
  res.json({ ok: true });
};

const done = (r) => r.kind === 'present' || r.kind === 'missing';
const save = (t, r) => db.query(
  done(r)
    ? `INSERT INTO nessus_status (source, asset_id, installed, version, last_checked_at, check_error) VALUES ($1,$2,$3,$4, now(), NULL)
       ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, version = EXCLUDED.version, last_checked_at = now(), check_error = NULL`
    : `INSERT INTO nessus_status (source, asset_id, installed, last_checked_at, check_error) VALUES ($1,$2,FALSE, now(), $3)
       ON CONFLICT (source, asset_id) DO UPDATE SET last_checked_at = now(), check_error = EXCLUDED.check_error`,
  done(r) ? [t.source, t.id, r.kind === 'present', r.version] : [t.source, t.id, String(r.kind === 'login_failed' ? 'Login failed' : r.msg).slice(0, 300)]);

const jobs = agentJobs({
  kind: 'nessus',
  getCfg: async () => { const c = await merged(); return { ...c, linking_key: decrypt(c.linking_key_enc) }; },
  applyOptions: (cfg, o) => { if (o.windows_dest_dir) cfg.windows_dest_dir = windowsDir(o.windows_dest_dir); },
  inputs: (cfg, targets) => (targets.some((t) => t.os === 'windows')
    ? [{ key: 'windows_dest_dir', label: 'Windows destination folder', value: cfg.windows_dest_dir, hint: 'The installer is copied from the shared path on the server into this folder (created if missing), then installed from there. The file is left in place.' }] : []),
  installBlock: () => null,
  run: (t, cfg, mode, password) => runAsset({ host: t.host, os: t.os, username: t.username, password }, cfg, mode),
  save,
  messages: {
    verify: { running: 'Checking for the agent', present: (v) => `Agent ${v || ''} found`.replace('  ', ' '), missing: 'No agent found on this host' },
    install: { running: 'Downloading or copying the package, then linking to the manager', present: (v) => `Agent ${v || ''} found after install`.replace('  ', ' '), missing: 'The install ran but no agent was found afterwards' },
  },
});
Object.assign(exports, { preview: jobs.preview, startJob: jobs.startJob, getJob: jobs.getJob, jobLog: jobs.jobLog });
