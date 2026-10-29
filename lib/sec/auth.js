// Акаунти користувачів (реєстрація, вхід, скидання пароля). Вмикається змінною ACCOUNTS_ENABLED.
// Accounts: register / login / logout / me / contacts / password reset. Feature-flagged: ACCOUNTS_ENABLED=true + PII keys.
const express = require('express'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const log = require('./log'), pii = require('./pii'), { init } = require('./db'), mail = require('./mailer'), { hit, limit } = require('./ratelimit');
const BCRYPT_COST = 12, SESSION_DAYS = 14, LOCK_AFTER = 5, LOCK_MS = 15 * 60e3, CODE_TTL = 10 * 60e3, CODE_TRIES = 5;
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = PROD ? '__Host-sid' : 'sid', CSRF_COOKIE = PROD ? '__Host-csrf' : 'csrf';
const enabled = () => process.env.ACCOUNTS_ENABLED === 'true' && pii.enabled() && (!!process.env.DATABASE_URL || process.env.ALLOW_SQLITE === 'true' || !PROD);
const EMAIL_RE = /^[^\s@<>()"',;:\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const vEmail = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim());
const vPass = p => typeof p === 'string' && p.length >= 10 && p.length <= 128 && /[a-zA-Zа-яА-ЯіїєґІЇЄҐ]/.test(p) && /\d/.test(p);
const vPhone = p => typeof p === 'string' && /^\+[1-9]\d{7,14}$/.test(p.replace(/[\s()-]/g, ''));
const DUMMY = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);
const cookieOpts = (maxAge) => ({ httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge });
const evt = (req, e, extra = {}) => log.info({ evt: 'auth.' + e, reqId: req.id, ...extra });

function router() {
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));
  r.use((req, res, next) => enabled() ? next() : res.status(503).json({ error: 'Акаунти поки вимкнені', disabled: true }));
  // CSRF: double-submit cookie + header, plus Origin check on unsafe methods
  r.get('/csrf', (req, res) => { const t = crypto.randomBytes(24).toString('base64url'); res.cookie(CSRF_COOKIE, t, { ...cookieOpts(2 * 3600e3), httpOnly: false }); res.json({ csrf: t }); });
  r.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const o = req.get('origin'); const host = req.get('host');
    if (o && (() => { try { return new URL(o).host !== host; } catch { return true; } })()) return res.status(403).json({ error: 'Bad origin' });
    const c = req.cookies?.[CSRF_COOKIE], h = req.get('x-csrf-token');
    if (!c || !h || c.length !== h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) return res.status(403).json({ error: 'CSRF' });
    next();
  });
  const db = async () => init();
  async function session(req) { const t = req.cookies?.[COOKIE]; if (!t || t.length > 100) return null; const d = await db(); const s = (await d.q('SELECT user_id, expires FROM sessions WHERE token_hash=$1', [pii.secretHash(t)]))[0]; if (!s || +s.expires < Date.now()) return null; return { userId: s.user_id, tokenHash: pii.secretHash(t) }; }
  async function newSession(res, userId) { const t = crypto.randomBytes(32).toString('base64url'); const d = await db(); await d.q('INSERT INTO sessions(token_hash,user_id,expires,created_at) VALUES($1,$2,$3,$4)', [pii.secretHash(t), userId, Date.now() + SESSION_DAYS * 864e5, Date.now()]); res.cookie(COOKIE, t, cookieOpts(SESSION_DAYS * 864e5)); }
  const wrap = fn => (req, res) => fn(req, res).catch(e => { log.error({ evt: 'auth.error', reqId: req.id, err: e.message }); res.status(500).json({ error: 'Помилка сервера' }); });

  r.post('/register', limit('reg', 5, 3600e3), wrap(async (req, res) => {
    const { email, password, backup_email, phone } = req.body || {};
    if (!vEmail(email)) return res.status(400).json({ error: 'Некоректний email' });
    if (!vPass(password)) return res.status(400).json({ error: 'Пароль: 10–128 символів, літери й цифри' });
    if (backup_email && (!vEmail(backup_email) || pii.norm(backup_email) === pii.norm(email))) return res.status(400).json({ error: 'Некоректний запасний email' });
    if (phone && !vPhone(phone)) return res.status(400).json({ error: 'Телефон у форматі +380…' });
    const d = await db(); const idx = pii.index(email);
    if ((await d.q('SELECT id FROM users WHERE email_idx=$1', [idx])).length) { evt(req, 'register_dup'); return res.status(409).json({ error: 'Акаунт уже існує' }); }
    const id = crypto.randomUUID(), hash = await bcrypt.hash(password, BCRYPT_COST), ph = phone ? phone.replace(/[\s()-]/g, '') : null;
    await d.q('INSERT INTO users(id,email_enc,email_idx,backup_email_enc,backup_email_idx,phone_enc,phone_idx,pw_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, pii.encrypt(pii.norm(email)), idx, backup_email ? pii.encrypt(pii.norm(backup_email)) : null, backup_email ? pii.index(backup_email) : null, ph ? pii.encrypt(ph) : null, ph ? pii.index(ph, 'phone') : null, hash, Date.now()]);
    await newSession(res, id); evt(req, 'register', { uid: id }); res.status(201).json({ ok: true });
  }));

  r.post('/login', limit('login-ip', 20, 15 * 60e3), wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!vEmail(email) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Невірний email або пароль' });
    const idx = pii.index(email); if (!hit('login-acct:' + idx, 10, 15 * 60e3)) return res.status(429).json({ error: 'Забагато спроб. Спробуйте пізніше.' });
    const d = await db(); const u = (await d.q('SELECT id,pw_hash,failed_logins,locked_until FROM users WHERE email_idx=$1', [idx]))[0];
    if (!u) { await bcrypt.compare(password, DUMMY); evt(req, 'login_fail', { reason: 'nouser' }); return res.status(401).json({ error: 'Невірний email або пароль' }); }
    if (+u.locked_until > Date.now()) { evt(req, 'login_locked', { uid: u.id }); return res.status(423).json({ error: 'Акаунт тимчасово заблоковано. Спробуйте через 15 хв або скиньте пароль.' }); }
    if (!(await bcrypt.compare(password, u.pw_hash))) { const n = +u.failed_logins + 1; await d.q('UPDATE users SET failed_logins=$1, locked_until=$2 WHERE id=$3', [n >= LOCK_AFTER ? 0 : n, n >= LOCK_AFTER ? Date.now() + LOCK_MS : 0, u.id]); evt(req, n >= LOCK_AFTER ? 'lockout' : 'login_fail', { uid: u.id }); return res.status(401).json({ error: 'Невірний email або пароль' }); }
    await d.q('UPDATE users SET failed_logins=0, locked_until=0 WHERE id=$1', [u.id]); await newSession(res, u.id); evt(req, 'login', { uid: u.id }); res.json({ ok: true });
  }));

  r.post('/logout', wrap(async (req, res) => { const s = await session(req); if (s) { await (await db()).q('DELETE FROM sessions WHERE token_hash=$1', [s.tokenHash]); evt(req, 'logout', { uid: s.userId }); } res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); }));

  const mask = e => e ? e.replace(/^(.).*?(@.*)$/, '$1***$2') : null;
  r.get('/me', wrap(async (req, res) => { const s = await session(req); if (!s) return res.status(401).json({ user: null }); const u = (await (await db()).q('SELECT email_enc,backup_email_enc,phone_enc FROM users WHERE id=$1', [s.userId]))[0]; if (!u) return res.status(401).json({ user: null });
    const ph = pii.decrypt(u.phone_enc); res.json({ user: { email: pii.decrypt(u.email_enc), backup_email: mask(pii.decrypt(u.backup_email_enc)), phone: ph ? ph.slice(0, 4) + '***' + ph.slice(-2) : null } }); }));

  r.post('/contacts', limit('contacts', 10, 3600e3), wrap(async (req, res) => { const s = await session(req); if (!s) return res.status(401).json({ error: 'Потрібен вхід' });
    const { password, backup_email, phone } = req.body || {}; const d = await db(); const u = (await d.q('SELECT pw_hash FROM users WHERE id=$1', [s.userId]))[0];
    if (!u || typeof password !== 'string' || !(await bcrypt.compare(password, u.pw_hash))) return res.status(401).json({ error: 'Невірний пароль' });
    if (backup_email && !vEmail(backup_email)) return res.status(400).json({ error: 'Некоректний email' }); if (phone && !vPhone(phone)) return res.status(400).json({ error: 'Некоректний телефон' });
    const ph = phone ? phone.replace(/[\s()-]/g, '') : null;
    await d.q('UPDATE users SET backup_email_enc=$1, backup_email_idx=$2, phone_enc=$3, phone_idx=$4 WHERE id=$5', [backup_email ? pii.encrypt(pii.norm(backup_email)) : null, backup_email ? pii.index(backup_email) : null, ph ? pii.encrypt(ph) : null, ph ? pii.index(ph, 'phone') : null, s.userId]);
    evt(req, 'contacts_changed', { uid: s.userId }); res.json({ ok: true }); }));

  // password reset: always the same response (no account enumeration)
  const GENERIC = { ok: true, message: 'Якщо акаунт існує, код надіслано.' };
  r.post('/reset/request', limit('reset-ip', 5, 3600e3), wrap(async (req, res) => {
    const { email, channel = 'primary' } = req.body || {};
    if (!vEmail(email) || !['primary', 'backup', 'sms'].includes(channel)) return res.status(400).json({ error: 'Некоректні дані' });
    const idx = pii.index(email); if (!hit('reset-acct:' + idx, 3, 3600e3)) return res.json(GENERIC);
    const d = await db(); const u = (await d.q('SELECT id,email_enc,backup_email_enc,phone_enc FROM users WHERE email_idx=$1', [idx]))[0];
    if (!u) { evt(req, 'reset_request', { found: false }); return res.json(GENERIC); }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await d.q('UPDATE reset_codes SET used=1 WHERE user_id=$1 AND used=0', [u.id]);
    await d.q('INSERT INTO reset_codes(id,user_id,code_hash,channel,expires,created_at) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), u.id, pii.secretHash(u.id + ':' + code), channel, Date.now() + CODE_TTL, Date.now()]);
    const text = `Код для скидання пароля LEGO-Двійник: ${code}\nДіє 10 хвилин. Якщо це були не ви — просто проігноруйте лист.`;
    try {
      if (channel === 'sms') { const ph = pii.decrypt(u.phone_enc); if (ph) await mail.sendSms(ph, text); }
      else { const to = pii.decrypt(channel === 'backup' ? u.backup_email_enc : u.email_enc); if (to) await mail.sendEmail(to, 'Код для скидання пароля', text); }
      evt(req, 'reset_sent', { uid: u.id, channel });
    } catch (e) { log.warn({ evt: 'auth.reset_send_fail', reqId: req.id, channel, err: e.message }); }
    res.json(GENERIC);
  }));

  r.post('/reset/confirm', limit('reset-confirm-ip', 10, 3600e3), wrap(async (req, res) => {
    const { email, code, new_password } = req.body || {};
    if (!vEmail(email) || !/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: 'Невірний або прострочений код' });
    if (!vPass(new_password)) return res.status(400).json({ error: 'Пароль: 10–128 символів, літери й цифри' });
    const d = await db(); const u = (await d.q('SELECT id FROM users WHERE email_idx=$1', [pii.index(email)]))[0];
    const rc = u && (await d.q('SELECT id,code_hash,expires,attempts FROM reset_codes WHERE user_id=$1 AND used=0 ORDER BY created_at DESC LIMIT 1', [u.id]))[0];
    if (!rc || +rc.expires < Date.now() || +rc.attempts >= CODE_TRIES) { evt(req, 'reset_fail', { reason: 'nocode' }); return res.status(400).json({ error: 'Невірний або прострочений код' }); }
    const ok = crypto.timingSafeEqual(Buffer.from(rc.code_hash, 'hex'), Buffer.from(pii.secretHash(u.id + ':' + code), 'hex'));
    if (!ok) { await d.q('UPDATE reset_codes SET attempts=attempts+1, used=CASE WHEN attempts+1>=$2 THEN 1 ELSE 0 END WHERE id=$1', [rc.id, CODE_TRIES]); evt(req, 'reset_fail', { uid: u.id, reason: 'badcode' }); return res.status(400).json({ error: 'Невірний або прострочений код' }); }
    await d.q('UPDATE reset_codes SET used=1 WHERE id=$1', [rc.id]);
    await d.q('UPDATE users SET pw_hash=$1, failed_logins=0, locked_until=0 WHERE id=$2', [await bcrypt.hash(new_password, BCRYPT_COST), u.id]);
    await d.q('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    evt(req, 'reset_done', { uid: u.id }); res.json({ ok: true });
  }));
  return r;
}
module.exports = { router, enabled };
