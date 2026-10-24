import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Switch } from 'antd';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';

export default function TeamsNotifications() {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [cfg, setCfg] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.get('/teams-notification').then((r) => { setCfg(r.data); form.setFieldsValue({ enabled: r.data.enabled, events: r.data.events, webhook_url: '' }); });
  useEffect(() => { load(); }, []); // eslint-disable-line
  const save = async () => {
    const v = await form.validateFields(); setBusy(true);
    try { await api.put('/teams-notification', { enabled: v.enabled, events: v.events, ...(v.webhook_url ? { webhook_url: v.webhook_url.trim() } : {}) }); message.success('Saved'); load(); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const test = async () => { setBusy(true); try { await api.post('/teams-notification/test'); message.success('Test card sent. Check your Teams channel.'); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); } };
  if (!cfg) return <div className="page" />;
  return (
    <div className="page">
      <PageHeader title="Teams Notifications" sub="Post a card to a Teams channel when something changes. Notifications never slow down or block the action that triggered them." />
      <div className="card" style={{ maxWidth: 640 }}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Create the webhook in Teams" description="In your channel choose Workflows, then “Post to a channel when a webhook request is received”, and paste the URL it gives you below." />
        <Form form={form} layout="vertical">
          <Form.Item name="webhook_url" label="Webhook URL" extra={cfg.webhook_configured ? 'A webhook is saved. The URL is never shown again; paste a new one to replace it.' : 'Must start with https://'}><Input.Password autoComplete="off" placeholder={cfg.webhook_configured ? '••••••••••••' : 'https://...'} /></Form.Item>
          <Form.Item name="enabled" label="Send notifications" valuePropName="checked"><Switch /></Form.Item>
          <b>Send a card when</b>
          {Object.entries(cfg.event_labels).map(([k, l]) => <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0' }}><Form.Item name={['events', k]} valuePropName="checked" noStyle><Switch size="small" /></Form.Item><span>{l}</span></div>)}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><Button type="primary" loading={busy} onClick={save}>Save configuration</Button><Button loading={busy} disabled={!cfg.webhook_configured} onClick={test}>Send test notification</Button></div>
        </Form>
      </div>
    </div>
  );
}
