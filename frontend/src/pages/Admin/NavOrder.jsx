import { useState } from 'react';
import { App, Button } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import { usePages } from '../../context/PagesContext';
import { iconFor } from '../../components/pageIcons';
import { NAV_ORDER_KEY, orderedGroups, savedRank } from '../../nav';
import PageHeader from '../../components/PageHeader';

export default function NavOrder() {
  const { message } = App.useApp(); const { pages } = useAuth(); const { pages: designed } = usePages();
  // The designed pages are a section of their own, so they can be ordered here too.
  const load = () => { const rank = savedRank(); const g = orderedGroups(pages); const d = [...designed].sort((a, b) => rank(`page:${a.slug}`) - rank(`page:${b.slug}`)).map((p) => ({ key: `page:${p.slug}`, label: p.title, icon: iconFor(p.icon) })); return d.length ? [...g, { group: 'Pages', items: d }] : g; };
  const [groups, setGroups] = useState(load); const [drag, setDrag] = useState(null); const [over, setOver] = useState(null);
  const drop = (gi, to) => {
    if (!drag || drag.gi !== gi || drag.key === to) return;
    setGroups((gs) => gs.map((g, i) => { if (i !== gi) return g; const items = g.items.filter((x) => x.key !== drag.key); const dragged = g.items.find((x) => x.key === drag.key);
      const idx = items.findIndex((x) => x.key === to); items.splice(g.items.findIndex((x) => x.key === drag.key) < g.items.findIndex((x) => x.key === to) ? idx + 1 : idx, 0, dragged); return { ...g, items }; }));
  };
  const save = () => { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(groups.flatMap((g) => g.items.map((i) => i.key)))); message.success('Menu order saved on this device'); };
  const reset = () => { localStorage.removeItem(NAV_ORDER_KEY); setGroups(load()); message.success('Menu order reset'); };
  return (
    <div className="page">
      <PageHeader title="Menu Order" sub="Drag items to reorder the sidebar within each section. Sections open when clicked in the sidebar. The order is saved in this browser only." extra={<><Button onClick={reset}>Reset</Button><Button type="primary" onClick={save}>Save order</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {groups.map((g, gi) => <div className="card" key={g.group}><b>{g.group}</b><div style={{ marginTop: 8 }}>
          {g.items.map((i) => <div key={i.key} className={`drag-item ${over === i.key ? 'over' : ''}`} draggable onDragStart={() => setDrag({ gi, key: i.key })} onDragOver={(e) => { e.preventDefault(); setOver(i.key); }} onDragEnd={() => { setDrag(null); setOver(null); }} onDrop={() => { drop(gi, i.key); setDrag(null); setOver(null); }}>
            <HolderOutlined style={{ color: 'var(--faint)' }} /><i.icon /> {i.label}</div>)}</div></div>)}
      </div>
    </div>
  );
}
