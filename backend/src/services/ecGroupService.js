// Endpoint Central custom groups: copies the group list and the members of static groups into our database, in the background.
// EC allows 30 group calls a minute, so every call goes through the throttle and a group is fetched only when it changed.
const db = require('../config/db');
const ec = require('./endpointCentralService');
const { groupThrottle } = require('./ecThrottle');
const { makeScheduler } = require('./schedulerFactory');
const { conflict } = require('../utils/httpError');

let throttle = groupThrottle;
const idle = () => ({ running: false, phase: 'idle', done: 0, total: 0, errors: [], started_at: null });
let state = idle();
let last = null;       // result of the most recent run

const isUsers = (g) => /user/i.test(g.type || '') || /user/i.test(g.category || '');
const isDynamic = (g) => /dynamic/i.test(g.type || '');

async function saveGroups(list) {
  await db.withTx(async (c) => {
    for (const g of list) {
      await c.query(
        `INSERT INTO ec_custom_groups (group_id, name, group_type, category, domain, created_on, modified_on) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (group_id) DO UPDATE SET name = EXCLUDED.name, group_type = EXCLUDED.group_type, category = EXCLUDED.category,
           domain = EXCLUDED.domain, created_on = EXCLUDED.created_on, modified_on = EXCLUDED.modified_on`,
        [g.id, g.name, g.type, g.category, g.domain, g.created_on, g.modified_on]);
    }
    // Groups EC no longer lists are gone; their members go with them (ON DELETE CASCADE).
    await c.query('DELETE FROM ec_custom_groups WHERE group_id <> ALL($1::bigint[])', [list.map((g) => g.id)]);
  });
}

async function saveMembers(g, details) {
  await db.withTx(async (c) => {
    await c.query('DELETE FROM ec_group_members WHERE group_id = $1', [g.id]);
    const dynamic = isDynamic(g);
    if (!dynamic && details.members.length) {
      const m = details.members;
      await c.query(
        `INSERT INTO ec_group_members (group_id, resource_id, name, domain, os_platform)
         SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[]) ON CONFLICT DO NOTHING`,
        [g.id, m.map((x) => x.resource_id), m.map((x) => x.name), m.map((x) => x.domain), m.map((x) => x.os_platform)]);
    }
    // A dynamic group keeps only its rule: EC computes its members, so the count stays unknown (NULL).
    await c.query(
      `UPDATE ec_custom_groups SET member_count = $2, criteria = $3, members_synced_modified = $4, members_synced_at = now() WHERE group_id = $1`,
      [g.id, dynamic ? null : (await c.query('SELECT COUNT(*)::int AS n FROM ec_group_members WHERE group_id = $1', [g.id])).rows[0].n,
        dynamic && details.criteria ? JSON.stringify(details.criteria) : null, g.modified_on]);
  });
}

async function run(force) {
  const errors = state.errors; let calls = 0; let stopped = null; let synced = 0;
  const counted = { acquire: () => { calls++; return throttle.acquire(); } };
  state.phase = 'listing';
  const groups = await ec.listGroups(counted);
  await saveGroups(groups);

  const { rows: todo } = await db.query(
    `SELECT group_id AS id, name, group_type AS type, category, modified_on FROM ec_custom_groups
     WHERE ($1 OR members_synced_at IS NULL OR modified_on IS DISTINCT FROM members_synced_modified) ORDER BY name`, [force]);
  const work = todo.filter((g) => !isUsers(g)).map((g) => ({ ...g, id: Number(g.id), modified_on: g.modified_on === null ? null : Number(g.modified_on) }));
  state.phase = 'members'; state.total = work.length;
  for (const g of work) {
    try {
      await saveMembers(g, await ec.getGroupDetails(g.name, counted));
      synced++;
    } catch (e) {
      errors.push({ group: g.name, error: e.message });
      if (e.rateLimited) { stopped = e.message; break; }
    }
    state.done++;
  }
  return { groups: groups.length, synced, calls, errors, stopped };
}

/** Starts a background sync. Returns the progress object at once; 409 while one is running. */
function startSync({ force = false } = {}) {
  if (state.running) throw conflict('A sync is already running');
  state = { ...idle(), running: true, phase: 'starting', started_at: new Date().toISOString() };
  const finished = run(!!force).then((r) => ({ ...r, message: r.stopped || null }), (e) => ({ groups: 0, synced: 0, calls: 0, errors: [...state.errors, { group: null, error: e.message }], stopped: e.message, message: e.message }))
    .then((r) => { last = { ...r, forced: !!force, finished_at: new Date().toISOString() }; state = { ...state, running: false, phase: 'idle' }; return last; });
  return { progress: { ...state }, finished };
}

const progress = () => ({ ...state, errors: state.errors.slice(0, 20), last });

async function listGroups() {
  const { rows } = await db.query(
    `SELECT group_id AS id, name, group_type AS type, category, domain, created_on, modified_on, member_count, members_synced_at, criteria
     FROM ec_custom_groups ORDER BY lower(name)`);
  return rows.map((r) => ({ ...r, id: Number(r.id), created_on: r.created_on === null ? null : Number(r.created_on), modified_on: r.modified_on === null ? null : Number(r.modified_on),
    dynamic: isDynamic(r), users: isUsers(r) }));
}
const groupMembers = async (id) => (await db.query(
  'SELECT resource_id::text AS resource_id, name, domain, os_platform FROM ec_group_members WHERE group_id = $1 ORDER BY lower(name)', [id])).rows;
/** { resource_id -> [{ id, name }] } and { short lower name -> [{ id, name }] } for attaching groups to computers. */
async function membershipIndex() {
  const { rows } = await db.query(
    `SELECT m.resource_id::text AS rid, lower(m.name) AS lname, g.group_id::text AS gid, g.name AS gname
     FROM ec_group_members m JOIN ec_custom_groups g ON g.group_id = m.group_id`);
  const byId = new Map(); const byName = new Map(); const add = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const short = (n) => String(n || '').toLowerCase().split('.')[0];
  for (const r of rows) { const g = { id: Number(r.gid), name: r.gname }; add(byId, r.rid, g); add(byName, short(r.lname), g); }
  return { byId, byName, short, synced: (await db.query('SELECT 1 FROM ec_custom_groups WHERE members_synced_at IS NOT NULL LIMIT 1')).rowCount > 0 };
}

const scheduler = makeScheduler('ec_groups', async () => {
  try { await startSync({ force: false }).finished; } catch (e) { if (e.status !== 409) throw e; }
});

module.exports = { startSync, progress, listGroups, groupMembers, membershipIndex, scheduler, _setThrottle: (t) => { throttle = t; } };
