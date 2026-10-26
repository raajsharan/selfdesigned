import { useState } from 'react';
import { Select, Tag } from 'antd';
import CrudTable from '../../components/CrudTable';
import PageHeader from '../../components/PageHeader';

export function Dropdowns() {
  const [cat, setCat] = useState(); const [cats, setCats] = useState([]);
  return (
    <div className="page">
      <PageHeader title="Dropdown Master" sub="Shared lists of choices. Any “choice list” field in the Page Designer can use one by its category name." />
      <div className="toolbar"><Select allowClear placeholder="Show one category" style={{ width: 220 }} onChange={setCat} options={cats.map((c) => ({ value: c, label: c }))} /></div>
      <CrudTable path="/dropdowns" listPath="/dropdowns/all" createLabel="Add value" key={cat || 'all'}
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

export function TagRanges() {
  return (
    <div className="page">
      <PageHeader title="Department Tag Ranges" sub="Give each department its own range of asset tags. A page enforces them when it has fields meaning “Department” and “Asset tag”." />
      <CrudTable path="/department-tag-ranges" createLabel="Add range" fields={[{ name: 'department', label: 'Department', required: true }, { name: 'prefix', label: 'Prefix', help: 'For example HYD-', default: '' },
        { name: 'range_start', label: 'First number', type: 'number', required: true }, { name: 'range_end', label: 'Last number', type: 'number', required: true }, { name: 'pad', label: 'Digits (zero-padded)', type: 'number', default: 4 }]}
        columns={[{ title: 'Department', dataIndex: 'department' }, { title: 'Range', render: (_, r) => <span className="mono">{r.prefix}{String(r.range_start).padStart(r.pad, '0')} to {r.prefix}{String(r.range_end).padStart(r.pad, '0')}</span> }]} />
    </div>
  );
}
