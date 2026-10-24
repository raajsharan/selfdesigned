import { useEffect, useState } from 'react';
import { App, Button, Form, InputNumber, Select, Switch } from 'antd';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((l, value) => ({ value, label: l }));
export default function ComplianceConfig() {
  const { message } = App.useApp(); const [form] = Form.useForm(); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/compliance-config').then((r) => form.setFieldsValue(r.data)); }, [form]);
  const save = async () => { setBusy(true); try { await api.put('/compliance-config', await form.validateFields()); message.success('Saved'); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="page">
      <PageHeader title="Compliance Config" sub="Thresholds and sections used by the Weekly Report and Data Health." />
      <div className="card" style={{ maxWidth: 560 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="patch_threshold_days" label="An asset counts as patched if patched within (days)"><InputNumber min={1} max={365} /></Form.Item>
          <Form.Item name="patch_target_percent" label="Patch compliance target (%)"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name="stale_days" label="Flag records not updated for (days)"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name="report_day" label="Reporting day"><Select options={DAYS} style={{ width: 200 }} /></Form.Item>
          <b>Weekly report sections</b>
          {[['inventory_totals', 'Inventory totals'], ['status_breakdown', 'Status breakdown'], ['patching', 'Patching compliance'], ['extended', 'Extended inventory summary']].map(([k, l]) =>
            <Form.Item key={k} name={['sections', k]} valuePropName="checked" style={{ margin: '8px 0 0' }}><Switch size="small" /></Form.Item>).map((el, i) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{el}<span>{['Inventory totals', 'Status breakdown', 'Patching compliance', 'Extended inventory summary'][i]}</span></div>)}
          <Button type="primary" loading={busy} onClick={save} style={{ marginTop: 20 }}>Save changes</Button>
        </Form>
      </div>
    </div>
  );
}
