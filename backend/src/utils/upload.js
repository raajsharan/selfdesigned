const multer = require('multer');
const path = require('path');
const { bad } = require('./httpError');

const MIME = {
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  csv:  ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/plain'],
};

/** Memory uploads with extension + MIME allow-list. `types` e.g. ['xlsx'] or ['csv']. */
function uploader(types, maxMb = 10) {
  const exts = types.map((t) => '.' + t);
  const mimes = types.flatMap((t) => MIME[t]);
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ok = exts.includes(path.extname(file.originalname).toLowerCase()) && mimes.includes(file.mimetype);
      cb(ok ? null : bad(`Only ${types.join('/').toUpperCase()} files are accepted`), ok);
    },
  });
}
module.exports = { uploader };
