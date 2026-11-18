import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Popconfirm, Table, Tag, Upload } from 'antd';
import { DeleteOutlined, FileExcelOutlined, FileTextOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { errMsg } from '../../api/client';
import PageHeader, { Stat } from '../../components/PageHeader';

const COL_LABEL = { mac: 'mac', ip: 'ip', lan: 'lan', vlan: 'vlan', data: 'data' };

/** Administration > MAC Mapping: files that map MAC addresses to IP addresses, used by the MAC lookup tab of VMware / Proxmox Discovery. */
export default function MacMapping() {
  const { message } = App.useApp();
  const [data, setData] = useState(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/mac-mapping').then((r) => setData(r.data)).catch((e) => { message.error(errMsg(e)); setData({ files: [], totals: { files: 0, entries: 0 } }); }), [message]);
  useEffect(() => { load(); }, [load]);

  const upload = async ({ file, onSuccess, onError }) => {
    setBusy(true);
    try {
      const f = new FormData(); f.append('file', file);
      const r = (await api.post('/mac-mapping/files', f)).data;
      message.success(`${r.filename}: ${r.rows.toLocaleString()} mapping(s) stored${r.skipped ? `, ${r.skipped} row(s) skipped (invalid MAC or IP)` : ''}`);
      onSuccess?.(r); load();
    } catch (e) { message.error(errMsg(e)); onError?.(e); } finally { setBusy(false); }
  };
  const remove = (id) => api.delete(`/mac-mapping/files/${id}`).then(() => { message.success('File removed'); load(); }).catch((e) => message.error(errMsg(e)));
  const clear = () => api.delete('/mac-mapping/files').then((r) => { message.success(`${r.data.deleted} file(s) removed`); load(); }).catch((e) => message.error(errMsg(e)));

  const files = data?.files || [];
  return (
    <div className="page">
      <PageHeader title="MAC Mapping" sub="MAC address to IP address files. The MAC lookup tab of VMware and Proxmox Discovery uses them to show the IP, LAN segment and VLAN of a MAC." />
      <div className="stat-grid"><Stat label="Mapping files" value={data?.totals.files ?? '-'} /><Stat label="Total mapping entries" value={data ? data.totals.entries.toLocaleString() : '-'} /></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <b>Upload MAC to IP mapping file</b>
        <Alert type="info" showIcon style={{ margin: '12px 0' }} message="Supported formats: .csv and .xlsx"
          description={<>The file must include a <code>MAC Address</code> column and an <code>IP Address</code> column. Optional columns: <code>LAN Segment</code>, <code>VLAN Group</code>, <code>Data Retrieved</code>. Column names are detected automatically. Multiple files are combined; when a MAC is in more than one file the <b>newest</b> upload wins.</>} />
        <Upload.Dragger accept=".csv,.xlsx" multiple showUploadList={false} customRequest={upload} disabled={busy}>
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">Click or drag a .csv / .xlsx file here</p>
          <p className="ant-upload-hint">Max 20 MB. Each upload is stored separately and combined during MAC lookup.</p>
        </Upload.Dragger>
      </div>

      <div className="card">
        <div className="toolbar"><b>Stored mapping files ({files.length})</b><div className="grow" />
          <Button icon={<ReloadOutlined />} onClick={load} aria-label="Refresh" />
          <Popconfirm title="Remove every mapping file?" description="All uploaded mappings are deleted. The MAC lookup will no longer show IP, LAN or VLAN data until files are uploaded again." okText="Clear all" okButtonProps={{ danger: true }} onConfirm={clear} disabled={!files.length}>
            <Button danger icon={<DeleteOutlined />} disabled={!files.length}>Clear all</Button></Popconfirm></div>
        <Table rowKey="id" size="middle" loading={!data} dataSource={files} pagination={false} locale={{ emptyText: 'No mapping files yet' }}
          columns={[
            { title: 'Filename', dataIndex: 'filename', render: (v) => <span>{/\.csv$/i.test(v) ? <FileTextOutlined style={{ color: '#52c41a' }} /> : <FileExcelOutlined style={{ color: '#52c41a' }} />} {v}</span> },
            { title: 'Uploaded', dataIndex: 'uploaded_at', render: (v, r) => <span title={r.uploaded_by_email || ''}>{dayjs(v).format('D MMM YYYY, HH:mm')}</span> },
            { title: 'Rows', dataIndex: 'row_count', align: 'right', render: (v, r) => <span>{v.toLocaleString()}{r.skipped ? <Tag style={{ marginLeft: 6 }} color="orange">{r.skipped} skipped</Tag> : null}</span> },
            { title: 'Columns detected', dataIndex: 'columns', render: (c) => Object.entries(c || {}).map(([k, v]) => <Tag key={k} color="blue">{COL_LABEL[k] || k}: {v}</Tag>) },
            { title: '', width: 56, render: (_, r) => <Popconfirm title={`Remove “${r.filename}”?`} okButtonProps={{ danger: true }} onConfirm={() => remove(r.id)}><Button type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.filename}`} /></Popconfirm> },
          ]} />
      </div>
    </div>
  );
}
