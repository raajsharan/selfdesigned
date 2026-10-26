import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Popconfirm, Select } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, SortAscendingOutlined } from '@ant-design/icons';
import { Draggable, DropZone, move } from '../../../components/dnd';
import FormFields from '../../Records/FormFields';
import { uid } from './util';

export default function FormTab({ config, setConfig, dropdowns }) {
  const [preview, setPreview] = useState(false); const [pform] = Form.useForm();
  const fields = Object.fromEntries(config.fields.map((f) => [f.key, f]));
  const sections = config.form.sections;
  const placed = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
  const palette = config.fields.filter((f) => !placed.has(f.key));
  const missing = config.fields.filter((f) => f.required && !f.showIf && !placed.has(f.key));

  const setSections = (fn) => setConfig((c) => ({ ...c, form: { ...c.form, sections: fn(c.form.sections) } }));
  const detach = (secs, key) => secs.map((s) => ({ ...s, items: s.items.filter((i) => i.key !== key) }));
  /** Move a field (from the palette or another spot) into section `sid`, before `beforeKey` (or at the end). */
  const place = (payload, sid, beforeKey) => setSections((secs) => {
    const span = secs.flatMap((s) => s.items).find((i) => i.key === payload.key)?.span || 1;
    const out = detach(secs, payload.key);
    return out.map((s) => { if (s.id !== sid) return s; const items = [...s.items]; const at = beforeKey ? items.findIndex((i) => i.key === beforeKey) : -1; items.splice(at === -1 ? items.length : at, 0, { key: payload.key, span: Math.min(span, s.columns) }); return { ...s, items }; });
  });
  const patchSection = (sid, patch) => setSections((secs) => secs.map((s) => (s.id === sid ? { ...s, ...patch, ...(patch.columns ? { items: s.items.map((i) => ({ ...i, span: Math.min(i.span || 1, patch.columns) })) } : {}) } : s)));
  const patchItem = (sid, key, patch) => setSections((secs) => secs.map((s) => (s.id === sid ? { ...s, items: s.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : s)));
  const nudge = (sid, key, d) => setSections((secs) => secs.map((s) => { if (s.id !== sid) return s; const i = s.items.findIndex((x) => x.key === key); const j = i + d; return j < 0 || j >= s.items.length ? s : { ...s, items: move(s.items, i, j) }; }));
  const addSection = () => setSections((secs) => [...secs, { id: uid(), title: 'New section', columns: 2, items: [] }]);
  const reorderSection = (id, toIndex) => setSections((secs) => { const from = secs.findIndex((s) => s.id === id); return move(secs, from, toIndex > from ? toIndex - 1 : toIndex); });
  /** Re-order every section's fields to follow the order on the Fields tab. */
  const sortByFieldOrder = () => setSections((secs) => {
    const rank = new Map(config.fields.map((f, i) => [f.key, i]));
    return secs.map((s) => ({ ...s, items: [...s.items].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0)) }));
  });
  const placeAll = () => setSections((secs) => {
    const target = secs.length ? secs : [{ id: uid(), title: 'Details', columns: 2, items: [] }];
    return target.map((s, i) => (i === target.length - 1 ? { ...s, items: [...s.items, ...palette.map((f) => ({ key: f.key, span: f.type === 'textarea' ? s.columns : 1 }))] } : s));
  });

  return (
    <div className="designer-grid">
      <DropZone accept={(d) => d.kind === 'field' && d.from} onDrop={(d) => setSections((s) => detach(s, d.key))} className="designer-pane">
        <b>Not on the form</b>
        <div style={{ color: '#5d6b6e', fontSize: 12, margin: '2px 0 10px' }}>Drag a field into a section. Drag one back here to remove it.</div>
        {palette.map((f) => <Draggable key={f.key} payload={{ kind: 'field', key: f.key, from: null }} className="chip" handle>{f.label}{f.required && <b style={{ color: '#cf1322' }}>*</b>}</Draggable>)}
        {!palette.length && <div style={{ color: '#9aa7a9', fontSize: 13 }}>Every field is on the form.</div>}
        {palette.length > 0 && <div style={{ marginTop: 8 }}><Button size="small" onClick={placeAll}>Place all remaining fields</Button></div>}
      </DropZone>

      <div>
        {missing.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`Required but not on the form: ${missing.map((f) => f.label).join(', ')}`} description="Records cannot be created without them. Place them on the form or make them optional." />}
        <div className="toolbar"><Button icon={<PlusOutlined />} onClick={addSection}>Add section</Button><div className="grow" /><Button icon={<SortAscendingOutlined />} onClick={sortByFieldOrder} disabled={!sections.length}>Sort by field order</Button><Button icon={<EyeOutlined />} onClick={() => setPreview(true)} disabled={!sections.length}>Preview form</Button></div>
        {!sections.length && <Alert type="info" showIcon message="Start by adding a section" description="A section is a titled block of the form with 1 to 3 columns. Then drag fields into it." />}
        {sections.map((s, si) => (
          <div key={s.id}>
            <DropZone accept={(d) => d.kind === 'section'} onDrop={(d) => reorderSection(d.id, si)} style={{ height: 8 }} />
            <div className="canvas-section">
              <Draggable payload={{ kind: 'section', id: s.id }} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Input size="small" value={s.title} placeholder="Section title (optional)" maxLength={64} onChange={(e) => patchSection(s.id, { title: e.target.value })} style={{ flex: 1 }} />
                <Select size="small" value={s.columns} style={{ width: 120 }} onChange={(columns) => patchSection(s.id, { columns })} options={[1, 2, 3].map((n) => ({ value: n, label: `${n} column${n > 1 ? 's' : ''}` }))} />
                <Popconfirm title="Delete this section?" description="Its fields go back to “Not on the form”." onConfirm={() => setSections((secs) => secs.filter((x) => x.id !== s.id))}><Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete section" /></Popconfirm>
              </Draggable>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${s.columns}, minmax(0, 1fr))`, gap: 8 }}>
                {s.items.map((it) => { const f = fields[it.key]; if (!f) return null; return (
                  <DropZone key={it.key} accept={(d) => d.kind === 'field' && d.key !== it.key} onDrop={(d) => place(d, s.id, it.key)} style={{ gridColumn: `span ${Math.min(it.span || 1, s.columns)}` }}>
                    <Draggable payload={{ kind: 'field', key: it.key, from: s.id }} className="canvas-item">
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}{f.required && <b style={{ color: '#cf1322' }}> *</b>}<span style={{ color: '#7a8a8e', fontSize: 11, marginLeft: 6 }}>{f.type}</span></span>
                      {s.columns > 1 && <Select size="small" variant="borderless" value={it.span || 1} style={{ width: 92 }} onChange={(span) => patchItem(s.id, it.key, { span })} options={Array.from({ length: s.columns }, (_, n) => ({ value: n + 1, label: `${n + 1} col${n ? 's' : ''} wide` }))} aria-label="Width" />}
                      <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => nudge(s.id, it.key, -1)} aria-label="Move earlier" />
                      <Button size="small" type="text" icon={<ArrowRightOutlined />} onClick={() => nudge(s.id, it.key, 1)} aria-label="Move later" />
                      <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setSections((secs) => detach(secs, it.key))} aria-label={`Remove ${f.label} from form`} />
                    </Draggable>
                  </DropZone>); })}
                <DropZone accept={(d) => d.kind === 'field'} onDrop={(d) => place(d, s.id, null)} style={{ gridColumn: '1 / -1', minHeight: 34, border: '1px dashed #cfd9dc', display: 'grid', placeItems: 'center', color: '#9aa7a9', fontSize: 12 }}>
                  {s.items.length ? 'Drop here to add to the end' : 'Drop fields here'}</DropZone>
              </div>
            </div>
          </div>))}
        {sections.length > 0 && <DropZone accept={(d) => d.kind === 'section'} onDrop={(d) => reorderSection(d.id, sections.length)} style={{ height: 14 }} />}
      </div>

      <Drawer open={preview} onClose={() => setPreview(false)} width={680} title="Form preview" destroyOnClose>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="This is exactly how the form will look. Try the conditional fields." />
        <Form form={pform} layout="vertical" requiredMark="optional"><FormFields config={config} dropdowns={dropdowns} form={pform} /></Form>
      </Drawer>
    </div>
  );
}
