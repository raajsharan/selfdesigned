import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Table, Tag, Upload } from 'antd';
import { DownloadOutlined, KeyOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { downloadCsv } from '../../../utils/csv';
import { ColumnManager, CustomCell, HOST_STAGE, NotesCell, StatusSelect, SummaryCards, useColumnPrefs } from './shared';

const BASE = [
  { key: 'host_name', title: 'Host' }, { key: 'datacenter', title: 'Datacenter' }, { key: 'cluster', title: 'Cluster' },
  { key: 'vms_vacate_status', title: 'VMs vacate' }, { key: 'proxmox_install_status', title: 'Proxmox install' }, { key: 'vm_migration_back_status', title: 'VM migration back' },
  { key: 'idrac', title: 'iDRAC' }, { key: 'license_expiry', title: 'Proxmox licence expiry' }, { key: 'notes', title: 'Notes' },
];

export default function HostsTab({ project, tab, customFields, onChanged }) {
  const { message } = App.useApp(); const { canWrite, user } = useAuth();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(false); const [f, setF] = useState({});
  const [vault, setVault] = useState(null); const [vForm] = Form.useForm(); const [revealed, setRevealed] = useState(null);
  const defs = useMemo(() => customFields.filter((d) => !d.tab_keys?.length || d.tab_keys.includes(tab.key)), [customFields, tab.key]);
  const all = useMemo(() => [...BASE, ...defs.map((d) => ({ key: `c_${d.key}`, title: d.label }))], [defs]);
  const prefs = useColumnPrefs(`inv_mig_${project.id}_${tab.key}`, all, tab.hidden_columns || []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await api.get('/migration/hosts', { params: { project_id: project.id, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) } })).data); }
    catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  }, [project.id, f, message]);
  useEffect(() => { load(); }, [load]);

  const patch = async (row, body, reload = true) => {
    const before = data.rows;
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, ...body, custom: { ...r.custom, ...(body.custom || {}) } } : r)) }));
    try { await api.patch(`/migration/hosts/${row.id}`, body, { params: { project_id: project.id } }); if (reload) { load(); onChanged?.(); } }
    catch (e) { message.error(errMsg(e)); setData((d) => ({ ...d, rows: before })); }
  };
  const days = (d) => (d ? dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day') : null);

  const openVault = (r) => { setVault(r); setRevealed(null); vForm.setFieldsValue({ idrac_ip: r.idrac_ip, idrac_username: r.idrac_username, idrac_password: '' }); };
  const saveVault = async () => {
    const v = await vForm.validateFields();
    const body = { idrac_ip: v.idrac_ip || '', idrac_username: v.idrac_username || '' }; if (v.idrac_password) body.idrac_password = v.idrac_password;
    await patch(vault, body, true); setVault(null);
  };
  const reveal = async () => { try { setRevealed((await api.get(`/migration/hosts/${vault.id}/idrac-password`)).data.password || ''); } catch (e) { message.error(errMsg(e)); } };

  const stage = (k) => ({ render: (v, r) => <StatusSelect value={v} options={HOST_STAGE} disabled={!canWrite} onChange={(x) => patch(r, { [k]: x })} /> });
  const render = {
    host_name: { fixed: 'left', render: (v) => <b>{v}</b> },
    vms_vacate_status: stage('vms_vacate_status'), proxmox_install_status: stage('proxmox_install_status'), vm_migration_back_status: stage('vm_migration_back_status'),
    idrac: { render: (_, r) => <Button size="small" icon={<KeyOutlined />} onClick={() => openVault(r)}>{r.idrac_ip || 'Add'}{r.has_idrac_password ? '' : ''}</Button> },
    license_expiry: { render: (v, r) => {
      const d = days(v); if (d === null) return <DatePicker size="small" disabled={!canWrite} onChange={(x) => patch(r, { license_expiry: x ? x.format('YYYY-MM-DD') : null })} />;
      return <span><DatePicker size="small" allowClear={false} disabled={!canWrite} value={dayjs(v)} onChange={(x) => patch(r, { license_expiry: x.format('YYYY-MM-DD') })} />
        {d < 0 ? <Tag color="red" style={{ marginLeft: 6 }}>Expired</Tag> : d <= 30 ? <Tag color="orange" style={{ marginLeft: 6 }}>{d}d left</Tag> : null}</span>; } },
    notes: { width: 220, render: (v, r) => <NotesCell value={v} disabled={!canWrite} onSave={(x) => patch(r, { notes: x ?? '' })} /> },
  };
  const columns = prefs.order.filter((k) => !prefs.hidden.has(k)).map((k) => {
    const col = all.find((c) => c.key === k);
    if (k.startsWith('c_')) { const d = defs.find((x) => `c_${x.key}` === k); return { title: col.title, key: k, render: (_, r) => <CustomCell def={d} value={r.custom?.[d.key]} disabled={!canWrite} onSave={(x) => patch(r, { custom: { [d.key]: x } })} /> }; }
    return { title: col.title, dataIndex: k, key: k, render: (v) => v ?? '-', ...(render[k] || {}) };
  });
  const exportCsv = () => downloadCsv(`${project.name}-Hosts.csv`.replace(/\s+/g, '_'), [
    ...BASE.filter((c) => c.key !== 'idrac').map((c) => ({ title: c.title, key: c.key })), { title: 'iDRAC IP', key: 'idrac_ip' }, ...defs.map((d) => ({ title: d.label, value: (r) => r.custom?.[d.key] }))], data.rows);
  const importXlsx = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    try { const r = (await api.post('/migration/import', fd, { params: { project_id: project.id } })).data; message.success(`Imported ${r.sheets.map((s) => `${s.rows} row(s) into ${s.sheet}`).join(', ')}`); load(); onChanged?.(); } catch (e) { message.error(errMsg(e)); }
    return false;
  };

  return (
    <>
      <SummaryCards s={data?.summary} />
      <div className="toolbar">
        <Input.Search allowClear placeholder="Search host, iDRAC IP, notes" style={{ width: 260 }} onSearch={(q) => setF((x) => ({ ...x, search: q }))} />
        <Select allowClear placeholder="Overall state" style={{ width: 140 }} options={['Pending', 'In Progress', 'Migrated', 'Blocked'].map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, state: v }))} />
        <Select allowClear placeholder="Datacenter" style={{ width: 150 }} options={(data?.filters.datacenters || []).map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, datacenter: v }))} />
        <Select allowClear placeholder="Cluster" style={{ width: 150 }} options={(data?.filters.clusters || []).map((v) => ({ value: v, label: v }))} onChange={(v) => setF((x) => ({ ...x, cluster: v }))} />
        <div className="grow" />
        <ColumnManager all={all} prefs={prefs} />
        <Button icon={<DownloadOutlined />} disabled={!data?.rows.length} onClick={exportCsv}>Export CSV</Button>
        {canWrite && <Upload accept=".xlsx" showUploadList={false} beforeUpload={importXlsx}><Button>Import Excel</Button></Upload>}
      </div>
      {data && !data.summary.total && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="No hosts yet" description="Import a sheet named “Hosts”, or ask an admin to sync from VMware discovery in Admin → Migration Config." />}
      <Table rowKey="id" size="small" loading={loading} dataSource={data?.rows || []} columns={columns} scroll={{ x: 'max-content' }} pagination={{ pageSize: 50, hideOnSinglePage: true, showTotal: (t) => `${t} hosts` }}
        rowClassName={(r) => { const d = days(r.license_expiry); return d === null ? '' : d < 0 ? 'row-expired' : d <= 30 ? 'row-soon' : ''; }} />
      <Modal open={!!vault} title={`iDRAC access: ${vault?.host_name}`} onCancel={() => setVault(null)} onOk={saveVault} okText="Save" okButtonProps={{ disabled: !canWrite }} destroyOnClose>
        <Form form={vForm} layout="vertical" disabled={!canWrite}>
          <Form.Item name="idrac_ip" label="iDRAC IP address"><Input /></Form.Item>
          <Form.Item name="idrac_username" label="Username"><Input autoComplete="off" /></Form.Item>
          <Form.Item name="idrac_password" label="Password" extra={vault?.has_idrac_password ? 'A password is stored (encrypted). Type to replace it.' : 'Stored encrypted (AES-256-GCM).'}><Input.Password autoComplete="new-password" /></Form.Item>
        </Form>
        {vault?.has_idrac_password && user.can_view_passwords && <Button onClick={reveal}>Reveal stored password</Button>}
        {revealed !== null && <span className="mono" style={{ marginLeft: 10 }}>{revealed || '(empty)'}</span>}
      </Modal>
    </>
  );
}
