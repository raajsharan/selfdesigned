import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Input, Select, Spin, Switch } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { SEGMENT_LABEL } from '../Records/HostnameHelper';

const H = ({ title, sub }) => <><div style={{ fontWeight: 600, marginTop: 4 }}>{title}</div><div style={{ color: 'var(--muted)', marginBottom: 12 }}>{sub}</div></>;
const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' };

/** Code + label list (Team codes, Tier codes). */
function CodeList({ list, onChange, what }) {
  const [code, setCode] = useState(''); const [label, setLabel] = useState('');
  const add = () => { const c = code.trim().toUpperCase(); if (!c) return; onChange([...list, { code: c, label: label.trim() || c }]); setCode(''); setLabel(''); };
  const upd = (i, patch) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (<>
    {list.map((x, i) => (
      <div key={i} style={row}>
        <Input style={{ width: 90 }} value={x.code} maxLength={8} onChange={(e) => upd(i, { code: e.target.value.toUpperCase() })} />
        <Input style={{ maxWidth: 320 }} value={x.label} onChange={(e) => upd(i, { label: e.target.value })} />
        <span style={{ flex: 1 }} /><Button type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${x.code}`} onClick={() => onChange(list.filter((_, j) => j !== i))} />
      </div>))}
    <div style={{ ...row, borderBottom: 0, marginTop: 8 }}>
      <Input style={{ width: 90 }} placeholder="Code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onPressEnter={add} />
      <Input style={{ maxWidth: 320 }} placeholder="Label…" value={label} onChange={(e) => setLabel(e.target.value)} onPressEnter={add} />
      <Button type="primary" icon={<PlusOutlined />} onClick={add}>Add {what}</Button>
    </div></>);
}

/** Administration > Hostname Naming: how the "Suggested hostname" on record forms is built. */
export default function HostnamePattern() {
  const { message } = App.useApp();
  const [c, setC] = useState(null); const [saving, setSaving] = useState(false); const [loc, setLoc] = useState('');
  useEffect(() => { api.get('/hostname-pattern').then((r) => setC({ ...r.data, suggest_pages: r.data.suggest_pages ?? r.data.pages.map((p) => p.slug) })).catch((e) => message.error(errMsg(e))); }, [message]);
  if (!c) return <div className="page"><Spin /></div>;
  const set = (patch) => setC((x) => ({ ...x, ...patch }));
  const move = (i, d) => { const o = [...c.order]; [o[i], o[i + d]] = [o[i + d], o[i]]; set({ order: o }); };
  const example = { site: 'BUR', os: 'W', team: 'ITO', tier: 'P', tag: '0001' };
  const save = async () => {
    setSaving(true);
    try { const { locations, pages, ...body } = c; const r = await api.put('/hostname-pattern', body); setC(r.data); message.success('Saved'); } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const addLoc = async () => {
    if (!loc.trim()) return;
    try { const r = await api.post('/hostname-pattern/locations', { name: loc }); setC((x) => ({ ...x, locations: r.data.locations })); setLoc(''); } catch (e) { message.error(errMsg(e)); }
  };
  return (
    <div className="page">
      <PageHeader title="Hostname Naming" sub="Controls the “Suggested hostname” panel on record forms: the order segments are joined in, which asset types get it, and the Site / Team / Tier codes."
        extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save</Button>} />
      <Card style={{ marginBottom: 16 }}>
        <H title="Where it applies" sub="Choose the pages that show the Suggested hostname panel, and the pages whose form may also rename the host itself with Ansible when the record is saved." />
        <label style={{ display: 'block', marginBottom: 12 }}>Show the Suggested hostname on these pages <span style={{ color: 'var(--muted-2)' }}>(a page needs a field with the Hostname role)</span>
          <Select mode="multiple" style={{ width: '100%' }} placeholder="No pages" value={c.suggest_pages} onChange={(v) => set({ suggest_pages: v })} options={c.pages.map((p) => ({ value: p.slug, label: p.title }))} /></label>
        <label style={{ display: 'block', marginBottom: 12 }}>Offer "Apply to the host on save (Ansible)" on these pages
          <Select mode="multiple" style={{ width: '100%' }} placeholder="No pages" value={c.rename_pages} onChange={(v) => set({ rename_pages: v })} options={c.pages.map((p) => ({ value: p.slug, label: p.title }))} /></label>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Renaming changes the real machine"
          description="It connects over SSH (Linux with sudo; Windows through OpenSSH Server) with the login saved on the record, and needs the record's IP address and OS type. It only runs when the person saving ticks Apply to the host on the form. A Windows rename needs a reboot to take effect; a Linux one does not." />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><Switch checked={c.allow_reboot} onChange={(v) => set({ allow_reboot: v })} /> Reboot the host when the new name requires it</span>
          <label>Tier taken from field key <Input style={{ width: 200 }} className="mono" placeholder="optional, e.g. tier" value={c.tier_field} onChange={(e) => set({ tier_field: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></label>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <label>SSH username field(s) on the record <Input style={{ width: 280 }} value={c.login_user_fields} onChange={(e) => set({ login_user_fields: e.target.value })} /></label>
          <label>SSH password field(s) on the record <Input style={{ width: 280 }} value={c.login_pass_fields} onChange={(e) => set({ login_pass_fields: e.target.value })} /></label>
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <H title="Hostname pattern" sub="The segments below are joined into a hostname. Use the arrows to reorder. The OS letter is fixed by the record's OS (Windows = W, Linux / Proxmox = L, VMware = E)." />
        {c.order.map((s, i) => (
          <div key={s} style={row}>
            <span className="chip blue" style={{ width: 24, textAlign: 'center' }}>{i + 1}</span><span style={{ flex: 1 }}>{SEGMENT_LABEL[s]}</span>
            <Button type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
            <Button type="text" icon={<ArrowDownOutlined />} disabled={i === c.order.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
          </div>))}
        <div style={{ marginTop: 10, color: 'var(--muted)' }}>Format: {c.order.map((s) => SEGMENT_LABEL[s]).join(' + ')} — e.g. <span className="mono">{c.order.map((s) => example[s]).join('')}</span></div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <H title="Applicable asset types" sub="The panel only appears when the record's value in this field is one of the listed types. Leave empty to show it on every record." />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input style={{ width: 220 }} className="mono" placeholder="Field key, e.g. asset_type" value={c.type_field} onChange={(e) => set({ type_field: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
          <Select mode="tags" style={{ flex: 1, minWidth: 280 }} placeholder="Type a value and press Enter" value={c.types} onChange={(types) => set({ types })} tokenSeparators={[',']} />
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <H title="Site codes" sub="One short code per Location (the shared Location list). A Location left blank here can't suggest a hostname yet." />
        {c.locations.map((l) => (
          <div key={l} style={row}><span style={{ width: 180 }}>{l}</span>
            <Input style={{ width: 110 }} maxLength={8} placeholder="Code" value={c.sites[l] || ''} onChange={(e) => set({ sites: { ...c.sites, [l]: e.target.value.toUpperCase() } })} /></div>))}
        <div style={{ ...row, borderBottom: 0, marginTop: 8 }}>
          <Input style={{ maxWidth: 260 }} placeholder="Add new location…" value={loc} onChange={(e) => setLoc(e.target.value)} onPressEnter={addLoc} />
          <Button type="primary" icon={<PlusOutlined />} onClick={addLoc}>Add Location</Button></div>
      </Card>
      <Card style={{ marginBottom: 16 }}><H title="Team codes" sub="Offered in the Team select, and pre-filled by matching the department name." /><CodeList list={c.teams} what="team" onChange={(teams) => set({ teams })} /></Card>
      <Card style={{ marginBottom: 16 }}><H title="Tier codes" sub="Production / Staging / Development / etc." /><CodeList list={c.tiers} what="tier" onChange={(tiers) => set({ tiers })} /></Card>
    </div>
  );
}
