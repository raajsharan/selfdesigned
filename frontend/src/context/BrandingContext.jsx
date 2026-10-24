import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const Ctx = createContext({ app_name: 'Inventory Tool', primary_color: '#1f6f78', logo_data_url: null, reload: () => {} });
export const useBranding = () => useContext(Ctx);

export function BrandingProvider({ children }) {
  const [b, setB] = useState({ app_name: 'Inventory Tool', primary_color: '#1f6f78', logo_data_url: null });
  const reload = useCallback(() => api.get('/branding').then((r) => { setB(r.data); document.title = r.data.app_name; }).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return <Ctx.Provider value={{ ...b, reload }}>{children}</Ctx.Provider>;
}
