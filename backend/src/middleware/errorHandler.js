const prod = () => process.env.NODE_ENV === 'production';

module.exports = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.code === '23505') return res.status(409).json({ error: 'A record with the same unique value already exists' });
  if (err.code === '23503') return res.status(409).json({ error: 'Record is referenced by other data' });
  if (err.code === '23502') return res.status(400).json({ error: 'A required field is missing' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Invalid value supplied' });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error', ...(prod() ? {} : { detail: err.message }) });
};
