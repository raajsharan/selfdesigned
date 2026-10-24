const db = require('../config/db');
const { requestJson } = require('../utils/http');
const { decrypt } = require('../utils/crypto');

/** vSphere Automation REST API (vCenter 7.0U2+ / ESXi 7.0U2+). Falls back to the legacy /rest session path. */
async function openSession(server) {
  const base = `https://${server.host}`;
  const auth = 'Basic ' + Buffer.from(`${server.username}:${decrypt(server.password_encrypted)}`).toString('base64');
  const opt = { method: 'POST', headers: { Authorization: auth }, verifySsl: server.verify_ssl };
  let r = await requestJson(`${base}/api/session`, opt);
  if (r.status === 404) {
    r = await requestJson(`${base}/rest/com/vmware/cis/session`, opt);
    if (r.status === 200 && r.json) return { base, token: r.json.value, legacy: true, verifySsl: server.verify_ssl };
  }
  if (r.status === 401) throw new Error('Authentication failed (check username/password)');
  if (r.status >= 300 || !r.json) throw new Error(`Session request failed (HTTP ${r.status})`);
  return { base, token: r.json, legacy: false, verifySsl: server.verify_ssl };
}

const apiGet = async (s, path, soft = false) => {
  const url = s.legacy ? `${s.base}/rest${path.replace(/^\/api/, '')}` : `${s.base}${path}`;
  const r = await requestJson(url, { headers: { 'vmware-api-session-id': s.token }, verifySsl: s.verifySsl });
  if (r.status >= 300) { if (soft) return null; throw new Error(`${path} -> HTTP ${r.status}`); }
  return s.legacy && r.json && r.json.value !== undefined ? r.json.value : r.json;
};

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const normalizeNics = (nics) => (Array.isArray(nics) ? nics.map((n) => n.value || n) : Object.values(nics || {})).map((n) => n.mac_address).filter(Boolean);

async function fetchInventory(server) {
  const s = await openSession(server);
  try {
    const hostsRaw = (await apiGet(s, '/api/vcenter/host', true)) || [];
    const hostName = new Map(hostsRaw.map((h) => [h.host, h.name]));
    const folderName = new Map(((await apiGet(s, '/api/vcenter/folder', true)) || []).map((f) => [f.folder, f.name]));

    // Resolve cluster/datacenter by asking vCenter for VMs and hosts inside each cluster.
    const dcs = (await apiGet(s, '/api/vcenter/datacenter', true)) || [];
    const vmPlace = new Map(); const hostPlace = new Map();
    for (const dc of dcs) {
      const clusters = (await apiGet(s, `/api/vcenter/cluster?datacenters=${encodeURIComponent(dc.datacenter)}`, true)) || [];
      for (const cl of clusters) {
        for (const v of (await apiGet(s, `/api/vcenter/vm?clusters=${encodeURIComponent(cl.cluster)}`, true)) || []) vmPlace.set(v.vm, { cluster: cl.name, datacenter: dc.name });
        for (const h of (await apiGet(s, `/api/vcenter/host?clusters=${encodeURIComponent(cl.cluster)}`, true)) || []) hostPlace.set(h.host, { cluster: cl.name, datacenter: dc.name });
      }
      // Standalone hosts / VMs sit directly in the datacenter.
      for (const v of (await apiGet(s, `/api/vcenter/vm?datacenters=${encodeURIComponent(dc.datacenter)}`, true)) || []) if (!vmPlace.has(v.vm)) vmPlace.set(v.vm, { cluster: null, datacenter: dc.name });
      for (const h of (await apiGet(s, `/api/vcenter/host?datacenters=${encodeURIComponent(dc.datacenter)}`, true)) || []) if (!hostPlace.has(h.host)) hostPlace.set(h.host, { cluster: null, datacenter: dc.name });
    }

    const list = (await apiGet(s, '/api/vcenter/vm')) || [];
    const vms = await inChunks(list, 8, async (v) => {
      const d = (await apiGet(s, `/api/vcenter/vm/${v.vm}`, true)) || {};
      const g = (await apiGet(s, `/api/vcenter/vm/${v.vm}/guest/identity`, true)) || {};   // needs VMware Tools
      const place = vmPlace.get(v.vm) || {};
      const guestOs = (g.full_name && (g.full_name.default_message || g.full_name)) || d.guest_OS || null;
      return {
        moid: v.vm, name: v.name, power_state: v.power_state || d.power_state || null, ip_address: g.ip_address || null,
        mac_addresses: normalizeNics(d.nics), guest_os: typeof guestOs === 'string' ? guestOs : null,
        cpu_count: v.cpu_count || (d.cpu && d.cpu.count) || null, memory_mb: v.memory_size_MiB || (d.memory && d.memory.size_MiB) || null,
        host_name: d.placement && d.placement.host ? hostName.get(d.placement.host) || null : null,
        cluster: place.cluster || null, datacenter: place.datacenter || null,
        folder: d.placement && d.placement.folder ? folderName.get(d.placement.folder) || null : null,
        tools_status: (d.guest_OS && null) || null, snapshot_count: 0,   // REST API exposes no snapshot data
      };
    });
    const hosts = hostsRaw.map((h) => ({ moid: h.host, name: h.name, state: h.connection_state || h.power_state || null, ...(hostPlace.get(h.host) || { cluster: null, datacenter: null }) }));
    return { vms, hosts };
  } finally {
    // Best-effort session cleanup.
    requestJson(`${s.base}${s.legacy ? '/rest/com/vmware/cis/session' : '/api/session'}`, { method: 'DELETE', headers: { 'vmware-api-session-id': s.token }, verifySsl: s.verifySsl }).catch(() => {});
  }
}

