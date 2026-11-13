// Rate limits. Buckets are per signed-in user (a hash of the token) and per IP when there is no token, so people behind one
// proxy or NAT address do not share a bucket.
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const keyOf = (req) => {
  const h = req.headers.authorization;
  return h ? `u:${crypto.createHash('sha256').update(h).digest('hex').slice(0, 24)}` : `ip:${req.ip}`;
};
const make = (windowMs, max, message) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, keyGenerator: keyOf,
  message: { error: message } });

/** Whole API: generous, a safety net against floods and runaway scripts. */
const api = make(60 * 1000, Number(process.env.RATE_LIMIT_API) || 600, 'Too many requests. Please slow down.');
/** Expensive or sensitive actions (backup, revealing a password, starting jobs). */
const strict = make(15 * 60 * 1000, Number(process.env.RATE_LIMIT_STRICT) || 60, 'Too many attempts. Please wait and try again.');
module.exports = { api, strict };
