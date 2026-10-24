import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input } from 'antd';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { errMsg } from '../api/client';

export default function Login() {
  const { login } = useAuth(); const { app_name, logo_data_url } = useBranding(); const nav = useNavigate();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (v) => {
    setBusy(true); setErr('');
    try { await login(v.email, v.password); nav('/'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        {logo_data_url && <img src={logo_data_url} alt="" style={{ height: 40, marginBottom: 12 }} />}
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>{app_name}</h1>
        <p style={{ color: '#5d6b6e', margin: '0 0 20px' }}>Sign in to continue</p>
        {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter your email address' }]}><Input autoFocus autoComplete="username" /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>Sign in</Button>
        </Form>
      </div>
    </div>
  );
}
