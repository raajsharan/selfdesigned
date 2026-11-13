const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { getSetting, setSetting } = require('../services/settingsService');

const SQL_FILES = ['schema.sql', 'vmware_schema.sql', 'proxmox_schema.sql', 'tenable_schema.sql', 'vmware_asset_edits.sql', 'endpoint_central_schema.sql'];

const DEFAULT_DROPDOWNS = {
  server_status:  ['Active', 'Inactive', 'Under Maintenance', 'NA', 'Not in Scope'],
  os_type:        ['Windows', 'Linux', 'VMware ESXi', 'Proxmox VE', 'Other'],
  location:       ['Hyderabad', 'Boston', 'Beijing', 'Data Center'],
  patching_type:  ['Manual', 'Automated', 'Vendor Managed', 'Not Applicable'],
  department:     ['IT', 'Engineering', 'Security', 'Operations'],
};

// Starter OS versions, each linked to its OS type through parent_value (editable in Dropdown Master).
const DEFAULT_OS_VERSIONS = {
  'Windows':     ['Windows Server 2012 R2', 'Windows Server 2016', 'Windows Server 2019', 'Windows Server 2022', 'Windows Server 2025', 'Windows 10', 'Windows 11'],
  'Linux':       ['Ubuntu 20.04', 'Ubuntu 22.04', 'Ubuntu 24.04', 'RHEL 8', 'RHEL 9', 'CentOS 7', 'Debian 11', 'Debian 12', 'Rocky Linux 9'],
  'VMware ESXi': ['ESXi 6.7', 'ESXi 7.0', 'ESXi 8.0'],
  'Proxmox VE':  ['Proxmox VE 7', 'Proxmox VE 8', 'Proxmox VE 9'],
};

/** Applies every idempotent DDL file, then seeds defaults. Runs on each startup. */
async function ensureSchema() {
  const dir = process.env.DB_SCHEMA_DIR || path.resolve(__dirname, '../../../db');
  for (const file of SQL_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) { console.warn(`[schema] missing ${full}`); continue; }
    await db.query(fs.readFileSync(full, 'utf8'));
  }
  // Database-level guarantee that no two active records share an IP address (the app checks first; this closes the race between two saves).
  // If old data already holds duplicates the index cannot be built: say so and keep running on the application check alone.
  try {
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_records_active_ip ON inventory_records (ip_address)
                    WHERE ip_address IS NOT NULL AND ip_address <> '' AND is_deleted = FALSE AND is_decommissioned = FALSE`);
  } catch (e) { console.warn(`[schema] unique IP index not created (duplicate IP addresses already exist - see Admin > Data Health): ${e.message}`); }
  // Starter Field Library entries, seeded once so a deleted one stays deleted.
  if (!(await getSetting('seeded_field_library', {})).done) {
    const starter = [
      ['mac_address', { label: 'MAC Address', type: 'mac', role: 'mac', hint: 'Six pairs of hex digits, e.g. AA:BB:CC:DD:EE:FF' }],
      ['secondary_mac_address', { label: 'Secondary MAC Address', type: 'mac', hint: 'For a second network card' }],
      ['ip_address', { label: 'IP Address', type: 'ip', role: 'ip', hint: 'Must be unique across the whole inventory' }],
      ['serial_number', { label: 'Serial Number', type: 'text' }],
    ];
    for (const [i, [key, def]] of starter.entries()) await db.query('INSERT INTO field_library (key, def, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [key, JSON.stringify(def), i]);
    await setSetting('seeded_field_library', { done: true });
  }
  // Starter lists are seeded once, on a brand-new database. Seeding on every start brought back whatever an admin had deleted
  // in Dropdown Master. An existing install (it already has users or pages) is marked as seeded without adding anything.
  if (!(await getSetting('seeded_dropdowns', {})).done) {
    const { n } = (await db.query('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM inventory_pages) AS n')).rows[0];
    if (Number(n) === 0) {
      for (const [category, values] of Object.entries(DEFAULT_DROPDOWNS)) {
        for (let i = 0; i < values.length; i++) {
          await db.query(
            'INSERT INTO dropdown_values (category, value, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [category, values[i], i]);
        }
      }
      for (const [parent, versions] of Object.entries(DEFAULT_OS_VERSIONS)) {
        for (let i = 0; i < versions.length; i++) {
          await db.query(
            "INSERT INTO dropdown_values (category, value, sort_order, parent_value) VALUES ('os_version',$1,$2,$3) ON CONFLICT DO NOTHING", [versions[i], i, parent]);
        }
      }
    }
    await setSetting('seeded_dropdowns', { done: true });
  }
  // One-time: pages' fields that mean "IP address" become the IP address type (x.x.x.x). Admins can change them back afterwards.
  if (!(await getSetting('migrated_ip_field_type', {})).done) {
    await db.query(`UPDATE inventory_pages SET config = jsonb_set(config, '{fields}',
        (SELECT jsonb_agg(CASE WHEN f->>'role' = 'ip' AND f->>'type' = 'text' THEN jsonb_set(f, '{type}', '"ip"') ELSE f END) FROM jsonb_array_elements(config->'fields') f))
      WHERE jsonb_typeof(config->'fields') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(config->'fields') f WHERE f->>'role' = 'ip' AND f->>'type' = 'text')`);
    await setSetting('migrated_ip_field_type', { done: true });
  }
  console.log('[schema] up to date');
}
module.exports = ensureSchema;
