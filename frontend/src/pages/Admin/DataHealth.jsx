import { useEffect, useState } from 'react';
import { Spin, Table, Tabs } from 'antd';
import dayjs from 'dayjs';
import api from '../../api/client';
import PageHeader, { Stat } from '../../components/PageHeader';
import { pager } from '../../utils/pager';

export default function DataHealth() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/data-health').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="page"><Spin /></div>;
  const cols = [{ title: 'Inventory', dataIndex: 'source' }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname || `#${r.id}` }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }, { title: 'Tag', dataIndex: 'asset_tag' }];
  const c = d.counts; const tone = (n) => (n ? 'warn' : 'good');
  return (
    <div className="page">
      <PageHeader title="Data Health" sub="Records that need attention. Lists show the first 200 of each kind." />
      <div className="stat-grid"><Stat label="Missing IP" value={c.missing_ip} tone={tone(c.missing_ip)} /><Stat label="Missing asset tag" value={c.missing_tag} tone={tone(c.missing_tag)} />
        <Stat label="Duplicate MACs" value={c.duplicate_macs} tone={tone(c.duplicate_macs)} /><Stat label={`Not updated in ${d.stale_days}+ days`} value={c.stale} tone={tone(c.stale)} /></div>
      <Tabs items={[
        { key: 'ip', label: 'Missing IP', children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={d.issues.missing_ip} columns={cols} pagination={pager(20, (d.issues.missing_ip)?.length ?? 0)} /> },
        { key: 'tag', label: 'Missing asset tag', children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={d.issues.missing_tag} columns={cols} pagination={pager(20, (d.issues.missing_tag)?.length ?? 0)} /> },
        { key: 'mac', label: 'Duplicate MACs', children: <Table rowKey="mac" size="small" dataSource={d.issues.duplicate_macs} pagination={pager(20, (d.issues.duplicate_macs)?.length ?? 0)} columns={[{ title: 'MAC', dataIndex: 'mac', render: (v) => <span className="mono">{v}</span> }, { title: 'Used by', dataIndex: 'n' }, { title: 'Assets', render: (_, r) => r.assets.map((a) => `${a.name || '#' + a.id} (${a.source})`).join(', ') }]} /> },
        { key: 'stale', label: 'Stale records', children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={d.issues.stale} columns={[...cols, { title: 'Last updated', dataIndex: 'updated_at', render: (v) => dayjs(v).format('D MMM YYYY') }]} pagination={pager(20, (d.issues.stale)?.length ?? 0)} /> },
      ]} />
    </div>
  );
}
