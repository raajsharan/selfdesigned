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
    const where = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
    const hint = 'Check that the address and port are right, the server is on, and the network or firewall allows this machine to reach it.';
    req.on('timeout', () => req.destroy(new Error(`Cannot reach ${where}: no reply within ${Math.round(timeoutMs / 1000)} seconds. ${hint}`)));
    req.on('error', (e) => {
      const why = { ECONNREFUSED: 'the connection was refused (nothing is listening on that port)', ENOTFOUND: 'the host name could not be resolved', EAI_AGAIN: 'the host name could not be resolved',
        EHOSTUNREACH: 'there is no route to the host', ENETUNREACH: 'there is no route to the network', ECONNRESET: 'the connection was closed by the server', ETIMEDOUT: 'the connection timed out' }[e.code];
      reject(why ? new Error(`Cannot reach ${where}: ${why}. ${hint}`) : e);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJson };
