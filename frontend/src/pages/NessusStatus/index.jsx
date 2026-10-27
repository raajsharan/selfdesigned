import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import { usePages } from '../../context/PagesContext';
import { pager } from '../../utils/pager';

export default function NessusStatus() {
  const { message } = App.useApp(); const { canWrite, user } = useAuth(); const { bySlug } = usePages(); const isAdmin = ['admin', 'superadmin'].includes(user.role);
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [q, setQ] = useState(''); const [only, setOnly] = useState();
  const [inst, setInst] = useState(null); const [cfg, setCfg] = useState(null); const [form] = Form.useForm(); const [cform] = Form.useForm(); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setRows((await api.get('/nessus-status')).data); } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); } }, [message]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r, installed) => { try { await api.put(`/nessus-status/${r.source}/${r.id}`, { installed }); load(); } catch (e) { message.error(errMsg(e)); } };
  const install = async (verifyOnly) => {
    const v = await form.validateFields(); setBusy(true);
    try { const r = (await api.post(`/nessus-status/${inst.source}/${inst.id}/install`, { ...v, verify_only: verifyOnly })).data; message.success(r.installed ? `Agent present${r.version ? ` (v${r.version})` : ''}` : 'Agent not detected'); setInst(null); load(); }
    catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openCfg = async () => { const c = (await api.get('/nessus-status/config')).data; setCfg(c); cform.setFieldsValue({ ...c, linking_key: '' }); };
  const saveCfg = async () => { try { await api.put('/nessus-status/config', await cform.validateFields()); message.success('Saved'); setCfg(null); } catch (e) { message.error(errMsg(e)); } };

  const data = rows.filter((r) => (only === undefined || (only === 'yes') === r.agent_installed) && (!q || [r.vm_name, r.hostname, r.ip_address].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase()))));
  return (
    <div className="page">
      <PageHeader title="Nessus Agent Status" sub="Whether the Nessus agent is installed on each asset." extra={isAdmin && <Button onClick={openCfg}>Install settings</Button>} />
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 220px))' }}>
        <div className="stat good"><div className="n">{rows.filter((r) => r.agent_installed).length}</div><div className="l">Agent installed</div></div>
        <div className="stat warn"><div className="n">{rows.filter((r) => !r.agent_installed).length}</div><div className="l">No agent recorded</div></div></div>
      <div className="toolbar"><Input.Search allowClear placeholder="Search name or IP" style={{ width: 260 }} onSearch={setQ} />
        <Select allowClear placeholder="Agent" style={{ width: 150 }} options={[{ value: 'yes', label: 'Installed' }, { value: 'no', label: 'Not installed' }]} onChange={setOnly} /></div>
      <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" loading={loading} dataSource={data} pagination={pager(25, (data)?.length ?? 0)} scroll={{ x: 'max-content' }}
        columns={[{ title: 'Page', dataIndex: 'source', render: (s) => bySlug[s]?.title || s }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'OS', dataIndex: 'os_type' },
          { title: 'Agent', render: (_, r) => <Switch size="small" checked={r.agent_installed} disabled={!canWrite} onChange={(c) => toggle(r, c)} /> }, { title: 'Version', dataIndex: 'agent_version', render: (v) => v || '-' },
          { title: 'Checked', dataIndex: 'last_checked_at', render: (v) => (v ? dayjs(v).format('D MMM YYYY') : '-') },
          ...(isAdmin ? [{ title: '', render: (_, r) => <Button size="small" onClick={() => { setInst(r); form.resetFields(); form.setFieldsValue({ ssh_port: 22 }); }}>Install / verify</Button> }] : [])]} />
      <Modal open={!!inst} title={`Install Nessus agent on ${inst?.vm_name || inst?.hostname}`} onCancel={() => setInst(null)} destroyOnClose
        footer={[<Button key="v" loading={busy} onClick={() => install(true)}>Verify only</Button>, <Button key="i" type="primary" loading={busy} onClick={() => install(false)}>Install</Button>]}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Connects over SSH to the asset's IP. Credentials are used for this request only and are never stored. The host key is pinned on first connection." />
        <Form form={form} layout="vertical"><Form.Item name="ssh_username" label="SSH username" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="ssh_password" label="SSH password" rules={[{ required: true }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="ssh_port" label="SSH port"><InputNumber min={1} max={65535} /></Form.Item></Form>
      </Modal>
      <Modal open={!!cfg} title="Nessus install settings" onCancel={() => setCfg(null)} onOk={saveCfg} okText="Save" destroyOnClose>
        <Form form={cform} layout="vertical"><Form.Item name="linux_package_url" label="Linux package URL (https)"><Input /></Form.Item><Form.Item name="windows_msi_url" label="Windows MSI URL (https)"><Input /></Form.Item>
          <Form.Item name="manager_host" label="Tenable / Nessus manager host"><Input /></Form.Item><Form.Item name="manager_port" label="Manager port"><InputNumber min={1} max={65535} /></Form.Item>
          <Form.Item name="groups" label="Agent groups (optional)"><Input /></Form.Item>
          <Form.Item name="linking_key" label="Linking key" extra={cfg?.has_linking_key ? 'A key is stored. Type to replace it.' : ''}><Input.Password autoComplete="new-password" /></Form.Item></Form>
      </Modal>
    </div>
  );
}
