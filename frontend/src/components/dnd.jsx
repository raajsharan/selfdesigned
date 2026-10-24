import { useState } from 'react';
import { HolderOutlined } from '@ant-design/icons';

/*
 * Small native drag-and-drop toolkit (no dependency). One drag at a time, so the payload lives in a module
 * variable; dataTransfer is only set because Firefox refuses to start a drag without it.
 */
let current = null;
export const dragging = () => current;

export function Draggable({ payload, children, style, handle = true, className = '' }) {
  return (
    <div draggable className={className} style={{ cursor: 'grab', ...style }}
      onDragStart={(e) => { current = payload; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x'); e.stopPropagation(); }}
      onDragEnd={() => { current = null; }}>
      {handle && <HolderOutlined style={{ color: '#9aa7a9', marginRight: 6 }} />}{children}
    </div>
  );
}

/** Highlights while a matching payload hovers; calls onDrop(payload) when released. `accept(payload)` filters. */
export function DropZone({ accept, onDrop, children, style, hint, className = '' }) {
  const [over, setOver] = useState(false);
  const ok = () => current && (!accept || accept(current));
  return (
    <div className={`dropzone ${over ? 'over' : ''} ${className}`} style={style}
      onDragOver={(e) => { if (ok()) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!ok()) return; e.preventDefault(); e.stopPropagation(); setOver(false); const p = current; current = null; onDrop(p); }}>
      {children}{hint && !children && <span style={{ color: '#9aa7a9', fontSize: 12 }}>{hint}</span>}
    </div>
  );
}

export const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };
