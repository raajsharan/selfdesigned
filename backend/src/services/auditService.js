const db = require('../config/db');

/** Fire-and-forget audit record. Never throws and never blocks the response. */
function audit(req, action, entity, entityId, details) {
  const u = req && req.user ? req.user : {};
  db.query(
    'INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [u.id || null, u.email || (details && details.email) || null, action, entity || null,
     entityId === undefined || entityId === null ? null : String(entityId),
     details ? JSON.stringify(details) : null, req && req.ip ? req.ip : null]
  ).catch((e) => console.error('[audit] failed:', e.message));
}
module.exports = { audit };
