const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${encodeURIComponent(process.env.DB_PASSWORD || '')}` +
    `@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'inventory_new'}`;

const pool = new Pool({ connectionString, max: 20 });
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

module.exports = { pool, query: (t, p) => pool.query(t, p), withTx, connectionString };
