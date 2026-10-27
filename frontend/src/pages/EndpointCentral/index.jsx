import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Input, Table, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import ConfigModal from './ConfigModal';
import { pager } from '../../utils/pager';

export default function EndpointCentral() {
  const { message } = App.useApp(); const { has } = useAuth();
  const [tab, setTab] = useState('agents'); const [rows, setRows] = useState({}); const [loading, setLoading] = useState(false); const [err, setErr] = useState(''); const [cfg, setCfg] = useState(false); const [q, setQ] = useState('');
  const load = useCallback(async (k, refresh) => {
    setLoading(true); setErr('');
    try {
      const res = await api.get(k === 'agents' ? '/endpoint-central' : '/endpoint-central/software', { params: refresh ? { refresh: 1 } : {} });
      setRows((r) => ({ ...r, [k]: res.data }));
    }
    catch (e) { setErr(errMsg(e)); setRows((r) => ({ ...r, [k]: [] })); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);
  const f = (list) => (list || []).filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHeader title="ManageEngine Endpoint Central" sub="Agent health and installed software, pulled live from Endpoint Central."
        extra={<><Button onClick={() => load(tab, true)}>Refresh</Button>{has('admin-endpoint-central') && <Button type="primary" onClick={() => setCfg(true)}>Configure</Button>}</>} />
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <div className="toolbar"><Input.Search allowClear placeholder="Filter" style={{ width: 260 }} onSearch={setQ} /></div>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'agents', label: 'Agents', children: <Table rowKey={(r) => r.resource_id ?? r.name} size="small" loading={loading} dataSource={f(rows.agents)} pagination={pager(25, (f(rows.agents))?.length ?? 0)} scroll={{ x: 'max-content' }}
          columns={[{ title: 'Computer', dataIndex: 'name' }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'OS', dataIndex: 'os' }, { title: 'Agent version', dataIndex: 'agent_version' }, { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'Live' ? 'green' : s === 'Down' ? 'red' : 'orange'}>{s}</Tag> },
            { title: 'Last contact', dataIndex: 'last_contact', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : '-') }]} /> },
        { key: 'software', label: 'Software inventory', children: <Table rowKey={(r, i) => `${r.name}-${r.version}-${i}`} size="small" loading={loading} dataSource={f(rows.software)} pagination={pager(25, (f(rows.software))?.length ?? 0)}
          columns={[{ title: 'Software', dataIndex: 'name' }, { title: 'Version', dataIndex: 'version' }, { title: 'Vendor', dataIndex: 'vendor' }, { title: 'Installed on', dataIndex: 'installed_on' }]} /> },
      ]} />
      <ConfigModal open={cfg} onClose={() => setCfg(false)} onSaved={() => load(tab, true)} />
    </div>
  );
}
