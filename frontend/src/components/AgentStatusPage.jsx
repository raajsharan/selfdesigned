import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Input, Progress, Select, Table } from 'antd';
import {
  CheckOutlined, DownOutlined, DownloadOutlined, EnvironmentOutlined, PlayCircleOutlined, RightOutlined, SearchOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageHeader from './PageHeader';
import InstallWizard from './InstallWizard';
import { downloadCsv } from '../utils/csv';

dayjs.extend(relativeTime);

const PREVIEW = 5; // rows shown per location until "Show all"
const keyOf = (r) => `${r.source}-${r.id}`;
const nameOf = (r) => r.vm_name || r.hostname || '-';
const pct = (n, d) => (d ? Math.round((n * 100) / d) : 0);

/**
 * Location-grouped agent status with install / verify through Ansible. Used by Nessus Agent Status and ME Status.
 *   base         API path, e.g. '/nessus-status' (GET list, preview, jobs)
 *   states       { <state>: { label, cls, icon } }, the values of row.agent_state
 *   covered      states that mean "an agent is present"; they make up the coverage figure
 *   cells        four summary tiles after Coverage: [{ label, sub, states: [...] }]
 *   normalize    optional (response data) => { rows, notice }
 *   lastKey/lastTitle   the date column
 *   Settings     component ({ open, onClose }) for the page's install settings
 */
export default function AgentStatusPage({ title, sub, base, csvName, states, covered, cells, normalize, lastKey = 'last_checked_at', lastTitle = 'Last checked', Settings, agentName }) {
  const { message } = App.useApp(); const { user } = useAuth(); const isAdmin = ['admin', 'superadmin'].includes(user.role);
  const [rows, setRows] = useState([]); const [notice, setNotice] = useState(null); const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(''); const [state, setState] = useState(); const [loc, setLoc] = useState('all');
  const [sel, setSel] = useState(() => new Set()); const [open, setOpen] = useState({}); const [showAll, setShowAll] = useState({});
  const [job, setJob] = useState(null); const [cfgOpen, setCfgOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = (await api.get(base)).data; const n = normalize ? normalize(d) : { rows: d, notice: null }; setRows(n.rows); setNotice(n.notice); }
    catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  }, [base, normalize, message]);
  useEffect(() => { load(); }, [load]);

  const countIn = (list, sts) => list.filter((r) => sts.includes(r.agent_state)).length;
  // Alphabetical, with assets that have no location grouped last.
  const groups = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.location || 'No location'))].sort((a, b) => (a === 'No location') - (b === 'No location') || a.localeCompare(b));
    return names.map((name) => ({ name, all: rows.filter((r) => (r.location || 'No location') === name) }));
  }, [rows]);

  const total = rows.length; const present = countIn(rows, covered);
  const match = (r) => (!state || r.agent_state === state) && (!q || [r.vm_name, r.hostname, r.ip_address].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase())));
  const startJob = (items, verifyOnly) => setJob({ items, mode: verifyOnly ? 'verify' : 'install' });

  const exportCsv = () => downloadCsv(`${csvName}-${dayjs().format('YYYY-MM-DD')}.csv`, [
    { title: 'Location', key: 'location' }, { title: 'Source', key: 'source' }, { title: 'Name', value: nameOf }, { title: 'IP', key: 'ip_address' }, { title: 'OS', key: 'os_type' },
    { title: 'Agent', value: (r) => states[r.agent_state].label }, { title: 'Version', key: 'agent_version' },
    { title: lastTitle, value: (r) => (r[lastKey] ? dayjs(r[lastKey]).format('YYYY-MM-DD HH:mm') : '') }, { title: 'Error', key: 'check_error' },
  ], rows.filter(match));

  const toggleKeys = (list, on) => setSel((s) => { const n = new Set(s); list.forEach((r) => (on ? n.add(keyOf(r)) : n.delete(keyOf(r)))); return n; });
  const chosen = rows.filter((r) => sel.has(keyOf(r)));
  const act = (r) => (r.agent_state === 'not_installed'
    ? <Button size="small" type="primary" onClick={() => startJob([r], false)}>Install</Button>
    : <Button size="small" onClick={() => startJob([r], true)}>{r.agent_state === 'failed' ? 'Retry' : 'Verify'}</Button>);

  const columns = [
    { title: 'Asset', render: (_, r) => <div><div className="nx-name">{nameOf(r)}</div><div className="nx-ip">{r.ip_address}</div></div> },
    { title: 'Operating system', dataIndex: 'os_type', render: (v) => v || '-' },
    { title: 'Agent', render: (_, r) => { const s = states[r.agent_state]; return <div><span className={`nx-pill ${s.cls}`}>{s.icon}{s.label}</span>{r.agent_state === 'failed' && r.check_error && <div className="nx-err">{r.check_error}</div>}{s.note && !r.in_ec && <div className="nx-dim small">{s.note}</div>}</div>; } },
    { title: 'Version', dataIndex: 'agent_version', render: (v) => (v ? <span className="nx-ver">{v}</span> : <span className="nx-dim">–</span>) },
    { title: lastTitle, dataIndex: lastKey, render: (v) => (v ? <span className={dayjs().diff(v, 'day') > 30 ? 'nx-stale' : ''}>{dayjs(v).fromNow()}</span> : <span className="nx-dim">Never</span>) },
    ...(isAdmin ? [{ title: '', align: 'right', render: (_, r) => act(r) }] : []),
  ];

  return (
    <div className="page">
      <PageHeader title={title} sub={sub}
        extra={<>
          {isAdmin && Settings && <Button icon={<SettingOutlined />} onClick={() => setCfgOpen(true)}>Install settings</Button>}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
          {isAdmin && <Button type="primary" icon={<PlayCircleOutlined />} disabled={!chosen.length} onClick={() => startJob(chosen, false)}>Install / verify selected ({chosen.length})</Button>}
        </>} />
      {notice && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={notice.message} description={notice.description} />}

      <div className="nx-summary">
        <div className="nx-cell"><div className="nx-k">Coverage</div><div className="nx-big">{pct(present, total)}%</div>
          <Progress percent={pct(present, total)} showInfo={false} size="small" /><div className="nx-sub">{present} of {total} assets</div></div>
        {cells.map((c) => <div className="nx-cell" key={c.label}><div className="nx-k">{c.label}</div><div className="nx-big">{countIn(rows, c.states)}</div><div className="nx-sub">{c.sub}</div></div>)}
      </div>

      <div className="nx-bar">
        <div className="nx-tabs">
          {[{ name: 'all', label: 'All locations', all: rows }, ...groups.map((g) => ({ ...g, label: g.name }))].map((g) => (
            <button key={g.name} type="button" className={`nx-tab ${loc === g.name ? 'on' : ''}`} onClick={() => setLoc(g.name)}>
              {g.label}<span>{countIn(g.all, covered)}/{g.all.length}</span></button>))}
        </div>
        <div className="nx-filters">
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search name or IP" style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
          <Select allowClear placeholder="All statuses" style={{ width: 150 }} options={Object.entries(states).map(([value, s]) => ({ value, label: s.label }))} onChange={setState} />
        </div>
      </div>

      {groups.filter((g) => loc === 'all' || loc === g.name).map((g) => {
        const shown = g.all.filter(match); const miss = g.all.filter((r) => r.agent_state === 'not_installed');
        const failed = countIn(g.all, ['failed']); const unchecked = countIn(g.all, ['not_checked']); const inst = countIn(g.all, covered);
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

      <InstallWizard base={base} agentName={agentName} job={job} onClose={() => { setJob(null); setSel(new Set()); }} onFinished={load} />
      {Settings && <Settings open={cfgOpen} onClose={() => setCfgOpen(false)} />}
    </div>
  );
}
