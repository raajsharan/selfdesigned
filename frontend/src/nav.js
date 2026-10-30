import {
  DashboardOutlined, LayoutOutlined, StopOutlined, DeleteOutlined, SearchOutlined,
  SwapOutlined, SafetyCertificateOutlined, AppstoreOutlined, ToolOutlined, CloudOutlined, ClusterOutlined, BarChartOutlined,
  HeartOutlined, DiffOutlined, TeamOutlined, UserSwitchOutlined, SettingOutlined, FormOutlined, UnorderedListOutlined, BellOutlined,
  SaveOutlined, AuditOutlined, BgColorsOutlined, ControlOutlined, ProfileOutlined, NumberOutlined, ApiOutlined,
} from '@ant-design/icons';

// key = page key used by the backend for access control.
export const NAV = [
  { group: 'Inventory', items: [
    { key: 'dashboard', label: 'Dashboard', path: '/', icon: DashboardOutlined },
    { key: 'decommissioned', label: 'Decommissioned', path: '/decommissioned', icon: StopOutlined },
    { key: 'recycle-bin', label: 'Recycle Bin', path: '/recycle-bin', icon: DeleteOutlined },
    { key: 'search', label: 'Global Search', path: '/search', icon: SearchOutlined },
  ] },
  { group: 'Migration & Discovery', items: [
    { key: 'migration', label: 'Migration Tracker', path: '/migration', icon: SwapOutlined },
    { key: 'vmware', label: 'VMware Discovery', path: '/vmware', icon: CloudOutlined },
    { key: 'proxmox', label: 'Proxmox Discovery', path: '/proxmox', icon: ClusterOutlined },
  ] },
  { group: 'Security & Software', items: [
    { key: 'tenable', label: 'Tenable Report', path: '/tenable', icon: SafetyCertificateOutlined },
    { key: 'nessus-status', label: 'Nessus Agent Status', path: '/nessus-status', icon: ToolOutlined },
    { key: 'endpoint-central', label: 'Endpoint Central', path: '/endpoint-central', icon: AppstoreOutlined },
    { key: 'software-status', label: 'ME Status', path: '/software-status', icon: ApiOutlined },
  ] },
  { group: 'Reports', items: [
    { key: 'weekly-report', label: 'Weekly Report', path: '/weekly-report', icon: BarChartOutlined },
    { key: 'data-health', label: 'Data Health', path: '/data-health', icon: HeartOutlined },
    { key: 'reconcile', label: 'Reconcile', path: '/reconcile', icon: DiffOutlined },
  ] },
  { group: 'Administration', items: [
    { key: 'admin-users', label: 'Users', path: '/admin/users', icon: TeamOutlined },
    { key: 'admin-roles', label: 'Roles', path: '/admin/roles', icon: UserSwitchOutlined },
    { key: 'admin-user-page-control', label: 'User Page Control', path: '/admin/user-page-control', icon: ControlOutlined },
    { key: 'admin-pages', label: 'Page Designer', path: '/admin/pages', icon: LayoutOutlined },
    { key: 'admin-dropdowns', label: 'Dropdown Master', path: '/admin/dropdowns', icon: UnorderedListOutlined },
    { key: 'admin-tag-ranges', label: 'Department Tag Ranges', path: '/admin/tag-ranges', icon: NumberOutlined },
    { key: 'admin-compliance', label: 'Compliance Config', path: '/admin/compliance', icon: SettingOutlined },
    { key: 'admin-migration-config', label: 'Migration Config', path: '/admin/migration-config', icon: SwapOutlined },
    { key: 'admin-teams', label: 'Teams Notifications', path: '/admin/teams', icon: BellOutlined },
    { key: 'admin-backup', label: 'Backup & Restore', path: '/admin/backup', icon: SaveOutlined },
    { key: 'admin-audit', label: 'Audit Logs', path: '/admin/audit', icon: AuditOutlined },
    { key: 'admin-branding', label: 'Branding', path: '/admin/branding', icon: BgColorsOutlined },
    { key: 'admin-nav-order', label: 'Menu Order', path: '/admin/nav-order', icon: UnorderedListOutlined },
  ] },
];
export const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** key -> position in the saved order (kept on the server, set by the superadmin); keys never saved sort last, in default order. */
export const rankFrom = (order) => (k) => { const i = order.indexOf(k); return i === -1 ? 1e6 : i; };

/** Apply the saved order within each group. */
export function orderedGroups(allowed, order = []) {
  const rank = rankFrom(order);
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.key)).sort((a, b) => rank(a.key) - rank(b.key) || 0) })).filter((g) => g.items.length);
}
