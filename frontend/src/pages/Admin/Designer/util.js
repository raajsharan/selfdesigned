export const uid = () => Math.random().toString(36).slice(2, 9);

/** snake_case key from a label, unique within `taken` (a Set of existing keys). */
export function keyFrom(label, taken) {
  const base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 34) || 'field';
  let k = base; let n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  return k;
}

/** Remove UI-only properties (prefixed with "_") before sending to the API. */
export const stripUi = (config) => ({ ...config, fields: (config.fields || []).map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_')))) });

/** Rewrite every reference to a field key (form, table, conditions, sort) when a key is renamed or removed (newKey = null). */
export function rewriteKey(config, oldKey, newKey) {
  const c = JSON.parse(JSON.stringify(config));
  const keep = (k) => (k === oldKey ? newKey : k);
  c.fields = c.fields.filter((f) => !(newKey === null && f.key === oldKey)).map((f) => {
    const g = { ...f, key: keep(f.key) };
    if (g.showIf && g.showIf.key === oldKey) { if (newKey === null) delete g.showIf; else g.showIf = { ...g.showIf, key: newKey }; }
    if (g.dependsOn === oldKey) { if (newKey === null) delete g.dependsOn; else g.dependsOn = newKey; }
    return g;
  });
  if (c.form) c.form.sections = c.form.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, key: keep(i.key) })).filter((i) => i.key) }));
  if (c.table) {
    c.table.columns = c.table.columns.map((col) => ({ ...col, key: keep(col.key) })).filter((col) => col.key);
    c.table.filters = (c.table.filters || []).map(keep).filter(Boolean);
    if (c.table.sort && c.table.sort.key === oldKey) c.table.sort = newKey ? { ...c.table.sort, key: newKey } : { key: '_updated_at', order: 'desc' };
  }
  return c;
}

const DD_ROLE = { server_status: 'status', os_type: 'os', department: 'department', location: 'location', patching_type: 'patching_type' };
const titleOf = (c) => c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
/** Every Dropdown Master list as a ready-made choice-list field (always current: nothing is stored in the library). Lists a library field already uses are skipped. */
export const dropdownFields = (cats, libFields = []) => {
  const used = new Set(libFields.filter((f) => f.optionsCategory).map((f) => f.optionsCategory));
  return cats.filter((c) => !used.has(c)).sort().map((c) => ({ id: `dd:${c}`, fromDropdown: true, key: c, label: titleOf(c), type: 'select', optionsCategory: c, ...(DD_ROLE[c] ? { role: DD_ROLE[c] } : {}) }));
};

/** Put fields on the form (end of the last section, or a new "Details" section) so a field you add is never silently missing from New record. */
export function placeOnForm(config, fields) {
  const sections = (config.form?.sections || []).map((s) => ({ ...s, items: [...s.items] }));
  if (!sections.length) sections.push({ id: uid(), title: 'Details', columns: 2, items: [] });
  const last = sections[sections.length - 1]; const placed = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
  for (const f of fields) if (!placed.has(f.key)) last.items.push({ key: f.key, span: f.type === 'textarea' ? last.columns || 1 : 1 });
  return { ...config, form: { ...(config.form || {}), sections } };
}

/** For a Dropdown Master list whose values are linked to another list (parent value), the parent list's name: os_version -> os_type. */
export function parentCategory(category, dropdowns) {
  const parents = Object.values((dropdowns.$parents || {})[category] || {}); if (!parents.length) return null;
  const want = new Set(parents);
  return Object.keys(dropdowns).filter((k) => k !== '$parents' && k !== category).find((k) => [...want].every((v) => (dropdowns[k] || []).includes(v))) || null;
}
