const { Pool } = require('pg');

/**
 * Database settings come from separate variables so the password can be changed on its own line:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 * Passing the password as a plain value means characters like @ : / # need no URL-encoding.
 * DATABASE_URL is still honoured if set (it overrides the separate variables).
 */
function readConfig() {
  const e = process.env;
  if (e.DATABASE_URL) {
    const u = new URL(e.DATABASE_URL);
    return { host: u.hostname, port: parseInt(u.port, 10) || 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
  }
  return { host: e.DB_HOST || 'localhost', port: parseInt(e.DB_PORT, 10) || 5432, user: e.DB_USER || 'postgres', password: e.DB_PASSWORD || '', database: e.DB_NAME || 'infrastructure_inventory' };
}
const dbConfig = readConfig();
if (!dbConfig.password) console.warn('[db] DB_PASSWORD is empty - this only works if PostgreSQL trusts local connections');

const pool = new Pool({ ...dbConfig, max: 20 });
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/** Run fn(client) inside a transaction. */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (t, p) => pool.query(t, p), withTx, dbConfig };
