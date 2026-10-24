const svc = require('../services/migrationService');
const db = require('../config/db');
const { decrypt } = require('../utils/crypto');
const { audit } = require('../services/auditService');
const teams = require('../services/teamsNotificationService');
const { bad, notFound } = require('../utils/httpError');

const pid = (req) => {
  const n = parseInt(req.query.project_id || req.body.project_id || req.params.pid, 10);
  if (!n) throw bad('project_id is required');
  return n;
};

const notifyChange = (req, project, label, name, field, from, to) =>
  teams.notify('migration_status_changed', { title: `Migration status changed: ${name}`, status: to === 'Migrated' || to === 'Completed' ? 'good' : to === 'Blocked' ? 'attention' : 'warning',
    facts: [['Project', project.name], ['Tab', label], ['Item', name], [field, `${from} -> ${to}`], ['By', req.user.email]] });

exports.projects = async (req, res) => res.json(await svc.listProjects());
exports.createProject = async (req, res) => { const p = await svc.createProject(req.body, req.user); audit(req, 'create', 'migration_project', p.id, { name: p.name }); res.status(201).json(p); };
exports.updateProject = async (req, res) => { const p = await svc.updateProject(req.params.pid, req.body); audit(req, 'update', 'migration_project', p.id, { name: p.name }); res.json(p); };
exports.deleteProject = async (req, res) => { await svc.deleteProject(req.params.pid); audit(req, 'delete', 'migration_project', req.params.pid); res.json({ ok: true }); };

exports.customFields = async (req, res) => res.json(await svc.listCustomFields(req.params.pid));
exports.saveCustomField = async (req, res) => res.status(req.params.fid ? 200 : 201).json(await svc.saveCustomField(req.params.pid, req.params.fid, req.body));
exports.deleteCustomField = async (req, res) => { await svc.deleteCustomField(req.params.pid, req.params.fid); res.json({ ok: true }); };

exports.overview = async (req, res) => res.json(await svc.overview(pid(req)));
exports.sync = async (req, res) => { const r = await svc.syncFromVmware(req.params.pid); audit(req, 'migration_sync', 'migration_project', req.params.pid, r); res.json(r); };

exports.hosts = async (req, res) => res.json(await svc.listHosts(pid(req), req.query));
exports.createHost = async (req, res) => res.status(201).json(await svc.createHost(pid(req), req.body));
exports.patchHost = async (req, res) => {
  const projectId = pid(req);
  const { before, after } = await svc.patchHost(projectId, req.params.id, req.body, req.user);
  const project = await svc.getProject(projectId);
  for (const c of ['vms_vacate_status', 'proxmox_install_status', 'vm_migration_back_status']) {
    if (before[c] !== after[c]) { notifyChange(req, project, 'Hosts', after.host_name, c.replace(/_/g, ' '), before[c], after[c]); audit(req, 'migration_status', 'migration_host', after.id, { host: after.host_name, field: c, from: before[c], to: after[c] }); }
  }
  const { idrac_password_encrypted, ...pub } = after;
  res.json({ ...pub, has_idrac_password: !!idrac_password_encrypted });
};
exports.deleteHost = async (req, res) => {
  const r = await db.query('DELETE FROM migration_hosts WHERE id = $1 AND project_id = $2', [req.params.id, pid(req)]);
  if (!r.rowCount) throw notFound('Host not found');
  audit(req, 'delete', 'migration_host', req.params.id); res.json({ ok: true });
};
exports.idracPassword = async (req, res) => {
  const { rows } = await db.query('SELECT host_name, idrac_password_encrypted FROM migration_hosts WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Host not found');
  audit(req, 'view_password', 'migration_host', req.params.id, { host: rows[0].host_name });
  res.json({ password: decrypt(rows[0].idrac_password_encrypted) });
};

/** kind = bomgar-vms | security-vms | standalone-esxi | custom-vms. Custom tabs pass ?tab=<key>. */
exports.vmsByKind = (kind) => ({
  list: async (req, res) => {
    const type = svc.KIND_TO_TYPE[kind];
    const tabKey = type === 'custom' ? req.query.tab : type;
    if (!tabKey) throw bad('tab is required for custom tabs');
    res.json(await svc.listVms(pid(req), tabKey, req.query));
  },
  patch: async (req, res) => {
    const projectId = pid(req);
    const { before, after } = await svc.patchVm(projectId, req.params.id, req.body, svc.KIND_TO_TYPE[kind]);
    if (before.migration_status !== after.migration_status) {
      const project = await svc.getProject(projectId);
      notifyChange(req, project, after.tab_key, after.vm_name, 'status', before.migration_status, after.migration_status);
      audit(req, 'migration_status', 'migration_vm', after.id, { vm: after.vm_name, from: before.migration_status, to: after.migration_status });
    }
    res.json(after);
  },
});
exports.createVm = async (req, res) => res.status(201).json(await svc.createVm(pid(req), req.body));
exports.deleteVm = async (req, res) => {
  const r = await db.query('DELETE FROM migration_vms WHERE id = $1 AND project_id = $2', [req.params.id, pid(req)]);
  if (!r.rowCount) throw notFound('VM not found');
  audit(req, 'delete', 'migration_vm', req.params.id); res.json({ ok: true });
};
exports.import = async (req, res) => {
  if (!req.file) throw bad('Attach an .xlsx file in the "file" field');
  const r = await svc.importWorkbook(pid(req), req.file.buffer);
  audit(req, 'import', 'migration', pid(req), r); res.json(r);
};
