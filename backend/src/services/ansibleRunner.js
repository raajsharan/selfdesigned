// Shared by every agent deployment (Nessus, ManageEngine). Runs one playbook against one asset over SSH (Linux, and Windows
// through its OpenSSH Server - WinRM is left alone because other tools use it). Credentials and secrets travel in a 0600
// extra-vars file that is deleted afterwards, never on the command line, and are scrubbed from the returned log.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bad } = require('../utils/httpError');

const KNOWN_HOSTS = process.env.NESSUS_KNOWN_HOSTS || path.resolve(__dirname, '../../../var/nessus_known_hosts');
const TIMEOUT_MS = 15 * 60 * 1000;
const WIN_DIR = /^[A-Za-z]:\\(?:[A-Za-z0-9 _.-]+\\?)*$/;
const POSIX_DIR = /^\/[A-Za-z0-9 _./-]{1,200}$/;

/** A destination folder on the Windows box: a drive path, no "..", no trailing separator. */
function windowsDir(d) {
  const v = String(d || '').trim().replace(/\\+$/, '');
  if (!WIN_DIR.test(v) || v.split('\\').includes('..') || v.length > 200) throw bad('Windows destination folder must be a path like C:\\Temp\\Agent');
  return v;
}
/** A destination folder on a Linux box: an absolute path, no "..". */
function linuxDir(d) {
  const v = String(d || '').trim().replace(/\/+$/, '');
  if (!POSIX_DIR.test(v) || v.split('/').includes('..')) throw bad('Linux destination folder must be an absolute path like /tmp/agent');
  return v;
}
/** A file on this (Linux) server that Ansible will copy out. Absolute path, expected extension, must exist. */
function serverFile(p, ext, label) {
  const v = String(p || '').trim();
  if (!path.isAbsolute(v) || v.split(/[\\/]/).includes('..') || (ext && !ext.test(v))) throw bad(`${label} must be an absolute path to a file on the server${ext ? ` ending ${ext.source.replace(/[\\$]/g, '')}` : ''}`);
  let st; try { st = fs.statSync(v); } catch { throw bad(`${label} was not found on the server at ${v}`); }
  if (!st.isFile()) throw bad(`${label} is not a file: ${v}`);
  return v;
}
function httpsUrl(u, label) {
  try { if (new URL(u).protocol !== 'https:') throw new Error(); } catch { throw bad(`${label} must be an https URL`); }
  return u;
}

/** Classify Ansible's failure text so the page can say "Login failed" rather than a raw error. */
function failure(text) {
  const msg = (text || 'Ansible failed').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/permission denied|authentication (failed|failure)|auth(entication)? error|invalid credentials|unauthorized|access is denied|logon failure|401|incorrect password|sudo: .*password|missing sudo password/i.test(msg)) return { kind: 'login_failed', msg };
  if (/unreachable|timed out|no route|connection (refused|reset|closed)|name or service not known|could not resolve/i.test(msg)) return { kind: 'unreachable', msg };
  return { kind: 'failed', msg };
}

/**
 * Run `playbook` on one asset. `vars` are the playbook's own variables; `marker` names the result line the playbook prints
 * ("<MARKER>|present|1.2.3"). Resolves to { kind: 'present' | 'missing' | 'login_failed' | 'unreachable' | 'failed', version, msg, log }.
 * `asset` = { host, os: 'linux' | 'windows', username, password }.
 */
async function runPlaybook({ playbook, marker, asset, vars, secrets = [] }) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-'));
  const hide = [asset.password, ...secrets].filter(Boolean);
  const scrub = (t) => hide.reduce((s, x) => s.split(x).join('***'), String(t || ''));
  try {
    if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(asset.host)) throw bad('The asset address contains unsupported characters');
    const win = asset.os === 'windows';
    const sshArgs = `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${KNOWN_HOSTS}`;
    const conn = win
      ? { ansible_connection: 'ssh', ansible_port: 22, ansible_shell_type: 'powershell', ansible_ssh_common_args: sshArgs }
      : { ansible_connection: 'ssh', ansible_port: 22, ansible_become: true, ansible_become_password: asset.password, ansible_ssh_common_args: sshArgs };
    const all = { ...vars, ...conn, ansible_user: asset.username, ansible_password: asset.password };
    const inv = path.join(dir, 'inventory.ini'); const varsFile = path.join(dir, 'vars.json');
    await fs.promises.writeFile(inv, `[${win ? 'windows' : 'linux'}]\ntarget ansible_host=${asset.host}\n`, { mode: 0o600 });
    await fs.promises.writeFile(varsFile, JSON.stringify(all), { mode: 0o600 });
    await fs.promises.mkdir(path.dirname(KNOWN_HOSTS), { recursive: true });

    const out = await new Promise((resolve) => execFile(process.env.ANSIBLE_PLAYBOOK || 'ansible-playbook', ['-i', inv, playbook, '-e', `@${varsFile}`, '--limit', 'target'], {
      timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ANSIBLE_NOCOLOR: '1', ANSIBLE_RETRY_FILES_ENABLED: '0', ANSIBLE_LOCALHOST_WARNING: 'False' },
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
    const log = scrub(`${out.stdout}${out.stderr ? `\n${out.stderr}` : ''}`);

    if (out.err && out.err.code === 'ENOENT') return { kind: 'failed', msg: 'ansible-playbook is not installed on the server', log };
    const m = out.stdout.match(new RegExp(`${marker}\\|(present|missing)\\|([0-9.]*)(?:\\|([A-Za-z0-9=;_ -]*))?`));
    // An optional third field carries "key=value;key=value" detail, e.g. "binary=found;service=running".
    if (!out.err && m) return { kind: m[1], version: m[2] || null, detail: m[3] ? Object.fromEntries(m[3].split(';').map((x) => x.split('='))) : null, log };
    const fatal = out.stdout.match(/(?:fatal|failed): \[target\](?:: (?:UNREACHABLE|FAILED)! =>| =>)[\s\S]*?"msg": "((?:[^"\\]|\\.)*)"/);
    return { ...failure(scrub(fatal ? fatal[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : out.stderr || (out.err && out.err.message))), log };
  } catch (e) { return { kind: 'failed', msg: e.message, log: '' }; }
  finally { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { runPlaybook, windowsDir, linuxDir, serverFile, httpsUrl };
