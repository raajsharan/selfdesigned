// End-to-end smoke tests against a running server.
//   BASE_URL=http://localhost:4000 TEST_EMAIL=... TEST_PASSWORD=... npm test
// Use a throw-away database: the tests create real rows. There are no built-in inventories, so the suite
// designs its own pages through the API first.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const SUPER = { email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD };
const run = Date.now().toString(36);
let ipCounter = 0;
const uip = () => { const t = (Date.now() & 0xffffff) + (ipCounter++); return `10.${(t >> 16) & 255}.${(t >> 8) & 255}.${t & 255}`; };
const RB = (Date.now() ^ (process.pid << 8)) & 0xffffff;
const hx = (n) => (n & 255).toString(16).toUpperCase().padStart(2, '0');
const mac = (n) => `AA:BB:${hx(RB >> 16)}:${hx(RB >> 8)}:${hx(RB)}:${hx(n)}`;

async function api(method, path, { token, body, form } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv etc. */ }
  return { status: r.status, json, text };
}
const S = {};   // shared state across ordered tests

/** A rich "asset-like" page: the kind of layout an administrator would build. */
const assetConfig = () => ({
  fields: [
    { key: 'vm_name', label: 'Machine Name', type: 'text', role: 'name' },
    { key: 'hostname', label: 'Hostname', type: 'text', role: 'hostname' },
    { key: 'asset_tag', label: 'Asset Tag', type: 'text', role: 'asset_tag', unique: false },
    { key: 'status', label: 'Status', type: 'select', role: 'status', optionsCategory: 'server_status' },
    { key: 'ip', label: 'IP Address', type: 'text', role: 'ip' },
    { key: 'mac', label: 'MAC Address', type: 'text', role: 'mac', required: true },
    { key: 'department', label: 'Department', type: 'select', role: 'department', optionsCategory: 'department' },
    { key: 'patched', label: 'Last Patched', type: 'date', role: 'last_patched' },
    { key: 'serial_no', label: 'Serial No', type: 'text', unique: true },
    { key: 'idrac', label: 'iDRAC Enabled', type: 'boolean' },
    { key: 'idrac_ip', label: 'iDRAC IP', type: 'text', showIf: { key: 'idrac', value: true } },
    { key: 'root_pw', label: 'Root Password', type: 'password' },
    { key: 'ram_gb', label: 'RAM (GB)', type: 'number' },
  ],
  form: { sections: [
    { id: 'id', title: 'Identity', columns: 2, items: [{ key: 'vm_name' }, { key: 'hostname' }, { key: 'asset_tag' }, { key: 'status' }, { key: 'serial_no' }] },
    { id: 'net', title: 'Network', columns: 2, items: [{ key: 'ip' }, { key: 'mac' }] },
    { id: 'own', title: 'Ownership', columns: 2, items: [{ key: 'department' }, { key: 'patched' }, { key: 'ram_gb' }] },
    { id: 'hw', title: 'Hardware', columns: 2, items: [{ key: 'idrac' }, { key: 'idrac_ip' }, { key: 'root_pw' }] },
  ] },
  table: { columns: [{ key: 'vm_name' }, { key: 'ip' }, { key: 'mac' }, { key: 'status' }, { key: 'department' }, { key: '_updated_at' }], filters: ['status', 'department'], pageSize: 25, sort: { key: 'vm_name', order: 'asc' } },
});
/** A second page that names the same things differently, to prove cross-page matching works by role. */
const otherConfig = () => ({
  fields: [
    { key: 'device', label: 'Device', type: 'text', role: 'name' },
    { key: 'address', label: 'Address', type: 'text', role: 'ip' },
    { key: 'hw_addr', label: 'MAC', type: 'text', role: 'mac' },
    { key: 'tag', label: 'Tag', type: 'text', role: 'asset_tag' },
    { key: 'state', label: 'State', type: 'text', role: 'status' },
  ],
  form: { sections: [{ id: 's1', title: 'Details', columns: 1, items: ['device', 'address', 'hw_addr', 'tag', 'state'].map((key) => ({ key })) }] },
  table: { columns: ['device', 'address', 'state'].map((key) => ({ key })), filters: [], pageSize: 25, sort: { key: 'device', order: 'asc' } },
});

test('login and profile', async () => {
  assert.ok(SUPER.email && SUPER.password, 'set TEST_EMAIL and TEST_PASSWORD');
  assert.equal((await api('POST', '/auth/login', { body: { email: SUPER.email, password: 'wrong-Pass1' } })).status, 401);
  const r = await api('POST', '/auth/login', { body: SUPER });
  assert.equal(r.status, 200);
  S.su = r.json.token;
  assert.equal(r.json.user.role, 'superadmin');
  assert.ok(r.json.pages.includes('admin-pages'));
  assert.ok(!r.json.pages.some((p) => /^(assets|ext-assets|beijing-assets|physical-esxi)$/.test(p)), 'no built-in inventories exist');
  assert.equal((await api('GET', '/auth/me')).status, 401);
});

