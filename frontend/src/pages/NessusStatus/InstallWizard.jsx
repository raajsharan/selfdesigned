import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Modal, Progress } from 'antd';
import {
  CheckOutlined, ClockCircleOutlined, DownloadOutlined, EnvironmentOutlined, ExclamationCircleFilled, ExportOutlined, KeyOutlined,
  LoadingOutlined, LockOutlined, MinusCircleOutlined, PlayCircleOutlined, CloseCircleFilled,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../../api/client';

const PILL = {
  queued: { label: 'Queued', cls: 'idle', icon: <ClockCircleOutlined /> },
  running: { label: 'Running', cls: 'run', icon: <LoadingOutlined /> },
  installed: { label: 'Installed', cls: 'ok', icon: <CheckOutlined /> },
  not_installed: { label: 'Not installed', cls: 'bad', icon: <CloseCircleFilled style={{ fontSize: 11 }} /> },
  login_failed: { label: 'Login failed', cls: 'warn', icon: <ExclamationCircleFilled style={{ fontSize: 11 }} /> },
  failed: { label: 'Failed', cls: 'warn', icon: <ExclamationCircleFilled style={{ fontSize: 11 }} /> },
  skipped: { label: 'Skipped', cls: 'idle', icon: <MinusCircleOutlined /> },
};
const recordLink = (r) => `/p/${r.source}?record=${r.id}`;
const byLocation = (list) => {
  const m = new Map(); list.forEach((r) => m.set(r.location, [...(m.get(r.location) || []), r]));
  return [...m.entries()].sort(([a], [b]) => (a === 'No location') - (b === 'No location') || a.localeCompare(b));
};
const Loc = ({ name }) => <div className="nw-loc"><EnvironmentOutlined /> {name}</div>;

/** Two steps in one dialog: 1. check the targets and the login each will use, 2. watch the Ansible run. */
export default function InstallWizard({ job, onClose, onFinished }) {
  const { message } = App.useApp();
  const [mode, setMode] = useState('verify'); const [targets, setTargets] = useState(null); const [win, setWin] = useState({ has: false, dir: '' });
  const [run, setRun] = useState(null); const [starting, setStarting] = useState(false); const [now, setNow] = useState(Date.now());
  const timer = useRef(null);
  const items = job?.items;

  useEffect(() => {
    if (!items) return undefined;
    setMode(job.mode); setTargets(null); setRun(null);
    api.post('/nessus-status/preview', { items: items.map((r) => ({ source: r.source, id: r.id })) }).then((r) => { setTargets(r.data.targets); setWin({ has: r.data.has_windows, dir: r.data.windows_dest_dir || '' }); }).catch((e) => { message.error(errMsg(e)); onClose(); });
    return () => clearInterval(timer.current);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const runnable = (targets || []).filter((t) => t.can_run); const skipped = (targets || []).length - runnable.length;
  const running = run?.status === 'running';

  const poll = (id) => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      setNow(Date.now());
      try { const r = (await api.get(`/nessus-status/jobs/${id}`)).data; setRun(r); if (r.status === 'done') { clearInterval(timer.current); onFinished(); } }
      catch (e) { clearInterval(timer.current); message.error(errMsg(e)); }
    }, 2000);
  };
  const start = async (list, m) => {
    setStarting(true);
    try { const r = (await api.post('/nessus-status/jobs', { items: list.map((t) => ({ source: t.source, id: t.id })), mode: m, windows_dest_dir: win.dir })).data; setRun(r); setMode(m); poll(r.id); }
    catch (e) { message.error(errMsg(e)); } finally { setStarting(false); }
  };
  const download = async () => {
    try {
      const r = await api.get(`/nessus-status/jobs/${run.id}/log`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `nessus-${run.mode}.log`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { message.error(errMsg(e)); }
  };
  const failedItems = (run?.items || []).filter((i) => ['login_failed', 'failed'].includes(i.state));
  const secs = (i) => Math.round(((i.finished_at || now) - i.started_at) / 1000);
  const grouped = useMemo(() => byLocation(run?.items || []), [run]);

  const step1 = (
    <>
      <div className="nw-body">
        <div className="nw-h">What to do</div>
        <div className="nw-seg">
          {[['verify', 'Verify only'], ['install', 'Install, then verify']].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        {mode === 'install' && win.has && <div style={{ marginTop: 14 }}>
          <div className="nw-h">Windows destination folder</div>
          <Input value={win.dir} onChange={(e) => setWin((w) => ({ ...w, dir: e.target.value }))} placeholder="C:\Temp\NessusAgent" />
          <div className="nw-dim small" style={{ marginTop: 4 }}>The installer is copied from the shared path on the server into this folder (created if missing), then installed from there. The file is left in place.</div></div>}
        <div className="nw-h" style={{ marginTop: 18 }}>Targets and the login each will use</div>
        {!targets ? <div className="nw-dim"><LoadingOutlined /> Reading the saved logins…</div> : byLocation(targets).map(([loc, list]) => (
          <div key={loc}><Loc name={loc} />
            {list.map((t) => (
              <div className="nw-row" key={`${t.source}-${t.id}`}>
                <div><b>{t.name}</b> <span className="nw-dim">{t.os_type}</span>{!t.can_run && <div className="nw-dim small">Will be skipped</div>}</div>
                {t.can_run
                  ? <span className="nw-login"><KeyOutlined /> <code>{t.username}</code> · password saved</span>
                  : <span className="nw-skip"><span className="nx-pill warn"><ExclamationCircleFilled style={{ fontSize: 11 }} />{t.reason === 'no_username' ? 'No username saved' : 'No password saved'}</span>
                    <Link to={recordLink(t)} target="_blank">Open record <ExportOutlined /></Link></span>}
              </div>))}
          </div>))}
        <div className="nw-note"><LockOutlined /> <span>Nobody types a password here. Each asset is reached with the username and password saved on its own record. The password is decrypted on the server for this run only, is never shown, and every use is written to the audit log.</span></div>
      </div>
      <div className="nw-foot"><span className="nw-dim">{runnable.length} will run · {skipped} skipped</span>
        <span className="nw-btns"><Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<PlayCircleOutlined />} disabled={!runnable.length || (mode === 'install' && win.has && !win.dir.trim())} loading={starting} onClick={() => start(runnable, mode)}>Start ({runnable.length} asset{runnable.length === 1 ? '' : 's'})</Button></span></div>
    </>);

  const total = run ? run.total - run.skipped : 0;
  const step2 = run && (
    <>
      <div className="nw-prog"><Progress percent={total ? Math.round((run.finished * 100) / total) : 100} showInfo={false} size="small" status="normal" /><b>{run.finished} / {total}</b></div>
      <div className="nw-body flush">
        {grouped.map(([loc, list]) => (
          <div key={loc}><Loc name={loc} />
            {list.map((i) => { const p = PILL[i.state]; return (
              <div className="nw-res" key={`${i.source}-${i.id}`}>
                <span className={`nx-pill ${p.cls}`}>{p.icon}{i.state === 'running' ? (run.mode === 'install' ? 'Installing' : 'Verifying') : p.label}</span>
                <div className="nw-msg"><b>{i.name}</b><div className="nw-dim">{i.message}</div></div>
                <div className="nw-side">{i.started_at && <span className="nw-dim small">{secs(i)} s</span>}
                  {['login_failed', 'failed', 'skipped'].includes(i.state) && <Link to={recordLink(i)} target="_blank"><Button size="small" icon={<ExportOutlined />}>Open record</Button></Link>}</div>
              </div>); })}
          </div>))}
      </div>
      <div className="nw-foot"><span className="nw-dim small">Results are saved to each asset&apos;s Nessus status.</span>
        <span className="nw-btns">
          <Button disabled={running || !failedItems.length} onClick={() => start(failedItems, run.mode)}>Retry failed ({failedItems.length})</Button>
          <Button icon={<DownloadOutlined />} onClick={download}>Download log</Button>
          <Button disabled={running} onClick={onClose}>Close</Button></span></div>
    </>);

  return (
    <Modal open={!!job} width={680} footer={null} destroyOnClose maskClosable={!running} keyboard={!running} closable={!running} onCancel={onClose} className="nw-modal"
      title={<div>{run ? (running ? 'Running' : 'Finished') : `Install / verify on ${items?.length} asset${items?.length === 1 ? '' : 's'}`}
        <div className="nw-sub">{run ? `2. Results · ${run.finished} of ${total} finished${run.skipped ? ` · ${run.skipped} skipped` : ''}` : '1. Check and start'}</div></div>}>
      {run ? step2 : step1}
    </Modal>
  );
}
