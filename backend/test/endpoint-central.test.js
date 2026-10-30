// Endpoint Central: status mapping, custom group sync, throttle, staged computers and permissions, against a fake EC server.
//   npm run test:ec
// Needs PostgreSQL (backend/.env credentials). It creates a throw-away database, applies the schema there and drops it
// afterwards, so the real inventory database is never touched.
const path = require('path');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');

const SCRATCH = `ec_test_${process.pid}_${Date.now().toString(36)}`;
process.env.DB_NAME = SCRATCH;                     // set first: dotenv never overrides a value that is already set
delete process.env.DATABASE_URL;
require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.DB_NAME = SCRATCH;

const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

const dbConn = { host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT, 10) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
const NOW = Date.UTC(2026, 9, 30, 11, 2, 0);

// ---- the fake Endpoint Central -------------------------------------------------------------------------------------
const COMPUTERS = [
  { resource_id: 101, full_name: 'WEB-01.corp.local', ip_address: '10.0.0.1', mac_address: 'AA-BB-CC-00-00-01', os_platform: 1, os_name: 'Windows Server 2022', live_status: 1, agent_install_status: 22, agent_version: '11.4.2', branch_office_name: 'HQ', agent_last_contact_time: String(NOW) },
  { resource_id: 102, computer_name: 'DB-01', ip_address: '10.0.0.2', mac_address: '--', os_platform: 3, computer_live_status: 3, agent_install_status: 29, agent_version: '--', branch_office_name: 'HQ', agent_last_contact_time: '--' },
  { resource_id: 103, full_name: 'LAP-07', ip_address: '10.0.1.7', os_platform: 1, live_status: 2, installation_status: 21, branch_office_name: 'Remote', agent_last_contact_time: NOW - 9 * 86400000 },
];
const GROUPS = () => ([
  { cg_id: 1, cg_name: 'Servers', cg_type: 'Static', cg_category: 'Computer', domain_name: 'corp.local', created_on: 1000, modified_on: 2000 },
  { cg_id: 2, cg_name: 'Laptops', cg_type: 'Static Unique', cg_category: 'Computer', domain_name: 'corp.local', created_on: 1000, modified_on: 2000 },
  { cg_id: 3, cg_name: 'Windows boxes', cg_type: 'Dynamic', cg_category: 'Computer', domain_name: 'corp.local', created_on: 1000, modified_on: 2000 },
  { cg_id: 4, cg_name: 'Helpdesk users', cg_type: 'Users', cg_category: 'User', domain_name: 'corp.local', created_on: 1000, modified_on: 2000 },
]);
const MEMBERS = {
  Servers: [{ resourceId: 101, name: 'WEB-01', domainName: 'corp.local', osPlatform: 1 }, { resourceId: 102, name: 'DB-01', domainName: 'corp.local', osPlatform: 3 }],
  Laptops: [{ resourceId: 103, name: 'LAP-07', domainName: 'corp.local', osPlatform: 1 }],
};

const fake = { groups: GROUPS(), limit: null, stamps: [], calls: {}, headers: {}, noGroups: false, server: null, url: '' };
const count = (k) => { fake.calls[k] = (fake.calls[k] || 0) + 1; };
const resetCalls = () => { fake.calls = {}; fake.stamps = []; };
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

function overLimit() {
  if (!fake.limit) return false;
  const now = Date.now(); fake.stamps = fake.stamps.filter((t) => now - t < fake.limit.windowMs);
  if (fake.stamps.length >= fake.limit.max) { count('429'); return true; }
  fake.stamps.push(now); return false;
}

