import { Alert, Button, InputNumber, Select } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Draggable, DropZone, move } from '../../../components/dnd';

export const META_COLS = [{ key: '_created_at', label: 'Created' }, { key: '_updated_at', label: 'Updated' }];

export default function TableTab({ config, setConfig }) {
  const table = config.table;
  const all = [...config.fields.filter((f) => f.type !== 'password').map((f) => ({ key: f.key, label: f.label })), ...META_COLS];
  const label = (k) => all.find((a) => a.key === k)?.label || k;
  const used = new Set(table.columns.map((c) => c.key));
  const palette = all.filter((a) => !used.has(a.key));
  const setTable = (fn) => setConfig((c) => ({ ...c, table: fn(c.table) }));
  const insert = (d, at) => setTable((t) => {
    const cols = d.from === 'col' ? t.columns.filter((c) => c.key !== d.key) : [...t.columns];
    const orig = t.columns.find((c) => c.key === d.key);
    const idx = at === null ? cols.length : cols.findIndex((c) => c.key === at);
    cols.splice(idx === -1 ? cols.length : idx, 0, orig || { key: d.key });
    return { ...t, columns: cols };
  });
  const remove = (key) => setTable((t) => ({ ...t, columns: t.columns.filter((c) => c.key !== key) }));
  const nudge = (i, d) => setTable((t) => (i + d < 0 || i + d >= t.columns.length ? t : { ...t, columns: move(t.columns, i, i + d) }));
  const width = (key, w) => setTable((t) => ({ ...t, columns: t.columns.map((c) => (c.key === key ? { ...c, width: w || undefined } : c)) }));

  return (
    <div className="designer-grid">
      <DropZone accept={(d) => d.kind === 'col' && d.from === 'col'} onDrop={(d) => remove(d.key)} className="designer-pane">
        <b>Available columns</b>
        <div style={{ color: '#5d6b6e', fontSize: 12, margin: '2px 0 10px' }}>Drag into the table. Drag a column back here to remove it.</div>
        {palette.map((a) => <Draggable key={a.key} payload={{ kind: 'col', key: a.key, from: 'palette' }} className="chip">{a.label}</Draggable>)}
        {!palette.length && <div style={{ color: '#9aa7a9', fontSize: 13 }}>Every column is in the table.</div>}
      </DropZone>

      <div style={{ minWidth: 0 }}>
        {!table.columns.length && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Drag the columns you want to see into the table below" />}
        <div className="designer-pane">
          <b>Table</b> <span style={{ color: '#5d6b6e', fontSize: 12 }}>(column order, left to right, wrapping onto the next row)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 8, marginTop: 10, minHeight: 74 }}>
            {table.columns.map((c, i) => (
              <DropZone key={c.key} accept={(d) => d.kind === 'col' && d.key !== c.key} onDrop={(d) => insert(d, c.key)} style={{ display: 'flex' }}>
                <Draggable payload={{ kind: 'col', key: c.key, from: 'col' }} className="canvas-item" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 150, background: '#eef2f3' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <b style={{ flex: 1 }}>{label(c.key)}</b>
                    <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => nudge(i, -1)} aria-label={`Move ${label(c.key)} left`} />
                    <Button size="small" type="text" icon={<ArrowRightOutlined />} onClick={() => nudge(i, 1)} aria-label={`Move ${label(c.key)} right`} />
                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => remove(c.key)} aria-label={`Remove ${label(c.key)}`} />
                  </div>
                  <InputNumber size="small" min={60} max={600} placeholder="auto width" value={c.width} onChange={(w) => width(c.key, w)} style={{ width: '100%' }} addonAfter="px" />
                </Draggable>
              </DropZone>))}
            <DropZone accept={(d) => d.kind === 'col'} onDrop={(d) => insert(d, null)} style={{ minWidth: 120, flex: 1, border: '1px dashed #cfd9dc', display: 'grid', placeItems: 'center', color: '#9aa7a9', fontSize: 12 }}>Drop here</DropZone>
          </div>
        </div>

        <div className="designer-pane" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ gridColumn: '1 / -1' }}>Filter drop-downs above the table <span style={{ color: '#7a8a8e' }}>(up to 8)</span>
            <Select mode="multiple" maxCount={8} style={{ width: '100%' }} value={table.filters} placeholder="None" onChange={(filters) => setTable((t) => ({ ...t, filters }))}
              options={config.fields.filter((f) => f.type !== 'password').map((f) => ({ value: f.key, label: f.label }))} /></label>
          <label>Default sort
            <div style={{ display: 'flex', gap: 8 }}><Select style={{ flex: 1 }} value={table.sort.key} onChange={(key) => setTable((t) => ({ ...t, sort: { ...t.sort, key } }))} options={all.map((a) => ({ value: a.key, label: a.label }))} />
              <Select style={{ width: 120 }} value={table.sort.order} onChange={(order) => setTable((t) => ({ ...t, sort: { ...t.sort, order } }))} options={[{ value: 'asc', label: 'A to Z' }, { value: 'desc', label: 'Z to A' }]} /></div></label>
          <label>Rows per page<Select style={{ width: '100%' }} value={table.pageSize} onChange={(pageSize) => setTable((t) => ({ ...t, pageSize }))} options={[10, 25, 50, 100, 200].map((n) => ({ value: n, label: n }))} /></label>
        </div>
      </div>
    </div>
  );
}
