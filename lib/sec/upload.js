// Image upload hardening: magic-byte allowlist (jpeg/png/webp), size cap, re-encode with sharp (strips EXIF/metadata, kills polyglot tails).
const sharp = require('sharp'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const MAX_BYTES = +(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024);
function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
class UploadError extends Error { constructor(m) { super(m); this.status = 415; } }
async function sanitize(b64) {
  if (typeof b64 !== 'string') throw new UploadError('Немає зображення');
  const s = b64.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 4096))) throw new UploadError('Некоректне кодування');
  const buf = Buffer.from(s, 'base64');
  if (!buf.length || buf.length > MAX_BYTES) throw new UploadError('Файл завеликий (макс. ' + Math.round(MAX_BYTES / 1048576) + ' МБ)');
  const kind = sniff(buf); if (!kind) throw new UploadError('Дозволені лише JPEG, PNG або WebP');
  const head = buf.toString('latin1', 0, Math.min(buf.length, 2048)).toLowerCase();
  if (/<svg|<\?xml|<script|<html|<\?php|%pdf/.test(head)) throw new UploadError('Файл схожий на поліглот — відхилено');
  const img = sharp(buf, { limitInputPixels: 40e6, failOn: 'error' });
  const meta = await img.metadata(); if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.format !== kind) throw new UploadError('Тип файлу не збігається з вмістом');
  const out = await img.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(); // metadata not copied (no withMetadata)
  return { b64: out.toString('base64'), mime: 'image/jpeg', bytes: out.length };
}
// optional persistent storage: random uuid name, outside any static/served dir, non-executable perms
function store(buf) { const dir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const f = path.join(dir, crypto.randomUUID() + '.jpg'); fs.writeFileSync(f, buf, { mode: 0o600 }); return f; }
// express middleware for JSON bodies carrying base64 image fields
function middleware(fields = ['image', 'crop']) { return async (req, res, next) => { try { for (const k of fields) if (req.body && req.body[k] != null) { const r = await sanitize(req.body[k]); req.body[k] = r.b64; if (k === 'image') req.body.mime = r.mime; } next(); } catch (e) { res.status(e.status || 400).json({ error: e.status ? e.message : 'Некоректне зображення' }); } }; }
module.exports = { sanitize, sniff, store, middleware, UploadError };
