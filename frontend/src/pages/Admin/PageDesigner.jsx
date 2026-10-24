import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Input, Result, Select, Space, Spin, Switch, Tabs, Tag } from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import { usePages } from '../../context/PagesContext';
import { PAGE_ICONS } from '../../components/pageIcons';
import FieldsTab from './Designer/FieldsTab';
import FormTab from './Designer/FormTab';
import TableTab from './Designer/TableTab';
import { SourcesTab, ColumnsTab } from './Designer/ViewTabs';
import { stripUi } from './Designer/util';

const snapshot = (d) => JSON.stringify({ t: d.title, i: d.icon, d: d.description || '', c: d.kind === 'records' ? stripUi(d.config) : d.config });

export default function PageDesigner() {
  const { slug } = useParams(); const { message } = App.useApp(); const nav = useNavigate(); const { reload } = usePages();
  const [page, setPage] = useState(null); const [draft, setDraft] = useState(null); const [orig, setOrig] = useState(''); const [err, setErr] = useState(null);
  const [meta, setMeta] = useState(null); const [categories, setCategories] = useState([]); const [dropdowns, setDropdowns] = useState({}); const [recordPages, setRecordPages] = useState([]);
  const [lockedKeys, setLockedKeys] = useState(new Set()); const [saving, setSaving] = useState(false); const [tab, setTab] = useState('fields');

  const load = useCallback(async () => {
    try {
      const [p, m, dd, all] = await Promise.all([api.get(`/pages/${slug}`), api.get('/pages/meta'), api.get('/dropdowns'), api.get('/pages?all=1')]);
      const d = { ...p.data, config: p.data.config };
      setPage(p.data); setDraft(d); setOrig(snapshot(d)); setMeta(m.data); setDropdowns(dd.data); setCategories(Object.keys(dd.data).sort());
      setRecordPages(all.data.filter((x) => x.kind === 'records' && x.slug !== slug));
      setLockedKeys(new Set((p.data.config.fields || []).map((f) => f.key)));
      setTab(p.data.kind === 'view' ? 'sources' : 'fields');
    } catch (e) { setErr(e.response?.status || 500); }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const dirty = draft && snapshot(draft) !== orig;
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const setConfig = useCallback((fn) => setDraft((d) => ({ ...d, config: typeof fn === 'function' ? fn(d.config) : fn })), []);
  const warnings = useMemo(() => {
    if (!draft || draft.kind !== 'records') return [];
    const c = draft.config; const w = [];
    if (!c.fields.length) w.push('Add at least one field.');
    else if (!c.form.sections.some((s) => s.items.length)) w.push('Place fields on the form (Form tab) so records can be created.');
    if (c.fields.length && !c.table.columns.length) w.push('Add at least one column to the table (Table tab) so records can be listed.');
    return w;
  }, [draft]);

  const save = async () => {
    setSaving(true);
    try {
      const config = draft.kind === 'records' ? stripUi(draft.config) : draft.config;
      const r = await api.put(`/pages/${draft.id}`, { title: draft.title, icon: draft.icon, description: draft.description || '', config });
      const next = { ...r.data }; setPage(next); setDraft(next); setOrig(snapshot(next));
      setLockedKeys(new Set((next.config.fields || []).map((f) => f.key))); reload(); message.success('Layout saved');
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  if (err) return <Result status={err === 403 ? '403' : '404'} title={err === 403 ? 'No access' : 'Page not found'} extra={<Button onClick={() => nav('/admin/pages')}>Back to pages</Button>} />;
  if (!draft || !meta) return <div className="page"><Spin /></div>;
  const isView = draft.kind === 'view';
  const c = draft.config;

  const settings = (
    <div className="designer-pane" style={{ maxWidth: 620, display: 'grid', gap: 14 }}>
      <label>Title<Input value={draft.title} maxLength={96} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Description (shown under the title)<Input.TextArea rows={2} maxLength={500} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <label>Icon<Select style={{ width: '100%' }} value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} options={Object.keys(PAGE_ICONS).map((k) => { const I = PAGE_ICONS[k]; return { value: k, label: <span><I /> {k}</span> }; })} /></label>
      <label>Address<Input disabled value={`/p/${draft.slug}`} className="mono" /></label>
      {!isView && <div><Switch checked={c.reconcile !== false} onChange={(v) => setConfig((x) => ({ ...x, reconcile: v }))} /> <span style={{ marginLeft: 8 }}>Include in “In inventory, not discovered” checks on the Reconcile page</span>
        <div style={{ color: '#5d6b6e', fontSize: 12, marginTop: 4 }}>Turn off for things that are not virtual machines, such as physical servers or licences.</div></div>}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/admin/pages"><ArrowLeftOutlined /> All pages</Link>
          <h1 style={{ marginTop: 6 }}>{draft.title || 'Untitled'} <Tag color={isView ? 'purple' : 'blue'}>{isView ? 'view' : 'records'}</Tag>{dirty && <Tag color="orange">unsaved changes</Tag>}</h1>
          <div className="sub">{isView ? 'Combine the records of several pages into one table.' : 'Define the fields, then arrange the form and the table by dragging.'}</div>
        </div>
        <Space><Link to={`/p/${draft.slug}`}><Button>Open page</Button></Link><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save layout</Button></Space>
      </div>
      {warnings.map((w) => <Alert key={w} type="warning" showIcon style={{ marginBottom: 8 }} message={w} />)}
      <Tabs activeKey={tab} onChange={setTab} destroyInactiveTabPane items={isView ? [
        { key: 'sources', label: `Sources (${c.sources.length})`, children: <SourcesTab config={c} setConfig={setConfig} recordPages={recordPages} /> },
        { key: 'columns', label: `Columns (${c.columns.length})`, children: <ColumnsTab config={c} setConfig={setConfig} /> },
        { key: 'settings', label: 'Settings', children: settings },
      ] : [
        { key: 'fields', label: `Fields (${c.fields.length})`, children: <FieldsTab config={c} setConfig={setConfig} meta={meta} categories={categories} lockedKeys={lockedKeys} /> },
        { key: 'form', label: 'Form layout', children: <FormTab config={c} setConfig={setConfig} dropdowns={dropdowns} /> },
        { key: 'table', label: 'Table layout', children: <TableTab config={c} setConfig={setConfig} /> },
        { key: 'settings', label: 'Settings', children: settings },
      ]} />
    </div>
  );
}
