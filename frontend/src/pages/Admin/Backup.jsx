import { useEffect, useState } from 'react';
import { Alert, App, Button, InputNumber, Select, Switch, Table, Tag, Upload, Popconfirm } from 'antd';
import dayjs from 'dayjs';
import api, { download, errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { pager } from '../../utils/pager';

const size = (n) => (n == null ? '-' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
export default function Backup() {
  const { message } = App.useApp(); const [d, setD] = useState(null); const [busy, setBusy] = useState(''); const [table, setTable] = useState();
  const load = () => api.get('/backup').then((r) => setD(r.data)).catch((e) => message.error(errMsg(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const run = async (kind) => { setBusy(kind); try { await api.post('/backup/run', { kind }); message.success('Backup created'); } catch (e) { message.error(errMsg(e)); } finally { setBusy(''); load(); } };
  const sched = async (patch) => { const n = { ...d.schedule, ...patch }; setD({ ...d, schedule: n }); try { await api.put('/backup/schedule', n); } catch (e) { message.error(errMsg(e)); } };
  const restoreCsv = async (file) => { const fd = new FormData(); fd.append('file', file); try { const r = await api.post(`/backup/csv/${table}`, fd); message.success(`${r.data.inserted} row(s) restored into ${table}`); } catch (e) { message.error(errMsg(e)); } return false; };
  if (!d) return <div className="page" />;
  return (
    <div className="page">
      <PageHeader title="Backup & Restore" sub="Full database dumps for disaster recovery and per-table CSV for portability." extra={<><Button loading={busy === 'csv'} onClick={() => run('csv')}>CSV backup now</Button><Button type="primary" loading={busy === 'pg_dump'} onClick={() => run('pg_dump')}>Database dump now</Button></>} />
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="CSV backups leave out passwords, tokens and user accounts" description="Use the database dump for a complete restore. CSV restore only adds rows that do not already exist; it never overwrites." />
      <div className="card" style={{ marginBottom: 16 }}><b>Schedule</b>
        <div className="toolbar" style={{ marginTop: 8 }}><Switch checked={d.schedule.enabled} onChange={(v) => sched({ enabled: v })} /><span>Back up automatically every</span><InputNumber min={1} max={720} value={d.schedule.interval_hours} onChange={(v) => v && setD({ ...d, schedule: { ...d.schedule, interval_hours: v } })} onBlur={() => sched({})} style={{ width: 80 }} /><span>hours</span></div></div>
      <div className="card" style={{ marginBottom: 16 }}><b>Per-table CSV</b>
        <div className="toolbar" style={{ marginTop: 8 }}><Select placeholder="Choose a table" style={{ width: 240 }} value={table} onChange={setTable} options={d.tables.map((t) => ({ value: t, label: t }))} />
          <Button disabled={!table} onClick={() => download(`/backup/csv/${table}`, `${table}.csv`)}>Download CSV</Button>
          <Upload accept=".csv" showUploadList={false} beforeUpload={restoreCsv} disabled={!table || !d.restorable.includes(table)}><Button disabled={!table || !d.restorable.includes(table)}>Restore from CSV</Button></Upload></div></div>
      <b>History</b>
      <Table rowKey="id" size="small" style={{ marginTop: 8 }} dataSource={d.history} pagination={pager(10, (d.history)?.length ?? 0)}
        columns={[{ title: 'When', dataIndex: 'created_at', render: (v) => dayjs(v).format('D MMM YYYY HH:mm') }, { title: 'Type', dataIndex: 'kind', render: (v) => <Tag>{v}</Tag> }, { title: 'Size', dataIndex: 'size_bytes', render: size },
          { title: 'Result', render: (_, r) => (r.status === 'ok' ? <Tag color="green">OK</Tag> : <span style={{ color: '#cf1322' }}>{r.error}</span>) }, { title: 'By', dataIndex: 'created_by' },
          { title: '', render: (_, r) => r.kind === 'csv' && r.status === 'ok' && <Popconfirm title="Restore missing rows from this backup?" onConfirm={() => api.post(`/backup/restore/${r.id}`).then((x) => message.success(`Restored: ${Object.entries(x.data).map(([k, v]) => `${k} ${v}`).join(', ')}`)).catch((e) => message.error(errMsg(e)))}><Button size="small">Restore</Button></Popconfirm> }]} />
    </div>
  );
}
