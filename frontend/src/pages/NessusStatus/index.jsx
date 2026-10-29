import { useEffect, useState } from 'react';
import { App, Form, Input, InputNumber, Modal } from 'antd';
import { CheckOutlined, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import AgentStatusPage from '../../components/AgentStatusPage';

const STATES = {
  installed: { label: 'Installed', cls: 'ok', icon: <CheckOutlined /> },
  not_installed: { label: 'Not installed', cls: 'bad', icon: <CloseCircleFilled style={{ fontSize: 11 }} /> },
  failed: { label: 'Check failed', cls: 'warn', icon: <ExclamationCircleFilled style={{ fontSize: 11 }} /> },
  not_checked: { label: 'Not checked', cls: 'idle', icon: <ClockCircleOutlined /> },
};
const CELLS = [
  { label: 'Installed', sub: 'agent present', states: ['installed'] },
  { label: 'Not installed', sub: 'needs install', states: ['not_installed'] },
  { label: 'Check failed', sub: 'could not reach', states: ['failed'] },
  { label: 'Not checked', sub: 'never verified', states: ['not_checked'] },
];

function Settings({ open, onClose }) {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [cfg, setCfg] = useState(null);
  useEffect(() => { if (open) api.get('/nessus-status/config').then((r) => { setCfg(r.data); form.setFieldsValue({ ...r.data, linking_key: '' }); }).catch((e) => message.error(errMsg(e))); }, [open, form, message]);
  const save = async () => { try { await api.put('/nessus-status/config', await form.validateFields()); message.success('Saved'); onClose(); } catch (e) { message.error(errMsg(e)); } };
  return (
    <Modal open={open} title="Nessus install settings" onCancel={onClose} onOk={save} okText="Save" destroyOnClose forceRender>
      <Form form={form} layout="vertical"><Form.Item name="linux_package_url" label="Linux package URL (https)"><Input /></Form.Item><Form.Item name="windows_msi_source" label="Windows MSI path on the Linux server" extra="Absolute path of the shared installer, e.g. /srv/share/NessusAgent-x64.msi. It is copied to each Windows box."><Input /></Form.Item>
        <Form.Item name="windows_dest_dir" label="Default Windows destination folder" extra="Created on the box if missing. Can be changed per run."><Input placeholder="C:\Temp\NessusAgent" /></Form.Item>
        <Form.Item name="manager_host" label="Tenable / Nessus manager host"><Input /></Form.Item><Form.Item name="manager_port" label="Manager port"><InputNumber min={1} max={65535} /></Form.Item>
        <Form.Item name="groups" label="Agent groups (optional)"><Input /></Form.Item>
        <Form.Item name="login_user_fields" label="Record fields holding the login username" extra="Comma-separated field keys or labels, tried in order on each asset's page."><Input /></Form.Item>
        <Form.Item name="login_pass_fields" label="Record fields holding the login password" extra="Password-type fields. Both Linux and Windows are reached over SSH (Windows needs the OpenSSH Server feature)."><Input /></Form.Item>
        <Form.Item name="linking_key" label="Linking key" extra={cfg?.has_linking_key ? 'A key is stored. Type to replace it.' : ''}><Input.Password autoComplete="new-password" /></Form.Item></Form>
    </Modal>
  );
}

export default function NessusStatus() {
  return <AgentStatusPage title="Nessus Agent Status" sub="Which assets run the agent, grouped by location." base="/nessus-status" csvName="nessus-agent-status" agentName="nessus"
    states={STATES} covered={['installed']} cells={CELLS} Settings={Settings} />;
}
