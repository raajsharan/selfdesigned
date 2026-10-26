import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { TOKEN_KEY } from '../api/client';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const LOCK_KEY = 'inv_locked';
const IDLE_MS = 5 * 60 * 1000;   // lock the screen after 5 minutes without activity
const readLocked = () => { try { return sessionStorage.getItem(LOCK_KEY) === '1'; } catch { return false; } };
const writeLocked = (v) => { try { v ? sessionStorage.setItem(LOCK_KEY, '1') : sessionStorage.removeItem(LOCK_KEY); } catch { /* storage unavailable */ } };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: !!localStorage.getItem(TOKEN_KEY), user: null, pages: new Set(), canWrite: false });
  const [locked, setLocked] = useState(readLocked);
  const lastActive = useRef(Date.now());

  const apply = (d) => setState({ loading: false, user: d.user, pages: new Set(d.pages), canWrite: d.can_write });

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api.get('/auth/me').then((r) => apply(r.data)).catch(() => { localStorage.removeItem(TOKEN_KEY); setState((s) => ({ ...s, loading: false })); });
  }, []);

  const lock = useCallback(() => { writeLocked(true); setLocked(true); }, []);
  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, r.data.token);
    writeLocked(false); setLocked(false); lastActive.current = Date.now();
    apply(r.data);
  }, []);
  /** Re-checks the signed-in user's password; a wrong password leaves the screen locked. */
  const unlock = useCallback((password) => login(state.user.email, password), [login, state.user]);
  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); writeLocked(false); setLocked(false); setState({ loading: false, user: null, pages: new Set(), canWrite: false }); }, []);

  // Idle auto-lock while signed in.
  useEffect(() => {
    if (!state.user || locked) return undefined;
    const touch = () => { lastActive.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => { if (Date.now() - lastActive.current > IDLE_MS) lock(); }, 5000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); clearInterval(timer); };
  }, [state.user, locked, lock]);

  /** Replace the signed-in user's details after a profile edit (the API returns the fresh profile). */
  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const value = useMemo(() => ({ ...state, locked: !!state.user && locked, login, logout, lock, unlock, setUser, has: (p) => state.pages.has(p) }), [state, locked, login, logout, lock, unlock, setUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
