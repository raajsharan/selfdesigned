import { useEffect, useState } from 'react';
import { App, Button, Dropdown, Empty, Modal, Skeleton, Tabs, Timeline } from 'antd';
import { CheckOutlined, CloseOutlined, CloudServerOutlined, CopyOutlined, DeleteOutlined, DesktopOutlined, EditOutlined, EnvironmentOutlined, EyeInvisibleOutlined, EyeOutlined,
  GlobalOutlined, LeftOutlined, LinkOutlined, MoreOutlined, RightOutlined, StopOutlined, TagOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { isVisible } from './FormFields';

const STATUS_TONE = { alive: 'green', active: 'green', online: 'green', running: 'green', 'powered off': 'orange', inactive: 'orange', maintenance: 'orange', 'not alive': 'red', failed: 'red', down: 'red' };
const tone = (v) => STATUS_TONE[String(v).toLowerCase()] || 'blue';
const ACTION_LABEL = { create: 'Created', update: 'Updated', delete: 'Moved to recycle bin', decommission: 'Decommissioned', view_password: 'Revealed a password' };

const Chip = ({ tone: t = 'blue', dot, icon, children }) => <span className={`chip ${t} rvw-chip`}>{dot && <i className="rvw-dot" />}{icon}{children}</span>;

/**
 * Record detail popup: header with actions, Details / Activity / Integrations tabs, summary strip and the page's own form sections.
 * onEdit / onDecommission / onDelete are offered only to users who can write; onStep(-1 | 1) moves to the neighbouring row.
 */
export default function RecordView({ page, record, open, onClose, onEdit, onDecommission, onDelete, onStep, canStep = {} }) {
  const { message } = App.useApp(); const { user, canWrite } = useAuth();
  const [pw, setPw] = useState({}); const [tab, setTab] = useState('details'); const [expanded, setExpanded] = useState({});
  const [activity, setActivity] = useState(null); const [integ, setInteg] = useState(null);
  const id = record?.id; const slug = page.slug;

  // Each record starts on Details with everything collapsed; the other tabs load when first opened.
  useEffect(() => { setPw({}); setTab('details'); setExpanded({}); setActivity(null); setInteg(null); }, [id]);
  useEffect(() => {
    if (!open || !id) return;
    if (tab === 'activity' && !activity) api.get(`/p/${slug}/records/${id}/activity`).then((r) => setActivity(r.data)).catch((e) => { message.error(errMsg(e)); setActivity([]); });
    if (tab === 'integrations' && !integ) api.get(`/p/${slug}/records/${id}/integrations`).then((r) => setInteg(r.data)).catch((e) => { message.error(errMsg(e)); setInteg({}); });
  }, [tab, open, id, slug, activity, integ, message]);

  if (!record) return null;
  const cfg = page.config; const d = record.data;
  const fields = Object.fromEntries(cfg.fields.map((f) => [f.key, f]));
  const byRole = (role) => cfg.fields.find((f) => f.role === role);
  const val = (f) => (f ? d[f.key] : undefined);
  const empty = (v) => v === undefined || v === null || v === '';
  const dash = <span style={{ color: 'var(--faint)' }}>-</span>;
  const copy = (text, what = 'Copied') => { navigator.clipboard?.writeText(String(text)).then(() => message.success(what), () => message.error('Copy failed')); };
  const secretSet = (f) => record.secret_keys.includes(f.key);
  const isEmpty = (f) => (f.type === 'password' ? !secretSet(f) : empty(d[f.key]));

  const toggleSecret = async (key) => {
    if (pw[key] !== undefined) return setPw((p) => { const n = { ...p }; delete n[key]; return n; });
    try { const r = await api.get(`/p/${slug}/records/${id}/secrets/${key}`); setPw((p) => ({ ...p, [key]: r.data.password || '' })); } catch (e) { message.error(errMsg(e)); }
  };

  const show = (f) => {
    if (f.type === 'password') {
      if (!user.can_view_passwords && user.role !== 'superadmin') return <span style={{ color: 'var(--muted)' }}>Stored (you do not have permission to view it)</span>;
      const shown = pw[f.key] !== undefined;
      return (<span className="rvw-secret">
        <span className="mono">{shown ? (pw[f.key] || '(empty)') : '••••••••'}</span>
        <Button type="text" size="small" icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => toggleSecret(f.key)} aria-label={shown ? 'Hide' : 'Reveal'} />
        {shown && pw[f.key] && <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copy(pw[f.key])} aria-label="Copy" />}
      </span>);
    }
    const v = d[f.key];
    if (f.type === 'boolean') return v ? <Chip tone="green" icon={<CheckOutlined />}>Yes</Chip> : <Chip tone="grey">No</Chip>;
    if (f.type === 'date') return dayjs(v).format('D MMM YYYY');
    if (f.role === 'status') return <Chip tone={tone(v)} dot>{String(v)}</Chip>;
    if (f.role === 'ip' || f.role === 'mac') return <span className="mono rvw-copy">{String(v)} <CopyOutlined onClick={() => copy(v)} aria-label="Copy" /></span>;
    return String(v);
  };

  const nameField = byRole('name') || byRole('hostname'); const ipF = byRole('ip'); const statusF = byRole('status'); const osF = byRole('os');
  const title = val(nameField) || `Record #${id}`; const status = val(statusF);
  const subtitle = [page.title, `Record #${id}`, val(osF)].filter((x) => !empty(x)).join(' · ');
  const close = () => { setPw({}); onClose(); };
  const link = `${window.location.origin}/p/${slug}?record=${id}`;

  const summary = [
    { icon: <GlobalOutlined />, label: 'IP address', f: ipF, mono: true, copy: true },
    { icon: <DesktopOutlined />, label: 'Hostname', f: byRole('hostname') },
    { icon: <TagOutlined />, label: 'Asset tag', f: byRole('asset_tag'), none: 'Not tagged' },
    { icon: <UserOutlined />, label: 'Assigned to', f: byRole('owner') },
    { icon: <EnvironmentOutlined />, label: 'Location', f: byRole('location'), sub: byRole('department') },
  ].filter((s) => s.f);

  const menu = { items: [
    { key: 'link', icon: <LinkOutlined />, label: 'Copy link', onClick: () => copy(link, 'Link copied') },
    ...(canWrite ? [
      { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => onEdit?.(record) },
      ...(!record.is_decommissioned ? [{ key: 'decom', icon: <StopOutlined />, label: 'Decommission', onClick: () => onDecommission?.(record) }] : []),
      { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Move to recycle bin', onClick: () => onDelete?.(record) },
    ] : []),
  ] };

  const details = (
    <div className="rvw-body">
      {summary.length > 0 && (
        <div className="rvw-summary">
          {summary.map((s) => { const v = val(s.f); const sub = s.sub && val(s.sub);
            return (<div key={s.label}>
              <div className="rvw-k">{s.icon} {s.label}</div>
              <div className={`rvw-v ${empty(v) ? 'rvw-none' : ''} ${s.mono ? 'mono' : ''}`}>{empty(v) ? (s.none || '-') : String(v)}{s.copy && !empty(v) && <CopyOutlined className="rvw-cp" onClick={() => copy(v)} aria-label="Copy" />}</div>
              {!empty(sub) && <div className="rvw-sub">{s.sub.label}: {String(sub)}</div>}
            </div>); })}
        </div>)}
      <div className="rvw-grid">
        {cfg.form.sections.map((s) => {
          const items = s.items.map((i) => fields[i.key]).filter((f) => f && isVisible(f, d));
          const hidden = items.filter(isEmpty); const shown = expanded[s.id] ? items : items.filter((f) => !isEmpty(f));
          if (!items.length) return null;
          return (
            <section key={s.id} className="rvw-card">
              {s.title && <h3>{s.title}</h3>}
              {shown.map((f) => <div key={f.key} className="rvw-row"><span className="rvw-label">{f.label}</span><span className="rvw-value">{isEmpty(f) ? dash : show(f)}</span></div>)}
              {hidden.length > 0 && (
                <div className="rvw-hidden"><span>{expanded[s.id] ? 'Showing' : ''} {hidden.length} empty field{hidden.length === 1 ? '' : 's'}{expanded[s.id] ? '' : ` hidden: ${hidden.map((f) => f.label).join(', ')}`}</span>
                  <Button type="link" size="small" onClick={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}>{expanded[s.id] ? 'Hide' : 'Show'}</Button></div>)}
            </section>);
        })}
      </div>
    </div>
  );

  const activityTab = (
    <div className="rvw-body">
      <section className="rvw-card">
        <h3>Activity</h3>
        {activity === null ? <Skeleton active paragraph={{ rows: 3 }} /> : !activity.length ? <Empty description="No recorded activity" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
          <Timeline style={{ marginTop: 12 }} items={activity.map((a) => ({
            children: (<div><b>{ACTION_LABEL[a.action] || a.action}</b> <span className="rvw-sub">by {a.user || 'system'} · {dayjs(a.created_at).format('D MMM YYYY, HH:mm')}</span>
              {a.field && <div className="rvw-sub">Field: {fields[a.field]?.label || a.field}</div>}
              {a.changed && Object.keys(a.changed).length > 0 && <div className="rvw-sub">Changed: {(Array.isArray(a.changed) ? a.changed : Object.keys(a.changed)).map((k) => fields[k]?.label || k).join(', ')}</div>}
              {a.reason && <div className="rvw-sub">Reason: {a.reason}</div>}</div>) }))} />)}
      </section>
    </div>);

  const src = (title, rows, render, missing) => (
    <section className="rvw-card" key={title}>
      <h3>{title}</h3>
      {rows && rows.length ? rows.map((r, i) => <div key={i} className="rvw-int">{render(r)}</div>) : <div className="rvw-sub" style={{ padding: '10px 0' }}>{missing}</div>}
    </section>);
  const integTab = (
    <div className="rvw-body">
      {integ === null ? <Skeleton active /> : (<>
        <div className="rvw-sub" style={{ marginBottom: 10 }}>{integ.matched_on ? `Matched on ${[integ.matched_on.ip && `IP ${integ.matched_on.ip}`, integ.matched_on.names?.length && `name ${integ.matched_on.names.join(' / ')}`].filter(Boolean).join(' or ')}.` : 'This record has no IP address or name to match on.'}</div>
        <div className="rvw-grid">
          {integ.vmware !== undefined && src('VMware', integ.vmware, (v) => <><b>{v.name}</b> <Chip tone={v.power_state === 'POWERED_ON' ? 'green' : 'grey'} dot>{String(v.power_state || 'unknown').replace('POWERED_', '').toLowerCase()}</Chip>
            <div className="rvw-sub">{[v.guest_os, v.host_name, v.cluster, v.tools_status && `Tools ${v.tools_status}`].filter(Boolean).join(' · ')}</div><div className="rvw-sub">Last seen {dayjs(v.last_seen).format('D MMM YYYY, HH:mm')}</div></>, 'Not found in VMware discovery')}
          {integ.proxmox !== undefined && src('Proxmox', integ.proxmox, (v) => <><b>{v.name}</b> <Chip tone={v.status === 'running' ? 'green' : 'grey'} dot>{v.status}</Chip>
            <div className="rvw-sub">{[v.os_type, v.node && `Node ${v.node}`].filter(Boolean).join(' · ')}</div><div className="rvw-sub">Last seen {dayjs(v.last_seen).format('D MMM YYYY, HH:mm')}</div></>, 'Not found in Proxmox discovery')}
          {integ.tenable !== undefined && src('Tenable', integ.tenable ? [integ.tenable] : [], (t) => <><b>{t.hostname || t.ip_address}</b>
            <div className="rvw-vuln"><Chip tone="red">Critical {t.critical}</Chip><Chip tone="red">High {t.high}</Chip><Chip tone="grey">Medium {t.medium}</Chip><Chip tone="grey">Low {t.low}</Chip></div>
            {t.last_seen && <div className="rvw-sub">Last seen {dayjs(t.last_seen).format('D MMM YYYY')}</div>}</>, 'Not in the latest Tenable import')}
          {integ.nessus !== undefined && src('Nessus agent', integ.nessus ? [integ.nessus] : [], (n) => <><Chip tone={n.installed ? 'green' : 'red'} icon={n.installed ? <CheckOutlined /> : <CloseOutlined />}>{n.installed ? 'Installed' : 'Not installed'}</Chip>
            <div className="rvw-sub">{[n.version && `Version ${n.version}`, n.last_checked_at && `Checked ${dayjs(n.last_checked_at).format('D MMM YYYY')}`].filter(Boolean).join(' · ')}</div></>, 'No agent status recorded yet')}
        </div>
        {!['vmware', 'proxmox', 'tenable', 'nessus'].some((k) => integ[k] !== undefined) && <Empty description="You do not have access to any integration pages" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </>)}
    </div>);

  return (
    <Modal open={open} onCancel={close} footer={null} closable={false} width={1100} centered destroyOnClose className="rvw-modal" styles={{ body: { padding: 0 } }}>
      <header className="rvw-head">
        <span className="rvw-icon"><CloudServerOutlined /></span>
        <div className="rvw-title">
          <div><b>{title}</b>{!empty(status) && <Chip tone={tone(status)} dot>{String(status)}</Chip>}{record.is_decommissioned && <Chip tone="red">Decommissioned</Chip>}</div>
          <div className="rvw-sub">{subtitle}</div>
        </div>
        <div className="rvw-actions">
          {canWrite && <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit?.(record)}>Edit</Button>}
          <Button icon={<LinkOutlined />} onClick={() => copy(link, 'Link copied')} aria-label="Copy link" />
          <Dropdown menu={menu} trigger={['click']} placement="bottomRight"><Button icon={<MoreOutlined />} aria-label="More actions" /></Dropdown>
          <Button icon={<CloseOutlined />} onClick={close} aria-label="Close" />
        </div>
      </header>
      <Tabs activeKey={tab} onChange={setTab} className="rvw-tabs" items={[
        { key: 'details', label: 'Details', children: details }, { key: 'activity', label: 'Activity', children: activityTab }, { key: 'integrations', label: 'Integrations', children: integTab }]} />
      <footer className="rvw-foot">
        <span className="rvw-sub">Created {dayjs(record.created_at).format('D MMM YYYY, HH:mm')} · Last updated {dayjs(record.updated_at).format('D MMM YYYY, HH:mm')}</span>
        <span className="rvw-foot-btns">
          <Button icon={<LeftOutlined />} disabled={!canStep.prev} onClick={() => onStep?.(-1)}>Previous</Button>
          <Button disabled={!canStep.next} onClick={() => onStep?.(1)}>Next <RightOutlined /></Button>
          <Button onClick={close}>Close</Button>
        </span>
      </footer>
    </Modal>
  );
}
