// Renames a host with Ansible when a record is saved with "Apply to the host" ticked. The login comes from the record itself
// (same convention as the agent deployments). Runs in the background; the form polls the job.
const crypto = require('crypto');
const path = require('path');
const { decrypt } = require('../utils/crypto');
const { getSetting } = require('./settingsService');
const { runPlaybook } = require('./ansibleRunner');
const { audit } = require('./auditService');
const { notFound } = require('../utils/httpError');

const PLAYBOOK = path.resolve(__dirname, '../../ansible/rename_host.yml');
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const JOB_TTL_MS = 60 * 60 * 1000;
const jobs = new Map();   // in memory: the backend runs as one instance
const names = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const findField = (fields, wanted, password) => names(wanted).map((n) => fields.find((f) => (f.type === 'password') === password && (String(f.key).toLowerCase() === n || String(f.label || '').toLowerCase() === n))).find(Boolean);
const prune = () => { for (const [k, j] of jobs) if (j.finished_at && Date.now() - j.finished_at > JOB_TTL_MS) jobs.delete(k); };

/** Why this rename cannot be run, or null. */
function problem(host, os, hostname, user, enc) {
  if (!hostname) return 'The record has no hostname to apply.';
  if (!LABEL.test(hostname)) return `"${hostname}" is not a valid host name (letters, digits and hyphens; it cannot start or end with a hyphen).`;
  if (os === 'windows' && hostname.length > 15) return `"${hostname}" is longer than 15 characters, the Windows computer-name limit.`;
  if (!host) return 'The record has no IP address to connect to.';
  if (!enc) return 'No password is saved on the record.';
  if (!user) return 'No SSH username is saved on the record.';
  return null;
}

/** Called after a record was saved. `opt` = { reboot }. Resolves to { rename_job } or { rename_skipped: reason }. */
async function request(req, page, rec, opt) {
  const cfg = await getSetting('hostname_pattern', {});
  if (!(cfg.rename_pages || []).includes(page.slug)) return { rename_skipped: 'Renaming hosts is not enabled for this page (Administration > Hostname Naming).' };
  const fields = page.config.fields || [];
  const uf = findField(fields, cfg.login_user_fields || 'ssh_username, username, login', false); const pf = findField(fields, cfg.login_pass_fields || 'ssh_password, password', true);
  const username = uf ? String(rec.data[uf.key] || '').trim() : ''; const enc = pf ? rec.secrets[pf.key] : null;
  const os = /windows/i.test(rec.os_type || '') ? 'windows' : (rec.os_type ? 'linux' : null);
  const hostname = String(rec.hostname || '').trim();
  const why = !os ? 'The record has no OS type, so the right method (Linux or Windows) is unknown.' : problem(rec.ip_address, os, hostname, username, enc);
  if (why) return { rename_skipped: why };
  prune();
  const reboot = cfg.allow_reboot !== false && opt && opt.reboot !== false;
  const job = { id: crypto.randomUUID(), user_id: req.user.id, status: 'running', state: 'running', message: `Renaming the host to ${hostname}…`, log: '', created_at: Date.now() };
  jobs.set(job.id, job);
  audit(req, 'hostname_rename_login_used', `page:${page.slug}`, rec.id, { host: rec.ip_address, username, hostname });
  runPlaybook({ playbook: PLAYBOOK, marker: 'HOSTNAME_RESULT', asset: { host: rec.ip_address, os, username, password: decrypt(enc) }, vars: { new_hostname: hostname, rename_reboot: reboot } })
    .then((r) => {
      job.log = r.log || '';
      if (r.kind === 'present') {
        const d = r.detail || {};
        job.state = 'done';
        job.message = `${d.changed === 'no' ? `The host already had the name ${hostname}.` : `Host renamed to ${hostname}.`}${d.rebooted === 'yes' ? ' It was rebooted to apply the name.' : d.reboot === 'needed' ? ' A reboot is still required to apply the name.' : ''}`;
      } else { job.state = 'failed'; job.message = r.kind === 'login_failed' ? 'The password saved on the record was rejected. Nothing was changed.' : r.msg; }
      audit(req, 'hostname_rename', `page:${page.slug}`, rec.id, { host: rec.ip_address, hostname, result: job.state });
    })
    .catch((e) => { job.state = 'failed'; job.message = e.message; })
    .finally(() => { job.status = 'done'; job.finished_at = Date.now(); });
  return { rename_job: job.id };
}

const getJob = (req) => {
  const j = jobs.get(req.params.jobId);
  if (!j || j.user_id !== req.user.id) throw notFound('Job not found');
  return { id: j.id, status: j.status, state: j.state, message: j.message };
};

module.exports = { request, getJob };
