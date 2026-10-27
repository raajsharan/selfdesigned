import { useCallback, useEffect, useState } from 'react';
import { App, Button, Popconfirm, Space, Table } from 'antd';
import dayjs from 'dayjs';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import { pager } from '../utils/pager';

export default function RecycleBin() {
  const { message } = App.useApp(); const { canWrite, user } = useAuth();
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setRows((await api.get('/recycle-bin')).data); } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); } }, [message]);
  useEffect(() => { load(); }, [load]);
  const act = (fn, ok) => async (r) => { try { await fn(r); message.success(ok); load(); } catch (e) { message.error(errMsg(e)); } };
  const isAdmin = ['admin', 'superadmin'].includes(user.role);
  return (
    <div className="page">
      <PageHeader title="Recycle Bin" sub="Deleted records can be restored. Purging removes them for good (admins only)." />
      <Table rowKey="id" size="small" loading={loading} dataSource={rows} pagination={pager(25, (rows)?.length ?? 0)}
        columns={[{ title: 'Page', dataIndex: 'page_title' }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname || Object.values(r.data || {}).find((v) => typeof v === 'string') || `#${r.id}` }, { title: 'IP', dataIndex: 'ip_address' },
          { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }, { title: 'Tag', dataIndex: 'asset_tag' },
          { title: 'Deleted', dataIndex: 'deleted_at', render: (v) => dayjs(v).format('D MMM YYYY HH:mm') },
          ...(canWrite ? [{ title: '', render: (_, r) => <Space>
            <Button size="small" onClick={() => act((x) => api.post(`/recycle-bin/${x.id}/restore`), 'Restored')(r)}>Restore</Button>
            {isAdmin && <Popconfirm title="Permanently delete?" description="This cannot be undone." okButtonProps={{ danger: true }} onConfirm={() => act((x) => api.delete(`/recycle-bin/${x.id}`), 'Purged')(r)}><Button size="small" danger>Purge</Button></Popconfirm>}</Space> }] : [])]} />
    </div>
  );
}
