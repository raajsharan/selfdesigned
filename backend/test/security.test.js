// Security regression tests against a running server (use a throw-away database, like smoke.test.js).
//   BASE_URL=http://localhost:4000 TEST_EMAIL=... TEST_PASSWORD=... node --test test/security.test.js
// Start the server in production mode to see the production behaviour (API docs hidden, strict secrets).
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const SUPER = { email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD };
const run = Date.now().toString(36);
const PW = 'Str0ng#Passw0rd-1';
const n = parseInt(run, 36);   // unique per run, so the tests can be repeated on the same database
const ip = (k) => `10.${(n >> 8) & 255}.${n & 255}.${k}`;

async function api(method, path, { token, body, raw, headers } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}
const login = async (email, password) => { const r = await api('POST', '/auth/login', { body: { email, password } }); assert.equal(r.status, 200, r.text); return r.json.token; };
const S = {};

test('setup: superadmin signs in', async () => { S.sa = await login(SUPER.email, SUPER.password); });

test('security headers, CORS and no framework banner', async () => {
  const r = await fetch(BASE + '/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.ok(r.headers.get('permissions-policy')?.includes('camera=()'));
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'an unknown origin must not be allowed');
});

test('malformed JSON does not echo parser internals', async () => {
  const r = await api('POST', '/auth/login', { raw: '{"email": ' });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'Invalid JSON body');
});

test('API docs are hidden in production', async () => {
  if (process.env.EXPECT_PRODUCTION === '0') return;
  assert.equal((await fetch(BASE + '/api/docs/')).status, 404);
});

test('protected routes refuse anonymous callers', async () => {
  for (const [m, p] of [['GET', '/users'], ['GET', '/roles'], ['GET', '/backup'], ['POST', '/backup/run'], ['GET', '/audit'], ['GET', '/pages'], ['GET', '/field-library'],
    ['GET', '/hostname-pattern'], ['GET', '/vmware/servers'], ['PUT', '/branding'], ['GET', '/dashboard'], ['GET', '/recycle-bin'], ['GET', '/endpoint-central/config']]) {
    const r = await api(m, p); assert.equal(r.status, 401, `${m} ${p} -> ${r.status}`);
  }
});

test('token revocation: changing the password ends other sessions; the changing session continues', async () => {
  const email = `rev-${run}@test.local`;
  assert.equal((await api('POST', '/users', { token: S.sa, body: { email, password: PW, role: 'asset_manager' } })).status, 201);
  const t1 = await login(email, PW); const t2 = await login(email, PW);
  assert.equal((await api('GET', '/auth/me', { token: t1 })).status, 200);
  const ch = await api('POST', '/auth/me/change-password', { token: t1, body: { current_password: PW, new_password: 'N3w#Passw0rd-22' } });
  assert.equal(ch.status, 200, ch.text); assert.ok(ch.json.token);
  assert.equal((await api('GET', '/auth/me', { token: t2 })).status, 401, 'the other session must be signed out');
  assert.equal((await api('GET', '/auth/me', { token: t1 })).status, 401, 'the old token of the changing session is replaced');
  assert.equal((await api('GET', '/auth/me', { token: ch.json.token })).status, 200, 'the fresh token works');
});

test('deactivating a user and an admin password reset sign that user out', async () => {
  const email = `deact-${run}@test.local`;
  const u = (await api('POST', '/users', { token: S.sa, body: { email, password: PW, role: 'viewer' } })).json;
  const t = await login(email, PW);
  assert.equal((await api('PUT', `/users/${u.id}`, { token: S.sa, body: { password: 'Res3t#Passw0rd-3' } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token: t })).status, 401);
  const t2 = await login(email, 'Res3t#Passw0rd-3');
  assert.equal((await api('PUT', `/users/${u.id}`, { token: S.sa, body: { is_active: false } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token: t2 })).status, 401);
});

