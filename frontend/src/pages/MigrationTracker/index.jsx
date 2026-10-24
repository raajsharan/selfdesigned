import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, App, Empty, Select, Tabs } from 'antd';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import Overview from './components/Overview';
import HostsTab from './components/HostsTab';
import VmTab from './components/VmTab';

export default function MigrationTracker() {
  const { message } = App.useApp(); const { has } = useAuth();
  const [projects, setProjects] = useState(null); const [pid, setPid] = useState(() => Number(localStorage.getItem('inv_mig_project')) || null);
  const [fields, setFields] = useState([]); const [tick, setTick] = useState(0);

  useEffect(() => {
    api.get('/migration/projects').then((r) => { setProjects(r.data); if (!r.data.find((p) => p.id === pid)) setPid(r.data[0]?.id || null); }).catch((e) => message.error(errMsg(e)));
  }, []); // eslint-disable-line
  useEffect(() => { if (pid) { localStorage.setItem('inv_mig_project', pid); api.get(`/migration/projects/${pid}/custom-fields`).then((r) => setFields(r.data)); } }, [pid]);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  if (!projects) return <div className="page" />;
  const project = projects.find((p) => p.id === pid);
  return (
    <div className="page">
      <PageHeader title="Migration Tracker" sub="Track the move from VMware to Proxmox, host by host and VM by VM."
        extra={projects.length > 0 && <Select value={pid} style={{ minWidth: 240 }} onChange={setPid} options={projects.map((p) => ({ value: p.id, label: p.name + (p.is_active ? '' : ' (archived)') }))} />} />
      {!project ? (
        <Empty description={<span>No migration project yet.{has('admin-migration-config') ? <> <Link to="/admin/migration-config">Create one in Migration Config</Link>.</> : ' Ask an administrator to create one.'}</span>} />
      ) : (
        <Tabs destroyInactiveTabPane items={[
          { key: 'overview', label: 'Overview', children: <Overview project={project} refreshKey={tick} /> },
          ...project.tabs.filter((t) => t.enabled).map((t) => ({ key: t.key, label: t.label,
            children: t.type === 'hosts' ? <HostsTab project={project} tab={t} customFields={fields} onChanged={bump} /> : <VmTab project={project} tab={t} customFields={fields} onChanged={bump} /> })),
        ]} />
      )}
    </div>
  );
}