test('roles: users are created, superadmin is hidden from non-superadmins', async () => {
  const pw = 'Passw0rdOK';
  assert.equal((await api('POST', '/users', { token: S.su, body: { email: `admin-${run}@example.com`, password: pw, role: 'admin', can_view_passwords: true } })).status, 201);
  assert.equal((await api('POST', '/users', { token: S.su, body: { email: `view-${run}@example.com`, password: pw, role: 'viewer' } })).status, 201);
  assert.equal((await api('POST', '/users', { token: S.su, body: { email: `weak-${run}@example.com`, password: 'short', role: 'viewer' } })).status, 400);
  S.admin = (await api('POST', '/auth/login', { body: { email: `admin-${run}@example.com`, password: pw } })).json.token;
  S.viewer = (await api('POST', '/auth/login', { body: { email: `view-${run}@example.com`, password: pw } })).json.token;
  const list = await api('GET', '/users', { token: S.admin });
  assert.ok(!list.json.some((u) => u.role === 'superadmin'), 'superadmin leaked to admin');
  const su = (await api('GET', '/users', { token: S.su })).json.find((u) => u.role === 'superadmin');
  assert.equal((await api('PUT', `/users/${su.id}`, { token: S.admin, body: { full_name: 'x' } })).status, 404);
  assert.equal((await api('POST', '/users', { token: S.admin, body: { email: `esc-${run}@example.com`, password: pw, role: 'superadmin' } })).status, 403);
  assert.equal((await api('GET', '/users', { token: S.viewer })).status, 403);
});

test('page designer: validation, creation, permissions', async () => {
  const mk = (over) => api('POST', '/pages', { token: S.admin, body: { slug: `bad-${run}`, title: 'T', kind: 'records', config: { fields: [{ key: 'a', label: 'A', type: 'text' }], form: { sections: [{ items: [{ key: 'a' }] }] }, table: { columns: [{ key: 'a' }] } }, ...over } });
  assert.equal((await mk({ slug: 'Bad Slug' })).status, 400, 'slug format');
  assert.equal((await mk({ title: '' })).status, 400, 'title required');
  const f = (fields, extra = {}) => mk({ config: { fields, form: { sections: [] }, table: { columns: [] }, ...extra } });
  assert.equal((await f([{ key: 'Bad-Key', label: 'x', type: 'text' }])).status, 400, 'field key format');
  assert.equal((await f([{ key: 'constructor', label: 'x', type: 'text' }])).status, 400, 'reserved key');
  assert.equal((await f([{ key: 'a', label: 'x', type: 'text' }, { key: 'a', label: 'y', type: 'text' }])).status, 400, 'duplicate key');
  assert.equal((await f([{ key: 'a', label: 'x', type: 'text', role: 'ip' }, { key: 'b', label: 'y', type: 'text', role: 'ip' }])).status, 400, 'role used twice');
  assert.equal((await f([{ key: 'a', label: 'x', type: 'text', required: true }])).status, 400, 'required field must be on the form');
  assert.equal((await f([{ key: 'a', label: 'x', type: 'text' }], { table: { columns: [{ key: 'ghost' }] } })).status, 400, 'unknown table column');
  assert.equal((await f([{ key: 'a', label: 'x', type: 'text', showIf: { key: 'nope', value: true } }])).status, 400, 'showIf must point at a field');
  assert.equal((await f([{ key: 'pw', label: 'x', type: 'password', role: 'name' }])).status, 400, 'password field cannot have a role');
  assert.equal((await mk({ slug: `ok-${run}` })).status, 201);
  assert.equal((await api('POST', '/pages', { token: S.viewer, body: { slug: `v-${run}`, title: 'x' } })).status, 403, 'viewers cannot design pages');

  const a = await api('POST', '/pages', { token: S.admin, body: { slug: `servers-${run}`, title: 'Servers', icon: 'cloud', kind: 'records', config: assetConfig() } });
  assert.equal(a.status, 201, a.text); S.pA = a.json;
  const b = await api('POST', '/pages', { token: S.admin, body: { slug: `devices-${run}`, title: 'Devices', kind: 'records', config: otherConfig() } });
  assert.equal(b.status, 201, b.text); S.pB = b.json;
  assert.equal((await api('POST', '/pages', { token: S.admin, body: { slug: `servers-${run}`, title: 'Dup', kind: 'records', config: assetConfig() } })).status, 409, 'slug unique');
  // A new page is visible to a viewer without any further setup, and the definition drives the UI.
  assert.ok((await api('GET', '/pages', { token: S.viewer })).json.some((p) => p.slug === S.pA.slug));
  const def = (await api('GET', `/pages/${S.pA.slug}`, { token: S.viewer })).json;
  assert.equal(def.config.fields.length, 13); assert.equal(def.config.form.sections[0].title, 'Identity');
  assert.equal((await api('PUT', `/pages/${S.pA.id}`, { token: S.admin, body: { slug: 'renamed' } })).status, 400, 'slug immutable');
  assert.equal((await api('PUT', `/pages/${S.pA.id}`, { token: S.admin, body: { kind: 'view' } })).status, 400, 'kind immutable');
  assert.equal((await api('GET', '/pages?all=1', { token: S.viewer })).status, 403);
  const me = await api('GET', '/auth/me', { token: S.viewer });
  assert.ok(me.json.pages.includes(`page:${S.pA.slug}`));
});

