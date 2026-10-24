const https = require('https');
const { getSetting, setSetting } = require('./settingsService');
const { encrypt, decrypt } = require('../utils/crypto');
const { bad } = require('../utils/httpError');

const KEY = 'teams';
const EVENTS = {
  asset_created:            'New asset registered',
  asset_updated:            'Asset updated',
  asset_decommissioned:     'Asset decommissioned',
  asset_reactivated:        'Asset reactivated',
  migration_status_changed: 'Migration status changed',
};
const DEFAULTS = { enabled: false, webhook_encrypted: null, events: Object.fromEntries(Object.keys(EVENTS).map((e) => [e, true])) };
const STYLE = { good: 'good', warning: 'warning', attention: 'attention', info: 'accent' };

/** The webhook URL is never returned to the browser - only whether one is configured. */
async function getConfig() {
  const c = await getSetting(KEY, DEFAULTS);
  return { enabled: !!c.enabled, webhook_configured: !!c.webhook_encrypted, events: { ...DEFAULTS.events, ...c.events }, event_labels: EVENTS };
}

async function saveConfig({ enabled, webhook_url, events }) {
  const current = await getSetting(KEY, DEFAULTS);
  if (webhook_url) {
    let u;
    try { u = new URL(webhook_url); } catch { throw bad('Webhook URL is not a valid URL'); }
    if (u.protocol !== 'https:') throw bad('Webhook URL must use https');
    current.webhook_encrypted = encrypt(webhook_url);
  }
  if (typeof enabled === 'boolean') current.enabled = enabled;
  if (events && typeof events === 'object') {
    current.events = { ...DEFAULTS.events, ...current.events };
    for (const k of Object.keys(EVENTS)) if (typeof events[k] === 'boolean') current.events[k] = events[k];
  }
  if (current.enabled && !current.webhook_encrypted) throw bad('Add a webhook URL before enabling notifications');
  await setSetting(KEY, current);
  return getConfig();
}

function buildCard({ title, status = 'info', facts = [] }) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4',
        body: [
          { type: 'Container', style: STYLE[status] || 'accent', bleed: true,
            items: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true }] },
          { type: 'FactSet', facts: facts.filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([t, v]) => ({ title: String(t), value: String(v) })) },
          { type: 'TextBlock', text: new Date().toISOString(), isSubtle: true, size: 'Small' },
        ],
      },
    }],
  };
}

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request(
      { method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`Teams responded ${res.statusCode}`)))); });
    req.on('timeout', () => req.destroy(new Error('Teams webhook timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/** Fire-and-forget: callers never await this and it never throws. */
function notify(event, card) {
  (async () => {
    const c = await getSetting(KEY, DEFAULTS);
    if (!c.enabled || !c.webhook_encrypted) return;
    if (c.events && c.events[event] === false) return;
    await post(decrypt(c.webhook_encrypted), buildCard(card));
  })().catch((e) => console.error(`[teams] ${event} failed:`, e.message));
}

async function sendTest() {
  const c = await getSetting(KEY, DEFAULTS);
  if (!c.webhook_encrypted) throw bad('Save a webhook URL first');
  await post(decrypt(c.webhook_encrypted),
    buildCard({ title: 'Inventory Tool - test notification', status: 'good', facts: [['Result', 'Webhook is working']] }));
}

module.exports = { getConfig, saveConfig, notify, sendTest, EVENTS };
