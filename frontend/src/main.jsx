import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import { ThemeProvider, useThemeMode } from './context/ThemeContext';
import './styles.css';

// Ant Design's form.validateFields() rejects with { errorFields } when a form is invalid. The form already
// shows the messages inline, so swallow only that specific rejection instead of logging it as an error.
window.addEventListener('unhandledrejection', (e) => { if (e.reason && Array.isArray(e.reason.errorFields)) e.preventDefault(); });

function Themed({ children }) {
  const { primary_color } = useBranding();
  const dark = useThemeMode().mode === 'dark';
  return (
    <ConfigProvider theme={{
      algorithm: dark ? [theme.darkAlgorithm, theme.compactAlgorithm] : theme.compactAlgorithm,
      token: { colorPrimary: primary_color, borderRadius: 4, fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
        colorBgLayout: dark ? '#10181a' : '#f4f6f7', ...(dark ? { colorBgContainer: '#1b2528', colorBgElevated: '#222d31' } : {}) },
      components: { Table: dark ? { headerBg: '#243034', rowHoverBg: '#202b2f' } : { headerBg: '#eef2f3', rowHoverBg: '#f6fafa' },
        Layout: { siderBg: '#14292c', headerBg: dark ? '#1b2528' : '#ffffff', bodyBg: dark ? '#10181a' : '#f4f6f7' }, Menu: { darkItemBg: '#14292c', darkSubMenuItemBg: '#14292c' } },
    }}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrandingProvider>
      <ThemeProvider>
        <Themed>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </Themed>
      </ThemeProvider>
    </BrandingProvider>
  </React.StrictMode>
);
