const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { getSetting, setSetting } = require('../services/settingsService');

const SQL_FILES = ['schema.sql', 'vmware_schema.sql', 'proxmox_schema.sql', 'tenable_schema.sql', 'vmware_asset_edits.sql'];

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
