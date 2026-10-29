// ME Status page: install settings (per location) and the install / verify jobs for the ManageEngine agent.
const db = require('../config/db');
const { getSetting, setSetting } = require('../services/settingsService');
const { audit } = require('../services/auditService');
const { runAsset, installBlock, stateText } = require('../services/meAnsibleService');
const { windowsDir, linuxDir } = require('../services/ansibleRunner');
const agentJobs = require('../services/agentJobs');
const { bad } = require('../utils/httpError');

// `locations`: { "<Location>": { linux_files: [absolute paths on this server], windows_file: absolute path } }
const DEFAULTS = {
  linux_dest_dir: '/tmp/ManageEngineAgent', windows_dest_dir: 'C:\\Temp\\ManageEngineAgent', linux_install_args: '', windows_install_args: '/silent',
  login_user_fields: 'ssh_username, username, login', login_pass_fields: 'ssh_password, password', locations: {},
};
const merged = async () => ({ ...DEFAULTS, ...(await getSetting('me_deploy', DEFAULTS)) });

/** Every location a profile can be set for: the Location dropdown plus whatever the records already use. */
async function knownLocations() {
  const { rows } = await db.query(
    `SELECT value AS v FROM dropdown_values WHERE category = 'location'
     UNION SELECT location FROM inventory_records WHERE location IS NOT NULL AND location <> '' AND is_deleted = FALSE ORDER BY 1`);
  return rows.map((r) => r.v);
}

exports.getConfig = async (req, res) => res.json({ ...(await merged()), known_locations: await knownLocations() });

exports.putConfig = async (req, res) => {
  const cur = await merged();
  for (const k of ['linux_install_args', 'windows_install_args', 'login_user_fields', 'login_pass_fields']) if (req.body[k] !== undefined) cur[k] = String(req.body[k]).trim();
  if (req.body.linux_dest_dir !== undefined) cur.linux_dest_dir = linuxDir(req.body.linux_dest_dir);
  if (req.body.windows_dest_dir !== undefined) cur.windows_dest_dir = windowsDir(req.body.windows_dest_dir);
  if (req.body.locations !== undefined) {
    const out = {};
    for (const [name, p] of Object.entries(req.body.locations || {})) {
      const linux = (Array.isArray(p.linux_files) ? p.linux_files : []).map((x) => String(x).trim()).filter(Boolean);
      const win = String(p.windows_file || '').trim();
      if (!linux.length && !win) continue;
      if (linux.length > 10) throw bad(`${name}: at most 10 Linux files`);
      for (const f of linux) if (!f.startsWith('/') || f.split('/').includes('..')) throw bad(`${name}: Linux file "${f}" must be an absolute path on this server`);
      if (linux.length && !linux.some((f) => /\.bin$/i.test(f))) throw bad(`${name}: the Linux files need the installer (.bin) as well as serverinfo.json`);
      if (win && (!/^(\/|[A-Za-z]:[\\/])/.test(win) || !/\.exe$/i.test(win) || win.split(/[\\/]/).includes('..'))) throw bad(`${name}: the Windows file must be an absolute path to an .exe on this server`);
      out[String(name).trim().slice(0, 128)] = { linux_files: linux, windows_file: win };
    }
    cur.locations = out;
  }
  await setSetting('me_deploy', cur);
  audit(req, 'update', 'me_deploy_config', null, { locations: Object.keys(cur.locations).length });
  res.json({ ok: true });
};

const done = (r) => r.kind === 'present' || r.kind === 'missing';
const save = (t, r) => db.query(
  done(r)
    ? `INSERT INTO me_agent_status (source, asset_id, installed, last_checked_at, check_error) VALUES ($1,$2,$3, now(), NULL)
       ON CONFLICT (source, asset_id) DO UPDATE SET installed = EXCLUDED.installed, last_checked_at = now(), check_error = NULL`
    : `INSERT INTO me_agent_status (source, asset_id, installed, last_checked_at, check_error) VALUES ($1,$2,FALSE, now(), $3)
       ON CONFLICT (source, asset_id) DO UPDATE SET last_checked_at = now(), check_error = EXCLUDED.check_error`,
  done(r) ? [t.source, t.id, r.kind === 'present'] : [t.source, t.id, String(r.kind === 'login_failed' ? 'Login failed' : r.msg).slice(0, 300)]);

const jobs = agentJobs({
  kind: 'me',
  getCfg: merged,
  applyOptions: (cfg, o) => {
    if (o.windows_dest_dir) cfg.windows_dest_dir = windowsDir(o.windows_dest_dir);
    if (o.linux_dest_dir) cfg.linux_dest_dir = linuxDir(o.linux_dest_dir);
  },
  inputs: (cfg, targets) => [
    ...(targets.some((t) => t.os === 'linux') ? [{ key: 'linux_dest_dir', label: 'Linux destination folder', value: cfg.linux_dest_dir, hint: 'UEMS_LinuxAgent.bin and serverinfo.json are copied here (created if missing), then the installer runs from this folder.' }] : []),
    ...(targets.some((t) => t.os === 'windows') ? [{ key: 'windows_dest_dir', label: 'Windows destination folder', value: cfg.windows_dest_dir, hint: 'The location\'s setup .exe is copied here (created if missing), then run from this folder.' }] : []),
  ],
  installBlock,
  run: (t, cfg, mode, password) => runAsset(t, password, cfg, mode),
  save,
  messages: {
    verify: { running: 'Checking the agent binary and service', present: () => 'Binary found and service running', missing: (_, d) => (d ? `Binary not found; service ${stateText(d.service.state)}` : 'No agent found on this host') },
    install: { running: 'Copying the setup files, then installing the agent', present: () => 'Installed: binary found and service running', missing: (_, d) => (d ? `The installer ran but the binary was not found; service ${stateText(d.service.state)}` : 'The installer ran but no agent was found afterwards') },
  },
});
Object.assign(exports, { preview: jobs.preview, startJob: jobs.startJob, getJob: jobs.getJob, jobLog: jobs.jobLog });
