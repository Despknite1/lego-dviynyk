// Шифрування особистих даних (email, телефон). Ключі беруться ТІЛЬКИ зі змінних середовища.
// Field-level encryption for PII (AES-256-GCM) + keyed blind index (HMAC-SHA256) for lookups.
const crypto = require('crypto');
function key(name) { const v = process.env[name]; if (!v) return null; const b = Buffer.from(v, /^[0-9a-f]{64}$/i.test(v) ? 'hex' : 'base64'); if (b.length !== 32) throw new Error(name + ' must be 32 bytes (hex or base64)'); return b; }
const ENC = () => key('PII_ENC_KEY'), IDX = () => key('PII_INDEX_KEY');
function enabled() { try { return !!(ENC() && IDX()); } catch { return false; } }
function encrypt(plain) { if (plain == null || plain === '') return null; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', ENC(), iv); const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]); return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); }
function decrypt(blob) { if (!blob) return null; const b = Buffer.from(String(blob).slice(3), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', ENC(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
const norm = (s) => String(s || '').trim().toLowerCase();
function index(value, kind = 'email') { if (!value) return null; return crypto.createHmac('sha256', IDX()).update(kind + ':' + norm(value)).digest('hex'); }
// hashed secrets (session tokens, reset codes): HMAC with the index key so a DB leak alone can't brute-force 6-digit codes
function secretHash(s) { return crypto.createHmac('sha256', IDX()).update('secret:' + s).digest('hex'); }
module.exports = { enabled, encrypt, decrypt, index, secretHash, norm };
