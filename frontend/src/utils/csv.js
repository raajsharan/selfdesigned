// Client-side CSV export with spreadsheet-formula-injection protection.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function downloadCsv(filename, columns, rows) {
  const body = [columns.map((c) => cell(c.title)).join(','), ...rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
