// Static page keys (built-in screens). User-designed pages add dynamic keys of the form "page:<slug>".
const PAGES = [
  'dashboard', 'decommissioned', 'recycle-bin', 'search', 'migration', 'endpoint-central', 'software-status', 'nessus-status',
  'tenable', 'vmware', 'proxmox', 'weekly-report', 'data-health', 'reconcile',
  'admin-users', 'admin-roles', 'admin-user-page-control', 'admin-pages', 'admin-dropdowns',
  'admin-tag-ranges', 'admin-compliance', 'admin-teams', 'admin-migration-config', 'admin-endpoint-central',
  'admin-backup', 'admin-audit', 'admin-branding', 'admin-nav-order',
];
const ADMIN_PAGES = PAGES.filter((p) => p.startsWith('admin-'));
const USER_PAGES = PAGES.filter((p) => !p.startsWith('admin-'));
const VIEWER_PAGES = ['dashboard', 'decommissioned', 'search', 'migration', 'tenable', 'vmware', 'proxmox', 'weekly-report'];

// `dynamic` = also gets every user-designed page. Custom roles pick pages explicitly.
const BUILTIN_ROLES = {
  superadmin:    { pages: PAGES,        write: true,  dynamic: true, label: 'Superadmin' },
  admin:         { pages: PAGES,        write: true,  dynamic: true, label: 'Admin' },
  asset_manager: { pages: USER_PAGES,   write: true,  dynamic: true, label: 'Asset Manager' },
  viewer:        { pages: VIEWER_PAGES, write: false, dynamic: true, label: 'Viewer' },
};
const pageKey = (slug) => `page:${slug}`;

module.exports = { PAGES, ADMIN_PAGES, USER_PAGES, VIEWER_PAGES, BUILTIN_ROLES, pageKey };
