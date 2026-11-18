import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Empty, Select, Spin } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { download, errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';

// Colours work on the light and the dark theme. Used-% levels follow the mockup: under 70 healthy, 70-85 warning, over 85 critical.
const LEVEL = (p) => (p > 85 ? { fill: '#d64545', text: '#e5484d', name: 'Over 85%' } : p >= 70 ? { fill: '#e0a020', text: '#d68a00', name: '70-85%' } : { fill: '#2f9e6e', text: '#2f9e6e', name: 'Healthy' });
const SERIES = [{ key: 'cpu', label: 'CPU', unit: 'GHz', dec: 0, color: '#3b82f6' }, { key: 'ram', label: 'RAM', unit: 'GB', dec: 0, color: '#f97316' }, { key: 'storage', label: 'Storage', unit: 'TB', dec: 1, color: '#14b8a6' }];
const FIELD = { cpu: ['cpu_ghz_total', 'cpu_ghz_used'], ram: ['ram_gb_total', 'ram_gb_used'], storage: ['storage_tb_total', 'storage_tb_used'] };
const nf = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d });

/** Capacity / used of one metric over a list of hosts. Shared datastores (several hosts, one datastore) are counted once. */
function totals(list, key) {
  if (key === 'storage') {
    const seen = new Map();
    for (const h of list) for (const d of h.datastores) if (!seen.has(d.key)) seen.set(d.key, d);
    let cap = 0; let used = 0; seen.forEach((d) => { cap += d.total_tb; used += d.used_tb; });
    return { cap, used };
  }
  const [c, u] = FIELD[key];
  return list.reduce((a, h) => ({ cap: a.cap + (h[c] || 0), used: a.used + (h[u] || 0) }), { cap: 0, used: 0 });
}
function metric(s, cap, used, mode) {
  const usedPct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0; const freePct = cap > 0 ? 100 - usedPct : 0; const L = LEVEL(usedPct);
  return { ...s, usedPct, freePct, fill: L.fill, textColor: L.text, level: L.name, head: `${mode === 'used' ? usedPct : freePct}%`, sub: mode === 'used' ? 'used' : 'free',
    usedTxt: `${nf(used, s.dec)} ${s.unit}`, freeTxt: `${nf(cap - used, s.dec)} ${s.unit}`, capTxt: `${nf(cap, s.dec)} ${s.unit}`, abs: `${nf(used, s.dec)} / ${nf(cap, s.dec)} ${s.unit}` };
}
const metricsOf = (list, mode) => SERIES.map((s) => { const t = totals(list, s.key); return metric(s, t.cap, t.used, mode); });

const Bar = ({ pct, fill, h = 10 }) => <div style={{ height: h, borderRadius: h / 2, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: fill }} /></div>;

/** Migration & Discovery > ESXi Utilization: CPU, RAM and storage capacity and usage of the ESXi hosts, by department. */
export default function EsxiUtilization() {
  const { message } = App.useApp();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(false);
  const [loc, setLoc] = useState('all'); const [dept, setDept] = useState('all'); const [mode, setMode] = useState('used'); const [sort, setSort] = useState('name');

  const load = useCallback(() => { setLoading(true); return api.get('/esxi-utilization').then((r) => setData(r.data)).catch((e) => { message.error(errMsg(e)); setData({ hosts: [], without_stats: 0, collected_at: null }); }).finally(() => setLoading(false)); }, [message]);
  useEffect(() => { load(); }, [load]);

  const all = data?.hosts || [];
  const locations = useMemo(() => [...new Set(all.map((h) => h.location))].sort(), [all]);
  const hosts = useMemo(() => all.filter((h) => loc === 'all' || h.location === loc), [all, loc]);
  const deptNames = useMemo(() => [...new Set(hosts.map((h) => h.department))].sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b)), [hosts]);
  const depts = useMemo(() => deptNames.map((n) => { const list = hosts.filter((h) => h.department === n); return { name: n, hosts: list.length, vms: list.reduce((a, h) => a + (h.vms || 0), 0), metrics: metricsOf(list, mode) }; }), [deptNames, hosts, mode]);
  const summary = useMemo(() => metricsOf(hosts, mode), [hosts, mode]);
  const rows = useMemo(() => {
    const key = { cpu: (h) => (h.cpu_ghz_total ? h.cpu_ghz_used / h.cpu_ghz_total : 0), ram: (h) => (h.ram_gb_total ? h.ram_gb_used / h.ram_gb_total : 0), storage: (h) => (h.storage_tb_total ? h.storage_tb_used / h.storage_tb_total : 0) }[sort];
    return hosts.filter((h) => dept === 'all' || h.department === dept).sort((a, b) => (key ? key(b) - key(a) : a.name.localeCompare(b.name)));
  }, [hosts, dept, sort]);
  const isUsed = mode === 'used';
  const changeLoc = (v) => { setLoc(v); setDept('all'); };
  const sortBtn = (k, label) => <button type="button" className="eu-sort" onClick={() => setSort(k)} style={{ color: sort === k ? 'var(--ant-color-primary, #1d9aa6)' : 'var(--muted)' }}>{label}{sort === k ? (k === 'name' ? ' (A-Z)' : ' (high-low)') : ''}</button>;

  return (
    <div className="page">
      <PageHeader title="ESXi Utilization" sub="CPU, RAM and storage capacity and usage of the discovered ESXi hosts, grouped by the department of each host. Figures are read from the hosts at discovery time."
        extra={<>
          <span style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>{data?.collected_at ? `Last discovery: ${dayjs(data.collected_at).format('D MMM YYYY, HH:mm')}` : ''}</span>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<DownloadOutlined />} disabled={!all.length} onClick={() => download('/esxi-utilization/csv', 'esxi-utilization.csv')}>Export CSV</Button></>} />

      {!data ? <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div> : (<>
        {!all.length && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="No ESXi capacity data yet"
          description={<>Run a discovery from VMware Discovery: the capacity and current usage of each host are read from the ESXi host or vCenter at that time.{data.without_stats > 0 && ` ${data.without_stats} host(s) were found but did not report capacity (the account may not be allowed to read host hardware and statistics).`}</>} />}
        {all.length > 0 && data.without_stats > 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`${data.without_stats} discovered host(s) are not shown: they did not report capacity.`} />}

        {all.length > 0 && (<>
          <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Location
              <Select value={loc} onChange={changeLoc} style={{ minWidth: 190 }} options={[{ value: 'all', label: 'All locations' }, ...locations.map((l) => ({ value: l, label: l }))]} /></label>
            <div style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Department</span>
              <span style={{ height: 32, display: 'flex', alignItems: 'center', gap: 8 }}>{dept === 'all' ? 'All departments' : dept}{dept !== 'all' && <Button size="small" onClick={() => setDept('all')}>Clear filter</Button>}</span></div>
            <div style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Headline figure</span>
              <span style={{ display: 'inline-flex' }}><Button type={isUsed ? 'primary' : 'default'} onClick={() => setMode('used')} style={{ borderRadius: '6px 0 0 6px' }}>Used %</Button>
                <Button type={!isUsed ? 'primary' : 'default'} onClick={() => setMode('free')} style={{ borderRadius: '0 6px 6px 0' }}>Free %</Button></span></div>
            <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--muted)', alignItems: 'center' }}>
              {[['#2f9e6e', 'Under 70% used'], ['#e0a020', '70-85%'], ['#d64545', 'Over 85%']].map(([c, t]) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />{t}</span>)}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'inline-block' }} />Free</span></div>
          </div>

          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>All ESXi hosts combined <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {hosts.length} hosts</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
            {summary.map((m) => (
              <div className="card" key={m.key} style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ color: 'var(--muted)', fontSize: 13 }}>{m.label}</b><b style={{ color: m.textColor, fontSize: 12 }}>{m.level}</b></div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{m.head}</span><span style={{ color: 'var(--muted)', fontSize: 13 }}>{m.sub}</span></div>
                <Bar pct={m.usedPct} fill={m.fill} h={12} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Used <b>{m.usedPct}%</b></span><span>Free <b>{m.freePct}%</b></span></div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{m.usedTxt} used of {m.capTxt}</div>
              </div>))}
          </div>

          <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>By department</h2>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted)' }}>Select a card to filter the host table below. Percentages are summed used ÷ summed capacity per department.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16, marginBottom: 20 }}>
            {depts.map((d) => (
              <button type="button" key={d.name} className="card eu-dept" aria-pressed={dept === d.name} onClick={() => setDept(dept === d.name ? 'all' : d.name)}
                style={{ textAlign: 'left', display: 'grid', gap: 14, cursor: 'pointer', color: 'inherit', borderColor: dept === d.name ? '#3b82f6' : undefined, borderWidth: dept === d.name ? 2 : 1, boxShadow: dept === d.name ? '0 0 0 3px rgba(59,130,246,.18)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ fontSize: 15 }}>{d.name}</b><span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.hosts} hosts · {d.vms} VMs</span></div>
                {d.metrics.map((m) => (
                  <div key={m.key} style={{ display: 'grid', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{m.label}</span><span style={{ fontSize: 13 }}><b>{m.head}</b> <span style={{ color: 'var(--muted)' }}>{m.sub}</span></span></div>
                    <Bar pct={m.usedPct} fill={m.fill} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>Used {m.usedPct}% · {m.usedTxt}</span><span>Free {m.freePct}% · {m.freeTxt}</span></div>
                  </div>))}
              </button>))}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>{isUsed ? 'Used %' : 'Free %'} by department: CPU, RAM and Storage</h2>
              <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>{SERIES.map((s) => <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: s.color, display: 'inline-block' }} />{s.label}</span>)}</div>
            </div>
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 640 }}>
              <div style={{ position: 'relative', height: 236 }} role="img" aria-label={`${isUsed ? 'Used' : 'Free'} percentage of CPU, RAM and storage for each department`}>
                {[0, 25, 50, 75, 100].map((p) => <div key={p} style={{ position: 'absolute', left: 0, right: 0, bottom: p * 2, borderTop: `1px solid ${p === 0 ? 'var(--border-2)' : 'var(--border)'}`, height: 0 }}><span style={{ position: 'absolute', left: 0, top: -9, background: 'var(--surface)', paddingRight: 6, fontSize: 11, color: 'var(--muted)' }}>{p}%</span></div>)}
                <div style={{ position: 'absolute', left: 44, right: 0, top: 0, bottom: 0, display: 'flex' }}>
                  {depts.map((d) => (
                    <div key={d.name} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 4, height: '100%' }}>
                      {d.metrics.map((m, i) => { const v = isUsed ? m.usedPct : m.freePct; return (
                        <div key={m.key} title={`${d.name} ${m.label}: ${v}% ${isUsed ? 'used' : 'free'}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: 22 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{v}%</span>
                          <div style={{ width: 22, height: Math.max(2, v * 2), background: SERIES[i].color, borderRadius: '3px 3px 0 0' }} /></div>); })}
                    </div>))}
                </div>
              </div>
              <div style={{ display: 'flex', marginLeft: 44, marginTop: 8 }}>{depts.map((d) => <div key={d.name} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 600 }}>{d.name}</div>)}</div>
            </div></div>
          </div>

          <div className="card" style={{ paddingBottom: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>Host detail <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {dept === 'all' ? 'All departments' : dept} · {rows.length} hosts</span></h2>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Each cell: used % / free %. Click a column heading to sort by highest usage.</span>
            </div>
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 980 }}>
              <div className="eu-row eu-head"><span>{sortBtn('name', 'Host')}</span><span>Department</span><span>Location</span><span>{sortBtn('cpu', 'CPU')}</span><span>{sortBtn('ram', 'RAM')}</span><span>{sortBtn('storage', 'Storage')}</span><span>VMs</span></div>
              {rows.map((h) => (
                <div className="eu-row" key={h.key}>
                  <span style={{ display: 'grid', gap: 2 }}><b>{h.name}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.server}{h.ip ? ` · ${h.ip}` : ''}</span></span>
                  <span>{h.department}</span><span>{h.location}</span>
                  {SERIES.map((s) => { const [c, u] = FIELD[s.key]; const m = metric(s, h[c], h[u], mode); return (
                    <span key={s.key} style={{ display: 'grid', gap: 4 }}><Bar pct={m.usedPct} fill={m.fill} h={8} />
                      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><b style={{ color: m.textColor }}>{m.usedPct}% used</b><span style={{ color: 'var(--muted)' }}>{m.freePct}% free</span></span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{m.abs}</span></span>); })}
                  <span>{h.vms}</span>
                </div>))}
              {!rows.length && <Empty description="No hosts match this filter" style={{ padding: 24 }} />}
            </div></div>
            <div style={{ padding: '10px 4px 12px', fontSize: 11, color: 'var(--muted)' }}>Capacity and usage are as reported by the host at the last discovery. Decommissioned inventory records are ignored; hosts with no matching inventory record appear under Unassigned.</div>
          </div>
        </>)}
      </>)}
      <style>{`.eu-row{display:grid;grid-template-columns:1.3fr 1.1fr 1fr 1.5fr 1.5fr 1.5fr .6fr;gap:14px;padding:11px 4px;border-bottom:1px solid var(--border);align-items:center;font-size:13px}
        .eu-head{font-size:12px;font-weight:700;color:var(--muted);padding:8px 4px;border-bottom-color:var(--border-2)}
        .eu-sort{border:0;background:transparent;padding:0;font:inherit;font-weight:700;cursor:pointer;text-align:left}
        .eu-dept:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}`}</style>
    </div>
  );
}
