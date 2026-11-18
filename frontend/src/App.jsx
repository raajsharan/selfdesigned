import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Result, Spin } from 'antd';
import { useAuth } from './context/AuthContext';
import AppLayout from './components/Layout/AppLayout';
import Login from './pages/Login';
import LockScreen from './pages/LockScreen';
const Profile = lazy(() => import('./pages/Profile'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PageHost = lazy(() => import('./pages/PageHost'));
const PagesAdmin = lazy(() => import('./pages/Admin/PagesAdmin'));
const HostnamePattern = lazy(() => import('./pages/Admin/HostnamePattern'));
const MacMapping = lazy(() => import('./pages/Admin/MacMapping'));
const FieldLibrary = lazy(() => import('./pages/Admin/FieldLibrary'));
const PageDesigner = lazy(() => import('./pages/Admin/PageDesigner'));
const Decommissioned = lazy(() => import('./pages/Decommissioned/Decommissioned'));
const RecycleBin = lazy(() => import('./pages/RecycleBin'));
const GlobalSearch = lazy(() => import('./pages/GlobalSearch'));
const MigrationTracker = lazy(() => import('./pages/MigrationTracker'));
const EsxiUtilization = lazy(() => import('./pages/EsxiUtilization'));
const VMwareDiscovery = lazy(() => import('./pages/VMwareDiscovery'));
const ProxmoxDiscovery = lazy(() => import('./pages/ProxmoxDiscovery'));
const TenableReport = lazy(() => import('./pages/TenableReport'));
const NessusStatus = lazy(() => import('./pages/NessusStatus'));
const EndpointCentral = lazy(() => import('./pages/EndpointCentral'));
const MEStatus = lazy(() => import('./pages/MEStatus'));
const WeeklyReport = lazy(() => import('./pages/WeeklyReport'));
const DataHealth = lazy(() => import('./pages/Admin/DataHealth'));
const Reconcile = lazy(() => import('./pages/Reconcile'));
const Users = lazy(() => import('./pages/Admin/Users'));
const Roles = lazy(() => import('./pages/Admin/Roles'));
const UserPageControl = lazy(() => import('./pages/Admin/UserPageControl'));
const Dropdowns = lazy(() => import('./pages/Admin/Lookups').then((m) => ({ default: m.Dropdowns })));
const TagRanges = lazy(() => import('./pages/Admin/Lookups').then((m) => ({ default: m.TagRanges })));
const ComplianceConfig = lazy(() => import('./pages/Admin/ComplianceConfig'));
const MigrationConfig = lazy(() => import('./pages/Admin/MigrationConfig'));
const TeamsNotifications = lazy(() => import('./pages/Admin/TeamsNotifications'));
const Backup = lazy(() => import('./pages/Admin/Backup'));
const AuditLogs = lazy(() => import('./pages/Admin/AuditLogs'));
const Branding = lazy(() => import('./pages/Admin/Branding'));
import { PagesProvider } from './context/PagesContext';
import { ALL_ITEMS } from './nav';

function Guard({ page, children }) {
  const { has } = useAuth();
  return has(page) ? children : <Result status="403" title="No access" subTitle="You do not have access to this page. Ask an administrator if you need it." />;
}

const ROUTES = {
  dashboard: <Dashboard />,
  decommissioned: <Decommissioned />, 'recycle-bin': <RecycleBin />, search: <GlobalSearch />, migration: <MigrationTracker />,
  vmware: <VMwareDiscovery />, 'esxi-utilization': <EsxiUtilization />, proxmox: <ProxmoxDiscovery />, tenable: <TenableReport />, 'nessus-status': <NessusStatus />,
  'endpoint-central': <EndpointCentral />, 'software-status': <MEStatus />, 'weekly-report': <WeeklyReport />,
  'data-health': <DataHealth />, reconcile: <Reconcile />, 'admin-users': <Users />, 'admin-roles': <Roles />,
  'admin-user-page-control': <UserPageControl />, 'admin-pages': <PagesAdmin />, 'admin-field-library': <FieldLibrary />, 'admin-mac-mapping': <MacMapping />, 'admin-hostname-pattern': <HostnamePattern />, 'admin-dropdowns': <Dropdowns />,
  'admin-tag-ranges': <TagRanges />, 'admin-compliance': <ComplianceConfig />,
  'admin-migration-config': <MigrationConfig />, 'admin-teams': <TeamsNotifications />, 'admin-backup': <Backup />,
  'admin-audit': <AuditLogs />, 'admin-branding': <Branding />, 'admin-nav-order': <Navigate to="/" replace />,
};

export default function App() {
  const { user, loading, pages, locked } = useAuth();
  if (locked) return <LockScreen />;
  return <PagesProvider><Routing user={user} loading={loading} pages={pages} /></PagesProvider>;
}

function Routing({ user, loading, pages }) {
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spin size="large" /></div>;
  if (!user) return <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
  const first = ALL_ITEMS.find((i) => pages.has(i.key));
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        {ALL_ITEMS.map((i) => <Route key={i.key} path={i.path === '/' ? '/' : `${i.path}/*`}
          element={i.key === 'dashboard' && !pages.has('dashboard') && first ? <Navigate to={first.path} replace /> : <Guard page={i.key}>{ROUTES[i.key]}</Guard>} />)}
        <Route path="/profile" element={<Profile />} />
        <Route path="/p/:slug" element={<PageHost />} />
        <Route path="/admin/pages/:slug" element={<Guard page="admin-pages"><PageDesigner /></Guard>} />
        <Route path="*" element={first ? <Navigate to={first.path} replace /> : <Result status="403" title="No pages assigned" subTitle="Your account has no page access yet." />} />
      </Route>
    </Routes>
  );
}
