import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { FieldBody, TYPE_LABEL } from './Designer/FieldsTab';
import { stripUi } from './Designer/util';

const BLANK = { key: 'new_field', label: 'New field', type: 'text', _auto: true };

/** Administration > Field Library: fields defined once here can be copied into any page from the Page Designer's Fields tab. */
export default function FieldLibrary() {
  const { message } = App.useApp();
  const [rows, setRows] = useState(null); const [meta, setMeta] = useState({ roles: [], types: [] }); const [cats, setCats] = useState([]);
  const [draft, setDraft] = useState(null); const [editId, setEditId] = useState(null); const [saving, setSaving] = useState(false);
  const load = useCallback(() => api.get('/field-library').then((r) => { setRows(r.data.fields); setMeta({ roles: r.data.roles, types: r.data.types }); }).catch((e) => { message.error(errMsg(e)); setRows([]); }), [message]);
  useEffect(() => { load(); api.get('/dropdowns').then((r) => setCats(Object.keys(r.data).filter((k) => !k.startsWith('$')))).catch(() => {}); }, [load]);

  const open = (r) => { setEditId(r ? r.id : null); setDraft(r ? { ...r } : { ...BLANK }); };
  const save = async () => {
    setSaving(true);
    try {
      const { id, ...body } = stripUi(draft);   // eslint-disable-line no-unused-vars
      if (editId) await api.put(`/field-library/${editId}`, body); else await api.post('/field-library', body);
      message.success('Saved'); setDraft(null); load();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const remove = (r) => api.delete(`/field-library/${r.id}`).then(() => { message.success('Removed from the library. Pages that already use it keep their copy.'); load(); }).catch((e) => message.error(errMsg(e)));
  const setCfg = (fn) => setDraft((d) => fn({ fields: [d] }).fields[0]);

  return (
    <div className="page">
      <PageHeader title="Field Library" sub="Create fields once, then add them to any page from the Page Designer." />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Fields are copied into a page" description="Editing or deleting a library field never changes pages that already use it." />
      <div className="toolbar"><Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Add field</Button></div>
      <Table size="middle" rowKey="id" loading={rows === null} dataSource={rows || []} pagination={false}
        columns={[
          { title: 'Label', dataIndex: 'label', render: (v) => <b>{v}</b> },
          { title: 'Key', dataIndex: 'key', render: (v) => <span className="mono">{v}</span> },
          { title: 'Type', dataIndex: 'type', render: (t) => TYPE_LABEL[t] || t },
          { title: 'Settings', render: (_, r) => <>{r.role && <Tag color="blue">{meta.roles.find((x) => x.key === r.role)?.label}</Tag>}{r.required && <Tag color="red">required</Tag>}{r.unique && <Tag>unique</Tag>}</> },
          { title: '', width: 90, render: (_, r) => <Space size={2}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => open(r)} aria-label="Edit" />
            <Popconfirm title={`Remove “${r.label}” from the library?`} okButtonProps={{ danger: true }} onConfirm={() => remove(r)}><Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Delete" /></Popconfirm></Space> },
        ]} />
      <Modal open={!!draft} title={editId ? 'Edit library field' : 'New library field'} onCancel={() => setDraft(null)} onOk={save} confirmLoading={saving} okText="Save" width={640} destroyOnClose>
        {draft && <FieldBody f={draft} i={0} config={{ fields: [draft] }} set={setCfg} meta={meta} categories={cats} locked={false} rename={(_, k) => setDraft((d) => ({ ...d, key: k }))} />}
      </Modal>
    </div>
  );
}
