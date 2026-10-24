import { useCallback, useEffect, useState } from 'react';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { PlusOutlined, SyncOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';

const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'dropdown', 'date'];
const TAB_TYPES = [{ value: 'custom', label: 'Custom (linked to a vCenter group)' }, { value: 'bomgar', label: 'Bomgar VMs' }, { value: 'security', label: 'Security VMs' }, { value: 'standalone', label: 'Standalone ESXi' }, { value: 'hosts', label: 'Hosts' }];
const COLS = ['vm_name', 'ip_address', 'os', 'cluster', 'datacenter', 'esxi_host', 'power_state', 'migration_status', 'notes'];

export default function MigrationConfig() {
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState([]); const [pid, setPid] = useState(null); const [fields, setFields] = useState([]);
  const [pForm] = Form.useForm(); const [fForm] = Form.useForm(); const [newP, setNewP] = useState(false); const [fEdit, setFEdit] = useState(null); const [tabs, setTabs] = useState([]); const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === pid);

  const load = useCallback(async (keep) => { const r = (await api.get('/migration/projects')).data; setProjects(r); const id = keep ?? r[0]?.id ?? null; setPid(id); setTabs(r.find((p) => p.id === id)?.tabs || []); }, []);
  useEffect(() => { load().catch((e) => message.error(errMsg(e))); }, [load, message]);
  useEffect(() => { if (pid) api.get(`/migration/projects/${pid}/custom-fields`).then((r) => setFields(r.data)); setTabs(projects.find((p) => p.id === pid)?.tabs || []); }, [pid]); // eslint-disable-line

  const act = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) message.success(ok); return r; } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); } };
  const createProject = async () => { const v = await pForm.validateFields(); const r = await act(() => api.post('/migration/projects', v), 'Project created'); if (r) { setNewP(false); pForm.resetFields(); load(r.data.id); } };
  const saveTabs = async () => { const r = await act(() => api.put(`/migration/projects/${pid}`, { tabs }), 'Tabs saved'); if (r) load(pid); };
  const setTab = (i, patch) => setTabs((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addTab = () => setTabs((t) => [...t, { key: `custom_${t.filter((x) => x.type === 'custom').length + 1}`, label: 'New tab', type: 'custom', enabled: true, hidden_columns: [], vcenter_group: '', name_pattern: '' }]);
  const sync = () => modal.confirm({ title: 'Sync from VMware discovery?', content: 'Adds hosts and VMs found by discovery to each tab using its vCenter group / name rule. Existing statuses and notes are kept.',
    onOk: async () => { const r = await act(() => api.post(`/migration/projects/${pid}/sync`)); if (r) message.success(`Synced ${r.data.hosts} host(s); VMs per tab: ${Object.entries(r.data.vms).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`); } });
  const saveField = async () => {
    const v = await fForm.validateFields(); const body = { ...v, options: v.type === 'dropdown' ? String(v.options || '').split(',').map((x) => x.trim()).filter(Boolean) : [] };
    const r = await act(() => (fEdit.id ? api.put(`/migration/projects/${pid}/custom-fields/${fEdit.id}`, body) : api.post(`/migration/projects/${pid}/custom-fields`, body)), 'Saved');
    if (r) { setFEdit(null); setFields((await api.get(`/migration/projects/${pid}/custom-fields`)).data); }
  };
  const type = Form.useWatch('type', fForm);

  return (
    <div className="page">
      <PageHeader title="Migration Config" sub="Create projects, choose which tabs each one shows, and define extra columns."
        extra={<><Select value={pid} style={{ minWidth: 220 }} onChange={setPid} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="No projects" /><Button type="primary" icon={<PlusOutlined />} onClick={() => setNewP(true)}>New project</Button></>} />
      {!project ? <div className="card">Create a project to get started.</div> : (
        <Tabs items={[
          { key: 'tabs', label: 'Tabs', children: (<>
            <div className="toolbar"><Button icon={<PlusOutlined />} onClick={addTab}>Add custom tab</Button><Button icon={<SyncOutlined />} onClick={sync}>Sync from VMware discovery</Button><div className="grow" /><Button type="primary" loading={busy} onClick={saveTabs}>Save tabs</Button></div>
            <Table rowKey="key" size="small" pagination={false} dataSource={tabs} scroll={{ x: 'max-content' }}
              columns={[{ title: 'Show', width: 70, render: (_, r, i) => <Switch size="small" checked={r.enabled} onChange={(v) => setTab(i, { enabled: v })} /> },
                { title: 'Label', render: (_, r, i) => <Input size="small" value={r.label} onChange={(e) => setTab(i, { label: e.target.value })} /> },
                { title: 'Key', dataIndex: 'key', render: (k, r, i) => (r.type === 'custom' ? <Input size="small" style={{ width: 130 }} value={k} onChange={(e) => setTab(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /> : <span className="mono">{k}</span>) },
                { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
                { title: 'vCenter group (cluster / datacenter / folder)', render: (_, r, i) => r.type === 'hosts' || r.type === 'standalone' ? <span style={{ color: '#b5bfc1' }}>{r.type === 'hosts' ? 'optional filter' : 'all standalone ESXi VMs'}</span> : <Input size="small" value={r.vcenter_group} onChange={(e) => setTab(i, { vcenter_group: e.target.value })} /> },
                { title: 'VM name contains', render: (_, r, i) => r.type === 'hosts' || r.type === 'standalone' ? '-' : <Input size="small" value={r.name_pattern} onChange={(e) => setTab(i, { name_pattern: e.target.value })} /> },
                { title: 'Hidden columns', render: (_, r, i) => r.type === 'hosts' ? '-' : <Select size="small" mode="multiple" style={{ minWidth: 180 }} value={r.hidden_columns} options={COLS.map((c) => ({ value: c, label: c }))} onChange={(v) => setTab(i, { hidden_columns: v })} /> },
                { title: '', render: (_, r, i) => r.type === 'custom' && <Button size="small" danger onClick={() => setTabs((t) => t.filter((_, j) => j !== i))}>Remove</Button> }]} /></>) },
          { key: 'fields', label: `Custom fields (${fields.length})`, children: (<>
            <div className="toolbar"><Button icon={<PlusOutlined />} onClick={() => { setFEdit({}); fForm.resetFields(); fForm.setFieldsValue({ type: 'text', tab_keys: [] }); }}>Add field</Button></div>
            <Table rowKey="id" size="small" pagination={false} dataSource={fields}
              columns={[{ title: 'Label', dataIndex: 'label' }, { title: 'Key', dataIndex: 'key', render: (v) => <span className="mono">{v}</span> }, { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
                { title: 'Shown on', dataIndex: 'tab_keys', render: (v) => (v.length ? v.join(', ') : 'All tabs') },
                { title: '', render: (_, r) => <Space><Button size="small" onClick={() => { setFEdit(r); fForm.setFieldsValue({ ...r, options: (r.options || []).join(', ') }); }}>Edit</Button>
                  <Popconfirm title="Delete this field and its values?" onConfirm={() => api.delete(`/migration/projects/${pid}/custom-fields/${r.id}`).then(() => { message.success('Deleted'); setFields((f) => f.filter((x) => x.id !== r.id)); }).catch((e) => message.error(errMsg(e)))}><Button size="small" danger>Delete</Button></Popconfirm></Space> }]} /></>) },
          { key: 'project', label: 'Project', children: (
            <div className="card" style={{ maxWidth: 520 }}><Space direction="vertical" style={{ width: '100%' }}>
              <Input value={project.name} onChange={(e) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, name: e.target.value } : p)))} />
              <Input.TextArea rows={3} value={project.description || ''} onChange={(e) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, description: e.target.value } : p)))} />
              <span><Switch checked={project.is_active} onChange={(v) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, is_active: v } : p)))} /> Active</span>
              <Space><Button type="primary" onClick={() => act(() => api.put(`/migration/projects/${pid}`, { name: project.name, description: project.description, is_active: project.is_active }), 'Saved')}>Save</Button>
                <Popconfirm title="Delete this project and all its hosts and VMs?" okButtonProps={{ danger: true }} onConfirm={async () => { if (await act(() => api.delete(`/migration/projects/${pid}`), 'Project deleted')) load(); }}><Button danger>Delete project</Button></Popconfirm></Space></Space></div>) },
        ]} />)}
      <Modal open={newP} title="New migration project" onCancel={() => setNewP(false)} onOk={createProject} okText="Create" destroyOnClose>
        <Form form={pForm} layout="vertical"><Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item></Form>
      </Modal>
      <Modal open={!!fEdit} title={fEdit?.id ? 'Edit custom field' : 'New custom field'} onCancel={() => setFEdit(null)} onOk={saveField} okText="Save" destroyOnClose>
        <Form form={fForm} layout="vertical">
          <Form.Item name="label" label="Label" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="key" label="Key" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{1,30}$/, message: 'Lower-case letters, digits, underscores' }]} extra="Used internally and in Excel imports."><Input disabled={!!fEdit?.id} /></Form.Item>
          <Form.Item name="type" label="Type"><Select options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} /></Form.Item>
          {type === 'dropdown' && <Form.Item name="options" label="Options" rules={[{ required: true }]} extra="Comma separated"><Input /></Form.Item>}
          <Form.Item name="tab_keys" label="Show on tabs" extra="Leave empty for every tab."><Select mode="multiple" options={tabs.map((t) => ({ value: t.key, label: t.label }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
