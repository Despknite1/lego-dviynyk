// Анонімна ідентифікація відвідувача для «Мої фігурки» (захищене cookie) та захист від CSRF-атак.
// Anonymous browser identity: random 256-bit secret in an httpOnly cookie; the server only ever sees/stores sha256 of it (owner_hash).
// No personal data. Later the same owner_hash can be linked to an account (identities.user_id).
const crypto = require('crypto');
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = PROD ? '__Host-anon' : 'anon', CSRF_COOKIE = PROD ? '__Host-mycsrf' : 'mycsrf';
const opts = (maxAge, httpOnly = true) => ({ httpOnly, secure: PROD, sameSite: 'lax', path: '/', maxAge });
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hashOf = t => crypto.createHash('sha256').update('anon:v1:' + t).digest('hex');
// returns owner hash; creates the cookie when `create` and none exists
function owner(req, res, create) {
  let t = req.cookies && req.cookies[COOKIE];
  if (!t || !TOKEN_RE.test(t)) { if (!create) return null; t = crypto.randomBytes(32).toString('base64url'); res.cookie(COOKIE, t, opts(365 * 864e5)); if (req.cookies) req.cookies[COOKIE] = t; }
  return hashOf(t);
}
// CSRF: double-submit cookie + header + Origin check (same scheme as lib/sec/auth.js)
function issueCsrf(req, res) { const t = crypto.randomBytes(24).toString('base64url'); res.cookie(CSRF_COOKIE, t, opts(2 * 3600e3, false)); return t; }
function checkCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.get('origin'), host = req.get('host');
  if (o && (() => { try { return new URL(o).host !== host; } catch { return true; } })()) return res.status(403).json({ error: 'Bad origin' });
  const c = req.cookies && req.cookies[CSRF_COOKIE], h = req.get('x-csrf-token');
  if (!c || !h || c.length !== h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) return res.status(403).json({ error: 'CSRF' });
  next();
}
module.exports = { owner, hashOf, issueCsrf, checkCsrf, COOKIE };
