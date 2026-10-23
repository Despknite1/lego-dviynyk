// node tests/security.test.js http://localhost:8799  (server started with ACCOUNTS_ENABLED=true MAIL_PROVIDER=console)
const B = process.argv[2] || 'http://localhost:8799'; const sharp = require('sharp'); let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const jar = {}; const ck = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
async function req(m, p, body, hdr = {}) { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: ck(), ...hdr }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar[k] = v; else delete jar[k]; if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) delete jar[k]; }
  let j = null; try { j = await r.json(); } catch {} return { s: r.status, j, h: r.headers, raw: r }; }
const csrf = async () => (await req('GET', '/auth/csrf')).j.csrf;
const P = async (p, b, extra) => req('POST', p, b, { 'X-CSRF-Token': await csrf(), ...extra });
(async () => {
  const h = await req('GET', '/'); ok(h.h.get('content-security-policy') && h.h.get('x-content-type-options') === 'nosniff' && !h.h.get('x-powered-by'), 'helmet headers, no x-powered-by'); ok(!!h.h.get('x-request-id'), 'request id header');
  const em = `t${Date.now()}@example.com`, pw = 'Correct horse 42';
  ok((await req('POST', '/auth/register', { email: em, password: pw })).s === 403, 'register without CSRF rejected');
  ok((await P('/auth/register', { email: em, password: pw }, { Origin: 'https://evil.example' })).s === 403, 'cross-origin rejected');
  ok((await P('/auth/register', { email: 'bad', password: pw })).s === 400, 'invalid email rejected');
  ok((await P('/auth/register', { email: em, password: 'short' })).s === 400, 'weak password rejected');
  const r = await P('/auth/register', { email: em, password: pw, backup_email: 'b' + em }); ok(r.s === 201, 'register ok');
  const sc = r.raw.headers.getSetCookie().find(c => /sid=/.test(c)) || ''; ok(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), 'session cookie httpOnly+SameSite');
  ok((await P('/auth/register', { email: em.toUpperCase(), password: pw })).s === 409, 'duplicate (case-insensitive) rejected');
  const me = await req('GET', '/auth/me'); ok(me.s === 200 && me.j.user.email === em && /\*\*\*/.test(me.j.user.backup_email), 'me returns email, masks backup');
  ok((await P('/auth/logout', {})).s === 200 && (await req('GET', '/auth/me')).s === 401, 'logout kills session');
  ok((await P('/auth/login', { email: em, password: 'wrong pass 1' })).s === 401, 'wrong password 401');
  ok((await P('/auth/login', { email: 'nouser@example.com', password: pw })).s === 401, 'unknown user same 401');
  for (let i = 0; i < 4; i++) await P('/auth/login', { email: em, password: 'wrong pass 1' });
  ok((await P('/auth/login', { email: em, password: pw })).s === 423, 'lockout after 5 failures (even with right password)');
  const rq = await P('/auth/reset/request', { email: em, channel: 'primary' }); ok(rq.s === 200 && rq.j.ok, 'reset request generic ok');
  ok((await P('/auth/reset/request', { email: 'ghost@example.com' })).j?.message === rq.j.message, 'reset: no account enumeration');
  ok((await P('/auth/reset/confirm', { email: em, code: '000000', new_password: 'New password 77' })).s === 400, 'wrong code rejected');
  const code = process.env.TEST_CODE_FILE ? require('fs').readFileSync(process.env.TEST_CODE_FILE, 'utf8').match(/: (\d{6})\n/g)?.pop().match(/\d{6}/)[0] : null;
  if (code) { ok((await P('/auth/reset/confirm', { email: em, code, new_password: 'New password 77' })).s === 200, 'correct code resets password');
    ok((await P('/auth/reset/confirm', { email: em, code, new_password: 'Other password 88' })).s === 400, 'code is single-use');
    ok((await P('/auth/login', { email: em, password: 'New password 77' })).s === 200, 'login with new password (lockout cleared)'); }
  // uploads
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#f00' } }).png().toBuffer();
  const jpgExif = await sharp(png).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'SECRET-GPS-TEST' } } }).toBuffer();
  const up = require('../lib/sec/upload');
  const s1 = await up.sanitize(jpgExif.toString('base64')); ok(!Buffer.from(s1.b64, 'base64').includes('SECRET-GPS-TEST'), 'EXIF stripped on re-encode');
  const poly = Buffer.concat([png, Buffer.from('<?php system($_GET[1]); ?>')]); let s2ok; try { const s2 = await up.sanitize(poly.toString('base64')); s2ok = !Buffer.from(s2.b64, 'base64').includes('<?php'); } catch { s2ok = true; } ok(s2ok, 'polyglot rejected or tail stripped');
  const tail = Buffer.concat([png, Buffer.alloc(4096, 0x20), Buffer.from('<?php x ?>')]); const s3 = await up.sanitize(tail.toString('base64')); ok(!Buffer.from(s3.b64, 'base64').includes('<?php'), 'deep polyglot tail stripped by re-encode');
  for (const [n, b] of [['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], ['gif', Buffer.from('GIF89a....')], ['html', Buffer.from('<html><script>x</script>')], ['fake-png', Buffer.concat([png.subarray(0, 8), Buffer.from('garbage'.repeat(20))])]]) { let rej = false; try { await up.sanitize(b.toString('base64')); } catch { rej = true; } ok(rej, 'rejects ' + n); }
  let big = false; try { await up.sanitize(Buffer.alloc(9 * 1024 * 1024, 1).toString('base64')); } catch (e) { big = /завеликий/.test(e.message); } ok(big, 'size limit');
  const api = await req('POST', '/api/detect', { image: Buffer.from('<svg/>').toString('base64'), mime: 'image/svg+xml' }); ok(api.s === 415, 'API rejects SVG upload (415)');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
