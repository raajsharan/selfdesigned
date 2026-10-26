import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, InputNumber, Progress, Select, Space, Switch, Table, Tabs, Tag, Tree } from 'antd';
import { CloudSyncOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { download, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageHeader, { Stat } from './PageHeader';
import useServerTable from './useServerTable';
import AddToInventoryModal from './AddToInventoryModal';
import CrudTable from './CrudTable';

const SERVER_FIELDS = {
  vmware: [{ name: 'name', label: 'Name', required: true }, { name: 'host', label: 'vCenter / ESXi host', required: true, help: 'Hostname or IP, without https://' }, { name: 'username', label: 'Username', required: true },
    { name: 'password', label: 'Password', type: 'password', required: true }, { name: 'verify_ssl', label: 'Verify TLS certificate', type: 'bool', default: true },
    { name: 'is_standalone_esxi', label: 'Standalone ESXi (not managed by vCenter)', type: 'bool', default: false }, { name: 'enabled', label: 'Enabled', type: 'bool', default: true }],
  proxmox: [{ name: 'name', label: 'Name', required: true }, { name: 'host', label: 'Proxmox host', required: true, help: 'Any cluster node. Hostname or IP, without https://' }, { name: 'port', label: 'Port', type: 'number', default: 8006 },
    { name: 'token_id', label: 'API token ID', required: true, help: 'Format: user@realm!tokenname' }, { name: 'token_secret', label: 'API token secret', type: 'password', required: true },
    { name: 'verify_ssl', label: 'Verify TLS certificate', type: 'bool', default: true }, { name: 'enabled', label: 'Enabled', type: 'bool', default: true }],
};
const stateTag = (s) => <Tag color={/on|run/i.test(s || '') && !/off/i.test(s || '') ? 'green' : /off|stop/i.test(s || '') ? 'default' : 'blue'}>{(s || 'unknown').replace('POWERED_', '').toLowerCase()}</Tag>;

function BarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return <div>{rows.map((r) => <div key={r.name} style={{ marginBottom: 6 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r.name}</span><b>{r.n}</b></div><Progress percent={(r.n / max) * 100} showInfo={false} size="small" /></div>)}</div>;
}

export default function DiscoveryPage({ type, title, sub }) {
  const { message } = App.useApp(); const { canWrite } = useAuth();
  const t = useServerTable(`/${type}/vms`, {}, 50);
  const [servers, setServers] = useState([]); const [add, setAdd] = useState(null); const [running, setRunning] = useState(false);
  const [tab, setTab] = useState('vms'); const [data, setData] = useState({}); const [mac, setMac] = useState(''); const [macRes, setMacRes] = useState(null);
  const [sched, setSched] = useState(null);

  useEffect(() => { api.get(`/${type}/servers`).then((r) => setServers(r.data)); api.get(`/${type}/schedule`).then((r) => setSched(r.data)); }, [type]);
  const loadTab = useCallback(async (k) => {
    if (['vms', 'servers', 'mac'].includes(k)) return;
    try { setData((d) => ({ ...d, [k]: null })); const r = await api.get(`/${type}/${k}`); setData((d) => ({ ...d, [k]: r.data })); } catch (e) { message.error(errMsg(e)); }
  }, [type, message]);
  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const discover = async (id) => {
    setRunning(true);
    try {
      const r = (await api.post(id ? `/${type}/discover/${id}` : `/${type}/discover`)).data.results;
      const bad = r.filter((x) => !x.ok);
      bad.length ? message.error(bad.map((b) => `${b.server || 'Server'}: ${b.error}`).join(' | ')) : message.success(`Discovery finished: ${r.reduce((a, x) => a + (x.vms || 0), 0)} VMs from ${r.length} server(s)`);
      t.reload(); loadTab(tab); api.get(`/${type}/servers`).then((x) => setServers(x.data));
    } catch (e) { message.error(errMsg(e)); } finally { setRunning(false); }
  };
  const lookup = async () => { try { setMacRes((await api.get(`/${type}/mac-lookup`, { params: { mac } })).data); } catch (e) { message.error(errMsg(e)); } };
  const saveSched = async (patch) => { const n = { ...sched, ...patch }; setSched(n); try { setSched((await api.put(`/${type}/schedule`, n)).data); } catch (e) { message.error(errMsg(e)); } };

  const vmCols = [
    { title: 'Name', dataIndex: 'name', render: (v) => <b>{v}</b>, ellipsis: true }, { title: 'State', dataIndex: 'state', render: stateTag, width: 90 },
    { title: 'IP', dataIndex: 'ip_address', render: (v) => v || '-' }, { title: 'MAC', dataIndex: 'mac_addresses', render: (v) => <span className="mono">{(v || []).join(', ') || '-'}</span> },
    { title: 'OS', dataIndex: 'os', ellipsis: true, render: (v) => v || '-' }, { title: type === 'vmware' ? 'Host' : 'Node', dataIndex: 'host', render: (v) => v || '-' },
    ...(type === 'vmware' ? [{ title: 'Cluster', dataIndex: 'cluster', render: (v) => v || '-' }] : []), { title: 'Server', dataIndex: 'server_name' },
    { title: 'CPU / RAM', render: (_, r) => `${r.cpu_count || '-'} / ${r.memory_mb ? `${Math.round(r.memory_mb / 1024)} GB` : '-'}` },
    { title: 'Inventory', dataIndex: 'in_inventory', width: 130, render: (v, r) => v ? <Tag color="green">In inventory</Tag> : (canWrite && !r.is_template ? <Button size="small" icon={<PlusOutlined />} onClick={() => setAdd(r)}>Add</Button> : <Tag>Not in inventory</Tag>) },
  ];

  const d = data;
  const tabs = [
    { key: 'vms', label: 'Virtual machines', children: (<>
      <div className="toolbar">
        <Input.Search allowClear placeholder="Search name, IP, MAC, OS" style={{ width: 280 }} onSearch={(q) => t.setFilter({ q })} />
        <Select allowClear placeholder="Server" style={{ width: 170 }} options={servers.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => t.setFilter({ server_id: v })} />
        <div className="grow" /><Button icon={<DownloadOutlined />} onClick={() => download(`/${type}/vms/export`, `${type}-vms.csv`, t.filters)}>Export CSV</Button>
      </div>
      <Table rowKey="id" size="small" loading={t.loading} dataSource={t.rows} columns={vmCols} pagination={t.pagination} scroll={{ x: 'max-content' }} />
    </>) },
    { key: 'dashboard', label: 'Dashboard', children: !d.dashboard ? null : (<>
      <div className="stat-grid"><Stat label="Total VMs" value={d.dashboard.totals.total} /><Stat label={type === 'vmware' ? 'Powered off' : 'Stopped'} value={d.dashboard.totals.off} /><Stat label="Not seen in last discovery" value={d.dashboard.totals.missing} tone={d.dashboard.totals.missing ? 'warn' : ''} />
        <Stat label="With snapshots" value={d.dashboard.totals.with_snapshots} /><Stat label="Not in inventory" value={d.dashboard.totals.not_in_inventory} tone={d.dashboard.totals.not_in_inventory ? 'warn' : 'good'} />
        <Stat label="vCPUs" value={d.dashboard.totals.cpus} /><Stat label="Memory (GB)" value={Math.round(d.dashboard.totals.memory_mb / 1024)} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 16 }}>
        {[['By state', 'by_state'], ['By server', 'by_server'], ['Top operating systems', 'by_os'], [`Top ${type === 'vmware' ? 'hosts' : 'nodes'}`, 'by_host']].map(([h, k]) => <div className="card" key={k}><b>{h}</b><div style={{ marginTop: 10 }}><BarList rows={d.dashboard[k]} /></div></div>)}</div></>) },
    { key: 'drift', label: 'Drift', children: !d.drift ? null : (<>
      <div className="stat-grid"><Stat label="In sync" value={d.drift.summary.in_sync} tone="good" /><Stat label="Differences" value={d.drift.summary.drift} tone={d.drift.summary.drift ? 'warn' : ''} /><Stat label="Not in inventory" value={d.drift.summary.not_in_inventory} tone={d.drift.summary.not_in_inventory ? 'warn' : ''} /></div>
      <Table rowKey="id" size="small" dataSource={d.drift.rows} pagination={{ pageSize: 25, hideOnSinglePage: true }} scroll={{ x: 'max-content' }}
        columns={[{ title: 'VM', dataIndex: 'name' }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'Server', dataIndex: 'server_name' },
          { title: 'Result', render: (_, r) => r.status === 'not_in_inventory' ? <Tag color="orange">Not in inventory</Tag> : <Tag color="gold">{r.issues.join('; ')}</Tag> }]} /></>) },
    { key: 'topology', label: 'Topology', children: !d.topology ? null : <Tree showLine defaultExpandAll selectable={false} treeData={d.topology.map((dc) => ({ key: dc.name, title: <b>{dc.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({dc.vms} VMs)</span></b>,
      children: dc.clusters.map((cl) => ({ key: `${dc.name}/${cl.name}`, title: `${cl.name} (${cl.vms} VMs)`, children: cl.hosts.map((h) => ({ key: `${dc.name}/${cl.name}/${h.name}`, title: `${h.name}: ${h.vms} VMs${h.off ? `, ${h.off} off` : ''}` })) })) }))} /> },
    { key: 'snapshots', label: 'Snapshots', children: !d.snapshots ? null : (<>
      {d.snapshots.note && <div className="warn-banner">{d.snapshots.note}</div>}
      <Table rowKey="id" size="small" dataSource={d.snapshots.rows} pagination={{ pageSize: 25, hideOnSinglePage: true }} locale={{ emptyText: 'No snapshots recorded' }}
        columns={[{ title: 'VM', dataIndex: 'vm_name' }, { title: 'Snapshot', dataIndex: 'snapshot' }, { title: 'Description', dataIndex: 'description' }, { title: 'Created', dataIndex: 'created_at', render: (v) => (v ? dayjs(v).format('D MMM YYYY') : '-') }, { title: 'Server', dataIndex: 'server_name' }]} /></>) },
    { key: 'stale', label: 'Stale VMs', children: !d.stale ? null : <Table rowKey="id" size="small" dataSource={d.stale} pagination={{ pageSize: 25, hideOnSinglePage: true }} locale={{ emptyText: 'Nothing stale' }}
      columns={[{ title: 'VM', dataIndex: 'name' }, { title: 'Reason', dataIndex: 'reason' }, { title: 'Server', dataIndex: 'server_name' }, { title: 'Last seen', dataIndex: 'last_seen', render: (v) => dayjs(v).format('D MMM YYYY HH:mm') }]} /> },
    { key: 'mac', label: 'MAC lookup', children: (<>
      <Space.Compact style={{ width: 420, marginBottom: 12 }}><Input value={mac} onChange={(e) => setMac(e.target.value)} onPressEnter={lookup} placeholder="Full or partial MAC, e.g. AA:BB:CC" /><Button type="primary" onClick={lookup}>Look up</Button></Space.Compact>
      {macRes && <><b>Discovered ({macRes.discovered.length})</b><Table rowKey="id" size="small" pagination={false} dataSource={macRes.discovered} style={{ marginBottom: 16 }} columns={[{ title: 'VM', dataIndex: 'name' }, { title: 'MAC', dataIndex: 'mac_addresses', render: (v) => <span className="mono">{(v || []).join(', ')}</span> }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'Server', dataIndex: 'server_name' }]} />
        <b>In inventory ({macRes.inventory.length})</b><Table rowKey={(r) => `${r.source}-${r.id}`} size="small" pagination={false} dataSource={macRes.inventory} columns={[{ title: 'Inventory', dataIndex: 'source' }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname }, { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }, { title: 'IP', dataIndex: 'ip_address' }]} /></>}
    </>) },
    { key: 'servers', label: 'Servers', children: (<>
      {sched && canWrite && <div className="toolbar"><Switch checked={sched.enabled} onChange={(v) => saveSched({ enabled: v })} /><span>Run discovery automatically every</span>
        <InputNumber min={15} max={10080} value={sched.interval_minutes} onChange={(v) => v && setSched({ ...sched, interval_minutes: v })} onBlur={() => saveSched({})} style={{ width: 90 }} /><span>minutes{sched.last_run ? ` (last run ${dayjs(sched.last_run).format('D MMM HH:mm')})` : ''}</span></div>}
      <CrudTable path={`/${type}/servers`} canEdit={canWrite} createLabel="Add server" fields={SERVER_FIELDS[type]}
        transform={(rows) => { setServers(rows); return rows; }}
        columns={[{ title: 'Name', dataIndex: 'name' }, { title: 'Host', dataIndex: 'host' }, { title: 'Enabled', dataIndex: 'enabled', render: (v) => (v ? 'Yes' : 'No') },
          { title: 'Last discovery', dataIndex: 'last_discovery_at', render: (v) => (v ? dayjs(v).format('D MMM HH:mm') : 'Never') }, { title: 'Last error', dataIndex: 'last_error', ellipsis: true, render: (v) => v ? <span style={{ color: '#cf1322' }}>{v}</span> : '-' }]}
        extraActions={(r) => <><Button size="small" onClick={async () => { try { await api.post(`/${type}/servers/${r.id}/test`); message.success('Connection OK'); } catch (e) { message.error(errMsg(e)); } }}>Test</Button>
          <Button size="small" type="primary" loading={running} onClick={() => discover(r.id)}>Discover</Button></>} /></>) },
  ];

  return (
    <div className="page">
      <PageHeader title={title} sub={sub} extra={canWrite && <Button type="primary" icon={<CloudSyncOutlined />} loading={running} onClick={() => discover()}>Run discovery</Button>} />
      <Tabs activeKey={tab} onChange={setTab} items={tabs} destroyInactiveTabPane />
      <AddToInventoryModal type={type} vm={add} open={!!add} onClose={() => setAdd(null)} onDone={() => { setAdd(null); t.reload(); }} />
    </div>
  );
}
