const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/userController');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const h = require('../utils/asyncHandler');

const id = param('id').isInt({ min: 1 });
router.use(authenticate);

// Per-user page control (declared first so "/page-control" is not read as an :id)
router.get('/page-control', requirePageAccess('admin-user-page-control'), h(c.pageControlList));
router.put('/page-control/:id', requirePageAccess('admin-user-page-control'), id,
  body('page_overrides').optional().isObject(), body('can_view_passwords').optional().isBoolean(), validate, h(c.pageControlUpdate));

router.use(requirePageAccess('admin-users'));
router.get('/', h(c.list));
router.post('/', body('email').isEmail(), body('password').isString().isLength({ min: 8, max: 200 }),
  body('role').optional().isString().isLength({ max: 64 }), body('full_name').optional().isString().isLength({ max: 255 }), validate, h(c.create));
router.put('/:id', id, body('email').not().exists(), body('role').optional().isString().isLength({ max: 64 }),
  body('is_active').optional().isBoolean(), body('password').optional().isString().isLength({ min: 8, max: 200 }), validate, h(c.update));
router.delete('/:id', id, validate, h(c.remove));
module.exports = router;
