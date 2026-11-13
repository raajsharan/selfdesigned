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
/** The login fields of a page. Names listed in the settings win; otherwise they are found by their key / label, then by being the only password field. */
function loginFields(fields, cfg) {
  const pw = fields.filter((f) => f.type === 'password');
  const txt = fields.filter((f) => f.type === 'text' || f.type === undefined);
  const hay = (f) => `${f.key} ${f.label || ''}`.toLowerCase();
  const pick = (list, ...res) => { for (const re of res) { const hit = list.find((f) => re.test(hay(f))); if (hit) return hit; } return null; };
  const password = findField(fields, cfg.login_pass_fields, true) || pick(pw, /ssh/, /login|logon/, /os |os_|admin|root|server/, /pass/) || (pw.length === 1 ? pw[0] : pw[0] || null);
  const user = findField(fields, cfg.login_user_fields, false) || pick(txt, /ssh.*user|user.*ssh/, /login.*(user|name|id)|user.*(name|id)/, /user|username|login|account/, /admin|root/);
  return { user, password };
}
const LOOK = { hostname: /host.?name/i, os: /^os$|os.?type|operating.?system/i, ip: /^ip$|ip.?addr/i };
/** The field for a role, else the field whose key or label looks right (pages often never set roles). */
const roleField = (fields, role) => fields.find((f) => f.role === role) || fields.find((f) => f.type !== 'password' && f.type !== 'hostname_suggest' && !f.role && LOOK[role].test(`${f.key} ${f.label || ''}`)) || null;
const prune = () => { for (const [k, j] of jobs) if (j.finished_at && Date.now() - j.finished_at > JOB_TTL_MS) jobs.delete(k); };

/** Why this rename cannot be run, or null. */
function problem(host, os, hostname, user, enc) {
  if (!hostname) return 'The record has no hostname to apply.';
  if (!LABEL.test(hostname)) return `"${hostname}" is not a valid host name (letters, digits and hyphens; it cannot start or end with a hyphen).`;
  if (os === 'windows' && hostname.length > 15) return `"${hostname}" is longer than 15 characters, the Windows computer-name limit.`;
  if (!host) return 'The record has no IP address to connect to.';
  if (!enc) return 'No password is saved on the record (no password field was found, or it is empty).';
  if (!user) return 'No username is saved on the record (no username field was found, or it is empty).';
  return null;
}

/** Called after a record was saved. `opt` = { reboot }. Resolves to { rename_job } or { rename_skipped: reason }. */
async function request(req, page, rec, opt, before) {
  // The stored login is a password: only someone who may view passwords can have it used, exactly as for "Reveal".
  if (!(req.user.isSuper || req.user.can_view_passwords)) return { rename_skipped: 'Renaming a host uses the password saved on the record, so it needs the "view passwords" permission.' };
  const cfg = await getSetting('hostname_pattern', {});
  if (!(cfg.rename_pages || []).includes(page.slug)) return { rename_skipped: 'Renaming hosts is not enabled for this page (Administration > Hostname Naming).' };
  const fields = page.config.fields || [];
  const { user: uf, password: pf } = loginFields(fields, cfg);
  const username = uf ? String(rec.data[uf.key] || '').trim() : ''; const enc = pf ? rec.secrets[pf.key] : null;
  const val = (role, col) => { const f = roleField(fields, role); const v = f ? rec.data[f.key] : undefined; return String(v ?? rec[col] ?? '').trim(); };
  const osType = val('os', 'os_type'); const ip = val('ip', 'ip_address');
  const os = /windows/i.test(osType) ? 'windows' : (osType ? 'linux' : null);
  const hostname = val('hostname', 'hostname');
  const why = !os ? 'The record has no OS type, so the right method (Linux or Windows) is unknown.' : problem(ip, os, hostname, username, enc);
  if (why) return { rename_skipped: why };
  // Never aim the saved credential at an address changed in this same save: it may only go to the address it was saved with.
  if (before) {
    const was = roleField(fields, 'ip'); const oldIp = String((was ? before.data[was.key] : undefined) ?? before.ip_address ?? '').trim();
    if (oldIp !== ip) return { rename_skipped: `The IP address was changed in this save (${oldIp || 'empty'} to ${ip}). Save the new address first, then apply the hostname in a second save.` };
  }
  prune();
  const reboot = cfg.allow_reboot !== false && opt && opt.reboot !== false;
  const job = { id: crypto.randomUUID(), user_id: req.user.id, status: 'running', state: 'running', message: `Renaming the host to ${hostname}…`, log: '', created_at: Date.now() };
  jobs.set(job.id, job);
  audit(req, 'hostname_rename_login_used', `page:${page.slug}`, rec.id, { host: ip, username, hostname });
  runPlaybook({ playbook: PLAYBOOK, marker: 'HOSTNAME_RESULT', asset: { host: ip, os, username, password: decrypt(enc) }, vars: { new_hostname: hostname, rename_reboot: reboot } })
    .then((r) => {
      job.log = r.log || '';
      if (r.kind === 'present') {
        const d = r.detail || {};
        job.state = 'done';
        job.message = `${d.changed === 'no' ? `The host already had the name ${hostname}.` : `Host renamed to ${hostname}.`}${d.rebooted === 'yes' ? ' It was rebooted to apply the name.' : d.reboot === 'needed' ? ' A reboot is still required to apply the name.' : ''}`;
      } else { job.state = 'failed'; job.message = r.kind === 'login_failed' ? 'The password saved on the record was rejected. Nothing was changed.' : r.msg; }
      audit(req, 'hostname_rename', `page:${page.slug}`, rec.id, { host: ip, hostname, result: job.state });
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
