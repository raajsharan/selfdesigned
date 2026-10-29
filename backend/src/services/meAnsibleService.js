// ManageEngine agent: picks the setup files for an asset's location, validates them, then runs backend/ansible/me_agent.yml.
const path = require('path');
const { bad } = require('../utils/httpError');
const { runPlaybook, windowsDir, linuxDir, serverFile } = require('./ansibleRunner');

const PLAYBOOK = path.resolve(__dirname, '../../ansible/me_agent.yml');
const ARGS = /^[A-Za-z0-9 _./:=\\-]{0,100}$/;

// What verification looks at, on each OS: the agent binary and the agent service.
const CHECK = {
  linux: { binary: '/usr/local/manageengine/uems_agent/bin/dcservice', service: 'dcservice.service' },
  windows: { binary: 'C:\\Program Files (x86)\\ManageEngine\\UEMS_Agent\\bin\\dcagentservice.exe', service: 'ManageEngine UEMS - Agent' },
};
const STATE_TEXT = { running: 'running', stopped: 'stopped', failed: 'failed', notfound: 'not found' };
const stateText = (s) => STATE_TEXT[s] || s;

const norm = (s) => String(s || '').trim().toLowerCase();
/** The setup files configured for a location: { linux_files: [paths on this server], windows_file: path } or null. */
function profileFor(cfg, location) {
  const key = Object.keys(cfg.locations || {}).find((k) => norm(k) === norm(location));
  return key ? cfg.locations[key] : null;
}
/** Why this asset cannot be installed (no setup file for its location and OS), or null. Cheap: no file access. */
function installBlock(cfg, t) {
  const p = profileFor(cfg, t.location);
  if (t.os === 'windows') return p && p.windows_file ? null : `No Windows setup file is set for ${t.location}.`;
  const files = (p && p.linux_files) || [];
  return files.some((f) => /\.bin$/i.test(f)) ? null : `No Linux setup files (.bin and serverinfo.json) are set for ${t.location}.`;
}

/** Validated playbook variables. `mode` is 'verify' or 'install'; verify needs none of the file settings. */
function deployVars(cfg, mode, t) {
  const check = { me_linux_binary: CHECK.linux.binary, me_linux_service: CHECK.linux.service, me_windows_binary: CHECK.windows.binary, me_windows_service: CHECK.windows.service };
  if (mode !== 'install') return { ...check, me_mode: 'verify' };
  const reason = installBlock(cfg, t); if (reason) throw bad(reason);
  const p = profileFor(cfg, t.location);
  if (t.os === 'windows') {
    if (!ARGS.test(cfg.windows_install_args || '')) throw bad('Windows installer arguments contain unsupported characters');
    return { ...check, me_mode: 'install', me_windows_file: serverFile(p.windows_file, /\.exe$/i, `The Windows setup file for ${t.location}`), me_windows_dest_dir: windowsDir(cfg.windows_dest_dir), me_windows_install_args: cfg.windows_install_args || '' };
  }
  if (!ARGS.test(cfg.linux_install_args || '')) throw bad('Linux installer arguments contain unsupported characters');
  const files = p.linux_files.map((f) => serverFile(f, null, `A Linux setup file for ${t.location}`));
  return { ...check, me_mode: 'install', me_linux_files: files, me_linux_dest_dir: linuxDir(cfg.linux_dest_dir), me_linux_install_args: cfg.linux_install_args || '' };
}

/**
 * `t` = { host, os, username, location }. Resolves like runPlaybook, plus `detail` = { binary: { path, found }, service: { name, state } }.
 * An agent counts as present only when the binary exists AND the service is running; a binary with a service that is not running is a
 * failed check (the agent is there but not working), reported with the service state.
 */
async function runAsset(t, password, cfg, mode) {
  let vars;
  try { vars = deployVars(cfg, mode, t); } catch (e) { return { kind: 'failed', msg: e.message, log: '' }; }
  const r = await runPlaybook({ playbook: PLAYBOOK, marker: 'ME_RESULT', asset: { host: t.host, os: t.os, username: t.username, password }, vars });
  if (!r.detail) return r;
  const c = CHECK[t.os];
  const detail = { binary: { path: c.binary, found: r.detail.binary === 'found' }, service: { name: c.service, state: r.detail.service } };
  if (r.kind === 'present' && r.detail.service !== 'running') return { ...r, kind: 'failed', msg: `The agent binary is there, but the service ${c.service} is ${stateText(r.detail.service)}.`, detail };
  return { ...r, detail };
}

module.exports = { runAsset, installBlock, profileFor, stateText };
