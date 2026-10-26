import { useBranding } from '../context/BrandingContext';
import InfraBackground from './InfraBackground';

/** Shared frame for the sign-in and lock screens: animated infrastructure backdrop, white card, footer line. */
export default function AuthShell({ title, subtitle, avatar, children, footer }) {
  const { app_name, logo_data_url } = useBranding();
  return (
    <div className="auth-wrap">
      <InfraBackground />
      <div className="auth-center">
        <div className="auth-card">
          <div className="auth-brand">{logo_data_url && <img src={logo_data_url} alt="" />}<span>{app_name}</span></div>
          <h1>{title}</h1>
          <p className="auth-sub">{subtitle}</p>
          {avatar}
          {children}
        </div>
        {footer && <div className="auth-foot">{footer}</div>}
        <div className="auth-foot">© {new Date().getFullYear()} {app_name}</div>
      </div>
    </div>
  );
}
