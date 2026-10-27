import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Input, Table, Tag } from 'antd';
import api, { errMsg } from '../api/client';
import PageHeader from '../components/PageHeader';
import { pager } from '../utils/pager';

export default function GlobalSearch() {
  const { message } = App.useApp(); const nav = useNavigate();
  const [sp, setSp] = useSearchParams(); const q = sp.get('q') || '';
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    setLoading(true);
    api.get('/search', { params: { q } }).then((r) => setRows(r.data)).catch((e) => message.error(errMsg(e))).finally(() => setLoading(false));
  }, [q, message]);
  return (
    <div className="page">
      <PageHeader title="Global Search" sub="Searches every field of every page you can open." />
      <div className="toolbar"><Input.Search key={q} defaultValue={q} allowClear autoFocus placeholder="Anything: name, IP, MAC, tag, serial, owner…" style={{ maxWidth: 480 }} onSearch={(v) => setSp(v ? { q: v } : {})} /></div>
      <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" loading={loading} dataSource={rows} pagination={pager(25, (rows)?.length ?? 0)} scroll={{ x: 'max-content' }}
        locale={{ emptyText: q.length < 2 ? 'Type at least two characters to search.' : 'No matches in any inventory.' }}
        onRow={(r) => ({ onClick: () => nav(`/p/${r.source}?record=${r.id}`), style: { cursor: 'pointer' } })}
        columns={[{ title: 'Page', dataIndex: 'source_label' }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname || Object.values(r.data || {}).find((v) => typeof v === 'string') || `#${r.id}` }, { title: 'Hostname', dataIndex: 'hostname' },
          { title: 'IP', dataIndex: 'ip_address' }, { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }, { title: 'Tag', dataIndex: 'asset_tag' },
          { title: 'Status', render: (_, r) => (r.is_decommissioned ? <Tag color="red">Decommissioned</Tag> : r.server_status) }]} />
    </div>
  );
}
