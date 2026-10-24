import { useState } from 'react';
import { App, Button, Descriptions, Drawer, Tag } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { isVisible } from './FormFields';

export default function RecordView({ page, record, open, onClose }) {
  const { message } = App.useApp(); const { user } = useAuth(); const [pw, setPw] = useState({});
  if (!record) return null;
  const fields = Object.fromEntries(page.config.fields.map((f) => [f.key, f]));
  const show = (f) => {
    if (f.type === 'password') {
      if (!record.secret_keys.includes(f.key)) return <span style={{ color: '#9aa7a9' }}>-</span>;
      if (!user.can_view_passwords) return <span style={{ color: '#5d6b6e' }}>Stored (you do not have permission to view it)</span>;
      return pw[f.key] === undefined
        ? <Button size="small" icon={<EyeOutlined />} onClick={async () => { try { setPw((p) => ({ ...p, [f.key]: undefined })); const r = await api.get(`/p/${page.slug}/records/${record.id}/secrets/${f.key}`); setPw((p) => ({ ...p, [f.key]: r.data.password || '' })); } catch (e) { message.error(errMsg(e)); } }}>Reveal</Button>
        : <span className="mono">{pw[f.key] || '(empty)'}</span>;
    }
    const v = record.data[f.key];
    if (v === undefined || v === null || v === '') return <span style={{ color: '#9aa7a9' }}>-</span>;
    if (f.type === 'boolean') return v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>;
    if (f.type === 'date') return dayjs(v).format('D MMM YYYY');
    return String(v);
  };
  return (
    <Drawer open={open} onClose={() => { setPw({}); onClose(); }} width={600} destroyOnClose
      title={record.data[page.config.fields.find((f) => f.role === 'name')?.key] || record.data[page.config.fields.find((f) => f.role === 'hostname')?.key] || `Record #${record.id}`}
      extra={record.is_decommissioned && <Tag color="red">Decommissioned</Tag>}>
      {page.config.form.sections.map((s) => {
        const items = s.items.map((i) => fields[i.key]).filter((f) => f && isVisible(f, record.data));
        return items.length ? (
          <Descriptions key={s.id} title={s.title || undefined} column={1} size="small" bordered style={{ marginBottom: 16 }} labelStyle={{ width: 170 }}>
            {items.map((f) => <Descriptions.Item key={f.key} label={f.label}>{show(f)}</Descriptions.Item>)}
          </Descriptions>) : null;
      })}
      <Descriptions column={1} size="small" bordered labelStyle={{ width: 170 }}>
        <Descriptions.Item label="Created">{dayjs(record.created_at).format('D MMM YYYY, HH:mm')}</Descriptions.Item>
        <Descriptions.Item label="Last updated">{dayjs(record.updated_at).format('D MMM YYYY, HH:mm')}</Descriptions.Item>
      </Descriptions>
    </Drawer>
  );
}
