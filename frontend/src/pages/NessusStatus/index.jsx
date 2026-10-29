import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Progress, Select, Table } from 'antd';
import {
  CheckOutlined, ClockCircleOutlined, CloseCircleFilled, DownOutlined, DownloadOutlined, EnvironmentOutlined,
  ExclamationCircleFilled, PlayCircleOutlined, RightOutlined, SearchOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import { downloadCsv } from '../../utils/csv';
import InstallWizard from './InstallWizard';

dayjs.extend(relativeTime);

const PREVIEW = 5; // rows shown per location until "Show all"
const STATES = {
  installed: { label: 'Installed', cls: 'ok', icon: <CheckOutlined /> },
  not_installed: { label: 'Not installed', cls: 'bad', icon: <CloseCircleFilled style={{ fontSize: 11 }} /> },
  failed: { label: 'Check failed', cls: 'warn', icon: <ExclamationCircleFilled style={{ fontSize: 11 }} /> },
  not_checked: { label: 'Not checked', cls: 'idle', icon: <ClockCircleOutlined /> },
};
const STATE_OPTIONS = Object.entries(STATES).map(([value, s]) => ({ value, label: s.label }));
const keyOf = (r) => `${r.source}-${r.id}`;
const nameOf = (r) => r.vm_name || r.hostname || '-';
const countBy = (rows, st) => rows.filter((r) => r.agent_state === st).length;
const pct = (n, d) => (d ? Math.round((n * 100) / d) : 0);

function StatePill({ r }) {
  const s = STATES[r.agent_state];
  return <div><span className={`nx-pill ${s.cls}`}>{s.icon}{s.label}</span>{r.agent_state === 'failed' && r.check_error && <div className="nx-err">{r.check_error}</div>}</div>;
}

export default function NessusStatus() {
  const { message } = App.useApp(); const { user } = useAuth(); const isAdmin = ['admin', 'superadmin'].includes(user.role);
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(''); const [state, setState] = useState(); const [loc, setLoc] = useState('all');
  const [sel, setSel] = useState(() => new Set()); const [open, setOpen] = useState({}); const [showAll, setShowAll] = useState({});
  const [job, setJob] = useState(null); const [cfg, setCfg] = useState(null);
  const [cform] = Form.useForm();

  const load = useCallback(async () => { setLoading(true); try { setRows((await api.get('/nessus-status')).data); } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); } }, [message]);
  useEffect(() => { load(); }, [load]);

  // Alphabetical, with assets that have no location grouped last.
  const groups = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.location || 'No location'))].sort((a, b) => (a === 'No location') - (b === 'No location') || a.localeCompare(b));
    return names.map((name) => ({ name, all: rows.filter((r) => (r.location || 'No location') === name) }));
  }, [rows]);

  const total = rows.length; const installed = countBy(rows, 'installed');
  const match = (r) => (!state || r.agent_state === state) && (!q || [r.vm_name, r.hostname, r.ip_address].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase())));

  const startJob = (items, verifyOnly) => setJob({ items, mode: verifyOnly ? 'verify' : 'install' });

  const openCfg = async () => { const c = (await api.get('/nessus-status/config')).data; setCfg(c); cform.setFieldsValue({ ...c, linking_key: '' }); };
  const saveCfg = async () => { try { await api.put('/nessus-status/config', await cform.validateFields()); message.success('Saved'); setCfg(null); } catch (e) { message.error(errMsg(e)); } };
  const exportCsv = () => downloadCsv(`nessus-agent-status-${dayjs().format('YYYY-MM-DD')}.csv`, [
    { title: 'Location', key: 'location' }, { title: 'Source', key: 'source' }, { title: 'Name', value: nameOf }, { title: 'IP', key: 'ip_address' }, { title: 'OS', key: 'os_type' },
    { title: 'Agent', value: (r) => STATES[r.agent_state].label }, { title: 'Version', key: 'agent_version' },
    { title: 'Last checked', value: (r) => (r.last_checked_at ? dayjs(r.last_checked_at).format('YYYY-MM-DD HH:mm') : '') }, { title: 'Error', key: 'check_error' },
  ], rows.filter(match));

  const toggleKeys = (list, on) => setSel((s) => { const n = new Set(s); list.forEach((r) => (on ? n.add(keyOf(r)) : n.delete(keyOf(r)))); return n; });
  const chosen = rows.filter((r) => sel.has(keyOf(r)));
  const act = (r) => (r.agent_state === 'not_installed'
    ? <Button size="small" type="primary" onClick={() => startJob([r], false)}>Install</Button>
    : <Button size="small" onClick={() => startJob([r], true)}>{r.agent_state === 'failed' ? 'Retry' : 'Verify'}</Button>);

  const columns = [
    { title: 'Asset', render: (_, r) => <div><div className="nx-name">{nameOf(r)}</div><div className="nx-ip">{r.ip_address}</div></div> },
    { title: 'Operating system', dataIndex: 'os_type', render: (v) => v || '-' },
    { title: 'Agent', render: (_, r) => <StatePill r={r} /> },
    { title: 'Version', dataIndex: 'agent_version', render: (v) => (v ? <span className="nx-ver">{v}</span> : <span className="nx-dim">–</span>) },
    { title: 'Last checked', dataIndex: 'last_checked_at', render: (v) => (v ? <span className={dayjs().diff(v, 'day') > 30 ? 'nx-stale' : ''}>{dayjs(v).fromNow()}</span> : <span className="nx-dim">Never</span>) },
    ...(isAdmin ? [{ title: '', align: 'right', render: (_, r) => act(r) }] : []),
  ];

  return (
    <div className="page">
      <PageHeader title="Nessus Agent Status" sub="Which assets run the agent, grouped by location."
        extra={<>
          {isAdmin && <Button icon={<SettingOutlined />} onClick={openCfg}>Install settings</Button>}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
          {isAdmin && <Button type="primary" icon={<PlayCircleOutlined />} disabled={!chosen.length} onClick={() => startJob(chosen, false)}>Install / verify selected ({chosen.length})</Button>}
        </>} />

      <div className="nx-summary">
        <div className="nx-cell"><div className="nx-k">Coverage</div><div className="nx-big">{pct(installed, total)}%</div>
          <Progress percent={pct(installed, total)} showInfo={false} size="small" /><div className="nx-sub">{installed} of {total} assets</div></div>
        <div className="nx-cell"><div className="nx-k">Installed</div><div className="nx-big">{installed}</div><div className="nx-sub">agent present</div></div>
        <div className="nx-cell"><div className="nx-k">Not installed</div><div className="nx-big">{countBy(rows, 'not_installed')}</div><div className="nx-sub">needs install</div></div>
        <div className="nx-cell"><div className="nx-k">Check failed</div><div className="nx-big">{countBy(rows, 'failed')}</div><div className="nx-sub">could not reach</div></div>
        <div className="nx-cell"><div className="nx-k">Not checked</div><div className="nx-big">{countBy(rows, 'not_checked')}</div><div className="nx-sub">never verified</div></div>
      </div>

      <div className="nx-bar">
        <div className="nx-tabs">
          {[{ name: 'all', label: 'All locations', all: rows }, ...groups.map((g) => ({ ...g, label: g.name }))].map((g) => (
            <button key={g.name} type="button" className={`nx-tab ${loc === g.name ? 'on' : ''}`} onClick={() => setLoc(g.name)}>
              {g.label}<span>{countBy(g.all, 'installed')}/{g.all.length}</span></button>))}
        </div>
        <div className="nx-filters">
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search name or IP" style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
          <Select allowClear placeholder="All statuses" style={{ width: 150 }} options={STATE_OPTIONS} onChange={setState} />
        </div>
      </div>

      {groups.filter((g) => loc === 'all' || loc === g.name).map((g) => {
        const shown = g.all.filter(match); const miss = g.all.filter((r) => r.agent_state === 'not_installed');
        const failed = countBy(g.all, 'failed'); const unchecked = countBy(g.all, 'not_checked'); const inst = countBy(g.all, 'installed');
        const expanded = open[g.name] ?? true; const full = showAll[g.name]; const list = full ? shown : shown.slice(0, PREVIEW);
        return (
          <section className="nx-group" key={g.name}>
            <header className="nx-ghead" onClick={() => setOpen((o) => ({ ...o, [g.name]: !expanded }))}>
              <span className="nx-chev">{expanded ? <DownOutlined /> : <RightOutlined />}</span>
              <EnvironmentOutlined /><b>{g.name}</b>
              <span className="nx-count"><b>{inst}</b> of {g.all.length} installed</span>
              <Progress className="nx-gbar" percent={pct(inst, g.all.length)} showInfo={false} size="small" />
              {miss.length > 0 && <span className="nx-tag bad">{miss.length} missing</span>}
              {failed > 0 && <span className="nx-tag warn">{failed} failed</span>}
              {unchecked > 0 && <span className="nx-tag">{unchecked} not checked</span>}
              {isAdmin && <span className="nx-gact" onClick={(e) => e.stopPropagation()}>
                <Button size="small" icon={<CheckOutlined />} onClick={() => startJob(g.all, true)}>Verify all {g.all.length}</Button>
                <Button size="small" icon={<PlayCircleOutlined />} disabled={!miss.length} onClick={() => startJob(miss, false)}>Install on {miss.length} missing</Button></span>}
            </header>
            {expanded && <>
              <Table rowKey={keyOf} size="small" loading={loading} dataSource={list} columns={columns} pagination={false} scroll={{ x: 'max-content' }}
                rowSelection={isAdmin ? { selectedRowKeys: [...sel], onSelect: (r, on) => toggleKeys([r], on), onSelectAll: (on, _, changed) => toggleKeys(changed, on), preserveSelectedRowKeys: true } : undefined}
                locale={{ emptyText: 'No assets match the filters' }} />
              <footer className="nx-gfoot"><span>Showing {list.length} of {shown.length}</span>
                {shown.length > PREVIEW && <a onClick={() => setShowAll((s) => ({ ...s, [g.name]: !full }))}>{full ? 'Show fewer' : `Show all ${shown.length}`}</a>}</footer>
            </>}
          </section>);
      })}

      <InstallWizard job={job} onClose={() => { setJob(null); setSel(new Set()); }} onFinished={load} />
      <Modal open={!!cfg} title="Nessus install settings" onCancel={() => setCfg(null)} onOk={saveCfg} okText="Save" destroyOnClose>
        <Form form={cform} layout="vertical"><Form.Item name="linux_package_url" label="Linux package URL (https)"><Input /></Form.Item><Form.Item name="windows_msi_source" label="Windows MSI path on the Linux server" extra="Absolute path of the shared installer, e.g. /srv/share/NessusAgent-x64.msi. It is copied to each Windows box."><Input /></Form.Item>
          <Form.Item name="windows_dest_dir" label="Default Windows destination folder" extra="Created on the box if missing. Can be changed per run."><Input placeholder="C:\Temp\NessusAgent" /></Form.Item>
          <Form.Item name="manager_host" label="Tenable / Nessus manager host"><Input /></Form.Item><Form.Item name="manager_port" label="Manager port"><InputNumber min={1} max={65535} /></Form.Item>
          <Form.Item name="groups" label="Agent groups (optional)"><Input /></Form.Item>
          <Form.Item name="login_user_fields" label="Record fields holding the login username" extra="Comma-separated field keys or labels, tried in order on each asset's page."><Input /></Form.Item>
          <Form.Item name="login_pass_fields" label="Record fields holding the login password" extra="Password-type fields. Both Linux and Windows are reached over SSH (Windows needs the OpenSSH Server feature)."><Input /></Form.Item>
          <Form.Item name="linking_key" label="Linking key" extra={cfg?.has_linking_key ? 'A key is stored. Type to replace it.' : ''}><Input.Password autoComplete="new-password" /></Form.Item></Form>
      </Modal>
    </div>
  );
}
