import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Table, Tabs } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import ConfigModal from './ConfigModal';
import ComputersTab from './ComputersTab';
import GroupsTab from './GroupsTab';
import StagedTab from './StagedTab';
import { pager } from '../../utils/pager';

function Software({ reload }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const load = useCallback(async (refresh) => {
    setLoading(true); setErr('');
    try { setRows((await api.get('/endpoint-central/software', { params: refresh ? { refresh: 1 } : {} })).data); } catch (e) { setErr(errMsg(e)); setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => { if (reload) load(true); }, [reload]); // eslint-disable-line
  const list = rows.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <div className="toolbar"><Input.Search allowClear placeholder="Filter" style={{ width: 260 }} onSearch={setQ} /></div>
      <Table rowKey={(r, i) => `${r.name}-${r.version}-${i}`} size="small" loading={loading} dataSource={list} pagination={pager(25, list.length)}
        columns={[{ title: 'Software', dataIndex: 'name' }, { title: 'Version', dataIndex: 'version' }, { title: 'Vendor', dataIndex: 'vendor' }, { title: 'Installed on', dataIndex: 'installed_on' }]} />
    </div>
  );
}

export default function EndpointCentral() {
  const { has } = useAuth();
  const [tab, setTab] = useState('computers'); const [cfg, setCfg] = useState(false);
  const [counts, setCounts] = useState({});
  // `reload` counters: bumping one makes that tab fetch again (Refresh forces EC; a finished sync only re-reads our own data).
  const [refresh, setRefresh] = useState(0); const [groupsVersion, setGroupsVersion] = useState(0);
  const setCount = (k) => (n) => setCounts((c) => (c[k] === n ? c : { ...c, [k]: n }));
  const onTotal = useCallback(setCount('computers'), []); const onGroups = useCallback(setCount('groups'), []); const onStaged = useCallback(setCount('staged'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (t, k) => (counts[k] === undefined ? t : `${t} (${counts[k]})`);
  const onChanged = () => { setRefresh((n) => n + 1); setGroupsVersion((n) => n + 1); };

  return (
    <div className="page">
      <PageHeader title="ManageEngine Endpoint Central" sub="Computer status, custom groups and staged computers, read from Endpoint Central. Nothing here changes data in Endpoint Central."
        extra={<><Button onClick={() => setRefresh((n) => n + 1)}>Refresh</Button>{has('admin-endpoint-central') && <Button type="primary" onClick={() => setCfg(true)}>Configure</Button>}</>} />
      <Tabs activeKey={tab} onChange={setTab} destroyInactiveTabPane={false} items={[
        { key: 'computers', label: label('Computers', 'computers'), children: <ComputersTab reload={refresh} groupsVersion={groupsVersion} onTotal={onTotal} onOpenGroups={() => setTab('groups')} /> },
        { key: 'groups', label: label('Custom groups', 'groups'), children: <GroupsTab reload={refresh} onCount={onGroups} onSynced={() => setGroupsVersion((n) => n + 1)} /> },
        { key: 'staged', label: label('Staged', 'staged'), children: <StagedTab reload={refresh} onTotal={onStaged} /> },
        { key: 'software', label: 'Software inventory', children: <Software reload={refresh} /> },
      ]} />
      <ConfigModal open={cfg} onClose={() => setCfg(false)} onSaved={onChanged} />
    </div>
  );
}
