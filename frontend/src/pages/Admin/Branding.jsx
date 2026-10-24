import { useState } from 'react';
import { App, Button, ColorPicker, Form, Input, Upload } from 'antd';
import api, { errMsg } from '../../api/client';
import { useBranding } from '../../context/BrandingContext';
import PageHeader from '../../components/PageHeader';

export default function Branding() {
  const { message } = App.useApp(); const b = useBranding();
  const [name, setName] = useState(b.app_name); const [color, setColor] = useState(b.primary_color); const [logo, setLogo] = useState(b.logo_data_url); const [busy, setBusy] = useState(false);
  const pick = (file) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { message.error('Use a PNG, JPEG or WebP image'); return false; }
    if (file.size > 400 * 1024) { message.error('Logo must be under 400 KB'); return false; }
    const r = new FileReader(); r.onload = () => setLogo(r.result); r.readAsDataURL(file); return false;
  };
  const save = async () => { setBusy(true); try { await api.put('/branding', { app_name: name, primary_color: color, logo_data_url: logo }); await b.reload(); message.success('Branding saved'); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="page">
      <PageHeader title="Branding" sub="The name, logo and accent colour shown to everyone, including on the sign-in page." />
      <div className="card" style={{ maxWidth: 520 }}>
        <Form layout="vertical">
          <Form.Item label="Application name"><Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></Form.Item>
          <Form.Item label="Accent colour"><ColorPicker value={color} showText onChange={(c) => setColor(c.toHexString())} disabledAlpha /></Form.Item>
          <Form.Item label="Logo" extra="PNG, JPEG or WebP, under 400 KB.">
            {logo && <div style={{ background: '#14292c', padding: 12, display: 'inline-block', borderRadius: 6, marginBottom: 8 }}><img src={logo} alt="" style={{ height: 36 }} /></div>}<br />
            <Upload accept=".png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={pick}><Button>Choose image</Button></Upload>{logo && <Button type="link" onClick={() => setLogo(null)}>Remove</Button>}
          </Form.Item>
          <Button type="primary" loading={busy} onClick={save}>Save branding</Button>
        </Form>
      </div>
    </div>
  );
}
