import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

const Ctx = createContext({ pages: [], bySlug: {}, reload: () => {}, loaded: false });
export const usePages = () => useContext(Ctx);

/** The pages the signed-in user may open (designed by administrators), in menu order. */
export function PagesProvider({ children }) {
  const { user } = useAuth();
  const [pages, setPages] = useState([]); const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => (user ? api.get('/pages').then((r) => setPages(r.data)).catch(() => {}).finally(() => setLoaded(true)) : Promise.resolve()), [user]);
  useEffect(() => { setLoaded(false); reload(); }, [reload]);
  const value = useMemo(() => ({ pages, loaded, reload, bySlug: Object.fromEntries(pages.map((p) => [p.slug, p])) }), [pages, loaded, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
