import { useEffect, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { ALL_ITEMS } from '../../nav';

export default function Roles() {
  const { message } = App.useApp(); const [d, setD] = useState({ roles: [], pages: [] }); const [edit, setEdit] = useState(null); const [form] = Form.useForm();
  const load = () => api.get('/roles').then((r) => setD(r.data)).catch((e) => message.error(errMsg(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const dyn = Object.fromEntries((d.dynamic_pages || []).map((x) => [x.key, x.label]));
  const label = (k) => ALL_ITEMS.find((i) => i.key === k)?.label || (dyn[k] ? `Page: ${dyn[k]}` : k);
  const open = (r) => { setEdit(r || {}); form.resetFields(); form.setFieldsValue(r || { pages: [], can_write: false }); };
  const save = async () => {
    const v = await form.validateFields();
    try { if (edit.id) await api.put(`/roles/${edit.id}`, v); else await api.post('/roles', v); message.success('Saved'); setEdit(null); load(); } catch (e) { message.error(errMsg(e)); }
  };
  return (
    <div className="page">
      <PageHeader title="Roles" sub="Built-in roles are fixed. Create custom roles to give a group access to specific pages." extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Add custom role</Button>} />
      <Table rowKey="name" size="small" dataSource={d.roles} pagination={false}
        columns={[{ title: 'Role', render: (_, r) => <span><b>{r.label || r.name}</b> {r.builtin && <Tag>built-in</Tag>}</span> }, { title: 'Can change data', dataIndex: 'can_write', render: (v) => (v ? 'Yes' : 'No') },
          { title: 'Pages', render: (_, r) => <span style={{ fontSize: 12, color: '#5d6b6e' }}>{r.pages.length === d.pages.length ? 'All pages' : r.pages.map(label).join(', ') || 'None'}</span> },
          { title: '', render: (_, r) => !r.builtin && <Space><Button size="small" icon={<EditOutlined />} onClick={() => open(r)} />
            <Popconfirm title="Delete this role?" onConfirm={() => api.delete(`/roles/${r.id}`).then(() => { message.success('Deleted'); load(); }).catch((e) => message.error(errMsg(e)))}><Button size="small" danger>Delete</Button></Popconfirm></Space> }]} />
      <Modal open={!!edit} onCancel={() => setEdit(null)} onOk={save} okText="Save" title={edit?.id ? `Edit role: ${edit.name}` : 'New role'} width={620} destroyOnClose>
        <Form form={form} layout="vertical">
          {!edit?.id && <Form.Item name="name" label="Role name" rules={[{ required: true }, { pattern: /^[a-z0-9_]{2,32}$/, message: 'Use 2-32 lower-case letters, digits or underscores' }]}><Input /></Form.Item>}
          <Form.Item name="description" label="Description"><Input /></Form.Item>
          <Form.Item name="can_write" label="Can create, edit and delete data" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="pages" label="Pages"><Checkbox.Group style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }} options={d.pages.map((p) => ({ value: p, label: label(p) }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
