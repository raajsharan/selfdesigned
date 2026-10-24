const db = require('../config/db');
const { requestJson } = require('../utils/http');
const { decrypt } = require('../utils/crypto');

const headers = (s) => ({ Authorization: `PVEAPIToken=${s.token_id}=${decrypt(s.token_secret_encrypted)}` });

async function pve(server, path, soft = false) {
  const r = await requestJson(`https://${server.host}:${server.port}/api2/json${path}`, { headers: headers(server), verifySsl: server.verify_ssl });
  if (r.status === 401 || r.status === 403) throw new Error(`Proxmox rejected the API token (HTTP ${r.status})`);
  if (r.status >= 300 || !r.json) { if (soft) return null; throw new Error(`${path} -> HTTP ${r.status}`); }
  return r.json.data;
}

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const MAC = /([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/;
function netInfo(config) {
  const macs = []; let ip = null;
  for (const [k, v] of Object.entries(config || {})) {
    if (!/^net\d+$/.test(k)) continue;
    const m = String(v).match(MAC); if (m) macs.push(m[1].toUpperCase());
    const ipm = String(v).match(/(?:^|,)ip=(\d+\.\d+\.\d+\.\d+)/);   // LXC static address
    if (ipm && !ip) ip = ipm[1];
  }
  return { macs, ip };
}

async function fetchInventory(server) {
  const resources = (await pve(server, '/cluster/resources?type=vm')) || [];
  return inChunks(resources, 6, async (r) => {
    const kind = r.type === 'lxc' ? 'lxc' : 'qemu';
    const cfg = (await pve(server, `/nodes/${r.node}/${kind}/${r.vmid}/config`, true)) || {};
    const { macs, ip: cfgIp } = netInfo(cfg);
    let ip = cfgIp;
    if (!ip && kind === 'qemu' && r.status === 'running') {
      const ag = await pve(server, `/nodes/${r.node}/qemu/${r.vmid}/agent/network-get-interfaces`, true);   // needs qemu-guest-agent
      const ifaces = (ag && ag.result) || [];
      for (const i of ifaces) {
        if (i.name === 'lo') continue;
        const v4 = (i['ip-addresses'] || []).find((a) => a['ip-address-type'] === 'ipv4');
        if (v4) { ip = v4['ip-address']; break; }
      }
    }
    const snaps = ((await pve(server, `/nodes/${r.node}/${kind}/${r.vmid}/snapshot`, true)) || []).filter((s) => s.name !== 'current');
    return {
      vmid: r.vmid, type: kind, name: r.name || cfg.hostname || null, node: r.node, status: r.status, ip_address: ip, mac_addresses: macs,
      os_type: cfg.ostype || null, cpu_count: r.maxcpu || null, memory_mb: r.maxmem ? Math.round(r.maxmem / 1048576) : null,
      disk_gb: r.maxdisk ? Math.round((r.maxdisk / 1073741824) * 10) / 10 : null, tags: r.tags || null, is_template: !!r.template,
      snapshots: snaps.map((s) => ({ name: s.name, description: s.description || null, created_at: s.snaptime ? new Date(s.snaptime * 1000) : null })),
    };
  });
}

async function discover(serverId) {
  const { rows } = await db.query('SELECT * FROM proxmox_servers WHERE id = $1', [serverId]);
  const server = rows[0];
  if (!server) throw new Error('Server not found');
  try {
    const vms = await fetchInventory(server);
    await db.withTx(async (c) => {
      for (const v of vms) {
        const { rows: r } = await c.query(
          `INSERT INTO proxmox_vms (server_id, vmid, type, name, node, status, ip_address, mac_addresses, os_type, cpu_count, memory_mb, disk_gb, tags, is_template, snapshot_count, last_seen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
           ON CONFLICT (server_id, vmid, type) DO UPDATE SET name = EXCLUDED.name, node = EXCLUDED.node, status = EXCLUDED.status,
             ip_address = COALESCE(EXCLUDED.ip_address, proxmox_vms.ip_address), mac_addresses = EXCLUDED.mac_addresses, os_type = EXCLUDED.os_type, cpu_count = EXCLUDED.cpu_count,
             memory_mb = EXCLUDED.memory_mb, disk_gb = EXCLUDED.disk_gb, tags = EXCLUDED.tags, is_template = EXCLUDED.is_template, snapshot_count = EXCLUDED.snapshot_count, last_seen = now()
           RETURNING id`,
          [serverId, v.vmid, v.type, v.name, v.node, v.status, v.ip_address, v.mac_addresses, v.os_type, v.cpu_count, v.memory_mb, v.disk_gb, v.tags, v.is_template, v.snapshots.length]);
        await c.query('DELETE FROM proxmox_snapshots WHERE vm_id = $1', [r[0].id]);
        for (const s of v.snapshots) await c.query('INSERT INTO proxmox_snapshots (vm_id, name, description, created_at) VALUES ($1,$2,$3,$4)', [r[0].id, s.name, s.description, s.created_at]);
      }
      await c.query('UPDATE proxmox_servers SET last_discovery_at = now(), last_error = NULL WHERE id = $1', [serverId]);
    });
    return { server: server.name, vms: vms.length };
  } catch (e) {
    await db.query('UPDATE proxmox_servers SET last_error = $2 WHERE id = $1', [serverId, String(e.message).slice(0, 500)]);
    throw e;
  }
}

async function test(server) { await pve(server, '/version'); return true; }
module.exports = { discover, test };
