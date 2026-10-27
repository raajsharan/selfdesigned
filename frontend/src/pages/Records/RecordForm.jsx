import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Form, Modal } from 'antd';
import { CloseOutlined, EyeOutlined, ThunderboltOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import FormFields, { toFormValues, toPayload } from './FormFields';

/** Under the Asset tag field: shows where tags for the chosen department come from and fills in the next free one. */
function TagHelper({ slug, department, onUse }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    setInfo(null);
    if (!department) return undefined;
    let live = true;
    api.get(`/p/${slug}/tag-info`, { params: { department } }).then((r) => { if (live) setInfo(r.data); }).catch(() => { if (live) setInfo({ range: null }); });
    return () => { live = false; };
  }, [slug, department]);
  if (!department) return <div className="rfm-hint">Pick a department to get a tag from its range</div>;
  if (!info?.range) return null;
  return (
    <div className="rfm-hint rfm-hint-row">
      <span>Tags for {department} come from its range ({info.range.from} to {info.range.to})</span>
      {info.next ? <a onClick={() => onUse(info.next)}><ThunderboltOutlined /> Use next free tag</a> : <span style={{ color: 'var(--faint)' }}>Range is full</span>}
    </div>);
}

/** Add / edit popup: header, a sections sidebar that scrolls to each card, the designed form, and a footer that tracks unsaved changes (Ctrl+S saves). */
export default function RecordForm({ page, record, dropdowns, open, onClose, onSaved }) {
  const { message } = App.useApp(); const { user } = useAuth();
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false); const [revealed, setRevealed] = useState({});
  const [dirty, setDirty] = useState(false); const [active, setActive] = useState(null);
  const scroller = useRef(null);
  const cfg = page.config; const sections = (cfg.form?.sections || []).filter((s) => s.items.length);
  const roleKey = (role) => cfg.fields.find((f) => f.role === role)?.key;
  const nameKey = roleKey('name') || roleKey('hostname');

  useEffect(() => {
    if (!open) return;
    setRevealed({}); setDirty(false); setActive(sections[0]?.id || null); form.resetFields();
    form.setFieldsValue(record ? toFormValues(cfg, record.data) : toFormValues(cfg, Object.fromEntries((cfg.fields || []).filter((f) => f.type === 'boolean').map((f) => [f.key, false]))));
  }, [open, record, cfg, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (saving) return;
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const body = { data: toPayload(cfg, { ...form.getFieldsValue(true), ...values }) };
      if (record) await api.put(`/p/${page.slug}/records/${record.id}`, body); else await api.post(`/p/${page.slug}/records`, body);
      message.success(record ? 'Saved' : 'Created'); onSaved();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  }, [saving, form, cfg, record, page.slug, message, onSaved]);

  // Ctrl+S / Cmd+S saves instead of opening the browser's "save page" dialog.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, save]);

  const reveal = async (key) => {
    try { const r = await api.get(`/p/${page.slug}/records/${record.id}/secrets/${key}`); setRevealed((x) => ({ ...x, [key]: r.data.password || '' })); } catch (e) { message.error(errMsg(e)); }
  };
  const go = (id) => { setActive(id); document.getElementById(`rfm-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // Highlight the section nearest the top of the scrolling area.
  const onScroll = () => {
    const box = scroller.current; if (!box) return;
    const top = box.getBoundingClientRect().top + 40; let cur = sections[0]?.id;
    for (const s of sections) { const el = document.getElementById(`rfm-sec-${s.id}`); if (el && el.getBoundingClientRect().top <= top) cur = s.id; }
    setActive(cur);
  };
  const deptKey = roleKey('department'); const tagKey = roleKey('asset_tag');
  const name = record && nameKey ? record.data[nameKey] : null;

  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={1100} destroyOnClose maskClosable={false} centered className="rfm-modal" styles={{ body: { padding: 0 } }}>
      <header className="rfm-head">
        <div><div className="rfm-title">{record ? 'Edit record' : 'New record'}</div>
          <div className="rvw-sub">{[page.title, record && `Record #${record.id}`, name].filter(Boolean).join(' · ')}</div></div>
        <Button icon={<CloseOutlined />} onClick={onClose} aria-label="Close" />
      </header>
      <div className="rfm-main">
        <nav className="rfm-side" aria-label="Sections">
          <div className="rfm-side-h">Sections</div>
          {sections.map((s) => <button key={s.id} type="button" className={active === s.id ? 'on' : ''} onClick={() => go(s.id)}>{s.title || 'Details'}</button>)}
          <div className="rfm-note"><span style={{ color: '#ff4d4f' }}>*</span> Required. Everything else is optional.</div>
        </nav>
        <div className="rfm-scroll" ref={scroller} onScroll={onScroll}>
          <Form form={form} layout="vertical" requiredMark={(label, { required }) => <>{label}{required && <span className="rfm-req">*</span>}</>} onValuesChange={() => setDirty(true)}>
            <FormFields config={cfg} dropdowns={dropdowns} form={form} secretKeys={record?.secret_keys || []} cards
              renderAfter={(f) => {
                if (f.type === 'password' && record?.secret_keys.includes(f.key) && (user.can_view_passwords || user.role === 'superadmin')) return (
                  <div style={{ margin: '-12px 0 12px' }}><Button size="small" icon={<EyeOutlined />} onClick={() => reveal(f.key)}>Reveal stored value</Button>
                    {revealed[f.key] !== undefined && <span className="mono" style={{ marginLeft: 8 }}>{revealed[f.key] || '(empty)'}</span>}</div>);
                if (tagKey && deptKey && f.key === tagKey) return <TagHelper slug={page.slug} department={form.getFieldValue(deptKey)} onUse={(tag) => { form.setFieldValue(tagKey, tag); setDirty(true); }} />;
                return null;
              }} />
          </Form>
        </div>
      </div>
      <footer className="rfm-foot">
        <span className="rvw-sub">{dirty ? 'Unsaved changes' : record ? 'No changes yet' : 'Fill in the form'} · Ctrl+S to save</span>
        <span className="rvw-foot-btns">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} disabled={!!record && !dirty} onClick={save}>{record ? 'Save changes' : 'Create'}</Button>
        </span>
      </footer>
    </Modal>
  );
}
