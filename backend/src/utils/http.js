// Small JSON-over-HTTPS client with optional TLS verification toggle (self-signed vCenter/PVE).
const https = require('https');
const http = require('http');

function requestJson(url, { method = 'GET', headers = {}, body, verifySsl = true, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request(
      {
        method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        rejectUnauthorized: verifySsl,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJson };
