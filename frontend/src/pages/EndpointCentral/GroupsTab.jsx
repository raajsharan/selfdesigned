import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, InputNumber, Popconfirm, Progress, Switch, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Dash, found, orDash } from './common';

const ruleChips = (c) => {
  if (!c) return [];
  const list = Array.isArray(c.list) ? c.list : [];
  const parts = list.map((x) => (x && typeof x === 'object' ? Object.values(x).filter((v) => v !== null && v !== '' && typeof v !== 'object').join(' ') : String(x)));
  return [...(c.pattern ? [`Rule: ${c.pattern}`] : []), ...parts];
};

function Members({ id, dynamic, users, criteria }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { if (!dynamic && !users) api.get(`/endpoint-central/groups/${id}/members`).then((r) => setRows(r.data)).catch((e) => setErr(errMsg(e))); }, [id, dynamic, users]);
  if (users) return <span className="nx-dim">Members of user groups are not copied.</span>;
  if (dynamic) {
    const chips = ruleChips(criteria);
    return <div><div>Members are computed by Endpoint Central.</div>{chips.length > 0 ? <div style={{ marginTop: 6 }}>{chips.map((c, i) => <Tag key={i}>{c}</Tag>)}</div> : <div className="nx-dim">No rule was returned.</div>}</div>;
  }
  if (err) return <Alert type="error" showIcon message={err} />;
  return <Table size="small" rowKey="resource_id" loading={rows === null} dataSource={rows || []} pagination={rows && rows.length > 20 ? { defaultPageSize: 20 } : false} locale={{ emptyText: 'No members' }}
    columns={[{ title: 'Computer', dataIndex: 'name', render: orDash }, { title: 'Domain', dataIndex: 'domain', render: orDash }, { title: 'OS', dataIndex: 'os_platform', render: orDash }, { title: 'In your records', render: (_, r) => found(r.in_inventory) }]} />;
}

/** Group list, background sync with progress, and the members of each static group. */
export default function GroupsTab({ reload, onCount, onSynced }) {
  const { message } = App.useApp(); const { canWrite } = useAuth();
  const [groups, setGroups] = useState([]); const [sync, setSync] = useState(null); const [auto, setAuto] = useState({ enabled: false, interval_minutes: 360 });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const was = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const { data } = await api.get('/endpoint-central/groups'); setGroups(data.groups); setSync(data.sync); setAuto(data.auto); onCount?.(data.groups.length); }
    catch (e) { setErr(errMsg(e)); } finally { setLoading(false); }
  }, [onCount]);
  useEffect(() => { load(); }, [load, reload]);

  // While a sync runs, poll its progress every 2 s; when it ends, refresh the groups and the computers.
  useEffect(() => {
    if (!sync?.running) { if (was.current) { was.current = false; load(); onSynced?.(); } return undefined; }
    was.current = true;
    const t = setInterval(() => api.get('/endpoint-central/groups/sync').then((r) => setSync(r.data)).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [sync?.running]); // eslint-disable-line

  const start = async (force) => {
    try { const { data } = await api.post('/endpoint-central/groups/sync', { force }); setSync({ ...data, last: sync?.last }); }
    catch (e) { message.error(errMsg(e)); load(); }
  };
  const saveAuto = async (next) => { try { const { data } = await api.put('/endpoint-central/groups/auto-sync', next); setAuto(data); message.success('Saved'); } catch (e) { message.error(errMsg(e)); } };

  const last = sync?.last;
  const status = sync?.running
    ? <span>Syncing ({sync.phase === 'members' ? `${sync.done} of ${sync.total} groups` : 'reading the group list'})</span>
    : last ? <span>Last sync {dayjs(last.finished_at).format('D MMM HH:mm')}: {last.synced} of {last.groups} groups updated, {last.calls} calls{last.errors.length ? `, ${last.errors.length} failed` : ''}.</span> : <span className="nx-dim">Never synced.</span>;

  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {last?.stopped && !sync?.running && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="The last sync stopped early" description={last.stopped} />}
      {last?.errors?.length > 0 && !sync?.running && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${last.errors.length} group(s) could not be read`} description={last.errors.slice(0, 5).map((e) => `${e.group || 'Group list'}: ${e.error}`).join(' | ')} />}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        {canWrite && <>
          <Button type="primary" disabled={sync?.running} onClick={() => start(false)}>Sync now</Button>
          <Popconfirm title="Full re-sync reads every group again" description="This uses many of Endpoint Central's 30 calls a minute and can take a while." okText="Full re-sync" onConfirm={() => start(true)} disabled={sync?.running}>
            <Button disabled={sync?.running}>Full re-sync</Button></Popconfirm></>}
        <span>{status}</span>
        {sync?.running && sync.total > 0 && <Progress style={{ width: 160 }} size="small" percent={Math.round((sync.done * 100) / sync.total)} />}
        <span style={{ flex: 1 }} />
        <span>Auto-sync every <InputNumber size="small" min={15} max={10080} value={auto.interval_minutes} disabled={!canWrite} style={{ width: 80 }} onChange={(v) => setAuto((a) => ({ ...a, interval_minutes: v }))}
          onBlur={() => canWrite && saveAuto({ enabled: auto.enabled, interval_minutes: auto.interval_minutes })} /> min <Switch size="small" checked={auto.enabled} disabled={!canWrite} onChange={(v) => saveAuto({ enabled: v, interval_minutes: auto.interval_minutes })} aria-label="Auto-sync" /></span>
      </div>
      <div className="nx-dim small" style={{ marginBottom: 8 }}>Groups are copied in the background (Endpoint Central allows 30 group calls a minute).</div>
      <Table rowKey="id" size="small" loading={loading} dataSource={groups} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], hideOnSinglePage: groups.length <= 25 }}
        expandable={{ expandedRowRender: (g) => <Members id={g.id} dynamic={g.dynamic} users={g.users} criteria={g.criteria} />, rowExpandable: () => true }}
        columns={[
          { title: 'Group', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Type', dataIndex: 'type', render: orDash }, { title: 'Category', dataIndex: 'category', render: orDash }, { title: 'Domain', dataIndex: 'domain', render: orDash },
          { title: 'Members', render: (_, g) => (g.member_count !== null ? g.member_count : g.dynamic ? <span className="nx-dim">computed by EC</span> : <Dash />) },
          { title: 'Changed in EC', dataIndex: 'modified_on', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : <Dash />) },
          { title: 'Last synced', dataIndex: 'members_synced_at', render: (v) => (v ? dayjs(v).format('D MMM HH:mm') : <Dash />) },
        ]} />
    </div>
  );
}
