import { useState } from 'react';
import { Alert, Avatar, Button, Form, Input } from 'antd';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import { errMsg } from '../api/client';

export default function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (v) => {
    setBusy(true); setErr('');
    try { await unlock(v.password); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const name = user.full_name || user.email;
  return (
    <AuthShell title="Locked Screen" subtitle="Enter your password to unlock the screen!"
      avatar={<div className="auth-avatar"><Avatar size={88} src={user.photo || undefined} style={{ fontSize: 34 }}>{name.slice(0, 1).toUpperCase()}</Avatar><div>{name}</div></div>}
      footer={<>Not you ? return <a onClick={logout}>Sign In</a></>}>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}><Input.Password size="large" placeholder="Enter password" autoFocus autoComplete="current-password" /></Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={busy} style={{ marginTop: 8 }}>Unlock</Button>
      </Form>
    </AuthShell>
  );
}
