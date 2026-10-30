import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App, Avatar, Button, Dropdown, Form, Input, Layout, Menu, Modal, Tooltip } from 'antd';
import { CheckOutlined, DragOutlined, KeyOutlined, LayoutOutlined, LockOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import { useThemeMode } from '../../context/ThemeContext';
import { usePages } from '../../context/PagesContext';
import { iconFor } from '../pageIcons';
import { useBranding } from '../../context/BrandingContext';
import { orderedGroups, ALL_ITEMS, rankFrom } from '../../nav';
import api, { errMsg } from '../../api/client';

const { Sider, Header, Content } = Layout;

const SUN = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const MOON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;

/** Light / dark switch for the header. Shows the icon of the mode it will switch to. */
function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const to = mode === 'dark' ? 'light' : 'dark';
  return <Tooltip title={`Switch to ${to} theme`}><button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${to} theme`}>{mode === 'dark' ? SUN : MOON}</button></Tooltip>;
}

/** Header clock: HH : MM and the long date, refreshed every 20 seconds. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);
  const hm = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', ' : ');
  return <div className="hdr-clock"><b>{hm}</b><span>{now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>;
}

function ChangePassword({ open, onClose }) {
  const { message } = App.useApp(); const [form] = Form.useForm();
  const submit = async () => {
    const v = await form.validateFields();
    try { await api.post('/auth/me/change-password', { current_password: v.current, new_password: v.next }); message.success('Password changed'); form.resetFields(); onClose(); }
    catch (e) { message.error(errMsg(e)); }
  };
  return (
    <Modal open={open} title="Change password" onCancel={onClose} onOk={submit} okText="Change password" destroyOnClose>
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item name="current" label="Current password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item name="next" label="New password" extra="At least 8 characters with upper-case, lower-case and a number."
          rules={[{ required: true }, { pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, message: 'Does not meet the password rules' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirm" label="Confirm new password" dependencies={['next']}
          rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  );
}

export default function AppLayout() {
  const { user, pages, logout, lock, has } = useAuth(); const { message } = App.useApp();
  const { app_name, logo_data_url } = useBranding();
  const { pages: designed } = usePages();
  const nav = useNavigate(); const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false); const [pw, setPw] = useState(false);
  const [editing, setEditing] = useState(false); const [order, setOrder] = useState([]); const isSuper = user.role === 'superadmin'; const [drag, setDrag] = useState(null); const [over, setOver] = useState(null);
  useEffect(() => { api.get('/nav-order').then((r) => setOrder(r.data)).catch(() => {}); }, []);
  const [openKeys, setOpenKeys] = useState([]);   // sections start closed; the one holding the current page opens with it

  const groups = useMemo(() => orderedGroups(pages, order), [pages, order]);
  const designedSorted = useMemo(() => { const rank = rankFrom(order); return [...designed].sort((a, b) => rank(`page:${a.slug}`) - rank(`page:${b.slug}`)); }, [designed, order]);
  const dynSelected = designed.find((p) => loc.pathname === `/p/${p.slug}` || loc.pathname.startsWith(`/p/${p.slug}/`));
  const selected = dynSelected ? null : ALL_ITEMS.filter((i) => (i.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.path))).sort((a, b) => b.path.length - a.path.length)[0];

  // Menu: the first static group, then the pages administrators designed, then everything else.
  // Each section is a collapsible group; order comes from Administration > Menu Order.
  const sections = [
    ...(groups[0] ? [{ id: groups[0].group, icon: groups[0].items[0].icon, items: groups[0].items.map((i) => ({ key: i.key, icon: <i.icon />, label: i.label })) }] : []),
    ...(designedSorted.length ? [{ id: 'Pages', icon: LayoutOutlined, items: designedSorted.map((p) => { const Icon = iconFor(p.icon); return { key: `page:${p.slug}`, icon: <Icon />, label: p.title }; }) }] : []),
    ...groups.slice(1).map((g) => ({ id: g.group, icon: g.items[0].icon, items: g.items.map((i) => ({ key: i.key, icon: <i.icon />, label: i.label })) })),
  ];
  const selKey = dynSelected ? `page:${dynSelected.slug}` : selected?.key;
  // Administration > "Rearrange menu" switches the sidebar into drag mode: every section opens and items can be dragged within their section.
  const REARRANGE = 'admin-nav-order';   // only the superadmin sees this entry
  const drop = (sid, to) => {
    if (!drag || drag.sid !== sid || drag.key === to) return;
    const next = sections.map((s) => {
      if (s.id !== sid) return s;
      const list = s.items.filter((x) => x.key !== REARRANGE); const from = list.findIndex((x) => x.key === drag.key); const at = list.findIndex((x) => x.key === to);
      const [moved] = list.splice(from, 1); list.splice(at, 0, moved); return { ...s, items: s.items.some((x) => x.key === REARRANGE) ? [...list, s.items.find((x) => x.key === REARRANGE)] : list };
    });
    const keys = next.flatMap((s) => s.items.map((i) => i.key)); const before = order; setOrder(keys);
    api.put('/nav-order', { keys }).catch((e) => { setOrder(before); message.error(errMsg(e)); });
  };
  const entry = (s, i) => {
    if (i.key === REARRANGE) return { key: i.key, icon: editing ? <CheckOutlined /> : <DragOutlined />, label: editing ? 'Done rearranging' : 'Rearrange menu' };
    return { key: i.key, icon: i.icon, label: editing
      ? <span className={`sider-drag ${over === i.key ? 'over' : ''}`} draggable onDragStart={() => setDrag({ sid: s.id, key: i.key })} onDragOver={(e) => { e.preventDefault(); setOver(i.key); }}
        onDragEnd={() => { setDrag(null); setOver(null); }} onDrop={() => { drop(s.id, i.key); setDrag(null); setOver(null); }}>{i.label}</span>
      : i.label };
  };
  const items = sections.map((s) => ({ key: `g-${s.id}`, icon: <s.icon />, label: s.id, children: s.items.filter((i) => isSuper || i.key !== REARRANGE).map((i) => entry(s, i)) }));
  const activeId = sections.find((s) => s.items.some((i) => i.key === selKey))?.id;
  useEffect(() => { if (activeId) setOpenKeys((k) => (k.includes(`g-${activeId}`) ? k : [...k, `g-${activeId}`])); }, [activeId]);   // landing on a page opens its section

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider width={248} collapsible collapsed={collapsed} trigger={null} breakpoint="lg" onBreakpoint={setCollapsed} style={{ overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}>
        <div className="sider-logo">{logo_data_url ? <img src={logo_data_url} alt="" /> : null}{!collapsed && <span>{app_name}</span>}</div>
        <Menu theme="dark" mode="inline" selectedKeys={selKey ? [selKey] : []} items={items}
          openKeys={collapsed ? [] : editing ? sections.map((x) => `g-${x.id}`) : openKeys} onOpenChange={setOpenKeys}
          onClick={({ key }) => { if (key === 'admin-nav-order') return setEditing(!editing); if (editing) return; if (key.startsWith('page:')) return nav(`/p/${key.slice(5)}`); const t = ALL_ITEMS.find((i) => i.key === key); if (t) nav(t.path); }} />
      </Sider>
      <Layout>
        <Header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 5 }}>
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} aria-label="Toggle menu" />
          {has('search') && <Input.Search placeholder="Search all inventories (name, IP, MAC, tag)" allowClear style={{ maxWidth: 420 }}
            onSearch={(q) => q.trim().length >= 2 && nav(`/search?q=${encodeURIComponent(q.trim())}`)} />}
          <div style={{ flex: 1 }} />
          <Clock />
          <ThemeToggle />
          <Dropdown menu={{ items: [
            { key: 'who', label: <div><b>{user.full_name || user.email}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{user.email} · {user.role}</div></div>, disabled: true },
            { type: 'divider' },
            { key: 'profile', icon: <UserOutlined />, label: 'My profile', onClick: () => nav('/profile') },
            { key: 'pw', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPw(true) },
            { key: 'lock', icon: <LockOutlined />, label: 'Lock screen', onClick: lock },
            { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => { logout(); nav('/login'); } },
          ] }} trigger={['click']}>
            <Button type="text"><Avatar size="small" src={user.photo || undefined} icon={<UserOutlined />} style={{ marginRight: 8 }} />{user.full_name || user.email}</Button>
          </Dropdown>
        </Header>
        <Content><Outlet /></Content>
      </Layout>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </Layout>
  );
}
