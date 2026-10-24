import { useEffect, useState } from 'react';
import { Tag } from 'antd';
import dayjs from 'dayjs';
import api from '../../api/client';
import CrudTable from '../../components/CrudTable';
import PageHeader from '../../components/PageHeader';

export default function Users() {
  const [roles, setRoles] = useState([]);
  useEffect(() => { api.get('/roles').catch(() => ({ data: { roles: [] } })).then((r) => setRoles(r.data.roles)); }, []);
  return (
    <div className="page">
      <PageHeader title="Users" sub="Accounts and their roles. Use User Page Control to override access for one person." />
      <CrudTable path="/users" createLabel="Add user" fields={[
        { name: 'email', label: 'Email', required: true }, { name: 'full_name', label: 'Full name' },
        { name: 'role', label: 'Role', type: 'select', required: true, default: 'viewer', options: roles.map((r) => ({ value: r.name, label: r.label || r.name })) },
        { name: 'password', label: 'Password', type: 'password', required: true, help: 'At least 8 characters with upper-case, lower-case and a number. Leave blank when editing to keep the current one.' },
        { name: 'is_active', label: 'Active', type: 'bool', default: true }]}
        columns={[{ title: 'Email', dataIndex: 'email' }, { title: 'Name', dataIndex: 'full_name' }, { title: 'Role', dataIndex: 'role', render: (v) => <Tag>{v}</Tag> },
          { title: 'Active', dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Disabled</Tag>) }, { title: 'Last sign-in', dataIndex: 'last_login_at', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : 'Never') }]} />
    </div>
  );
}
