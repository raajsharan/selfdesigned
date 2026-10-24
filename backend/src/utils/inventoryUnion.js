/**
 * Query helper over every records page. `source` is the page slug.
 * `cols` and `where` must be trusted constants (never user input); values go through $n params.
 * Columns are the promoted role columns (vm_name, hostname, ip_address, mac_address, asset_tag, server_status,
 * os_type, department, location, asset_owner, patching_type, last_patched_at) plus id, flags and timestamps.
 */
function unionSql(cols, where = 'TRUE') {
  return `SELECT (SELECT p.slug FROM inventory_pages p WHERE p.id = r.page_id) AS source, ${cols} FROM inventory_records r WHERE ${where}`;
}
module.exports = { unionSql };
