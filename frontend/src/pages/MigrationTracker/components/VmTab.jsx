import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Input, Select, Table, Upload } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { downloadCsv } from '../../../utils/csv';
import { ColumnManager, CustomCell, NotesCell, StatusSelect, SummaryCards, VM_STATUS, useColumnPrefs } from './shared';
import { pager } from '../../../utils/pager';

const KIND = { bomgar: 'bomgar-vms', security: 'security-vms', standalone: 'standalone-esxi', custom: 'custom-vms' };
const BASE = [
  { key: 'vm_name', title: 'VM name' }, { key: 'ip_address', title: 'IP address' }, { key: 'os', title: 'OS' }, { key: 'cluster', title: 'Cluster' },
  { key: 'datacenter', title: 'Datacenter' }, { key: 'esxi_host', title: 'ESXi host' }, { key: 'power_state', title: 'Power state' },
  { key: 'migration_status', title: 'Migration status' }, { key: 'notes', title: 'Notes' },
];

export default function VmTab({ project, tab, customFields, onChanged }) {
  const { message } = App.useApp(); const { canWrite } = useAuth();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(false); const [f, setF] = useState({});
  const kind = KIND[tab.type] || 'custom-vms';
  const defs = useMemo(() => customFields.filter((d) => !d.tab_keys?.length || d.tab_keys.includes(tab.key)), [customFields, tab.key]);
  const all = useMemo(() => [...BASE, ...defs.map((d) => ({ key: `c_${d.key}`, title: d.label }))], [defs]);
  const prefs = useColumnPrefs(`inv_mig_${project.id}_${tab.key}`, all, tab.hidden_columns || []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await api.get(`/migration/${kind}`, { params: { project_id: project.id, tab: tab.key, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) } })).data); }
    catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  }, [kind, project.id, tab.key, f, message]);
  useEffect(() => { load(); }, [load]);

  const patch = async (row, body) => {
    const before = data.rows;
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, ...body, custom: { ...r.custom, ...(body.custom || {}) } } : r)) }));   // optimistic
    try { await api.patch(`/migration/${kind}/${row.id}`, body, { params: { project_id: project.id } }); if (body.migration_status) { load(); onChanged?.(); } }
    catch (e) { message.error(errMsg(e)); setData((d) => ({ ...d, rows: before })); }
  };

  const render = {
    vm_name: { fixed: 'left', render: (v) => <b>{v}</b> },
    power_state: { render: (v) => v || '-' },
    migration_status: { render: (v, r) => <StatusSelect value={v} options={VM_STATUS} disabled={!canWrite} onChange={(x) => patch(r, { migration_status: x })} /> },
    notes: { width: 220, render: (v, r) => <NotesCell value={v} disabled={!canWrite} onSave={(x) => patch(r, { notes: x ?? '' })} /> },
  };
  const columns = prefs.order.filter((k) => !prefs.hidden.has(k)).map((k) => {
    const col = all.find((c) => c.key === k);
    if (k.startsWith('c_')) { const d = defs.find((x) => `c_${x.key}` === k); return { title: col.title, key: k, render: (_, r) => <CustomCell def={d} value={r.custom?.[d.key]} disabled={!canWrite} onSave={(x) => patch(r, { custom: { [d.key]: x } })} /> }; }
    return { title: col.title, dataIndex: k, key: k, sorter: (a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? '')), ellipsis: k !== 'notes', render: (v) => v ?? '-', ...(render[k] || {}) };
  });

  const exportCsv = () => downloadCsv(`${project.name}-${tab.label}.csv`.replace(/\s+/g, '_'), columns.map((c) => ({ title: c.title, value: (r) => (c.key.startsWith('c_') ? r.custom?.[c.key.slice(2)] : r[c.key]) })), data.rows);
  const importXlsx = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    try { const r = (await api.post('/migration/import', fd, { params: { project_id: project.id } })).data; message.success(`Imported ${r.sheets.map((s) => `${s.rows} row(s) into ${s.sheet}`).join(', ')}`); load(); onChanged?.(); }
    catch (e) { message.error(errMsg(e)); }
    return false;
  };

  return (
    <>
      {tab.type === 'standalone' && <div className="warn-banner"><b>Not centrally managed.</b> These VMs run on standalone ESXi hosts that are not managed by vCenter, so they will not appear in vCenter-based reports and must be migrated host by host.</div>}
      <SummaryCards s={data?.summary} />
      <div className="toolbar">
        <Input.Search allowClear placeholder="Search VM, IP, OS, notes" style={{ width: 260 }} onSearch={(q) => setF((x) => ({ ...x, search: q }))} />
        <Select allowClear placeholder="Status" style={{ width: 130 }} options={VM_STATUS.map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, status: v }))} />
        <Select allowClear placeholder="Cluster" style={{ width: 150 }} options={(data?.filters.clusters || []).map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, cluster: v }))} />
        <Select allowClear placeholder="Datacenter" style={{ width: 150 }} options={(data?.filters.datacenters || []).map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, datacenter: v }))} />
        <Select allowClear placeholder="Power state" style={{ width: 140 }} options={(data?.filters.power_states || []).map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, power_state: v }))} />
        <div className="grow" />
        <ColumnManager all={all} prefs={prefs} />
        <Button icon={<DownloadOutlined />} disabled={!data?.rows.length} onClick={exportCsv}>Export CSV</Button>
        {canWrite && <Upload accept=".xlsx" showUploadList={false} beforeUpload={importXlsx}><Button>Import Excel</Button></Upload>}
      </div>
      {data && !data.summary.total && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="No VMs on this tab yet" description="Import an Excel sheet named after this tab, or ask an admin to sync from VMware discovery in Admin → Migration Config." />}
      <Table rowKey="id" size="small" loading={loading} dataSource={data?.rows || []} columns={columns} scroll={{ x: 'max-content' }} pagination={pager(50, (data?.rows || [])?.length ?? 0, { showTotal: (t) => `${t} VMs` })} />
    </>
  );
}
