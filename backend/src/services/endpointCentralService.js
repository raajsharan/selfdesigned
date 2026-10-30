const { requestJson } = require('../utils/http');
const { getSetting, setSetting } = require('./settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { bad, HttpError } = require('../utils/httpError');

/*
 * ManageEngine Endpoint Central REST client.
 * Endpoint paths/field names follow the public EC REST API (v1.4). They vary slightly across EC builds,
 * so every mapping below falls back through several field names - verify against your server version.
 */
const KEY = 'endpoint_central';
const DEFAULTS = { base_url: '', auth_mode: 'apikey', api_key_enc: null, username: '', password_enc: null, token_enc: null, token_expires_at: null, api_prefix: null, verify_ssl: true, session_hours: 7 };
const PREFIXES = ['/api/1.4', '/api/1.3', '/api/1.2'];
const pending = new Map();           // userId -> { uid, expires }   (short-lived OTP handshake, memory only)

const load = () => getSetting(KEY, DEFAULTS);
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

async function getConfig() {
  const c = await load();
  return { base_url: c.base_url, auth_mode: c.auth_mode, username: c.username, has_api_key: !!c.api_key_enc, has_password: !!c.password_enc,
    session_active: !!(c.token_enc && c.token_expires_at && new Date(c.token_expires_at) > new Date()), session_expires_at: c.token_expires_at,
    api_prefix: c.api_prefix, verify_ssl: c.verify_ssl };
}

async function saveConfig(b) {
  const c = await load();
  if (b.base_url !== undefined) {
    const u = clean(b.base_url);
    try { if (!/^https?:$/.test(new URL(u).protocol)) throw new Error(); } catch { throw bad('Server URL must start with http:// or https://'); }
    if (u !== c.base_url) { c.api_prefix = null; c.token_enc = null; c.token_expires_at = null; }
    c.base_url = u;
  }
  if (['apikey', 'credentials'].includes(b.auth_mode)) c.auth_mode = b.auth_mode;
  if (typeof b.verify_ssl === 'boolean') c.verify_ssl = b.verify_ssl;
  if (b.api_key) c.api_key_enc = encrypt(b.api_key);
  if (b.username !== undefined) c.username = String(b.username).slice(0, 128);
  if (b.password) c.password_enc = encrypt(b.password);
  await setSetting(KEY, c);
  computersCache.at = 0; computersCache.promise = null; stagedCache.clear();
  return getConfig();
}

function authHeader(c) {
  if (c.auth_mode === 'apikey') { if (!c.api_key_enc) throw bad('No API key configured'); return { Authorization: decrypt(c.api_key_enc) }; }
  if (!c.token_enc || !c.token_expires_at || new Date(c.token_expires_at) <= new Date()) throw bad('Session expired - log in again from the Endpoint Central configuration');
  return { Authorization: decrypt(c.token_enc) };
}

const CERT_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);
async function detectPrefix(c) {
  if (c.api_prefix) return c.api_prefix;
  let failure = null;
  for (const p of PREFIXES) {
    try {
      const r = await requestJson(`${c.base_url}${p}/desktop/authentication`, { method: 'GET', verifySsl: c.verify_ssl });
      if (r.status && r.status < 500 && r.status !== 404) { c.api_prefix = p; await setSetting(KEY, c); return p; }   // 405 and 401 both mean the API is there
    } catch (e) { failure = e; }
  }
  // A request that never got an answer says why; hiding it as "not found" sent people looking at the URL instead of the certificate.
  if (failure && CERT_CODES.has(failure.code)) throw bad(`The server's TLS certificate is not trusted (${failure.code}). Switch off "Verify TLS certificate", or make this server trust your certificate authority (NODE_EXTRA_CA_CERTS).`);
  if (failure) throw bad(`Could not reach Endpoint Central at that URL: ${failure.code || failure.message}`);
  throw bad('Could not find the Endpoint Central REST API at that URL');
}

/**
 * One GET against EC. `prefix` overrides the detected API prefix, `absolute` skips it (the /dcapi paths), `throttle` waits for a slot first.
 * Resolves { status, json }; 204 and an empty body give json null. 401/403/429 become friendly errors.
 */
