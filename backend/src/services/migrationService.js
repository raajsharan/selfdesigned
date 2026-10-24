const ExcelJS = require('exceljs');
const db = require('../config/db');
const { encrypt } = require('../utils/crypto');
const { bad, notFound } = require('../utils/httpError');

const VM_STATUS = ['Pending', 'In Progress', 'Migrated', 'Blocked'];
const HOST_STAGE = ['Not Started', 'In Progress', 'Completed', 'Blocked'];
const STAGE_COLS = ['vms_vacate_status', 'proxmox_install_status', 'vm_migration_back_status'];
const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'dropdown', 'date'];
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DEFAULT_TABS = [
  { key: 'hosts',      label: 'Hosts',           type: 'hosts',      enabled: true, hidden_columns: [] },
  { key: 'bomgar',     label: 'Bomgar VMs',      type: 'bomgar',     enabled: true, hidden_columns: [], name_pattern: 'bomgar' },
  { key: 'security',   label: 'Security VMs',    type: 'security',   enabled: true, hidden_columns: [], name_pattern: '' },
  { key: 'standalone', label: 'Standalone ESXi', type: 'standalone', enabled: true, hidden_columns: [] },
];
// Route segment -> tab type used by the REST endpoints.
const KIND_TO_TYPE = { 'bomgar-vms': 'bomgar', 'security-vms': 'security', 'standalone-esxi': 'standalone', 'custom-vms': 'custom' };

function cleanTabs(tabs) {
  const seen = new Set();
  return (tabs || []).map((t) => {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(t.key || '')) throw bad(`Tab key "${t.key}" must be 2-32 lower-case letters, digits or underscores`);
    if (seen.has(t.key)) throw bad(`Duplicate tab key "${t.key}"`);
    seen.add(t.key);
    const type = ['hosts', 'bomgar', 'security', 'standalone', 'custom'].includes(t.type) ? t.type : 'custom';
    return { key: t.key, label: String(t.label || t.key).slice(0, 48), type, enabled: t.enabled !== false,
      hidden_columns: (t.hidden_columns || []).map(String).slice(0, 40), vcenter_group: t.vcenter_group ? String(t.vcenter_group).slice(0, 128) : '',
      name_pattern: t.name_pattern ? String(t.name_pattern).slice(0, 128) : '' };
  });
}

// ---------------------------------------------------------------- projects & fields
async function listProjects() { return (await db.query('SELECT * FROM migration_projects ORDER BY id')).rows; }
async function getProject(id) {
  const { rows } = await db.query('SELECT * FROM migration_projects WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Migration project not found');
  return rows[0];
}
async function createProject({ name, description }, user) {
  const { rows } = await db.query('INSERT INTO migration_projects (name, description, tabs, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, description || null, JSON.stringify(DEFAULT_TABS), user.id]);
  return rows[0];
}
async function updateProject(id, body) {
  const sets = []; const v = [];
  if (body.name !== undefined) { v.push(body.name); sets.push(`name = $${v.length}`); }
  if (body.description !== undefined) { v.push(body.description); sets.push(`description = $${v.length}`); }
  if (body.is_active !== undefined) { v.push(!!body.is_active); sets.push(`is_active = $${v.length}`); }
  if (body.tabs !== undefined) { v.push(JSON.stringify(cleanTabs(body.tabs))); sets.push(`tabs = $${v.length}`); }
  if (!sets.length) return getProject(id);
  v.push(id);
  const { rows } = await db.query(`UPDATE migration_projects SET ${sets.join(', ')} WHERE id = $${v.length} RETURNING *`, v);
  if (!rows[0]) throw notFound('Migration project not found');
  return rows[0];
}
async function deleteProject(id) { const r = await db.query('DELETE FROM migration_projects WHERE id = $1', [id]); if (!r.rowCount) throw notFound(); }

async function listCustomFields(projectId) {
  return (await db.query('SELECT * FROM migration_custom_fields WHERE project_id = $1 ORDER BY sort_order, id', [projectId])).rows;
}
async function saveCustomField(projectId, id, b) {
  if (!FIELD_TYPES.includes(b.type)) throw bad('Unsupported field type');
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(b.key || '')) throw bad('Key must be lower-case letters, digits or underscores');
  const opts = b.type === 'dropdown' ? (b.options || []).map(String).filter(Boolean).slice(0, 100) : [];
  if (b.type === 'dropdown' && !opts.length) throw bad('A dropdown field needs at least one option');
  const args = [projectId, b.key, String(b.label || b.key).slice(0, 128), b.type, JSON.stringify(opts), JSON.stringify(b.tab_keys || []), Number(b.sort_order) || 0];
  const sql = id
    ? 'UPDATE migration_custom_fields SET key=$2,label=$3,type=$4,options=$5,tab_keys=$6,sort_order=$7 WHERE project_id=$1 AND id=$8 RETURNING *'
    : 'INSERT INTO migration_custom_fields (project_id,key,label,type,options,tab_keys,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *';
  const { rows } = await db.query(sql, id ? [...args, id] : args);
  if (!rows[0]) throw notFound('Custom field not found');
  return rows[0];
}
async function deleteCustomField(projectId, id) {
  const { rows } = await db.query('DELETE FROM migration_custom_fields WHERE project_id = $1 AND id = $2 RETURNING key', [projectId, id]);
  if (!rows[0]) throw notFound();
  // Strip the orphaned values so a re-created field starts clean.
  await db.query('UPDATE migration_hosts SET custom = custom - $2 WHERE project_id = $1', [projectId, rows[0].key]);
  await db.query('UPDATE migration_vms SET custom = custom - $2 WHERE project_id = $1', [projectId, rows[0].key]);
}

