import { useEffect, useState } from 'react';
import { Alert, App, Input, Select, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { usePages } from '../../context/PagesContext';
import { pager } from '../../utils/pager';

const COLOR = { Healthy: 'green', 'Not installed': 'red', Unknown: 'default' };
export default function SoftwareStatus() {
  const { message } = App.useApp(); const { bySlug } = usePages(); const [d, setD] = useState(null); const [loading, setLoading] = useState(true); const [q, setQ] = useState(''); const [st, setSt] = useState();
  useEffect(() => { api.get('/software-status').then((r) => setD(r.data)).catch((e) => message.error(errMsg(e))).finally(() => setLoading(false)); }, [message]);
  const rows = (d?.rows || []).filter((r) => (!st || r.agent_status === st) && (!q || [r.vm_name, r.hostname, r.ip_address].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase()))));
  return (
    <div className="page">
      <PageHeader title="Software Status" sub="ManageEngine agent state for every asset, matched by MAC, hostname or IP." />
      {d && !d.configured && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Endpoint Central data is unavailable" description={d.error} />}
      <div className="toolbar"><Input.Search allowClear placeholder="Search name or IP" style={{ width: 260 }} onSearch={setQ} />
        <Select allowClear placeholder="Agent status" style={{ width: 170 }} onChange={setSt} options={['Healthy', 'Down', 'Vulnerable', 'Not installed', 'Unknown'].map((v) => ({ value: v, label: v }))} /></div>
      <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" loading={loading} dataSource={rows} pagination={pager(25, (rows)?.length ?? 0)} scroll={{ x: 'max-content' }}
        columns={[{ title: 'Page', dataIndex: 'source', render: (s) => bySlug[s]?.title || s }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'OS', dataIndex: 'os_type' },
          { title: 'Agent', dataIndex: 'agent_status', render: (s) => <Tag color={COLOR[s] || 'orange'}>{s}</Tag> }, { title: 'Version', dataIndex: 'agent_version', render: (v) => v || '-' }, { title: 'Last contact', dataIndex: 'last_contact', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : '-') }]} />
    </div>
  );
}
