import { useEffect, useState } from 'react';
import { App, Button, Checkbox, Modal, Select, Switch, Table, Tag } from 'antd';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { ALL_ITEMS } from '../../nav';

/** Per-user overrides: tri-state per page (role default / forced on / forced off) + password visibility. */
export default function UserPageControl() {
  const { message } = App.useApp(); const [d, setD] = useState({ users: [], pages: [] }); const [u, setU] = useState(null); const [ov, setOv] = useState({}); const [pw, setPw] = useState(false);
  const load = () => api.get('/users/page-control').then((r) => setD(r.data)).catch((e) => message.error(errMsg(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const dyn = Object.fromEntries((d.dynamic_pages || []).map((x) => [x.key, x.label]));
  const label = (k) => ALL_ITEMS.find((i) => i.key === k)?.label || (dyn[k] ? `Page: ${dyn[k]}` : k);
  const open = (x) => { setU(x); setOv(x.page_overrides || {}); setPw(x.can_view_passwords); };
  const save = async () => { try { await api.put(`/users/page-control/${u.id}`, { page_overrides: ov, can_view_passwords: pw }); message.success('Saved. Changes apply on the user\'s next request.'); setU(null); load(); } catch (e) { message.error(errMsg(e)); } };
  return (
    <div className="page">
      <PageHeader title="User Page Control" sub="Grant or remove access to individual pages for one user, and decide who can reveal stored passwords." />
      <Table rowKey="id" size="small" dataSource={d.users} pagination={{ pageSize: 25, hideOnSinglePage: true }}
        columns={[{ title: 'User', dataIndex: 'email' }, { title: 'Role', dataIndex: 'role', render: (v) => <Tag>{v}</Tag> }, { title: 'Can view passwords', dataIndex: 'can_view_passwords', render: (v) => (v ? 'Yes' : 'No') },
          { title: 'Overrides', render: (_, r) => Object.keys(r.page_overrides || {}).length || '-' }, { title: '', render: (_, r) => <Button size="small" onClick={() => open(r)}>Edit</Button> }]} />
      <Modal open={!!u} onCancel={() => setU(null)} onOk={save} okText="Save" title={`Page access: ${u?.email}`} width={620} destroyOnClose>
        <div style={{ marginBottom: 12 }}><Switch checked={pw} onChange={setPw} /> <span style={{ marginLeft: 8 }}>Can reveal stored passwords</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: '6px 12px', alignItems: 'center', maxHeight: 400, overflow: 'auto' }}>
          {d.pages.map((p) => <><span key={`l${p}`}>{label(p)}</span>
            <Select key={p} size="small" value={ov[p] === undefined ? 'default' : ov[p] ? 'on' : 'off'} options={[{ value: 'default', label: 'Role default' }, { value: 'on', label: 'Always allow' }, { value: 'off', label: 'Always block' }]}
              onChange={(v) => setOv((o) => { const n = { ...o }; if (v === 'default') delete n[p]; else n[p] = v === 'on'; return n; })} /></>)}
        </div>
      </Modal>
    </div>
  );
}
