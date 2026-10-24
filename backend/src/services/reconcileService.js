const db = require('../config/db');
const { unionSql } = require('../utils/inventoryUnion');

const macKey = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
const nameKey = (n) => String(n || '').trim().toLowerCase().split('.')[0];

/** Index of live (non-deleted, non-decommissioned) inventory assets for matching discovered VMs. */
async function loadInventoryIndex() {
  const { rows } = await db.query(unionSql('id, vm_name, hostname, ip_address, mac_address, os_type, asset_tag, department',
    'is_deleted = FALSE AND is_decommissioned = FALSE'));
  const idx = { rows, byMac: new Map(), byIp: new Map(), byName: new Map() };
  for (const r of rows) {
    if (r.mac_address) idx.byMac.set(macKey(r.mac_address), r);
    if (r.ip_address) idx.byIp.set(r.ip_address, r);
    for (const n of [r.vm_name, r.hostname]) if (n) idx.byName.set(nameKey(n), r);
  }
  return idx;
}

/** Match a discovered VM ({name, ip, macs[]}) to an inventory asset: MAC first, then IP, then name. */
function matchVm(vm, idx) {
  for (const m of vm.macs || []) { const hit = idx.byMac.get(macKey(m)); if (hit) return { asset: hit, by: 'mac' }; }
  if (vm.ip && idx.byIp.has(vm.ip)) return { asset: idx.byIp.get(vm.ip), by: 'ip' };
  if (vm.name && idx.byName.has(nameKey(vm.name))) return { asset: idx.byName.get(nameKey(vm.name)), by: 'name' };
  return null;
}

/** Classify a discovered VM against inventory. */
function classify(vm, idx) {
  const hit = matchVm(vm, idx);
  if (!hit) return { status: 'not_in_inventory' };
  const issues = [];
  if (vm.ip && hit.asset.ip_address && vm.ip !== hit.asset.ip_address) issues.push(`IP differs (discovered ${vm.ip}, inventory ${hit.asset.ip_address})`);
  if (hit.by !== 'mac' && (vm.macs || []).length && hit.asset.mac_address) issues.push('MAC differs');
  return { status: issues.length ? 'drift' : 'in_sync', matched_by: hit.by, asset: { source: hit.asset.source, id: hit.asset.id, tag: hit.asset.asset_tag }, issues };
}

module.exports = { loadInventoryIndex, matchVm, classify, macKey };
