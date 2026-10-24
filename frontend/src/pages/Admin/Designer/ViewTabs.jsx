import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Select, Tag } from 'antd';
import { CloseOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { Draggable, DropZone, move } from '../../../components/dnd';
import { uid } from './util';

/** Loads the field definitions of the selected source pages so columns can map to them. */
export function useSourceDefs(slugs) {
  const [defs, setDefs] = useState({});
  useEffect(() => {
    let live = true;
    Promise.all(slugs.filter((s) => !defs[s]).map((s) => api.get(`/pages/${s}`).then((r) => [s, r.data]).catch(() => null))).then((got) => {
      if (live && got.some(Boolean)) setDefs((d) => ({ ...d, ...Object.fromEntries(got.filter(Boolean)) }));
    });
    return () => { live = false; };
  }, [slugs.join('|')]); // eslint-disable-line
  return defs;
}

export function SourcesTab({ config, setConfig, recordPages }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Choose which pages feed this table" description="Rows from every ticked page appear together. People only see rows from pages they are allowed to open." />
      {!recordPages.length && <Alert type="warning" showIcon message="There are no records pages yet" description="Create at least one records page first." />}
      <div className="designer-pane">
        <Checkbox.Group value={config.sources} onChange={(sources) => setConfig((c) => ({ ...c, sources }))} style={{ display: 'grid', gap: 8 }}
          options={recordPages.map((p) => ({ value: p.slug, label: <span><b>{p.title}</b> <span className="mono" style={{ color: '#7a8a8e' }}>/p/{p.slug}</span></span> }))} />
      </div>
    </div>
  );
}

export function ColumnsTab({ config, setConfig }) {
  const defs = useSourceDefs(config.sources);
  const hasPage = config.columns.some((c) => c.id === '_page');
  const options = useMemo(() => {
    const m = new Map();
    for (const slug of config.sources) for (const f of defs[slug]?.config.fields || []) {
      if (f.type === 'password') continue;
      const e = m.get(f.key) || { labels: new Set(), pages: new Set() }; e.labels.add(f.label); e.pages.add(defs[slug].title); m.set(f.key, e);
    }
    return [...m.entries()].map(([key, e]) => ({ value: key, label: `${key}  (${[...e.labels].join(' / ')} · ${[...e.pages].join(', ')})` }));
  }, [config.sources, defs]);
  const set = (fn) => setConfig((c) => ({ ...c, columns: fn(c.columns) }));
  const upd = (id, patch) => set((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const reorder = (from, to) => set((cols) => move(cols, from, to > from ? to - 1 : to));

  /** One column per meaning (name, IP, MAC, ...) found in any source, mapping each page's own field. */
  const autoBuild = () => {
    const byRole = new Map();
    for (const slug of config.sources) for (const f of defs[slug]?.config.fields || []) {
      if (!f.role) continue;
      const e = byRole.get(f.role) || { label: f.label, keys: [] }; if (!e.keys.includes(f.key)) e.keys.push(f.key); byRole.set(f.role, e);
    }
    const ROLE_LABEL = { name: 'Name', hostname: 'Hostname', ip: 'IP address', mac: 'MAC address', asset_tag: 'Asset tag', status: 'Status', os: 'OS', department: 'Department', location: 'Location', owner: 'Owner', patching_type: 'Patching type', last_patched: 'Last patched' };
    const order = ['name', 'hostname', 'ip', 'mac', 'asset_tag', 'status', 'os', 'department', 'location', 'owner'];
    const cols = order.filter((r) => byRole.has(r)).map((r) => ({ id: r, label: ROLE_LABEL[r], keys: byRole.get(r).keys }));
    set((cur) => [...cur.filter((c) => c.id === '_page'), ...cols]);
  };

  return (
    <div style={{ maxWidth: 940 }}>
      {!config.sources.length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Pick source pages first (Sources tab)" />}
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Different pages can call the same thing by different names"
        description={<>A column can list several field keys; each row shows the first one that has a value. For example a column <b>IP</b> with keys <span className="mono">ip, address</span> reads <span className="mono">ip</span> on one page and <span className="mono">address</span> on another.</>} />
      <div className="toolbar">
        <Button icon={<ThunderboltOutlined />} disabled={!config.sources.length} onClick={autoBuild}>Build columns from field meanings</Button>
        <Button icon={<PlusOutlined />} onClick={() => set((cols) => [...cols, { id: uid(), label: 'New column', keys: [] }])}>Add column</Button>
        <Checkbox checked={hasPage} onChange={(e) => set((cols) => (e.target.checked ? [{ id: '_page', label: 'Page', keys: [] }, ...cols] : cols.filter((c) => c.id !== '_page')))}>Show which page each row comes from</Checkbox>
      </div>
      {config.columns.map((c, i) => (
        <div key={c.id}>
          <DropZone accept={(d) => d.kind === 'vcol'} onDrop={(d) => reorder(d.index, i)} style={{ height: 6 }} />
          <Draggable payload={{ kind: 'vcol', index: i }} className="canvas-item" style={{ background: '#fff', padding: '8px 10px' }}>
            <Input size="small" style={{ width: 180 }} value={c.label} onChange={(e) => upd(c.id, { label: e.target.value })} aria-label="Column title" />
            {c.id === '_page' ? <Tag color="purple" style={{ flex: 1 }}>shows the page title</Tag>
              : <Select size="small" mode="tags" style={{ flex: 1, minWidth: 220 }} value={c.keys} placeholder="Field keys, in order of preference" onChange={(keys) => upd(c.id, { keys })} options={options} tokenSeparators={[',']} />}
            <InputNumber size="small" min={60} max={600} placeholder="width" value={c.width} style={{ width: 90 }} onChange={(w) => upd(c.id, { width: w || undefined })} />
            <Button size="small" type="text" icon={<CloseOutlined />} aria-label={`Remove ${c.label}`} onClick={() => set((cols) => cols.filter((x) => x.id !== c.id))} />
          </Draggable>
        </div>))}
      <DropZone accept={(d) => d.kind === 'vcol'} onDrop={(d) => reorder(d.index, config.columns.length)} style={{ height: 14 }} />
      <div className="designer-pane" style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
        <label>Filter drop-downs above the table<Select mode="multiple" maxCount={8} style={{ width: '100%' }} placeholder="None" value={config.filters}
          options={config.columns.filter((c) => c.id !== '_page').map((c) => ({ value: c.id, label: c.label }))} onChange={(filters) => setConfig((c) => ({ ...c, filters }))} /></label>
        <label>Rows per page<Select style={{ width: '100%' }} value={config.pageSize} onChange={(pageSize) => setConfig((c) => ({ ...c, pageSize }))} options={[10, 25, 50, 100, 200].map((n) => ({ value: n, label: n }))} /></label>
      </div>
      {config.columns.length > 0 && (
        <div className="designer-pane" style={{ marginTop: 12, overflowX: 'auto' }}><b>Preview</b>
          <table className="preview-table" style={{ marginTop: 8, borderCollapse: 'collapse', width: '100%' }}><thead><tr>{config.columns.map((c) => <th key={c.id} style={{ minWidth: c.width }}>{c.label}</th>)}</tr></thead>
            <tbody>{[0, 1].map((r) => <tr key={r}>{config.columns.map((c) => <td key={c.id} style={{ padding: '6px 10px', color: '#9aa7a9', borderBottom: '1px solid #eef2f3' }}>{c.id === '_page' ? 'Page title' : c.keys[0] || '…'}</td>)}</tr>)}</tbody></table></div>)}
    </div>
  );
}
