const bcrypt = require('bcrypt');
const db = require('../config/db');

const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

module.exports = async function ensureSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  if (!email || !password) return;
  const { rows } = await db.query("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1");
  if (rows.length) return;
  if (!STRONG.test(password)) {
    console.error('[superadmin] SUPERADMIN_PASSWORD is too weak (min 8 chars with upper, lower, digit) - skipped');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    "INSERT INTO users (email, full_name, password_hash, role, can_view_passwords) VALUES ($1,'Super Admin',$2,'superadmin',TRUE) ON CONFLICT (email) DO NOTHING",
    [email, hash]);
  console.log(`[superadmin] created ${email}`);
};
