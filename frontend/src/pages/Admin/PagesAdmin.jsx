import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Form, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import api, { errMsg } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { Draggable, DropZone, move } from '../../components/dnd';
import { PAGE_ICONS, iconFor } from '../../components/pageIcons';
import { usePages } from '../../context/PagesContext';

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 48);

export default function PagesAdmin() {
  const { message } = App.useApp(); const nav = useNavigate(); const { reload } = usePages();
  const [pages, setPages] = useState(null); const [create, setCreate] = useState(false); const [dup, setDup] = useState(null); const [del, setDel] = useState(null); const [confirm, setConfirm] = useState('');
  const [form] = Form.useForm(); const [dform] = Form.useForm(); const [slugTouched, setSlugTouched] = useState(false);

  const load = useCallback(() => api.get('/pages?all=1').then((r) => setPages(r.data)).catch((e) => message.error(errMsg(e))), [message]);
  useEffect(() => { load(); }, [load]);

  const submitCreate = async () => {
    const v = await form.validateFields();
    try {
      const r = await api.post('/pages', { ...v, config: v.kind === 'view' ? { sources: [], columns: [] } : { fields: [], form: { sections: [] }, table: { columns: [] } } });
      message.success('Page created. Now design it.'); setCreate(false); reload(); nav(`/admin/pages/${r.data.slug}`);
    } catch (e) { message.error(errMsg(e)); }
  };
  const submitDup = async () => {
    const v = await dform.validateFields();
    try { await api.post(`/pages/${dup.id}/duplicate`, v); message.success('Layout copied (records are not copied)'); setDup(null); load(); reload(); } catch (e) { message.error(errMsg(e)); }
  };
  const submitDel = async () => {
    try { const r = await api.delete(`/pages/${del.id}`, { params: { confirm } }); message.success(`Page deleted${r.data.records_deleted ? ` along with ${r.data.records_deleted} record(s)` : ''}`); setDel(null); setConfirm(''); load(); reload(); }
    catch (e) { message.error(errMsg(e)); }
  };
  const reorder = async (from, to) => {
    const next = move(pages, from, to > from ? to - 1 : to); setPages(next);
    try { await api.put('/pages/order', { ids: next.map((p) => p.id) }); reload(); } catch (e) { message.error(errMsg(e)); load(); }
  };

  return (
    <div className="page">
      <PageHeader title="Page Designer" sub="Nothing is built in: every page in the menu is one you design here. Drag to change the menu order."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ kind: 'records', icon: 'database' }); setSlugTouched(false); setCreate(true); }}>New page</Button>} />
      {pages && !pages.length && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="No pages yet" description={<>Create a <b>records page</b> to hold your own data (servers, laptops, licences, anything), choose its fields, and arrange its form and table. Then create an <b>"All records" view</b> to combine whichever pages you like into one table.</>} />}
      <div style={{ maxWidth: 820 }}>
        {(pages || []).map((p, i) => { const Icon = iconFor(p.icon); return (
          <div key={p.id}>
            <DropZone accept={(d) => d.kind === 'page'} onDrop={(d) => reorder(d.index, i)} style={{ height: 6 }} />
            <Draggable payload={{ kind: 'page', index: i }} className="canvas-item" style={{ padding: '10px 12px', background: '#fff' }}>
              <Icon style={{ fontSize: 16 }} />
              <div style={{ flex: 1, minWidth: 0 }}><b>{p.title}</b> <span className="mono" style={{ color: '#7a8a8e' }}>/p/{p.slug}</span><div style={{ color: '#5d6b6e', fontSize: 12 }}>{p.description || (p.kind === 'view' ? 'Combines the records of other pages' : 'Holds its own records')}</div></div>
              <Tag color={p.kind === 'view' ? 'purple' : 'blue'}>{p.kind === 'view' ? 'view' : 'records'}</Tag>
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => nav(`/admin/pages/${p.slug}`)}>Design</Button>
                <Button size="small" icon={<CopyOutlined />} aria-label="Duplicate layout" onClick={() => { dform.resetFields(); dform.setFieldsValue({ title: `${p.title} copy`, slug: slugify(`${p.slug}-copy`) }); setDup(p); }} />
                <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete page" onClick={() => { setConfirm(''); setDel(p); }} />
              </Space>
            </Draggable>
          </div>); })}
        {pages?.length > 0 && <DropZone accept={(d) => d.kind === 'page'} onDrop={(d) => reorder(d.index, pages.length)} style={{ height: 14 }} />}
      </div>

      <Modal open={create} title="New page" onCancel={() => setCreate(false)} onOk={submitCreate} okText="Create and design" destroyOnClose>
        <Form form={form} layout="vertical" onValuesChange={(c, all) => { if ('title' in c && !slugTouched) form.setFieldValue('slug', slugify(all.title || '')); }}>
          <Form.Item name="kind" label="What kind of page?">
            <Radio.Group style={{ display: 'grid', gap: 8 }}>
              <Radio value="records"><b>Records page</b>: holds its own data. You choose the fields and design the form and the table.</Radio>
              <Radio value="view"><b>View page</b>: one table that pulls rows from the pages you choose (for example "All records").</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Give the page a title' }]}><Input maxLength={96} autoFocus /></Form.Item>
          <Form.Item name="slug" label="Address" extra="Used in the URL and for permissions. Cannot be changed later." rules={[{ required: true }, { pattern: /^[a-z][a-z0-9-]{1,47}$/, message: 'Lower-case letters, digits and hyphens, starting with a letter' }]}>
            <Input addonBefore="/p/" onChange={() => setSlugTouched(true)} /></Form.Item>
          <Form.Item name="icon" label="Icon"><Select options={Object.keys(PAGE_ICONS).map((k) => { const I = PAGE_ICONS[k]; return { value: k, label: <span><I /> {k}</span> }; })} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={!!dup} title={`Copy layout of "${dup?.title}"`} onCancel={() => setDup(null)} onOk={submitDup} okText="Copy" destroyOnClose>
        <Form form={dform} layout="vertical"><Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="slug" label="Address" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9-]{1,47}$/, message: 'Lower-case letters, digits and hyphens' }]}><Input addonBefore="/p/" /></Form.Item></Form>
      </Modal>
      <Modal open={!!del} title={`Delete "${del?.title}"?`} onCancel={() => setDel(null)} onOk={submitDel} okText="Delete page" okButtonProps={{ danger: true, disabled: confirm !== del?.slug }} destroyOnClose>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="This permanently deletes the page and every record on it." description="The decommission log is kept. Pages used by a view must be removed from it first." />
        <p>Type <b className="mono">{del?.slug}</b> to confirm.</p><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Modal>
    </div>
  );
}
