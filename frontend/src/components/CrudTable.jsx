import { useEffect, useState, useCallback, useRef } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import api, { errMsg } from '../api/client';

/**
 * Generic list + add/edit modal for simple admin resources.
 * fields: [{ name, label, type: 'text'|'number'|'bool'|'select'|'password', required, options, help }]
 */
export default function CrudTable({ path, listPath, fields, columns, createLabel = 'Add', canEdit = true, rowKey = 'id', extraActions, transform }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); const [form] = Form.useForm();
  // Callers often pass an inline `transform`; keep it in a ref so a new function identity never retriggers loading.
  const tf = useRef(transform); tf.current = transform;

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get(listPath || path); setRows(tf.current ? tf.current(r.data) : r.data); } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  }, [path, listPath, message]);
  useEffect(() => { load(); }, [load]);

  const open = (row) => { setEditing(row || {}); form.resetFields(); form.setFieldsValue(row ? { ...row } : Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]))); };
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing[rowKey]) await api.put(`${path}/${editing[rowKey]}`, v); else await api.post(path, v);
      message.success('Saved'); setEditing(null); load();
    } catch (e) { message.error(errMsg(e)); }
  };
  const remove = async (row) => { try { await api.delete(`${path}/${row[rowKey]}`); message.success('Deleted'); load(); } catch (e) { message.error(errMsg(e)); } };

  const cols = [...columns, ...(canEdit ? [{ title: '', key: 'a', width: 110, render: (_, r) => (
    <Space>{extraActions?.(r, load)}<Button size="small" icon={<EditOutlined />} onClick={() => open(r)} />
      <Popconfirm title="Delete this entry?" onConfirm={() => remove(r)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>) }] : [])];

  return (
    <>
      {canEdit && <div className="toolbar"><Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>{createLabel}</Button></div>}
      <Table rowKey={rowKey} size="small" loading={loading} dataSource={rows} columns={cols} pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
      <Modal open={!!editing} title={editing?.[rowKey] ? 'Edit' : createLabel} onCancel={() => setEditing(null)} onOk={save} okText="Save" destroyOnClose>
        <Form form={form} layout="vertical">
          {fields.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label} extra={f.help} valuePropName={f.type === 'bool' ? 'checked' : 'value'}
              rules={[{ required: f.required && !(f.type === 'password' && editing?.[rowKey]), message: `${f.label} is required` }]}>
              {f.type === 'number' ? <InputNumber style={{ width: '100%' }} min={0} />
                : f.type === 'bool' ? <Switch />
                : f.type === 'select' ? <Select options={(f.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))} showSearch />
                : f.type === 'password' ? <Input.Password autoComplete="new-password" placeholder={editing?.[rowKey] ? 'Leave blank to keep the current value' : ''} />
                : <Input maxLength={f.max || 255} />}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  );
}
