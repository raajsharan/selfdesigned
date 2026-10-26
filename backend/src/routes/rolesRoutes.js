const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/rolesController');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const h = require('../utils/asyncHandler');

router.use(authenticate, requirePageAccess('admin-roles'));
const rules = [body('pages').isArray(), body('can_write').optional().isBoolean(), body('description').optional().isString().isLength({ max: 500 })];
router.get('/', h(c.list));
router.post('/', body('name').matches(/^[a-z0-9_]{2,32}$/).withMessage('Use 2-32 lower-case letters, digits or underscores'), ...rules, validate, h(c.create));
router.put('/builtin/:name', ...rules, validate, h(c.updateBuiltin));
router.delete('/builtin/:name', h(c.resetBuiltin));
router.put('/:id', param('id').isInt({ min: 1 }), ...rules, validate, h(c.update));
router.delete('/:id', param('id').isInt({ min: 1 }), validate, h(c.remove));
module.exports = router;
