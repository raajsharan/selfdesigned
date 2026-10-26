import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input } from 'antd';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import { errMsg } from '../api/client';

export default function Login() {
  const { login } = useAuth(); const nav = useNavigate();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (v) => {
    setBusy(true); setErr('');
    try { await login(v.email, v.password); nav('/'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Welcome Back !" subtitle="Sign in to continue.">
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter your email address' }]}><Input size="large" placeholder="Enter email" autoFocus autoComplete="username" /></Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}><Input.Password size="large" placeholder="Enter password" autoComplete="current-password" /></Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={busy} style={{ marginTop: 8 }}>Log In</Button>
      </Form>
    </AuthShell>
  );
}
