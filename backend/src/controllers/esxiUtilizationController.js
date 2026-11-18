// ESXi utilization: capacity and current usage of every discovered ESXi host (read at discovery time), with the department and location of the
// matching inventory record. The page does the grouping and the percentages; this returns one row per host.
const db = require('../config/db');
const { pageKey } = require('../config/pages');
const { sendCsv } = require('../utils/csv');
const { audit } = require('../services/auditService');

const TIB = 1024 ** 4;
const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const shortName = (s) => String(s || '').toLowerCase().split('.')[0];

/** One row per host that has capacity data, plus how many discovered hosts have none yet. */
async function load(req) {
  const rows = (await db.query(
    `SELECT h.server_id, s.name AS server_name, s.host AS server_host, s.is_standalone_esxi, h.moid, h.name, h.cluster, h.datacenter, h.state,
            st.cpu_mhz_total, st.cpu_mhz_used, st.mem_mb_total, st.mem_mb_used, st.datastores, st.collected_at,
            (SELECT COUNT(*)::int FROM vmware_vms v WHERE v.server_id = h.server_id AND v.host_name = h.name) AS vms
     FROM vmware_hosts h JOIN vmware_servers s ON s.id = h.server_id LEFT JOIN vmware_host_stats st ON st.server_id = h.server_id AND st.moid = h.moid
     WHERE h.last_seen >= (SELECT MAX(h2.last_seen) FROM vmware_hosts h2 WHERE h2.server_id = h.server_id) - interval '1 day'   -- hosts that vanished from a server drop out
     ORDER BY lower(h.name)`)).rows;

  // Department and location come from the inventory record of the host (matched on hostname / name, short name or IP address), on pages this user may open.
  const recs = (await db.query(
    `SELECT p.slug, r.hostname, r.vm_name, r.ip_address, r.department, r.location FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id
     WHERE r.is_deleted = FALSE AND r.is_decommissioned = FALSE`)).rows.filter((r) => req.user.pages.has(pageKey(r.slug)));
  const byName = new Map(); const byShort = new Map(); const byIp = new Map();
  for (const r of recs) {
    for (const n of [r.hostname, r.vm_name]) if (n) { byName.set(String(n).toLowerCase(), r); byShort.set(shortName(n), r); }
    if (r.ip_address) byIp.set(r.ip_address, r);
  }
  const match = (h) => byName.get(String(h.name).toLowerCase()) || byIp.get(h.name) || byShort.get(shortName(h.name)) || (h.is_standalone_esxi ? byIp.get(h.server_host) || byName.get(String(h.server_host).toLowerCase()) : null) || null;

  const hosts = []; let withoutStats = 0;
  for (const h of rows) {
    if (h.cpu_mhz_total === null && h.mem_mb_total === null && !(h.datastores || []).length) { withoutStats++; continue; }
    const rec = match(h);
    const ds = (h.datastores || []).map((d) => ({ key: `${h.server_id}:${d.id}`, name: d.name, total_tb: round(d.capacity / TIB, 3), used_tb: round((d.capacity - (d.free || 0)) / TIB, 3) }));
    hosts.push({
      key: `${h.server_id}:${h.moid}`, name: h.name, server: h.server_name, cluster: h.cluster, datacenter: h.datacenter, state: h.state, vms: h.vms,
      department: (rec && rec.department) || 'Unassigned', location: (rec && rec.location) || 'Unknown', ip: rec ? rec.ip_address : null, in_inventory: !!rec,
      cpu_ghz_total: round(h.cpu_mhz_total / 1000, 2), cpu_ghz_used: round(h.cpu_mhz_used / 1000, 2),
      ram_gb_total: round(h.mem_mb_total / 1024, 1), ram_gb_used: round(h.mem_mb_used / 1024, 1),
      storage_tb_total: round(ds.reduce((n, d) => n + d.total_tb, 0), 3), storage_tb_used: round(ds.reduce((n, d) => n + d.used_tb, 0), 3), datastores: ds,
      collected_at: h.collected_at,
    });
  }
  const last = hosts.reduce((m, h) => (h.collected_at && (!m || h.collected_at > m) ? h.collected_at : m), null);
  return { hosts, without_stats: withoutStats, collected_at: last };
}

exports.get = async (req, res) => res.json(await load(req));

exports.csv = async (req, res) => {
  const { hosts } = await load(req);
  const pct = (u, t) => (t ? Math.round((u / t) * 100) : '');
  audit(req, 'export', 'esxi_utilization', null, { rows: hosts.length });
  sendCsv(res, `esxi-utilization-${new Date().toISOString().slice(0, 10)}.csv`,
    [['name', 'Host'], ['server', 'Server'], ['department', 'Department'], ['location', 'Location'], ['vms', 'VMs'],
      ['cpu_ghz_total', 'CPU total (GHz)'], ['cpu_ghz_used', 'CPU used (GHz)'], ['cpu_used_pct', 'CPU used %'], ['cpu_free_pct', 'CPU free %'],
      ['ram_gb_total', 'RAM total (GB)'], ['ram_gb_used', 'RAM used (GB)'], ['ram_used_pct', 'RAM used %'], ['ram_free_pct', 'RAM free %'],
      ['storage_tb_total', 'Storage total (TB)'], ['storage_tb_used', 'Storage used (TB)'], ['storage_used_pct', 'Storage used %'], ['storage_free_pct', 'Storage free %'], ['collected_at', 'Collected']].map(([key, label]) => ({ key, label })),
    hosts.map((h) => ({ ...h,
      cpu_used_pct: pct(h.cpu_ghz_used, h.cpu_ghz_total), cpu_free_pct: h.cpu_ghz_total ? 100 - pct(h.cpu_ghz_used, h.cpu_ghz_total) : '',
      ram_used_pct: pct(h.ram_gb_used, h.ram_gb_total), ram_free_pct: h.ram_gb_total ? 100 - pct(h.ram_gb_used, h.ram_gb_total) : '',
      storage_used_pct: pct(h.storage_tb_used, h.storage_tb_total), storage_free_pct: h.storage_tb_total ? 100 - pct(h.storage_tb_used, h.storage_tb_total) : '' })));
};
