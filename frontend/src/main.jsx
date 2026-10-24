import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import './styles.css';

// Ant Design's form.validateFields() rejects with { errorFields } when a form is invalid. The form already
// shows the messages inline, so swallow only that specific rejection instead of logging it as an error.
window.addEventListener('unhandledrejection', (e) => { if (e.reason && Array.isArray(e.reason.errorFields)) e.preventDefault(); });

function Themed({ children }) {
  const { primary_color } = useBranding();
  return (
    <ConfigProvider theme={{
      algorithm: theme.compactAlgorithm,
      token: { colorPrimary: primary_color, borderRadius: 4, fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif", colorBgLayout: '#f4f6f7' },
      components: { Table: { headerBg: '#eef2f3', rowHoverBg: '#f6fafa' }, Layout: { siderBg: '#14292c', headerBg: '#ffffff' }, Menu: { darkItemBg: '#14292c', darkSubMenuItemBg: '#14292c' } },
    }}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrandingProvider>
      <Themed>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </Themed>
    </BrandingProvider>
  </React.StrictMode>
);
