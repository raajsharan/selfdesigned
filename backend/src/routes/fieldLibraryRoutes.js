const express = require('express');
const { body, param } = require('express-validator');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const h = require('../utils/asyncHandler');
const lib = require('../controllers/fieldLibraryController');

const r = express.Router();
const manage = [authenticate, requirePageAccess('admin-field-library')];
const id = param('id').isInt({ min: 1 });
r.get('/', authenticate, h(lib.list));   // the Page Designer reads it too
r.post('/', ...manage, body('label').isString(), validate, h(lib.create));
r.put('/:id', ...manage, id, body('label').isString(), validate, h(lib.update));
r.delete('/:id', ...manage, id, validate, h(lib.remove));
module.exports = r;
