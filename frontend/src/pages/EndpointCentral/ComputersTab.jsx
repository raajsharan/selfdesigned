import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Table, Tag, Tooltip } from 'antd';
import api, { errMsg } from '../../api/client';
import { INSTALL, LIVE, Pill, Dash, contact, orDash } from './common';

const SIZES = [25, 50, 100, 200];
const opts = (map) => Object.entries(map).map(([value, s]) => ({ value, label: s.label }));

/** Every managed computer with its live and agent status and its custom groups. Filtering and paging happen on the server. */
export default function ComputersTab({ reload, groupsVersion, onTotal, onOpenGroups }) {
  const [data, setData] = useState({ rows: [], total: 0, summary: null, offices: [], groups_synced: true });
  const [groups, setGroups] = useState([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState({ q: '', live: undefined, install: undefined, group: undefined, office: undefined, page: 1, pageSize: 50 });
  const [text, setText] = useState('');
  const set = (patch) => setF((x) => ({ ...x, page: 1, ...patch }));

  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === text ? x : { ...x, q: text, page: 1 })), 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { api.get('/endpoint-central/groups').then((r) => setGroups(r.data.groups)).catch(() => {}); }, [groupsVersion]);

  const load = useCallback(async (refresh) => {
    setLoading(true); setErr('');
    try {
      const { data: d } = await api.get('/endpoint-central', { params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')), ...(refresh ? { refresh: 1 } : {}) } });
      setData(d); onTotal?.(d.summary.total);
    } catch (e) { setErr(errMsg(e)); setData((d) => ({ ...d, rows: [], total: 0 })); } finally { setLoading(false); }
  }, [f, onTotal]);
  useEffect(() => { load(false); }, [load, groupsVersion]);
  useEffect(() => { if (reload) load(true); }, [reload]); // eslint-disable-line

  const s = data.summary;
  const cells = s ? [['Computers', s.total], ['Live', s.live], ['Down', s.down], ['Unknown', s.unknown], ['Agent not installed', s.not_installed], ['Install failed', s.failed]] : [];
  const columns = [
    { title: 'Computer', dataIndex: 'name', render: (v) => (v ? <b>{v}</b> : <Dash />) },
    { title: 'IP', dataIndex: 'ip_address', render: orDash },
    { title: 'OS', dataIndex: 'os', render: orDash },
    { title: 'Live', render: (_, r) => <Pill s={LIVE[r.live_status] || LIVE[3]} /> },
    { title: 'Agent', render: (_, r) => (r.agent_install_status === null ? <Dash /> : <div><Pill s={INSTALL[r.agent_install_status] || { label: r.agent_install_text, cls: 'idle', icon: null }} />{r.agent_version && <div className="nx-ver nx-dim small">{r.agent_version}</div>}</div>) },
    { title: 'Last contact', dataIndex: 'last_contact', render: contact },
    { title: 'Office', dataIndex: 'branch_office', render: orDash },
    { title: 'Groups', render: (_, r) => (r.groups.length
      ? <span>{r.groups.slice(0, 2).map((g) => <Tag key={g.id}>{g.name}</Tag>)}{r.groups.length > 2 && <Tooltip title={r.groups.slice(2).map((g) => g.name).join(', ')}><Tag>+{r.groups.length - 2}</Tag></Tooltip>}</span>
      : <Dash />) },
  ];

  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {!data.groups_synced && !err && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Custom groups have not been copied from Endpoint Central yet."
        action={<Button size="small" onClick={onOpenGroups}>Open Custom groups</Button>} description="Open Custom groups and press Sync now. Until then the Groups column stays empty." />}
      {s && <div className="nx-summary six">{cells.map(([k, n]) => <div className="nx-cell" key={k}><div className="nx-k">{k}</div><div className="nx-big">{n}</div></div>)}</div>}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <Input.Search allowClear placeholder="Search name, IP, MAC, OS" style={{ width: 260 }} value={text} onChange={(e) => setText(e.target.value)} onSearch={(v) => set({ q: v })} />
        <Select allowClear placeholder="Live status" style={{ width: 140 }} options={opts(LIVE)} value={f.live} onChange={(v) => set({ live: v })} />
        <Select allowClear placeholder="Agent install" style={{ width: 170 }} options={opts(INSTALL)} value={f.install} onChange={(v) => set({ install: v })} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Custom group" style={{ width: 200 }} value={f.group} onChange={(v) => set({ group: v })}
          options={[{ value: 'none', label: '(none)' }, ...groups.map((g) => ({ value: String(g.id), label: g.name }))]} />
        <Select allowClear placeholder="Office" style={{ width: 160 }} value={f.office} onChange={(v) => set({ office: v })} options={[{ value: '(none)', label: '(none)' }, ...data.offices.map((o) => ({ value: o, label: o }))]} />
      </div>
      <Table rowKey={(r) => r.resource_id ?? r.name} size="small" loading={loading} dataSource={data.rows} columns={columns} scroll={{ x: 'max-content' }}
        pagination={{ current: f.page, pageSize: f.pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: SIZES, showTotal: (t) => `${t} computers`, onChange: (page, pageSize) => setF((x) => ({ ...x, page, pageSize })) }} />
    </div>
  );
}
