import { useCallback, useEffect, useState } from 'react';
import { Alert, Select, Table } from 'antd';
import api, { errMsg } from '../../api/client';
import { found, orDash, when } from './common';

/** Computers waiting in Endpoint Central for approval, with whether we know them. */
export default function StagedTab({ reload, onTotal }) {
  const [status, setStatus] = useState('3'); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async (refresh) => {
    setLoading(true); setErr('');
    try { const { data } = await api.get('/endpoint-central/staged', { params: { status, ...(refresh ? { refresh: 1 } : {}) } }); setRows(data); if (status === '3') onTotal?.(data.length); }
    catch (e) { setErr(errMsg(e)); setRows([]); } finally { setLoading(false); }
  }, [status, onTotal]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => { if (reload) load(true); }, [reload]); // eslint-disable-line

  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <div className="toolbar"><Select value={status} onChange={setStatus} style={{ width: 160 }} options={[{ value: '3', label: 'Pending' }, { value: '1', label: 'Approved' }, { value: '2', label: 'Denied' }]} aria-label="Approval status" /></div>
      <Table rowKey={(r) => r.resource_id ?? `${r.name}-${r.mac_address}`} size="small" loading={loading} dataSource={rows} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], hideOnSinglePage: rows.length <= 25 }} locale={{ emptyText: 'Nothing here' }}
        columns={[{ title: 'Computer', dataIndex: 'name', render: (v) => (v ? <b>{v}</b> : orDash(v)) }, { title: 'IP', dataIndex: 'ip_address', render: orDash }, { title: 'MAC', dataIndex: 'mac_address', render: orDash },
          { title: 'OS', dataIndex: 'os', render: orDash }, { title: 'Domain', dataIndex: 'domain', render: orDash }, { title: 'Office', dataIndex: 'branch_office', render: orDash },
          { title: 'Discovered', dataIndex: 'discovered_at', render: when }, { title: 'In your records', render: (_, r) => found(r.in_inventory) }]} />
    </div>
  );
}
