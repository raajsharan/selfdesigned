import { useEffect, useState } from 'react';
import { App, Form, Input, Modal, Typography } from 'antd';
import { CheckOutlined, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled, WarningFilled } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import AgentStatusPage from '../../components/AgentStatusPage';

// agent_state comes from Endpoint Central when it knows the asset, otherwise from our own last check (see softwareStatus).
const STATES = {
  healthy: { label: 'Healthy', cls: 'ok', icon: <CheckOutlined /> },
  vulnerable: { label: 'Vulnerable', cls: 'warn', icon: <WarningFilled style={{ fontSize: 11 }} /> },
  down: { label: 'Down', cls: 'bad', icon: <CloseCircleFilled style={{ fontSize: 11 }} /> },
  installed: { label: 'Installed', cls: 'ok', icon: <CheckOutlined />, note: 'Not yet reporting to Endpoint Central' },
  not_installed: { label: 'Not installed', cls: 'bad', icon: <CloseCircleFilled style={{ fontSize: 11 }} /> },
  failed: { label: 'Check failed', cls: 'warn', icon: <ExclamationCircleFilled style={{ fontSize: 11 }} /> },
  not_checked: { label: 'Unknown', cls: 'idle', icon: <ClockCircleOutlined /> },
};
const CELLS = [
  { label: 'Healthy', sub: 'reporting in', states: ['healthy'] },
  { label: 'Needs attention', sub: 'down or vulnerable', states: ['down', 'vulnerable'] },
  { label: 'Not installed', sub: 'needs install', states: ['not_installed'] },
  { label: 'Check failed', sub: 'could not reach', states: ['failed'] },
];
const normalize = (d) => ({ rows: d.rows, notice: d.configured ? null : { message: 'Endpoint Central data is unavailable', description: d.error } });
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** Install settings: shared folders and arguments, then the setup files of each location. */
function Settings({ open, onClose }) {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [locs, setLocs] = useState([]);
  useEffect(() => {
    if (!open) return;
    api.get('/software-status/config').then(({ data: c }) => {
      const names = [...new Set([...c.known_locations, ...Object.keys(c.locations)])];
      setLocs(names);
      form.setFieldsValue({ ...c, loc: Object.fromEntries(names.map((n) => [n, { linux: ((c.locations[n] || {}).linux_files || []).join('\n'), windows: (c.locations[n] || {}).windows_file || '' }])) });
    }).catch((e) => message.error(errMsg(e)));
  }, [open, form, message]);
  const save = async () => {
    try {
      const { loc, known_locations: _k, locations: _l, ...v } = await form.validateFields();
      const locations = Object.fromEntries(Object.entries(loc || {}).map(([n, p]) => [n, { linux_files: lines(p?.linux), windows_file: String(p?.windows || '').trim() }]));
      await api.put('/software-status/config', { ...v, locations }); message.success('Saved'); onClose();
    } catch (e) { if (!e.errorFields) message.error(errMsg(e)); }
  };
  return (
    <Modal open={open} title="ME agent install settings" width={720} onCancel={onClose} onOk={save} okText="Save" destroyOnClose forceRender>
      <Form form={form} layout="vertical" style={{ maxHeight: '65vh', overflow: 'auto', paddingRight: 8 }}>
        <Typography.Text type="secondary">Setup files live on this server (the shared path). To install, they are copied to the destination folder on the asset, which is created if missing, and run from there.</Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginTop: 12 }}>
          <Form.Item name="linux_dest_dir" label="Linux destination folder"><Input placeholder="/tmp/ManageEngineAgent" /></Form.Item>
          <Form.Item name="windows_dest_dir" label="Windows destination folder"><Input placeholder="C:\Temp\ManageEngineAgent" /></Form.Item>
          <Form.Item name="linux_install_args" label="Linux installer arguments" extra="Optional, appended to the .bin command."><Input /></Form.Item>
          <Form.Item name="windows_install_args" label="Windows installer arguments" extra="For example /silent."><Input /></Form.Item>
          <Form.Item name="login_user_fields" label="Record fields holding the login username" extra="Comma-separated keys or labels."><Input /></Form.Item>
          <Form.Item name="login_pass_fields" label="Record fields holding the login password" extra="Password-type fields."><Input /></Form.Item>
        </div>
        <Typography.Title level={5} style={{ marginTop: 8 }}>Setup files by location</Typography.Title>
        {!locs.length && <Typography.Text type="secondary">No locations yet. Add them in Dropdown Master or on the records.</Typography.Text>}
        {locs.map((n) => (
          <div key={n} className="nx-group" style={{ padding: '12px 16px 0', marginBottom: 12 }}>
            <b>{n}</b>
            <Form.Item name={['loc', n, 'linux']} label="Linux files (one path per line)" extra="Both: UEMS_LinuxAgent.bin and serverinfo.json" style={{ marginTop: 8 }}>
              <Input.TextArea rows={2} placeholder={'/srv/share/' + n + '/UEMS_LinuxAgent.bin\n/srv/share/' + n + '/serverinfo.json'} /></Form.Item>
            <Form.Item name={['loc', n, 'windows']} label="Windows file" extra="One setup file, for example BurlingtonLocalOffice_Agent.exe"><Input placeholder={'/srv/share/' + n + '/Agent.exe'} /></Form.Item>
          </div>))}
      </Form>
    </Modal>
  );
}

export default function MEStatus() {
  return <AgentStatusPage title="ME Status" sub="ManageEngine agent state for every registered asset, grouped by location. Status comes from Endpoint Central, matched by MAC, hostname or IP."
    base="/software-status" csvName="me-status" agentName="me" normalize={normalize} states={STATES} covered={['healthy', 'vulnerable', 'down', 'installed']} cells={CELLS}
    lastKey="last_contact" lastTitle="Last contact" Settings={Settings} />;
}
