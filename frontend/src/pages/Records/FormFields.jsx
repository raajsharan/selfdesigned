import { DatePicker, Divider, Form, Input, InputNumber, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { ApartmentOutlined, AppstoreOutlined, BarcodeOutlined, CalendarOutlined, CheckCircleOutlined, DesktopOutlined, EditOutlined, EnvironmentOutlined, GlobalOutlined,
  KeyOutlined, LaptopOutlined, NumberOutlined, TagOutlined, ToolOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons';

/** Mirrors the server's rule so conditional fields appear and disappear instantly. */
export function isVisible(f, values) {
  if (!f.showIf) return true;
  const v = values[f.showIf.key]; const want = f.showIf.value;
  if (want === true) return v === true;
  if (want === false) return !v;
  return String(v ?? '') === String(want);
}

/** Choice-list options. A field that "depends on" another list only gets the values linked to the parent's current choice. */
export const optionsOf = (f, dropdowns, parentValue) => {
  let list = f.options?.length ? f.options : dropdowns[f.optionsCategory] || [];
  if (f.dependsOn && f.optionsCategory) {
    const links = dropdowns.$parents?.[f.optionsCategory] || {};
    list = parentValue ? list.filter((o) => links[o] === parentValue) : [];
  }
  return list.map((o) => ({ value: o, label: o }));
};

// Leading icon of a field: its meaning wins (so an IP field shows a laptop), otherwise its type.
const ROLE_ICON = { name: DesktopOutlined, hostname: GlobalOutlined, ip: LaptopOutlined, mac: BarcodeOutlined, asset_tag: TagOutlined, status: CheckCircleOutlined,
  os: AppstoreOutlined, department: ApartmentOutlined, location: EnvironmentOutlined, owner: UserOutlined, patching_type: ToolOutlined, last_patched: CalendarOutlined };
const TYPE_ICON = { text: EditOutlined, number: NumberOutlined, date: CalendarOutlined, select: UnorderedListOutlined, ip: LaptopOutlined, password: KeyOutlined };
const iconOf = (f) => ROLE_ICON[f.role] || TYPE_ICON[f.type] || EditOutlined;

/** Pill input with its icon in front. Long text and switches keep their normal look. */
const Pill = ({ f, children }) => { const Icon = iconOf(f); return <div className="pill-field"><span className="pill-ico" aria-hidden="true"><Icon /></span>{children}</div>; };

/** Form.Item injects value / onChange / id (or checked for switches): they must reach the real control. */
function Input_(props) {
  const { f } = props;
  const control = <Control {...props} />;
  return f.type === 'textarea' || f.type === 'boolean' ? control : <Pill f={f}>{control}</Pill>;
}
function Control({ f, dropdowns, disabled, extra, ...p }) {
  switch (f.type) {
    case 'textarea': return <Input.TextArea {...p} rows={3} maxLength={5000} disabled={disabled} />;
    case 'number': return <InputNumber {...p} style={{ width: '100%' }} disabled={disabled} />;
    case 'boolean': return <Switch {...p} disabled={disabled} />;
    case 'date': return <DatePicker {...p} style={{ width: '100%' }} disabled={disabled} />;
    case 'select': {
      const waiting = f.dependsOn && !extra?.parentValue;
      return <Select {...p} allowClear showSearch optionFilterProp="label" options={optionsOf(f, dropdowns, extra?.parentValue)} disabled={disabled || waiting}
        placeholder={waiting ? `Select ${extra?.parentLabel || 'the parent field'} first` : undefined}
        onChange={(v, o) => { p.onChange?.(v, o); (extra?.dependents || []).forEach((k) => extra.form.setFieldValue(k, undefined)); }} />;
    }
    case 'password': return <Input.Password {...p} autoComplete="new-password" disabled={disabled} placeholder={extra?.hasSecret ? 'Stored. Type to replace.' : ''} />;
    case 'ip': return <Input {...p} placeholder="192.168.1.1" inputMode="decimal" maxLength={15} disabled={disabled} />;
    default: return <Input {...p} maxLength={255} disabled={disabled} />;
  }
}

const IP_RULE = { pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/, message: 'Use the format x.x.x.x, e.g. 192.168.1.1' };
const MAC_RULE = { pattern: /^([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2}$/, message: 'Use 6 pairs of hex digits, e.g. AA:BB:CC:DD:EE:FF' };

/**
 * Renders the designed form layout. Used for the real editor and for the live preview in the designer
 * (with `disabled`). `secretKeys` = password fields that already hold a value.
 */
export default function FormFields({ config, dropdowns = {}, form, disabled = false, secretKeys = [], renderAfter }) {
  const fields = Object.fromEntries((config.fields || []).map((f) => [f.key, f]));
  const sections = config.form?.sections || [];
  if (!sections.length) return <div style={{ color: '#7a8a8e', padding: 12 }}>This page has no form layout yet.</div>;
  return (
    <div className="pill-form">
      {sections.map((s) => (
        <div key={s.id}>
          {s.title && <Divider orientation="left" orientationMargin={0} style={{ margin: '8px 0 12px' }}>{s.title}</Divider>}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${s.columns || 1}, minmax(0, 1fr))`, gap: '0 16px' }}>
            {s.items.map((it) => {
              const f = fields[it.key]; if (!f) return null;
              return (
                <Form.Item key={f.key} noStyle shouldUpdate>
                  {() => {
                    if (!isVisible(f, form.getFieldsValue(true))) return null;
                    const rules = [];
                    if (f.required && f.type !== 'boolean' && !(f.type === 'password' && secretKeys.includes(f.key))) rules.push({ required: true, message: `${f.label} is required` });
                    if (f.role === 'mac') rules.push(MAC_RULE);
                    if (f.type === 'ip') rules.push(IP_RULE);
                    return (
                      <div style={{ gridColumn: `span ${Math.min(it.span || 1, s.columns || 1)}` }}>
                        <Form.Item name={f.key} label={f.label} extra={f.hint} rules={rules} valuePropName={f.type === 'boolean' ? 'checked' : 'value'}>
                          <Input_ f={f} dropdowns={dropdowns} disabled={disabled}
                            extra={{ hasSecret: secretKeys.includes(f.key), form, parentValue: f.dependsOn ? form.getFieldValue(f.dependsOn) : undefined, parentLabel: fields[f.dependsOn]?.label,
                              dependents: (config.fields || []).filter((x) => x.dependsOn === f.key).map((x) => x.key) }} />
                        </Form.Item>
                        {renderAfter?.(f)}
                      </div>
                    );
                  }}
                </Form.Item>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** record.data -> form values (dates become dayjs). */
export function toFormValues(config, data = {}) {
  const v = { ...data };
  for (const f of config.fields || []) if (f.type === 'date' && v[f.key]) v[f.key] = dayjs(v[f.key]);
  return v;
}
/** form values -> API payload. Cleared fields are sent as null so they are removed server-side. */
export function toPayload(config, values) {
  const out = {};
  const placed = new Set((config.form?.sections || []).flatMap((s) => s.items.map((i) => i.key)));
  for (const f of config.fields || []) {
    if (!placed.has(f.key)) continue;
    let v = values[f.key];
    if (f.type === 'password') { if (typeof v === 'string' && v !== '') out[f.key] = v; continue; }
    if (f.type === 'date') v = v ? v.format('YYYY-MM-DD') : null;
    if (v === undefined || v === '') v = null;
    out[f.key] = v;
  }
  return out;
}