test('changing the login email needs the current password', async () => {
  const email = `mail-${run}@test.local`;
  assert.equal((await api('POST', '/users', { token: S.sa, body: { email, password: PW, role: 'viewer' } })).status, 201);
  const t = await login(email, PW);
  const bad = await api('PUT', '/auth/me/profile', { token: t, body: { email: `new-${run}@test.local` } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /current password/i);
  const wrong = await api('PUT', '/auth/me/profile', { token: t, body: { email: `new-${run}@test.local`, current_password: 'nope' } });
  assert.equal(wrong.status, 400);
  assert.equal((await api('PUT', '/auth/me/profile', { token: t, body: { email: `new-${run}@test.local`, current_password: PW } })).status, 200);
  assert.equal((await api('PUT', '/auth/me/profile', { token: await login(`new-${run}@test.local`, PW), body: { full_name: 'Same email stays' , email: `new-${run}@test.local` } })).status, 200, 'an unchanged email needs no password');
});

test('delegated admin pages cannot be used to become or control an admin', async () => {
  // a custom role that holds the user-management pages but is not an administrator
  const role = `deleg_${run}`;
  assert.equal((await api('POST', '/roles', { token: S.sa, body: { name: role, pages: ['admin-users', 'admin-roles', 'admin-user-page-control', 'dashboard'], can_write: true } })).status, 201);
  const dEmail = `deleg-${run}@test.local`; const aEmail = `adm-${run}@test.local`;
  const d = (await api('POST', '/users', { token: S.sa, body: { email: dEmail, password: PW, role } })).json;
  const a = (await api('POST', '/users', { token: S.sa, body: { email: aEmail, password: PW, role: 'admin' } })).json;
  const v = (await api('POST', '/users', { token: S.sa, body: { email: `vw-${run}@test.local`, password: PW, role: 'viewer' } })).json;
  const dt = await login(dEmail, PW);
  assert.equal((await api('POST', '/users', { token: dt, body: { email: `x-${run}@test.local`, password: PW, role: 'admin' } })).status, 403, 'cannot create an admin');
  assert.equal((await api('PUT', `/users/${a.id}`, { token: dt, body: { password: 'Tak3#Over-Passw0rd' } })).status, 403, 'cannot reset an admin password');
  assert.equal((await api('PUT', `/users/${v.id}`, { token: dt, body: { role: 'admin' } })).status, 403, 'cannot promote someone to admin');
  assert.equal((await api('DELETE', `/users/${a.id}`, { token: dt })).status, 403, 'cannot delete an admin');
  assert.equal((await api('PUT', `/users/page-control/${a.id}`, { token: dt, body: { page_overrides: {}, can_view_passwords: true } })).status, 403, 'cannot edit an admin page access');
  assert.equal((await api('PUT', `/users/page-control/${d.id}`, { token: dt, body: { page_overrides: { 'admin-backup': true }, can_view_passwords: true } })).status, 403, 'cannot widen own access');
  // another user: granting a page the delegate does not have is silently dropped; passwords cannot be handed on
  const pc = await api('PUT', `/users/page-control/${v.id}`, { token: dt, body: { page_overrides: { 'admin-backup': true, dashboard: true }, can_view_passwords: true } });
  assert.equal(pc.status, 200, pc.text);
  const list = (await api('GET', '/users/page-control', { token: S.sa })).json.users.find((u) => u.id === v.id);
  assert.equal(list.page_overrides['admin-backup'], undefined, 'a page the delegate lacks must not be granted');
  assert.equal(list.can_view_passwords, false, 'a delegate without the password right cannot grant it');
  // roles: cannot grant pages it lacks, cannot edit the role it holds
  const mine = (await api('GET', '/roles', { token: S.sa })).json.roles.find((r) => r.name === role);
  assert.equal((await api('PUT', `/roles/${mine.id}`, { token: dt, body: { pages: ['admin-backup'], can_write: true } })).status, 403, 'cannot edit own role');
  const made = await api('POST', '/roles', { token: dt, body: { name: `child_${run}`, pages: ['admin-backup', 'dashboard'], can_write: true } });
  assert.equal(made.status, 201); assert.deepEqual(made.json.pages, ['dashboard'], 'only pages the delegate holds can be handed out');
  // the real admin can still do all of this
  assert.equal((await api('PUT', `/users/${v.id}`, { token: S.sa, body: { role: 'asset_manager' } })).status, 200);
});

test('VMware / Proxmox servers: strict host, and the secret cannot follow a changed host', async () => {
  for (const host of ['evil.com/x@y', 'http://evil.com', 'localhost', '127.0.0.1', '169.254.169.254', 'a b', 'evil.com:8443']) {
    const r = await api('POST', '/vmware/servers', { token: S.sa, body: { name: 'bad', host, username: 'u', password: 'p' } });
    assert.equal(r.status, 400, `${host} -> ${r.status} ${r.text}`);
  }
  const ok = await api('POST', '/vmware/servers', { token: S.sa, body: { name: `vc-${run}`, host: 'vcenter.example.com', username: 'svc', password: 'Secret#1' } });
  assert.equal(ok.status, 201, ok.text);
  const moved = await api('PUT', `/vmware/servers/${ok.json.id}`, { token: S.sa, body: { host: 'attacker.example.com' } });
  assert.equal(moved.status, 400); assert.match(moved.json.error, /again/);
  assert.equal((await api('PUT', `/vmware/servers/${ok.json.id}`, { token: S.sa, body: { name: `renamed-${run}` } })).status, 200, 'unchanged host needs no secret');
  assert.equal((await api('PUT', `/vmware/servers/${ok.json.id}`, { token: S.sa, body: { host: 'new-vc.example.com', password: 'Secret#2' } })).status, 200);
  const px = await api('POST', '/proxmox/servers', { token: S.sa, body: { name: `pve-${run}`, host: 'pve.example.com', port: 70000, token_id: 'root@pam!t', token_secret: 'x' } });
  assert.equal(px.status, 400, 'port out of range');
});

test('host rename: needs the view-passwords right, and never retargets a saved password', async () => {
  const slug = `ren-${run}`;
  const cfg = {
    fields: [
      { key: 'hostname', label: 'OS Hostname', type: 'text' }, { key: 'ip', label: 'IP Address', type: 'ip', required: true },
      { key: 'os_type', label: 'OS Type', type: 'select', options: ['Linux', 'Windows'] },
      { key: 'ssh_user', label: 'Username', type: 'text' }, { key: 'ssh_pass', label: 'Password', type: 'password' },
    ],
    form: { sections: [{ id: 's', title: 'D', columns: 2, items: ['hostname', 'ip', 'os_type', 'ssh_user', 'ssh_pass'].map((key) => ({ key })) }] },
    table: { columns: [{ key: 'hostname' }, { key: 'ip' }], filters: [], pageSize: 25, sort: { key: 'hostname', order: 'asc' } },
  };
  const pg = await api('POST', '/pages', { token: S.sa, body: { slug, title: `Ren ${run}`, config: cfg } });
  assert.equal(pg.status, 201, pg.text);
  const hp = (await api('GET', '/hostname-pattern', { token: S.sa })).json; const { locations, pages, ...keep } = hp;
  assert.equal((await api('PUT', '/hostname-pattern', { token: S.sa, body: { ...keep, rename_pages: [slug] } })).status, 200);

  const rec = { hostname: 'oldname', ip: ip(5), os_type: 'Linux', ssh_user: 'root', ssh_pass: 'Pw#12345' };
  const c = await api('POST', `/p/${slug}/records`, { token: S.sa, body: { data: rec } });
  assert.equal(c.status, 201, c.text);

  // a writer without the view-passwords right
  const wEmail = `wr-${run}@test.local`;
  assert.equal((await api('POST', '/users', { token: S.sa, body: { email: wEmail, password: PW, role: 'asset_manager' } })).status, 201);
  const wt = await login(wEmail, PW);
  const denied = await api('PUT', `/p/${slug}/records/${c.json.id}`, { token: wt, body: { data: { hostname: 'newname' }, apply_hostname: { reboot: true } } });
  assert.equal(denied.status, 200, denied.text);
  assert.match(denied.json.rename_skipped, /view passwords/i); assert.equal(denied.json.rename_job, undefined);

  // someone who may view passwords, but the IP was changed in the same save: the stored password must not follow it
  const retarget = await api('PUT', `/p/${slug}/records/${c.json.id}`, { token: S.sa, body: { data: { hostname: 'newname2', ip: ip(66) }, apply_hostname: { reboot: true } } });
  assert.equal(retarget.status, 200, retarget.text);
  assert.match(retarget.json.rename_skipped, /IP address was changed/i); assert.equal(retarget.json.rename_job, undefined);

  // a page that is not enabled for renaming
  const other = await api('POST', '/pages', { token: S.sa, body: { slug: `ren2-${run}`, title: `Ren2 ${run}`, config: cfg } });
  assert.equal(other.status, 201);
  const c2 = await api('POST', `/p/ren2-${run}/records`, { token: S.sa, body: { data: { ...rec, ip: ip(6) }, apply_hostname: { reboot: true } } });
  assert.equal(c2.status, 201); assert.match(c2.json.rename_skipped, /not enabled/i);
});

test('Ansible templating cannot be reached through a saved username or password', async () => {
  const { runPlaybook } = require('../src/services/ansibleRunner');
  for (const [username, password] of [['{{ 7*7 }}', 'x'], ['root', 'a{{ lookup("pipe","id") }}'], ['root', '{% if 1 %}x{% endif %}'], ['-oProxyCommand=x', 'x'], ['ro ot;id', 'x']]) {
    const r = await runPlaybook({ playbook: 'x.yml', marker: 'X', asset: { host: '10.0.0.1', os: 'linux', username, password }, vars: {} });
    assert.equal(r.kind, 'failed', `${username} / ${password}`); assert.match(r.msg, /username|template/i);
  }
});

test('the audit trail cannot be edited or deleted', async (t) => {
  // This talks to the database directly, so it only runs against a database named explicitly for tests, and never keeps a change.
  const name = process.env.TEST_DB_NAME;
  if (!name) return t.skip('set TEST_DB_NAME to the throw-away test database (and start the server on it) to run this check');
  const { Client } = require('pg');
  const c = new Client({ host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: name });
  await c.connect();
  try {
    for (const sql of ["UPDATE audit_logs SET action = 'x' WHERE id = (SELECT MIN(id) FROM audit_logs)", 'DELETE FROM audit_logs WHERE id = (SELECT MIN(id) FROM audit_logs)']) {
      await c.query('BEGIN');
      try { await assert.rejects(c.query(sql), /append-only/); } finally { await c.query('ROLLBACK'); }
    }
  } finally { await c.end(); }
});

test('a failed login is audited with the source address', async () => {
  const email = `nobody-${run}@test.local`;
  await api('POST', '/auth/login', { body: { email, password: 'wrong-Pass1' } });
  await new Promise((r) => setTimeout(r, 400));
  const rows = (await api('GET', '/audit?limit=50', { token: S.sa })).json;
  const list = Array.isArray(rows) ? rows : rows.rows || rows.items || [];
  const hit = list.find((x) => x.action === 'login_failed' && (x.user_email === email || x.details?.email === email));
  assert.ok(hit, 'login_failed entry'); assert.ok(hit.ip, 'with an IP address'); assert.equal(hit.details.reason, 'unknown_user');
});

test('per-account login lockout works without locking out other accounts', async () => {
  const victim = `lock-${run}@test.local`;
  assert.equal((await api('POST', '/users', { token: S.sa, body: { email: victim, password: PW, role: 'viewer' } })).status, 201);
  let last;
  for (let i = 0; i < 11; i++) last = await api('POST', '/auth/login', { body: { email: victim, password: 'wrong-Pass1' } });
  assert.equal(last.status, 429, 'the 11th wrong attempt for one account is throttled');
  assert.equal((await api('POST', '/auth/login', { body: { email: SUPER.email, password: SUPER.password } })).status, 200, 'another account is unaffected');
});
