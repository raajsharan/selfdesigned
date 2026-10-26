import { useState } from 'react';
import { App, Button, Modal, Tag } from 'antd';
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { isVisible } from './FormFields';

const SUMMARY_ROLES = ['os', 'department', 'location', 'asset_tag', 'owner'];
const STATUS_COLOR = { alive: 'green', active: 'green', 'powered off': 'orange', inactive: 'orange', 'not alive': 'red' };

/** Read-only record view, shown as a popup over the list. Layout follows the page's designed form sections. */
export default function RecordView({ page, record, open, onClose }) {
  const { message } = App.useApp(); const { user } = useAuth(); const [pw, setPw] = useState({});
  if (!record) return null;
  const cfg = page.config; const d = record.data;
  const fields = Object.fromEntries(cfg.fields.map((f) => [f.key, f]));
  const byRole = (role) => cfg.fields.find((f) => f.role === role);
  const val = (f) => (f ? d[f.key] : undefined);
  const empty = (v) => v === undefined || v === null || v === '';
  const dash = <span style={{ color: 'var(--faint)' }}>-</span>;
  const copy = (text) => { navigator.clipboard?.writeText(String(text)).then(() => message.success('Copied'), () => message.error('Copy failed')); };

  const toggleSecret = async (key) => {
    if (pw[key] !== undefined) return setPw((p) => { const n = { ...p }; delete n[key]; return n; });
    try { const r = await api.get(`/p/${page.slug}/records/${record.id}/secrets/${key}`); setPw((p) => ({ ...p, [key]: r.data.password || '' })); } catch (e) { message.error(errMsg(e)); }
  };

  const show = (f) => {
    if (f.type === 'password') {
      if (!record.secret_keys.includes(f.key)) return dash;
      if (!user.can_view_passwords) return <span style={{ color: 'var(--muted)' }}>Stored (you do not have permission to view it)</span>;
      const shown = pw[f.key] !== undefined;
      return (<span className="rv-secret">
        <span className="mono">{shown ? (pw[f.key] || '(empty)') : '••••••••'}</span>
        <Button type="text" size="small" icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => toggleSecret(f.key)} aria-label={shown ? 'Hide' : 'Reveal'} />
        {shown && pw[f.key] && <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copy(pw[f.key])} aria-label="Copy" />}
      </span>);
    }
    const v = d[f.key];
    if (empty(v)) return dash;
    if (f.type === 'boolean') return v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>;
    if (f.type === 'date') return dayjs(v).format('D MMM YYYY');
    if (f.role === 'status') return <Tag color={STATUS_COLOR[String(v).toLowerCase()] || 'default'}>{String(v)}</Tag>;
    if (f.role === 'ip' || f.role === 'mac') return <span className="rv-chip mono">{String(v)} <CopyOutlined onClick={() => copy(v)} style={{ cursor: 'pointer', marginLeft: 6 }} /></span>;
    return String(v);
  };

  const nameField = byRole('name') || byRole('hostname');
  const title = val(nameField) || `Record #${record.id}`;
  const ip = val(byRole('ip')); const status = val(byRole('status'));
  const summary = SUMMARY_ROLES.map(byRole).filter((f) => f && !empty(val(f)));
  const close = () => { setPw({}); onClose(); };

  return (
    <Modal open={open} onCancel={close} footer={<Button onClick={close}>Close</Button>} width={1000} centered destroyOnClose
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      title={<div className="rv-head"><span>{title}</span>
        {!empty(ip) && <span className="rv-chip mono">{ip}</span>}
        {!empty(status) && <Tag color={STATUS_COLOR[String(status).toLowerCase()] || 'default'} style={{ margin: 0 }}>{String(status)}</Tag>}
        {record.is_decommissioned && <Tag color="red" style={{ margin: 0 }}>Decommissioned</Tag>}
        <span className="rv-sub">{page.title} · viewing details</span></div>}>
      {summary.length > 0 && <div className="rv-cards">{summary.map((f) => <div key={f.key} className="rv-card"><div className="rv-card-l">{f.label}</div><div className="rv-card-v">{String(val(f))}</div></div>)}</div>}
      <div className="rv-meta">Created: <b>{dayjs(record.created_at).format('D MMM YYYY, HH:mm')}</b> · Last updated: <b>{dayjs(record.updated_at).format('D MMM YYYY, HH:mm')}</b></div>
      <div className="rv-grid">
        {cfg.form.sections.map((s) => {
          const items = s.items.map((i) => fields[i.key]).filter((f) => f && isVisible(f, d));
          return items.length ? (
            <section key={s.id} className="rv-section">
              {s.title && <h3>{s.title}</h3>}
              {items.map((f) => <div key={f.key} className="rv-row"><span className="rv-label">{f.label}</span><span className="rv-value">{show(f)}</span></div>)}
            </section>) : null;
        })}
      </div>
    </Modal>
  );
}
