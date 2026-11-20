// The standard building blocks offered when a records page is created; their field definitions come from the Field Library. Each has a role, so it takes part in the inventory-wide checks:
// IP Address (unique across EVERY page), Asset tag (unique, filled from the department's tag range), the Suggested hostname, MAC, status.
export const STANDARD = [
  { id: 'ip', label: 'IP Address', desc: 'Validated x.x.x.x and checked against every other page: no two active records anywhere can share an IP address.' },
  { id: 'tag', label: 'Asset Tag and Department', desc: 'Department list plus an Asset Tag filled from the department tag range (Department Tag Ranges), unique across all pages.' },
  { id: 'hostname', label: 'Hostname Naming', desc: 'OS Hostname, Location, OS Type and a Suggested Hostname built from Site + OS + Department (Team) + Tier + Asset Tag. Needs the Asset Tag.' },
  { id: 'mac', label: 'MAC Address', desc: 'Checked and stored as AA:BB:CC:DD:EE:FF.' },
  { id: 'status', label: 'Status', desc: 'Active / Inactive / Under Maintenance and so on, from Dropdown Master.' },
];
export const STANDARD_DEFAULT = STANDARD.map((s) => s.id);

/** Which library fields the chosen blocks need (ids of the server's standard list). Hostname Naming pulls in the Asset Tag and Department. */
export function neededFields(picked) {
  const has = (id) => picked.includes(id); const tag = has('tag') || has('hostname');
  return ['name', has('ip') && 'ip', has('mac') && 'mac', has('status') && 'status', tag && 'department', tag && 'asset_tag', has('hostname') && 'hostname', has('hostname') && 'location', has('hostname') && 'os_type', has('hostname') && 'suggest'].filter(Boolean);
}

/** The page config (fields, form, table) for the chosen standard blocks. `picked` = ids from STANDARD; Hostname Naming pulls in the Asset Tag. */
export function standardConfig(picked, F) {   // F = the field definitions from the Field Library (POST /pages/standard-fields)
  const has = (id) => picked.includes(id);
  const tag = has('tag') || has('hostname');   // the hostname needs the asset tag
  const sections = [
    { id: 'identity', title: 'Identity', columns: 2, keys: [F.name, has('hostname') && F.hostname, has('ip') && F.ip, has('mac') && F.mac] },
    { id: 'ownership', title: 'Ownership and Asset Tagging', columns: 2, keys: [(tag || has('hostname')) && F.department, has('hostname') && F.location, tag && F.asset_tag] },
    { id: 'server', title: 'Server', columns: 2, keys: [has('hostname') && F.os_type, has('status') && F.status] },
    { id: 'hostnaming', title: 'Hostname', columns: 1, keys: [has('hostname') && F.suggest] },
  ].map((s) => ({ ...s, keys: s.keys.filter(Boolean) })).filter((s) => s.keys.length);
  const fields = sections.flatMap((s) => s.keys);
  const cols = [F.name, has('ip') && F.ip, has('hostname') && F.hostname, has('status') && F.status, (tag) && F.department].filter(Boolean);
  return {
    fields,
    form: { sections: sections.map((s) => ({ id: s.id, title: s.title, columns: s.columns, items: s.keys.map((f) => ({ key: f.key, span: 1 })) })) },
    table: { columns: [...cols.map((f) => ({ key: f.key })), { key: '_updated_at' }], filters: [has('status') && F.status, tag && F.department].filter(Boolean).map((f) => f.key), pageSize: 25, sort: { key: F.name.key, order: 'asc' } },
  };
}
