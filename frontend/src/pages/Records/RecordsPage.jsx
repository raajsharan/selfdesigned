import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { App, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { download, errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import useServerTable from '../../components/useServerTable';
import RecordForm from './RecordForm';
import RecordView from './RecordView';
import ImportModal from './ImportModal';
import { optionsOf } from './FormFields';

const META = { _created_at: { title: 'Created', get: (r) => r.created_at }, _updated_at: { title: 'Updated', get: (r) => r.updated_at } };
const statusColor = (v) => (/inactive|retired|off/i.test(v) ? 'default' : /active|online|running/i.test(v) ? 'green' : /maint|pending/i.test(v) ? 'orange' : /fail|down|error/i.test(v) ? 'red' : 'blue');

export default function RecordsPage({ page }) {
  const { message, modal } = App.useApp(); const { canWrite, has } = useAuth();
  const cfg = page.config; const base = `/p/${page.slug}`;
  const t = useServerTable(`${base}/records`, { show: 'active' }, cfg.table?.pageSize || 25);
  const [dd, setDd] = useState({}); const [opts, setOpts] = useState({});
  const [form, setForm] = useState({ open: false, record: null }); const [view, setView] = useState(null); const [imp, setImp] = useState(false); const [sel, setSel] = useState([]);
  const [decom, setDecom] = useState(null); const [reason, setReason] = useState('');
  const [sp, setSp] = useSearchParams();

  const fields = useMemo(() => Object.fromEntries(cfg.fields.map((f) => [f.key, f])), [cfg]);
  const roleField = (role) => cfg.fields.find((f) => f.role === role);
  const statusField = roleField('status');
  const canTags = roleField('asset_tag') && roleField('department');

  useEffect(() => { api.get('/dropdowns').then((r) => setDd(r.data)); api.get(`${base}/filter-options`).then((r) => setOpts(r.data)); }, [base]);
  // Deep link from search / "All records": ?record=<id> opens that record.
  useEffect(() => {
    const id = sp.get('record'); if (!id) return;
    api.get(`${base}/records/${id}`).then((r) => setView(r.data)).catch((e) => message.error(errMsg(e)));
  }, [sp, base, message]);

  const nameKey = (roleField('name') || roleField('hostname'))?.key;   // clicking it opens the record popup
  const columns = useMemo(() => {
    // Frozen columns are listed first: a sticky column in the middle would overlap its neighbours.
    const defs = cfg.table?.columns || [];
    const ordered = [...defs.filter((c) => c.fixed), ...defs.filter((c) => !c.fixed)];
    const cols = ordered.map((c) => {
      const f = fields[c.key]; const meta = META[c.key];
      return { title: meta ? meta.title : f?.label || c.key, key: c.key, width: c.width || (c.fixed ? 160 : undefined), sorter: true, ellipsis: true, fixed: c.fixed ? 'left' : undefined,
        render: (_, r) => {
          const v = meta ? meta.get(r) : r.data[c.key];
          if (meta) return dayjs(v).format('D MMM YYYY HH:mm');
          if (v === undefined || v === null || v === '') return <span style={{ color: 'var(--faint)' }}>-</span>;
          if (c.key === nameKey) return <a className="rec-link" onClick={() => setView(r)}>{String(v)}</a>;
          if (f.type === 'boolean') return v ? 'Yes' : 'No';
          if (f.type === 'date') return dayjs(v).format('D MMM YYYY');
          if (f.role === 'status') return <Tag color={statusColor(String(v))}>{v}</Tag>;
          if (f.role === 'mac') return <span className="mono">{v}</span>;
          return String(v);
        } };
    });
    return [...cols, { title: '', key: 'actions', fixed: 'right', width: canWrite ? 130 : 50, render: (_, r) => (
      <Space size={2}>
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setView(r)} aria-label="View" />
        {canWrite && <>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setForm({ open: true, record: r })} aria-label="Edit" />
          {!r.is_decommissioned && <Button type="text" size="small" icon={<StopOutlined />} onClick={() => { setDecom(r); setReason(''); }} aria-label="Decommission" />}
          <Popconfirm title="Move to the recycle bin?" onConfirm={() => api.delete(`${base}/records/${r.id}`).then(() => { message.success('Moved to the recycle bin'); t.reload(); }).catch((e) => message.error(errMsg(e)))}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Delete" /></Popconfirm></>}
      </Space>) }];
  }, [cfg, fields, canWrite, base, t, message, nameKey]);
  const frozen = (cfg.table?.columns || []).some((c) => c.fixed);
  const at = view ? t.rows.findIndex((r) => r.id === view.id) : -1;   // neighbours on the current table page for Previous / Next
  const step = (d) => { const n = t.rows[at + d]; if (n) setView(n); };

  const bulk = async (action, value) => {
    try { const r = (await api.post(`${base}/records/bulk`, { ids: sel, action, value })).data; message.success(action === 'assign_tags' ? `Assigned ${r.affected} tag(s)` : `Updated ${r.affected} record(s)`); setSel([]); t.reload(); }
    catch (e) { message.error(errMsg(e)); }
  };
  const doDecommission = async () => {
    try { await api.post(`${base}/records/${decom.id}/decommission`, { reason }); message.success('Decommissioned. Its tag and IP are free for reuse.'); setDecom(null); t.reload(); }
    catch (e) { message.error(errMsg(e)); }
  };
  const closeView = () => { setView(null); if (sp.get('record')) { sp.delete('record'); setSp(sp, { replace: true }); } };
  const hasLayout = cfg.fields.length > 0 && (cfg.table?.columns || []).length > 0 && (cfg.form?.sections || []).length > 0;

  return (
    <div className="page">
      <PageHeader title={page.title} sub={page.description || `${t.total} record${t.total === 1 ? '' : 's'}`}
        extra={<>
          {has('admin-pages') && <Link to={`/admin/pages/${page.slug}`}><Button>Edit layout</Button></Link>}
          <Button icon={<DownloadOutlined />} onClick={() => download(`${base}/records/export`, `${page.slug}.csv`, Object.fromEntries(Object.entries(t.filters).filter(([, v]) => v)))}>Export CSV</Button>
          {canWrite && <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>Import Excel</Button>}
          {canWrite && <Button type="primary" icon={<PlusOutlined />} disabled={!hasLayout} onClick={() => setForm({ open: true, record: null })}>Add record</Button>}
        </>} />
      {!hasLayout ? (
        <Empty description={<span>This page's layout is not finished: it needs fields, a form layout and at least one table column. {has('admin-pages') ? <Link to={`/admin/pages/${page.slug}`}>Open the designer</Link> : 'Ask an administrator to finish it.'}</span>} />
      ) : (<>
        <div className="toolbar">
          <Input.Search allowClear placeholder="Search every field" style={{ width: 280 }} onSearch={(q) => t.setFilter({ q })} />
          {(cfg.table.filters || []).map((k) => <Select key={k} allowClear showSearch placeholder={fields[k]?.label} style={{ minWidth: 150 }} options={(opts[k] || []).map((v) => ({ value: v, label: v }))} onChange={(v) => t.setFilter({ [`f_${k}`]: v })} />)}
          <Select value={t.filters.show} style={{ width: 190 }} onChange={(v) => t.setFilter({ show: v })} options={[{ value: 'active', label: 'Active only' }, { value: 'decommissioned', label: 'Decommissioned only' }, { value: 'all', label: 'Active + decommissioned' }]} />
        </div>
        {sel.length > 0 && canWrite && (
          <div className="toolbar" style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: 6 }}>
            <b>{sel.length} selected</b>
            {statusField && <Select placeholder={`Set ${statusField.label.toLowerCase()}`} style={{ width: 180 }} value={null} options={optionsOf(statusField, dd)} onChange={(v) => modal.confirm({ title: `Set ${statusField.label} to "${v}" for ${sel.length} record(s)?`, onOk: () => bulk('status', v) })} />}
            {canTags && <Button onClick={() => modal.confirm({ title: `Assign tags to ${sel.length} untagged record(s)?`, content: 'Each record gets the next free tag from its department range (Admin → Department Tag Ranges).', onOk: () => bulk('assign_tags') })}>Assign tags</Button>}
            <Button danger onClick={() => modal.confirm({ title: `Move ${sel.length} record(s) to the recycle bin?`, okButtonProps: { danger: true }, onOk: () => bulk('delete') })}>Delete</Button>
            <Button type="link" onClick={() => setSel([])}>Clear selection</Button>
          </div>)}
        <Table rowKey="id" size="small" loading={t.loading} dataSource={t.rows} columns={columns} pagination={t.pagination} onChange={t.onTableChange}
          rowSelection={canWrite ? { selectedRowKeys: sel, onChange: setSel, fixed: frozen } : undefined} scroll={{ x: 'max-content' }} rowClassName={(r) => (r.is_decommissioned ? 'row-expired' : '')} />
      </>)}
      <RecordForm page={page} record={form.record} dropdowns={dd} open={form.open} onClose={() => setForm({ open: false, record: null })} onSaved={() => { setForm({ open: false, record: null }); t.reload(); }} />
      <RecordView page={page} record={view} open={!!view} onClose={closeView} onStep={step} canStep={{ prev: at > 0, next: at >= 0 && at < t.rows.length - 1 }}
        onEdit={(r) => { closeView(); setForm({ open: true, record: r }); }} onDecommission={(r) => { closeView(); setDecom(r); setReason(''); }}
        onDelete={(r) => modal.confirm({ title: 'Move this record to the recycle bin?', okButtonProps: { danger: true },
          onOk: () => api.delete(`${base}/records/${r.id}`).then(() => { message.success('Moved to the recycle bin'); closeView(); t.reload(); }).catch((e) => message.error(errMsg(e))) })} />
      <ImportModal page={page} open={imp} onClose={() => setImp(false)} onDone={() => { setImp(false); t.reload(); }} />
      <Modal open={!!decom} title="Decommission this record" onCancel={() => setDecom(null)} onOk={doDecommission} okText="Decommission" okButtonProps={{ danger: true }}>
        <p>This frees its asset tag and IP address for reuse and writes a permanent log entry. You can reactivate it later from the Decommissioned page.</p>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (recommended)" maxLength={1000} />
      </Modal>
    </div>
  );
}
