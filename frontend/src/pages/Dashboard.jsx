import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Progress, Spin, Table } from 'antd';
import dayjs from 'dayjs';
import api from '../api/client';
import PageHeader, { Stat } from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const [d, setD] = useState(null); const { has } = useAuth();
  useEffect(() => { api.get('/dashboard').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="page"><Spin /></div>;
  const pct = d.migration.total ? Math.round((d.migration.migrated / d.migration.total) * 100) : 0;
  return (
    <div className="page">
      <PageHeader title="Dashboard" sub="Where the estate stands right now." />
      {!d.inventories.length && <div className="card" style={{ marginBottom: 16 }}><b>No pages yet</b><p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>Nothing is built in: you design the pages that hold your data. {has('admin-pages') ? <Link to="/admin/pages">Open the Page Designer</Link> : 'Ask an administrator to create them.'}</p></div>}
      <div className="stat-grid">
        {d.inventories.map((i) => <Link key={i.key} to={`/p/${i.key}`} style={{ color: 'inherit' }}><Stat label={`${i.label}${i.decommissioned ? ` (${i.decommissioned} decommissioned)` : ''}`} value={i.active} /></Link>)}
        <Stat label="VMware VMs discovered" value={d.discovery.vmware} />
        <Stat label="Proxmox VMs discovered" value={d.discovery.proxmox} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card"><b>VM migration (all projects)</b>
          <div style={{ margin: '12px 0 4px' }}><Progress percent={pct} /></div>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>{d.migration.migrated} of {d.migration.total} VMs migrated</span>
        </div>
        <div className="card"><b>Tenable data</b>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)' }}>{d.tenable ? `${d.tenable.row_count} assets imported ${dayjs(d.tenable.imported_at).format('D MMM YYYY, HH:mm')}` : 'No Tenable import yet. Import a file on the Tenable Report page.'}</p>
        </div>
      </div>
      {d.recent.length > 0 && <div className="card" style={{ marginTop: 16 }}><b>Recent activity</b>
        <Table size="small" rowKey="id" pagination={false} style={{ marginTop: 8 }} dataSource={d.recent}
          columns={[{ title: 'When', dataIndex: 'created_at', render: (v) => dayjs(v).format('D MMM HH:mm'), width: 130 }, { title: 'User', dataIndex: 'user_email' }, { title: 'Action', dataIndex: 'action' }, { title: 'On', render: (_, r) => `${r.entity || ''} ${r.entity_id || ''}` }]} /></div>}
    </div>
  );
}