function startFake() {
  fake.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    if (p.endsWith('/desktop/authentication')) return send(res, 200, {});
    if (p === '/api/1.4/som/computers') {
      count('computers'); fake.headers.computers = req.headers.authorization;
      return send(res, 200, { message_response: { computers: u.searchParams.get('page') === '1' ? COMPUTERS : [], total: COMPUTERS.length } });
    }
    if (p === '/api/1.4/customgroup/getCGList') {
      if (overLimit()) return send(res, 429, { error: 'too many calls' });
      count('list');
      if (fake.noGroups) return send(res, 204);
      return send(res, 200, { message_response: { getcglist: { response: { result: { cg_list: fake.groups } } } } });
    }
    if (p === '/api/1.4/customgroup/getCGDetails') {
      if (overLimit()) return send(res, 429, { error: 'too many calls' });
      count('details'); const name = u.searchParams.get('cgName'); const g = fake.groups.find((x) => x.cg_name === name);
      if (!g || name === 'Ghost') return send(res, 500, {});
      const result = g.cg_type === 'Dynamic' ? { criteriaPattern: '1 and 2', criteriaList: [{ column: 'OS', value: 'Windows' }] } : { groupMembers: MEMBERS[name] || [] };
      return send(res, 200, { message_response: { getcgdetails: { response: { result } } } });
    }
    if (p === '/dcapi/som/approval/computers-info') {
      if (overLimit()) return send(res, 429, { error: 'too many calls' });
      count('staged'); fake.headers.staged = req.headers.accept; fake.headers.stagedStatus = u.searchParams.get('approvalStatus');
      return send(res, 200, { totalRecords: 1, computers: u.searchParams.get('page') === '1' ? [{ computer_name: 'NEW-PC', ip_address: '10.9.9.9', mac_address: '--', os_platform: 1, discovered_time: NOW }] : [] });
    }
    return send(res, 404, {});
  });
  return new Promise((r) => fake.server.listen(0, '127.0.0.1', () => { fake.url = `http://127.0.0.1:${fake.server.address().port}`; r(); }));
}

