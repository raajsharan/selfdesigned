// MAC mapping files: upload (xlsx and csv), column detection, bad rows, newest-wins lookup, access and deletion.
//   BASE_URL=http://localhost:4000 TEST_EMAIL=... TEST_PASSWORD=... node --test test/macmapping.test.js   (use a throw-away database)
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const SUPER = { email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD };
const run = Date.now().toString(36);
const PW = 'Str0ng#Passw0rd-1';
const S = {};

async function api(method, path, { token, body, form } = {}) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const upload = async (name, buf, type) => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return api('POST', '/mac-mapping/files', { token: S.sa, form: f }); };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const xlsx = async (rows) => { const wb = new ExcelJS.Workbook(); wb.addWorksheet('S').addRows(rows); return Buffer.from(await wb.xlsx.writeBuffer()); };
const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).json.token;
const tag = (n) => `AA:BB:${(parseInt(run, 36) & 255).toString(16).toUpperCase().padStart(2, '0')}:00:00:${n.toString(16).toUpperCase().padStart(2, '0')}`;

test('setup', async () => { S.sa = await login(SUPER.email, SUPER.password); assert.ok(S.sa); await api('DELETE', '/mac-mapping/files', { token: S.sa }); });

test('xlsx: columns are detected, MAC formats are normalised, bad rows are skipped, duplicates inside a file keep the first', async () => {
  const m1 = tag(1), m2 = tag(2), m3 = tag(3);
  const rows = [['LAN Segment', 'Mac address', 'Vlan Group', 'ip', 'Data Retrieved'],
    ['Lab-A', m1, 'V10', '10.20.0.1', '2026-09-24'], ['Lab-A', m2.replace(/:/g, '-').toLowerCase(), 'V10', '10.20.0.2', '2026-09-24'],
    ['Lab-B', m3.replace(/:/g, '').toLowerCase().replace(/(....)(?=.)/g, '$1.').replace(/\.$/, ''), 'V20', '10.20.0.3', ''],
    ['Lab-B', 'not-a-mac', 'V20', '10.20.0.4', ''], ['Lab-B', tag(4), 'V20', '999.1.1.1', ''], ['Lab-C', m1, 'V99', '10.20.9.9', 'dup'], [null, null, null, null, null]];
  const r = await upload('first.xlsx', await xlsx(rows), XLSX);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.rows, 3); assert.equal(r.json.skipped, 2);
  assert.deepEqual(Object.keys(r.json.columns).sort(), ['data', 'ip', 'lan', 'mac', 'vlan']);
  const l = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(m1)}`, { token: S.sa });
  assert.equal(l.status, 200, l.text);
  assert.equal(l.json.mapping.length, 1); assert.equal(l.json.mapping[0].ip, '10.20.0.1'); assert.equal(l.json.mapping[0].lan_segment, 'Lab-A'); assert.equal(l.json.mapping[0].vlan_group, 'V10');
  const l3 = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(m3)}`, { token: S.sa });
  assert.equal(l3.json.mapping[0].mac, m3, 'dotted lower-case MAC is stored as AA:BB:...');
  const part = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(m1.slice(0, 11))}`, { token: S.sa });
  assert.ok(part.json.mapping.length >= 3, 'a partial MAC finds all of them');
});

test('csv with a title line above the header, and the newest file wins for a MAC', async () => {
  const m1 = tag(1);
  const csv = `Exported from the switch,,\nMAC Address,IP Address,VLAN Group\n${m1},10.99.0.1,V77\n${tag(9)},10.99.0.9,V77\n`;
  const r = await upload('second.csv', Buffer.from(csv), 'text/csv');
  assert.equal(r.status, 201, r.text); assert.equal(r.json.rows, 2); assert.equal(r.json.columns.lan, undefined);
  const l = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(m1)}`, { token: S.sa });
  assert.equal(l.json.mapping.length, 1); assert.equal(l.json.mapping[0].ip, '10.99.0.1', 'the newer file wins'); assert.equal(l.json.mapping[0].filename, 'second.csv');
  const list = await api('GET', '/mac-mapping', { token: S.sa });
  assert.equal(list.json.totals.files, 2); assert.equal(list.json.totals.entries, 5);
  assert.equal(list.json.files[0].filename, 'second.csv', 'newest first');
});

