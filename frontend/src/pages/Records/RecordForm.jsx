import { useEffect, useState } from 'react';
import { App, Button, Drawer, Form, Space } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import FormFields, { toFormValues, toPayload } from './FormFields';

/** Add / edit drawer. Everything shown comes from the page's designed form layout. */
export default function RecordForm({ page, record, dropdowns, open, onClose, onSaved }) {
  const { message } = App.useApp(); const { user } = useAuth();
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false); const [revealed, setRevealed] = useState({});
  const cfg = page.config;

  useEffect(() => {
    if (!open) return;
    setRevealed({}); form.resetFields();
    form.setFieldsValue(record ? toFormValues(cfg, record.data) : toFormValues(cfg, Object.fromEntries((cfg.fields || []).filter((f) => f.type === 'boolean').map((f) => [f.key, false]))));
  }, [open, record, cfg, form]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = { data: toPayload(cfg, { ...form.getFieldsValue(true), ...values }) };
      if (record) await api.put(`/p/${page.slug}/records/${record.id}`, body); else await api.post(`/p/${page.slug}/records`, body);
      message.success(record ? 'Saved' : 'Created'); onSaved();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const reveal = async (key) => {
    try { const r = await api.get(`/p/${page.slug}/records/${record.id}/secrets/${key}`); setRevealed((x) => ({ ...x, [key]: r.data.password || '' })); } catch (e) { message.error(errMsg(e)); }
  };

  return (
    <Drawer open={open} onClose={onClose} width={680} destroyOnClose title={record ? `Edit ${page.title} record` : `New ${page.title} record`}
      extra={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={save}>{record ? 'Save changes' : 'Create'}</Button></Space>}>
      <Form form={form} layout="vertical" requiredMark="optional">
        <FormFields config={cfg} dropdowns={dropdowns} form={form} secretKeys={record?.secret_keys || []}
          renderAfter={(f) => f.type === 'password' && record?.secret_keys.includes(f.key) && user.can_view_passwords && (
            <div style={{ margin: '-12px 0 12px' }}><Button size="small" icon={<EyeOutlined />} onClick={() => reveal(f.key)}>Reveal stored value</Button>
              {revealed[f.key] !== undefined && <span className="mono" style={{ marginLeft: 8 }}>{revealed[f.key] || '(empty)'}</span>}</div>)} />
      </Form>
    </Drawer>
  );
}
