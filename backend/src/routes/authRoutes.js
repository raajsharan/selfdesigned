const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const c = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');

const limiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait and try again.' } });

router.post('/login', limiter(Number(process.env.RATE_LIMIT_LOGIN) || 20), body('email').isEmail(), body('password').isString().notEmpty().isLength({ max: 200 }), validate, asyncHandler(c.login));
router.get('/me', authenticate, asyncHandler(c.me));
router.post('/me/change-password', authenticate, limiter(5),
  body('current_password').isString().notEmpty(), body('new_password').isString().isLength({ min: 8, max: 200 }), validate, asyncHandler(c.changePassword));
module.exports = router;