test('records: required, MAC normalisation, uniqueness across pages, hidden fields, encrypted passwords', async () => {
  const P = S.pA.slug; const R = (m, p, o) => api(m, `/p/${P}${p}`, { token: S.admin, ...o });
  assert.equal((await R('POST', '/records', { body: { data: { vm_name: 'nomac' } } })).status, 400, 'required MAC');
  assert.equal((await R('POST', '/records', { body: { data: { mac: 'not-a-mac' } } })).status, 400, 'bad MAC');
  assert.equal((await R('POST', '/records', { body: { data: { mac: mac(1), ram_gb: 'lots' } } })).status, 400, 'number type enforced');
  const r = await R('POST', '/records', { body: { data: { vm_name: `vm-${run}`, hostname: `host-${run}`, mac: mac(1).replace(/:/g, '-').toLowerCase(), ip: uip(), asset_tag: `T-${run}-1`,
    status: 'Active', department: 'IT', serial_no: `SN-${run}`, idrac: true, idrac_ip: '10.0.0.9', root_pw: 'S3cret!pw', ram_gb: 64 } } });
  assert.equal(r.status, 201, r.text); S.r1 = r.json;
  assert.equal(r.json.data.mac, mac(1), 'MAC normalised');
  assert.equal(r.json.data.root_pw, undefined, 'password never stored in data'); assert.deepEqual(r.json.secret_keys, ['root_pw']);
  assert.ok(!JSON.stringify(r.json).includes('S3cret'), 'plaintext never returned');
  assert.equal((await R('POST', '/records', { body: { data: { mac: mac(2), asset_tag: `T-${run}-1` } } })).status, 409, 'duplicate tag on same page');
  assert.equal((await R('POST', '/records', { body: { data: { mac: mac(2), serial_no: `SN-${run}` } } })).status, 409, 'per-field unique flag');
  const cross = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { hw_addr: mac(3), address: S.r1.data.ip } } });
  assert.equal(cross.status, 409, 'IP uniqueness is enforced across pages, matched by role not by field name');
  const tagCross = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { hw_addr: mac(3), tag: `T-${run}-1` } } });
  assert.equal(tagCross.status, 409);
  const off = await R('PUT', `/records/${S.r1.id}`, { body: { data: { idrac: false } } });
  assert.equal(off.status, 200); assert.equal(off.json.data.idrac_ip, undefined, 'conditionally hidden field is cleared');
  assert.equal((await R('PUT', `/records/${S.r1.id}`, { body: { data: { mac: '' } } })).status, 400, 'cannot blank a required field');
  const l = await api('GET', `/p/${P}/records?q=${run}&f_status=Active`, { token: S.viewer });
  assert.equal(l.status, 200); assert.ok(l.json.total >= 1);
  assert.equal((await api('GET', `/p/${P}/records?f_status=Nope`, { token: S.viewer })).json.total, 0, 'column filter works');
  assert.equal((await api('PUT', `/p/${P}/records/${S.r1.id}`, { token: S.viewer, body: { data: { ram_gb: 1 } } })).status, 403, 'viewer is read-only');
  const sort = await api('GET', `/p/${P}/records?sort=ram_gb&order=desc`, { token: S.admin });
  assert.equal(sort.status, 200);
});

test('password reveal is gated by can_view_passwords and audited', async () => {
  const P = S.pA.slug;
  const ok = await api('GET', `/p/${P}/records/${S.r1.id}/secrets/root_pw`, { token: S.admin });
  assert.equal(ok.status, 200); assert.equal(ok.json.password, 'S3cret!pw');
  assert.equal((await api('GET', `/p/${P}/records/${S.r1.id}/secrets/root_pw`, { token: S.viewer })).status, 403);
  assert.equal((await api('GET', `/p/${P}/records/${S.r1.id}/secrets/ram_gb`, { token: S.admin })).status, 404, 'only password fields');
  assert.ok((await api('GET', '/audit?action=view_password', { token: S.su })).json.rows.length >= 1);
});

test('"All records" view: sources, alias columns, filters, export, access, read-only', async () => {
  const cols = [
    { id: 'page', label: 'Page', keys: [] },
    { id: 'name', label: 'Name', keys: ['vm_name', 'device'] },
    { id: 'ip', label: 'IP', keys: ['ip', 'address'] },
    { id: 'state', label: 'Status', keys: ['status', 'state'] },
  ];
  cols[0].id = '_page';
  assert.equal((await api('POST', '/pages', { token: S.admin, body: { slug: `all-${run}`, title: 'All records', kind: 'view', config: { sources: [S.pA.slug, 'ghost-page'], columns: cols } } })).status, 400, 'unknown source rejected');
  const v = await api('POST', '/pages', { token: S.admin, body: { slug: `all-${run}`, title: 'All records', kind: 'view', config: { sources: [S.pA.slug, S.pB.slug], columns: cols, filters: ['state'], pageSize: 50 } } });
  assert.equal(v.status, 201, v.text); S.view = v.json;
  await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { device: `dev-${run}`, address: uip(), hw_addr: mac(5), state: 'Active' } } });
  const l = await api('GET', `/p/${S.view.slug}/records?q=${run}`, { token: S.viewer });
  assert.equal(l.status, 200, l.text);
  const pages = new Set(l.json.rows.map((r) => r.page_slug));
  assert.ok(pages.has(S.pA.slug) && pages.has(S.pB.slug), 'rows come from both source pages');
  assert.ok(l.json.rows.every((r) => r.page_title));
  assert.equal((await api('GET', `/p/${S.view.slug}/records?_page=${S.pB.slug}&q=${run}`, { token: S.viewer })).json.rows.every((r) => r.page_slug === S.pB.slug), true);
  assert.equal((await api('GET', `/p/${S.view.slug}/records?f_state=Active&q=${run}`, { token: S.viewer })).json.total >= 2, true, 'filter spans differently-named fields');
  assert.ok((await api('GET', `/p/${S.view.slug}/filter-options`, { token: S.viewer })).json.state.includes('Active'));
  assert.match((await api('GET', `/p/${S.view.slug}/records/export?q=${run}`, { token: S.admin })).text, /Name,IP,Status/);
  assert.equal((await api('POST', `/p/${S.view.slug}/records`, { token: S.admin, body: { data: {} } })).status, 400, 'views are read-only');
  assert.equal((await api('PUT', `/p/${S.view.slug}/records/${S.r1.id}`, { token: S.admin, body: { data: {} } })).status, 400);
  // A user who cannot open a source page never sees its rows through the view.
  const users = (await api('GET', '/users', { token: S.su })).json; const viewer = users.find((u) => u.email === `view-${run}@example.com`);
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: { [`page:${S.pB.slug}`]: false }, can_view_passwords: false } });
  const hidden = await api('GET', `/p/${S.view.slug}/records?q=${run}`, { token: S.viewer });
  assert.ok(hidden.json.rows.length && hidden.json.rows.every((r) => r.page_slug === S.pA.slug), 'blocked page contributes no rows');
  assert.equal((await api('GET', `/p/${S.pB.slug}/records`, { token: S.viewer })).status, 403);
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: {}, can_view_passwords: false } });
});

