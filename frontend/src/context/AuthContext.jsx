import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { TOKEN_KEY } from '../api/client';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: !!localStorage.getItem(TOKEN_KEY), user: null, pages: new Set(), canWrite: false });

  const apply = (d) => setState({ loading: false, user: d.user, pages: new Set(d.pages), canWrite: d.can_write });

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api.get('/auth/me').then((r) => apply(r.data)).catch(() => { localStorage.removeItem(TOKEN_KEY); setState((s) => ({ ...s, loading: false })); });
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, r.data.token);
    apply(r.data);
  }, []);
  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setState({ loading: false, user: null, pages: new Set(), canWrite: false }); }, []);

  const value = useMemo(() => ({ ...state, login, logout, has: (p) => state.pages.has(p) }), [state, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
