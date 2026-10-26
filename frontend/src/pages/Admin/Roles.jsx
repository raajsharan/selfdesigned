import { useEffect, useMemo, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { NAV } from '../../nav';

const SHOWN_PAGES = 6;   // page names listed in the table before "+N more"

/** One group of page checkboxes with its own select all / none. */
function PageGroup({ title, options, value, onChange }) {
  const keys = options.map((o) => o.value); const picked = keys.filter((k) => value.includes(k));
  const set = (on) => onChange(on ? [...new Set([...value, ...keys])] : value.filter((k) => !keys.includes(k)));
  return (
    <div className="role-group">
      <div className="role-group-head">
        <Checkbox checked={picked.length === keys.length} indeterminate={picked.length > 0 && picked.length < keys.length} onChange={(e) => set(e.target.checked)}><b>{title}</b></Checkbox>
        <span style={{ color: 'var(--muted-2)', fontSize: 12 }}>{picked.length} / {keys.length}</span>
      </div>
      <Checkbox.Group value={value.filter((k) => keys.includes(k))} options={options} className="role-group-body"
        onChange={(sel) => onChange([...value.filter((k) => !keys.includes(k)), ...sel])} />
    </div>
  );
}

export default function Roles() {
  const { message } = App.useApp(); const [d, setD] = useState({ roles: [], pages: [] }); const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [form] = Form.useForm();
  const load = () => api.get('/roles').then((r) => setD(r.data)).catch((e) => message.error(errMsg(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const dyn = useMemo(() => (d.dynamic_pages || []).map((x) => ({ value: x.key, label: x.label })), [d.dynamic_pages]);
  const labels = useMemo(() => ({ ...Object.fromEntries(NAV.flatMap((g) => g.items).map((i) => [i.key, i.label])), ...Object.fromEntries(dyn.map((x) => [x.value, `Page: ${x.label}`])) }), [dyn]);
  const groups = useMemo(() => {
    const known = new Set(d.pages);
    return [...NAV.map((g) => ({ title: g.group, options: g.items.filter((i) => known.has(i.key)).map((i) => ({ value: i.key, label: i.label })) })), { title: 'Designed pages', options: dyn }].filter((g) => g.options.length);
  }, [d.pages, dyn]);

  const open = (r) => { setEdit(r || {}); form.resetFields(); form.setFieldsValue(r ? { description: r.description, can_write: r.can_write, pages: r.pages } : { pages: [], can_write: false }); };
  const save = async () => {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (edit.builtin) await api.put(`/roles/builtin/${edit.name}`, v);
      else if (edit.id) await api.put(`/roles/${edit.id}`, v);
      else await api.post('/roles', v);
      message.success('Saved'); setEdit(null); load();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const act = (p, ok) => p.then(() => { message.success(ok); load(); }).catch((e) => message.error(errMsg(e)));

  const columns = [
    { title: 'Role', render: (_, r) => (
      <div><b>{r.label || r.name}</b> {r.builtin && <Tag>built-in</Tag>}{r.customized && <Tag color="blue">customised</Tag>}
        {r.description && <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>{r.description}</div>}</div>) },
    { title: 'Users', dataIndex: 'users', width: 70, render: (n) => n || 0 },
    { title: 'Can change data', dataIndex: 'can_write', width: 130, render: (v) => (v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>) },
    { title: 'Pages', render: (_, r) => {
      if (r.pages.length === d.pages.length) return <span className="role-pages">All pages</span>;
      if (!r.pages.length) return <span className="role-pages">None</span>;
      const names = r.pages.map((k) => labels[k] || k);
      return <span className="role-pages">{names.slice(0, SHOWN_PAGES).join(', ')}{names.length > SHOWN_PAGES && <Tooltip title={names.slice(SHOWN_PAGES).join(', ')}> <Tag style={{ marginLeft: 6, cursor: 'default' }}>+{names.length - SHOWN_PAGES} more</Tag></Tooltip>}</span>;
    } },
    { title: '', width: 230, render: (_, r) => (r.editable
      ? <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => open(r)}>Edit</Button>
          {r.builtin && r.customized && <Popconfirm title={`Reset ${r.label} to its defaults?`} onConfirm={() => act(api.delete(`/roles/builtin/${r.name}`), 'Reset to defaults')}><Button size="small" icon={<UndoOutlined />}>Reset</Button></Popconfirm>}
          {!r.builtin && (r.users
            ? <Tooltip title={`${r.users} user(s) still have this role`}><Button size="small" danger icon={<DeleteOutlined />} disabled>Delete</Button></Tooltip>
            : <Popconfirm title="Delete this role?" okButtonProps={{ danger: true }} onConfirm={() => act(api.delete(`/roles/${r.id}`), 'Deleted')}><Button size="small" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>)}
        </Space>
      : <Tooltip title="Always has full access so an administrator can never be locked out"><span style={{ color: 'var(--muted-2)' }}><LockOutlined /> Fixed</span></Tooltip>) },
  ];

  return (
    <div className="page">
      <PageHeader title="Roles" sub="Edit what each role can open and change. Admin and Superadmin are fixed; Asset Manager and Viewer can be customised and reset; custom roles are fully editable."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Add custom role</Button>} />
      <Table rowKey="name" size="small" dataSource={d.roles} pagination={false} columns={columns} />
      <Modal open={!!edit} onCancel={() => setEdit(null)} onOk={save} confirmLoading={saving} okText="Save" width={720} destroyOnClose
        title={edit?.builtin ? `Edit built-in role: ${edit.label}` : edit?.id ? `Edit role: ${edit.name}` : 'New role'}>
        <Form form={form} layout="vertical">
          {!edit?.id && !edit?.builtin && <Form.Item name="name" label="Role name" rules={[{ required: true }, { pattern: /^[a-z0-9_]{2,32}$/, message: 'Use 2-32 lower-case letters, digits or underscores' }]}><Input /></Form.Item>}
          <Form.Item name="description" label="Description"><Input maxLength={500} placeholder="What is this role for?" /></Form.Item>
          <Form.Item name="can_write" label="Can create, edit and delete data" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="pages" label="Pages this role can open" valuePropName="value" trigger="onChange" style={{ marginBottom: 0 }}>
            <PagePicker groups={groups} />
          </Form.Item>
          {edit?.builtin && <div style={{ color: 'var(--muted-2)', fontSize: 12, marginTop: 8 }}>Pages designed later are not added automatically once you customise this role; tick them here.</div>}
        </Form>
      </Modal>
    </div>
  );
}

/** Form.Item control: every group of page checkboxes, sharing one list of selected keys. */
function PagePicker({ groups, value = [], onChange }) {
  return <div className="role-picker">{groups.map((g) => <PageGroup key={g.title} title={g.title} options={g.options} value={value} onChange={onChange} />)}</div>;
}
