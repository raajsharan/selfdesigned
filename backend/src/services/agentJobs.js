// Preview / run / poll / log endpoints shared by the agent deployment pages (Nessus, ManageEngine).
// Each page supplies what differs: its settings, how to run one asset, and where to save the result.
// Jobs are held in memory, so the app must run as one backend instance.
const crypto = require('crypto');
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { decrypt } = require('../utils/crypto');
const { audit } = require('./auditService');
const { bad, notFound } = require('../utils/httpError');

const CONCURRENCY = 4;
const JOB_TTL_MS = 60 * 60 * 1000;
const names = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
/** First field of the page whose key or label matches one of the configured names. */
const findField = (fields, wanted, password) => names(wanted)
  .map((n) => fields.find((f) => (f.type === 'password') === password && (String(f.key).toLowerCase() === n || String(f.label || '').toLowerCase() === n))).find(Boolean);

const FAIL_TEXT = { login_failed: 'The password saved on the record was rejected. Nothing was changed. Update it on the record, then retry.', unreachable: (m) => `Could not reach the host. ${m}` };
const STATE_OF = { present: 'installed', missing: 'not_installed', login_failed: 'login_failed', unreachable: 'failed', failed: 'failed' };

/**
 * opts:
 *   kind                  audit prefix, e.g. 'nessus'
 *   getCfg()              merged settings, including login_user_fields / login_pass_fields
 *   applyOptions(cfg, o)  validate the per-run options from the dialog and copy them onto cfg
 *   inputs(cfg, targets)  per-run inputs to show in the dialog: [{ key, label, value, hint }]
 *   installBlock(cfg, t)  reason this asset cannot be installed (e.g. no installer for its location), or null
 *   run(target, cfg, mode, password)  -> { kind, version, msg, log }
 *   save(target, result)  persist the outcome
 *   messages              { verify|install: { running, present(v), missing } }
 */
