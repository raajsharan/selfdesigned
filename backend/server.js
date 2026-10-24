const path = require('path');
// Resolve .env next to this file, not the process cwd, so it loads however the app is launched (pm2, systemd, etc.).
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
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

const app = express();
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');

// Swagger UI needs inline scripts, so it gets its own relaxed CSP and is mounted before the global one.
app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(require('./src/config/swagger')));

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
}));

const origins = (process.env.CORS_ORIGIN || 'http://localhost:4000,http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (o, cb) => (!o || origins.includes(o) ? cb(null, true) : cb(null, false)), credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.use('/api', require('./src/routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the compiled SPA (single-port production mode).
const dist = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: isProd ? '1h' : 0 }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 4000;
(async () => {
  await ensureSchema();
  await ensureSuperadmin();
  require('./src/services/vmwareSchedulerService').start();
  require('./src/services/proxmoxSchedulerService').start();
  require('./src/services/backupService').startScheduler();
  const server = app.listen(PORT, () => console.log(`[server] listening on :${PORT} (${isProd ? 'production' : 'development'})`));
  const stop = () => { server.close(() => db.pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error('[startup] failed:', e); process.exit(1); });
