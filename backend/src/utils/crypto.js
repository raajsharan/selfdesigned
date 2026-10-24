const crypto = require('crypto');

// AES-256-GCM. Stored format: v1:<base64(iv[12] | tag[16] | ciphertext)>
function getKey() {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (generate with: openssl rand -hex 32)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decrypt(stored) {
  if (!stored) return null;
  if (!stored.startsWith('v1:')) throw new Error('Unsupported ciphertext format');
  const buf = Buffer.from(stored.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, assertKey: getKey };
