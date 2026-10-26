import { useRef, useState } from 'react';
import { App, Avatar, Button, Form, Input, Switch } from 'antd';
import { CameraOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import api, { errMsg } from '../api/client';

const SECTIONS = [
  { key: 'general', label: 'General' },
  { key: 'password', label: 'Change Password' },
  { key: 'info', label: 'Info' },
  { key: 'social', label: 'Social links' },
  { key: 'notifications', label: 'Notifications' },
];
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const MAX_UPLOAD = 800 * 1024;
const PHOTO_SIZE = 256;

/** Crop to a centred square and shrink, so the stored photo stays small whatever was picked. */
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height); const c = document.createElement('canvas');
      c.width = c.height = PHOTO_SIZE;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image')); };
    img.src = url;
  });
}

function General() {
  const { message } = App.useApp(); const { user, setUser } = useAuth(); const [form] = Form.useForm();
  const [photo, setPhoto] = useState(user.photo || null); const [saving, setSaving] = useState(false); const file = useRef(null);
  const init = { username: user.username || '', full_name: user.full_name || '', email: user.email, company: user.company || '' };

  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|gif)$/.test(f.type)) return message.error('Choose a JPG, GIF or PNG image');
    if (f.size > MAX_UPLOAD) return message.error('The image is larger than 800 kB');
    try { setPhoto(await shrinkPhoto(f)); } catch (err) { message.error(err.message); }
  };
  const save = async (v) => {
    setSaving(true);
    try { const r = await api.put('/auth/me/profile', { ...v, photo: photo || '' }); setUser(r.data.user); message.success('Profile saved'); }
    catch (err) { message.error(errMsg(err)); } finally { setSaving(false); }
  };
  const cancel = () => { form.setFieldsValue(init); setPhoto(user.photo || null); };

  return (
    <div className="prof-general">
      <Form form={form} layout="vertical" initialValues={init} onFinish={save} requiredMark={false} className="prof-form">
        <div className="prof-grid">
          <Form.Item name="username" label="User Name" rules={[{ pattern: /^[A-Za-z0-9._-]{3,32}$/, message: '3-32 letters, digits, . - _' }]}><Input placeholder="Type Here" maxLength={32} /></Form.Item>
          <Form.Item name="full_name" label="Name"><Input placeholder="Type Here" maxLength={255} /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}><Input placeholder="Type Here" maxLength={255} /></Form.Item>
          <Form.Item name="company" label="Company"><Input placeholder="Type Here" maxLength={255} /></Form.Item>
        </div>
        <div className="prof-actions">
          <Button type="primary" htmlType="submit" loading={saving} shape="round" size="large">Save Changes</Button>
          <Button type="link" danger onClick={cancel}>Cancel</Button>
        </div>
      </Form>
      <div className="prof-photo">
        <div className="prof-photo-box">
          {photo ? <img src={photo} alt="Profile" /> : <Avatar shape="square" size={120} style={{ fontSize: 48 }}>{(user.full_name || user.email)[0].toUpperCase()}</Avatar>}
          <Button className="prof-upload" shape="round" icon={<CameraOutlined />} onClick={() => file.current?.click()}>Upload Photo</Button>
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={pick} />
        <b className="prof-photo-title">Upload A Photo</b>
        <div className="prof-hint">Allowed JPG, GIF or PNG. Max size of 800kB</div>
        {photo && <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => setPhoto(null)} style={{ padding: 0 }}>Remove photo</Button>}
      </div>
    </div>
  );
}