test('decommission releases tag + IP across pages, log is immutable, reactivation reclaims', async () => {
  const P = S.pA.slug;
  const d = await api('POST', `/p/${P}/records/${S.r1.id}/decommission`, { token: S.admin, body: { reason: 'EOL' } });
  assert.equal(d.status, 200, d.text);
  const after = (await api('GET', `/p/${P}/records/${S.r1.id}`, { token: S.admin })).json;
  assert.equal(after.data.asset_tag, undefined); assert.equal(after.data.ip, undefined); assert.equal(after.is_decommissioned, true);
  const reuse = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { hw_addr: mac(20), tag: S.r1.data.asset_tag, address: S.r1.data.ip } } });
  assert.equal(reuse.status, 201, 'the freed tag and IP can be used on another page: ' + reuse.text);
  const log = (await api('GET', '/decommissioned', { token: S.viewer })).json.find((l) => l.asset_id == S.r1.id);
  assert.ok(log && log.reason === 'EOL' && log.decommissioned_by_email && log.source_title === 'Servers');
  assert.equal((await api('POST', `/decommissioned/${log.id}/reactivate`, { token: S.admin })).status, 409, 'refused while tag/IP are taken');
  await api('DELETE', `/p/${S.pB.slug}/records/${reuse.json.id}`, { token: S.admin });
  assert.equal((await api('DELETE', `/recycle-bin/${reuse.json.id}`, { token: S.admin })).status, 200);
  assert.equal((await api('POST', `/decommissioned/${log.id}/reactivate`, { token: S.admin })).status, 200);
  const back = (await api('GET', `/p/${P}/records/${S.r1.id}`, { token: S.admin })).json;
  assert.equal(back.data.asset_tag, S.r1.data.asset_tag); assert.equal(back.data.ip, S.r1.data.ip); assert.equal(back.is_decommissioned, false);
  assert.ok((await api('GET', '/decommissioned', { token: S.admin })).json.find((l) => l.id === log.id).reactivated_at);
});

test('soft delete and recycle bin', async () => {
  const c = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { device: `bin-${run}`, hw_addr: mac(30) } } });
  assert.equal((await api('DELETE', `/p/${S.pB.slug}/records/${c.json.id}`, { token: S.admin })).status, 200);
  assert.equal((await api('GET', `/p/${S.pB.slug}/records/${c.json.id}`, { token: S.admin })).status, 404);
  assert.ok((await api('GET', '/recycle-bin', { token: S.admin })).json.some((r) => r.id == c.json.id && r.page_title === 'Devices'));
  assert.equal((await api('POST', `/recycle-bin/${c.json.id}/restore`, { token: S.admin })).status, 200);
  assert.equal((await api('GET', `/p/${S.pB.slug}/records/${c.json.id}`, { token: S.admin })).status, 200);
});

test('bulk actions and tag-range assignment', async () => {
  const P = S.pA.slug; const dept = `Dept-${run}`;
  assert.equal((await api('POST', '/department-tag-ranges', { token: S.admin, body: { department: dept, prefix: `E${run.slice(-3).toUpperCase()}-`, range_start: 100, range_end: 102, pad: 4 } })).status, 201);
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await api('POST', `/p/${P}/records`, { token: S.admin, body: { data: { mac: mac(40 + i), department: dept } } })).json.id);
  const b = await api('POST', `/p/${P}/records/bulk`, { token: S.admin, body: { ids, action: 'assign_tags' } });
  assert.equal(b.json.affected, 2, b.text); assert.match(b.json.assigned[0].tag, /-0100$/);
  assert.equal((await api('POST', `/p/${P}/records`, { token: S.admin, body: { data: { mac: mac(50), department: dept, asset_tag: 'WRONG-1' } } })).status, 400, 'tag outside range refused');
  assert.equal((await api('POST', `/p/${P}/records/bulk`, { token: S.admin, body: { ids, action: 'status', value: 'Under Maintenance' } })).json.affected, 2);
  assert.equal((await api('GET', `/p/${P}/records/${ids[0]}`, { token: S.admin })).json.data.status, 'Under Maintenance');
  // pages without the needed roles refuse role-dependent bulk actions
  const nb = await api('POST', `/p/${S.pB.slug}/records/bulk`, { token: S.admin, body: { ids: [1], action: 'assign_tags' } });
  assert.equal(nb.status, 400);
  assert.equal((await api('POST', `/p/${P}/records/bulk`, { token: S.admin, body: { ids, action: 'delete' } })).json.affected, 2);
});

