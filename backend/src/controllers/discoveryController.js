// One controller factory for both hypervisor discovery pages (VMware vSphere, Proxmox VE).
const db = require('../config/db');
const { encrypt } = require('../utils/crypto');
const { sendCsv } = require('../utils/csv');
const { bad, notFound, conflict, forbidden } = require('../utils/httpError');
const { pageKey } = require('../config/pages');
const { getPageBySlug, roleKeys } = require('../services/pageService');
const { createFromData } = require('./recordController');
const { audit } = require('../services/auditService');
const teams = require('../services/teamsNotificationService');
const { loadInventoryIndex, classify, redact, macKey } = require('../services/reconcileService');

const MISSING = "(v.last_seen < COALESCE(s.last_discovery_at, now()) - interval '1 minute')";
const TYPES = {
  vmware: {
    serversTable: 'vmware_servers', vmsTable: 'vmware_vms', snapTable: 'vmware_snapshots', secrets: { password: 'password_encrypted' }, needs: (b) => (b.password ? null : 'password is required'),
    serverCols: ['name', 'host', 'username', 'verify_ssl', 'is_standalone_esxi', 'enabled'],
    view: `SELECT v.id, v.server_id, s.name AS server_name, v.moid AS ref, v.name, v.power_state AS state, v.ip_address, v.ip_source, v.mac_addresses, v.guest_os AS os,
      v.cpu_count, v.memory_mb, v.host_name AS host, v.cluster, v.datacenter, v.snapshot_count, v.last_seen, v.tools_status AS extra,
      (v.power_state = 'POWERED_OFF') AS is_off, ${MISSING} AS is_missing, FALSE AS is_template, v.folder
      FROM vmware_vms v JOIN vmware_servers s ON s.id = v.server_id`,
    offLabel: 'Powered off', svc: () => require('../services/vmwareService'), sched: () => require('../services/vmwareSchedulerService'),
  },
  proxmox: {
    serversTable: 'proxmox_servers', vmsTable: 'proxmox_vms', snapTable: 'proxmox_snapshots', secrets: { password: 'password_encrypted', token_secret: 'token_secret_encrypted' },
    needs: (b) => ((b.username && b.password) || (b.token_id && b.token_secret) ? null : 'Enter the username and password, or an API token ID and secret'),
    serverCols: ['name', 'host', 'port', 'username', 'realm', 'token_id', 'verify_ssl', 'enabled'],
    view: `SELECT v.id, v.server_id, s.name AS server_name, v.vmid::text AS ref, v.name, v.status AS state, v.ip_address, v.ip_source, v.mac_addresses, v.os_type AS os,
      v.cpu_count, v.memory_mb, v.node AS host, NULL::text AS cluster, s.name AS datacenter, v.snapshot_count, v.last_seen, v.type AS extra,
      (v.status = 'stopped') AS is_off, ${MISSING} AS is_missing, v.is_template, NULL::text AS folder
      FROM proxmox_vms v JOIN proxmox_servers s ON s.id = v.server_id`,
    offLabel: 'Stopped', svc: () => require('../services/proxmoxService'), sched: () => require('../services/proxmoxSchedulerService'),
  },
};

const guessOsType = (os = '') => (/windows/i.test(os) ? 'Windows' : /esxi/i.test(os) ? 'VMware ESXi' : /linux|ubuntu|debian|centos|rhel|red hat|suse|alma|rocky|l2[46]|other26|oracle/i.test(os) ? 'Linux' : null);

