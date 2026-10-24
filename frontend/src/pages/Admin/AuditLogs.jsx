import { useState } from 'react';
import { Input, Select, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import useServerTable from '../../components/useServerTable';
import PageHeader from '../../components/PageHeader';

const ACTIONS = ['login', 'login_failed', 'create', 'update', 'delete', 'import', 'export', 'view_password', 'decommission', 'reactivate', 'restore', 'purge', 'backup', 'migration_status'];
export default function AuditLogs() {
  const t = useServerTable('/audit', {}, 50);
  return (
    <div className="page">
      <PageHeader title="Audit Logs" sub="Every sign-in, change, import, export and password reveal." />
      <div className="toolbar"><Input.Search allowClear placeholder="Search user or details" style={{ width: 280 }} onSearch={(q) => t.setFilter({ q })} />
        <Select allowClear showSearch placeholder="Action" style={{ width: 200 }} options={ACTIONS.map((a) => ({ value: a, label: a }))} onChange={(v) => t.setFilter({ action: v })} /></div>
      <Table rowKey="id" size="small" loading={t.loading} dataSource={t.rows} pagination={t.pagination} scroll={{ x: 'max-content' }}
        columns={[{ title: 'When', dataIndex: 'created_at', width: 150, render: (v) => dayjs(v).format('D MMM YYYY HH:mm:ss') }, { title: 'User', dataIndex: 'user_email', render: (v) => v || '-' },
          { title: 'Action', dataIndex: 'action', render: (v) => <Tag color={/fail|delete|purge/.test(v) ? 'red' : /password/.test(v) ? 'orange' : 'default'}>{v}</Tag> }, { title: 'On', render: (_, r) => `${r.entity || ''} ${r.entity_id || ''}` },
          { title: 'Details', dataIndex: 'details', ellipsis: true, render: (v) => (v ? <span className="mono">{JSON.stringify(v)}</span> : '-') }, { title: 'IP', dataIndex: 'ip' }]}
        expandable={{ expandedRowRender: (r) => <pre className="mono" style={{ margin: 0 }}>{JSON.stringify(r.details, null, 2)}</pre>, rowExpandable: (r) => !!r.details }} />
    </div>
  );
}
