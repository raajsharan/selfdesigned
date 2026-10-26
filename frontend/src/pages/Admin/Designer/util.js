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
