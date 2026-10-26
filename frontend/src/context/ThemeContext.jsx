import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'inv_theme';
const Ctx = createContext({ mode: 'light', toggle: () => {} });
export const useThemeMode = () => useContext(Ctx);

const initial = () => {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light') return v; } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Light / dark mode: remembered per browser, defaults to the operating system setting. Sets data-theme on <html> for the CSS variables. */
export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
  }, [mode]);
  const toggle = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
