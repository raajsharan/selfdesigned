import { useEffect, useState } from 'react';
import { Button, Checkbox, Select, Switch, Tag } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

// Where each input lives on a page: the field with that role, else the field whose key or label looks right (existing pages often never set roles).
const LOOK = { hostname: /host.?name/i, location: /location|^site$/i, os: /^os$|os.?type|operating.?system/i, asset_tag: /asset.?tag/i, department: /department/i, ip: /^ip$|ip.?addr/i };
export function hostField(cfg, role) {
  const fs = cfg.fields || [];
  const hit = fs.find((f) => f.role === role) || fs.find((f) => f.type !== 'password' && f.type !== 'hostname_suggest' && !f.role && LOOK[role].test(`${f.key} ${f.label || ''}`));
  return hit || null;
}

/** Best-effort Team for a department (keyword rules from the Inventory Tool); null when the code is not in the current team list. */
export function guessTeam(department, teams = []) {
  const d = String(department || '').toLowerCase(); let g = null;
  if (d.includes('lab')) g = 'LAB'; else if (d.includes('qa')) g = 'QAT';
  else if (d.includes('devops') || d.includes('dev-ops') || d.includes('dev ops')) g = 'DVO'; else if (d.includes('dev')) g = 'DEV';
  else if (d.includes('support') || d.includes('service')) g = 'SNP'; else if (d.includes('platform')) g = 'PLT'; else if (d.includes('security')) g = 'SEC';
  else if (d.includes('pre-sales') || d.includes('presales') || d.includes('sales')) g = 'PSE'; else if (d.includes('network')) g = 'NEA'; else if (/\bit\b/.test(d) || d.includes('it')) g = 'ITO';
  return g && teams.some((t) => t.code === g) ? g : null;
}
/** The asset tag part: its digits, padded to 4 and cut to the last 4 (tag 123 -> 0123). */
export const tagPart = (tag) => { const dg = String(tag || '').replace(/\D/g, ''); return dg ? dg.padStart(4, '0').slice(-4) : ''; };

/** OS letter is fixed by the OS value: Windows = W, VMware / ESXi = E, Linux and Proxmox = L. */
export const osLetter = (os) => { const s = String(os || ''); return /windows/i.test(s) ? 'W' : /vmware|esxi/i.test(s) ? 'E' : /linux|proxmox|ubuntu|rhel|red hat|centos|debian|rocky|suse|alma/i.test(s) ? 'L' : ''; };
export const SEGMENT_LABEL = { site: 'Site', os: 'OS', team: 'Department (Team)', tier: 'Tier', tag: 'Asset Tag' };

/** "Suggested hostname" panel under the Hostname field. Site, OS and tag come from the record; Team and Tier are picked here. */
export default function HostnameHelper({ pattern, cfg, values, onUse, canApply, onApply, label = 'Suggested hostname' }) {
  const role = (r) => hostField(cfg, r)?.key;
  const loc = values[role('location')]; const os = values[role('os')]; const tag = values[role('asset_tag')]; const dept = values[role('department')];
  const [team, setTeam] = useState(); const [tier, setTier] = useState(); 
  const [apply, setApply] = useState(false); const [reboot, setReboot] = useState(true);
  useEffect(() => { onApply?.(apply ? { reboot } : null); }, [apply, reboot]); // eslint-disable-line react-hooks/exhaustive-deps
  const tierVal = pattern.tier_field ? values[pattern.tier_field] : undefined;
  useEffect(() => {   // the Tier comes from a field of the page when one is configured
    if (!tierVal) return;
    const t = String(tierVal).toLowerCase(); const hit = pattern.tiers.find((x) => x.code.toLowerCase() === t || x.label.toLowerCase() === t);
    if (hit) setTier(hit.code);
  }, [tierVal]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Team follows the Department every time it changes: the mapping set in Hostname Naming first, then the same name, then the keyword guess.
  // Choosing a Team by hand sticks only until the Department is changed again.
  useEffect(() => {
    if (!dept) { setTeam(undefined); return; }
    const d = String(dept).toLowerCase(); const mapped = (pattern.team_map || {})[dept];
    const hit = pattern.teams.find((t) => t.code === mapped) || pattern.teams.find((t) => t.label.toLowerCase() === d || t.code.toLowerCase() === d);
    setTeam(hit ? hit.code : guessTeam(dept, pattern.teams) || undefined);
  }, [dept]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pattern.type_field && pattern.types.length) {   // only for the chosen asset types (a page without that field is not filtered)
    const f = cfg.fields.find((x) => x.key === pattern.type_field);
    if (f && !pattern.types.includes(values[f.key])) return null;
  }
  const parts = { site: pattern.sites[loc], os: osLetter(os), team, tier, tag: tagPart(tag) };
  const missing = pattern.order.filter((s) => !parts[s]);
  const text = pattern.order.map((s) => parts[s]).join('');
  const hintFor = { site: loc ? `no site code for "${loc}" (Administration > Hostname Naming)` : 'choose a Location', os: os ? 'OS not recognised' : 'choose an OS', team: dept ? `no Team matches the department "${dept}": pick one (or map it in Hostname Naming)` : 'choose a Department', tier: 'pick a Tier', tag: 'needs an Asset tag with digits' };
  return (
    <div className="hn-panel" style={{ margin: '-4px 0 14px', padding: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}><ThunderboltOutlined /> {label}</div>
      {values[role('hostname')] && <div style={{ color: 'var(--muted)', marginBottom: 8 }}>Currently in the form: <span className="mono">{values[role('hostname')]}</span></div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Select allowClear style={{ minWidth: 220 }} placeholder="Team (follows Department)" value={team} onChange={setTeam} options={pattern.teams.map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` }))} />
        <Select allowClear style={{ minWidth: 200 }} placeholder="Tier" value={tier} onChange={setTier} options={pattern.tiers.map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` }))} />
      </div>
      {missing.length ? <span style={{ color: 'var(--muted)' }}>{missing.map((s) => <Tag key={s}>{SEGMENT_LABEL[s]}: {hintFor[s]}</Tag>)}</span>
        : <><span className="mono" style={{ fontWeight: 600, marginRight: 12 }}>{text}</span><Button size="small" type="primary" onClick={() => onUse(text)}>Use this hostname</Button></>}
      {canApply && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <Switch size="small" checked={apply} onChange={setApply} /> <b style={{ marginLeft: 6 }}>Apply to the host on save (Ansible)</b>
          <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>Renames the machine to the hostname in the field above, over SSH, using the login saved on this record. Works for Linux and Windows.</div>
          {apply && osLetter(os) === 'E' && <div style={{ color: '#d48806', margin: '4px 0' }}>Live rename is not supported for VMware / ESXi hosts: only the Hostname field is saved. Rename the host itself manually (esxcli system hostname set).</div>}
          {apply && pattern.allow_reboot && <Checkbox checked={reboot} onChange={(e) => setReboot(e.target.checked)}>Reboot the host if the new name requires it (Windows does)</Checkbox>}
        </div>)}
    </div>
  );
}
