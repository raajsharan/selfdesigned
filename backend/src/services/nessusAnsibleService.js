// Nessus Agent: validates the install settings, then runs backend/ansible/nessus_agent.yml on one asset.
const path = require('path');
const { bad } = require('../utils/httpError');
const { runPlaybook, windowsDir, serverFile, httpsUrl } = require('./ansibleRunner');

const PLAYBOOK = path.resolve(__dirname, '../../ansible/nessus_agent.yml');

/** Settings the install needs, validated. `mode` is 'verify' or 'install'; verify needs none of them. */
function deployVars(cfg, mode, win) {
  if (mode !== 'install') return { nessus_mode: 'verify' };
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(cfg.manager_host || '')) throw bad('Nessus manager host is not set or invalid (Install settings)');
  if (!Number.isInteger(+cfg.manager_port) || +cfg.manager_port < 1 || +cfg.manager_port > 65535) throw bad('Nessus manager port is invalid');
  if (!/^[A-Za-z0-9]{16,128}$/.test(cfg.linking_key || '')) throw bad('Linking key is not set or invalid (Install settings)');
  if (cfg.groups && !/^[A-Za-z0-9 _.,-]{1,200}$/.test(cfg.groups)) throw bad('Agent groups contain unsupported characters');
  const v = { nessus_mode: 'install', nessus_manager_host: cfg.manager_host, nessus_manager_port: +cfg.manager_port, nessus_groups: cfg.groups || '', nessus_linking_key: cfg.linking_key };
  if (win) { v.nessus_windows_msi_src = serverFile(cfg.windows_msi_source, /\.msi$/i, 'The Windows MSI path (Install settings)'); v.nessus_windows_dest_dir = windowsDir(cfg.windows_dest_dir); }
  else v.nessus_linux_package_url = httpsUrl(cfg.linux_package_url, 'Linux package URL');
  return v;
}

/** `asset` = { host, os, username, password }. Resolves like runPlaybook. */
const runAsset = (asset, cfg, mode) => {
  try { return runPlaybook({ playbook: PLAYBOOK, marker: 'NESSUS_RESULT', asset, vars: deployVars(cfg, mode, asset.os === 'windows'), secrets: [cfg.linking_key] }); }
  catch (e) { return Promise.resolve({ kind: 'failed', msg: e.message, log: '' }); }
};

module.exports = { runAsset };
