import { useState } from 'react';
import { Alert, App, Button, Modal, Radio, Table, Tag, Tooltip, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import api, { download, errMsg } from '../../api/client';

const COLOR = { create: 'green', merge: 'blue', error: 'red' };

/** Upload -> preview with create/merge/error diff -> commit. */
export default function ImportModal({ page, open, onClose, onDone }) {
  const { message } = App.useApp();
  const [file, setFile] = useState(null); const [plan, setPlan] = useState(null); const [filter, setFilter] = useState('all'); const [busy, setBusy] = useState(false);
  const base = `/p/${page.slug}/records/import`; const labels = Object.fromEntries(page.config.fields.map((f) => [f.key, f.label]));
  const reset = () => { setFile(null); setPlan(null); setFilter('all'); };
  const close = () => { reset(); onClose(); };
  const form = (f) => { const fd = new FormData(); fd.append('file', f); return fd; };

  const preview = async (f) => {
    setFile(f); setBusy(true);
    try { setPlan((await api.post(`${base}?mode=preview`, form(f))).data); } catch (e) { message.error(errMsg(e)); setFile(null); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = (await api.post(`${base}?mode=commit&skip_errors=true&actions=${['create', 'merge'].filter((a) => filter === 'all' || filter === a).join(',')}`, form(file))).data;
      message.success(`Imported: ${r.created} created, ${r.merged} merged, ${r.skipped} skipped`); reset(); onDone();
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const rows = plan ? plan.rows.filter((r) => filter === 'all' || r.action === filter) : [];
  const count = plan ? plan.summary.create + plan.summary.merge : 0;

  return (
    <Modal open={open} onCancel={close} width={900} title={`Import into ${page.title}`} destroyOnClose
      footer={plan ? [<Button key="b" onClick={reset}>Choose another file</Button>, <Button key="i" type="primary" loading={busy} disabled={!count} onClick={commit}>
        {filter === 'create' ? `Import ${plan.summary.create} new` : filter === 'merge' ? `Apply ${plan.summary.merge} merges` : filter === 'error' ? 'Nothing to import' : `Import ${count} rows`}</Button>]
        : [<Button key="t" onClick={() => download(`/p/${page.slug}/records/template`, `${page.slug}-template.xlsx`)}>Download template</Button>, <Button key="c" onClick={close}>Close</Button>]}>
      {!plan ? (
        <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} disabled={busy} beforeUpload={(f) => { preview(f); return false; }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p><p>Drop an .xlsx file here, or click to choose one</p>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>Column headings must match this page's field labels. Rows are matched to existing records by asset tag, then MAC address, then any field marked unique.</p>
        </Upload.Dragger>
      ) : (<>
        <Alert type={plan.summary.error ? 'warning' : 'success'} showIcon style={{ marginBottom: 12 }} message={`${plan.summary.create} to create, ${plan.summary.merge} to merge, ${plan.summary.error} with errors`}
          description={plan.summary.error ? 'Rows with errors are skipped on import.' : 'Nothing has been saved yet. Review and confirm.'} />
        <Radio.Group value={filter} onChange={(e) => setFilter(e.target.value)} optionType="button" style={{ marginBottom: 12 }}
          options={[{ value: 'all', label: `All (${plan.rows.length})` }, { value: 'create', label: `Create (${plan.summary.create})` }, { value: 'merge', label: `Merge (${plan.summary.merge})` }, { value: 'error', label: `Errors (${plan.summary.error})` }]} />
        <Table size="small" rowKey="row" dataSource={rows} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 'max-content' }}
          columns={[{ title: 'Row', dataIndex: 'row', width: 60 }, { title: 'Action', dataIndex: 'action', width: 90, render: (a) => <Tag color={COLOR[a]}>{a}</Tag> },
            { title: 'Name', render: (_, r) => r.preview?.name ?? '-' }, { title: 'IP', render: (_, r) => r.preview?.ip ?? '-' }, { title: 'MAC', render: (_, r) => <span className="mono">{r.preview?.mac ?? '-'}</span> },
            { title: 'Details', render: (_, r) => r.action === 'error' ? <span style={{ color: '#cf1322' }}>{r.errors.join('; ')}</span>
              : r.action === 'merge' ? (r.changes.length ? <Tooltip title={r.changes.map((c) => `${labels[c.field] || c.field}: ${c.from ?? '-'} -> ${c.to ?? '-'}`).join('\n')} overlayStyle={{ whiteSpace: 'pre-line' }}><span>{r.changes.length} field(s) change</span></Tooltip> : 'No changes') : 'New record' }]} />
      </>)}
    </Modal>
  );
}
