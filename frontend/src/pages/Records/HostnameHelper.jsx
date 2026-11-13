import { useEffect, useState } from 'react';
import { Button, Select, Tag } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

/** OS letter is fixed by the OS value: Windows = W, VMware / ESXi = E, Linux and Proxmox = L. */
export const osLetter = (os) => { const s = String(os || ''); return /windows/i.test(s) ? 'W' : /vmware|esxi/i.test(s) ? 'E' : /linux|proxmox|ubuntu|rhel|red hat|centos|debian|rocky|suse|alma/i.test(s) ? 'L' : ''; };
export const SEGMENT_LABEL = { site: 'Site', os: 'OS', team: 'Team', tier: 'Tier', tag: 'Asset Tag' };

/** "Suggested hostname" panel under the Hostname field. Site, OS and tag come from the record; Team and Tier are picked here. */
export default function HostnameHelper({ pattern, cfg, values, onUse }) {
  const role = (r) => cfg.fields.find((f) => f.role === r)?.key;
  const loc = values[role('location')]; const os = values[role('os')]; const tag = values[role('asset_tag')]; const dept = values[role('department')];
  const [team, setTeam] = useState(); const [tier, setTier] = useState();
  useEffect(() => {   // pre-fill the team from the department name
    if (!dept) return;
    const d = String(dept).toLowerCase();
    const hit = pattern.teams.find((t) => t.label.toLowerCase() === d || t.code.toLowerCase() === d) || pattern.teams.find((t) => t.label.toLowerCase().includes(d) || d.includes(t.label.toLowerCase().replace(/ team$/, '')));
    if (hit) setTeam(hit.code);
  }, [dept]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pattern.type_field && pattern.types.length) {   // only for the chosen asset types (a page without that field is not filtered)
    const f = cfg.fields.find((x) => x.key === pattern.type_field);
    if (f && !pattern.types.includes(values[f.key])) return null;
  }
  const parts = { site: pattern.sites[loc], os: osLetter(os), team, tier, tag: tag ? String(tag) : '' };
  const missing = pattern.order.filter((s) => !parts[s]);
  const text = pattern.order.map((s) => parts[s]).join('');
  const hintFor = { site: loc ? `no site code for "${loc}" (Administration > Hostname Naming)` : 'choose a Location', os: os ? 'OS not recognised' : 'choose an OS', team: 'pick a Team', tier: 'pick a Tier', tag: 'needs an Asset tag' };
  return (
    <div className="hn-panel" style={{ margin: '-4px 0 14px', padding: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}><ThunderboltOutlined /> Suggested hostname</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Select allowClear style={{ minWidth: 220 }} placeholder="Team" value={team} onChange={setTeam} options={pattern.teams.map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` }))} />
        <Select allowClear style={{ minWidth: 200 }} placeholder="Tier" value={tier} onChange={setTier} options={pattern.tiers.map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` }))} />
      </div>
      {missing.length ? <span style={{ color: 'var(--muted)' }}>{missing.map((s) => <Tag key={s}>{SEGMENT_LABEL[s]}: {hintFor[s]}</Tag>)}</span>
        : <><span className="mono" style={{ fontWeight: 600, marginRight: 12 }}>{text}</span><Button size="small" type="primary" onClick={() => onUse(text)}>Use this hostname</Button></>}
    </div>
  );
}
