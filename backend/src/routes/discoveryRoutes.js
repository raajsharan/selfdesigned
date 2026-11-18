const express = require('express');
const { body, param, query } = require('express-validator');
const build = require('../controllers/discoveryController');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const h = require('../utils/asyncHandler');

const id = param('id').isInt({ min: 1 });
// A plain host name or IPv4 address: no scheme, path, credentials or port in the host; never loopback / link-local (metadata) addresses.
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const blockedHost = (h) => /^(localhost|0\.0\.0\.0|127\.|169\.254\.)/i.test(h);
const hostRule = body('host').optional().isString().trim().isLength({ min: 1, max: 255 }).custom((h) => HOST_RE.test(h) && !blockedHost(h)).withMessage('Enter a host name or IP address only (no http://, port or path; not localhost or a link-local address)');

module.exports = (typeKey) => {
  const c = build(typeKey);
  const r = express.Router();
  r.use(authenticate, requirePageAccess(typeKey));

  const serverRules = [body('name').optional().isString().trim().isLength({ min: 1, max: 128 }), hostRule, body('port').optional({ nullable: true }).isInt({ min: 1, max: 65535 }),
    body('verify_ssl').optional().isBoolean(), body('enabled').optional().isBoolean()];
  r.get('/servers', h(c.servers.list));
  r.post('/servers', body('name').notEmpty(), body('host').notEmpty(), ...(typeKey === 'vmware' ? [body('username').notEmpty()] : [body('token_id').notEmpty()]), ...serverRules, validate, h(c.servers.create));
  r.put('/servers/:id', id, ...serverRules, validate, h(c.servers.update));
  r.delete('/servers/:id', id, validate, h(c.servers.remove));
  r.post('/servers/:id/test', id, validate, h(c.servers.test));

  r.post('/discover', h(c.discover));
  r.post('/discover/:serverId', param('serverId').isInt({ min: 1 }), validate, h(c.discover));
  r.get('/schedule', h(c.schedule.get));
  r.put('/schedule', body('enabled').isBoolean(), body('interval_minutes').optional().isInt({ min: 15, max: 10080 }), validate, h(c.schedule.put));

  r.get('/vms', query('page').optional().isInt({ min: 1 }), query('pageSize').optional().isInt({ min: 1, max: 500 }), validate, h(c.list));
  r.get('/vms/export', h(c.exportCsv));
  r.patch('/vms/:id', id, validate, h(c.editVm));
  r.post('/vms/:id/add-to-inventory', id, validate, h(c.addToInventory));
  r.get('/dashboard', h(c.dashboard));
  r.get('/drift', h(c.drift));
  r.get('/topology', h(c.topology));
  r.get('/snapshots', h(c.snapshots));
  r.get('/stale', h(c.stale));
  r.get('/filled', query('page').optional().isInt({ min: 1 }), query('pageSize').optional().isInt({ min: 1, max: 500 }), query('ip').optional().isIn(['missing', 'mapped', 'discovered']), validate, h(c.filled));
  r.get('/filled/csv', query('ip').optional().isIn(['missing', 'mapped', 'discovered']), validate, h(c.filledCsv));
  r.post('/filled/apply', body('server_id').optional().isInt({ min: 1 }), validate, h(c.filledApply));
  r.get('/mac-lookup', query('mac').isString().isLength({ min: 6, max: 40 }), validate, h(c.macLookup));
  return r;
};
