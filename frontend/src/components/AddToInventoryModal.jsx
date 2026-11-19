import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, AutoComplete, Form, Input, InputNumber, Modal, Select, Spin, Tag } from 'antd';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import { usePages } from '../context/PagesContext';

/**
 * Push a discovered VM into a records page. Everything is filled in from the VM and its host: name, IP (discovered or from the MAC mapping), MAC,
 * OS and OS version, status, host and host IP, CPU, memory, and the department and location of the host. The asset tag is the next free tag of the
 * department. Each value goes into whichever field of the chosen page has the matching meaning or name; you can change anything before saving.
 */
export default function AddToInventoryModal({ type, vm, open, onClose, onDone }) {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [dd, setDd] = useState({}); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const { pages } = usePages(); const targets = useMemo(() => pages.filter((p) => p.kind === 'records'), [pages]);
  const tagReq = useRef(0);
  useEffect(() => { api.get('/dropdowns').then((r) => setDd(r.data)).catch(() => {}); }, []);

  /** Next free asset tag of a department, on the chosen page (nothing when the page has no tag range for it). */
  const fillTag = useCallback(async (page, department) => {
    const mine = ++tagReq.current;
    if (!page || !department) return;
    try {
      const { data } = await api.get(`/p/${page}/tag-info`, { params: { department } });
      if (mine === tagReq.current && data.next) form.setFieldValue('asset_tag', data.next);
    } catch { /* the page has no tag range / no tag field: leave it empty */ }
  }, [form]);

  useEffect(() => {
    if (!open || !vm) return;
    form.resetFields(); setInfo(null); setLoading(true);
    const page = (targets.find((p) => /^assets?[\s_-]*records?$/i.test(p.title) || /^assets?([_-]?records?)?$/i.test(p.slug)) || targets.find((p) => /asset/i.test(`${p.title} ${p.slug}`)) || targets[0])?.slug;   // Assets Records first
    // The row already knows the basics; the server adds the host, OS version, department and location.
    form.setFieldsValue({ page, vm_name: vm.name, hostname: vm.name, ip_address: vm.ip_address, mac_address: (vm.mac_addresses || [])[0], server_status: vm.is_off ? 'Inactive' : 'Active' });
    api.get(`/${type}/vms/${vm.id}/inventory-defaults`).then((r) => {
      const d = r.data; setInfo(d);
      form.setFieldsValue({ vm_name: d.name, hostname: d.hostname, ip_address: d.ip_address || undefined, mac_address: d.mac_address || undefined, os_type: d.os_type || undefined, os_version: d.os_version || undefined,
        server_status: d.server_status, host_name: d.host_name || undefined, host_ip: d.host_ip || undefined, cpu_count: d.cpu_count || undefined, memory_gb: d.memory_gb || undefined,
        cluster: d.cluster || undefined, datacenter: d.datacenter || undefined, department: d.department || undefined, location: d.location || undefined });
      fillTag(page, d.department);
    }).catch((e) => message.error(errMsg(e))).finally(() => setLoading(false));
  }, [open, vm, form, targets, type, message, fillTag]);

  const opts = (k) => (dd[k] || []).map((v) => ({ value: v, label: v }));
  const osVersions = useMemo(() => { const t = form.getFieldValue('os_type'); const parents = dd.$parents?.os_version || {}; const all = dd.os_version || []; const mine = all.filter((v) => !parents[v] || !t || String(parents[v]).toLowerCase() === String(t).toLowerCase()); return (mine.length ? mine : all).map((v) => ({ value: v })); }, [dd, form, open, info]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const v = await form.validateFields(); setBusy(true);
    try { await api.post(`/${type}/vms/${vm.id}/add-to-inventory`, v); message.success('Added'); onDone(); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const row = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} confirmLoading={busy} okButtonProps={{ disabled: !targets.length || loading }} okText="Add record" title={`Add ${vm?.name || ''} to a page`} destroyOnClose width={720}>
      {!targets.length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="There is no page to add it to yet" description={<>Create a records page in the <Link to="/admin/pages">Page Designer</Link> first.</>} />}
      {vm && !(vm.mac_addresses || []).length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="No MAC address was discovered for this VM" description="If the chosen page requires one, enter it below." />}
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item name="page" label="Add to page" rules={[{ required: true, message: 'Choose a page' }]} extra="Only fields that carry a matching meaning or name on that page (name, IP, MAC, status, OS version, host IP, ...) are filled in.">
            <Select options={targets.map((p) => ({ value: p.slug, label: p.title }))} onChange={(page) => fillTag(page, form.getFieldValue('department'))} /></Form.Item>
          <div style={row}>
            <Form.Item name="vm_name" label="Name"><Input /></Form.Item><Form.Item name="hostname" label="Hostname"><Input /></Form.Item>
            <Form.Item name="ip_address" label={<span>IP address {info?.ip_source === 'mac_mapping' && <Tag color="blue" style={{ marginLeft: 4 }}>from MAC mapping</Tag>}</span>}><Input /></Form.Item>
            <Form.Item name="mac_address" label="MAC address"><Input /></Form.Item>
            <Form.Item name="os_type" label="Operating system"><Select allowClear options={opts('os_type')} onChange={() => form.setFieldValue('os_version', undefined)} /></Form.Item>
            <Form.Item name="os_version" label="OS version"><AutoComplete allowClear options={osVersions} filterOption={(i, o) => String(o.value).toLowerCase().includes(String(i).toLowerCase())} /></Form.Item>
            <Form.Item name="server_status" label="Status"><Select allowClear options={opts('server_status')} /></Form.Item><Form.Item name="host_name" label="Host (ESXi / node)"><Input /></Form.Item>
            <Form.Item name="host_ip" label="Host IP address"><Input /></Form.Item><Form.Item name="cluster" label="Cluster"><Input /></Form.Item>
            <Form.Item name="datacenter" label="Datacenter"><Input /></Form.Item><span />
            <Form.Item name="cpu_count" label="vCPU"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="memory_gb" label="Memory (GB)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="department" label="Department" extra={info?.department ? 'Same as its host' : undefined}><Select allowClear showSearch options={opts('department')} onChange={(dep) => fillTag(form.getFieldValue('page'), dep)} /></Form.Item>
            <Form.Item name="location" label="Location" extra={info?.location ? 'Same as its host' : undefined}><Select allowClear showSearch options={opts('location')} /></Form.Item>
            <Form.Item name="asset_tag" label="Asset tag" extra="Next free tag of the department"><Input /></Form.Item>
          </div>
        </Form>
      </Spin>
    </Modal>
  );
}
