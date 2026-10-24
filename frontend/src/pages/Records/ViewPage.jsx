import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Input, Select, Table, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import api, { download } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/PageHeader';
import useServerTable from '../../components/useServerTable';
import { usePages } from '../../context/PagesContext';

const firstValue = (data, keys) => { for (const k of keys) { const v = data[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

/** A page that combines the records of several other pages into one table, laid out by an administrator. */
export default function ViewPage({ page }) {
  const cfg = page.config; const nav = useNavigate(); const { has } = useAuth(); const { bySlug } = usePages();
  const base = `/p/${page.slug}`;
  const t = useServerTable(`${base}/records`, { show: 'active' }, cfg.pageSize || 25);
  const [opts, setOpts] = useState({});
  useEffect(() => { api.get(`${base}/filter-options`).then((r) => setOpts(r.data)); }, [base]);

  const columns = useMemo(() => (cfg.columns || []).map((c) => ({
    title: c.label, key: c.id, width: c.width, sorter: c.id !== '_page', ellipsis: true,
    render: (_, r) => {
      if (c.id === '_page') return <Tag>{r.page_title}</Tag>;
      const v = firstValue(r.data, c.keys);
      return v === null ? <span style={{ color: '#b5bfc1' }}>-</span> : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
    } })), [cfg]);

  const sources = cfg.sources || [];
  return (
    <div className="page">
      <PageHeader title={page.title} sub={page.description || `${t.total} record${t.total === 1 ? '' : 's'} from ${sources.length} page${sources.length === 1 ? '' : 's'}`}
        extra={<>{has('admin-pages') && <Link to={`/admin/pages/${page.slug}`}><Button>Edit layout</Button></Link>}
          <Button icon={<DownloadOutlined />} onClick={() => download(`${base}/records/export`, `${page.slug}.csv`, Object.fromEntries(Object.entries(t.filters).filter(([, v]) => v)))}>Export CSV</Button></>} />
      {!sources.length || !columns.length ? (
        <Empty description={<span>This view has no source pages or columns yet. {has('admin-pages') ? <Link to={`/admin/pages/${page.slug}`}>Open the designer</Link> : 'Ask an administrator to finish it.'}</span>} />
      ) : (<>
        <div className="toolbar">
          <Input.Search allowClear placeholder="Search every field" style={{ width: 280 }} onSearch={(q) => t.setFilter({ q })} />
          {sources.length > 1 && <Select allowClear placeholder="Page" style={{ width: 180 }} options={sources.filter((s) => bySlug[s]).map((s) => ({ value: s, label: bySlug[s].title }))} onChange={(v) => t.setFilter({ _page: v })} />}
          {(cfg.filters || []).map((id) => <Select key={id} allowClear showSearch placeholder={cfg.columns.find((c) => c.id === id)?.label} style={{ minWidth: 150 }} options={(opts[id] || []).map((v) => ({ value: v, label: v }))} onChange={(v) => t.setFilter({ [`f_${id}`]: v })} />)}
          <Select value={t.filters.show} style={{ width: 190 }} onChange={(v) => t.setFilter({ show: v })} options={[{ value: 'active', label: 'Active only' }, { value: 'decommissioned', label: 'Decommissioned only' }, { value: 'all', label: 'Active + decommissioned' }]} />
        </div>
        <Table rowKey={(r) => `${r.page_slug}-${r.id}`} size="small" loading={t.loading} dataSource={t.rows} columns={columns} pagination={t.pagination} onChange={t.onTableChange} scroll={{ x: 'max-content' }}
          rowClassName={(r) => (r.is_decommissioned ? 'row-expired' : '')}
          onRow={(r) => ({ onClick: () => nav(`/p/${r.page_slug}?record=${r.id}`), style: { cursor: 'pointer' } })} />
      </>)}
    </div>
  );
}