function coerceCustom(def, v) {
  if (v === null || v === undefined || v === '') return null;
  switch (def.type) {
    case 'number': { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${def.label} must be a number`); return n; }
    case 'boolean': return v === true || v === 'true';
    case 'date': { const d = new Date(v); if (Number.isNaN(d.getTime())) throw bad(`${def.label} must be a date`); return d.toISOString().slice(0, 10); }
    case 'dropdown': if (!def.options.includes(String(v))) throw bad(`${def.label}: "${v}" is not an allowed option`); return String(v);
    default: return String(v).slice(0, 2000);
  }
}
async function cleanCustomPatch(projectId, patch) {
  const defs = new Map((await listCustomFields(projectId)).map((d) => [d.key, d]));
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) { const d = defs.get(k); if (!d) throw bad(`Unknown custom field "${k}"`); out[k] = coerceCustom(d, v); }
  return out;
}

// ---------------------------------------------------------------- hosts
const HOST_STATE = `CASE WHEN ${STAGE_COLS.map((c) => `${c} = 'Blocked'`).join(' OR ')} THEN 'Blocked'
  WHEN ${STAGE_COLS.map((c) => `${c} = 'Completed'`).join(' AND ')} THEN 'Migrated'
  WHEN ${STAGE_COLS.map((c) => `${c} = 'Not Started'`).join(' AND ')} THEN 'Pending' ELSE 'In Progress' END`;

const publicHost = ({ idrac_password_encrypted, ...h }) => ({ ...h, has_idrac_password: !!idrac_password_encrypted });

async function listHosts(projectId, q) {
  const p = [projectId]; const w = ['project_id = $1'];
  if (q.datacenter) { p.push(q.datacenter); w.push(`datacenter = $${p.length}`); }
  if (q.cluster) { p.push(q.cluster); w.push(`cluster = $${p.length}`); }
  if (q.state) { p.push(q.state); w.push(`(${HOST_STATE}) = $${p.length}`); }
  for (const c of STAGE_COLS) if (q[c]) { p.push(q[c]); w.push(`${c} = $${p.length}`); }
  if (q.search) { p.push(`%${String(q.search).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(host_name ILIKE $${p.length} OR idrac_ip ILIKE $${p.length} OR notes ILIKE $${p.length})`); }
  const { rows } = await db.query(`SELECT *, (${HOST_STATE}) AS state FROM migration_hosts WHERE ${w.join(' AND ')} ORDER BY host_name LIMIT 2000`, p);
  const sum = (await db.query(`SELECT state, COUNT(*)::int n FROM (SELECT (${HOST_STATE}) AS state FROM migration_hosts WHERE project_id = $1) t GROUP BY state`, [projectId])).rows;
  const n = (s) => (sum.find((r) => r.state === s) || { n: 0 }).n;
  const filters = (await db.query('SELECT array_agg(DISTINCT datacenter) FILTER (WHERE datacenter IS NOT NULL) AS datacenters, array_agg(DISTINCT cluster) FILTER (WHERE cluster IS NOT NULL) AS clusters FROM migration_hosts WHERE project_id = $1', [projectId])).rows[0];
  return { rows: rows.map(publicHost),
    summary: { total: sum.reduce((a, r) => a + r.n, 0), migrated: n('Migrated'), in_progress: n('In Progress'), blocked: n('Blocked'), pending: n('Pending'), powered_off: 0 },
    filters: { datacenters: filters.datacenters || [], clusters: filters.clusters || [] }, stages: HOST_STAGE };
}

async function patchHost(projectId, id, b, user) {
  const { rows: cur } = await db.query('SELECT * FROM migration_hosts WHERE id = $1 AND project_id = $2', [id, projectId]);
  if (!cur[0]) throw notFound('Host not found');
  const sets = []; const v = [];
  const add = (c, val) => { v.push(val); sets.push(`${c} = $${v.length}`); };
  for (const c of STAGE_COLS) if (b[c] !== undefined) { if (!HOST_STAGE.includes(b[c])) throw bad(`${c} must be one of ${HOST_STAGE.join(', ')}`); add(c, b[c]); }
  for (const c of ['notes', 'datacenter', 'cluster', 'vcenter', 'idrac_ip', 'idrac_username']) if (b[c] !== undefined) add(c, b[c] === '' ? null : String(b[c]).slice(0, 2000));
  if (b.license_expiry !== undefined) add('license_expiry', b.license_expiry || null);
  if (b.idrac_password) add('idrac_password_encrypted', encrypt(b.idrac_password));
  if (b.custom) add('custom', JSON.stringify({ ...cur[0].custom, ...(await cleanCustomPatch(projectId, b.custom)) }));
  if (!sets.length) return { before: cur[0], after: cur[0] };
  v.push(id);
  const { rows } = await db.query(`UPDATE migration_hosts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${v.length} RETURNING *`, v);
  return { before: cur[0], after: rows[0] };
}

async function createHost(projectId, b) {
  if (!b.host_name) throw bad('Host name is required');
  const { rows } = await db.query(
    `INSERT INTO migration_hosts (project_id, host_name, datacenter, cluster, vcenter, idrac_ip, license_expiry, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, b.host_name, b.datacenter || null, b.cluster || null, b.vcenter || null, b.idrac_ip || null, b.license_expiry || null, b.notes || null]);
  return publicHost(rows[0]);
}

// ---------------------------------------------------------------- VMs
async function listVms(projectId, tabKey, q) {
  const p = [projectId, tabKey]; const w = ['project_id = $1', 'tab_key = $2'];
  for (const [param, col] of [['status', 'migration_status'], ['cluster', 'cluster'], ['datacenter', 'datacenter'], ['power_state', 'power_state']]) {
    if (q[param]) { p.push(q[param]); w.push(`${col} = $${p.length}`); }
  }
  if (q.search) { p.push(`%${String(q.search).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(vm_name ILIKE $${p.length} OR ip_address ILIKE $${p.length} OR os ILIKE $${p.length} OR notes ILIKE $${p.length})`); }
  const { rows } = await db.query(`SELECT * FROM migration_vms WHERE ${w.join(' AND ')} ORDER BY vm_name LIMIT 5000`, p);
  const s = (await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE migration_status='Migrated')::int AS migrated,
            COUNT(*) FILTER (WHERE migration_status='In Progress')::int AS in_progress, COUNT(*) FILTER (WHERE migration_status='Blocked')::int AS blocked,
            COUNT(*) FILTER (WHERE migration_status='Pending')::int AS pending, COUNT(*) FILTER (WHERE lower(power_state) IN ('poweredoff','powered_off','powered off','stopped'))::int AS powered_off
     FROM migration_vms WHERE project_id = $1 AND tab_key = $2`, [projectId, tabKey])).rows[0];
  const f = (await db.query(`SELECT array_agg(DISTINCT cluster) FILTER (WHERE cluster IS NOT NULL) AS clusters, array_agg(DISTINCT datacenter) FILTER (WHERE datacenter IS NOT NULL) AS datacenters,
     array_agg(DISTINCT power_state) FILTER (WHERE power_state IS NOT NULL) AS power_states FROM migration_vms WHERE project_id = $1 AND tab_key = $2`, [projectId, tabKey])).rows[0];
  return { rows, summary: s, filters: { clusters: f.clusters || [], datacenters: f.datacenters || [], power_states: f.power_states || [] }, statuses: VM_STATUS };
}

async function patchVm(projectId, id, b, expectTabType) {
  const { rows: cur } = await db.query('SELECT * FROM migration_vms WHERE id = $1 AND project_id = $2', [id, projectId]);
  if (!cur[0]) throw notFound('VM not found');
  if (expectTabType && expectTabType !== 'custom' && cur[0].tab_key !== expectTabType) throw bad('That VM belongs to a different tab');
  const sets = []; const v = [];
  const add = (c, val) => { v.push(val); sets.push(`${c} = $${v.length}`); };
  if (b.migration_status !== undefined) { if (!VM_STATUS.includes(b.migration_status)) throw bad(`Status must be one of ${VM_STATUS.join(', ')}`); add('migration_status', b.migration_status); }
  if (b.notes !== undefined) add('notes', b.notes === '' ? null : String(b.notes).slice(0, 5000));
  if (b.custom) add('custom', JSON.stringify({ ...cur[0].custom, ...(await cleanCustomPatch(projectId, b.custom)) }));
  if (!sets.length) return { before: cur[0], after: cur[0] };
  v.push(id);
  const { rows } = await db.query(`UPDATE migration_vms SET ${sets.join(', ')}, updated_at = now() WHERE id = $${v.length} RETURNING *`, v);
  return { before: cur[0], after: rows[0] };
}

async function createVm(projectId, b) {
  if (!b.vm_name || !b.tab_key) throw bad('vm_name and tab_key are required');
  const { rows } = await db.query(
    `INSERT INTO migration_vms (project_id, tab_key, vm_name, ip_address, os, cluster, datacenter, esxi_host, power_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, b.tab_key, b.vm_name, b.ip_address || null, b.os || null, b.cluster || null, b.datacenter || null, b.esxi_host || null, b.power_state || null]);
  return rows[0];
}

// ---------------------------------------------------------------- overview
async function overview(projectId) {
  const project = await getProject(projectId);
  const vms = (await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE migration_status='Migrated')::int AS migrated, COUNT(*) FILTER (WHERE migration_status='In Progress')::int AS in_progress,
            COUNT(*) FILTER (WHERE migration_status='Blocked')::int AS blocked, COUNT(*) FILTER (WHERE migration_status='Pending')::int AS pending
     FROM migration_vms WHERE project_id = $1`, [projectId])).rows[0];
  const hosts = (await listHosts(projectId, {})).summary;
  const bySource = (await db.query(
    `SELECT tab_key, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE migration_status='Migrated')::int AS migrated,
            COUNT(*) FILTER (WHERE migration_status='In Progress')::int AS in_progress, COUNT(*) FILTER (WHERE migration_status='Blocked')::int AS blocked
     FROM migration_vms WHERE project_id = $1 GROUP BY tab_key ORDER BY tab_key`, [projectId])).rows;
  const hostsByDc = (await db.query(
    `SELECT COALESCE(datacenter,'Unassigned') AS datacenter, COUNT(*)::int AS hosts,
            COUNT(*) FILTER (WHERE (${HOST_STATE}) = 'Migrated')::int AS migrated, COUNT(*) FILTER (WHERE (${HOST_STATE}) = 'In Progress')::int AS in_progress,
            COUNT(*) FILTER (WHERE (${HOST_STATE}) = 'Blocked')::int AS blocked
     FROM migration_hosts WHERE project_id = $1 GROUP BY 1 ORDER BY 1`, [projectId])).rows;
  const expiring = (await db.query(`SELECT COUNT(*)::int n FROM migration_hosts WHERE project_id = $1 AND license_expiry IS NOT NULL AND license_expiry < current_date + 30`, [projectId])).rows[0].n;
  const units = vms.total + hosts.total;
  const done = vms.migrated + hosts.migrated;
  return { project, vms, hosts, by_source: bySource, hosts_by_datacenter: hostsByDc, licenses_expiring_30d: expiring,
    progress_percent: units ? Math.round((done / units) * 1000) / 10 : 0 };
}

// ---------------------------------------------------------------- sync from VMware discovery
async function syncFromVmware(projectId) {
  const project = await getProject(projectId);
  const out = { hosts: 0, vms: {} };
  const upsertVm = (tab, r) => db.query(
    `INSERT INTO migration_vms (project_id, tab_key, vm_name, ip_address, os, cluster, datacenter, esxi_host, power_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, tab_key, vm_name) DO UPDATE SET ip_address = EXCLUDED.ip_address, os = EXCLUDED.os, cluster = EXCLUDED.cluster,
       datacenter = EXCLUDED.datacenter, esxi_host = EXCLUDED.esxi_host, power_state = EXCLUDED.power_state, updated_at = now()`,
    [projectId, tab.key, r.name, r.ip_address, r.guest_os, r.cluster, r.datacenter, r.host_name, r.power_state]);

  for (const tab of project.tabs.filter((t) => t.enabled)) {
    const group = tab.vcenter_group ? tab.vcenter_group.toLowerCase() : null;
    if (tab.type === 'hosts') {
      const { rows } = await db.query(
        `SELECT h.name, h.cluster, h.datacenter, s.host AS vcenter FROM vmware_hosts h JOIN vmware_servers s ON s.id = h.server_id
         WHERE s.is_standalone_esxi = FALSE AND ($1::text IS NULL OR lower(h.cluster) = $1 OR lower(h.datacenter) = $1)`, [group]);
      for (const h of rows) {
        await db.query(`INSERT INTO migration_hosts (project_id, host_name, datacenter, cluster, vcenter) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (project_id, host_name) DO UPDATE SET datacenter = EXCLUDED.datacenter, cluster = EXCLUDED.cluster, vcenter = EXCLUDED.vcenter, updated_at = now()`,
          [projectId, h.name, h.datacenter, h.cluster, h.vcenter]);
        out.hosts++;
      }
      continue;
    }
    const standalone = tab.type === 'standalone';
    const pattern = tab.name_pattern ? `%${tab.name_pattern.replace(/[%_\\]/g, '\\$&')}%` : null;
    // Without a rule a managed-VM tab would match everything, so it is skipped until configured.
    if (!standalone && !pattern && !group) { out.vms[tab.key] = 0; continue; }
    const { rows } = await db.query(
      `SELECT v.* FROM vmware_vms v JOIN vmware_servers s ON s.id = v.server_id
       WHERE s.is_standalone_esxi = $1 AND ($2::text IS NULL OR v.name ILIKE $2)
         AND ($3::text IS NULL OR lower(v.cluster) = $3 OR lower(v.datacenter) = $3 OR lower(v.folder) = $3)`, [standalone, pattern, group]);
    for (const r of rows) await upsertVm(tab, r);
    out.vms[tab.key] = rows.length;
  }
  return out;
}

// ---------------------------------------------------------------- Excel import
const cellText = (c) => {
  const v = c && c.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')).trim();
  return String(v).trim();
};
const matchOf = (list, v, fallback) => list.find((x) => norm(x) === norm(v)) || fallback;

async function importWorkbook(projectId, buffer) {
  const project = await getProject(projectId);
  const defs = await listCustomFields(projectId);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw bad('Could not read the workbook - is it a valid .xlsx file?'); }
  const tabByName = new Map();
  for (const t of project.tabs) { tabByName.set(norm(t.label), t); tabByName.set(norm(t.key), t); }
  const result = { sheets: [], skipped: [] };

  for (const ws of wb.worksheets) {
    const tab = tabByName.get(norm(ws.name));
    if (!tab) { result.skipped.push(ws.name); continue; }
    const headers = {};
    ws.getRow(1).eachCell((c, n) => { headers[n] = norm(cellText(c)); });
    const get = (row, ...names) => { for (const [n, h] of Object.entries(headers)) if (names.includes(h)) return cellText(row.getCell(+n)); return ''; };
    let count = 0;
    for (let r = 2; r <= ws.rowCount && r <= 5001; r++) {
      const row = ws.getRow(r);
      const custom = {};
      for (const d of defs) {
        const raw = get(row, norm(d.label), norm(d.key));
        if (raw !== '') { try { custom[d.key] = coerceCustom(d, raw); } catch { /* ignore bad cell, keep row */ } }
      }
      if (tab.type === 'hosts') {
        const name = get(row, 'host', 'hostname', 'esxihost', 'name');
        if (!name) continue;
        await db.query(
          `INSERT INTO migration_hosts (project_id, host_name, datacenter, cluster, vcenter, vms_vacate_status, proxmox_install_status, vm_migration_back_status, idrac_ip, license_expiry, notes, custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (project_id, host_name) DO UPDATE SET datacenter = COALESCE(EXCLUDED.datacenter, migration_hosts.datacenter), cluster = COALESCE(EXCLUDED.cluster, migration_hosts.cluster),
             vms_vacate_status = EXCLUDED.vms_vacate_status, proxmox_install_status = EXCLUDED.proxmox_install_status, vm_migration_back_status = EXCLUDED.vm_migration_back_status,
             idrac_ip = COALESCE(EXCLUDED.idrac_ip, migration_hosts.idrac_ip), license_expiry = COALESCE(EXCLUDED.license_expiry, migration_hosts.license_expiry),
             notes = COALESCE(EXCLUDED.notes, migration_hosts.notes), custom = migration_hosts.custom || EXCLUDED.custom, updated_at = now()`,
          [projectId, name, get(row, 'datacenter') || null, get(row, 'cluster') || null, get(row, 'vcenter') || null,
           matchOf(HOST_STAGE, get(row, 'vmsvacate', 'vacate'), 'Not Started'), matchOf(HOST_STAGE, get(row, 'proxmoxinstall', 'proxmoxinstalled'), 'Not Started'),
           matchOf(HOST_STAGE, get(row, 'vmmigrationback', 'migrationback'), 'Not Started'), get(row, 'idracip', 'idrac') || null,
           /^\d{4}-\d{2}-\d{2}$/.test(get(row, 'licenseexpiry', 'licenseexpires')) ? get(row, 'licenseexpiry', 'licenseexpires') : null, get(row, 'notes') || null, JSON.stringify(custom)]);
      } else {
        const name = get(row, 'vmname', 'name', 'vm');
        if (!name) continue;
        await db.query(
          `INSERT INTO migration_vms (project_id, tab_key, vm_name, ip_address, os, cluster, datacenter, esxi_host, power_state, migration_status, notes, custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (project_id, tab_key, vm_name) DO UPDATE SET ip_address = COALESCE(EXCLUDED.ip_address, migration_vms.ip_address), os = COALESCE(EXCLUDED.os, migration_vms.os),
             cluster = COALESCE(EXCLUDED.cluster, migration_vms.cluster), datacenter = COALESCE(EXCLUDED.datacenter, migration_vms.datacenter),
             esxi_host = COALESCE(EXCLUDED.esxi_host, migration_vms.esxi_host), power_state = COALESCE(EXCLUDED.power_state, migration_vms.power_state),
             migration_status = EXCLUDED.migration_status, notes = COALESCE(EXCLUDED.notes, migration_vms.notes), custom = migration_vms.custom || EXCLUDED.custom, updated_at = now()`,
          [projectId, tab.key, name, get(row, 'ip', 'ipaddress') || null, get(row, 'os', 'operatingsystem', 'guestos') || null, get(row, 'cluster') || null,
           get(row, 'datacenter') || null, get(row, 'esxihost', 'host') || null, get(row, 'powerstate') || null,
           matchOf(VM_STATUS, get(row, 'status', 'migrationstatus'), 'Pending'), get(row, 'notes') || null, JSON.stringify(custom)]);
      }
      count++;
    }
    result.sheets.push({ sheet: ws.name, tab: tab.key, rows: count });
  }
  if (!result.sheets.length) throw bad(`No sheet names matched a tab. Expected names like: ${project.tabs.map((t) => t.label).join(', ')}`);
  return result;
}

module.exports = {
  VM_STATUS, HOST_STAGE, KIND_TO_TYPE, listProjects, getProject, createProject, updateProject, deleteProject,
  listCustomFields, saveCustomField, deleteCustomField, listHosts, patchHost, createHost, listVms, patchVm, createVm,
  overview, syncFromVmware, importWorkbook,
};
