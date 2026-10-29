const crypto = require('crypto');
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { unionSql } = require('../utils/inventoryUnion');
const { getSetting, setSetting } = require('../services/settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { audit } = require('../services/auditService');
const { runAsset, windowsDir } = require('../services/nessusAnsibleService');
const { bad, notFound } = require('../utils/httpError');

// One set of install settings for every location. `login_*_fields` name the record fields that hold each asset's own login.
const DEFAULTS = {
  linux_package_url: '', windows_msi_source: '', windows_dest_dir: 'C:\\Temp\\NessusAgent', manager_host: '', manager_port: 8834, groups: '', linking_key_enc: null,
  login_user_fields: 'ssh_username, username, login', login_pass_fields: 'ssh_password, password',
};
const CONCURRENCY = 4;
const JOB_TTL_MS = 60 * 60 * 1000;

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
  const { linking_key_enc, ...c } = await getSetting('nessus', DEFAULTS);
  res.json({ ...DEFAULTS, ...c, linking_key_enc: undefined, has_linking_key: !!linking_key_enc });
};
exports.putConfig = async (req, res) => {
  const cur = { ...DEFAULTS, ...(await getSetting('nessus', DEFAULTS)) };
  for (const k of ['linux_package_url', 'windows_msi_source', 'windows_dest_dir', 'manager_host', 'groups', 'login_user_fields', 'login_pass_fields']) if (req.body[k] !== undefined) cur[k] = String(req.body[k]).trim();
  if (req.body.manager_port !== undefined) cur.manager_port = parseInt(req.body.manager_port, 10) || 8834;
  if (req.body.linking_key) cur.linking_key_enc = encrypt(req.body.linking_key);
  await setSetting('nessus', cur);
  audit(req, 'update', 'nessus_config');
  res.json({ ok: true });
};

// ------------------------------------------------------------------ logins saved on each record
const names = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
/** First field of the page whose key or label matches one of the configured names. */
const findField = (fields, wanted, type) => {
  const w = names(wanted);
  return w.map((n) => fields.find((f) => (type === 'password') === (f.type === 'password') && (String(f.key).toLowerCase() === n || String(f.label || '').toLowerCase() === n))).find(Boolean);
};

/** Assets the user may use, each with the login saved on its record. Password stays encrypted until a job runs. */
async function loadTargets(user, items, cfg) {
  const out = [];
  for (const { source, id } of items) {
    if (!user.pages.has(pageKey(source))) continue;
    const { rows } = await db.query(
      `SELECT r.id, r.vm_name, r.hostname, r.ip_address, r.os_type, r.location, r.data, r.secrets, p.config
       FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id WHERE p.slug = $1 AND r.id = $2 AND r.is_deleted = FALSE AND r.is_decommissioned = FALSE`, [source, id]);
    const r = rows[0]; if (!r) continue;
    const fields = (r.config && r.config.fields) || [];
    const uf = findField(fields, cfg.login_user_fields, 'text'); const pf = findField(fields, cfg.login_pass_fields, 'password');
    const username = uf ? String(r.data[uf.key] || '').trim() : ''; const enc = pf ? r.secrets[pf.key] : null;
    let skip = null;
    if (!(r.ip_address || r.hostname)) skip = 'The record has no IP address or hostname.';
    else if (!enc) skip = 'No password is saved on the record.';
    else if (!username) skip = 'No SSH username is saved on the record.';
    out.push({
      source, id: r.id, name: r.vm_name || r.hostname || String(r.id), location: r.location || 'No location', os_type: r.os_type,
      host: r.ip_address || r.hostname, username, enc, skip, reason: skip && (enc ? 'no_username' : 'no_password'),
    });
  }
  return out;
}
const publicTarget = (t) => ({ source: t.source, id: t.id, name: t.name, location: t.location, os_type: t.os_type, username: t.username, can_run: !t.skip, skip_reason: t.skip, reason: t.reason });

exports.preview = async (req, res) => {
  const cfg = { ...DEFAULTS, ...(await getSetting('nessus', DEFAULTS)) };
  const targets = (await loadTargets(req.user, req.body.items, cfg)).map(publicTarget);
  res.json({ targets, has_windows: targets.some((t) => t.can_run && /windows/i.test(t.os_type || '')), windows_dest_dir: cfg.windows_dest_dir });
};

// ------------------------------------------------------------------ jobs (in memory; the app runs as one backend instance)
const jobs = new Map();
const prune = () => { for (const [k, j] of jobs) if (j.finished_at && Date.now() - j.finished_at > JOB_TTL_MS) jobs.delete(k); };
const view = (j) => ({
  id: j.id, mode: j.mode, status: j.status, total: j.items.length, skipped: j.items.filter((i) => i.state === 'skipped').length,
  finished: j.items.filter((i) => !['queued', 'running', 'skipped'].includes(i.state)).length,
  items: j.items.map(({ log, ...i }) => i),
});
const MESSAGES = {
  verify: { running: 'Checking for the agent', present: (v) => `Agent ${v || ''} found`.replace('  ', ' '), missing: 'No agent found on this host' },
  install: { running: 'Downloading the package, then linking to the manager', present: (v) => `Agent ${v || ''} found after install`.replace('  ', ' '), missing: 'The install ran but no agent was found afterwards' },
};
const STATE_OF = { present: 'installed', missing: 'not_installed', login_failed: 'login_failed', unreachable: 'failed', failed: 'failed' };
const FAIL_TEXT = { login_failed: 'The password saved on the record was rejected. Nothing was changed. Update it on the record, then retry.', unreachable: (m) => `Could not reach the host. ${m}` };

