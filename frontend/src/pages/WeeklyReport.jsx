import { useEffect, useState } from 'react';
import { Button, Progress, Spin, Table, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { download } from '../api/client';
import PageHeader, { Stat } from '../components/PageHeader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export default function WeeklyReport() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/reports/weekly').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="page"><Spin /></div>;
  const s = d.config.sections; const t = d.totals;
  return (
    <div className="page">
      <PageHeader title="Weekly Report" sub={`Generated ${dayjs(d.generated_at).format('D MMM YYYY, HH:mm')}. Reporting day: ${DAYS[d.config.report_day]}. “${d.excluded_statuses.join('” and “')}” assets are left out of every total.`}
        extra={<Button icon={<DownloadOutlined />} onClick={() => download('/reports/weekly/csv', 'weekly-report.csv')}>Export CSV</Button>} />
      <div className="stat-grid">
        <Stat label="Assets in scope" value={t.assets} /><Stat label={`Patched in last ${d.config.patch_threshold_days} days`} value={t.patched} />
        <Stat label="Patch compliance" value={t.patched_percent === null ? '-' : `${t.patched_percent}%`} tone={t.meets_target === null ? '' : t.meets_target ? 'good' : 'bad'} />
        <Stat label={`Target`} value={`${d.config.patch_target_percent}%`} /><Stat label="Decommissioned" value={t.decommissioned} />
      </div>
      {s.inventory_totals && <div className="card" style={{ marginBottom: 16 }}><b>Inventory totals</b>
        <Table size="small" rowKey="key" pagination={false} style={{ marginTop: 8 }} dataSource={d.inventories}
          columns={[{ title: 'Inventory', dataIndex: 'label' }, { title: 'In scope', dataIndex: 'total' }, { title: 'Excluded', dataIndex: 'excluded' }, { title: 'Decommissioned', dataIndex: 'decommissioned' },
            ...(s.patching ? [{ title: 'Patched', dataIndex: 'patched' }, { title: 'Compliance', render: (_, r) => r.patched_percent === null ? '-' : <Progress size="small" style={{ minWidth: 120 }} percent={r.patched_percent} strokeColor={r.patched_percent >= d.config.patch_target_percent ? '#2f7d32' : '#cf1322'} /> }] : [])]} /></div>}
      {s.status_breakdown && <div className="card" style={{ marginBottom: 16 }}><b>Status breakdown</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 16, marginTop: 8 }}>
          {d.inventories.map((i) => <div key={i.key}><div style={{ fontWeight: 500, marginBottom: 4 }}>{i.label}</div>
            {i.statuses.length ? i.statuses.map((x) => <div key={x.status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{x.status} {d.excluded_statuses.includes(x.status) && <Tag>excluded</Tag>}</span><b>{x.n}</b></div>) : <span style={{ color: 'var(--faint)' }}>No assets</span>}</div>)}</div></div>}
      {s.extended && <div className="card"><b>Extended inventory summary</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginTop: 8 }}>
          {[['os_type', 'By OS type'], ['department', 'By department'], ['location', 'By location'], ['patching_type', 'By patching type']].map(([k, h]) => <div key={k}><div style={{ fontWeight: 500, marginBottom: 4 }}>{h}</div>
            {d.extended[k].map((x) => <div key={x.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{x.name}</span><b>{x.n}</b></div>)}</div>)}</div></div>}
    </div>
  );
}
