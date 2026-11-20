// The standard fields offered when a records page is created (IP, Asset Tag, Department, Hostname, ...) come from the Field Library.
// A library field that already means the same thing is used as it is; one that is missing is created in the library first,
// so the library is always the single source of the definitions a new page starts with.
const db = require('../config/db');
const { cleanFields } = require('./pageService');

// id -> the definition used when the library has nothing for it, and the library keys / labels that count as the same field.
const STANDARD = {
  name: { def: { key: 'vm_name', label: 'Name', type: 'text', role: 'name', required: true }, keys: ['vm_name', 'name'], labels: ['name', 'vm name'] },
  ip: { def: { key: 'ip_address', label: 'IP Address', type: 'ip', role: 'ip', required: true, hint: 'Must be unique across every page of the inventory' }, keys: ['ip_address', 'ip'], labels: ['ip address'] },
  mac: { def: { key: 'mac_address', label: 'MAC Address', type: 'mac', role: 'mac' }, keys: ['mac_address', 'mac'], labels: ['mac address'] },
  status: { def: { key: 'status', label: 'Status', type: 'select', role: 'status', optionsCategory: 'server_status' }, keys: ['status', 'server_status'], labels: ['status', 'server status'] },
  department: { def: { key: 'department', label: 'Department', type: 'select', role: 'department', optionsCategory: 'department' }, keys: ['department'], labels: ['department'] },
  asset_tag: { def: { key: 'asset_tag', label: 'Asset Tag', type: 'text', role: 'asset_tag', hint: 'Filled from the department tag range; unique across all pages' }, keys: ['asset_tag'], labels: ['asset tag'] },
  hostname: { def: { key: 'hostname', label: 'OS Hostname', type: 'text', role: 'hostname' }, keys: ['hostname', 'os_hostname'], labels: ['os hostname', 'hostname'] },
  location: { def: { key: 'location', label: 'Location', type: 'select', role: 'location', optionsCategory: 'location' }, keys: ['location'], labels: ['location'] },
  os_type: { def: { key: 'os_type', label: 'OS Type', type: 'select', role: 'os', optionsCategory: 'os_type' }, keys: ['os_type'], labels: ['os type'] },
  suggest: { def: { key: 'suggested_hostname', label: 'Suggested Hostname', type: 'hostname_suggest' }, keys: ['suggested_hostname'], labels: ['suggested hostname'] },
};
const IDS = Object.keys(STANDARD);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The library row for a standard field, if the library has one: same key first, then same label. */
function findInLibrary(std, rows) {
  const type = std.def.type;
  const ok = (r) => r.def.type === type || (type === 'select' && r.def.type === 'select');   // an IP field must not be matched to a text field of the same label
  return rows.find((r) => std.keys.includes(r.key) && ok(r)) || rows.find((r) => std.labels.includes(norm(r.def.label)) && ok(r)) || null;
}

/** The page field for a library definition: the library's own label / type / hint, plus what the standard needs (role, required, choice list). */
function pageField(std, key, def) {
  const f = { ...def, key, role: std.def.role, type: std.def.type };
  if (std.def.required) f.required = true;
  if (std.def.type === 'select' && !f.optionsCategory && !(f.options || []).length) f.optionsCategory = std.def.optionsCategory;
  if (!f.hint && std.def.hint) f.hint = std.def.hint;
  if (!std.def.role) delete f.role;
  return cleanFields([f])[0];
}

/** Resolve standard fields from the Field Library, creating the missing ones there. Returns { fields: {id: pageField}, created: [labels] }. */
async function resolveStandardFields(ids, auditFn) {
  const want = [...new Set((ids || []).filter((i) => STANDARD[i]))];
  const out = {}; const created = [];
  await db.withTx(async (client) => {
    await client.query('LOCK TABLE field_library IN SHARE ROW EXCLUSIVE MODE');   // two pages created at once must not both add the same library field
    const rows = (await client.query('SELECT id, key, def FROM field_library ORDER BY sort_order, id')).rows;
    for (const id of want) {
      const std = STANDARD[id]; let hit = findInLibrary(std, rows);
      if (!hit) {
        const { key, ...def } = cleanFields([std.def])[0];
        if (rows.some((r) => r.key === key)) {   // the key is taken by a different kind of field: use a free one
          let n = 2; let k = `${key}_${n}`; while (rows.some((r) => r.key === k)) k = `${key}_${++n}`;
          hit = { key: k, def };
        } else hit = { key, def };
        const ins = await client.query('INSERT INTO field_library (key, def, sort_order) VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM field_library)) RETURNING id', [hit.key, JSON.stringify(hit.def)]);
        rows.push({ id: ins.rows[0].id, key: hit.key, def: hit.def }); created.push(def.label);
        if (auditFn) auditFn(ins.rows[0].id, def.label);
      }
      out[id] = pageField(std, hit.key, hit.def);
    }
  });
  return { fields: out, created };
}

module.exports = { STANDARD, IDS, resolveStandardFields, findInLibrary };
