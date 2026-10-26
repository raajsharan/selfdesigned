import { useEffect, useState } from 'react';
import { Button, Checkbox, DatePicker, Input, InputNumber, Popover, Select, Switch } from 'antd';
import { SettingOutlined, HolderOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Stat } from '../../../components/PageHeader';

export const VM_STATUS = ['Pending', 'In Progress', 'Migrated', 'Blocked'];
export const HOST_STAGE = ['Not Started', 'In Progress', 'Completed', 'Blocked'];
export const STATUS_COLOR = { Pending: '#8c8c8c', 'Not Started': '#8c8c8c', 'In Progress': '#c77700', Migrated: '#2f7d32', Completed: '#2f7d32', Blocked: '#cf1322' };

export function SummaryCards({ s }) {
  if (!s) return null;
  return (
    <div className="stat-grid">
      <Stat label="Total" value={s.total} /><Stat label="Migrated" value={s.migrated} tone="good" /><Stat label="In progress" value={s.in_progress} tone="warn" />
      <Stat label="Blocked" value={s.blocked} tone={s.blocked ? 'bad' : ''} /><Stat label="Pending" value={s.pending} />
      {s.powered_off !== undefined && s.powered_off !== null && <Stat label="Powered off" value={s.powered_off} />}
    </div>
  );
}

export const StatusSelect = ({ value, options, onChange, disabled }) => (
  <Select size="small" value={value} disabled={disabled} style={{ width: 128 }} onChange={onChange} popupMatchSelectWidth={false}
    options={options.map((o) => ({ value: o, label: <span style={{ color: STATUS_COLOR[o] }}>{o}</span> }))} />
);

/** Inline editor for a project custom field. Saves on change (or on blur for text-like inputs). */
export function CustomCell({ def, value, onSave, disabled }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = (x) => { if ((x ?? '') !== (value ?? '')) onSave(x === '' ? null : x); };
  switch (def.type) {
    case 'boolean': return <Switch size="small" checked={!!value} disabled={disabled} onChange={(c) => onSave(c)} />;
    case 'dropdown': return <Select size="small" allowClear style={{ width: 130 }} value={value || undefined} disabled={disabled} options={(def.options || []).map((o) => ({ value: o, label: o }))} onChange={(x) => onSave(x ?? null)} />;
    case 'date': return <DatePicker size="small" allowClear value={value ? dayjs(value) : null} disabled={disabled} onChange={(d) => onSave(d ? d.format('YYYY-MM-DD') : null)} />;
    case 'number': return <InputNumber size="small" style={{ width: 100 }} value={v === '' ? null : v} disabled={disabled} onChange={(x) => setV(x ?? '')} onBlur={() => commit(v)} onPressEnter={() => commit(v)} />;
    case 'textarea': return <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} style={{ minWidth: 180 }} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} />;
    default: return <Input size="small" style={{ minWidth: 140 }} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} onPressEnter={() => commit(v)} />;
  }
}

export const NotesCell = ({ value, onSave, disabled }) => <CustomCell def={{ type: 'textarea' }} value={value} onSave={onSave} disabled={disabled} />;

/** Persisted column order + visibility. `all` = [{key,title}]. */
export function useColumnPrefs(storageKey, all, defaultHidden = []) {
  const [prefs, setPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey)) || null; } catch { return null; } });
  useEffect(() => { try { setPrefs(JSON.parse(localStorage.getItem(storageKey)) || null); } catch { setPrefs(null); } }, [storageKey]);
  const keys = all.map((c) => c.key);
  const order = [...(prefs?.order || []).filter((k) => keys.includes(k)), ...keys.filter((k) => !(prefs?.order || []).includes(k))];
  const hidden = new Set(prefs ? prefs.hidden.filter((k) => keys.includes(k)) : defaultHidden);
  const save = (n) => { setPrefs(n); localStorage.setItem(storageKey, JSON.stringify(n)); };
  return { order, hidden, setOrder: (o) => save({ order: o, hidden: [...hidden] }), toggle: (k) => save({ order, hidden: hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k] }), reset: () => { localStorage.removeItem(storageKey); setPrefs(null); } };
}

export function ColumnManager({ all, prefs }) {
  const [drag, setDrag] = useState(null); const [over, setOver] = useState(null);
  const title = (k) => all.find((c) => c.key === k)?.title;
  const drop = (to) => {
    if (drag === null || drag === to) return;
    const o = prefs.order.filter((k) => k !== drag); o.splice(o.indexOf(to) + (prefs.order.indexOf(drag) < prefs.order.indexOf(to) ? 1 : 0), 0, drag); prefs.setOrder(o);
  };
  return (
    <Popover trigger="click" placement="bottomRight" title="Columns" content={
      <div style={{ width: 240, maxHeight: 360, overflow: 'auto' }}>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>Tick to show, drag to reorder. Saved on this device.</div>
        {prefs.order.map((k) => (
          <div key={k} className={`drag-item ${over === k ? 'over' : ''}`} draggable onDragStart={() => setDrag(k)} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragEnd={() => { setDrag(null); setOver(null); }} onDrop={() => { drop(k); setDrag(null); setOver(null); }}>
            <HolderOutlined style={{ color: 'var(--faint)' }} /><Checkbox checked={!prefs.hidden.has(k)} onChange={() => prefs.toggle(k)}>{title(k)}</Checkbox>
          </div>))}
        <Button size="small" type="link" onClick={prefs.reset}>Reset to default</Button>
      </div>}>
      <Button icon={<SettingOutlined />}>Columns</Button>
    </Popover>
  );
}
