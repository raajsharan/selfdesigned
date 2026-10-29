// Runs backend/ansible/nessus_agent.yml against one asset. Every value reaching Ansible is validated here first; the
// credentials and linking key travel in a 0600 extra-vars file that is deleted afterwards, never on the command line.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bad } = require('../utils/httpError');

const PLAYBOOK = path.resolve(__dirname, '../../ansible/nessus_agent.yml');
const KNOWN_HOSTS = process.env.NESSUS_KNOWN_HOSTS || path.resolve(__dirname, '../../../var/nessus_known_hosts');
const TIMEOUT_MS = 15 * 60 * 1000;

function httpsUrl(u, label) {
  try { if (new URL(u).protocol !== 'https:') throw new Error(); } catch { throw bad(`${label} must be an https URL`); }
  return u;
}
const WIN_DIR = /^[A-Za-z]:\\(?:[A-Za-z0-9 _.-]+\\?)*$/;
/** A destination folder on the Windows box: a drive path, no "..", no trailing separator. */
function windowsDir(d) {
  const v = String(d || '').trim().replace(/\\+$/, '');
  if (!WIN_DIR.test(v) || v.split('\\').includes('..') || v.length > 200) throw bad('Windows destination folder must be a path like C:\\Temp\\NessusAgent');
  return v;
}
/** The MSI on the Linux server (the shared path). Must be an absolute path to an existing .msi file. */
function msiSource(p) {
  const v = String(p || '').trim();
  if (!path.isAbsolute(v) || !/\.msi$/i.test(v) || v.split(/[\\/]/).includes('..')) throw bad('Windows MSI path must be an absolute path to a .msi file on the server (Install settings)');
  let st; try { st = fs.statSync(v); } catch { throw bad(`The Windows MSI was not found on the server at ${v}`); }
  if (!st.isFile()) throw bad(`The Windows MSI path is not a file: ${v}`);
  return v;
}
/** Settings the install needs, validated. `mode` is 'verify' or 'install'; verify needs none of them. */
function deployVars(cfg, mode, win) {
  if (mode !== 'install') return { nessus_mode: 'verify' };
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(cfg.manager_host || '')) throw bad('Nessus manager host is not set or invalid (Install settings)');
  if (!Number.isInteger(+cfg.manager_port) || +cfg.manager_port < 1 || +cfg.manager_port > 65535) throw bad('Nessus manager port is invalid');
  if (!/^[A-Za-z0-9]{16,128}$/.test(cfg.linking_key || '')) throw bad('Linking key is not set or invalid (Install settings)');
  if (cfg.groups && !/^[A-Za-z0-9 _.,-]{1,200}$/.test(cfg.groups)) throw bad('Agent groups contain unsupported characters');
  const v = { nessus_mode: 'install', nessus_manager_host: cfg.manager_host, nessus_manager_port: +cfg.manager_port, nessus_groups: cfg.groups || '', nessus_linking_key: cfg.linking_key };
  if (win) { v.nessus_windows_msi_src = msiSource(cfg.windows_msi_source); v.nessus_windows_dest_dir = windowsDir(cfg.windows_dest_dir); }
  else v.nessus_linux_package_url = httpsUrl(cfg.linux_package_url, 'Linux package URL');
  return v;
}

/** Classify Ansible's failure text so the page can say "Login failed" rather than a raw error. */
function failure(text) {
  const msg = (text || 'Ansible failed').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/permission denied|authentication (failed|failure)|auth(entication)? error|invalid credentials|unauthorized|access is denied|logon failure|401|incorrect password|sudo: .*password|missing sudo password/i.test(msg)) return { kind: 'login_failed', msg };
  if (/unreachable|timed out|no route|connection (refused|reset|closed)|name or service not known|could not resolve/i.test(msg)) return { kind: 'unreachable', msg };
  return { kind: 'failed', msg };
}

/**
 * Deploy or verify the agent on one asset. Resolves to { kind: 'present' | 'missing' | 'login_failed' | 'unreachable' | 'failed', version, msg, log }.
 * `asset` = { host, os: 'linux' | 'windows', username, password }.
 */
async function runAsset(asset, cfg, mode) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nessus-'));
  const secrets = [asset.password, cfg.linking_key].filter(Boolean);
  const scrub = (t) => secrets.reduce((s, x) => s.split(x).join('***'), String(t || ''));
  try {
    if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(asset.host)) throw bad('The asset address contains unsupported characters');
    const win = asset.os === 'windows';
    const sshArgs = `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${KNOWN_HOSTS}`;
    // Both OSes use SSH (Windows through its built-in OpenSSH Server); WinRM is left alone because other tools use it.
    const conn = win
      ? { ansible_connection: 'ssh', ansible_port: 22, ansible_shell_type: 'powershell', ansible_ssh_common_args: sshArgs }
      : { ansible_connection: 'ssh', ansible_port: 22, ansible_become: true, ansible_become_password: asset.password, ansible_ssh_common_args: sshArgs };
    const vars = { ...deployVars(cfg, mode, win), ...conn, ansible_user: asset.username, ansible_password: asset.password };
    const inv = path.join(dir, 'inventory.ini'); const varsFile = path.join(dir, 'vars.json');
    await fs.promises.writeFile(inv, `[${win ? 'windows' : 'linux'}]\ntarget ansible_host=${asset.host}\n`, { mode: 0o600 });
    await fs.promises.writeFile(varsFile, JSON.stringify(vars), { mode: 0o600 });
    await fs.promises.mkdir(path.dirname(KNOWN_HOSTS), { recursive: true });

    const out = await new Promise((resolve) => execFile(process.env.ANSIBLE_PLAYBOOK || 'ansible-playbook', ['-i', inv, PLAYBOOK, '-e', `@${varsFile}`, '--limit', 'target'], {
      timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ANSIBLE_NOCOLOR: '1', ANSIBLE_RETRY_FILES_ENABLED: '0', ANSIBLE_LOCALHOST_WARNING: 'False' },
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
    const log = scrub(`${out.stdout}${out.stderr ? `\n${out.stderr}` : ''}`);

    if (out.err && out.err.code === 'ENOENT') return { kind: 'failed', msg: 'ansible-playbook is not installed on the server', log };
    const m = out.stdout.match(/NESSUS_RESULT\|(present|missing)\|([0-9.]*)/);
    if (!out.err && m) return { kind: m[1], version: m[2] || null, log };
    const fatal = out.stdout.match(/(?:fatal|failed): \[target\](?:: (?:UNREACHABLE|FAILED)! =>| =>)[\s\S]*?"msg": "((?:[^"\\]|\\.)*)"/);
    return { ...failure(scrub(fatal ? fatal[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : out.stderr || (out.err && out.err.message))), log };
  } catch (e) { return { kind: 'failed', msg: e.message, log: '' }; }
  finally { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { runAsset, windowsDir };
