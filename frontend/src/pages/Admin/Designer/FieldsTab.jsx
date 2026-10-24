import { useState } from 'react';
import { Alert, AutoComplete, Button, Checkbox, Input, Popconfirm, Radio, Select, Switch, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Draggable, DropZone, move } from '../../../components/dnd';
import { keyFrom, rewriteKey, uid } from './util';

const TYPE_LABEL = { text: 'Text', textarea: 'Long text', number: 'Number', boolean: 'Yes / No', date: 'Date', select: 'Choice list', password: 'Password (encrypted)' };

function FieldBody({ f, i, config, set, meta, categories, locked, rename }) {
  const others = config.fields.filter((x) => x.key !== f.key);
  const usedRoles = new Set(others.filter((x) => x.role).map((x) => x.role));
  const cond = others.find((x) => x.key === f.showIf?.key);
  const upd = (patch) => set((c) => { const fields = [...c.fields]; fields[i] = { ...fields[i], ...patch }; return { ...c, fields }; });
  const row = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 };
  return (
    <div className="field-card-body">
      <div style={row}>
        <label>Label<Input value={f.label} onChange={(e) => { const label = e.target.value; upd({ label }); if (f._auto) rename(f.key, keyFrom(label, new Set(others.map((x) => x.key)))); }} /></label>
        <label>Key <span style={{ color: '#7a8a8e' }}>{locked ? '(fixed: records already use it)' : '(used in imports and the API)'}</span>
          <Input className="mono" value={f.key} disabled={locked} onChange={(e) => { upd({ _auto: false }); rename(f.key, e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }} /></label>
      </div>
      <div style={row}>
        <label>Type<Select style={{ width: '100%' }} value={f.type} onChange={(type) => upd({ type, ...(type === 'password' ? { role: undefined, unique: false } : {}) })} options={meta.types.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))} /></label>
        <label>Meaning <span style={{ color: '#7a8a8e' }}>(lets reports, uniqueness and decommission find this field)</span>
          <Select style={{ width: '100%' }} allowClear placeholder="None" disabled={f.type === 'password'} value={f.role} onChange={(role) => upd({ role })}
            options={meta.roles.map((r) => ({ value: r.key, label: r.label, disabled: usedRoles.has(r.key) }))} /></label>
      </div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
        <Checkbox checked={!!f.required} onChange={(e) => upd({ required: e.target.checked })}>Required</Checkbox>
        <Checkbox checked={!!f.unique} disabled={f.type === 'password' || f.type === 'boolean'} onChange={(e) => upd({ unique: e.target.checked })}>Must be unique on this page</Checkbox>
      </div>
      <label style={{ display: 'block', marginBottom: 12 }}>Help text (shown under the field)<Input value={f.hint || ''} maxLength={200} onChange={(e) => upd({ hint: e.target.value })} /></label>
      {f.type === 'select' && (
        <div style={{ marginBottom: 12 }}>
          <Radio.Group value={f.optionsCategory !== undefined ? 'category' : 'custom'} style={{ marginBottom: 8 }}
            onChange={(e) => (e.target.value === 'category' ? upd({ optionsCategory: categories[0] || '', options: undefined }) : upd({ optionsCategory: undefined, options: [] }))}>
            <Radio value="custom">Custom list</Radio><Radio value="category">Dropdown Master list (shared, editable by admins)</Radio></Radio.Group>
          {f.optionsCategory !== undefined
            ? <AutoComplete style={{ width: '100%' }} placeholder="Pick an existing category or type a new one" value={f.optionsCategory || ''} onChange={(v) => upd({ optionsCategory: String(v).toLowerCase().replace(/[^a-z_]/g, '') })}
                options={categories.map((c) => ({ value: c }))} />
            : <Select mode="tags" style={{ width: '100%' }} placeholder="Type an option and press Enter" value={f.options || []} onChange={(options) => upd({ options })} tokenSeparators={[',']} />}
        </div>)}
      <div>
        <Switch size="small" checked={!!f.showIf} disabled={!others.length} onChange={(on) => upd({ showIf: on ? { key: others[0].key, value: others[0].type === 'boolean' ? true : '' } : undefined })} /> <span style={{ marginLeft: 6 }}>Only show this field when another field has a value</span>
        {f.showIf && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Select style={{ minWidth: 200 }} value={f.showIf.key} options={others.map((x) => ({ value: x.key, label: x.label }))} onChange={(key) => upd({ showIf: { key, value: others.find((x) => x.key === key).type === 'boolean' ? true : '' } })} />
            {cond?.type === 'boolean'
              ? <Select style={{ width: 140 }} value={f.showIf.value === true ? 'on' : 'off'} onChange={(v) => upd({ showIf: { ...f.showIf, value: v === 'on' } })} options={[{ value: 'on', label: 'is on' }, { value: 'off', label: 'is off' }]} />
              : <Input style={{ width: 200 }} placeholder="equals…" value={String(f.showIf.value ?? '')} onChange={(e) => upd({ showIf: { ...f.showIf, value: e.target.value } })} />}
          </div>)}
      </div>
    </div>
  );
}

