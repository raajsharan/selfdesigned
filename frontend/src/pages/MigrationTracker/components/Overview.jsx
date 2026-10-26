import { useEffect, useState } from 'react';
import { Progress, Spin, Table } from 'antd';
import api from '../../../api/client';
import { Stat } from '../../../components/PageHeader';

const NAME = { hosts: 'Hosts', bomgar: 'Bomgar VMs', security: 'Security VMs', standalone: 'Standalone ESXi' };

export default function Overview({ project, refreshKey }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/migration/overview', { params: { project_id: project.id } }).then((r) => setD(r.data)); }, [project.id, refreshKey]);
  if (!d) return <Spin />;
  const tabLabel = (k) => project.tabs.find((t) => t.key === k)?.label || NAME[k] || k;
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <b>Overall progress</b>
        <Progress percent={d.progress_percent} strokeColor={d.vms.blocked + d.hosts.blocked ? '#d46b08' : undefined} style={{ marginTop: 8 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Counts each host and each VM as one unit.{d.vms.blocked + d.hosts.blocked > 0 && <b style={{ color: '#d46b08' }}> {d.vms.blocked + d.hosts.blocked} blocked.</b>}</span>
      </div>
      <div className="stat-grid">
        <Stat label="Hosts" value={d.hosts.total} /><Stat label="Hosts migrated" value={d.hosts.migrated} tone="good" /><Stat label="Hosts blocked" value={d.hosts.blocked} tone={d.hosts.blocked ? 'bad' : ''} />
        <Stat label="VMs" value={d.vms.total} /><Stat label="VMs migrated" value={d.vms.migrated} tone="good" /><Stat label="VMs in progress" value={d.vms.in_progress} tone="warn" />
        <Stat label="VMs blocked" value={d.vms.blocked} tone={d.vms.blocked ? 'bad' : ''} /><Stat label="Licences expiring (30 days)" value={d.licenses_expiring_30d} tone={d.licenses_expiring_30d ? 'warn' : ''} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        <div className="card"><b>VMs by source</b>
          <Table size="small" rowKey="tab_key" pagination={false} style={{ marginTop: 8 }} dataSource={d.by_source} locale={{ emptyText: 'No VMs yet' }}
            columns={[{ title: 'Source', dataIndex: 'tab_key', render: tabLabel }, { title: 'Total', dataIndex: 'total' }, { title: 'Migrated', dataIndex: 'migrated' }, { title: 'In progress', dataIndex: 'in_progress' }, { title: 'Blocked', dataIndex: 'blocked' },
              { title: 'Done', render: (_, r) => <Progress size="small" percent={r.total ? Math.round((r.migrated / r.total) * 100) : 0} style={{ minWidth: 90 }} /> }]} /></div>
        <div className="card"><b>Hosts by datacenter</b>
          <Table size="small" rowKey="datacenter" pagination={false} style={{ marginTop: 8 }} dataSource={d.hosts_by_datacenter} locale={{ emptyText: 'No hosts yet' }}
            columns={[{ title: 'Datacenter', dataIndex: 'datacenter' }, { title: 'Hosts', dataIndex: 'hosts' }, { title: 'Migrated', dataIndex: 'migrated' }, { title: 'In progress', dataIndex: 'in_progress' }, { title: 'Blocked', dataIndex: 'blocked' }]} /></div>
      </div>
    </>
  );
}
