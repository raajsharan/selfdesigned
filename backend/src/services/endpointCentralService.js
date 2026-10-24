const { requestJson } = require('../utils/http');
const { getSetting, setSetting } = require('./settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { bad } = require('../utils/httpError');

/*
 * ManageEngine Endpoint Central REST client.
 * Endpoint paths/field names follow the public EC REST API (v1.4). They vary slightly across EC builds,
 * so every mapping below falls back through several field names - verify against your server version.
 */
const KEY = 'endpoint_central';
const DEFAULTS = { base_url: '', auth_mode: 'apikey', api_key_enc: null, username: '', password_enc: null, token_enc: null, token_expires_at: null, api_prefix: null, verify_ssl: true, session_hours: 7 };
const PREFIXES = ['/api/1.4', '/api/1.3', '/api/1.2'];
const pending = new Map();           // userId -> { uid, expires }   (short-lived OTP handshake, memory only)
let cache = { at: 0, agents: null };

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
  cache = { at: 0, agents: null };
  return getConfig();
}

function authHeader(c) {
  if (c.auth_mode === 'apikey') { if (!c.api_key_enc) throw bad('No API key configured'); return { Authorization: decrypt(c.api_key_enc) }; }
  if (!c.token_enc || !c.token_expires_at || new Date(c.token_expires_at) <= new Date()) throw bad('Session expired - log in again from the Endpoint Central configuration');
  return { Authorization: decrypt(c.token_enc) };
}

async function detectPrefix(c) {
  if (c.api_prefix) return c.api_prefix;
  for (const p of PREFIXES) {
    const r = await requestJson(`${c.base_url}${p}/desktop/authentication`, { method: 'GET', verifySsl: c.verify_ssl }).catch(() => null);
    if (r && r.status && r.status < 500 && r.status !== 404) { c.api_prefix = p; await setSetting(KEY, c); return p; }
  }
  throw bad('Could not find the Endpoint Central REST API at that URL');
}

async function call(path) {
  const c = await load();
  if (!c.base_url) throw bad('Endpoint Central is not configured');
  const prefix = await detectPrefix(c);
  const r = await requestJson(`${c.base_url}${prefix}${path}`, { headers: authHeader(c), verifySsl: c.verify_ssl, timeoutMs: 30000 });
  if (r.status === 401 || r.status === 403) {
    if (c.auth_mode === 'credentials') { c.token_enc = null; await setSetting(KEY, c); }
    throw bad('Endpoint Central rejected the credentials / token');
  }
  if (r.status >= 300) throw bad(`Endpoint Central returned HTTP ${r.status}`);
  return r.json && r.json.message_response ? r.json.message_response : r.json;
}

async function pagedList(path, listKey) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const m = await call(`${path}${path.includes('?') ? '&' : '?'}pagelimit=500&page=${page}`);
    const items = (m && (m[listKey] || m.list)) || [];
    out.push(...items);
    if (items.length < 500 || (m && m.total && out.length >= m.total)) break;
  }
  return out;
}

const LIVE = { 1: 'Live', 2: 'Down', 3: 'Vulnerable' };
async function listAgents({ force = false } = {}) {
  if (!force && cache.agents && Date.now() - cache.at < 60000) return cache.agents;
  const raw = await pagedList('/som/computers', 'computers');
  cache = { at: Date.now(), agents: raw.map((a) => ({
    resource_id: a.resource_id,
    name: a.full_name || a.computer_name || a.name || a.fqdn_name || a.resource_name || null,
    ip_address: a.ip_address || null, mac_address: a.mac_address || null, os: a.os_name || a.os || null,
    agent_version: a.agent_version || null, branch_office: a.branch_office_name || null,
    status: LIVE[a.computer_live_status] || (a.computer_live_status ? String(a.computer_live_status) : 'Unknown'),
    last_contact: a.agent_last_contact_time ? new Date(Number(a.agent_last_contact_time)).toISOString() : null,
  })) };
  return cache.agents;
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
  cache = { at: 0, agents: null };
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

module.exports = { getConfig, saveConfig, listAgents, listSoftware, testConnection, login, submitOtp };