async function request(path, { headers = {}, prefix, absolute = false, throttle } = {}) {
  const c = await load();
  if (!c.base_url) throw bad('Endpoint Central is not configured');
  const head = absolute ? '' : (prefix || await detectPrefix(c));
  const auth = authHeader(c);
  if (throttle) await throttle.acquire();
  const r = await requestJson(`${c.base_url}${head}${path}`, { headers: { ...auth, ...headers }, verifySsl: c.verify_ssl, timeoutMs: 30000 });
  if (r.status === 401 || r.status === 403) {
    if (c.auth_mode === 'credentials') { c.token_enc = null; await setSetting(KEY, c); }
    throw bad('Endpoint Central rejected the credentials. The key needs the SOM / Common read scope and an administrator account.');
  }
  if (r.status === 429) throw Object.assign(new HttpError(429, 'Endpoint Central is rate limiting this server. Wait 5 minutes and try again.'), { rateLimited: true });
  if (r.status >= 300) {
    const why = r.json && (r.json.error_description || r.json.message || (r.json.message_response && r.json.message_response.error_description)) || String(r.text || '').replace(/\s+/g, ' ').slice(0, 160);
    throw Object.assign(bad(`Endpoint Central returned HTTP ${r.status}${why ? `: ${why}` : ''}`), { ecStatus: r.status });
  }
  return { status: r.status, json: r.json };
}
async function call(path) {
  const { json } = await request(path);
  return json && json.message_response ? json.message_response : json;
}

// EC builds disagree on the page-size parameter name; the one that works is remembered.
const PAGE_PARAMS = ['pagelimit', 'limit'];
let pageParam = null;
async function pagedList(path, listKey) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const sep = path.includes('?') ? '&' : '?';
    let m;
    for (const name of pageParam ? [pageParam] : PAGE_PARAMS) {
      try { m = await call(`${path}${sep}${name}=500&page=${page}`); pageParam = name; break; }
      catch (e) { if (e.ecStatus !== 400 || pageParam || name === PAGE_PARAMS[PAGE_PARAMS.length - 1]) throw e; }
    }
    const items = (m && (m[listKey] || m.list)) || [];
    out.push(...items);
    if (items.length < 500 || (m && m.total && out.length >= m.total)) break;
  }
  return out;
}

