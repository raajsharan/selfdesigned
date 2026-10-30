import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Radio, Space, Switch } from 'antd';
import api, { errMsg } from '../../api/client';

export default function ConfigModal({ open, onClose, onSaved }) {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [cfg, setCfg] = useState(null); const [otp, setOtp] = useState(null); const [busy, setBusy] = useState(false);
  const mode = Form.useWatch('auth_mode', form);
  const load = () => api.get('/endpoint-central/config').then((r) => { setCfg(r.data); form.setFieldsValue({ ...r.data, api_key: '', password: '' }); });
  useEffect(() => { if (open) { setOtp(null); load(); } }, [open]); // eslint-disable-line

  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) message.success(ok); return r; } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); } };
  const save = async () => { const v = await form.validateFields(); const r = await run(() => api.put('/endpoint-central/config', v), 'Saved'); if (r) { await load(); onSaved?.(); } return r; };
  // Test what is on screen: save the form first, otherwise the test runs against the previously saved settings.
  const test = async () => { if (await save()) await run(() => api.post('/endpoint-central/test'), 'Connection works'); };
  const login = async () => {
    if (!(await save())) return;
    const r = await run(() => api.post('/endpoint-central/login'));
    if (r?.data.otp_required) setOtp(''); else if (r) { message.success('Signed in'); load(); onSaved?.(); }
  };
  const submitOtp = async () => { const r = await run(() => api.post('/endpoint-central/login/otp', { otp }), 'Signed in'); if (r) { setOtp(null); load(); onSaved?.(); } };

  return (
    <Modal open={open} onCancel={onClose} title="Endpoint Central connection" width={560} destroyOnClose footer={[<Button key="t" loading={busy} onClick={test}>Test connection</Button>, <Button key="s" type="primary" loading={busy} onClick={save}>Save</Button>]}>
      <Form form={form} layout="vertical">
        <Form.Item name="base_url" label="Server URL" rules={[{ required: true }]} extra="For example https://endpointcentral.example.com:8383. The API path is detected automatically."><Input /></Form.Item>
        <Form.Item name="verify_ssl" label="Verify TLS certificate" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="auth_mode" label="Sign-in method"><Radio.Group optionType="button" options={[{ value: 'apikey', label: 'API key' }, { value: 'credentials', label: 'Username + password (2FA supported)' }]} /></Form.Item>
        {mode === 'apikey' ? (
          <Form.Item name="api_key" label="API key" extra={cfg?.has_api_key ? 'A key is stored. Type to replace it.' : ''}><Input.Password autoComplete="new-password" /></Form.Item>
        ) : (<>
          <Form.Item name="username" label="Username"><Input autoComplete="off" /></Form.Item>
          <Form.Item name="password" label="Password" extra={cfg?.has_password ? 'A password is stored. Type to replace it.' : ''}><Input.Password autoComplete="new-password" /></Form.Item>
          {cfg?.session_active ? <Alert type="success" showIcon message="Signed in" description={`Session valid until ${new Date(cfg.session_expires_at).toLocaleString()}. Sign in again to rotate it.`} style={{ marginBottom: 12 }} />
            : <Alert type="warning" showIcon message="Not signed in" style={{ marginBottom: 12 }} />}
          {otp === null ? <Button onClick={login} loading={busy}>Sign in</Button> : (
            <Space direction="vertical" style={{ width: '100%' }}><span>Enter the 6-digit code from your authenticator app.</span>
              <Space.Compact><Input value={otp} maxLength={6} inputMode="numeric" autoFocus onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} onPressEnter={submitOtp} style={{ width: 160, letterSpacing: 4 }} /><Button type="primary" loading={busy} disabled={otp.length !== 6} onClick={submitOtp}>Verify</Button></Space.Compact></Space>)}
        </>)}
      </Form>
    </Modal>
  );
}