async function work(req, job, cfg, targets) {
  const save = (t, installed, version, error) => db.query(
    error
      ? `INSERT INTO nessus_status (source, asset_id, installed, last_checked_at, check_error) VALUES ($1,$2,FALSE, now(), $3)
         ON CONFLICT (source, asset_id) DO UPDATE SET last_checked_at = now(), check_error = EXCLUDED.check_error`
      : `INSERT INTO nessus_status (source, asset_id, installed, version, last_checked_at, check_error) VALUES ($1,$2,$4,$3, now(), NULL)
         ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, version = EXCLUDED.version, last_checked_at = now(), check_error = NULL`,
    error ? [t.source, t.id, String(error).slice(0, 300)] : [t.source, t.id, version, installed]).catch((e) => console.error('[nessus] save failed:', e.message));
  const queue = job.items.filter((i) => i.state === 'queued');
  const one = async () => {
    for (let i = queue.shift(); i; i = queue.shift()) {
      const t = targets.get(`${i.source}-${i.id}`);
      i.state = 'running'; i.started_at = Date.now(); i.message = MESSAGES[job.mode].running;
      audit(req, 'nessus_login_used', i.source, i.id, { host: t.host, username: t.username, mode: job.mode });
      let r;
      try { r = await runAsset({ host: t.host, os: /windows/i.test(t.os_type || '') ? 'windows' : 'linux', username: t.username, password: decrypt(t.enc) }, cfg, job.mode); }
      catch (e) { r = { kind: 'failed', msg: e.message, log: '' }; }
      i.finished_at = Date.now(); i.state = STATE_OF[r.kind] || 'failed'; i.log = r.log;
      if (r.kind === 'present' || r.kind === 'missing') {
        i.version = r.version; i.message = MESSAGES[job.mode][r.kind](r.version); await save(t, r.kind === 'present', r.version);
      } else {
        const f = FAIL_TEXT[r.kind]; i.message = typeof f === 'function' ? f(r.msg) : f || r.msg;
        await save(t, false, null, r.kind === 'login_failed' ? 'Login failed' : r.msg);
      }
      audit(req, job.mode === 'install' ? 'nessus_install' : 'nessus_verify', i.source, i.id, { host: t.host, result: r.kind });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, one));
  job.status = 'done'; job.finished_at = Date.now();
}

exports.startJob = async (req, res) => {
  prune();
  const mode = req.body.mode === 'install' ? 'install' : 'verify';
  const cfg = { ...DEFAULTS, ...(await getSetting('nessus', DEFAULTS)) };
  if (req.body.windows_dest_dir) cfg.windows_dest_dir = windowsDir(req.body.windows_dest_dir);
  const list = await loadTargets(req.user, req.body.items, cfg);
  if (!list.some((t) => !t.skip)) throw bad('None of the selected assets has a login saved on its record');
  const job = {
    id: crypto.randomUUID(), user_id: req.user.id, mode, status: 'running', created_at: Date.now(),
    items: list.map((t) => ({ source: t.source, id: t.id, name: t.name, location: t.location, state: t.skip ? 'skipped' : 'queued', message: t.skip || '', version: null })),
  };
  jobs.set(job.id, job);
  audit(req, 'nessus_job', 'nessus_status', null, { mode, windows_dest_dir: cfg.windows_dest_dir, assets: list.length, skipped: list.filter((t) => t.skip).length });
  work(req, job, cfg, new Map(list.map((t) => [`${t.source}-${t.id}`, t]))).catch((e) => { console.error('[nessus] job failed:', e.message); job.status = 'done'; job.finished_at = Date.now(); });
  res.status(202).json(view(job));
};

const own = (req) => { const j = jobs.get(req.params.jobId); if (!j || j.user_id !== req.user.id) throw notFound('Job not found'); return j; };
exports.getJob = async (req, res) => res.json(view(own(req)));
exports.jobLog = async (req, res) => {
  const j = own(req);
  const text = [`Nessus Agent ${j.mode} - ${new Date(j.created_at).toISOString()}`, ''].concat(j.items.map((i) => [
    `=== ${i.location} / ${i.name}: ${i.state} - ${i.message}`, i.log || '(no Ansible output)', ''].join('\n'))).join('\n');
  res.type('text/plain').attachment(`nessus-${j.mode}-${j.id.slice(0, 8)}.log`).send(text);
};
