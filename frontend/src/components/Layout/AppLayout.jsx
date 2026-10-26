import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App, Avatar, Button, Dropdown, Form, Input, Layout, Menu, Modal } from 'antd';
import { KeyOutlined, LockOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import { usePages } from '../../context/PagesContext';
import { iconFor } from '../pageIcons';
import { useBranding } from '../../context/BrandingContext';
import { orderedGroups, ALL_ITEMS } from '../../nav';
import api, { errMsg } from '../../api/client';

const { Sider, Header, Content } = Layout;

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
  const { user, pages, logout, lock, has } = useAuth();
  const { app_name, logo_data_url } = useBranding();
  const { pages: designed } = usePages();
  const nav = useNavigate(); const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false); const [pw, setPw] = useState(false);

  const groups = useMemo(() => orderedGroups(pages), [pages, loc.key]);   // re-read the saved order after Menu Order edits
  const dynSelected = designed.find((p) => loc.pathname === `/p/${p.slug}` || loc.pathname.startsWith(`/p/${p.slug}/`));
  const selected = dynSelected ? null : ALL_ITEMS.filter((i) => (i.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.path))).sort((a, b) => b.path.length - a.path.length)[0];

  // Menu: the first static group, then the pages administrators designed, then everything else.
  const header = (label) => (collapsed ? { type: 'divider' } : { key: `g-${label}`, label: <span className="sider-group" style={{ padding: 0 }}>{label.toUpperCase()}</span>, disabled: true, style: { cursor: 'default', height: 28, lineHeight: '28px', marginTop: 8 } });
  const staticGroup = (g) => [header(g.group), ...g.items.map((i) => ({ key: i.key, icon: <i.icon />, label: i.label }))];
  const designedGroup = designed.length ? [header('Pages'), ...designed.map((p) => { const Icon = iconFor(p.icon); return { key: `page:${p.slug}`, icon: <Icon />, label: p.title }; })] : [];
  const items = [...(groups[0] ? staticGroup(groups[0]) : []), ...designedGroup, ...groups.slice(1).flatMap(staticGroup)];

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider width={248} collapsible collapsed={collapsed} trigger={null} breakpoint="lg" onBreakpoint={setCollapsed} style={{ overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}>
        <div className="sider-logo">{logo_data_url ? <img src={logo_data_url} alt="" /> : null}{!collapsed && <span>{app_name}</span>}</div>
        <Menu theme="dark" mode="inline" selectedKeys={dynSelected ? [`page:${dynSelected.slug}`] : selected ? [selected.key] : []} items={items}
          onClick={({ key }) => { if (key.startsWith('page:')) return nav(`/p/${key.slice(5)}`); const t = ALL_ITEMS.find((i) => i.key === key); if (t) nav(t.path); }} />
      </Sider>
      <Layout>
        <Header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid #e3e8ea', position: 'sticky', top: 0, zIndex: 5 }}>
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} aria-label="Toggle menu" />
          {has('search') && <Input.Search placeholder="Search all inventories (name, IP, MAC, tag)" allowClear style={{ maxWidth: 420 }}
            onSearch={(q) => q.trim().length >= 2 && nav(`/search?q=${encodeURIComponent(q.trim())}`)} />}
          <div style={{ flex: 1 }} />
          <Dropdown menu={{ items: [
            { key: 'who', label: <div><b>{user.full_name || user.email}</b><div style={{ fontSize: 12, color: '#5d6b6e' }}>{user.email} · {user.role}</div></div>, disabled: true },
            { type: 'divider' },
            { key: 'pw', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPw(true) },
            { key: 'lock', icon: <LockOutlined />, label: 'Lock screen', onClick: lock },
            { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => { logout(); nav('/login'); } },
          ] }} trigger={['click']}>
            <Button type="text"><Avatar size="small" icon={<UserOutlined />} style={{ marginRight: 8 }} />{user.full_name || user.email}</Button>
          </Dropdown>
        </Header>
        <Content><Outlet /></Content>
      </Layout>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </Layout>
  );
}
