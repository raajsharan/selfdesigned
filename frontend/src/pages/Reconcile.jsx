import { useEffect, useState } from 'react';
import { Spin, Table, Tabs, Tag } from 'antd';
import api from '../api/client';
import PageHeader, { Stat } from '../components/PageHeader';
import { pager } from '../utils/pager';

export default function Reconcile() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/reconcile').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="page"><Spin /></div>;
  const s = d.summary;
  const vmCols = [{ title: 'VM', dataIndex: 'name' }, { title: 'Source', dataIndex: 'discovery', render: (v) => <Tag>{v}</Tag> }, { title: 'IP', dataIndex: 'ip' }, { title: 'MAC', dataIndex: 'macs', render: (v) => <span className="mono">{(v || []).join(', ')}</span> }, { title: 'State', dataIndex: 'power_state' }];
  return (
    <div className="page">
      <PageHeader title="Reconcile" sub="Compares the inventory with what VMware and Proxmox discovery actually found. Matching is by MAC, then IP, then name." />
      <div className="stat-grid"><Stat label="Discovered VMs" value={s.discovered} /><Stat label="Not in inventory" value={s.not_in_inventory} tone={s.not_in_inventory ? 'warn' : 'good'} />
        <Stat label="Details differ" value={s.drift} tone={s.drift ? 'warn' : 'good'} /><Stat label="In inventory, not discovered" value={s.inventory_not_discovered} tone={s.inventory_not_discovered ? 'warn' : 'good'} /></div>
      <Tabs items={[
        { key: 'a', label: `Not in inventory (${s.not_in_inventory})`, children: <Table rowKey={(r) => `${r.discovery}-${r.id}`} size="small" dataSource={d.not_in_inventory} columns={vmCols} pagination={pager(25, (d.not_in_inventory)?.length ?? 0)} /> },
        { key: 'b', label: `Details differ (${s.drift})`, children: <Table rowKey={(r) => `${r.discovery}-${r.id}`} size="small" dataSource={d.drift} pagination={pager(25, (d.drift)?.length ?? 0)} columns={[...vmCols.slice(0, 3), { title: 'Difference', render: (_, r) => r.issues.join('; ') }, { title: 'Matched asset', render: (_, r) => (r.asset.restricted ? 'A page you cannot open' : `${r.asset.source} #${r.asset.id} (by ${r.matched_by})`) }]} /> },
        { key: 'c', label: `In inventory, not discovered (${s.inventory_not_discovered})`, children: <Table rowKey={(r) => `${r.source}-${r.id}`} size="small" dataSource={d.inventory_not_discovered} pagination={pager(25, (d.inventory_not_discovered)?.length ?? 0)} columns={[{ title: 'Inventory', dataIndex: 'source' }, { title: 'Name', render: (_, r) => r.vm_name || r.hostname }, { title: 'IP', dataIndex: 'ip_address' }, { title: 'MAC', dataIndex: 'mac_address', render: (v) => <span className="mono">{v}</span> }]} /> },
      ]} />
    </div>
  );
}
