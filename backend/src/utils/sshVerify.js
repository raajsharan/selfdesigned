const { NodeSSH } = require('node-ssh');
const { getSetting, setSetting } = require('../services/settingsService');
const { bad } = require('./httpError');

/**
 * Connect over SSH with trust-on-first-use host-key pinning. The first connection to host:port stores the
 * SHA-256 host-key fingerprint; later connections must present the same key or are refused.
 */
async function connect({ host, port = 22, username, password, privateKey }) {
  const known = await getSetting('ssh_known_hosts', {});
  const id = `${host}:${port}`;
  let seen = null;
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host, port, username, password, privateKey, readyTimeout: 15000,
      hostHash: 'sha256',
      hostVerifier: (fp) => { seen = fp; return !known[id] || known[id] === fp; },
    });
  } catch (e) {
    if (known[id] && seen && known[id] !== seen) throw bad(`Host key for ${id} changed - refusing to connect (possible interception). Clear the pinned key if the change is expected.`);
    throw bad(`SSH connection failed: ${e.message}`);
  }
  if (!known[id] && seen) { known[id] = seen; await setSetting('ssh_known_hosts', known); }
  return ssh;
}

async function run(ssh, command, { timeoutMs = 300000 } = {}) {
  const r = await ssh.execCommand(command, { execOptions: { pty: false }, ...(timeoutMs ? {} : {}) });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}
module.exports = { connect, run };