function Password() {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [saving, setSaving] = useState(false);
  const save = async (v) => {
    setSaving(true);
    try { await api.post('/auth/me/change-password', { current_password: v.current, new_password: v.next }); message.success('Password changed'); form.resetFields(); }
    catch (err) { message.error(errMsg(err)); } finally { setSaving(false); }
  };
  return (
    <Form form={form} layout="vertical" autoComplete="off" onFinish={save} requiredMark={false} className="prof-form">
      <div className="prof-grid">
        <Form.Item name="current" label="Current password" rules={[{ required: true, message: 'Required' }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <div />
        <Form.Item name="next" label="New password" extra="At least 8 characters with upper-case, lower-case and a number."
          rules={[{ required: true, message: 'Required' }, { pattern: PASSWORD_RULE, message: 'Does not meet the password rules' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirm" label="Confirm new password" dependencies={['next']}
          rules={[{ required: true, message: 'Required' }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </div>
      <div className="prof-actions"><Button type="primary" htmlType="submit" loading={saving} shape="round" size="large">Change Password</Button></div>
    </Form>
  );
}

/** Shared by Info and Social links: a list of text inputs saved under one section of the profile. */
function FieldsSection({ section, fields }) {
  const { message } = App.useApp(); const { user, setUser } = useAuth(); const [form] = Form.useForm(); const [saving, setSaving] = useState(false);
  const save = async (v) => {
    setSaving(true);
    try { const r = await api.put('/auth/me/profile', { [section]: v }); setUser(r.data.user); message.success('Saved'); }
    catch (err) { message.error(errMsg(err)); } finally { setSaving(false); }
  };
  return (
    <Form form={form} layout="vertical" initialValues={user[section]} onFinish={save} requiredMark={false} className="prof-form">
      <div className="prof-grid">
        {fields.map((f) => (
          <Form.Item key={f.key} name={f.key} label={f.label} style={f.wide ? { gridColumn: '1 / -1' } : undefined}
            rules={f.url ? [{ pattern: /^https?:\/\/\S+$/i, message: 'Start with http:// or https://' }] : undefined}>
            {f.long ? <Input.TextArea rows={4} maxLength={500} showCount placeholder="Type Here" /> : <Input placeholder={f.placeholder || 'Type Here'} maxLength={f.url ? 200 : 128} />}
          </Form.Item>))}
      </div>
      <div className="prof-actions">
        <Button type="primary" htmlType="submit" loading={saving} shape="round" size="large">Save Changes</Button>
        <Button type="link" danger onClick={() => form.setFieldsValue(user[section])}>Cancel</Button>
      </div>
    </Form>
  );
}

const NOTIFY = [
  { key: 'email_alerts', label: 'Email alerts', hint: 'Get an email when something you own needs attention.' },
  { key: 'weekly_report', label: 'Weekly report', hint: 'Receive the weekly inventory summary.' },
  { key: 'security_alerts', label: 'Security alerts', hint: 'Sign-in and password change notices.' },
  { key: 'product_updates', label: 'Product updates', hint: 'News about new features.' },
];

function Notifications() {
  const { message } = App.useApp(); const { user, setUser } = useAuth(); const [prefs, setPrefs] = useState(user.notifications); const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { const r = await api.put('/auth/me/profile', { notifications: prefs }); setUser(r.data.user); message.success('Notification settings saved'); }
    catch (err) { message.error(errMsg(err)); } finally { setSaving(false); }
  };
  return (
    <div className="prof-form">
      {NOTIFY.map((n) => (
        <div className="prof-notify" key={n.key}>
          <div><b>{n.label}</b><div className="prof-hint">{n.hint}</div></div>
          <Switch checked={!!prefs[n.key]} onChange={(on) => setPrefs((p) => ({ ...p, [n.key]: on }))} aria-label={n.label} />
        </div>))}
      <div className="prof-actions">
        <Button type="primary" loading={saving} shape="round" size="large" onClick={save}>Save Changes</Button>
        <Button type="link" danger onClick={() => setPrefs(user.notifications)}>Cancel</Button>
      </div>
    </div>
  );
}

const INFO_FIELDS = [
  { key: 'job_title', label: 'Job Title' }, { key: 'phone', label: 'Phone' }, { key: 'location', label: 'Location' },
  { key: 'bio', label: 'About', long: true, wide: true },
];
const SOCIAL_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', url: true, placeholder: 'https://linkedin.com/in/…' }, { key: 'twitter', label: 'Twitter / X', url: true, placeholder: 'https://x.com/…' },
  { key: 'github', label: 'GitHub', url: true, placeholder: 'https://github.com/…' }, { key: 'website', label: 'Website', url: true, placeholder: 'https://…' },
];

export default function Profile() {
  const [tab, setTab] = useState('general');
  const body = { general: <General />, password: <Password />, info: <FieldsSection section="info" fields={INFO_FIELDS} />,
    social: <FieldsSection section="social" fields={SOCIAL_FIELDS} />, notifications: <Notifications /> }[tab];
  return (
    <div className="prof-wrap">
      <nav className="prof-nav" aria-label="Account settings">
        <h2>Account Settings</h2>
        {SECTIONS.map((s) => <button key={s.key} type="button" className={tab === s.key ? 'on' : ''} aria-current={tab === s.key ? 'page' : undefined} onClick={() => setTab(s.key)}>{s.label}</button>)}
      </nav>
      <section className="prof-card">
        <h2>{tab === 'general' ? 'Account Settings' : SECTIONS.find((s) => s.key === tab).label}</h2>
        {body}
      </section>
    </div>
  );
}
