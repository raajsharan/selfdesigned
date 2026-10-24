import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Form, Input, Modal, Select } from 'antd';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import { usePages } from '../context/PagesContext';

/** Push a discovered VM into a records page. Values are placed into whichever fields carry the matching meaning (name, IP, MAC...). */
export default function AddToInventoryModal({ type, vm, open, onClose, onDone }) {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [dd, setDd] = useState({}); const [busy, setBusy] = useState(false);
  const { pages } = usePages(); const targets = useMemo(() => pages.filter((p) => p.kind === 'records'), [pages]);
  useEffect(() => { api.get('/dropdowns').then((r) => setDd(r.data)); }, []);
  useEffect(() => {
    if (open && vm) form.setFieldsValue({ page: targets[0]?.slug, vm_name: vm.name, hostname: vm.name, ip_address: vm.ip_address, mac_address: (vm.mac_addresses || [])[0], os_type: undefined, server_status: vm.is_off ? 'Inactive' : 'Active' });
  }, [open, vm, form, targets]);
  const opts = (k) => (dd[k] || []).map((v) => ({ value: v, label: v }));
  const submit = async () => {
    const v = await form.validateFields(); setBusy(true);
    try { await api.post(`/${type}/vms/${vm.id}/add-to-inventory`, v); message.success('Added'); onDone(); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} okButtonProps={{ disabled: !targets.length }} okText="Add record" title={`Add ${vm?.name || ''} to a page`} destroyOnClose width={640}>
      {!targets.length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="There is no page to add it to yet" description={<>Create a records page in the <Link to="/admin/pages">Page Designer</Link> first.</>} />}
      {vm && !(vm.mac_addresses || []).length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="No MAC address was discovered for this VM" description="If the chosen page requires one, enter it below." />}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="page" label="Add to page" rules={[{ required: true, message: 'Choose a page' }]} extra="Only fields that carry a matching meaning on that page (name, IP, MAC, status, ...) are filled in.">
          <Select options={targets.map((p) => ({ value: p.slug, label: p.title }))} /></Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Form.Item name="vm_name" label="Name"><Input /></Form.Item><Form.Item name="hostname" label="Hostname"><Input /></Form.Item>
          <Form.Item name="ip_address" label="IP address"><Input /></Form.Item><Form.Item name="mac_address" label="MAC address"><Input /></Form.Item>
          <Form.Item name="os_type" label="Operating system"><Select allowClear options={opts('os_type')} /></Form.Item><Form.Item name="server_status" label="Status"><Select allowClear options={opts('server_status')} /></Form.Item>
          <Form.Item name="department" label="Department"><Select allowClear options={opts('department')} /></Form.Item><Form.Item name="location" label="Location"><Select allowClear options={opts('location')} /></Form.Item>
          <Form.Item name="asset_tag" label="Asset tag"><Input /></Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
