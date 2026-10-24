import axios from 'axios';

export const TOKEN_KEY = 'inv_token';
const api = axios.create({ baseURL: '/api', timeout: 120000 });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use((r) => r, (err) => {
  // An expired / revoked token anywhere sends the user back to the sign-in page.
  if (err.response?.status === 401 && !String(err.config?.url).includes('/auth/login')) {
    localStorage.removeItem(TOKEN_KEY);
    if (location.pathname !== '/login') location.assign('/login');
  }
  return Promise.reject(err);
});

/** Human-readable message from an API error. */
export const errMsg = (e) => {
  const d = e?.response?.data;
  if (d?.details && Array.isArray(d.details) && d.details[0]?.message) return `${d.error}: ${d.details.map((x) => `${x.field} ${x.message}`).join('; ')}`;
  return d?.error || e?.message || 'Something went wrong';
};

/** Download a file endpoint with the auth header (plain <a href> links cannot send it). */
export async function download(path, filename, params) {
  const r = await api.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default api;