module.exports = function agentJobs(opts) {
  const jobs = new Map();
  const prune = () => { for (const [k, j] of jobs) if (j.finished_at && Date.now() - j.finished_at > JOB_TTL_MS) jobs.delete(k); };

  /** Assets the user may use, each with the login saved on its record. The password stays encrypted until a job runs. */
  async function loadTargets(user, items, cfg) {
    const out = [];
    for (const { source, id } of items) {
      if (!user.pages.has(pageKey(source))) continue;
      const { rows } = await db.query(
        `SELECT r.id, r.vm_name, r.hostname, r.ip_address, r.os_type, r.location, r.data, r.secrets, p.config
         FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id WHERE p.slug = $1 AND r.id = $2 AND r.is_deleted = FALSE AND r.is_decommissioned = FALSE`, [source, id]);
      const r = rows[0]; if (!r) continue;
      const fields = (r.config && r.config.fields) || [];
      const uf = findField(fields, cfg.login_user_fields, false); const pf = findField(fields, cfg.login_pass_fields, true);
      const username = uf ? String(r.data[uf.key] || '').trim() : ''; const enc = pf ? r.secrets[pf.key] : null;
      let skip = null;
      if (!(r.ip_address || r.hostname)) skip = 'The record has no IP address or hostname.';
      else if (!enc) skip = 'No password is saved on the record.';
      else if (!username) skip = 'No SSH username is saved on the record.';
      const t = {
        source, id: r.id, name: r.vm_name || r.hostname || String(r.id), location: r.location || 'No location', os_type: r.os_type,
        os: /windows/i.test(r.os_type || '') ? 'windows' : 'linux', host: r.ip_address || r.hostname, username, enc, skip, reason: skip && (enc ? 'no_username' : 'no_password'),
      };
      t.block = opts.installBlock ? opts.installBlock(cfg, t) : null;
      out.push(t);
    }
    return out;
  }
  const pub = (t) => ({ source: t.source, id: t.id, name: t.name, location: t.location, os_type: t.os_type, username: t.username, can_run: !t.skip, skip_reason: t.skip, reason: t.reason, install_block: t.block });

  const view = (j) => ({
    id: j.id, mode: j.mode, status: j.status, total: j.items.length, skipped: j.items.filter((i) => i.state === 'skipped').length,
    finished: j.items.filter((i) => !['queued', 'running', 'skipped'].includes(i.state)).length,
    items: j.items.map(({ log, ...i }) => i),
  });

  async function work(req, job, cfg, targets) {
    const queue = job.items.filter((i) => i.state === 'queued');
    const one = async () => {
      for (let i = queue.shift(); i; i = queue.shift()) {
        const t = targets.get(`${i.source}-${i.id}`);
        i.state = 'running'; i.started_at = Date.now(); i.message = opts.messages[job.mode].running;
        audit(req, `${opts.kind}_login_used`, i.source, i.id, { host: t.host, username: t.username, mode: job.mode });
        let r;
        try { r = await opts.run(t, cfg, job.mode, decrypt(t.enc)); } catch (e) { r = { kind: 'failed', msg: e.message, log: '' }; }
        i.finished_at = Date.now(); i.state = STATE_OF[r.kind] || 'failed'; i.log = r.log;
        i.detail = r.detail || null;
        if (r.kind === 'present' || r.kind === 'missing') { i.version = r.version; i.message = opts.messages[job.mode][r.kind](r.version, r.detail); }
        else { const f = FAIL_TEXT[r.kind]; i.message = typeof f === 'function' ? f(r.msg) : f || r.msg; }
        await Promise.resolve(opts.save(t, r)).catch((e) => console.error(`[${opts.kind}] save failed:`, e.message));
        audit(req, job.mode === 'install' ? `${opts.kind}_install` : `${opts.kind}_verify`, i.source, i.id, { host: t.host, result: r.kind });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, one));
    job.status = 'done'; job.finished_at = Date.now();
  }

  const own = (req) => { const j = jobs.get(req.params.jobId); if (!j || j.user_id !== req.user.id || j.kind !== opts.kind) throw notFound('Job not found'); return j; };

  return {
    preview: async (req, res) => {
      const cfg = await opts.getCfg();
      const list = await loadTargets(req.user, req.body.items, cfg);
      res.json({ targets: list.map(pub), inputs: opts.inputs(cfg, list.filter((t) => !t.skip && !t.block)) });
    },
    startJob: async (req, res) => {
      prune();
      const mode = req.body.mode === 'install' ? 'install' : 'verify';
      const cfg = await opts.getCfg();
      opts.applyOptions(cfg, req.body.options || {});
      const list = await loadTargets(req.user, req.body.items, cfg);
      const skipOf = (t) => t.skip || (mode === 'install' && t.block) || null;
      if (!list.some((t) => !skipOf(t))) throw bad('None of the selected assets can be run: each needs a login saved on its record' + (mode === 'install' ? ' and an installer set for its location' : ''));
      const job = {
        id: crypto.randomUUID(), kind: opts.kind, user_id: req.user.id, mode, status: 'running', created_at: Date.now(),
        items: list.map((t) => ({ source: t.source, id: t.id, name: t.name, location: t.location, state: skipOf(t) ? 'skipped' : 'queued', message: skipOf(t) || '', version: null })),
      };
      jobs.set(job.id, job);
      audit(req, `${opts.kind}_job`, opts.kind, null, { mode, options: req.body.options || {}, assets: list.length, skipped: list.filter(skipOf).length });
      work(req, job, cfg, new Map(list.map((t) => [`${t.source}-${t.id}`, t])))
        .catch((e) => { console.error(`[${opts.kind}] job failed:`, e.message); job.status = 'done'; job.finished_at = Date.now(); });
      res.status(202).json(view(job));
    },
    getJob: async (req, res) => res.json(view(own(req))),
    jobLog: async (req, res) => {
      const j = own(req);
      const text = [`${opts.kind} agent ${j.mode} - ${new Date(j.created_at).toISOString()}`, ''].concat(j.items.map((i) => [
        `=== ${i.location} / ${i.name}: ${i.state} - ${i.message}`, i.log || '(no Ansible output)', ''].join('\n'))).join('\n');
      res.type('text/plain').attachment(`${opts.kind}-${j.mode}-${j.id.slice(0, 8)}.log`).send(text);
    },
  };
};
