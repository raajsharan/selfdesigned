const db = require('../config/db');
const { PAGES, pageKey } = require('../config/pages');
const { bad, notFound } = require('../utils/httpError');

// Semantic roles let cross-page features (uniqueness, decommission, reports, reconcile...) find the right field
// on any page. A field with a role is mirrored into the matching promoted column of inventory_records.
const ROLE_COLUMNS = {
  name: 'vm_name', hostname: 'hostname', ip: 'ip_address', mac: 'mac_address', asset_tag: 'asset_tag', status: 'server_status',
  os: 'os_type', department: 'department', location: 'location', owner: 'asset_owner', patching_type: 'patching_type', last_patched: 'last_patched_at',
};
const ROLE_LABELS = { name: 'Name', hostname: 'Hostname', ip: 'IP address', mac: 'MAC address', asset_tag: 'Asset tag', status: 'Status', os: 'Operating system',
  department: 'Department', location: 'Location', owner: 'Owner', patching_type: 'Patching type', last_patched: 'Last patched (date)' };
const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'password'];
const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,47}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__', 'hasownproperty']);
const ICONS = ['database', 'cloud', 'global', 'hdd', 'cluster', 'tool', 'appstore', 'team', 'safety', 'laptop', 'cloudserver', 'apartment', 'wifi', 'printer', 'api', 'folder', 'tag', 'bank', 'bug', 'star'];
const META_COLUMNS = ['_created_at', '_updated_at', '_page'];

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const intIn = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Validate + normalise the field list of a records page. */
function cleanFields(list) {
  if (!Array.isArray(list)) throw bad('fields must be a list');
  if (list.length > 200) throw bad('A page can have at most 200 fields');
  const keys = new Set(); const roles = new Set(); const out = [];
  for (const f of list) {
    const key = str(f.key, 41);
    if (!KEY_RE.test(key) || RESERVED.has(key)) throw bad(`Field key "${key}" must be lower-case letters, digits or underscores, starting with a letter`);
    if (keys.has(key)) throw bad(`Duplicate field key "${key}"`);
    keys.add(key);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const field = { key, label: str(f.label || key, 64), type };
    if (f.role) {
      if (!ROLE_COLUMNS[f.role]) throw bad(`Unknown role "${f.role}"`);
      if (roles.has(f.role)) throw bad(`Only one field can have the role "${ROLE_LABELS[f.role]}"`);
      if (f.role === 'last_patched' && type !== 'date') throw bad('The "Last patched" role needs a date field');
      if (type === 'password') throw bad('Password fields cannot have a role');
      roles.add(f.role); field.role = f.role;
    }
    if (f.required) field.required = true;
    if (f.unique) field.unique = true;
    if (f.hint) field.hint = str(f.hint, 200);
    if (type === 'select') {
      if (f.optionsCategory) field.optionsCategory = str(f.optionsCategory, 64);
      else field.options = (Array.isArray(f.options) ? f.options : []).map((o) => str(o, 120)).filter(Boolean).slice(0, 200);
      if (f.dependsOn && field.optionsCategory) field.dependsOn = str(f.dependsOn, 41);
    }
    if (f.showIf && f.showIf.key) field.showIf = { key: str(f.showIf.key, 41), value: f.showIf.value === undefined ? true : f.showIf.value };
    out.push(field);
  }
  for (const f of out) {
    if (f.dependsOn && (!keys.has(f.dependsOn) || f.dependsOn === f.key)) throw bad(`"${f.label}" depends on a field that does not exist`);
    if (f.showIf && (!keys.has(f.showIf.key) || f.showIf.key === f.key)) throw bad(`"${f.label}" is shown conditionally on a field that does not exist`);
  }
  return out;
}

function cleanForm(form, fields) {
  const keys = new Set(fields.map((f) => f.key)); const seen = new Set(); const sections = [];
  for (const [i, s] of (Array.isArray(form?.sections) ? form.sections : []).entries()) {
    const items = [];
    for (const it of Array.isArray(s.items) ? s.items : []) {
      const key = typeof it === 'string' ? it : it.key;
      if (!keys.has(key)) throw bad(`The form uses a field that does not exist: "${key}"`);
      if (seen.has(key)) throw bad(`Field "${key}" is placed on the form twice`);
      seen.add(key);
      items.push({ key, span: Math.min(3, Math.max(1, Number(it.span) || 1)) });
    }
    sections.push({ id: str(s.id || `s${i + 1}`, 24), title: str(s.title, 64), columns: intIn(s.columns, 1, 3, 2), items });
  }
  for (const f of fields) if (f.required && !f.showIf && !seen.has(f.key)) throw bad(`"${f.label}" is required, so it must be placed on the form`);
  return { sections };
}

function cleanTable(table, fields) {
  const keys = new Set([...fields.map((f) => f.key), ...META_COLUMNS]); const seen = new Set(); const columns = [];
  for (const c of Array.isArray(table?.columns) ? table.columns : []) {
    const key = typeof c === 'string' ? c : c.key;
    if (!keys.has(key) || key === '_page') throw bad(`The table uses a column that does not exist: "${key}"`);
    if (fields.find((f) => f.key === key)?.type === 'password') throw bad('Password fields cannot be table columns');
    if (seen.has(key)) continue;
    seen.add(key); columns.push({ key, width: intIn(c.width, 60, 600, 0) || undefined });
  }
  const fieldKeys = new Set(fields.filter((f) => f.type !== 'password').map((f) => f.key));
  const filters = (Array.isArray(table?.filters) ? table.filters : []).filter((k) => fieldKeys.has(k)).slice(0, 8);
  const sortKey = table?.sort?.key;
  return { columns, filters, pageSize: [10, 25, 50, 100, 200].includes(Number(table?.pageSize)) ? Number(table.pageSize) : 25,
    sort: keys.has(sortKey) && sortKey !== '_page' ? { key: sortKey, order: table.sort.order === 'asc' ? 'asc' : 'desc' } : { key: '_updated_at', order: 'desc' } };
}

