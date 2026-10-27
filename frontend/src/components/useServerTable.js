import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import api, { errMsg } from '../api/client';
import { PAGE_SIZES } from '../utils/pager';

/** Server-paginated list state shared by the inventory-style pages. */
export default function useServerTable(path, initialFilters = {}, pageSize = 25) {
  const { message } = App.useApp();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState({});
  const [filters, setFilters] = useState(initialFilters);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current; setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const r = await api.get(path, { params: { ...clean, ...sort, page, pageSize: size } });
      if (my !== seq.current) return;             // a newer request superseded this one
      setRows(r.data.rows); setTotal(r.data.total);
    } catch (e) { if (my === seq.current) message.error(errMsg(e)); } finally { if (my === seq.current) setLoading(false); }
  }, [path, filters, sort, page, size, message]);

  useEffect(() => { load(); }, [load]);
  const setFilter = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })); };
  return { rows, total, loading, page, size, filters, setFilter, setPage, setSize, setSort, reload: load,
    pagination: { current: page, pageSize: size, total, showSizeChanger: true, pageSizeOptions: PAGE_SIZES, showTotal: (t) => `${t} records`, onChange: (p, s) => { setPage(p); setSize(s); } },
    onTableChange: (_p, _f, sorter) => { const k = sorter?.columnKey ?? sorter?.field; setSort(k && sorter.order ? { sort: k, order: sorter.order === 'ascend' ? 'asc' : 'desc' } : {}); } };
}