export default function FieldsTab({ config, setConfig, meta, categories, lockedKeys }) {
  const [open, setOpen] = useState(null);
  const fields = config.fields;
  const add = () => setConfig((c) => { const key = keyFrom('New field', new Set(c.fields.map((f) => f.key))); setOpen(key); return { ...c, fields: [...c.fields, { key, label: 'New field', type: 'text', _auto: true, _id: uid() }] }; });
  const rename = (oldKey, newKey) => { if (!newKey || newKey === oldKey) return; setConfig((c) => rewriteKey(c, oldKey, newKey)); setOpen((o) => (o === oldKey ? newKey : o)); };
  const remove = (key) => setConfig((c) => rewriteKey(c, key, null));
  const reorder = (from, to) => setConfig((c) => ({ ...c, fields: move(c.fields, from, to > from ? to - 1 : to) }));
  return (
    <div style={{ maxWidth: 860 }}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Define what each record holds" description="Add the fields first, then arrange them on the Form and Table tabs. Give a field a meaning (for example IP address or Asset tag) if you want it to take part in duplicate checks, decommissioning, reports and reconcile." />
      {fields.map((f, i) => (
        <div key={f._id || f.key}>
          <DropZone accept={(d) => d.kind === 'field-order'} onDrop={(d) => reorder(d.index, i)} style={{ height: 6 }} />
          <div className="field-card">
            <Draggable payload={{ kind: 'field-order', index: i }} className="field-card-head" style={{ cursor: 'grab' }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(open === f.key ? null : f.key)}>
                <b>{f.label}</b><span className="mono" style={{ color: '#7a8a8e' }}>{f.key}</span><Tag>{TYPE_LABEL[f.type]}</Tag>
                {f.role && <Tag color="blue">{meta.roles.find((r) => r.key === f.role)?.label}</Tag>}{f.required && <Tag color="red">required</Tag>}{f.unique && <Tag>unique</Tag>}{f.showIf && <Tag>conditional</Tag>}
              </span>
              <Popconfirm title={`Remove “${f.label}”?`} description={lockedKeys.has(f.key) ? 'Existing records keep the stored value, but it will no longer be shown anywhere.' : 'It will also be removed from the form and table.'} okButtonProps={{ danger: true }} onConfirm={() => remove(f.key)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${f.label}`} /></Popconfirm>
            </Draggable>
            {open === f.key && <FieldBody f={f} i={i} config={config} set={setConfig} meta={meta} categories={categories} locked={lockedKeys.has(f.key)} rename={rename} />}
          </div>
        </div>))}
      <DropZone accept={(d) => d.kind === 'field-order'} onDrop={(d) => reorder(d.index, fields.length)} style={{ height: 14 }} />
      <Button icon={<PlusOutlined />} onClick={add}>Add field</Button>
    </div>
  );
}