test('the usual column names are detected in any order, and VLAN is not mistaken for LAN', async () => {
  for (const [i, head] of [['MAC Address', 'IP Address', 'LAN Segment', 'VLAN Group', 'Data Retrieved'], ['VLAN Group', 'Data Retrieved', 'IP Address', 'LAN Segment', 'MAC Address'], ['VLAN Group', 'MAC Address', 'IP Address']].entries()) {
    const vals = { 'MAC Address': tag(100 + i), 'IP Address': `10.55.${i}.1`, 'LAN Segment': 'seg', 'VLAN Group': `vl${i}`, 'Data Retrieved': '2026-09-24' };
    const r = await upload(`order${i}.xlsx`, await xlsx([head, head.map((h) => vals[h])]), XLSX);
    assert.equal(r.status, 201, r.text);
    const m = (await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(tag(100 + i))}`, { token: S.sa })).json.mapping[0];
    assert.equal(m.vlan_group, `vl${i}`); assert.equal(m.ip, `10.55.${i}.1`);
    assert.equal(m.lan_segment, head.includes('LAN Segment') ? 'seg' : null, 'LAN segment only when the file has one');
  }
});

test('bad uploads are refused with a clear message', async () => {
  assert.equal((await upload('x.txt', Buffer.from('a'), 'text/plain')).status, 400);
  const noCols = await upload('nocols.xlsx', await xlsx([['Name', 'Owner'], ['a', 'b']]), XLSX);
  assert.equal(noCols.status, 400); assert.match(noCols.json.error, /MAC Address column and an IP Address column/);
  const none = await upload('none.xlsx', await xlsx([['MAC Address', 'IP Address'], ['zz', 'y']]), XLSX);
  assert.equal(none.status, 400); assert.match(none.json.error, /No usable rows/);
  assert.equal((await upload('broken.xlsx', Buffer.from('not a workbook'), XLSX)).status, 400);
});

test('about 10,000 rows load quickly', async () => {
  const rows = [['MAC Address', 'IP Address', 'LAN Segment']];
  for (let i = 0; i < 10000; i++) rows.push([`02:${(i >> 16 & 255).toString(16).padStart(2, '0')}:${(i >> 8 & 255).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}:00:01`, `10.${(i >> 8) & 255}.${i & 255}.1`, 'bulk']);
  const t0 = Date.now(); const r = await upload('big.xlsx', await xlsx(rows), XLSX); const ms = Date.now() - t0;
  assert.equal(r.status, 201, r.text); assert.equal(r.json.rows, 10000); assert.ok(ms < 20000, `took ${ms} ms`);
});

test('only people with the MAC Mapping page can manage files; everyone with the lookup can read matches', async () => {
  const email = `vw-${run}@test.local`;
  assert.equal((await api('POST', '/users', { token: S.sa, body: { email, password: PW, role: 'viewer' } })).status, 201);
  const vt = await login(email, PW);
  assert.equal((await api('GET', '/mac-mapping', { token: vt })).status, 403);
  const f = new FormData(); f.append('file', new Blob(['x'], { type: 'text/csv' }), 'a.csv');
  assert.equal((await api('POST', '/mac-mapping/files', { token: vt, form: f })).status, 403);
  assert.equal((await api('DELETE', '/mac-mapping/files', { token: vt })).status, 403);
  assert.equal((await api('GET', '/mac-mapping')).status, 401);
  // a viewer can use the MAC lookup (vmware page) and sees the mapping
  const l = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(tag(1))}`, { token: vt });
  assert.equal(l.status, 200); assert.equal(l.json.mapping[0].ip, '10.99.0.1');
});

test('delete one file, then clear all', async () => {
  const list = (await api('GET', '/mac-mapping', { token: S.sa })).json.files;
  const second = list.find((f) => f.filename === 'second.csv');
  assert.equal((await api('DELETE', `/mac-mapping/files/${second.id}`, { token: S.sa })).status, 200);
  const l = await api('GET', `/vmware/mac-lookup?mac=${encodeURIComponent(tag(1))}`, { token: S.sa });
  assert.equal(l.json.mapping[0].ip, '10.20.0.1', 'the older file shows again once the newer one is gone');
  assert.equal((await api('DELETE', `/mac-mapping/files/${second.id}`, { token: S.sa })).status, 404);
  const c = await api('DELETE', '/mac-mapping/files', { token: S.sa });
  assert.equal(c.status, 200); assert.ok(c.json.deleted >= 4);
  assert.equal((await api('GET', '/mac-mapping', { token: S.sa })).json.totals.entries, 0);
});
