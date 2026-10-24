import { useCallback, useEffect, useState } from 'react';
import { App, Button, Drawer, Input, Select, Table, Tabs, Tag, Upload } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { download, errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { usePages } from '../../context/PagesContext';
import PageHeader, { Stat } from '../../components/PageHeader';

const sev = (t) => t && <span>{[['C', t.critical, '#cf1322'], ['H', t.high, '#d46b08'], ['M', t.medium, '#c77700'], ['L', t.low, '#5d6b6e']].map(([l, n, c]) => <span key={l} style={{ color: n ? c : '#b5bfc1', marginRight: 8 }}><b>{l}</b> {n}</span>)}</span>;

export default function TenableReport() {
  const { message } = App.useApp(); const { user } = useAuth(); const { pages, bySlug } = usePages();
  const [d, setD] = useState(null); const [source, setSource] = useState(); const [q, setQ] = useState(''); const [tab, setTab] = useState('matched'); const [drawer, setDrawer] = useState(false); const [busy, setBusy] = useState(false);
  const isAdmin = ['admin', 'superadmin'].includes(user.role);
  const load = useCallback(() => api.get('/tenable/report', { params: { source } }).then((r) => setD(r.data)).catch((e) => message.error(errMsg(e))), [source, message]);
  useEffect(() => { load(); }, [load]);
  const filt = (rows) => rows.filter((r) => !q || [r.name, r.hostname, r.ip_address, r.mac_address].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase())));
  const upload = async (file) => {
    setBusy(true); const fd = new FormData(); fd.append('file', file);
    try { const r = await api.post('/tenable/import', fd); message.success(`Imported ${r.data.rows} Tenable assets`); setDrawer(false); load(); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
    return false;
  };
  const invCols = [{ title: 'Page', dataIndex: 'source', width: 140, render: (s) => bySlug[s]?.title || s }, { title: 'Name', render: (_, r) => r.name || r.hostname }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }, { title: 'OS', dataIndex: 'os_type' }, { title: 'Tag', dataIndex: 'asset_tag' }];
  if (!d) return <div className="page" />;
  const s = d.stats;
  return (
    <div className="page">
      <PageHeader title="Tenable Report" sub={d.import ? `Based on ${d.import.filename}, imported ${dayjs(d.import.imported_at).format('D MMM YYYY HH:mm')} by ${d.import.imported_by}.` : 'No Tenable data imported yet.'}
        extra={<>{<Button icon={<DownloadOutlined />} onClick={() => download('/tenable/report/csv', `tenable-${tab}.csv`, { tab, source })}>Export CSV</Button>}{isAdmin && <Button type="primary" icon={<UploadOutlined />} onClick={() => setDrawer(true)}>Import Tenable file</Button>}</>} />
      <div className="stat-grid"><Stat label="Matched" value={s.matched} tone="good" /><Stat label="Not in Tenable" value={s.not_in_tenable} tone={s.not_in_tenable ? 'warn' : ''} /><Stat label="Tenable only" value={s.tenable_only} tone={s.tenable_only ? 'warn' : ''} /><Stat label="Coverage" value={s.coverage_percent === null ? '-' : `${s.coverage_percent}%`} /></div>
      <div className="toolbar"><Input.Search allowClear placeholder="Search name, IP, MAC" style={{ width: 260 }} onSearch={setQ} />
        <Select allowClear placeholder="All pages" style={{ width: 190 }} options={pages.filter((p) => p.kind === 'records').map((p) => ({ value: p.slug, label: p.title }))} onChange={setSource} /></div>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'matched', label: `Matched (${s.matched})`, children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={filt(d.matched)} pagination={{ pageSize: 25, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} columns={[...invCols, { title: 'Findings', render: (_, r) => sev(r.tenable) }, { title: 'Last seen in Tenable', render: (_, r) => (r.tenable.last_seen ? dayjs(r.tenable.last_seen).format('D MMM YYYY') : '-') }]} /> },
        { key: 'not_in_tenable', label: `Not in Tenable (${s.not_in_tenable})`, children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={filt(d.not_in_tenable)} pagination={{ pageSize: 25, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} columns={invCols} /> },
        { key: 'tenable_only', label: `Tenable only (${s.tenable_only})`, children: source ? <div className="warn-banner">Tenable-only assets are checked against the whole estate. Clear the page filter to see them.</div> : <Table rowKey="id" size="small" dataSource={filt(d.tenable_only)} pagination={{ pageSize: 25, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} columns={[{ title: 'Hostname', dataIndex: 'hostname' }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'OS', dataIndex: 'os' }, { title: 'Findings', render: (_, r) => sev(r) }]} /> },
      ]} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Import Tenable export" width={460}>
        <p>Upload an .xlsx export from Tenable. Recognised columns: Name / DNS Name / Hostname, IP Address, MAC Address, Operating System, Critical, High, Medium, Low, Last Seen.</p>
        <p style={{ color: '#5d6b6e' }}>The new file replaces the current Tenable data used by this report. Earlier imports are kept.</p>
        <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} disabled={busy} beforeUpload={upload}><p>{busy ? 'Importing...' : 'Drop the file here or click to choose'}</p></Upload.Dragger>
      </Drawer>
    </div>
  );
}