module.exports = function buildDiscoveryController(typeKey) {
  const T = TYPES[typeKey];
  const SECRET_COLS = Object.values(T.secrets);
  const secretOf = (row) => { const rest = { ...row }; let has = false; for (const c of SECRET_COLS) { has = has || !!row[c]; rest[c] = undefined; } return { ...rest, has_secret: has }; };

  function where(q) {
    const p = []; const w = ['TRUE'];
    if (q.state) { p.push(q.state); w.push(`state = $${p.length}`); }
    if (q.server_id) { p.push(parseInt(q.server_id, 10)); w.push(`server_id = $${p.length}`); }
    if (q.vm_id) { p.push(parseInt(q.vm_id, 10)); w.push(`id = $${p.length}`); }
    for (const c of ['cluster', 'host', 'datacenter']) if (q[c]) { p.push(q[c]); w.push(`${c} = $${p.length}`); }
    if (q.stale === '1') w.push('(is_missing OR is_off)');
    if (q.q) { p.push(`%${String(q.q).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(name ILIKE $${p.length} OR ip_address ILIKE $${p.length} OR os ILIKE $${p.length} OR array_to_string(mac_addresses, ',') ILIKE $${p.length})`); }
    return { sql: w.join(' AND '), p };
  }

  const servers = {
    list: async (req, res) => res.json((await db.query(`SELECT * FROM ${T.serversTable} ORDER BY name`)).rows.map(secretOf)),
    create: async (req, res) => {
      const missing = T.needs(req.body); if (missing) throw bad(missing[0].toUpperCase() + missing.slice(1));
      const cols = T.serverCols.filter((c) => req.body[c] !== undefined && req.body[c] !== '' && req.body[c] !== null);
      const secs = Object.keys(T.secrets).filter((f) => req.body[f]);
      const all = [...cols, ...secs.map((f) => T.secrets[f])];
      const { rows } = await db.query(
        `INSERT INTO ${T.serversTable} (${all.join(',')}) VALUES (${all.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        [...cols.map((c) => req.body[c]), ...secs.map((f) => encrypt(req.body[f]))]);
      audit(req, 'create', `${typeKey}_server`, rows[0].id, { name: rows[0].name });
      res.status(201).json(secretOf(rows[0]));
    },
    update: async (req, res) => {
      // The stored password / token must not be redirected: changing where it is sent needs the secret to be typed again.
      const { rows: now } = await db.query(`SELECT * FROM ${T.serversTable} WHERE id = $1`, [req.params.id]);
      if (!now[0]) throw notFound('Server not found');
      const same = (c) => String(req.body[c] ?? '') === String(now[0][c] ?? '');
      const moved = ['host', 'port', 'username', 'realm', 'token_id'].some((c) => T.serverCols.includes(c) && req.body[c] !== undefined && !same(c));
      const typed = Object.keys(T.secrets).filter((f) => req.body[f]);
      if (moved && !typed.length) throw bad('You changed where or how this server is reached. Enter the password (or token secret) again to save it.');
      const sets = []; const v = [];
      for (const c of T.serverCols) if (req.body[c] !== undefined) { v.push(req.body[c] === '' && !['name', 'host', 'realm', 'username'].includes(c) ? null : req.body[c]); sets.push(`${c} = $${v.length}`); }
      for (const f of typed) { v.push(encrypt(req.body[f])); sets.push(`${T.secrets[f]} = $${v.length}`); }
      if (!sets.length) throw bad('Nothing to update');
      v.push(req.params.id);
      const { rows } = await db.query(`UPDATE ${T.serversTable} SET ${sets.join(', ')} WHERE id = $${v.length} RETURNING *`, v);
      if (!rows[0]) throw notFound('Server not found');
      audit(req, 'update', `${typeKey}_server`, rows[0].id, { name: rows[0].name });
      res.json(secretOf(rows[0]));
    },
    remove: async (req, res) => {
      const { rows } = await db.query(`DELETE FROM ${T.serversTable} WHERE id = $1 RETURNING name`, [req.params.id]);
      if (!rows[0]) throw notFound('Server not found');
      audit(req, 'delete', `${typeKey}_server`, req.params.id, { name: rows[0].name });
      res.json({ ok: true });
    },
    test: async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM ${T.serversTable} WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw notFound('Server not found');
      try { await T.svc().test(rows[0]); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: `Connection failed: ${e.message}` }); }
    },
  };

  const discover = async (req, res) => {
    let results;
    if (req.params.serverId) {
      try { results = [{ ok: true, ...(await T.svc().discover(req.params.serverId)) }]; }
      catch (e) { if (/not found/i.test(e.message)) throw notFound(e.message); results = [{ ok: false, error: e.message }]; }
    } else results = await T.sched().runAll();
    audit(req, 'discover', typeKey, req.params.serverId || 'all', { results });
    res.json({ results });
  };

  const list = async (req, res) => {
    const { sql, p } = where(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const total = (await db.query(`SELECT COUNT(*)::int n FROM (${T.view}) t WHERE ${sql}`, p)).rows[0].n;
    const { rows } = await db.query(`SELECT * FROM (${T.view}) t WHERE ${sql} ORDER BY lower(name) LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p);
    const idx = await loadInventoryIndex();
    res.json({ rows: rows.map((v) => ({ ...v, in_inventory: classify({ name: v.name, ip: v.ip_address, macs: v.mac_addresses }, idx).status !== 'not_in_inventory' })), total, page, pageSize });
  };

  const exportCsv = async (req, res) => {
    const { sql, p } = where(req.query);
    const { rows } = await db.query(`SELECT * FROM (${T.view}) t WHERE ${sql} ORDER BY lower(name) LIMIT 50000`, p);
    audit(req, 'export', typeKey, null, { rows: rows.length });
    sendCsv(res, `${typeKey}-vms-${new Date().toISOString().slice(0, 10)}.csv`,
      [['server_name', 'Server'], ['name', 'Name'], ['state', 'State'], ['ip_address', 'IP'], ['mac_addresses', 'MAC addresses'], ['os', 'OS'], ['cpu_count', 'CPU'], ['memory_mb', 'Memory (MB)'],
       ['datacenter', 'Datacenter'], ['cluster', 'Cluster'], ['host', 'Host / Node'], ['snapshot_count', 'Snapshots'], ['last_seen', 'Last seen']].map(([key, label]) => ({ key, label })),
      rows.map((r) => ({ ...r, mac_addresses: (r.mac_addresses || []).join(' ') })));
  };

  const dashboard = async (req, res) => {
    const q = async (sql) => (await db.query(sql)).rows;
    const [totals] = await q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_off)::int AS off, COUNT(*) FILTER (WHERE is_missing)::int AS missing,
      COUNT(*) FILTER (WHERE snapshot_count > 0)::int AS with_snapshots, COALESCE(SUM(cpu_count),0)::int AS cpus, COALESCE(SUM(memory_mb),0)::bigint AS memory_mb FROM (${T.view}) t`);
    const idx = await loadInventoryIndex();
    const all = await q(`SELECT name, ip_address, mac_addresses FROM (${T.view}) t WHERE NOT is_template`);
    const notIn = all.filter((v) => classify({ name: v.name, ip: v.ip_address, macs: v.mac_addresses }, idx).status === 'not_in_inventory').length;
    res.json({ totals: { ...totals, memory_mb: Number(totals.memory_mb), not_in_inventory: notIn },
      by_state: await q(`SELECT COALESCE(state,'unknown') AS name, COUNT(*)::int AS n FROM (${T.view}) t GROUP BY 1 ORDER BY 2 DESC`),
      by_server: await q(`SELECT server_name AS name, COUNT(*)::int AS n FROM (${T.view}) t GROUP BY 1 ORDER BY 2 DESC`),
      by_os: await q(`SELECT COALESCE(os,'Unknown') AS name, COUNT(*)::int AS n FROM (${T.view}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
      by_host: await q(`SELECT COALESCE(host,'Unknown') AS name, COUNT(*)::int AS n FROM (${T.view}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`) });
  };

  const drift = async (req, res) => {
    const idx = await loadInventoryIndex();
    const { rows } = await db.query(`SELECT * FROM (${T.view}) t WHERE NOT is_template ORDER BY lower(name)`);
    const out = []; const summary = { in_sync: 0, drift: 0, not_in_inventory: 0 };
    for (const v of rows) {
      const c = redact(classify({ name: v.name, ip: v.ip_address, macs: v.mac_addresses }, idx), req.user);
      summary[c.status] += 1;
      if (c.status !== 'in_sync' || req.query.all === '1') out.push({ id: v.id, name: v.name, ip_address: v.ip_address, mac_addresses: v.mac_addresses, server_name: v.server_name, os: v.os, ...c });
    }
    res.json({ summary, rows: out.slice(0, 1000) });
  };

  const topology = async (req, res) => {
    const { rows } = await db.query(`SELECT COALESCE(datacenter,'(no datacenter)') AS dc, COALESCE(cluster,'(standalone)') AS cl, COALESCE(host,'(unknown host)') AS host,
      COUNT(*)::int AS vms, COUNT(*) FILTER (WHERE is_off)::int AS off FROM (${T.view}) t GROUP BY 1,2,3 ORDER BY 1,2,3`);
    const tree = {};
    for (const r of rows) {
      const dc = (tree[r.dc] ||= { name: r.dc, vms: 0, clusters: {} });
      const cl = (dc.clusters[r.cl] ||= { name: r.cl, vms: 0, hosts: [] });
      cl.hosts.push({ name: r.host, vms: r.vms, off: r.off });
      cl.vms += r.vms; dc.vms += r.vms;
    }
    res.json(Object.values(tree).map((d) => ({ ...d, clusters: Object.values(d.clusters) })));
  };

  const snapshots = async (req, res) => {
    const { rows } = await db.query(`SELECT s.id, s.name AS snapshot, s.description, s.created_at, v.id AS vm_id, v.name AS vm_name, v.server_name, v.host
      FROM ${T.snapTable} s JOIN (${T.view}) v ON v.id = s.vm_id ORDER BY s.created_at DESC NULLS LAST LIMIT 1000`);
    res.json({ rows, supported: typeKey === 'proxmox',
      note: typeKey === 'vmware' ? 'The vSphere REST API does not expose snapshot details, so snapshots are not collected for VMware yet.' : null });
  };

  const stale = async (req, res) => {
    const { rows } = await db.query(`SELECT *, CASE WHEN is_missing THEN 'Not seen in last discovery' ELSE '${T.offLabel}' END AS reason FROM (${T.view}) t WHERE (is_missing OR is_off) AND NOT is_template ORDER BY last_seen LIMIT 1000`);
    res.json(rows);
  };

  const macLookup = async (req, res) => {
    const key = macKey(req.query.mac);
    if (key.length < 6) throw bad('Enter at least 6 hex digits of a MAC address');
    const disc = (await db.query(`SELECT * FROM (${T.view}) t WHERE EXISTS (SELECT 1 FROM unnest(mac_addresses) m WHERE replace(replace(upper(m), ':', ''), '-', '') LIKE $1)`, [`%${key}%`])).rows;
    const idx = await loadInventoryIndex();
    const inv = idx.rows.filter((a) => req.user.pages.has(pageKey(a.source)) && macKey(a.mac_address).includes(key));   // only pages this user may open
    res.json({ discovered: disc, inventory: inv, mapping: await require('./macMappingController').lookup(key) });
  };

  // ---- "Filled" tab: Name, Status, IP, MAC, OS version, host IP. A VM without an IP gets it from the uploaded MAC mapping files.
  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const filledRows = async (req, q, limit, offset) => {
    const { sql, p } = where(q); const w = [sql, 'NOT is_template'];
    const empty = "(ip_address IS NULL OR ip_address = '')";
    if (q.ip === 'missing') w.push(empty); else if (q.ip === 'mapped') w.push("ip_source = 'mac_mapping'"); else if (q.ip === 'discovered') w.push(`NOT ${empty} AND ip_source IS NULL`);
    const base = `FROM (${T.view}) t WHERE ${w.join(' AND ')}`;
    const total = (await db.query(`SELECT COUNT(*)::int n ${base}`, p)).rows[0].n;
    const rows = (await db.query(`SELECT * ${base} ORDER BY lower(name)${limit ? ` LIMIT ${limit} OFFSET ${offset}` : ''}`, p)).rows;

    // Not saved yet (discovery has not run since the file was uploaded, nobody pressed Update): show what the mapping says, marked as pending.
    const map = await require('./macMappingController').lookupMacs(rows.filter((r) => !r.ip_address).flatMap((r) => r.mac_addresses || []));
    const mk = require('./macMappingController').macKeyOf;

    // Host IP: the host name when it is an IP; else the IP of the inventory record of that host (pages this user may open); else the server's address for a standalone host.
    const recs = (await db.query(`SELECT p.slug, r.hostname, r.vm_name, r.ip_address, r.department, r.location FROM inventory_records r JOIN inventory_pages p ON p.id = r.page_id
      WHERE r.is_deleted = FALSE AND r.is_decommissioned = FALSE AND r.ip_address IS NOT NULL`)).rows.filter((r) => req.user.pages.has(pageKey(r.slug)));
    const byName = new Map(); const byShort = new Map(); const short = (s) => String(s || '').toLowerCase().split('.')[0];
    for (const r of recs) for (const n of [r.hostname, r.vm_name]) if (n) { byName.set(String(n).toLowerCase(), r); byShort.set(short(n), r); }
    const servers = new Map((await db.query(`SELECT id, host${typeKey === 'vmware' ? ', is_standalone_esxi' : ''} FROM ${T.serversTable}`)).rows.map((s) => [s.id, s]));
    const nodes = typeKey === 'proxmox' ? new Map((await db.query(`SELECT server_id, COUNT(DISTINCT host)::int n FROM (${T.view}) t GROUP BY server_id`)).rows.map((r) => [r.server_id, r.n])) : null;
    const hostInfo = (v) => {   // { ip, department, location } of the host the VM runs on
      const h = v.host; if (!h) return { ip: null };
      const r = byName.get(String(h).toLowerCase()) || byShort.get(short(h)) || [...byName.values()].find((x) => x.ip_address === h) || null;
      const dep = r ? { department: r.department, location: r.location } : {};
      if (IPV4.test(h)) return { ip: h, ...dep };
      if (r) return { ip: r.ip_address, ...dep };
      const s = servers.get(v.server_id);
      if (s && ((typeKey === 'vmware' && s.is_standalone_esxi) || (typeKey === 'proxmox' && nodes.get(v.server_id) === 1))) return { ip: s.host };
      return { ip: null };
    };
    const idx = await loadInventoryIndex();
    const out = rows.map((v) => {
      let ip = v.ip_address || null; let source = v.ip_source === 'mac_mapping' ? 'mac_mapping' : ip ? 'discovered' : null; let pending = false;
      if (!ip) { const hit = (v.mac_addresses || []).map((m) => map.get(mk(m))).find(Boolean); if (hit) { ip = hit.ip; source = 'mac_mapping'; pending = true; } }
      const in_inventory = classify({ name: v.name, ip, macs: v.mac_addresses }, idx).status !== 'not_in_inventory';
      const hi = hostInfo(v);
      return { id: v.id, name: v.name, state: v.state, is_off: v.is_off, in_inventory, ip_address: ip, ip_source: source, pending, mac_addresses: v.mac_addresses || [], os: v.os, host: v.host, host_ip: hi.ip,
        host_department: hi.department || null, host_location: hi.location || null, cpu_count: v.cpu_count, memory_mb: v.memory_mb, cluster: v.cluster, datacenter: v.datacenter, server_name: v.server_name };
    });
    return { rows: out, total };
  };

  const filled = async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const { rows, total } = await filledRows(req, req.query, pageSize, (page - 1) * pageSize);
    const [s] = (await db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ip_source IS NULL AND ip_address <> '' AND ip_address IS NOT NULL)::int AS discovered,
      COUNT(*) FILTER (WHERE ip_source = 'mac_mapping')::int AS from_mapping, COUNT(*) FILTER (WHERE ip_address IS NULL OR ip_address = '')::int AS missing FROM (${T.view}) t WHERE NOT is_template`)).rows;
    res.json({ rows, total, page, pageSize, summary: s, pending: rows.filter((r) => r.pending).length });
  };

  const filledApply = async (req, res) => {
    const r = await require('./macMappingController').fillVmIps(T.vmsTable, req.body && req.body.server_id ? parseInt(req.body.server_id, 10) : null);
    audit(req, 'fill_ips', typeKey, null, r);
    res.json(r);
  };

  const filledCsv = async (req, res) => {
    const { rows } = await filledRows(req, req.query, 50000, 0);
    audit(req, 'export', `${typeKey}_filled`, null, { rows: rows.length });
    sendCsv(res, `${typeKey}-filled-${new Date().toISOString().slice(0, 10)}.csv`,
      [['name', 'Name'], ['status', 'Status'], ['ip_address', 'IP Address'], ['ip_from', 'IP from'], ['mac', 'MAC'], ['os', 'OS Version'], ['host_ip', 'Host IP Address'], ['host', 'Host'], ['server_name', 'Server']].map(([key, label]) => ({ key, label })),
      rows.map((r) => ({ ...r, status: (r.state || '').replace('POWERED_', '').toLowerCase(), ip_from: r.ip_source === 'mac_mapping' ? 'MAC mapping' : r.ip_source ? 'discovery' : '', mac: r.mac_addresses.join(' ') })));
  };

  const cleanOs = (s) => String(s || '').replace(/^microsoft\s+/i, '').replace(/\s*\((32|64)-bit\)/i, '').replace(/\s+/g, ' ').trim();
  /** Everything about a discovered VM that the "Add to inventory" form can be filled with. */
  const inventoryDefaults = async (req, res) => {
    const { rows } = await filledRows(req, { vm_id: req.params.id }, 1, 0);
    const v = rows[0]; if (!v) throw notFound('VM not found');
    const os_type = guessOsType(v.os) || null; const full = cleanOs(v.os);
    // OS version: the Dropdown Master value that the guest OS name contains (preferring the ones for this OS type), else the cleaned guest OS name.
    const vers = (await db.query("SELECT value, parent_value FROM dropdown_values WHERE category = 'os_version'")).rows;
    const low = full.toLowerCase();
    const pick = (list) => list.filter((x) => low.includes(String(x.value).toLowerCase())).sort((a, b) => b.value.length - a.value.length)[0];
    const hit = pick(vers.filter((x) => !x.parent_value || !os_type || String(x.parent_value).toLowerCase() === os_type.toLowerCase())) || pick(vers);
    res.json({
      name: v.name, hostname: v.name, ip_address: v.ip_address, ip_source: v.ip_source, mac_address: (v.mac_addresses || [])[0] || null, os_type, os_version: hit ? hit.value : full || null,
      server_status: v.is_off ? 'Inactive' : 'Active', host_name: v.host, host_ip: v.host_ip, cpu_count: v.cpu_count, memory_gb: v.memory_mb ? Math.round((v.memory_mb / 1024) * 10) / 10 : null,
      cluster: v.cluster, datacenter: v.datacenter, department: v.host_department, location: v.host_location,
    });
  };

  const addToInventory = async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM (${T.view}) t WHERE id = $1`, [req.params.id]);
    const v = rows[0];
    if (!v) throw notFound('VM not found');
    const o = req.body || {};
    if (!o.page) throw bad('Choose the page to add this VM to');
    const page = await getPageBySlug(o.page);
    if (page.kind !== 'records') throw bad('Choose a records page, not a view');
    if (!req.user.pages.has(pageKey(page.slug))) throw forbidden('You do not have access to that page');
    const rk = roleKeys(page);
    const mac = o.mac_address || (v.mac_addresses || [])[0];
    const idx = await loadInventoryIndex();
    const hit = classify({ name: v.name, ip: o.ip_address || v.ip_address, macs: mac ? [mac] : [] }, idx);
    if (hit.status !== 'not_in_inventory') {
      const seen = redact(hit, req.user);
      throw conflict(seen.asset.restricted ? 'Already in inventory (on a page you cannot open)' : `Already in inventory (${hit.asset.source} #${hit.asset.id}, matched by ${hit.matched_by})`);
    }
    // Fill whichever fields this page has, found by role. Roles the page does not define are simply skipped.
    const values = { name: o.vm_name || v.name, hostname: o.hostname || v.name, ip: o.ip_address || v.ip_address, mac, os: o.os_type || guessOsType(v.os) || v.os,
      status: o.server_status || (v.is_off ? 'Inactive' : 'Active'), department: o.department, location: o.location, asset_tag: o.asset_tag };
    const data = {};
    for (const [role, val] of Object.entries(values)) if (rk[role] && val) data[rk[role]] = val;
    // Details without a role (OS version, host, host IP, CPU, memory...) go into the page's field with a matching name, when it has one.
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const usable = (page.config.fields || []).filter((f) => !f.role && !['password', 'boolean', 'date', 'hostname_suggest'].includes(f.type));
    const named = (re) => usable.find((f) => re.test(norm(f.label)) || re.test(norm(f.key)));
    const extra = [
      [o.os_version, named(/^(os|operatingsystem)version$|^osver(sion)?$/)],
      [IPV4.test(String(o.host_ip || '')) ? o.host_ip : null, named(/^(host|hosted|esxi|hypervisor|parent|vmhost)(ed)?(server)?ip(address)?$|^ipof(the)?(esxi)?host$|^hostipaddress$/)],
      [o.host_name, named(/^(host|hostedon|esxihost|hypervisor|parenthost|hostserver|vmhost|hostmachine)$/)],
      [o.cpu_count, named(/^(vcpu|vcpus|cpu|cpus|cpucount|numcpu|numberofcpu|cpucores|cores)$/)],
      [o.memory_gb, named(/^(ram|memory|ramgb|memorygb|vmemory)$/)],
      [o.cluster, named(/^cluster$/)], [o.datacenter, named(/^datacenter$/)],
    ];
    for (const [val, f] of extra) if (f && val !== undefined && val !== null && val !== '' && data[f.key] === undefined) data[f.key] = val;
    if (!Object.keys(data).length) throw bad('That page has no fields with a recognised role (name, IP, MAC, ...) to fill in. Assign roles to fields in the page designer.');
    const row = await createFromData(page, data, req.user);
    audit(req, 'create', `page:${page.slug}`, row.id, { name: values.name, from: typeKey });
    teams.notify('asset_created', { title: `New record: ${values.name}`, status: 'good',
      facts: [['Page', page.title], ['Source', `${typeKey} discovery`], ['IP', values.ip], ['MAC', values.mac], ['By', req.user.email]] });
    res.status(201).json({ ok: true, id: row.id, page: page.slug });
  };

  const schedule = {
    get: async (req, res) => res.json(await T.sched().getSettings()),
    put: async (req, res) => { const v = await T.sched().saveSettings(req.body); audit(req, 'update', `${typeKey}_schedule`, null, v); res.json(v); },
  };

  // Editing a discovered VM's recorded IP / OS (kept in an audit table).
  const editVm = async (req, res) => {
    if (typeKey !== 'vmware') throw bad('Only VMware records can be edited here');
    const { rows } = await db.query('SELECT * FROM vmware_vms WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('VM not found');
    const map = { ip_address: 'ip_address', os: 'guest_os' };
    for (const [field, col] of Object.entries(map)) {
      if (req.body[field] === undefined || String(req.body[field] || '') === String(rows[0][col] || '')) continue;
      await db.query('INSERT INTO vmware_asset_edits (vm_id, field, old_value, new_value, edited_by) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, field, rows[0][col], req.body[field] || null, req.user.email]);
      await db.query(`UPDATE vmware_vms SET ${col} = $1 WHERE id = $2`, [req.body[field] || null, rows[0].id]);
    }
    audit(req, 'update', 'vmware_vm', rows[0].id, { name: rows[0].name });
    res.json({ ok: true });
  };

  return { servers, discover, list, exportCsv, dashboard, drift, topology, snapshots, stale, macLookup, filled, filledApply, filledCsv, inventoryDefaults, addToInventory, schedule, editVm };
};
