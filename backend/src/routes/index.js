const express = require('express');
const { body, param, query } = require('express-validator');
const db = require('../config/db');
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploader } = require('../utils/upload');
const h = require('../utils/asyncHandler');
const pageRoutes = require('./pageRoutes');
const buildDiscoveryRouter = require('./discoveryRoutes');
const lookups = require('../controllers/lookupControllers');
const life = require('../controllers/lifecycleControllers');
const rep = require('../controllers/reportControllers');
const ec = require('../controllers/endpointCentralController');
const tenable = require('../controllers/tenableController');
const nessus = require('../controllers/nessusController');
const backup = require('../controllers/backupController');

const api = express.Router();
const auth = authenticate;
const intId = param('id').isInt({ min: 1 });
const adminOnly = authorize('superadmin', 'admin');

api.get('/health', h(async (req, res) => { await db.query('SELECT 1'); res.json({ ok: true }); }));
api.get('/branding', h(lookups.getBranding));                       // public: themes the login page
api.use('/auth', require('./authRoutes'));
api.use('/users', require('./userRoutes'));
api.use('/roles', require('./rolesRoutes'));

api.use('/pages', pageRoutes.designer);          // designing pages
api.use('/p/:slug', pageRoutes.data);            // records / rows of one designed page
api.use('/vmware', buildDiscoveryRouter('vmware'));
api.use('/proxmox', buildDiscoveryRouter('proxmox'));
api.use('/migration', require('./migrationRoutes'));

// ---- lifecycle
api.get('/decommissioned', auth, requirePageAccess('decommissioned'), h(life.decommissionedList));
api.post('/decommissioned/:id/reactivate', auth, requirePageAccess('decommissioned'), intId, validate, h(life.reactivate));
api.get('/recycle-bin', auth, requirePageAccess('recycle-bin'), h(life.recycleList));
api.post('/recycle-bin/:id/restore', auth, requirePageAccess('recycle-bin'), intId, validate, h(life.recycleRestore));
api.delete('/recycle-bin/:id', auth, requirePageAccess('recycle-bin'), adminOnly, intId, validate, h(life.recyclePurge));
api.get('/search', auth, requirePageAccess('search'), query('q').isString().isLength({ min: 2, max: 100 }), validate, h(life.search));

// ---- reports
api.get('/dashboard', auth, requirePageAccess('dashboard'), h(rep.dashboard));
api.get('/reports/weekly', auth, requirePageAccess('weekly-report'), h(rep.weeklyReport));
api.get('/reports/weekly/csv', auth, requirePageAccess('weekly-report'), h(rep.weeklyReportCsv));
api.get('/data-health', auth, requirePageAccess('data-health'), h(rep.dataHealth));
api.get('/reconcile', auth, requirePageAccess('reconcile'), h(rep.reconcile));
api.get('/compliance-config', auth, h(rep.getCompliance));
api.put('/compliance-config', auth, requirePageAccess('admin-compliance'), body('report_day').optional().isInt({ min: 0, max: 6 }), validate, h(rep.putCompliance));

// ---- admin lookups
const crud = (path, page, c, rules = []) => {
  api.get(path, auth, h(c.list));           // read-only data feeds forms everywhere
  api.post(path, auth, requirePageAccess(page), ...rules, validate, h(c.create));
  api.put(`${path}/:id`, auth, requirePageAccess(page), intId, validate, h(c.update));
  api.delete(`${path}/:id`, auth, requirePageAccess(page), intId, validate, h(c.remove));
};
crud('/department-tag-ranges', 'admin-tag-ranges', lookups.tagRanges, [body('department').isString().trim().notEmpty(), body('range_start').isInt({ min: 0 }), body('range_end').isInt({ min: 0 }), body('sort_order').optional().isInt({ min: 0, max: 100000 }), body('is_active').optional().isBoolean()]);
api.get('/dropdowns', auth, h(lookups.dropdownsMap));
api.get('/dropdowns/all', auth, requirePageAccess('admin-dropdowns'), h(lookups.dropdownCrud.list));
api.post('/dropdowns', auth, requirePageAccess('admin-dropdowns'), body('category').matches(/^[a-z_]{2,64}$/), body('value').isString().trim().notEmpty().isLength({ max: 255 }), validate, h(lookups.dropdownCrud.create));
api.put('/dropdowns/:id', auth, requirePageAccess('admin-dropdowns'), intId, validate, h(lookups.dropdownCrud.update));
api.delete('/dropdowns/category/:name', auth, requirePageAccess('admin-dropdowns'), param('name').matches(/^[a-z_]{2,64}$/), validate, h(lookups.dropdownCategoryRemove));
api.delete('/dropdowns/:id', auth, requirePageAccess('admin-dropdowns'), intId, validate, h(lookups.dropdownCrud.remove));

