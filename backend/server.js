const path = require('path');
// Resolve .env next to this file, not the process cwd, so it loads however the app is launched (pm2, systemd, etc.).
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const { assertKey } = require('./src/utils/crypto');
const ensureSchema = require('./src/bootstrap/ensureSchema');
const ensureSuperadmin = require('./src/bootstrap/ensureSuperadmin');
const errorHandler = require('./src/middleware/errorHandler');
const db = require('./src/config/db');

const isProd = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('<')) {
  console.error('JWT_SECRET must be set to at least 32 characters (openssl rand -hex 32)'); process.exit(1);
}
try { assertKey(); } catch (e) { console.error(e.message); process.exit(1); }
if (isProd) {   // refuse dummy secrets in production
  // Only obvious placeholders and near-constant strings are refused: a long real secret may contain any word (even "secret").
  const weak = (v) => new Set(String(v)).size < 8 || /^(<|change.?me|your[_-]|example|replace)/i.test(v) || /^(secret|password|jwt.?secret|changeme)$/i.test(v);
  if (weak(process.env.JWT_SECRET)) { console.error('JWT_SECRET looks like a placeholder or is too repetitive: generate one with openssl rand -hex 32'); process.exit(1); }
  if (new Set(process.env.ENCRYPTION_KEY).size < 8) { console.error('ENCRYPTION_KEY looks like a placeholder: generate one with openssl rand -hex 32'); process.exit(1); }
}

const app = express();
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');

// Swagger UI needs inline scripts, so it gets its own relaxed CSP and is mounted before the global one.
// It lists every endpoint, so it is only mounted outside production unless ENABLE_API_DOCS=1.
if (!isProd || process.env.ENABLE_API_DOCS === '1') app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(require('./src/config/swagger')));

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
}));

app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'); next(); });

const origins = (process.env.CORS_ORIGIN || 'http://localhost:4000,http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (o, cb) => (!o || origins.includes(o) ? cb(null, true) : cb(null, false)), credentials: false }));
app.use(compression());   // gzip the UI files and the JSON lists: roughly a third of the bytes
app.use(express.json({ limit: '1mb' }));

app.use('/api', require('./src/middleware/limits').api);
app.use('/api', require('./src/routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the compiled SPA (single-port production mode).
const dist = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(dist)) {
  // Files in /assets have a content hash in their name, so they can be cached for a year; index.html must always be re-checked so a new release is picked up.
  app.use(express.static(dist, { index: false, setHeaders: (res, file) => {
    if (file.split(path.sep).includes('assets')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
}
app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 4000;
(async () => {
  await ensureSchema();
  await ensureSuperadmin();
  require('./src/services/vmwareSchedulerService').start();
  require('./src/services/proxmoxSchedulerService').start();
  require('./src/services/ecGroupService').scheduler.start();
  require('./src/services/backupService').startScheduler();
  const server = app.listen(PORT, () => console.log(`[server] listening on :${PORT} (${isProd ? 'production' : 'development'})`));
  const stop = () => { server.close(() => db.pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error('[startup] failed:', e); process.exit(1); });