/** Normalise and validate the config of a page of either kind. Throws 400 on anything unusable. */
async function cleanConfig(kind, config = {}, selfId = null) {
  if (kind === 'records') {
    const fields = cleanFields(config.fields || []);
    return { fields, form: cleanForm(config.form, fields), table: cleanTable(config.table, fields), reconcile: config.reconcile !== false };
  }
  const slugs = [...new Set((Array.isArray(config.sources) ? config.sources : []).map(String))];
  if (slugs.length > 50) throw bad('A view can combine at most 50 pages');
  if (slugs.length) {
    const { rows } = await db.query("SELECT slug FROM inventory_pages WHERE slug = ANY($1) AND kind = 'records' AND id IS DISTINCT FROM $2", [slugs, selfId]);
    const found = new Set(rows.map((r) => r.slug));
    const missing = slugs.filter((s) => !found.has(s));
    if (missing.length) throw bad(`These source pages do not exist or are not records pages: ${missing.join(', ')}`);
  }
  const seen = new Set(); const columns = [];
  for (const [i, c] of (Array.isArray(config.columns) ? config.columns : []).entries()) {
    const keys = [...new Set((Array.isArray(c.keys) ? c.keys : []).map((k) => str(k, 41)))].filter(Boolean);
    if (c.id === '_page') { if (!seen.has('_page')) { seen.add('_page'); columns.push({ id: '_page', label: str(c.label || 'Page', 64), keys: [], width: intIn(c.width, 60, 600, 0) || undefined }); } continue; }
    if (!keys.length || keys.some((k) => !KEY_RE.test(k) || RESERVED.has(k))) throw bad(`Column "${c.label || i + 1}" needs at least one valid field key`);
    const id = str(c.id || `c${i + 1}`, 24);
    if (seen.has(id)) throw bad(`Duplicate column id "${id}"`);
    seen.add(id);
    columns.push({ id, label: str(c.label || keys[0], 64), keys, width: intIn(c.width, 60, 600, 0) || undefined });
  }
  const colIds = new Set(columns.map((c) => c.id));
  return { sources: slugs, columns, filters: (Array.isArray(config.filters) ? config.filters : []).filter((id) => colIds.has(id) && id !== '_page').slice(0, 8),
    pageSize: [10, 25, 50, 100, 200].includes(Number(config.pageSize)) ? Number(config.pageSize) : 25 };
}

function validateIdentity({ slug, title, icon }) {
  if (!SLUG_RE.test(slug || '')) throw bad('Page address must be 2-48 lower-case letters, digits or hyphens, starting with a letter');
  if (!str(title, 96)) throw bad('Give the page a title');
  return { slug, title: str(title, 96), icon: ICONS.includes(icon) ? icon : 'database' };
}

async function getPageBySlug(slug) {
  const { rows } = await db.query('SELECT * FROM inventory_pages WHERE slug = $1', [slug]);
  if (!rows[0]) throw notFound('Page not found');
  return rows[0];
}
const listPages = async () => (await db.query('SELECT id, slug, title, kind, icon, description, sort_order FROM inventory_pages ORDER BY sort_order, id')).rows;

/** All access keys that currently exist: static screens plus one per designed page. */
async function allPageKeys() {
  const { rows } = await db.query('SELECT slug, title FROM inventory_pages ORDER BY sort_order, id');
  return { keys: [...PAGES, ...rows.map((r) => pageKey(r.slug))], dynamic: rows.map((r) => ({ key: pageKey(r.slug), label: r.title })) };
}

/** role -> field key, for a records page. */
const roleKeys = (page) => Object.fromEntries((page.config.fields || []).filter((f) => f.role).map((f) => [f.role, f.key]));

// Widths of the promoted columns in inventory_records (db/schema.sql); a longer value would fail the INSERT.
const COLUMN_MAX = { vm_name: 255, hostname: 255, ip_address: 64, mac_address: 64, asset_tag: 64, server_status: 64, os_type: 128,
  department: 128, location: 128, asset_owner: 255, patching_type: 64, last_patched_at: 10 };

/** Promoted-column values for a record's data (null for roles the page does not define). */
function promote(page, data) {
  const out = Object.fromEntries(Object.values(ROLE_COLUMNS).map((c) => [c, null]));
  for (const f of page.config.fields || []) {
    if (!f.role) continue;
    const v = data[f.key]; const col = ROLE_COLUMNS[f.role];
    out[col] = v === undefined || v === null || v === '' ? null : String(v).slice(0, COLUMN_MAX[col]);
  }
  return out;
}

module.exports = { ROLE_COLUMNS, ROLE_LABELS, FIELD_TYPES, ICONS, META_COLUMNS, KEY_RE, SLUG_RE, cleanConfig, validateIdentity, getPageBySlug, listPages, allPageKeys, roleKeys, promote, str };
