export default function PageHeader({ title, sub, extra }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {extra && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}
export function Stat({ label, value, tone }) {
  return <div className={`stat ${tone || ''}`}><div className="n">{value ?? '-'}</div><div className="l">{label}</div></div>;
}
