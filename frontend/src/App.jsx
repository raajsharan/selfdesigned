import { Navigate, Route, Routes } from 'react-router-dom';
import { Result, Spin } from 'antd';
import { useAuth } from './context/AuthContext';
import AppLayout from './components/Layout/AppLayout';
import Login from './pages/Login';
import LockScreen from './pages/LockScreen';
import Dashboard from './pages/Dashboard';
import PageHost from './pages/PageHost';
import PagesAdmin from './pages/Admin/PagesAdmin';
import PageDesigner from './pages/Admin/PageDesigner';
import Decommissioned from './pages/Decommissioned/Decommissioned';
import RecycleBin from './pages/RecycleBin';
import GlobalSearch from './pages/GlobalSearch';
import MigrationTracker from './pages/MigrationTracker';
import VMwareDiscovery from './pages/VMwareDiscovery';
import ProxmoxDiscovery from './pages/ProxmoxDiscovery';
import TenableReport from './pages/TenableReport';
import NessusStatus from './pages/NessusStatus';
import EndpointCentral from './pages/EndpointCentral';
import SoftwareStatus from './pages/SoftwareStatus';
import WeeklyReport from './pages/WeeklyReport';
import DataHealth from './pages/Admin/DataHealth';
import Reconcile from './pages/Reconcile';
import Users from './pages/Admin/Users';
import Roles from './pages/Admin/Roles';
import UserPageControl from './pages/Admin/UserPageControl';
import { Dropdowns, TagRanges } from './pages/Admin/Lookups';
import ComplianceConfig from './pages/Admin/ComplianceConfig';
import MigrationConfig from './pages/Admin/MigrationConfig';
import TeamsNotifications from './pages/Admin/TeamsNotifications';
import Backup from './pages/Admin/Backup';
import AuditLogs from './pages/Admin/AuditLogs';
import Branding from './pages/Admin/Branding';
import NavOrder from './pages/Admin/NavOrder';
import { PagesProvider } from './context/PagesContext';
import { ALL_ITEMS } from './nav';

function Guard({ page, children }) {
  const { has } = useAuth();
  return has(page) ? children : <Result status="403" title="No access" subTitle="You do not have access to this page. Ask an administrator if you need it." />;
}

const ROUTES = {
  dashboard: <Dashboard />,
  decommissioned: <Decommissioned />, 'recycle-bin': <RecycleBin />, search: <GlobalSearch />, migration: <MigrationTracker />,
  vmware: <VMwareDiscovery />, proxmox: <ProxmoxDiscovery />, tenable: <TenableReport />, 'nessus-status': <NessusStatus />,
  'endpoint-central': <EndpointCentral />, 'software-status': <SoftwareStatus />, 'weekly-report': <WeeklyReport />,
  'data-health': <DataHealth />, reconcile: <Reconcile />, 'admin-users': <Users />, 'admin-roles': <Roles />,
  'admin-user-page-control': <UserPageControl />, 'admin-pages': <PagesAdmin />, 'admin-dropdowns': <Dropdowns />,
  'admin-tag-ranges': <TagRanges />, 'admin-compliance': <ComplianceConfig />,
  'admin-migration-config': <MigrationConfig />, 'admin-teams': <TeamsNotifications />, 'admin-backup': <Backup />,
  'admin-audit': <AuditLogs />, 'admin-branding': <Branding />, 'admin-nav-order': <NavOrder />,
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
        <Route path="/p/:slug" element={<PageHost />} />
        <Route path="/admin/pages/:slug" element={<Guard page="admin-pages"><PageDesigner /></Guard>} />
        <Route path="*" element={first ? <Navigate to={first.path} replace /> : <Result status="403" title="No pages assigned" subTitle="Your account has no page access yet." />} />
      </Route>
    </Routes>
  );
}
