import { useState } from 'react';
import { App, Button, Popconfirm, Progress, Select, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import CrudTable from '../../components/CrudTable';
import PageHeader from '../../components/PageHeader';

export function Dropdowns() {
  const { message } = App.useApp(); const [cat, setCat] = useState(); const [cats, setCats] = useState([]); const [ver, setVer] = useState(0);
  const delCategory = () => api.delete(`/dropdowns/category/${cat}`)
    .then((r) => { message.success(`Deleted the “${cat}” list (${r.data.deleted} values)`); setCat(undefined); setVer((v) => v + 1); })
    .catch((e) => message.error(errMsg(e)));
  return (
    <div className="page">
      <PageHeader title="Dropdown Master" sub="Shared lists of choices. Any “choice list” field in the Page Designer can use one by its category name." />
      <div className="toolbar"><Select allowClear value={cat} placeholder="Show one category" style={{ width: 220 }} onChange={setCat} options={cats.map((c) => ({ value: c, label: c }))} />
        {cat && <Popconfirm title={`Delete the whole “${cat}” list?`} description="Every value in it is removed. Choice-list fields that use it will have no options." okText="Delete list" okButtonProps={{ danger: true }} onConfirm={delCategory}>
          <Button danger icon={<DeleteOutlined />}>Delete category</Button></Popconfirm>}</div>
      <CrudTable path="/dropdowns" listPath="/dropdowns/all" createLabel="Add value" key={`${cat || 'all'}-${ver}`}
        transform={(rows) => { setCats([...new Set(rows.map((r) => r.category))].sort()); return rows.filter((r) => !cat || r.category === cat); }}
        fields={[{ name: 'category', label: 'Category', required: true, default: cat, help: 'Lower-case letters and underscores, for example rack_location. A new name creates a new list.' },
          { name: 'value', label: 'Value', required: true },
          { name: 'parent_value', label: 'Parent value (optional)', help: 'Links this value to a value in another list, e.g. category os_version, value “Windows Server 2019”, parent “Windows”. A field set to “depend on” the other field then shows only the matching values.' },
          { name: 'sort_order', label: 'Sort order', type: 'number', default: 0 }]}
        columns={[{ title: 'Category', dataIndex: 'category', render: (v) => <Tag>{v}</Tag> }, { title: 'Value', dataIndex: 'value' },
          { title: 'Parent value', dataIndex: 'parent_value', render: (v) => v || '-' }, { title: 'Order', dataIndex: 'sort_order', width: 80 }]} />
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString();

export function TagRanges() {
  return (
    <div className="page">
      <PageHeader title="Department Tag Ranges" sub="Give each department its own range of asset tags. A page enforces them when it has fields meaning “Department” and “Asset tag”." />
      <CrudTable path="/department-tag-ranges" createLabel="Add range" fields={[{ name: 'department', label: 'Department', required: true }, { name: 'range_start', label: 'First number', type: 'number', required: true }, { name: 'range_end', label: 'Last number', type: 'number', required: true }, { name: 'pad', label: 'Digits (zero-padded)', type: 'number', default: 4 },
        { name: 'sort_order', label: 'Sort', type: 'number', default: 0, help: 'Lower numbers are listed first' }, { name: 'is_active', label: 'Active', type: 'bool', default: true, help: 'Inactive ranges are not enforced on asset tags' }]}
        columns={[
          { title: 'Sort', dataIndex: 'sort_order', width: 70 },
          { title: 'Department', dataIndex: 'department' },
          { title: 'Range', render: (_, r) => <span className="chip blue">{String(r.range_start).padStart(r.pad, '0')}-{String(r.range_end).padStart(r.pad, '0')}</span> },
          { title: 'Total', dataIndex: 'total', render: (v) => <span className="num-lg">{fmt(v)}</span> },
          { title: 'Used', dataIndex: 'used', render: (v) => <span className="chip red">{fmt(v)}</span> },
          { title: 'Free', dataIndex: 'free', render: (v) => <span className="chip green">{fmt(v)}</span> },
          { title: 'Utilization', dataIndex: 'utilization', width: 200, render: (v) => <div className="util"><Progress percent={v} showInfo={false} size="small" strokeColor={v >= 90 ? '#cf1322' : v >= 70 ? '#d46b08' : undefined} /><span>{v}%</span></div> },
          { title: 'Active', dataIndex: 'is_active', render: (v) => <span className={`chip ${v ? 'green' : 'grey'}`}>{v ? 'Yes' : 'No'}</span> },
        ]} />
    </div>
  );
}
