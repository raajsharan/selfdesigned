const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const SQL_FILES = ['schema.sql', 'vmware_schema.sql', 'proxmox_schema.sql', 'tenable_schema.sql', 'vmware_asset_edits.sql'];

const DEFAULT_DROPDOWNS = {
  server_status:  ['Active', 'Inactive', 'Under Maintenance', 'NA', 'Not in Scope'],
  os_type:        ['Windows', 'Linux', 'VMware ESXi', 'Proxmox VE', 'Other'],
  location:       ['Hyderabad', 'Boston', 'Beijing', 'Data Center'],
  patching_type:  ['Manual', 'Automated', 'Vendor Managed', 'Not Applicable'],
  department:     ['IT', 'Engineering', 'Security', 'Operations'],
};

/** Applies every idempotent DDL file, then seeds defaults. Runs on each startup. */
async function ensureSchema() {
  const dir = process.env.DB_SCHEMA_DIR || path.resolve(__dirname, '../../../db');
  for (const file of SQL_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) { console.warn(`[schema] missing ${full}`); continue; }
    await db.query(fs.readFileSync(full, 'utf8'));
  }
  for (const [category, values] of Object.entries(DEFAULT_DROPDOWNS)) {
    for (let i = 0; i < values.length; i++) {
      await db.query(
        'INSERT INTO dropdown_values (category, value, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [category, values[i], i]);
    }
  }
  console.log('[schema] up to date');
}
module.exports = ensureSchema;