test('excel import: preview diff, then commit; template + csv export', async () => {
  const P = S.pA.slug;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('x');
  ws.addRow(['Machine Name', 'Hostname', 'MAC Address', 'IP Address', 'Status', 'Serial No']);
  ws.addRow([`imp-new-${run}`, 'h1', mac(60), uip(), 'Active', `SN-n-${run}`]);
  ws.addRow([`imp-bad-${run}`, 'h2', 'garbage', '', 'Active', `SN-b-${run}`]);
  ws.addRow([`imp-merge-${run}`, 'h3', S.r1.data.mac, '', 'Under Maintenance', '']);        // existing MAC -> merge
  const buf = await wb.xlsx.writeBuffer();
  const mk = () => { const f = new FormData(); f.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'a.xlsx'); return f; };
  const prev = await api('POST', `/p/${P}/records/import?mode=preview`, { token: S.admin, form: mk() });
  assert.equal(prev.status, 200, prev.text);
  assert.deepEqual(prev.json.summary, { create: 1, merge: 1, error: 1 });
  assert.ok(prev.json.rows.find((r) => r.action === 'merge').changes.some((c) => c.field === 'status'));
  assert.equal((await api('POST', `/p/${P}/records/import?mode=commit`, { token: S.admin, form: mk() })).status, 400, 'errors block commit unless skipped');
  const done = await api('POST', `/p/${P}/records/import?mode=commit&skip_errors=true`, { token: S.admin, form: mk() });
  assert.deepEqual([done.json.created, done.json.merged, done.json.skipped], [1, 1, 1], done.text);
  const bad = new FormData(); bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await api('POST', `/p/${P}/records/import?mode=preview`, { token: S.admin, form: bad })).status, 400);
  const nomac = new ExcelJS.Workbook(); nomac.addWorksheet('x').addRows([['Machine Name'], ['x']]);
  const f2 = new FormData(); f2.append('file', new Blob([await nomac.xlsx.writeBuffer()]), 'b.xlsx');
  assert.equal((await api('POST', `/p/${P}/records/import?mode=preview`, { token: S.admin, form: f2 })).status, 400, 'sheet missing required column is refused');
  const csv = await api('GET', `/p/${P}/records/export?q=${run}`, { token: S.admin });
  assert.equal(csv.status, 200); assert.match(csv.text, /MAC Address/); assert.ok(!/Root Password/.test(csv.text), 'password fields are never exported');
  assert.equal((await api('GET', `/p/${P}/records/template`, { token: S.admin })).status, 200);
});

test('migration tracker: project, hosts, VMs, custom fields, overview, import', async () => {
  const p = await api('POST', '/migration/projects', { token: S.admin, body: { name: `Proj ${run}` } });
  assert.equal(p.status, 201, p.text); const pid = p.json.id;
  assert.equal(p.json.tabs.length, 0);
  assert.equal((await api('POST', `/migration/projects/${pid}/custom-fields`, { token: S.admin, body: { key: 'owner', label: 'Owner', type: 'dropdown', options: ['Ops', 'Sec'] } })).status, 201);
  const h = await api('POST', '/migration/hosts', { token: S.admin, body: { project_id: pid, host_name: 'esx01', datacenter: 'DC1', cluster: 'C1' } });
  assert.equal(h.status, 201, h.text);
  const hp = await api('PATCH', `/migration/hosts/${h.json.id}?project_id=${pid}`, { token: S.admin, body: { vms_vacate_status: 'Completed', idrac_password: 'idrac-secret', license_expiry: '2020-01-01' } });
  assert.equal(hp.status, 200, hp.text); assert.equal(hp.json.idrac_password_encrypted, undefined);
  assert.equal((await api('PATCH', `/migration/hosts/${h.json.id}?project_id=${pid}`, { token: S.admin, body: { vms_vacate_status: 'Nope' } })).status, 400);
  assert.equal((await api('GET', `/migration/hosts/${h.json.id}/idrac-password`, { token: S.viewer })).status, 403);
  assert.equal((await api('GET', `/migration/hosts/${h.json.id}/idrac-password`, { token: S.admin })).json.password, 'idrac-secret');
  const v = await api('POST', '/migration/vms', { token: S.admin, body: { project_id: pid, tab_key: 'bomgar', vm_name: 'bomgar-1', power_state: 'POWERED_OFF' } });
  assert.equal(v.status, 201, v.text);
  const vp = await api('PATCH', `/migration/bomgar-vms/${v.json.id}?project_id=${pid}`, { token: S.admin, body: { migration_status: 'Migrated', notes: 'done', custom: { owner: 'Ops' } } });
  assert.equal(vp.status, 200, vp.text); assert.equal(vp.json.custom.owner, 'Ops');
  assert.equal((await api('PATCH', `/migration/bomgar-vms/${v.json.id}?project_id=${pid}`, { token: S.admin, body: { custom: { owner: 'Nobody' } } })).status, 400);
  assert.equal((await api('PATCH', `/migration/security-vms/${v.json.id}?project_id=${pid}`, { token: S.admin, body: { notes: 'x' } })).status, 400, 'wrong tab');
  const list = await api('GET', `/migration/bomgar-vms?project_id=${pid}`, { token: S.viewer });
  assert.equal(list.json.summary.migrated, 1); assert.equal(list.json.summary.powered_off, 1);
  const ov = await api('GET', `/migration/overview?project_id=${pid}`, { token: S.viewer });
  assert.equal(ov.json.vms.total, 1); assert.equal(ov.json.licenses_expiring_30d, 1); assert.ok(ov.json.progress_percent > 0);
  // multi-sheet import
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Security VMs').addRows([['VM Name', 'IP', 'Status', 'Owner'], ['sec-1', '10.1.1.1', 'In Progress', 'Sec']]);
  wb.addWorksheet('Hosts').addRows([['Host', 'Datacenter', 'VMs Vacate'], ['esx02', 'DC2', 'Blocked']]);
  wb.addWorksheet('Unrelated').addRows([['a'], ['b']]);
  const f = new FormData(); f.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'm.xlsx');
  const imp = await api('POST', `/migration/import?project_id=${pid}`, { token: S.admin, form: f });
  assert.equal(imp.status, 200, imp.text); assert.deepEqual(imp.json.skipped, ['Unrelated']);
  assert.equal((await api('GET', `/migration/security-vms?project_id=${pid}`, { token: S.admin })).json.rows[0].custom.owner, 'Sec');
  assert.equal((await api('GET', `/migration/hosts?project_id=${pid}`, { token: S.admin })).json.summary.blocked, 1);
  S.pid = pid;
});

