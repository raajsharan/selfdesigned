const express = require('express');
const { body, param, query } = require('express-validator');
const pages = require('../controllers/pageController');
const records = require('../controllers/recordController');
const { authenticate, authorize, requirePageAccess, requirePasswordAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploader } = require('../utils/upload');
const h = require('../utils/asyncHandler');

const upload = uploader(['xlsx'], 10);
const id = param('id').isInt({ min: 1 });
const rid = param('id').isInt({ min: 1 });
const adminPages = [requirePageAccess('admin-pages')];

/** /api/pages : designing pages */
const designer = express.Router();
designer.use(authenticate);
designer.get('/', h(pages.list));
designer.get('/meta', ...adminPages, h(pages.meta));
designer.put('/order', ...adminPages, body('ids').isArray({ min: 1, max: 500 }), body('ids.*').isInt({ min: 1 }), validate, h(pages.reorder));
designer.post('/', ...adminPages, body('slug').isString(), body('title').isString(), validate, h(pages.create));
designer.post('/:id/duplicate', ...adminPages, id, body('slug').isString(), body('title').isString(), validate, h(pages.duplicate));
designer.put('/:id', ...adminPages, id, validate, h(pages.update));
designer.delete('/:id', ...adminPages, authorize('superadmin', 'admin'), id, query('confirm').isString(), validate, h(pages.remove));
designer.get('/:slug', h(pages.get));

/** /api/p/:slug : the records of one designed page (or the rows of a "view" page) */
const data = express.Router({ mergeParams: true });
data.use(authenticate, h(pages.loadPage));
const kind = pages.byKind;
data.get('/records', query('page').optional().isInt({ min: 1 }), query('pageSize').optional().isInt({ min: 1, max: 200 }), validate, kind({ records: h(records.list), view: h(records.viewList) }));
data.get('/records/export', kind({ records: h(records.exportCsv), view: h(records.viewExport) }));
data.get('/records/template', kind({ records: h(records.templateXlsx) }));
data.get('/filter-options', kind({ records: h(records.filterOptions), view: h(records.viewFilterOptions) }));
data.post('/records/import', upload.single('file'), h(records.importXlsx));   // view pages are rejected earlier: they are read-only
data.post('/records/bulk', body('ids').isArray({ min: 1, max: 1000 }), body('ids.*').isInt({ min: 1 }), body('action').isIn(['status', 'delete', 'assign_tags']), validate, kind({ records: h(records.bulk) }));
data.post('/records', body('data').isObject(), validate, kind({ records: h(records.create) }));
data.get('/records/:id', rid, validate, kind({ records: h(records.getOne) }));
data.put('/records/:id', rid, body('data').isObject(), validate, kind({ records: h(records.update) }));
data.delete('/records/:id', rid, validate, kind({ records: h(records.remove) }));
data.post('/records/:id/decommission', rid, body('reason').optional().isString().isLength({ max: 1000 }), validate, kind({ records: h(records.decommission) }));
data.get('/records/:id/secrets/:key', rid, param('key').matches(/^[a-z][a-z0-9_]{0,40}$/), validate, requirePasswordAccess, kind({ records: h(records.revealSecret) }));

module.exports = { designer, data };
