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
const { loadInventoryIndex, classify, macKey } = require('../services/reconcileService');

const MISSING = "(v.last_seen < COALESCE(s.last_discovery_at, now()) - interval '1 minute')";
const TYPES = {
  vmware: {
    serversTable: 'vmware_servers', vmsTable: 'vmware_vms', snapTable: 'vmware_snapshots', secretCol: 'password_encrypted', secretField: 'password',
    serverCols: ['name', 'host', 'username', 'verify_ssl', 'is_standalone_esxi', 'enabled'],
    view: `SELECT v.id, v.server_id, s.name AS server_name, v.moid AS ref, v.name, v.power_state AS state, v.ip_address, v.mac_addresses, v.guest_os AS os,
      v.cpu_count, v.memory_mb, v.host_name AS host, v.cluster, v.datacenter, v.snapshot_count, v.last_seen, v.tools_status AS extra,
      (v.power_state = 'POWERED_OFF') AS is_off, ${MISSING} AS is_missing, FALSE AS is_template, v.folder
      FROM vmware_vms v JOIN vmware_servers s ON s.id = v.server_id`,
    offLabel: 'Powered off', svc: () => require('../services/vmwareService'), sched: () => require('../services/vmwareSchedulerService'),
  },
  proxmox: {
    serversTable: 'proxmox_servers', vmsTable: 'proxmox_vms', snapTable: 'proxmox_snapshots', secretCol: 'token_secret_encrypted', secretField: 'token_secret',
    serverCols: ['name', 'host', 'port', 'token_id', 'verify_ssl', 'enabled'],
    view: `SELECT v.id, v.server_id, s.name AS server_name, v.vmid::text AS ref, v.name, v.status AS state, v.ip_address, v.mac_addresses, v.os_type AS os,
      v.cpu_count, v.memory_mb, v.node AS host, NULL::text AS cluster, s.name AS datacenter, v.snapshot_count, v.last_seen, v.type AS extra,
      (v.status = 'stopped') AS is_off, ${MISSING} AS is_missing, v.is_template, NULL::text AS folder
      FROM proxmox_vms v JOIN proxmox_servers s ON s.id = v.server_id`,
    offLabel: 'Stopped', svc: () => require('../services/proxmoxService'), sched: () => require('../services/proxmoxSchedulerService'),
  },
};

const guessOsType = (os = '') => (/windows/i.test(os) ? 'Windows' : /esxi/i.test(os) ? 'VMware ESXi' : /linux|ubuntu|debian|centos|rhel|red hat|suse|alma|rocky|l2[46]|other26|oracle/i.test(os) ? 'Linux' : null);

module.exports = function buildDiscoveryController(typeKey) {
  const T = TYPES[typeKey];
  const secretOf = ({ [T.secretCol]: s, ...rest }) => ({ ...rest, has_secret: !!s });

  function where(q) {
    const p = []; const w = ['TRUE'];
    if (q.state) { p.push(q.state); w.push(`state = $${p.length}`); }
    if (q.server_id) { p.push(parseInt(q.server_id, 10)); w.push(`server_id = $${p.length}`); }
    for (const c of ['cluster', 'host', 'datacenter']) if (q[c]) { p.push(q[c]); w.push(`${c} = $${p.length}`); }
    if (q.stale === '1') w.push('(is_missing OR is_off)');
    if (q.q) { p.push(`%${String(q.q).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(name ILIKE $${p.length} OR ip_address ILIKE $${p.length} OR os ILIKE $${p.length} OR array_to_string(mac_addresses, ',') ILIKE $${p.length})`); }
    return { sql: w.join(' AND '), p };
  }

  const servers = {
    list: async (req, res) => res.json((await db.query(`SELECT * FROM ${T.serversTable} ORDER BY name`)).rows.map(secretOf)),
    create: async (req, res) => {
      if (!req.body[T.secretField]) throw bad(`${T.secretField.replace('_', ' ')} is required`);
      const cols = T.serverCols.filter((c) => req.body[c] !== undefined);
      const vals = cols.map((c) => req.body[c]);
      const { rows } = await db.query(
        `INSERT INTO ${T.serversTable} (${[...cols, T.secretCol].join(',')}) VALUES (${[...cols, T.secretCol].map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        [...vals, encrypt(req.body[T.secretField])]);
      audit(req, 'create', `${typeKey}_server`, rows[0].id, { name: rows[0].name });
      res.status(201).json(secretOf(rows[0]));
    },
    update: async (req, res) => {
      const sets = []; const v = [];
      for (const c of T.serverCols) if (req.body[c] !== undefined) { v.push(req.body[c]); sets.push(`${c} = $${v.length}`); }
      if (req.body[T.secretField]) { v.push(encrypt(req.body[T.secretField])); sets.push(`${T.secretCol} = $${v.length}`); }
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
      const c = classify({ name: v.name, ip: v.ip_address, macs: v.mac_addresses }, idx);
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
    const inv = idx.rows.filter((a) => macKey(a.mac_address).includes(key));
    res.json({ discovered: disc, inventory: inv });
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
    if (hit.status !== 'not_in_inventory') throw conflict(`Already in inventory (${hit.asset.source} #${hit.asset.id}, matched by ${hit.matched_by})`);
    // Fill whichever fields this page has, found by role. Roles the page does not define are simply skipped.
    const values = { name: o.vm_name || v.name, hostname: o.hostname || v.name, ip: o.ip_address || v.ip_address, mac, os: o.os_type || guessOsType(v.os) || v.os,
      status: o.server_status || (v.is_off ? 'Inactive' : 'Active'), department: o.department, location: o.location, asset_tag: o.asset_tag };
    const data = {};
    for (const [role, val] of Object.entries(values)) if (rk[role] && val) data[rk[role]] = val;
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

  return { servers, discover, list, exportCsv, dashboard, drift, topology, snapshots, stale, macLookup, addToInventory, schedule, editVm };
};
