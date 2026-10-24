const db = require('../config/db');
const { pageKey } = require('../config/pages');
const svc = require('../services/pageService');
const records = require('./recordController');
const { audit } = require('../services/auditService');
const { bad, notFound, conflict, forbidden } = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');

/** Loads :slug, checks the user may open it (and may write for non-GET), and attaches req.page. */
exports.loadPage = asyncHandler(async (req, res, next) => {
  const page = await svc.getPageBySlug(req.params.slug);
  if (!req.user.pages.has(pageKey(page.slug))) throw forbidden('You do not have access to this page');
  if (!['GET', 'HEAD'].includes(req.method) && !req.user.canWrite) throw forbidden('Read-only access');
  if (page.kind === 'view' && !['GET', 'HEAD'].includes(req.method)) throw bad('This page is a view and cannot be edited directly');
  req.page = page;
  next();
});
/** Dispatch a handler by page kind (records pages vs "view" pages). */
exports.byKind = (map) => (req, res, next) => (map[req.page.kind] ? map[req.page.kind](req, res, next) : next(bad('That action is not available for this kind of page')));

exports.meta = (req, res) => res.json({ roles: Object.entries(svc.ROLE_LABELS).map(([key, label]) => ({ key, label })), types: svc.FIELD_TYPES, icons: svc.ICONS });

exports.list = async (req, res) => {
  const all = (await svc.listPages());
  if (req.query.all === '1') {
    if (!req.user.pages.has('admin-pages')) throw forbidden();
    return res.json(all);
  }
  res.json(all.filter((p) => req.user.pages.has(pageKey(p.slug))));
};

exports.get = async (req, res) => {
  const p = await svc.getPageBySlug(req.params.slug);
  if (!req.user.pages.has(pageKey(p.slug))) throw forbidden('You do not have access to this page');
  res.json(p);
};

exports.create = async (req, res) => {
  const id = svc.validateIdentity(req.body);
  const kind = req.body.kind === 'view' ? 'view' : 'records';
  const config = await svc.cleanConfig(kind, req.body.config || {});
  const { rows: mx } = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM inventory_pages');
  const { rows } = await db.query(
    'INSERT INTO inventory_pages (slug, title, kind, icon, description, config, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [id.slug, id.title, kind, id.icon, svc.str(req.body.description, 500) || null, JSON.stringify(config), mx[0].n, req.user.id]);
  audit(req, 'create', 'page', rows[0].id, { slug: id.slug, kind });
  res.status(201).json(rows[0]);
};

exports.update = async (req, res) => {
  const { rows: cur } = await db.query('SELECT * FROM inventory_pages WHERE id = $1', [req.params.id]);
  const page = cur[0];
  if (!page) throw notFound('Page not found');
  if (req.body.slug && req.body.slug !== page.slug) throw bad('A page address cannot be changed after it is created');
  if (req.body.kind && req.body.kind !== page.kind) throw bad('A page cannot change between records and view');
  const id = svc.validateIdentity({ slug: page.slug, title: req.body.title ?? page.title, icon: req.body.icon ?? page.icon });
  const config = req.body.config ? await svc.cleanConfig(page.kind, req.body.config, page.id) : page.config;
  const { rows } = await db.query(
    'UPDATE inventory_pages SET title = $1, icon = $2, description = $3, config = $4, updated_at = now() WHERE id = $5 RETURNING *',
    [id.title, id.icon, req.body.description !== undefined ? svc.str(req.body.description, 500) || null : page.description, JSON.stringify(config), page.id]);
  // If the role mapping changed, existing records' promoted columns must follow.
  if (page.kind === 'records') {
    const sig = (p) => JSON.stringify((p.config.fields || []).filter((f) => f.role).map((f) => [f.key, f.role]).sort());
    if (sig(page) !== sig(rows[0])) await records.rebuildPromoted(rows[0]);
  }
  audit(req, 'update', 'page', page.id, { slug: page.slug });
  res.json(rows[0]);
};

exports.reorder = async (req, res) => {
  const ids = req.body.ids.map(Number);
  await db.withTx(async (c) => { for (const [i, id] of ids.entries()) await c.query('UPDATE inventory_pages SET sort_order = $1 WHERE id = $2', [i + 1, id]); });
  audit(req, 'reorder', 'page', null);
  res.json({ ok: true });
};

exports.duplicate = async (req, res) => {
  const { rows: cur } = await db.query('SELECT * FROM inventory_pages WHERE id = $1', [req.params.id]);
  if (!cur[0]) throw notFound('Page not found');
  const id = svc.validateIdentity({ slug: req.body.slug, title: req.body.title, icon: cur[0].icon });
  const config = await svc.cleanConfig(cur[0].kind, cur[0].config);       // layout only: records are not copied
  const { rows: mx } = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM inventory_pages');
  const { rows } = await db.query('INSERT INTO inventory_pages (slug, title, kind, icon, description, config, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [id.slug, id.title, cur[0].kind, id.icon, cur[0].description, JSON.stringify(config), mx[0].n, req.user.id]);
  audit(req, 'create', 'page', rows[0].id, { slug: id.slug, duplicate_of: cur[0].slug });
  res.status(201).json(rows[0]);
};

exports.remove = async (req, res) => {
  const { rows } = await db.query('SELECT * FROM inventory_pages WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Page not found');
  if (req.query.confirm !== rows[0].slug) throw bad('Type the page address to confirm deletion');
  const n = (await db.query('SELECT COUNT(*)::int n FROM inventory_records WHERE page_id = $1', [rows[0].id])).rows[0].n;
  // A "view" that reads from this page would silently lose a source, so make the admin fix that first.
  const users = (await db.query("SELECT slug FROM inventory_pages WHERE kind = 'view' AND config->'sources' ? $1", [rows[0].slug])).rows.map((r) => r.slug);
  if (users.length) throw conflict(`Remove this page from the view(s) ${users.join(', ')} first`);
  await db.withTx(async (c) => {
    await c.query('DELETE FROM nessus_status WHERE source = $1', [rows[0].slug]);
    await c.query('DELETE FROM inventory_pages WHERE id = $1', [rows[0].id]);        // records go with it (FK cascade)
  });
  audit(req, 'delete', 'page', rows[0].id, { slug: rows[0].slug, records_deleted: n });
  res.json({ ok: true, records_deleted: n });
};
