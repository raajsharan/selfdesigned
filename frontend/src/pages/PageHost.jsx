import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Result, Spin } from 'antd';
import api from '../api/client';
import RecordsPage from './Records/RecordsPage';
import ViewPage from './Records/ViewPage';

/** Loads a designed page by its address and renders it with the right engine. */
export default function PageHost() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api.get(`/pages/${slug}`).then((r) => setState({ page: r.data })).catch((e) => setState({ error: e.response?.status || 500 }));
  }, [slug]);
  if (state.loading) return <div className="page"><Spin /></div>;
  if (state.error === 403) return <Result status="403" title="No access" subTitle="You do not have access to this page. Ask an administrator if you need it." />;
  if (state.error) return <Result status="404" title="Page not found" subTitle="This page does not exist or was deleted." />;
  return state.page.kind === 'view' ? <ViewPage key={slug} page={state.page} /> : <RecordsPage key={slug} page={state.page} />;
}
