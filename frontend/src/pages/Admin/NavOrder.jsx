import { useState } from 'react';
import { App, Button } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';
import { NAV_ORDER_KEY, orderedGroups } from '../../nav';
import PageHeader from '../../components/PageHeader';

export default function NavOrder() {
  const { message } = App.useApp(); const { pages } = useAuth();
  const [groups, setGroups] = useState(() => orderedGroups(pages)); const [drag, setDrag] = useState(null); const [over, setOver] = useState(null);
  const drop = (gi, to) => {
    if (!drag || drag.gi !== gi || drag.key === to) return;
    setGroups((gs) => gs.map((g, i) => { if (i !== gi) return g; const items = g.items.filter((x) => x.key !== drag.key); const dragged = g.items.find((x) => x.key === drag.key);
      const idx = items.findIndex((x) => x.key === to); items.splice(g.items.findIndex((x) => x.key === drag.key) < g.items.findIndex((x) => x.key === to) ? idx + 1 : idx, 0, dragged); return { ...g, items }; }));
  };
  const save = () => { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(groups.flatMap((g) => g.items.map((i) => i.key)))); message.success('Menu order saved on this device'); };
  const reset = () => { localStorage.removeItem(NAV_ORDER_KEY); setGroups(orderedGroups(pages)); message.success('Menu order reset'); };
  return (
    <div className="page">
      <PageHeader title="Menu Order" sub="Drag items to reorder the sidebar within each section. The order is saved in this browser only." extra={<><Button onClick={reset}>Reset</Button><Button type="primary" onClick={save}>Save order</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {groups.map((g, gi) => <div className="card" key={g.group}><b>{g.group}</b><div style={{ marginTop: 8 }}>
          {g.items.map((i) => <div key={i.key} className={`drag-item ${over === i.key ? 'over' : ''}`} draggable onDragStart={() => setDrag({ gi, key: i.key })} onDragOver={(e) => { e.preventDefault(); setOver(i.key); }} onDragEnd={() => { setDrag(null); setOver(null); }} onDrop={() => { drop(gi, i.key); setDrag(null); setOver(null); }}>
            <HolderOutlined style={{ color: 'var(--faint)' }} /><i.icon /> {i.label}</div>)}</div></div>)}
      </div>
    </div>
  );
}
