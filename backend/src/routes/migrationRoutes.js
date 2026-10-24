const router = require('express').Router();
const { body, param, query } = require('express-validator');
const c = require('../controllers/migrationController');
const { authenticate, requirePageAccess, requirePasswordAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploader } = require('../utils/upload');
const h = require('../utils/asyncHandler');

const upload = uploader(['xlsx'], 10);
const id = param('id').isInt({ min: 1 });
const pidQ = query('project_id').isInt({ min: 1 });
// Project/tab/field *configuration* is admin territory; day-to-day tracking uses the 'migration' page.
const cfg = requirePageAccess('admin-migration-config');

router.use(authenticate);

// ---- configuration (Admin -> Migration Config)
router.get('/projects', requirePageAccess('migration'), h(c.projects));
router.post('/projects', cfg, body('name').isString().trim().isLength({ min: 1, max: 255 }), validate, h(c.createProject));
router.put('/projects/:pid', cfg, param('pid').isInt({ min: 1 }), body('tabs').optional().isArray({ max: 20 }), validate, h(c.updateProject));
router.delete('/projects/:pid', cfg, param('pid').isInt({ min: 1 }), validate, h(c.deleteProject));
router.get('/projects/:pid/custom-fields', requirePageAccess('migration'), param('pid').isInt({ min: 1 }), validate, h(c.customFields));
router.post('/projects/:pid/custom-fields', cfg, param('pid').isInt({ min: 1 }), body('key').isString(), body('type').isString(), validate, h(c.saveCustomField));
router.put('/projects/:pid/custom-fields/:fid', cfg, param('pid').isInt({ min: 1 }), param('fid').isInt({ min: 1 }), validate, h(c.saveCustomField));
router.delete('/projects/:pid/custom-fields/:fid', cfg, param('pid').isInt({ min: 1 }), param('fid').isInt({ min: 1 }), validate, h(c.deleteCustomField));
router.post('/projects/:pid/sync', cfg, param('pid').isInt({ min: 1 }), validate, h(c.sync));

// ---- tracking
const tracker = requirePageAccess('migration');
router.get('/overview', tracker, pidQ, validate, h(c.overview));
router.get('/hosts', tracker, pidQ, validate, h(c.hosts));
router.post('/hosts', tracker, body('project_id').isInt({ min: 1 }), body('host_name').isString().trim().notEmpty(), validate, h(c.createHost));
router.patch('/hosts/:id', tracker, id, pidQ, validate, h(c.patchHost));
router.delete('/hosts/:id', tracker, id, pidQ, validate, h(c.deleteHost));
router.get('/hosts/:id/idrac-password', tracker, id, validate, requirePasswordAccess, h(c.idracPassword));

for (const kind of ['bomgar-vms', 'security-vms', 'standalone-esxi', 'custom-vms']) {
  const k = c.vmsByKind(kind);
  router.get(`/${kind}`, tracker, pidQ, validate, h(k.list));
  router.patch(`/${kind}/:id`, tracker, id, pidQ, validate, h(k.patch));
}
router.post('/vms', tracker, body('project_id').isInt({ min: 1 }), body('vm_name').isString().trim().notEmpty(), body('tab_key').isString(), validate, h(c.createVm));
router.delete('/vms/:id', tracker, id, pidQ, validate, h(c.deleteVm));
router.post('/import', tracker, upload.single('file'), query('project_id').isInt({ min: 1 }), validate, h(c.import));
module.exports = router;