test('changing a field role re-maps existing records', async () => {
  // A page with two candidate status fields; moving the Status role must re-point existing records.
  const base = assetConfig();
  base.fields.push({ key: 'lifecycle', label: 'Lifecycle', type: 'text' });
  base.form.sections[0].items.push({ key: 'lifecycle' });
  const created = await api('POST', '/pages', { token: S.admin, body: { slug: `remap-${run}`, title: 'Remap', kind: 'records', config: base } });
  assert.equal(created.status, 201, created.text);
  const slug = created.json.slug;
  await api('POST', `/p/${slug}/records`, { token: S.admin, body: { data: { mac: mac(90), status: 'Active', lifecycle: 'Retired' } } });
  const rep = async () => (await api('GET', '/reports/weekly', { token: S.admin })).json.inventories.find((i) => i.key === slug);
  assert.deepEqual((await rep()).statuses.map((s) => s.status), ['Active']);
  const moved = JSON.parse(JSON.stringify(base));
  delete moved.fields.find((f) => f.key === 'status').role;
  moved.fields.find((f) => f.key === 'lifecycle').role = 'status';
  assert.equal((await api('PUT', `/pages/${created.json.id}`, { token: S.admin, body: { config: moved } })).status, 200);
  assert.deepEqual((await rep()).statuses.map((s) => s.status), ['Retired'], 'existing records follow the new role mapping');
  assert.equal((await api('DELETE', `/pages/${created.json.id}?confirm=${slug}`, { token: S.su })).status, 200);
});

test('admin config: dropdowns, branding, teams, compliance', async () => {
  assert.ok((await api('GET', '/dropdowns', { token: S.viewer })).json.server_status.includes('Not in Scope'));
  assert.equal((await api('POST', '/dropdowns', { token: S.admin, body: { category: 'location', value: `Lab-${run}` } })).status, 201);
  assert.equal((await api('POST', '/dropdowns', { token: S.viewer, body: { category: 'location', value: 'x' } })).status, 403);
  assert.equal((await api('PUT', '/branding', { token: S.admin, body: { app_name: 'Acme', primary_color: 'red' } })).status, 400);
  assert.equal((await api('PUT', '/branding', { token: S.admin, body: { app_name: 'Acme', primary_color: '#112233', logo_data_url: 'data:image/svg+xml;base64,AAAA' } })).status, 400, 'svg logos refused');
  assert.equal((await api('PUT', '/branding', { token: S.admin, body: { app_name: 'Acme', primary_color: '#112233' } })).status, 200);
  assert.equal((await api('GET', '/branding')).json.app_name, 'Acme');
  if (!(await api('GET', '/teams-notification', { token: S.admin })).json.webhook_configured) {
    assert.equal((await api('PUT', '/teams-notification', { token: S.admin, body: { enabled: true } })).status, 400, 'cannot enable without a webhook');
  }
  assert.equal((await api('PUT', '/teams-notification', { token: S.admin, body: { webhook_url: 'http://insecure.example/hook' } })).status, 400);
  assert.equal((await api('PUT', '/teams-notification', { token: S.admin, body: { webhook_url: 'https://example.invalid/hook', enabled: true, events: { asset_updated: false } } })).status, 200);
  const tg = (await api('GET', '/teams-notification', { token: S.admin })).json;
  assert.equal(tg.webhook_configured, true); assert.equal(tg.webhook_url, undefined, 'webhook URL never returned');
  const t0 = Date.now();   // notifications are fire-and-forget: a dead webhook must not slow or break writes
  assert.equal((await api('PUT', `/p/${S.pA.slug}/records/${S.r1.id}`, { token: S.admin, body: { data: { ram_gb: 128 } } })).status, 200);
  assert.ok(Date.now() - t0 < 3000);
  await api('PUT', '/teams-notification', { token: S.admin, body: { enabled: false } });
  assert.equal((await api('PUT', '/compliance-config', { token: S.admin, body: { patch_threshold_days: 45 } })).json.patch_threshold_days, 45);
});

test('reports: weekly excludes NA / Not in Scope, data health, reconcile, search, dashboard', async () => {
  const P = S.pA.slug;
  const mk = (n, status) => api('POST', `/p/${P}/records`, { token: S.admin, body: { data: { mac: mac(70 + n), vm_name: `rep-${run}-${n}`, status, patched: new Date().toISOString().slice(0, 10) } } });
  const find = (r) => r.inventories.find((i) => i.key === P);
  const before = find((await api('GET', '/reports/weekly', { token: S.admin })).json);
  await mk(1, 'Active'); await mk(2, 'NA'); await mk(3, 'Not in Scope');
  const after = find((await api('GET', '/reports/weekly', { token: S.admin })).json);
  assert.equal(after.total - before.total, 1, 'NA / Not in Scope must not count toward totals');
  assert.equal(after.excluded - before.excluded, 2);
  assert.match((await api('GET', '/reports/weekly/csv', { token: S.admin })).text, /In-scope assets/);
  assert.ok('missing_ip' in (await api('GET', '/data-health', { token: S.admin })).json.counts);
  assert.equal((await api('POST', `/p/${P}/records`, { token: S.admin, body: { data: { mac: mac(1), vm_name: 'dup-mac' } } })).status, 201);
  assert.ok((await api('GET', '/data-health', { token: S.admin })).json.issues.duplicate_macs.length >= 1);
  const rc = await api('GET', '/reconcile', { token: S.admin }); assert.equal(rc.status, 200);
  const s = await api('GET', `/search?q=rep-${run}`, { token: S.viewer });
  assert.ok(s.json.length >= 3 && s.json[0].source_label === 'Servers');
  assert.equal((await api('GET', '/search?q=a', { token: S.viewer })).status, 400);
  const d = await api('GET', '/dashboard', { token: S.viewer });
  assert.equal(d.status, 200); assert.equal(d.json.recent.length, 0, 'recent audit hidden from viewers');
  assert.ok(d.json.inventories.some((i) => i.key === P));
});

