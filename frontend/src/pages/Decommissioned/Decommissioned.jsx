import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Popconfirm, Select, Table, Tag } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import { usePages } from '../../context/PagesContext';
import { pager } from '../../utils/pager';


export default function Decommissioned() {
  const { message } = App.useApp(); const { canWrite } = useAuth(); const { pages } = usePages();
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [q, setQ] = useState(''); const [source, setSource] = useState();
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await api.get('/decommissioned', { params: { q, source } })).data); } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  }, [q, source, message]);
  useEffect(() => { load(); }, [load]);
  const reactivate = async (r) => { try { await api.post(`/decommissioned/${r.id}/reactivate`); message.success('Asset reactivated'); load(); } catch (e) { message.error(errMsg(e)); } };
  return (
    <div className="page">
      <PageHeader title="Decommissioned" sub="A permanent record of every decommission. Entries cannot be edited or deleted, even if the asset is later purged." />
      <div className="toolbar">
        <Input.Search allowClear placeholder="Search name, tag, IP, reason" style={{ width: 300 }} onSearch={setQ} />
        <Select allowClear placeholder="Page" style={{ width: 190 }} onChange={setSource} options={pages.filter((p) => p.kind === 'records').map((p) => ({ value: p.slug, label: p.title }))} />
      </div>
      <Table rowKey="id" size="small" loading={loading} dataSource={rows} pagination={pager(25, (rows)?.length ?? 0)} scroll={{ x: 'max-content' }}
        columns={[
          { title: 'Asset', dataIndex: 'asset_name' }, { title: 'Page', render: (_, r) => r.source_title || <span style={{ color: 'var(--faint)' }}>{r.source} (deleted)</span> },
          { title: 'Released tag', dataIndex: 'asset_tag', render: (v) => v || '-' }, { title: 'Released IP', dataIndex: 'ip_address', render: (v) => v || '-' },
          { title: 'Reason', dataIndex: 'reason', ellipsis: true, render: (v) => v || '-' },
          { title: 'Decommissioned', render: (_, r) => <span>{dayjs(r.decommissioned_at).format('D MMM YYYY HH:mm')}<br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>by {r.decommissioned_by_email}</span></span> },
          { title: 'Status', render: (_, r) => r.reactivated_at ? <span><Tag color="green">Reactivated</Tag><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{dayjs(r.reactivated_at).format('D MMM YYYY')} by {r.reactivated_by_email}</span></span> : <Tag color="red">Decommissioned</Tag> },
          ...(canWrite ? [{ title: '', render: (_, r) => !r.reactivated_at && <Popconfirm title="Reactivate this asset?" description="Its tag and IP are reclaimed if still free." onConfirm={() => reactivate(r)}><Button size="small" icon={<UndoOutlined />}>Reactivate</Button></Popconfirm> }] : []),
        ]} />
    </div>
  );
}