async function discover(serverId) {
  const { rows } = await db.query('SELECT * FROM vmware_servers WHERE id = $1', [serverId]);
  const server = rows[0];
  if (!server) throw new Error('Server not found');
  try {
    const { vms, hosts } = await fetchInventory(server);
    await db.withTx(async (c) => {
      for (const v of vms) {
        await c.query(
          `INSERT INTO vmware_vms (server_id, moid, name, power_state, ip_address, mac_addresses, guest_os, cpu_count, memory_mb, host_name, cluster, datacenter, folder, tools_status, snapshot_count, last_seen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
           ON CONFLICT (server_id, moid) DO UPDATE SET name = EXCLUDED.name, power_state = EXCLUDED.power_state, ip_address = COALESCE(EXCLUDED.ip_address, vmware_vms.ip_address),
             mac_addresses = EXCLUDED.mac_addresses, guest_os = COALESCE(EXCLUDED.guest_os, vmware_vms.guest_os), cpu_count = EXCLUDED.cpu_count, memory_mb = EXCLUDED.memory_mb,
             host_name = EXCLUDED.host_name, cluster = EXCLUDED.cluster, datacenter = EXCLUDED.datacenter, folder = EXCLUDED.folder, last_seen = now()`,
          [serverId, v.moid, v.name, v.power_state, v.ip_address, v.mac_addresses, v.guest_os, v.cpu_count, v.memory_mb, v.host_name, v.cluster, v.datacenter, v.folder, v.tools_status, v.snapshot_count]);
      }
      for (const h of hosts) {
        await c.query(
          `INSERT INTO vmware_hosts (server_id, moid, name, cluster, datacenter, state, last_seen) VALUES ($1,$2,$3,$4,$5,$6, now())
           ON CONFLICT (server_id, moid) DO UPDATE SET name = EXCLUDED.name, cluster = EXCLUDED.cluster, datacenter = EXCLUDED.datacenter, state = EXCLUDED.state, last_seen = now()`,
          [serverId, h.moid, h.name, h.cluster, h.datacenter, h.state]);
      }
      await c.query('UPDATE vmware_servers SET last_discovery_at = now(), last_error = NULL WHERE id = $1', [serverId]);
    });
    return { server: server.name, vms: vms.length, hosts: hosts.length };
  } catch (e) {
    await db.query('UPDATE vmware_servers SET last_error = $2 WHERE id = $1', [serverId, String(e.message).slice(0, 500)]);
    throw e;
  }
}

async function test(server) { const s = await openSession(server); await requestJson(`${s.base}/api/session`, { method: 'DELETE', headers: { 'vmware-api-session-id': s.token }, verifySsl: s.verifySsl }).catch(() => {}); return true; }

module.exports = { discover, test };
