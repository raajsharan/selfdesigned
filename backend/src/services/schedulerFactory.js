const db = require('../config/db');
const { getSetting, setSetting } = require('./settingsService');

/**
 * Minimal in-process scheduler: wakes every minute and runs `run()` when enabled and due.
 * Settings (key `<name>_scheduler`): { enabled, interval_minutes, last_run }.
 */
function makeScheduler(name, run) {
  const key = `${name}_scheduler`;
  let timer = null; let running = false;
  const tick = async () => {
    if (running) return;
    try {
      const s = await getSetting(key, { enabled: false, interval_minutes: 360, last_run: null });
      if (!s.enabled) return;
      if (s.last_run && Date.now() - new Date(s.last_run).getTime() < s.interval_minutes * 60000) return;
      running = true;
      await run();
      await setSetting(key, { ...s, last_run: new Date().toISOString() });
    } catch (e) { console.error(`[${name}-scheduler]`, e.message); } finally { running = false; }
  };
  return {
    start() { if (!timer) { timer = setInterval(tick, 60000); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; },
    getSettings: () => getSetting(key, { enabled: false, interval_minutes: 360, last_run: null }),
    saveSettings: async (b) => {
      const cur = await getSetting(key, { enabled: false, interval_minutes: 360, last_run: null });
      return setSetting(key, { ...cur, enabled: !!b.enabled, interval_minutes: Math.min(10080, Math.max(15, parseInt(b.interval_minutes, 10) || cur.interval_minutes)) });
    },
  };
}

/** Discover every enabled server of a given table, continuing past individual failures. */
async function discoverAll(table, discoverFn) {
  const { rows } = await db.query(`SELECT id, name FROM ${table} WHERE enabled`);
  const results = [];
  for (const r of rows) {
    try { results.push({ ok: true, ...(await discoverFn(r.id)) }); } catch (e) { results.push({ ok: false, server: r.name, error: e.message }); }
  }
  return results;
}

module.exports = { makeScheduler, discoverAll };