test('per-user page control and custom roles work with designed pages', async () => {
  const users = (await api('GET', '/users', { token: S.su })).json;
  const viewer = users.find((u) => u.email === `view-${run}@example.com`);
  const pc = await api('GET', '/users/page-control', { token: S.su });
  assert.ok(pc.json.dynamic_pages.some((d) => d.key === `page:${S.pA.slug}` && d.label === 'Servers'));
  assert.equal((await api('GET', '/migration/projects', { token: S.viewer })).status, 200);
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: { migration: false, [`page:${S.pA.slug}`]: false, 'page:ghost': true }, can_view_passwords: true } });
  assert.equal((await api('GET', '/migration/projects', { token: S.viewer })).status, 403, 'static page revoked');
  assert.equal((await api('GET', `/p/${S.pA.slug}/records`, { token: S.viewer })).status, 403, 'designed page revoked');
  const me = await api('GET', '/auth/me', { token: S.viewer });
  assert.ok(!me.json.pages.includes('migration') && !me.json.pages.includes('page:ghost'), 'unknown keys are ignored');
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: {}, can_view_passwords: false } });

  assert.equal((await api('POST', '/roles', { token: S.admin, body: { name: 'admin', pages: [] } })).status, 409);
  const r = await api('POST', '/roles', { token: S.admin, body: { name: `auditor_${run}`, pages: ['dashboard', 'admin-audit', `page:${S.pB.slug}`, 'page:nope'], can_write: false } });
  assert.equal(r.status, 201, r.text); assert.deepEqual(r.json.pages.sort(), ['admin-audit', 'dashboard', `page:${S.pB.slug}`].sort());
  assert.equal((await api('POST', '/users', { token: S.admin, body: { email: `aud-${run}@example.com`, password: 'Passw0rdOK', role: `auditor_${run}` } })).status, 201);
  const t = (await api('POST', '/auth/login', { body: { email: `aud-${run}@example.com`, password: 'Passw0rdOK' } })).json.token;
  assert.equal((await api('GET', '/audit', { token: t })).status, 200);
  assert.equal((await api('GET', `/p/${S.pB.slug}/records`, { token: t })).status, 200, 'custom role can open a designed page it was given');
  assert.equal((await api('GET', `/p/${S.pA.slug}/records`, { token: t })).status, 403);
  assert.equal((await api('DELETE', `/roles/${r.json.id}`, { token: S.admin })).status, 400, 'role in use');
});

test('tenable import + report', async () => {
  await api('POST', `/p/${S.pA.slug}/records`, { token: S.admin, body: { data: { mac: mac(80), hostname: `host-${run}`, vm_name: `tn-${run}` } } });
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('t');
  ws.addRow(['Name', 'IP Address', 'MAC Address', 'Critical', 'High', 'Medium', 'Low', 'Operating System']);
  ws.addRow([`host-${run}`, '1.2.3.4', '', 2, 5, 1, 0, 'Linux']);
  ws.addRow([`ghost-${run}`, '9.9.9.9', '', 1, 0, 0, 0, 'Windows']);
  const f = new FormData(); f.append('file', new Blob([await wb.xlsx.writeBuffer()]), 't.xlsx');
  assert.equal((await api('POST', '/tenable/import', { token: S.viewer, form: f })).status, 403);
  const f2 = new FormData(); f2.append('file', new Blob([await wb.xlsx.writeBuffer()]), 't.xlsx');
  assert.equal((await api('POST', '/tenable/import', { token: S.admin, form: f2 })).status, 201);
  const rep = (await api('GET', '/tenable/report', { token: S.admin })).json;
  assert.ok(rep.matched.some((a) => a.hostname === `host-${run}` && a.tenable.critical === 2 && a.source === S.pA.slug));
  assert.ok(rep.tenable_only.some((a) => a.hostname === `ghost-${run}`));
  assert.equal((await api('GET', `/tenable/report?source=${S.pB.slug}`, { token: S.admin })).json.matched.every((a) => a.source === S.pB.slug), true);
  assert.match((await api('GET', '/tenable/report/csv?tab=matched', { token: S.admin })).text, /Critical/);
});

test('backup: csv per table never contains secrets; pg_dump records result', async () => {
  const csv = await api('GET', '/backup/csv/inventory_records', { token: S.admin });
  assert.equal(csv.status, 200); assert.ok(/data/.test(csv.text.split('\n')[0]) && !/secret|password/i.test(csv.text.split('\n')[0]), 'secret columns excluded');
  assert.equal((await api('GET', '/backup/csv/users', { token: S.admin })).status, 400);
  assert.equal((await api('GET', '/backup', { token: S.viewer })).status, 403);
  const run1 = await api('POST', '/backup/run', { token: S.admin, body: { kind: 'csv' } });
  assert.equal(run1.status, 201, run1.text);
  const rest = await api('POST', `/backup/restore/${run1.json.id}`, { token: S.admin });
  assert.equal(rest.status, 200, rest.text);
});

