import dayjs from 'dayjs';
import { CheckCircleFilled, CloseCircleFilled, QuestionCircleFilled, ExclamationCircleFilled, MinusCircleFilled } from '@ant-design/icons';

// Status is always an icon plus text, never colour alone.
export const LIVE = {
  1: { label: 'Live', cls: 'ok', icon: <CheckCircleFilled /> },
  2: { label: 'Down', cls: 'bad', icon: <CloseCircleFilled /> },
  3: { label: 'Unknown', cls: 'idle', icon: <QuestionCircleFilled /> },
};
export const INSTALL = {
  21: { label: 'Yet to install', cls: 'warn', icon: <MinusCircleFilled /> },
  22: { label: 'Installed', cls: 'ok', icon: <CheckCircleFilled /> },
  23: { label: 'Uninstalled', cls: 'idle', icon: <MinusCircleFilled /> },
  24: { label: 'Yet to uninstall', cls: 'warn', icon: <MinusCircleFilled /> },
  29: { label: 'Installation failed', cls: 'bad', icon: <ExclamationCircleFilled /> },
};
export const Pill = ({ s, children }) => <span className={`nx-pill ${s.cls}`}>{s.icon}{children || s.label}</span>;
export const Dash = () => <span className="nx-dim">-</span>;
export const orDash = (v) => (v === null || v === undefined || v === '' ? <Dash /> : v);
export const when = (v) => (v ? dayjs(v).format('D MMM HH:mm') : <Dash />);
/** Last contact: older than a week is highlighted. */
export const contact = (v) => (v ? <span className={dayjs().diff(v, 'day') > 7 ? 'nx-stale' : ''} title={dayjs(v).format('D MMM YYYY HH:mm')}>{dayjs(v).format('D MMM HH:mm')}</span> : <Dash />);
export const found = (yes) => <Pill s={yes ? { label: 'Found', cls: 'ok', icon: <CheckCircleFilled /> } : { label: 'Not found', cls: 'warn', icon: <QuestionCircleFilled /> }} />;