api.put('/branding', auth, requirePageAccess('admin-branding'), body('app_name').optional().isString().isLength({ max: 64 }), validate, h(lookups.putBranding));
api.get('/teams-notification', auth, requirePageAccess('admin-teams'), h(lookups.getTeams));
api.put('/teams-notification', auth, requirePageAccess('admin-teams'), body('enabled').optional().isBoolean(), body('webhook_url').optional().isString().isLength({ max: 2000 }), validate, h(lookups.putTeams));
api.post('/teams-notification/test', auth, requirePageAccess('admin-teams'), h(lookups.testTeams));
api.get('/audit', auth, requirePageAccess('admin-audit'), h(lookups.auditList));

// ---- ManageEngine Endpoint Central
const ecPage = [auth, requirePageAccess('endpoint-central')]; const ecCfg = [auth, requirePageAccess('admin-endpoint-central')];
api.get('/endpoint-central', ...ecPage, h(ec.agents));
api.get('/endpoint-central/software', ...ecPage, h(ec.software));
api.get('/endpoint-central/config', ...ecCfg, h(ec.getConfig));
api.put('/endpoint-central/config', ...ecCfg, body('base_url').optional().isString().isLength({ max: 500 }), body('auth_mode').optional().isIn(['apikey', 'credentials']), validate, h(ec.putConfig));
api.post('/endpoint-central/test', ...ecCfg, h(ec.test));
api.post('/endpoint-central/login', ...ecCfg, h(ec.login));
api.post('/endpoint-central/login/otp', ...ecCfg, body('otp').matches(/^\d{6}$/).withMessage('Enter the 6-digit code'), validate, h(ec.otp));
api.get('/software-status', auth, requirePageAccess('software-status'), h(ec.softwareStatus));

// ---- Tenable & Nessus
const tenablePage = [auth, requirePageAccess('tenable')];
api.get('/tenable/report', ...tenablePage, h(tenable.report));
api.get('/tenable/report/csv', ...tenablePage, h(tenable.reportCsv));
api.post('/tenable/import', ...tenablePage, adminOnly, uploader(['xlsx'], 25).single('file'), h(tenable.import));
const nessusPage = [auth, requirePageAccess('nessus-status')];
api.get('/nessus-status', ...nessusPage, h(nessus.list));
api.get('/nessus-status/config', ...nessusPage, adminOnly, h(nessus.getConfig));
api.put('/nessus-status/config', ...nessusPage, adminOnly, h(nessus.putConfig));
api.put('/nessus-status/:source/:id', ...nessusPage, intId, body('installed').isBoolean(), validate, h(nessus.setStatus));
api.post('/nessus-status/:source/:id/install', ...nessusPage, adminOnly, intId, body('ssh_username').isString().trim().notEmpty(), body('ssh_password').isString().notEmpty(), body('os').optional().isIn(['linux', 'windows']), validate, h(nessus.install));

// ---- Backup & restore
const bk = [auth, requirePageAccess('admin-backup'), adminOnly];
api.get('/backup', ...bk, h(backup.tables));
api.get('/backup/csv/:table', ...bk, h(backup.csvTable));
api.post('/backup/run', ...bk, h(backup.run));
api.put('/backup/schedule', ...bk, h(backup.putSchedule));
api.post('/backup/csv/:table', ...bk, uploader(['csv'], 50).single('file'), h(backup.restoreUpload));
api.post('/backup/restore/:id', ...bk, intId, validate, h(backup.restoreHistory));

// ---- user page control is mounted under /users/page-control (see userRoutes)
module.exports = api;