// ---- setup ------------------------------------------------------------------------------------------------------------
const S = {};
const admin = async (sql) => { const c = new Client({ ...dbConn, database: 'postgres' }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
const call = async (method, url, { token, body } = {}) => {
  const r = await fetch(S.base + '/api' + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* empty */ } return { status: r.status, json };
};
const waitIdle = async () => { for (let i = 0; i < 200; i++) { if (!S.groups.progress().running) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('sync did not finish'); };

test.before(async () => {
  await admin(`CREATE DATABASE "${SCRATCH}"`);
  S.db = require('../src/config/db');
  await require('../src/bootstrap/ensureSchema')();
  S.svc = require('../src/services/endpointCentralService');
  S.groups = require('../src/services/ecGroupService');
  S.throttle = require('../src/services/ecThrottle');
  await startFake();
  await S.svc.saveConfig({ base_url: fake.url, auth_mode: 'apikey', api_key: 'secret-key-123', verify_ssl: false });

  await S.db.query("INSERT INTO roles (name, pages, can_write) VALUES ('ec_reader', '[\"endpoint-central\"]', FALSE)");
  const mk = async (email, role) => { const { rows } = await S.db.query('INSERT INTO users (email, full_name, password_hash, role) VALUES ($1,$1,$2,$3) RETURNING id', [email, 'x', role]); return jwt.sign({ sub: rows[0].id }, process.env.JWT_SECRET, { algorithm: 'HS256' }); };
  S.viewer = await mk('v@t', 'viewer'); S.reader = await mk('r@t', 'ec_reader'); S.manager = await mk('m@t', 'asset_manager');

  const app = express(); app.use(express.json()); app.use('/api', require('../src/routes')); app.use(require('../src/middleware/errorHandler'));
  S.http = http.createServer(app); await new Promise((r) => S.http.listen(0, '127.0.0.1', r)); S.base = `http://127.0.0.1:${S.http.address().port}`;
});

test.after(async () => {
  S.http?.close(); fake.server?.close(); fake.server?.closeAllConnections?.(); S.http?.closeAllConnections?.();
  if (S.db) await S.db.pool.end();
  await admin(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
});

const freshGroups = async () => { await S.db.query('DELETE FROM ec_custom_groups'); fake.groups = GROUPS(); fake.noGroups = false; fake.limit = null; resetCalls(); S.groups._setThrottle(S.throttle.createThrottle({ max: 1000, windowMs: 1000 })); };
const sync = async (opts) => S.groups.startSync(opts).finished;

// ---- tests ------------------------------------------------------------------------------------------------------------
test('status codes map exactly and "--" becomes null', () => {
  const [a, b, c] = COMPUTERS.map((x) => S.svc.mapComputer(x));
  assert.equal(b.status, 'Unknown'); assert.equal(b.live_status, 3);
  assert.equal(b.agent_install_text, 'Installation failed'); assert.equal(b.agent_install_status, 29);
  assert.equal(b.mac_address, null); assert.equal(b.agent_version, null); assert.equal(b.last_contact, null);
  assert.equal(a.status, 'Live'); assert.equal(a.agent_install_text, 'Installed'); assert.equal(a.os_platform, 'Windows'); assert.equal(a.last_contact, new Date(NOW).toISOString());
  assert.equal(c.status, 'Down'); assert.equal(c.agent_install_text, 'Yet to install'); assert.equal(S.svc.mapComputer({ os_platform: 3 }).os_platform, 'Linux');
  assert.equal(S.svc.mapComputer({ os_platform: 2 }).os_platform, 'Mac'); assert.equal(S.svc.mapComputer({ os_platform: 0 }).os_platform, 'Unknown');
  for (const [code, text] of [[21, 'Yet to install'], [22, 'Installed'], [23, 'Uninstalled'], [24, 'Yet to uninstall'], [29, 'Installation failed']]) assert.equal(S.svc.mapComputer({ agent_install_status: code }).agent_install_text, text);
});

test('first sync: one list call and one details call per computer group, Users groups skipped', async () => {
  await freshGroups();
  const r = await sync();
  assert.equal(fake.calls.list, 1); assert.equal(fake.calls.details, 3); assert.equal(r.calls, 4); assert.deepEqual(r.errors, []);
  const { rows } = await S.db.query('SELECT name, member_count, criteria, members_synced_at FROM ec_custom_groups ORDER BY group_id');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].member_count, 2); assert.equal(rows[1].member_count, 1);
  assert.equal(rows[3].members_synced_at, null);                     // Users group: never fetched
});

test('a dynamic group keeps its rule and has no member count', async () => {
  const { rows } = await S.db.query("SELECT member_count, criteria FROM ec_custom_groups WHERE name = 'Windows boxes'");
  assert.equal(rows[0].member_count, null); assert.equal(rows[0].criteria.pattern, '1 and 2'); assert.equal(rows[0].criteria.list[0].column, 'OS');
  assert.equal((await S.db.query('SELECT COUNT(*)::int AS n FROM ec_group_members WHERE group_id = 3')).rows[0].n, 0);
});

test('second sync with nothing changed makes one call; one changed group two; forced all', async () => {
  resetCalls(); await sync();
  assert.equal(fake.calls.list, 1); assert.equal(fake.calls.details || 0, 0);
  fake.groups[0].modified_on = 9999; resetCalls(); await sync();
  assert.equal(fake.calls.list, 1); assert.equal(fake.calls.details, 1);
  resetCalls(); await sync({ force: true });
  assert.equal(fake.calls.list, 1); assert.equal(fake.calls.details, 3);
});

test('a group deleted in EC disappears with its members; HTTP 204 means no groups', async () => {
  fake.groups = fake.groups.filter((g) => g.cg_name !== 'Laptops'); await sync();
  assert.equal((await S.db.query("SELECT COUNT(*)::int AS n FROM ec_custom_groups WHERE name = 'Laptops'")).rows[0].n, 0);
  assert.equal((await S.db.query('SELECT COUNT(*)::int AS n FROM ec_group_members WHERE group_id = 2')).rows[0].n, 0);
  fake.noGroups = true; await sync();
  assert.equal((await S.db.query('SELECT COUNT(*)::int AS n FROM ec_custom_groups')).rows[0].n, 0);
});

test('with the throttle a 3-calls-per-1.5s EC never answers 429', async () => {
  await freshGroups();
  fake.limit = { max: 3, windowMs: 1500 }; S.groups._setThrottle(S.throttle.createThrottle({ max: 3, windowMs: 1600 }));
  const r = await sync();
  assert.equal(fake.calls['429'] || 0, 0); assert.equal(r.stopped, null); assert.deepEqual(r.errors, []); assert.equal(r.synced, 3);
});

test('without the throttle EC answers 429 and the sync stops with a clear message', async () => {
  await freshGroups();
  fake.limit = { max: 3, windowMs: 1500 };
  const r = await sync();
  assert.ok(fake.calls['429'] >= 1); assert.match(r.stopped, /rate limiting.*5 minutes/i); assert.ok(r.synced < 3);
});

test('a single failing group is recorded and the sync carries on', async () => {
  await freshGroups();
  fake.groups.push({ cg_id: 9, cg_name: 'Ghost', cg_type: 'Static', cg_category: 'Computer', modified_on: 1 });   // details answer 404
  const r = await sync();
  assert.equal(r.errors.length, 1); assert.equal(r.errors[0].group, 'Ghost'); assert.equal(r.synced, 3); assert.equal(r.stopped, null);
});

test('the staged call sends the vendor Accept header and the approval status', async () => {
  resetCalls();
  const r = await call('GET', '/endpoint-central/staged?status=3', { token: S.manager });
  assert.equal(r.status, 200); assert.equal(fake.headers.staged, 'application/approvalComputersRes.v1+json'); assert.equal(fake.headers.stagedStatus, '3');
  assert.equal(r.json[0].name, 'NEW-PC'); assert.equal(r.json[0].mac_address, null); assert.equal(r.json[0].approval_status, 'Pending'); assert.equal(typeof r.json[0].in_inventory, 'boolean');
  await call('GET', '/endpoint-central/staged?status=3', { token: S.manager });
  assert.equal(fake.calls.staged, 1);                                 // the second request is served from the 60 s cache
  assert.equal((await call('GET', '/endpoint-central/staged?status=9', { token: S.manager })).status, 400);
});

test('permissions: no page access is 403; syncing needs write access; non-numeric group ids are rejected', async () => {
  assert.equal((await call('GET', '/endpoint-central', { token: S.viewer })).status, 403);
  assert.equal((await call('GET', '/endpoint-central/groups', { token: S.viewer })).status, 403);
  assert.equal((await call('GET', '/endpoint-central/groups', { token: S.reader })).status, 200);
  assert.equal((await call('POST', '/endpoint-central/groups/sync', { token: S.reader, body: {} })).status, 403);
  assert.equal((await call('GET', '/endpoint-central/groups/abc/members', { token: S.reader })).status, 400);
  await freshGroups();
  const started = await call('POST', '/endpoint-central/groups/sync', { token: S.manager, body: {} });
  assert.equal(started.status, 202);
  await waitIdle();
  assert.equal(S.groups.progress().last.synced, 3);
});

test('a second sync request while one runs is 409', async () => {
  await freshGroups();
  fake.limit = { max: 3, windowMs: 1500 }; S.groups._setThrottle(S.throttle.createThrottle({ max: 1, windowMs: 400 }));
  assert.equal((await call('POST', '/endpoint-central/groups/sync', { token: S.manager, body: {} })).status, 202);
  assert.equal((await call('POST', '/endpoint-central/groups/sync', { token: S.manager, body: {} })).status, 409);
  await waitIdle();
});

test('computers carry their group names, filtering by group returns only members, and EC is asked once per 60 s', async () => {
  await freshGroups(); await sync(); resetCalls();
  const all = await call('GET', '/endpoint-central', { token: S.manager });
  assert.equal(all.status, 200); assert.equal(all.json.total, 3); assert.equal(all.json.groups_synced, true);
  const byName = Object.fromEntries(all.json.rows.map((c) => [c.name, c.groups.map((g) => g.name)]));
  assert.deepEqual(byName['WEB-01.corp.local'], ['Servers']);       // matched by resource id
  assert.deepEqual(byName['DB-01'], ['Servers']); assert.deepEqual(byName['LAP-07'], ['Laptops']);
  assert.deepEqual(all.json.summary, { total: 3, live: 1, down: 1, unknown: 1, not_installed: 1, failed: 1 });
  assert.deepEqual(all.json.offices, ['HQ', 'Remote']);
  const servers = await call('GET', '/endpoint-central?group=1', { token: S.manager });
  assert.deepEqual(servers.json.rows.map((c) => c.name).sort(), ['DB-01', 'WEB-01.corp.local']);
  assert.equal((await call('GET', '/endpoint-central?group=none', { token: S.manager })).json.total, 0);
  assert.equal((await call('GET', '/endpoint-central?live=3', { token: S.manager })).json.rows[0].name, 'DB-01');
  assert.equal((await call('GET', '/endpoint-central?q=lap', { token: S.manager })).json.total, 1);
  assert.equal(fake.calls.computers, 1);
  assert.equal(fake.headers.computers, 'secret-key-123');
});

test('the API key is never returned to the browser', async () => {
  const cfg = await S.svc.getConfig();
  assert.equal(JSON.stringify(cfg).includes('secret-key-123'), false); assert.equal(cfg.has_api_key, true);
  const { rows } = await S.db.query("SELECT value::text AS v FROM app_settings WHERE key = 'endpoint_central'");
  assert.equal(rows[0].v.includes('secret-key-123'), false);
});