// ---- value mapping. EC sends "--" for a missing value, epoch milliseconds for times, and field names that differ between builds.
const val = (x) => (x === undefined || x === null || String(x).trim() === '' || String(x).trim() === '--' ? null : x);
const num = (x) => { const v = val(x); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
const iso = (x) => { const n = num(x); return n && n > 0 ? new Date(n).toISOString() : null; };
const pick = (o, keys) => { for (const k of keys) { const v = val(o[k]); if (v !== null) return v; } return null; };
const text = (x) => (val(x) === null ? null : String(x));
const LIVE = { 1: 'Live', 2: 'Down', 3: 'Unknown' };
const INSTALL = { 21: 'Yet to install', 22: 'Installed', 23: 'Uninstalled', 24: 'Yet to uninstall', 29: 'Installation failed' };
const OS_PLATFORM = { 0: 'Unknown', 1: 'Windows', 2: 'Mac', 3: 'Linux' };
const platformName = (p) => (p === null ? null : OS_PLATFORM[p] || String(p));

const computersCache = { at: 0, promise: null };
function mapComputer(a) {
  const live = num(pick(a, ['live_status', 'computer_live_status']));
  const install = num(pick(a, ['agent_install_status', 'installation_status', 'agent_installation_status']));
  const platform = num(pick(a, ['os_platform', 'os_platform_id']));
  return {
    resource_id: num(a.resource_id), name: pick(a, ['full_name', 'computer_name', 'name', 'fqdn_name', 'resource_name']),
    ip_address: pick(a, ['ip_address']), mac_address: pick(a, ['mac_address']),
    os: pick(a, ['os_name', 'os']) || platformName(platform), os_platform: platformName(platform),
    agent_version: pick(a, ['agent_version']), branch_office: pick(a, ['branch_office_name', 'remote_office_name', 'branch_office']),
    domain: pick(a, ['domain_netbios_name', 'domain_name', 'domain']),
    live_status: live, status: LIVE[live] || 'Unknown',
    agent_install_status: install, agent_install_text: install === null ? null : INSTALL[install] || String(install),
    last_contact: iso(pick(a, ['agent_last_contact_time', 'last_contact_time'])),
  };
}
/** Every computer EC manages. Cached for 60 s, and callers arriving meanwhile share the one request. */
function listComputers({ force = false } = {}) {
  if (!force && computersCache.promise && Date.now() - computersCache.at < 60000) return computersCache.promise;
  const p = pagedList('/som/computers', 'computers').then((raw) => raw.map(mapComputer));
  computersCache.at = Date.now(); computersCache.promise = p;
  p.catch(() => { if (computersCache.promise === p) computersCache.promise = null; });
  return p;
}
const listAgents = listComputers;

// ---- staged computers (waiting for approval) and custom groups. Both share EC's 30 calls a minute limit.
const firstArray = (json) => {
  if (Array.isArray(json)) return json;
  const queue = [json]; let seen = 0;
  while (queue.length && seen++ < 200) {
    const o = queue.shift(); if (!o || typeof o !== 'object') continue;
    for (const k of ['computers', 'approvalComputers', 'approval_computers', 'data', 'results', 'result']) if (Array.isArray(o[k])) return o[k];
    for (const v of Object.values(o)) { if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v; if (v && typeof v === 'object') queue.push(v); }
  }
  return [];
};
const deepFind = (json, key) => {
  const queue = [json]; let seen = 0;
  while (queue.length && seen++ < 500) {
    const o = queue.shift(); if (!o || typeof o !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
    queue.push(...Object.values(o));
  }
  return undefined;
};
const STAGED = { 1: 'Approved', 2: 'Denied', 3: 'Pending' };
const stagedCache = new Map();
function mapStaged(a, status) {
  const platform = num(pick(a, ['os_platform', 'os_platform_id']));
  return {
    resource_id: num(pick(a, ['resource_id', 'computer_id', 'id'])), name: pick(a, ['computer_name', 'name', 'full_name', 'fqdn_name', 'resource_name']),
    ip_address: pick(a, ['ip_address', 'ip']), mac_address: pick(a, ['mac_address', 'mac']), domain: pick(a, ['domain_netbios_name', 'domain_name', 'domain']),
    os: pick(a, ['os_name', 'os']) || platformName(platform), agent_version: pick(a, ['agent_version']),
    branch_office: pick(a, ['branch_office_name', 'remote_office_name']), approval_status: STAGED[status],
    discovered_at: iso(pick(a, ['discovered_time', 'discovery_time', 'agent_last_contact_time', 'last_contact_time'])),
  };
}
/** Staged computers with the given approvalStatus (1 approved, 2 denied, 3 pending). Cached 60 s per status. */
function listStaged(status, { force = false, throttle = require('./ecThrottle').groupThrottle } = {}) {
  const hit = stagedCache.get(status);
  if (!force && hit && Date.now() - hit.at < 60000) return hit.promise;
  const p = (async () => {
    const out = [];
    for (let page = 1; page <= 40; page++) {
      const { json } = await request(`/dcapi/som/approval/computers-info?approvalStatus=${status}&page=${page}&limit=500`,
        { absolute: true, throttle, headers: { Accept: 'application/approvalComputersRes.v1+json' } });
      const items = firstArray(json); out.push(...items);
      if (items.length < 500) break;
    }
    return out.map((a) => mapStaged(a, status));
  })();
  stagedCache.set(status, { at: Date.now(), promise: p });
  p.catch(() => { if (stagedCache.get(status)?.promise === p) stagedCache.delete(status); });
  return p;
}

/** [{ id, name, type, category, domain, created_on, modified_on }] ; HTTP 204 means no groups. */
async function listGroups(throttle) {
  const { status, json } = await request('/customgroup/getCGList', { prefix: '/api/1.4', throttle, headers: { Accept: 'application/json' } });
  if (status === 204 || !json) return [];
  const list = deepFind(json, 'cg_list');
  return (Array.isArray(list) ? list : []).map((g) => ({
    id: num(pick(g, ['cg_id', 'group_id', 'resource_id', 'id'])), name: text(pick(g, ['cg_name', 'group_name', 'name'])),
    type: text(pick(g, ['cg_type', 'group_type', 'type'])), category: text(pick(g, ['cg_category', 'category', 'group_category'])),
    domain: text(pick(g, ['domain_name', 'domain'])), created_on: num(pick(g, ['created_on', 'creation_time', 'created_time'])), modified_on: num(pick(g, ['modified_on', 'last_modified_time', 'modified_time'])),
  })).filter((g) => g.id !== null && g.name);
}
/** { members: [{ resource_id, name, domain, os_platform }], criteria } for one group. A dynamic group gives only `criteria`. */
async function getGroupDetails(name, throttle) {
  const { json } = await request(`/customgroup/getCGDetails?cgName=${encodeURIComponent(name)}`, { prefix: '/api/1.4', throttle, headers: { Accept: 'application/json' } });
  const members = deepFind(json, 'groupMembers');
  const pattern = deepFind(json, 'criteriaPattern'); const list = deepFind(json, 'criteriaList');
  return {
    members: (Array.isArray(members) ? members : []).map((m) => ({
      resource_id: num(m.resourceId ?? m.resource_id), name: text(pick(m, ['name', 'computer_name'])), domain: text(pick(m, ['domainName', 'domain_name'])), platform: num(m.osPlatform ?? m.os_platform),
    })).filter((m) => m.resource_id !== null).map(({ platform, ...m }) => ({ ...m, os_platform: platformName(platform) })),
    criteria: pattern !== undefined || list !== undefined ? { pattern: val(pattern) ?? null, list: list ?? null } : null,
  };
}

async function listSoftware() {
  const raw = await pagedList('/inventory/installedsoftware', 'installedsoftware');
  return raw.map((s) => ({ name: s.software_name || s.name, version: s.software_version || s.version || null, vendor: s.manufacturer_name || s.vendor || null,
    installed_on: s.installed_computers ?? s.computers_count ?? null }));
}

async function testConnection() { await listAgentsPage(); return true; }
async function listAgentsPage() { await call('/som/computers?pagelimit=1&page=1'); }

// ---- credential login + TOTP -------------------------------------------------------------------
const tokenFrom = (m) => m && m.authentication && m.authentication.auth_data && m.authentication.auth_data.auth_token;

async function storeToken(c, token) {
  c.token_enc = encrypt(token);
  c.token_expires_at = new Date(Date.now() + (c.session_hours || 7) * 3600 * 1000).toISOString();
  await setSetting(KEY, c);
  computersCache.at = 0; computersCache.promise = null; stagedCache.clear();
}

async function login(userId) {
  const c = await load();
  if (!c.base_url || !c.username || !c.password_enc) throw bad('Save the server URL, username and password first');
  const prefix = await detectPrefix(c);
  const r = await requestJson(`${c.base_url}${prefix}/desktop/authentication`, { method: 'POST', verifySsl: c.verify_ssl,
    body: { username: c.username, password: Buffer.from(decrypt(c.password_enc)).toString('base64'), auth_type: 'local_authentication' } });
  const m = r.json && r.json.message_response;
  if (r.status >= 400 || !m) throw bad(`Login failed (HTTP ${r.status})`);
  const tf = m.authentication && m.authentication.two_factor_data;
  if (tf && tf.unique_userID) {
    pending.set(userId, { uid: tf.unique_userID, expires: Date.now() + 5 * 60000 });
    return { otp_required: true };
  }
  const token = tokenFrom(m);
  if (!token) throw bad('Login failed: no token returned');
  await storeToken(c, token);
  return { otp_required: false, session_active: true };
}

async function submitOtp(userId, otp) {
  const p = pending.get(userId);
  if (!p || p.expires < Date.now()) { pending.delete(userId); throw bad('The login attempt expired - start the login again'); }
  const c = await load();
  const prefix = await detectPrefix(c);
  const r = await requestJson(`${c.base_url}${prefix}/desktop/authentication/otpValidate`, { method: 'POST', verifySsl: c.verify_ssl, body: { uid: p.uid, otp } });
  const token = tokenFrom(r.json && r.json.message_response);
  if (r.status >= 400 || !token) throw bad('The 6-digit code was not accepted');
  pending.delete(userId);
  await storeToken(c, token);
  return { session_active: true };
}

module.exports = { getConfig, saveConfig, listAgents, listComputers, listStaged, listGroups, getGroupDetails, mapComputer, listSoftware, testConnection, login, submitOtp };
