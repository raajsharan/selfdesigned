const db = require('../config/db');

async function getSetting(key, fallback = {}) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? { ...fallback, ...rows[0].value } : { ...fallback };
}
async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  return value;
}
module.exports = { getSetting, setSetting };