test('deleting a page: guarded, cascades its records, keeps the decommission log', async () => {
  const slug = `tmp-${run}`;
  const p = await api('POST', '/pages', { token: S.admin, body: { slug, title: 'Temp', kind: 'records', config: otherConfig() } });
  assert.equal(p.status, 201);
  const rec = await api('POST', `/p/${slug}/records`, { token: S.admin, body: { data: { device: `tmp-${run}`, hw_addr: mac(95), tag: `TMP-${run}` } } });
  await api('POST', `/p/${slug}/records/${rec.json.id}/decommission`, { token: S.admin, body: { reason: 'page going away' } });
  assert.equal((await api('DELETE', `/pages/${p.json.id}`, { token: S.admin })).status, 400, 'confirmation required');
  assert.equal((await api('DELETE', `/pages/${p.json.id}?confirm=wrong`, { token: S.admin })).status, 400);
  assert.equal((await api('DELETE', `/pages/${S.pA.id}?confirm=${S.pA.slug}`, { token: S.admin })).status, 409, 'still used as a source by the view');
  assert.equal((await api('DELETE', `/pages/${p.json.id}?confirm=${slug}`, { token: S.viewer })).status, 403);
  const del = await api('DELETE', `/pages/${p.json.id}?confirm=${slug}`, { token: S.admin });
  assert.equal(del.status, 200); assert.equal(del.json.records_deleted, 1);
  assert.equal((await api('GET', `/p/${slug}/records`, { token: S.admin })).status, 404);
  const log = (await api('GET', '/decommissioned', { token: S.admin })).json.find((l) => l.asset_name === `tmp-${run}`);
  assert.ok(log && log.reason === 'page going away', 'the permanent log survives page deletion');
  assert.equal((await api('POST', `/decommissioned/${log.id}/reactivate`, { token: S.admin })).status, 400, 'cannot reactivate into a deleted page');
  // duplicate copies layout only
  const dup = await api('POST', `/pages/${S.pA.id}/duplicate`, { token: S.admin, body: { slug: `copy-${run}`, title: 'Copy of Servers' } });
  assert.equal(dup.status, 201); assert.equal(dup.json.config.fields.length, 13);
  assert.equal((await api('GET', `/p/${dup.json.slug}/records`, { token: S.admin })).json.total, 0);
});
test('regressions: no hash leak, long values, long page addresses, page access in MAC lookup', async () => {
  // PUT /users/:id with nothing to change must not echo the password hash
  const users = (await api('GET', '/users', { token: S.su })).json; const viewer = users.find((u) => u.email === `view-${run}@example.com`);
  const noop = await api('PUT', `/users/${viewer.id}`, { token: S.admin, body: {} });
  assert.equal(noop.status, 200); assert.equal(noop.json.password_hash, undefined, 'hash must not be returned'); assert.equal(noop.json.email, viewer.email);
  assert.equal((await api('PUT', `/users/${viewer.id}`, { token: S.admin, body: { email: 'x@example.com' } })).status, 400, 'email cannot be changed');

  // values longer than the promoted columns are stored, not a 500
  const long = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { device: `long-${run}`, hw_addr: mac(100), tag: `LONG-${run}-`.padEnd(70, 'x'), state: 's'.repeat(100) } } });
  assert.equal(long.status, 201, long.text); assert.equal(long.json.data.state.length, 100);

  // a 45-character page address works with decommission (decommission_log.source was VARCHAR(32))
  const slug = `a${run}`.padEnd(45, 'z');
  assert.equal((await api('POST', '/pages', { token: S.admin, body: { slug, title: 'Long address', kind: 'records', config: otherConfig() } })).status, 201);
  const rec = await api('POST', `/p/${slug}/records`, { token: S.admin, body: { data: { device: `ld-${run}`, hw_addr: mac(101) } } });
  assert.equal((await api('POST', `/p/${slug}/records/${rec.json.id}/decommission`, { token: S.admin, body: { reason: 'long slug' } })).status, 200);
  const pg = (await api('GET', `/pages/${slug}`, { token: S.admin })).json;
  assert.equal((await api('DELETE', `/pages/${pg.id}?confirm=${slug}`, { token: S.admin })).status, 200);

  // MAC lookup only shows inventory rows from pages the caller may open
  const target = await api('POST', `/p/${S.pB.slug}/records`, { token: S.admin, body: { data: { device: `ml-${run}`, hw_addr: mac(102) } } });
  assert.equal(target.status, 201, target.text);
  const lookup = () => api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(mac(102))}`, { token: S.viewer });
  assert.equal((await lookup()).json.inventory.length, 1, 'visible while the viewer can open the page');
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: { [`page:${S.pB.slug}`]: false }, can_view_passwords: false } });
  const hidden = await lookup();
  assert.equal(hidden.status, 200); assert.equal(hidden.json.inventory.length, 0, 'blocked page must not leak through MAC lookup');
  await api('PUT', `/users/page-control/${viewer.id}`, { token: S.su, body: { page_overrides: {}, can_view_passwords: false } });
});

test('swagger, 404s and health', async () => {
  assert.equal((await api('GET', '/health')).status, 200);
  assert.equal((await api('GET', '/nope')).status, 404);
  const r = await fetch(BASE + '/api/docs/'); assert.equal(r.status, 200);
});
