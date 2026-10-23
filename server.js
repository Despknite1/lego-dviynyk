const express = require('express');
const KEY = process.env.GEMINI_API_KEY;
const TEXT_MODELS = (process.env.TEXT_MODELS || 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview,gemini-3-flash-preview,gemini-3.5-flash,gemini-3.8-flash,gemini-flash-latest').split(',');
const IMG_MODELS = (process.env.IMG_MODELS || 'gemini-3.1-flash-image,gemini-2.5-flash-image,gemini-3.1-flash-lite-image').split(',');
const app = express();
const logger = require('./lib/sec/log'), helmet = require('helmet'), crypto = require('crypto');
app.set('trust proxy', +(process.env.TRUST_PROXY_HOPS || 1)); // Render/Cloudflare: trust only the first proxy hop
app.disable('x-powered-by');
app.use(require('pino-http')({ logger, genReqId: (req, res) => { const id = crypto.randomUUID(); res.setHeader('X-Request-Id', id); return id; }, serializers: { req: r => ({ id: r.id, method: r.method, url: String(r.url).split('?')[0] }), res: r => ({ status: r.statusCode }) }, autoLogging: { ignore: r => /^\/(ldraw|vendor|healthz)/.test(r.url) } }));
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'script-src-attr': ["'unsafe-inline'"], 'img-src': ["'self'", 'data:', 'blob:', 'https:'], 'connect-src': ["'self'", 'blob:', 'data:'], 'worker-src': ["'self'", 'blob:'], 'frame-src': ["'self'"], 'frame-ancestors': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"] } },
  crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
}));
app.use(require('cookie-parser')());
app.use('/auth', require('./lib/sec/auth').router());
app.get('/config.json', (req, res) => res.json({ accounts: require('./lib/sec/auth').enabled(), email_reset: require('./lib/sec/mailer').emailReady(), sms_reset: require('./lib/sec/mailer').smsReady() }));
app.use('/api', express.json({ limit: '15mb' }));
app.use(['/api/detect', '/api/describe', '/api/search', '/api/generate', '/api/generate_ai'], require('./lib/sec/upload').middleware(['image', 'crop']));
app.use(express.static(__dirname + '/public'));
app.use('/vendor/three', express.static(__dirname + '/node_modules/three', { maxAge: '7d' }));
app.use('/out', express.static(__dirname + '/out', { maxAge: '1h' }));
const ldpack = require('./lib/ldpack');
app.use('/ldraw/lib', (req, res, next) => { req.url = req.url.toLowerCase(); next(); }, express.static(process.env.LDRAW_DIR || '/workspace/ldraw/ldraw', { maxAge: '7d', fallthrough: false }));
app.get('/ldraw/packed/:part.mpd', (req, res) => { try { res.type('text/plain').set('Cache-Control', 'public, max-age=604800').send(ldpack.pack(req.params.part)); } catch (e) { res.status(404).send(e.message); } });

// rate limit: per IP 20 req / 10 min, global 300/day
const hits = new Map(); let day = { d: new Date().toDateString(), n: 0 };
app.use('/api', (req, res, next) => {
  const ip = req.ip; const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (new Date().toDateString() !== day.d) day = { d: new Date().toDateString(), n: 0 };
  if (arr.length >= 20 || day.n >= 300) return res.status(429).json({ error: 'Забагато запитів. Спробуйте пізніше.' });
  arr.push(now); hits.set(ip, arr); day.n++; next();
});

// Fast model failover: per-model timeout, cooldown for failing models, hedged parallel attempts (2 at a time)
const health = new Map(); // model -> {until, lat}
const log = (...a) => logger.info({ evt: 'app' }, a.map(x => typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x)).join(' ').slice(0, 500));
async function callModel(m, body, timeout) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.candidates?.length) { health.set(m, { until: 0, lat: Date.now() - t0 }); log('ok', m, Date.now() - t0, 'ms'); return j; }
    const cd = r.status === 429 ? 300e3 : r.status === 404 ? 3600e3 : r.status === 400 ? 60e3 : 30e3;
    health.set(m, { until: Date.now() + cd, lat: 99e3 });
    throw new Error(`${m}: ${r.status} ${(j.error?.message || 'empty').slice(0, 120)}`);
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') { health.set(m, { until: Date.now() + 60e3, lat: 99e3 }); e = new Error(`${m}: timeout ${timeout}ms`); }
    log('fail', e.message, Date.now() - t0, 'ms'); throw e;
  }
}
const { AsyncLocalStorage } = require('async_hooks'); const ALS = new AsyncLocalStorage();
const EXTRA_MODELS = (process.env.EXTRA_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-pro-latest,gemini-3.1-pro-preview,gemini-2.5-pro').split(',');
const isQuota = m => /429/.test(m) && /quota|exceeded|per day|PerDay|RESOURCE_EXHAUSTED/i.test(m);
async function gemOnce(models, body, timeout, parallel, budget, ignoreCd) {
  const t0 = Date.now(); const now = Date.now();
  let order = ignoreCd ? [...models] : models.filter(m => !(health.get(m)?.until > now));
  if (!order.length) order = [...models];
  order.sort((x, y) => (health.get(x)?.lat ?? 5e3) - (health.get(y)?.lat ?? 5e3));
  const errs = [];
  for (let i = 0; i < order.length && Date.now() - t0 < budget; i += parallel) {
    try { return { j: await Promise.any(order.slice(i, i + parallel).map(m => callModel(m, body, timeout))) }; }
    catch (e) { (e.errors || [e]).forEach(x => errs.push(x.message)); }
  }
  return { errs };
}
async function gem(models, body, { timeout = 20000, parallel = 2, budget = 45000 } = {}) {
  timeout = Math.max(timeout, 20000);
  const imgCall = models === IMG_MODELS;
  const all = imgCall ? models : [...new Set([...models, ...EXTRA_MODELS])];
  const T0 = Date.now(), TOTAL = 90000; const st = ALS.getStore(); let errs = [];
  for (let n = 1; ; n++) {
    const left = TOTAL - (Date.now() - T0);
    const r = await gemOnce(all, body, Math.min(timeout, Math.max(left, 5000)), parallel, Math.min(budget, Math.max(left, 5000)), n > 1);
    if (r.j) return r.j;
    errs = r.errs;
    if (errs.length && errs.every(isQuota)) { const e = new Error('Денну безкоштовну квоту Gemini вичерпано (429 quota). Спробуйте пізніше — квота оновлюється щодня (близько 10:00 за Києвом).'); e.quota = true; throw e; }
    const wait = Math.min(3000 * 2 ** (n - 1), 15000);
    if (Date.now() - T0 + wait > TOTAL) break;
    if (st) st.set(`Gemini перевантажений, пробую ще раз (спроба ${n + 1})…`);
    log('gem retry', n + 1, 'wait', wait);
    await new Promise(z => setTimeout(z, wait));
  }
  throw new Error('Усі моделі Gemini зараз перевантажені (пробував ~90 с), спробуйте ще раз за хвилину. ' + errs.slice(-2).join(' | '));
}
const fastCfg = (c = {}) => c; // thinkingBudget:0 is rejected (400) by gemini 3.5/latest lite models
const txt = j => (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
const parseJSON = s => { s = s.replace(/```json|```/g, ''); const i = Math.min(...['{', '['].map(c => s.indexOf(c)).filter(x => x >= 0)); const e = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')); return JSON.parse(s.slice(i, e + 1)); };
const img = (b64, mime) => ({ inline_data: { mime_type: mime || 'image/jpeg', data: b64 } });
const jobs = new Map(); let jid = 0;
const wrap = fn => (req, res) => { const id = (++jid).toString(36) + Math.random().toString(36).slice(2, 8); const job = { status: 'pending', t: Date.now() }; jobs.set(id, job);
  ALS.run({ set: x => { job.stage = x; } }, () => fn(req.body, st => { job.stage = st; })).then(r => { job.status = 'done'; job.result = r; }).catch(e => { console.error(e); job.status = 'error'; job.error = String(e.message || e).replace(KEY || '§', '***'); });
  res.json({ job: id }); };
app.get('/job/:id', (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ status: 'error', error: 'Завдання не знайдено' }); res.json(j); if (j.status !== 'pending') setTimeout(() => jobs.delete(req.params.id), 600000); });
setInterval(() => { for (const [k, v] of jobs) if (Date.now() - v.t > 1800000) jobs.delete(k); }, 600000);

const detCache = new Map(); const hash = x => require('crypto').createHash('sha1').update(x || '').digest('hex');
app.post('/api/detect', wrap(async ({ image, mime }, stage = () => {}) => {
  const hk = hash(image); if (detCache.has(hk)) return detCache.get(hk);
  stage('Gemini шукає персонажів на зображенні…');
  const j = await gem(TEXT_MODELS, { contents: [{ parts: [img(image, mime), { text:
    'Detect each individual prominent subject in this image: people, animals, fictional characters, creatures, figurines. Each individual gets its own entry and tight box. Ignore heavily blurred or tiny background figures unless there are no clear subjects. Max 12 (the most prominent). label: short Ukrainian description that distinguishes this one from the others (e.g. "Лицар у шоломі", "Дівчина в синій спідниці зліва"). box_2d: [ymin,xmin,ymax,xmax] normalized 0-1000.' }] }],
    generationConfig: fastCfg({ responseMimeType: 'application/json', temperature: 0.2, responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['label', 'box_2d'] } } }) }, { timeout: 9000 });
  let s = parseJSON(txt(j)); if (!Array.isArray(s)) s = s.subjects || [];
  s = s.map(o => ({ label: o.label || 'Об\'єкт', box_2d: o.box_2d || o.box || null })).filter(o => !o.box_2d || o.box_2d.length === 4).slice(0, 12);
  const res = { subjects: s }; if (s.length) detCache.set(hk, res); if (detCache.size > 200) detCache.delete(detCache.keys().next().value);
  return res;
}));

app.post('/api/describe', wrap(async ({ image, mime, subject }, stage = () => {}) => {
  stage('Gemini описує зачіску, одяг, принти, аксесуари…');
  const j = await gem(TEXT_MODELS, { contents: [{ parts: [img(image, mime), { text:
    `Focus on the subject "${subject?.label || 'main subject'}" located at box_2d ${JSON.stringify(subject?.box_2d || 'whole image')} (normalized 0-1000, [ymin,xmin,ymax,xmax]). Describe it for building a LEGO minifigure. Return JSON: {"identity":"known fictional character/famous name or null","type":"person/animal/...","hair":"","headgear":"","glasses":"","face":"facial expression, beard etc","torso":"clothing colors and prints","legs":"","accessories":"","theme":"e.g. knight, medieval, space, superhero","summary_uk":"2-4 sentence description in Ukrainian","search_keywords_en":"keywords to search LEGO minifigures","brickset_queries":["3-5 short English queries (1-3 words) for the Brickset minifig search: exact character name if known (e.g. 'Leonardo'), franchise (e.g. 'Ninja Turtles'), generic type (e.g. 'knight')"],"candidates":["up to 6 BrickLink minifig numbers you are confident exist and match, e.g. tnt001"],"attrs":{"gender":"male|female|unknown|none","bald":true/false,"hair_color":"English LEGO colour or null","hair_style":"short/long/ponytail/braid/... or null","facial_hair":"none|beard|stubble|moustache","glasses":true/false,"footwear":"barefoot|flip-flops|sandals|sneakers|boots|shoes + colours (e.g. black flip-flops with red and yellow straps)","expression":"neutral|smile|grin|pursed_lips (duck lips)|serious|surprised (open mouth)|tongue_out (tongue sticking out, cheeky)|wink — look carefully at the mouth: a visible tongue => tongue_out","lipstick":true/false (only if clearly visible),"headgear":"English: none/cap/helmet/headphones/hood/hat/crown...","skin":"English","torso_color":"main English LEGO colour e.g. Black","torso_print":"English: plain shirt/jacket/hoodie/armor/...","legs_color":"English LEGO colour","theme":"English LEGO theme/franchise or null","extra_queries":["4-6 extra 1-2 word English Brickset queries from distinctive attributes, e.g. bald, headphones, black shirt"]}}. "attrs" values in English; all other values except search_keywords_en in Ukrainian.` }] }],
    generationConfig: fastCfg({ responseMimeType: 'application/json', temperature: 0.3 }) }, { timeout: 10000 });
  return { description: parseJSON(txt(j)) };
}));

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const cache = new Map();
async function getPage(u) {
  const c = cache.get(u); if (c && Date.now() - c.t < 6 * 3600e3) return c.v;
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
  const v = await r.text(); cache.set(u, { t: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value); return v;
}
const ent = x => x.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const plain = h => ent(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n')).replace(/\n\s*\n+/g, '\n');
const after = (t, k, n = 1) => { const i = t.indexOf('\n' + k + '\n'); if (i < 0) return null; return t.slice(i + k.length + 2).split('\n').slice(0, n).map(x => x.trim()); };

async function bricksetSearch(q) {
  const h = await getPage('https://brickset.com/minifigs?query=' + encodeURIComponent(q) + '&pageSize=50');
  const out = []; const re = /<img src="https:\/\/img\.bricklink\.com\/ItemImage\/MN\/0\/([\w-]+)\.png" title="([^"]+)"[^>]*alt="([^"]*)"/g; let m;
  while ((m = re.exec(h))) { const alt = ent(m[3]); const cat = (alt.match(/category-[^']*'>([^<]+)</) || [])[1]; const yr = (alt.match(/year-(\d{4})/) || [])[1];
    out.push({ fig_num: m[1].toLowerCase(), name: ent(m[2]).replace(/^[\w-]+:\s*/, ''), category: cat, year: yr }); }
  return out;
}
async function figDetails(fn) {
  const t = plain(await getPage('https://brickset.com/minifigs/' + fn));
  const name = (after(t, 'Name') || [])[0];
  const ai = t.indexOf('\nAppears in\n', t.indexOf('Appears in themes') > 0 ? t.indexOf('sets\nAppears in') : 0);
  const sets = []; const seg = t.slice(t.indexOf('sets\nAppears in\n') + 16, t.indexOf('\nAppears in themes')); seg.split('\n').forEach(x => { x = x.trim(); if (/^[\w]+-\d+$/.test(x)) sets.push(x); });
  const cv = t.match(/Current value\s*\n\s*New:\s*\n?\s*(~?[$€£][\d,.]+)?[\s\S]{0,40}?Used:\s*\n?\s*(~?[$€£][\d,.]+)?/);
  const nz = v => (v && !/^~?[$€£]0(\.00)?$/.test(v)) ? v : null;
  return { name, sets: [...new Set(sets)], value_new: nz(cv?.[1]), value_used: nz(cv?.[2]) };
}
async function setDetails(sn) {
  const t = plain(await getPage('https://brickset.com/sets/' + sn));
  const name = (after(t, 'Name') || [])[0], year = (after(t, 'Year released') || [])[0], theme = (after(t, 'Theme') || [])[0];
  const rrp = (after(t, 'RRP') || [])[0] || null; const le = (after(t, 'Launch/exit') || [])[0] || null; const avail = (after(t, 'Availability') || [])[0] || null;
  const cv = t.match(/Current value\s*\n\s*New:\s*\n?\s*(~?[$€£][\d,.]+)?[\s\S]{0,40}?Used:\s*\n?\s*(~?[$€£][\d,.]+)?/);
  let status = 'unknown';
  if (le) { const parts = le.split(' - '); const ex = parts[1] && Date.parse(parts[1].replace(/(\d{2})$/, '20$1'));
    if (ex) status = ex < Date.now() ? 'retired' : 'available'; else if (parts[0]) status = 'available'; }
  else if (year && +year < new Date().getFullYear() - 3) status = 'retired';
  return { set_num: sn, name, year, theme, retail_price: rrp, launch_exit: le, availability: avail, status, set_resale_new: (cv?.[1] && !/^~?[$€£]0(\.00)?$/.test(cv[1])) ? cv[1] : null, set_resale_used: (cv?.[2] && !/^~?[$€£]0(\.00)?$/.test(cv[2])) ? cv[2] : null };
}

const searchCache = new Map();
// --- attribute parsing of BrickLink/Brickset names ("Male, Black Shirt..., Bald") ---
const COLORS = ['dark bluish gray','light bluish gray','dark blue','dark red','dark green','dark brown','dark tan','dark orange','dark purple','sand blue','sand green','medium blue','reddish brown','bright light orange','lime','olive green','pearl gold','black','white','red','blue','green','yellow','orange','tan','brown','purple','pink','magenta','gray','grey','nougat','azure','gold','silver'];
const colIn = (t, part) => { t = t.toLowerCase(); const m = t.match(new RegExp('(' + COLORS.join('|') + ')\\s+(?:[\\w-]+\\s+){0,2}' + part)); return m ? m[1] : null; };
function figAttrs(name) {
  const t = ' ' + name + ' ';
  return {
    gender: /\b(Female|Woman|Girl|Lady|Queen|Princess|Lipstick|Eyelashes|Ponytail|Pigtails|Witch|Mermaid|Bride|Mother|Mrs|Ms|Miss|Sister|Daughter|Ballerina|Skirt)\b/i.test(t) ? 'female' : /\b(Male|Man|Men|Boy|King|Prince|Beard|Moustache|Mustache|Goatee|Sideburns|Stubble|Tie|Bow Tie|Suit|Pilot|Captain|Mr|Sir|Father|Brother|Son|Policeman|Fireman|Businessman|Gentleman|Chin Dimple)\b/i.test(t) ? 'male' : null,
    nonhuman: /\b(Elphaba|Alien|Zombie|Skeleton|Robot|Droid|Orc|Goblin|Troll|Monster|Vampire|Ghost|Mummy|Werewolf|Creature|Martian|Clown|Yoda|Hulk|Gamora|Thanos|Mystique|Na'vi|Avatar|Smurf|Ogre|Elf|Green Skin|Blue Skin|Red Skin|Lime|Medium Lavender Skin|Shrek|Frankenstein|Gargoyle|Cyborg|Android|Bat|Shark|Dog|Cat|Bear|Monkey|Gorilla|Chicken|Pig|Wolf|Dinosaur|Dragon|Lizard|Fish)\b/i.test(t),
    smile: /\b(Smile|Smiling|Grin|Open Mouth|Laughing|Teeth)\b/i.test(t), lipstick: /\bLipstick|Red Lips|Pink Lips\b/i.test(t), neutral: /\b(Neutral|Closed Mouth|Pursed|Serious|Frown|Stern)\b/i.test(t),
    bald: /\bBald\b/i.test(t) && !/Bald on Top|Half Bald/i.test(t) ? 'bald' : /Bald on Top|Half Bald/i.test(t) ? 'partly' : null,
    hair: /\b(Hair|Ponytail|Pigtails|Braid|Bun|Mohawk|Bangs)\b/i.test(t),
    beard: /\b(Beard|Moustache|Mustache|Goatee|Stubble|Sideburns)\b/i.test(t),
    glasses: /\b(Glasses|Sunglasses|Goggles|Spectacles)\b/i.test(t),
    headphones: /Headphones|Headset|Ear Protectors/i.test(t),
    helmet: /\bHelmet\b/i.test(t), cap: /\bCap\b/i.test(t), hat: /\bHat\b/i.test(t), hood: /\bHood/i.test(t),
    hair_color: colIn(t, 'hair'), legs_color: colIn(t, 'legs'),
    torso_color: colIn(t, '(?:shirt|jacket|top|hoodie|sweater|vest|coat|suit|jumpsuit|torso|t-shirt|sweatshirt|blouse|dress)'),
    duplo: /Duplo|^47394/i.test(t),
  };
}
const normC = c => c ? String(c).toLowerCase().replace('grey', 'gray').trim() : null;
const colEq = (a, b) => { a = normC(a); b = normC(b); if (!a || !b) return false; return a === b || a.endsWith(' ' + b) || b.endsWith(' ' + a); };
// hard filters + attribute score; returns null if rejected
function attrMatch(sa, name, cat) {
  const f = figAttrs(name); if (f.duplo) return null;
  const g = String(sa.gender || '').toLowerCase(); const bald = sa.bald === true || sa.bald === 'true';
  const fh = String(sa.facial_hair || 'none').toLowerCase(); const hg = String(sa.headgear || 'none').toLowerCase();
  if ((g === 'male' && f.gender === 'female') || (g === 'female' && f.gender === 'male')) return null;
  const human = /person|human|man|woman|girl|boy|people/i.test(String(sa.type || 'person')) && !/green|blue|purple|red|grey|gray|metal/i.test(String(sa.skin || ''));
  if (human && f.nonhuman) return null;
  const ex = String(sa.expression || '').toLowerCase();
  if (bald && (f.hair && !f.bald)) return null;
  if (!bald && sa.bald !== undefined && f.bald) return null;
  if (fh === 'none' && f.beard && !/stubble/i.test(name)) return null;
  const m = []; let sc = 0;
  if (g && f.gender === g) { sc += 2; m.push(g === 'male' ? 'чоловік' : 'жінка'); }
  if (bald && f.bald) { sc += 4; m.push('лисий'); }
  if (!bald && sa.hair_color && f.hair_color && colEq(f.hair_color, sa.hair_color)) { sc += 2; m.push('колір волосся: ' + f.hair_color); }
  if (fh !== 'none' && f.beard) { sc += 3; m.push('борода/щетина'); }
  if (sa.glasses === true && f.glasses) { sc += 2; m.push('окуляри'); }
  if (/headphone|headset/.test(hg) && f.headphones) { sc += 4; m.push('навушники'); }
  if (/helmet/.test(hg) && f.helmet) { sc += 3; m.push('шолом'); } if (/cap/.test(hg) && f.cap) { sc += 3; m.push('кепка'); }
  if (/hat/.test(hg) && f.hat) { sc += 2; m.push('капелюх'); } if (/hood/.test(hg) && f.hood) { sc += 2; m.push('капюшон'); }
  if (f.helmet && !/helmet/.test(hg)) sc -= 3; if ((f.cap || f.hat) && !/cap|hat/.test(hg)) sc -= 2; if (f.hair && bald === false && !sa.hair_color) sc += 1;
  if (f.torso_color && colEq(f.torso_color, sa.torso_color)) { sc += 3; m.push('торс: ' + f.torso_color); }
  else if (sa.torso_color && name.toLowerCase().includes(normC(sa.torso_color))) { sc += 1; }
  if (f.legs_color && colEq(f.legs_color, sa.legs_color)) { sc += 2; m.push('ноги: ' + f.legs_color); }
  if (/neutral|pursed|duck|serious/.test(ex)) { if (f.smile) sc -= 2; if (f.neutral) { sc += 2; m.push('нейтральний вираз'); } } else if (/smile|grin|laugh/.test(ex) && f.smile) { sc += 2; m.push('усмішка'); }
  if (sa.lipstick === true && f.lipstick) { sc += 2; m.push('помада'); }
  if (sa.theme && cat && String(cat).toLowerCase().includes(String(sa.theme).toLowerCase().split(/[ /]/)[0])) { sc += 2; m.push('тема: ' + cat); }
  return { sc, m };
}
function attrQueries(sa, base) {
  const q = new Set((base || []).map(x => String(x).trim()).filter(Boolean));
  const g = String(sa.gender || '').toLowerCase(); const G = g === 'male' ? 'male' : g === 'female' ? 'female' : '';
  const hg = String(sa.headgear || '').toLowerCase(); const tc = normC(sa.torso_color); const tp = String(sa.torso_print || '').toLowerCase().split(/[ ,/]/).find(w => /shirt|jacket|hoodie|sweater|vest|coat|suit|armor|dress|top/.test(w));
  if (sa.bald === true || sa.bald === 'true') { q.add('bald'); if (G) q.add(G + ' bald'); }
  if (/headphone|headset/.test(hg)) q.add('headphones'); else { const w = (hg.match(/cap|helmet|hat|hood|crown|bandana|tiara|beanie/) || [])[0]; if (w) q.add(w); }
  if (tc) { q.add(tc + ' ' + (tp || 'shirt')); if (tp) q.add(tc + ' ' + tp); }
  if (sa.hair_color && !(sa.bald === true)) q.add(normC(sa.hair_color) + ' hair' + (sa.hair_style && /ponytail|braid|bun|pigtail/.test(sa.hair_style) ? ' ' + sa.hair_style.split(' ')[0] : ''));
  if (sa.facial_hair && !/none/i.test(sa.facial_hair)) q.add(String(sa.facial_hair).toLowerCase());
  if (sa.glasses === true) q.add('glasses');
  if (sa.theme) q.add(String(sa.theme));
  (sa.extra_queries || []).forEach(x => q.add(String(x)));
  return [...q].filter(x => x.length > 1).slice(0, 12);
}
const thumbCache = new Map();
async function thumbB64(fn) {
  if (thumbCache.has(fn)) return thumbCache.get(fn);
  let v = null; try { const r = await fetch(`https://img.bricklink.com/ItemImage/MN/0/${fn}.png`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }); if (r.ok) v = Buffer.from(await r.arrayBuffer()).toString('base64'); } catch {}
  thumbCache.set(fn, v); if (thumbCache.size > 2000) thumbCache.delete(thumbCache.keys().next().value); return v;
}
function contactSheet(imgs) {
  return new Promise(res => { const p = require('child_process').spawn('python3', [__dirname + '/lib/sheet.py']); let out = '';
    p.stdout.on('data', d => out += d); p.on('error', () => res(null)); p.on('close', c => res(c === 0 && out.length > 100 ? out.trim() : null));
    p.stdin.end(JSON.stringify({ imgs })); setTimeout(() => { try { p.kill(); } catch {} }, 15000); });
}
const poolCache = new Map();
app.post('/api/search', wrap(async ({ description, crop }, stage = () => {}) => {
  const d = JSON.stringify(description);
  const ck = d + '|' + (crop ? crop.length + crop.slice(-64) : ''); if (searchCache.has(ck)) return searchCache.get(ck);
  const sa = description?.attrs || {};
  let base = description?.brickset_queries;
  if (!Array.isArray(base) || !base.length) base = [String(description?.identity || description?.theme || 'minifigure').slice(0, 30)];
  const queries = attrQueries(sa, base);
  stage('Шукаю в каталозі Brickset (' + queries.length + ' запитів): ' + queries.join(', ') + '…');
  const pool = new Map();
  const [lists] = await Promise.all([
    Promise.all(queries.map(x => (poolCache.get(x) || bricksetSearch(x).then(r => (poolCache.set(x, Promise.resolve(r)), r))).catch(() => []))),
    Promise.all((description?.candidates || []).slice(0, 6).map(async c => { c = String(c).toLowerCase().trim();
      try { const fd = await figDetails(c); if (fd.name) pool.set(c, { fig_num: c, name: fd.name, suggested: true }); } catch {} }))]);
  // interleave lists so every query contributes
  for (let i = 0; i < 50 && pool.size < 150; i++) lists.forEach(l => { const f = l[i]; if (f && !pool.has(f.fig_num) && pool.size < 150) pool.set(f.fig_num, f); });
  const total = pool.size;
  const kept = [];
  const NONFIG = /^(belv|scala|fab|dup|tech|frnd|clikits|jsta|hrp|bdp(?!\d)|wwg|hp_|znap|mdoll|fdoll|elf\d|dsn\d)/i, NONFIG_NAME = /belville|scala|fabuland|duplo|technic figure|mini-?doll|friends|elves|disney princess|clikits|jack stone|znap|galidor|bionicle|mosaic|key chain|magnet/i;
  for (const f of [...pool.values()]) if (NONFIG.test(f.fig_num) || NONFIG_NAME.test(f.name + ' ' + (f.category || ''))) pool.delete(f.fig_num);
  for (const f of pool.values()) { const a = attrMatch(sa, f.name, f.category); if (a) kept.push({ ...f, sc: a.sc + (f.suggested ? 2 : 0), m: a.m }); }
  kept.sort((x, y) => y.sc - x.sc);
  const top = kept.slice(0, 24);
  log('search pool', total, 'kept', kept.length);
  if (!top.length) { const out = { results: [], close_enough: false, queries, candidates_checked: total, filtered_out: total, message_uk: 'Серед ' + total + ' кандидатів немає фігурок з потрібними ознаками (стать, волосся, борода).' }; searchCache.set(ck, out); return out; }
  let rank = null;
  if (crop) {
    stage(`Знайдено ${total}, після фільтрів ${kept.length}. Готую контактний аркуш з ${top.length} фігурок…`);
    const sheet = await contactSheet(await Promise.all(top.map(f => thumbB64(f.fig_num))));
    if (sheet) {
      stage('Gemini порівнює фото з кандидатами (одне візуальне порівняння)…');
      try {
        const rk = await gem(TEXT_MODELS, { contents: [{ parts: [
          { text: 'Image 1 — the subject to match:' }, img(crop), { text: `Image 2 — contact sheet of ${top.length} real LEGO minifigures, numbered 1-${top.length} (yellow number in each cell's top-left). Names:\n` + top.map((f, i) => `${i + 1}. ${f.name}`).join('\n') +
          `\nSubject attributes: ${JSON.stringify(sa)}\nScore how well each minifigure would work as a LEGO version of the subject (0-100). Ignore LEGO stylisation itself (yellow skin, blocky shape, printed face) — judge only the matching features: gender, skin (natural human vs green/blue/alien), facial expression (neutral vs smiling, lipstick), hair/bald, facial hair, headgear, glasses, clothing colours & print, legs, overall vibe. Be strict: wrong gender or hair vs bald => below 30. Same key features (e.g. bald + headphones + black shirt) => 70+. For EVERY thumbnail also report the figure's visible gender from the face/hair/body print (eyelashes/lips/ponytail = female; beard/stubble/tie+suit/male face = male; unknown only if truly impossible) and whether it is a natural-skinned human. Return JSON {"scores":[{"n":1,"gender":"male|female|unknown","natural_human":true,"expression":"neutral|smile|...","score":0-100,"why_uk":"1 sentence in Ukrainian: what matches and what differs"}]} for every number.` }, img(sheet) ] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }, { timeout: 25000, budget: 40000 });
        const pj = parseJSON(txt(rk)); rank = (Array.isArray(pj) ? pj : (pj.scores || pj.results || [])).map(r => ({ f: top[(+r.n) - 1], score: +r.score || 0, why: r.why_uk, g: String(r.gender || '').toLowerCase(), nh: r.natural_human })).filter(r => r.f);
        const sg = String(sa.gender || '').toLowerCase(); const shum = /person|human|man|woman|girl|boy|people/i.test(String(sa.type || 'person')) && !/green|blue|purple/i.test(String(sa.skin || ''));
        const n0 = rank.length; rank = rank.filter(r => !((sg === 'male' || sg === 'female') && (r.g === 'male' || r.g === 'female') && r.g !== sg) && !(shum && r.nh === false));
        log('rerank dropped (gender/skin)', n0 - rank.length); if (!rank.length) rank = [];
      } catch (e) { log('rerank fail', e.message); if (e.quota) throw e; }
    }
  }
  if (!rank) rank = top.slice(0, 6).map(f => ({ f, score: Math.min(60, 35 + f.sc * 3), why: 'Збіг за назвою в каталозі (візуальне порівняння недоступне).' }));
  log('rerank scores', rank.map(r => r.score).join(','));
  if (!rank) rank = top.slice(0, 6).map(f => ({ f, score: Math.min(60, 35 + f.sc * 3), why: 'Збіг за назвою в каталозі (візуальне порівняння недоступне).' }));
  rank = rank.filter(r => r.score >= 35).sort((a, b) => b.score - a.score).slice(0, 6);
  stage('Завантажую ціни та набори…');
  const results = await Promise.all(rank.map(async r => {
    const fn = r.f.fig_num; let fd = { sets: [] }; try { fd = await figDetails(fn); } catch {}
    const sets = await Promise.all((fd.sets || []).slice(0, 3).map(sn => setDetails(sn).catch(() => ({ set_num: sn, status: 'unknown' }))));
    return { fig_num: fn, name: fd.name || r.f.name, similarity: Math.round(r.score), why_uk: (r.why || '') + (r.f.m.length ? ' Збіг ознак: ' + r.f.m.join(', ') + '.' : ''), matched: r.f.m,
      image: `https://img.bricklink.com/ItemImage/MN/0/${fn}.png`, fig_resale: { new: fd.value_new, used: fd.value_used, source: 'Brickset (на основі BrickLink)' },
      sets_total: (fd.sets || []).length,
      sets: sets.map(s => ({ ...s, image: `https://images.brickset.com/sets/small/${s.set_num}.jpg`,
        links: { brickset: `https://brickset.com/sets/${s.set_num}`, bricklink: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${s.set_num}#T=P`, brickeconomy: `https://www.brickeconomy.com/search?query=${s.set_num}`, lego: `https://www.lego.com/uk-ua/search?q=${s.set_num.split('-')[0]}` } })),
      links: { brickset: `https://brickset.com/minifigs/${fn}`, bricklink: `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${fn}#T=P`, rebrickable: `https://rebrickable.com/search/?q=${fn}`, brickeconomy: `https://www.brickeconomy.com/search?query=${fn}` } };
  }));
  const out = { results, close_enough: results.some(r => r.similarity >= 60), queries, candidates_checked: total, after_filters: kept.length,
    message_uk: results.length ? null : `Перевірено ${total} кандидатів, ${kept.length} пройшли фільтри, але жоден не схожий візуально.` };
  searchCache.set(ck, out); if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  return out;
}));

// ---------- Custom minifig generation pipeline ----------
const BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
async function getJSON(u, opt = {}) { const r = await fetch(u, { ...opt, headers: { 'User-Agent': BUA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function fetchImageB64(u, max = 2.5e6) {
  const r = await fetch(u, { headers: { 'User-Agent': BUA }, signal: AbortSignal.timeout(10000) });
  const ct = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !/image\/(jpeg|png|webp)/.test(ct)) throw new Error('bad image');
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > max) throw new Error('too big');
  return { data: buf.toString('base64'), mime: ct };
}
// Reference images: fandom wiki (page image + gallery), Wikipedia page image
async function findReferences(id) {
  const refs = []; const seen = new Set();
  const add = (url, page, source, title) => { if (!url || seen.has(url) || refs.length >= 8) return; seen.add(url); refs.push({ url, page, source, title }); };
  const name = id.character_name || id.identity; if (!name) return refs;
  const tokens = name.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const franchiseSlug = String(id.franchise || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wikis = [...new Set([id.fandom_wiki, ...(id.fandom_wiki_alternatives || []), franchiseSlug].filter(Boolean).map(w => String(w).toLowerCase().replace(/^https?:\/\//, '').replace(/\.fandom\.com.*$/, '').replace(/\/.*$/, '').replace(/[^a-z0-9-]/g, '')))].filter(Boolean).slice(0, 5);
  await Promise.all(wikis.map(async w => {
    try {
      const base = `https://${w}.fandom.com/api.php`;
      const sr = await getJSON(`${base}?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json`);
      const title = sr.query?.search?.[0]?.title; if (!title) return;
      const page = `https://${w}.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      const pi = await getJSON(`${base}?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=original&format=json&redirects=1`);
      const orig = Object.values(pi.query?.pages || {})[0]?.original?.source; add(orig, page, `${w}.fandom.com`, title);
      const g = await getJSON(`${base}?action=query&generator=images&titles=${encodeURIComponent(title)}&gimlimit=200&prop=imageinfo&iiprop=url|size&format=json&redirects=1`);
      const imgs = Object.values(g.query?.pages || {}).filter(p => { const ii = p.imageinfo?.[0]; const t = p.title.toLowerCase();
        return ii && ii.width >= 300 && ii.height >= 300 && /\.(jpe?g|png|webp)$/i.test(t) && tokens.some(k => t.includes(k.slice(0, 4))) && !/logo|icon|tcard|t-card|title/i.test(t); });
      imgs.sort(() => Math.random() - 0.5).slice(0, 5).forEach(p => add(p.imageinfo[0].url, page, `${w}.fandom.com`, p.title.replace(/^File:/, '')));
    } catch (e) { log('fandom fail', w, e.message); }
  }));
  if (id.wikipedia_title) try {
    const pi = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(id.wikipedia_title)}&prop=pageimages&piprop=original&format=json&redirects=1`, { headers: { 'User-Agent': 'LegoSite/1.0 (lego-site demo)' } });
    const pg = Object.values(pi.query?.pages || {})[0]; add(pg?.original?.source, `https://en.wikipedia.org/wiki/${encodeURIComponent(id.wikipedia_title.replace(/ /g, '_'))}`, 'en.wikipedia.org', pg?.title);
  } catch {}
  return refs;
}
// AI Horde (free, community GPUs, anonymous key) text-to-image
const HORDE_KEY = process.env.HORDE_API_KEY || '0000000000';
// fast tier: SD1.5 models with idle workers (anonymous limit <=576px); XL tier: better quality but long anonymous queue
const HORDE_FAST = { models: ['Deliberate', 'Rev Animated'], size: 512, steps: 20, maxWait: 100000 };
const HORDE_XL = { models: ['AlbedoBase XL (SDXL)', 'AlbedoBase XL 3.1', 'Juggernaut XL'], size: 768, steps: 25, maxWait: 75000 };
async function hordeGenerate(prompt, negative, n, stage, tier = HORDE_FAST) {
  const H = { apikey: HORDE_KEY, 'Content-Type': 'application/json', 'Client-Agent': 'lego-site:1.0:anon', 'User-Agent': BUA };
  const sub = await getJSON('https://aihorde.net/api/v2/generate/async', { method: 'POST', headers: H, timeout: 20000,
    body: JSON.stringify({ prompt: prompt + (negative ? ' ### ' + negative : ''), params: { width: tier.size, height: tier.size, steps: tier.steps, cfg_scale: 7, sampler_name: 'k_euler_a', n }, models: tier.models, r2: true, nsfw: false, censor_nsfw: true }) });
  const t0 = Date.now();
  while (Date.now() - t0 < tier.maxWait) {
    await new Promise(z => setTimeout(z, 4000));
    const c = await getJSON('https://aihorde.net/api/v2/generate/check/' + sub.id, { headers: H }).catch(() => null); if (!c) continue;
    stage?.(c.done ? 'готово' : c.processing ? 'малюю' : `у черзі (позиція ${c.queue_position}, ~${c.wait_time} с)`);
    if (c.faulted) throw new Error('Horde faulted');
    if (c.done) { const st = await getJSON('https://aihorde.net/api/v2/generate/status/' + sub.id, { headers: H });
      return Promise.all(st.generations.map(async g => ({ ...(await fetchImageB64(g.img, 5e6)), model: g.model, seed: g.seed }))); }
  }
  fetch('https://aihorde.net/api/v2/generate/status/' + sub.id, { method: 'DELETE', headers: H }).catch(() => {});
  throw new Error('Horde timeout');
}
async function geminiImage(prompt, crop) {
  const parts = [{ text: prompt }]; if (crop) parts.push(img(crop.data, crop.mime));
  const j = await gem(IMG_MODELS, { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }, { timeout: 40000, parallel: 3, budget: 45000 });
  const p = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data); if (!p) throw new Error('no image');
  const d = p.inlineData || p.inline_data; return [{ data: d.data, mime: d.mimeType || d.mime_type, model: 'Gemini' }];
}
async function verify(cand, crop, spec) {
  const j = await gem(TEXT_MODELS, { contents: [{ parts: [
    { text: 'Image 1 = the original subject. Image 2 = a generated LEGO minifigure that must depict that subject.' }, img(crop.data, crop.mime), img(cand.data, cand.mime),
    { text: `Must-have checklist: ${JSON.stringify(spec.checklist)}. Species/body: ${spec.species}. Score how well image 2 matches as a LEGO minifigure of the subject (0-10). Be strict: wrong species (e.g. human instead of turtle), missing key colors or accessories => score <=4. Not a LEGO minifigure style => <=4. Return JSON {"score":0,"lego_style":true,"species_ok":true,"missing":["..."],"issues_uk":"short Ukrainian","new_prompt_en":"improved complete Stable Diffusion prompt (<=60 words, starts with LEGO minifigure, self-contained (never mention 'image 1'/'the photo'), use (feature:1.4) emphasis for the missing/wrong features) fixing the problems"}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }, { timeout: 15000 });
  return parseJSON(txt(j));
}

app.post('/api/generate_ai', wrap(async ({ image, mime, crop, subject, description }, stage = () => {}) => {
  const T0 = Date.now(); const el = () => Math.round((Date.now() - T0) / 1000) + ' с';
  const cr = crop ? { data: crop, mime: 'image/jpeg' } : { data: image, mime: mime || 'image/jpeg' };
  const info = { steps: [] }; const step = (m) => { info.steps.push(`[${el()}] ${m}`); stage(m); };
  // 1. identify on crop
  step('1/5 Аналізую обраного персонажа (фрагмент зображення)…');
  const idj = await gem(TEXT_MODELS, { contents: [{ parts: [img(cr.data, cr.mime), { text: `Previous description: ${JSON.stringify(description || {})}.
Identify this subject. Return JSON {"is_known_character":bool (fictional character from movie/game/show/comic, or a famous real person),"character_name":"e.g. Michelangelo","identity":"full e.g. Michelangelo (Teenage Mutant Ninja Turtles)","franchise":"","fandom_wiki":"most likely fandom.com wiki subdomain, e.g. tmnt, starwars, marvel, harrypotter","fandom_wiki_alternatives":["1-2 more"],"wikipedia_title":"exact English Wikipedia article title or null","species":"e.g. anthropomorphic turtle / human / dog","is_human":bool}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { timeout: 12000 });
  const id = parseJSON(txt(idj)); info.identity = id;
  // 2. references
  let refs = [];
  if (id.is_known_character) {
    step(`2/5 Шукаю референси «${id.identity || id.character_name}» (fandom wiki, Wikipedia)…`);
    refs = await findReferences(id);
    const loaded = await Promise.all(refs.map(r => fetchImageB64(r.url).then(b => ({ ...r, b })).catch(() => null)));
    refs = loaded.filter(Boolean).slice(0, 4);
  } else step('2/5 Невідомий персонаж — референси не потрібні, працюю з фото.');
  // 3. detailed spec (crop + refs)
  step(`3/5 Gemini порівнює фото з ${refs.length} референсами та пише детальний опис…`);
  const parts = [{ text: 'IMAGE A = the user-selected subject (crop):' }, img(cr.data, cr.mime)];
  refs.forEach((r, i) => parts.push({ text: `REFERENCE ${i + 1} (${r.source}: ${r.title}):` }, img(r.b.data, r.b.mime)));
  parts.push({ text: `Assumed identity: ${JSON.stringify(id)}.
${refs.length ? 'Compare IMAGE A with the references: confirm or reject the identity, and use references to resolve details hidden/unclear in IMAGE A (but the user\'s version in IMAGE A has priority for colors/outfit).' : ''}
Design a LEGO minifigure of this subject. Return JSON:
{"identity_confirmed":bool,"identity":"","refs_used":[indexes of references that really show this character],
"species":"body type; if not human say e.g. 'green anthropomorphic turtle, turtle head, NOT human'",
"appearance_uk":{"Голова/обличчя":"","Волосся/головний убір":"","Окуляри/маска":"","Вираз обличчя":"","Тулуб і принти":"","Руки":"","Ноги":"","Аксесуари":"","Кольори":"names + approx hex"},
"prompt_en":"Stable Diffusion prompt, <=60 words, most important first, use (feature:1.3) emphasis syntax for species/head shape and the 2-3 most distinctive colors/items, e.g. (green turtle head:1.4), (orange bandana mask:1.3); describe everything explicitly, never refer to 'the image', 'image 1' or references: 'LEGO minifigure of <identity>, <species/head>, <key colors with names>, <bandana/hair/headgear>, <torso print>, <legs>, <accessories in hands>, glossy plastic toy, classic minifigure proportions, C-shaped hands, studio product photo, white background'",
"negative_en":"comma list of things to avoid, e.g. 'human face, skin, bald head, black shirt, realistic person, text, watermark' (include 'human face, skin' if not human)",
"checklist":["5-7 short must-have visual features to verify, e.g. 'green turtle head (not human)', 'orange bandana mask', 'shell on torso', 'nunchucks'"]}` });
  const sj = await gem(SPEC_MODELS, { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }, { timeout: 25000 });
  const spec = parseJSON(txt(sj)); info.spec = spec;
  const usedRefs = refs.filter((r, i) => !Array.isArray(spec.refs_used) || spec.refs_used.includes(i + 1)).map(({ b, ...r }) => r);
  // 4-5. generate + verify loop
  let prompt = spec.prompt_en, negative = spec.negative_en; const cands = []; let gemErr = null;
  const ROUNDS = 3;
  for (let round = 1; round <= ROUNDS; round++) {
    step(`4/5 Генерую мініфігурку (спроба ${round}/${ROUNDS})…`);
    let imgs = [];
    try { if (!gemErr) imgs = await geminiImage(`Create a product photo of an official-looking LEGO minifigure. ${prompt}. Avoid: ${negative}. The attached image shows the subject to turn into a minifigure.`, cr); }
    catch (e) { gemErr = e.message; log('gemini image unavailable', e.message.slice(0, 80)); }
    if (!imgs.length) {
      let fastMsg = '', xlMsg = '';
      const upd = () => stage(`4/5 Генерую мініфігурку (спроба ${round}/${ROUNDS}, AI Horde): SD — ${fastMsg || 'надсилаю'}${round === 1 ? '; SDXL — ' + (xlMsg || 'надсилаю') : ''} [${el()}]`);
      const jobs = [hordeGenerate(prompt, negative, 3, m => { fastMsg = m; upd(); }, HORDE_FAST)];
      if (round === 1) jobs.push(hordeGenerate(prompt, negative, 1, m => { xlMsg = m; upd(); }, HORDE_XL));
      // don't block on the slow SDXL queue: once SD is done, give SDXL at most 10 s more
      const xlP = jobs[1] ? jobs[1].catch(e => { log('horde xl fail', e.message); return []; }) : null;
      try { imgs.push(...await jobs[0]); } catch (e) { log('horde fail', e.message); }
      if (xlP) imgs.push(...(await Promise.race([xlP, new Promise(z => setTimeout(() => z([]), imgs.length ? 10000 : 60000))])));
    }
    if (!imgs.length) continue;
    step(`5/5 Gemini перевіряє ${imgs.length} варіант(и): вид, кольори, аксесуари…`);
    const checked = await Promise.all(imgs.map(c => verify(c, cr, spec).then(v => ({ ...c, v, round, prompt })).catch(e => ({ ...c, v: { score: 0, issues_uk: 'перевірка недоступна' }, round, prompt }))));
    cands.push(...checked);
    log('round', round, checked.map(c => c.model + ':' + c.v.score).join(' '));
    const best = cands.reduce((a, b) => ((b.v.score || 0) > (a.v.score || 0) ? b : a));
    if ((best.v.score || 0) >= 7 || (round >= 2 && (best.v.score || 0) >= 6 && best.v.species_ok !== false)) break;
    const worst = checked.reduce((a, b) => ((b.v.score || 0) > (a.v.score || 0) ? b : a));
    if (worst.v.new_prompt_en) prompt = worst.v.new_prompt_en;
    if (checked.some(c => c.v.species_ok === false) && !/human face/.test(negative)) negative += ', human, human face, skin, bald head';
  }
  if (!cands.length) throw new Error('Не вдалося згенерувати зображення (Gemini: ' + String(gemErr).slice(0, 80) + '; AI Horde недоступний). Спробуйте пізніше.');
  cands.sort((a, b) => (b.v.score || 0) - (a.v.score || 0));
  const best = cands[0];
  info.steps.push(`[${el()}] Готово`);
  return { image: best.data, mime: best.mime, source: best.model === 'Gemini' ? 'Gemini' : `AI Horde (${best.model}, безкоштовні GPU спільноти)`, score: best.v.score, verdict: best.v,
    alternatives: cands.slice(1).map(c => ({ image: c.data, mime: c.mime, score: c.v.score, issues_uk: c.v.issues_uk })),
    identity: spec.identity || id.identity, identity_confirmed: spec.identity_confirmed, species: spec.species, appearance_uk: spec.appearance_uk, checklist: spec.checklist,
    prompt: best.prompt, references: usedRefs, gemini_image_error: gemErr ? 'Gemini-генерація зображень недоступна для цього ключа (безкоштовний тариф)' : null, steps: info.steps, seconds: Math.round((Date.now() - T0) / 1000) };
}));

// ---------- Primary: deterministic template renderer driven by a Gemini JSON spec ----------
const minifig = require('./lib/minifig');
// crop the shirt graphic from the user's photo and posterize it (Python/PIL) → data URL PNG for the torso decal
function addGraphic(sp, cr) {
  const b = sp && sp.torso_graphic_box; if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(+v)) || +b[2] - +b[0] < 20 || +b[3] - +b[1] < 20) { if (sp) delete sp.torso_graphic_png; return Promise.resolve(); }
  return new Promise(res => { const p = require('child_process').spawn('python3', [__dirname + '/lib/graphic.py']); let out = '';
    p.stdout.on('data', d => out += d); p.on('error', () => res()); p.on('close', code => { if (code === 0 && out.length > 100) sp.torso_graphic_png = 'data:image/png;base64,' + out.trim(); res(); });
    p.stdin.end(JSON.stringify({ img: cr.data, box: b, bg: /^#[0-9a-f]{6}$/i.test(sp.torso_color || '') ? sp.torso_color : '#000000' })); setTimeout(() => { try { p.kill(); } catch {} }, 8000); });
}
const SPEC_MODELS = (process.env.SPEC_MODELS || 'gemini-flash-latest,gemini-3.5-flash,gemini-3-flash-preview').split(',').concat(TEXT_MODELS.filter(m => !/^(gemini-flash-latest|gemini-3.5-flash|gemini-3-flash-preview)$/.test(m)));
// official LEGO printed heads (LDraw 3626bp*/3626cp*) catalog → Gemini picks the closest face print
let FACE_CAT = []; try { FACE_CAT = JSON.parse(require('fs').readFileSync(__dirname + '/faces/catalog.json', 'utf8')); } catch (e) { log('no face catalog', e.message); }
async function pickFace(spec, cr) {
  if (!FACE_CAT.length || spec.hair_style === 'bandana_tails' || (spec.head_mold && spec.head_mold !== 'standard') || (spec.face && spec.face.mask && spec.face.mask !== 'none' && (spec.face.mask.type || spec.face.mask) !== 'none') || (spec.face && spec.face.eye_mask)) return null;
  const list = FACE_CAT.map(c => `${c.part}: ${c.title.replace(/^Minifig Head with /, '').replace(/ Pattern( \(Hollow Stud\))?$/, '')}`).join('\n');
  const j = await gem(TEXT_MODELS, { contents: [{ parts: [img(cr.data, cr.mime), { text: `Pick the official LEGO printed minifigure head whose FACE PRINT best matches the person/character in the image: gender (eyelashes/lips = female), age (wrinkles/grey brows = old), expression, facial hair (beard/moustache/stubble), glasses/sunglasses (only if the subject wears them), freckles. Current face spec: ${JSON.stringify(spec.face || {})}.
Catalog (part: description):
${list}
Return JSON {"head_part":"part id from the catalog","why_uk":"коротко чому"}. EXPRESSION IS A HARD RULE: neutral / pursed lips / duck lips / serious subject => a closed-mouth NON-smiling face (never smile, grin or open mouth); lipstick only if visible. Prefer simple, clean faces; do NOT pick glasses/beards/scars if the subject doesn't have them.` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }, { timeout: 15000, budget: 20000 });
  const r = parseJSON(txt(j)); let hit = FACE_CAT.find(c => c.part === String(r.head_part || '').trim().toLowerCase());
  const SM = /Smil|Grin|Open Mouth|Laugh|Teeth|Tongue/i, ex = String(spec.face?.expression || '').toLowerCase();
  if (hit && /neutral|pursed|duck|serious|smirk/.test(ex) && SM.test(hit.title)) { // expression rule is hard: no smiles for neutral faces
    const fem = String(spec.face?.gender || '').toLowerCase() === 'female', gl = spec.face?.glasses && spec.face.glasses !== 'none';
    const alt = FACE_CAT.filter(c => !SM.test(c.title) && (fem ? /Female|Eyelashes|Lips/i.test(c.title) : !/Female|Eyelashes/i.test(c.title)) && !/Beard|Moustache|Stubble|Scar|Sunglasses|Mask|Tear/i.test(c.title) && (gl ? true : !/Glasses/i.test(c.title)));
    const lip = !!spec.face?.lipstick, sc = t => (/Closed Mouth|Neutral|Smirk/i.test(t) ? 2 : 0) + (/Lips|Lipstick/i.test(t) ? (lip ? 2 : -2) : 0);
    const best = alt.sort((a, b) => (sc(b.title) - sc(a.title)) || a.title.length - b.title.length)[0];
    log('pickFace: smile rejected for neutral face', hit.part, '->', best && best.part); hit = best || null; if (hit) r.why_uk = 'Нейтральний вираз без усмішки (як на фото).'; }
  return hit ? { part: hit.part, title: hit.title, why_uk: r.why_uk } : null;
}

const DESIGN_GUIDE = `THINK LIKE AN OFFICIAL LEGO MINIFIGURE DESIGNER (do this in "design" before writing any SVG):
STEP 1 concept: one-line archetype of the character (e.g. "leper king of Jerusalem: humble white robes, royal gold, silver mask").
STEP 2 motifs: pick 2-4 SIGNATURE motifs that read at minifig scale (2 cm tall!): a stole/sash, a belt with buckle, an emblem/cross/crest, a collar/trim, buttons/zip, armour plates. Every shape you draw must be one of these motifs or a clothing seam/trim — NEVER random rectangles, diamonds, blobs or filler shapes.
STEP 3 palette: 2-3 main colours + 1 accent (e.g. white + light gray + gold accent). Use ONLY these (plus skin, black for fine lines). Prefer real LEGO colours: White #F4F4F4, Light Bluish Gray #A0A5A9, Dark Bluish Gray #6C6E68, Black #1B2A34/#1b1b1b, Red #C91A09, Dark Red #720E0F, Blue #0055BF, Dark Blue #0A3463, Green #237841, Dark Green #184632, Tan #E4CD9E, Dark Tan #958A73, Reddish Brown #582A12, Pearl Gold #DCBC81, Flat Silver #898788, Yellow #F2CD37, Orange #FE8A18, Light Nougat #F6D7B3, Nougat #D09168.
PLAIN CLOTHES STILL GET DETAIL: even a single-colour garment gets tasteful official-LEGO-style detail in a slightly darker/lighter shade of the same colour + thin black lines: seams, lapels/collar, buttons, belt with buckle, pockets, zip, folds/shading lines that emphasise the figure's shape (e.g. black trench coat -> wide lapels, double row of buttons, belt with silver buckle tied at the waist, side pockets, darker fold lines; continue lapels/belt on the back and hem on the legs/robe).
CROSSBODY STRAP: exactly ONE clean diagonal strap (from one shoulder to the opposite hip, 4-6 units wide) + one small bag body at the hip; never crossing lines or extra circles.
WIDE PANTS: draw vertical fold lines (darker shade) on the legs and set "belt" when a belt is visible.
FOOTWEAR: always fill "footwear" (type + colours incl. strap colours); the code prints the feet from it.
SHIRTLESS / SWIMWEAR: bare_torso true + body_build + chest_hair from the photo (the renderer draws an official-LEGO bare-chest print: collarbones, pecs with nipples under the centre of each pec, abs/obliques by build, navel — do NOT draw anatomy yourself in torso_print_svg), ONE skin colour everywhere (head, torso, arms, hands, bare legs); briefs/shorts drawn on hips + top of legs with a real shape (waistband, leg openings), leg_color = skin below them.
CHARACTERS (games/anime): add the headdress/jewelry/armour elements as prints (and accessories_3d / headgear where possible); corsets with lacing, necklines, decorative inserts and patterns.
BAGS: any bag/purse/handbag visible in the photo MUST appear: accessories_3d {"type":"bag","style":"held" (handbag in the hand) | "crossbody" | "belt" (belt/waist bag)} — for crossbody/belt also draw the strap diagonally across torso_print_svg (and back) and the small bag body on the print.
STEP 4 layout rules: (a) symmetric around the torso centre line x=50 unless the costume is truly asymmetric; (b) the main motif is centred (neckline/chest/stole/belt); (c) lines CONTINUE: a stole, trim or sash that runs down the torso front must also appear on the back and on BOTH sleeves (same colour band in arm_print_svg), belts wrap to the back; (d) trims follow garment edges (neckline V, hem at y≈92-100, cuffs at arm y≈85-100); (e) contrast: accent colour on the main colour; thin black/dark outlines (stroke-width 0.8-1.5) for folds; (f) 6-20 purposeful shapes, not more; (g) the back print continues the clothing (seams, belt, cape/stole) + the author touch emblem.
PARTS: use only real, buyable LEGO parts from the enums (they map to BrickLink/LDraw parts). For robed / hooded archetypes the hood (30381) + cape (4524) + long_robe (36036) combo works well, but it is only ONE option — choose parts that fit THIS character.
QUALITY BAR: official LEGO minifigures are the baseline — aim higher: more detail (fine trims, stitching, embroidery patterns, small emblems), print on legs/hips/back/arms where it makes sense. Gold and silver motifs are printed in METALLIC ink (use Pearl Gold #DCBC81 / Flat Silver #898788 / Metallic Silver #C0C4C8 exactly — the renderer makes them shiny).
ORIGINALITY: every figure must have at least one original, character-appropriate design idea of your own (the author touch) — not a copy of the examples.
EXAMPLES of good specs (style reference, adapt — do not copy blindly):
1) Baldwin IV (leper king): {"design":{"concept":"humble leper king: white robes, gold royal stole, forged silver mask","motifs":["gold stole down the centre and on both sleeves","gold belt band","silver mask","gold Jerusalem cross on the back"],"palette":["#F4F4F4","#E0E0E0","#DCBC81"]},"skin_color":"#F6D7B3","hand_color":"#F4F4F4","hands_are_gloves":true,"torso_color":"#F4F4F4","arm_color":"#F4F4F4","hip_color":"#F4F4F4","leg_color":"#F4F4F4","headgear":"hood","headgear_color":"#F4F4F4","neck_accessory":"cape","neck_accessory_color":"#F4F4F4","legs_type_rule":"LONG coats / trench coats / dresses / robes reaching the knees or ankles MUST use legs_type long_robe (or dress_slope / wide_skirt) in the coat colour — never plain legs","legs_type":"long_robe","face":{"mask":{"type":"metal_full","color":"#C0C4C8"}},"torso_print_svg":"<path d='M38,0 L50,30 L62,0' fill='#E0E0E0'/><rect x='44' y='0' width='12' height='100' fill='#DCBC81'/><rect x='0' y='62' width='100' height='6' fill='#DCBC81'/><path d='M50,40 v10 M45,45 h10' stroke='#F4F4F4' stroke-width='2'/>","arm_print_svg":"<rect x='0' y='70' width='100' height='8' fill='#DCBC81'/><rect x='0' y='90' width='100' height='10' fill='#E0E0E0'/>","torso_back_print_svg":"<rect x='0' y='62' width='100' height='6' fill='#DCBC81'/><path d='M46,14 h8 v12 h12 v8 h-12 v20 h-8 v-20 h-12 v-8 h12 z' fill='#DCBC81'/>","author_touch_uk":"Золотий єрусалимський хрест на спині."}
2) Medieval knight: {"design":{"concept":"crusader knight in mail with a red tabard","motifs":["white tabard with red cross","mail texture at the shoulders","brown belt with gold buckle"],"palette":["#A0A5A9","#F4F4F4","#C91A09","#DCBC81"]},"torso_color":"#A0A5A9","headgear":"helmet_knight","neck_accessory":"none","torso_print_svg":"<path d='M22,0 L78,0 L84,100 L16,100 Z' fill='#F4F4F4'/><rect x='45' y='18' width='10' height='50' fill='#C91A09'/><rect x='30' y='32' width='40' height='10' fill='#C91A09'/><rect x='16' y='74' width='68' height='6' fill='#582A12'/><rect x='46' y='73' width='8' height='8' fill='#DCBC81'/>","arm_print_svg":"<path d='M0,10 h100 M0,18 h100 M0,26 h100' stroke='#6C6E68' stroke-width='1'/>","torso_back_print_svg":"<path d='M22,0 L78,0 L84,100 L16,100 Z' fill='#F4F4F4'/><rect x='16' y='74' width='68' height='6' fill='#582A12'/>","accessories_3d":[{"type":"sword","kind":"long"},{"type":"shield","shape":"triangle","color":"#F4F4F4"}]}
3) Modern guy in a black hoodie: {"design":{"concept":"casual gamer","motifs":["hood drawstrings","kangaroo pocket","small logo"],"palette":["#1b1b1b","#6C6E68","#FE8A18"]},"torso_color":"#1b1b1b","torso_print_svg":"<path d='M40,0 Q50,14 60,0' fill='none' stroke='#6C6E68' stroke-width='2'/><path d='M45,6 v18 M55,6 v18' stroke='#F4F4F4' stroke-width='1.2'/><path d='M26,70 L74,70 L80,96 L20,96 Z' fill='none' stroke='#6C6E68' stroke-width='1.5'/><circle cx='68' cy='30' r='5' fill='#FE8A18'/>","arm_print_svg":"<rect x='0' y='88' width='100' height='12' fill='#6C6E68'/>"}`;

const SPEC_DOC = `Minifigure spec JSON (all colors as #rrggbb hex):
{"_identity_rule":"If the subject is a recognised character, ALL character-defining features (e.g. a metal mask, eye patch, scar, face paint, signature colours) MUST appear in the spec — masks/markings are PRINTED on the face via face.mask / face.face_extra_svg; when a mask hides the face set face.mask and the renderer skips official face prints",
 "design":{"concept":"STEP 1","motifs":["STEP 2"],"palette":["STEP 3 hex colours"]},
 "inspection":{"hair":"bangs?, length, partings, braids/ponytails/twin tails, ornaments+colors","face":"eye style/color, lashes, brows, lips, blush, marks","torso_front":"neckline shape, exposed skin areas (where exactly), collar, trims, lace, patterns, belts","torso_back":"","arms":"sleeve length/shape vs bare skin, cuffs, gloves","hips":"","legs":"skirt/dress hem height %, stockings/boots colors, top heights in % from hips (0) to feet (100), skin gaps, shoes","accessories":""},
 "identity":"","is_known_character":bool,
 "skin_color":"color of the FACE/HANDS SKIN only (never the hair!). Real-life humans (photos of ordinary or real people): classic LEGO yellow #F2CD37. Known fictional characters: their real skin color (pale/white humans: warm off-white like #F3E6E2, NOT bluish unless the skin is clearly blue in IMAGE A; green turtles #4B9F4A, etc.)",
 "hair_style":"SHORT ordinary hair => ALWAYS an official short piece (short / short_side). Otherwise pick the LEGO hairpiece closest to the silhouette — or \"sculpt\" when NO catalog piece really matches (natural loose curls, textured messy hair with a fringe on the forehead, long anime hair with distinct strands + bangs); then fill hair_sculpt. One of: sculpt|none|short|short_side|spiky|curly|bob|mid_length|long|long_straight|long_wavy|long_bangs|ponytail (ponytail+fringe)|ponytail_side (off-centre)|side_braid (long, braided on one side)|twin_tails (high pigtails + long bangs)|pigtails_braided|bun (low bun swept back, no fringe)|bun_low_fringe (LOW / messy bun at the BACK of the head with fringe or loose face-framing strands)|bun_high (large high bun on top, no fringe)|bun_fringe (HIGH top-knot bun ON TOP + fringe — only if the bun is really on top of the head)|cap|hood|helmet_knight|bandana_tails (bandana_tails = ninja-turtle mask band with tails; then hair_color = bandana color)",
 "head_mold":"standard (classic round head, default for humans) | turtle (TMNT turtle head mold, for ninja turtles) | snake (snake/reptile head mold, e.g. Serpentine). Special molds only when the character clearly is that creature",
 "headgear":"what is ON the head instead of hair (hair is then hidden). NOT everyone has hair: bald => headgear none + hair_style none. One of: none|cap (short peak)|cap_long|baseball_cap|cap_classic|cap_headphones (cap with ear protection)|helmet_knight (with neck protector)|helmet_castle (chin guard)|helmet_space (classic)|helmet_motorcycle|helmet_construction|helmet_police|helmet_pilot (Star Wars rebel pilot)|aviator_goggles (leather pilot cap WITH aviator goggles on it — the ONLY way to have goggles)|fedora|cowboy|wizard|newsboy|top_hat|beanie|hood|hood_fur|cowl (medieval hood)|bandana|ninja_wrap",
 "headgear_color":"#hex or null","headgear_secondary_color":"#hex (e.g. goggles frame color) or null",
 "neck_accessory":"piece worn between head and torso, choose what fits the character: none|cape (superheroes, kings, wizards)|armor_breastplate (knights)|shoulder_pads (warriors, villains)|life_vest (rescuers, sailors)|life_jacket|vest (classic open vest)|epaulettes (officers)|turtle_shell (ninja turtles)",
 "neck_accessory_color":"#hex or null",
 "legs_type":"standard|short (children, short characters)|mermaid_tail|snake_tail (Ninjago serpentine tail, coiled base)|genie_tail (djinn/ghost wisp tail, e.g. Nadakhan, ghosts)|skirt (cloth skirt over legs; set skirt_color, leg_color = legs/boots color)|long_robe|wide_skirt (ball gown)|dress_slope (classic long dress / robe from a slope brick)","skirt_color":"#hex or null",
 "double_torso":"true ONLY for 4-armed characters (e.g. Lord Garmadon): two torsos stacked, 4 arms",
 "torso2_color":"#hex (lower torso when double_torso) or null","torso2_print_svg":"optional SVG 0..100 for the lower torso front, or null",
 "hair_color":"","hair_secondary_color":"optional: cap brim / helmet plume color or null",
 "hair_sculpt":"only for hair_style sculpt: {\"kind\":\"curls|messy|long\",\"length\":\"short|mid|long\",\"fringe\":\"none|side|straight|messy\",\"volume\":0..1} — convert the REAL hairstyle into a LEGO sculpted piece (curls: loose longer curls, not a perfect round afro)","bust_size":"female figures, judge the REFERENCE honestly: none|small|medium|large (large = clearly big/pronounced bust e.g. busty anime; medium = average; small = flat/slight; none = not visible/irrelevant). The bust is ALWAYS a PRINT (never a 3D part) chosen by the renderer from this size, at torso y 30..47 (x 22..78). Design the clothing print AROUND it: neckline/collar above y 30, seams continuing below y 47; never draw your own breast circles","outfit_corset":"true ONLY if the outfit really has a corset/bustier/laced bodice, else false","bare_torso":"true if the subject is shirtless (torso printed in skin colour with subtle pecs/abs; arms+hands skin too)","footwear":"REQUIRED, look at the feet: {\"type\":\"barefoot|flip-flops|sandals|sneakers|boots|shoes\",\"color\":\"#hex main\",\"sole_color\":\"#hex\",\"strap_color\":\"#hex (flip-flops/sandals)\",\"secondary_color\":\"#hex second strap/stripe colour or null\"} — the renderer prints the feet from this; do not draw shoes in legs_print_svg","body_build":"for bare_torso: slim|athletic|heavy — judge the real physique in the photo (visible abs/muscle => athletic, soft belly => heavy, thin => slim)","chest_hair":"for bare_torso: none|light|medium|heavy (only if visible)","chest_hair_color":"hex or null","layers":"OPEN/unbuttoned shirt or jacket worn over another top: {\"outer\":{\"type\":\"open_shirt|open_jacket|open_hoodie\",\"color\":\"#hex\",\"pattern\":\"plain|stripes|check\",\"pattern_color\":\"#hex\"},\"under\":{\"type\":\"tee|tank|shirt\",\"color\":\"#hex\"}} — the renderer prints outer panels at the sides with the undershirt in the centre and the pattern on the sleeves; null if a single closed garment","sleeves":"long|short|none — short-sleeve shirts MUST be short (upper arm shirt colour, lower arm skin)","belt":"visible belt: {\"color\":\"#hex\",\"buckle_color\":\"#hex\"} or null","face":{"_style":"ALWAYS an authentic official LEGO minifigure face print (small black bean eyes with white glint, thin short brows, small mouth), even for anime/realistic art","gender":"male|female","age":"young|adult|old","expression":"smile|grin (open, white teeth)|laugh|neutral|serious|smirk|angry|surprised (open mouth)|tongue (tongue sticking out — cheeky/playful)|wink|worried — match the photo EXACTLY: neutral / pursed lips / duck lips / serious => neutral (NEVER a smile)","brows":true,"brows_thick":false,"brow_color":"dark hex","lipstick":"lip color for female (LEGO red/pink) or null","cheeks":"soft blush hex or null","freckles":false,"cheek_lines":"true for dimples/smile lines","stubble":false,"beard":"none|stubble|full|goatee|mustache","beard_color":"","mask":"printed face mask ON the head (never a separate part) or null: {\"type\":\"metal_full (full metal/iron/silver mask with eye holes, e.g. Baldwin IV)|half_mask_lower (covers nose+mouth)|domino (eye mask)|balaclava|face_paint\",\"color\":\"#hex (silver #C0C4C8, iron #6C6E68, gold #DCBC81, black)\",\"secondary_color\":\"#hex or null\"}","face_extra_svg":"optional SVG elements in a 0..100 box over the face for other character-defining face markings (scars, tattoos, war paint, lesions) or null","glasses":"none|round|rectangular|sunglasses — match the FRAME SHAPE in the photo","nose":"none|small (a short LEGO nose line — use when the nose is distinctive)","eye_size":"normal|large","eye_color":"iris colour hex if clearly non-brown (e.g. teal #3FB6A8 for anime) or null","glasses_color":"","eye_mask":"hex color of a mask/bandana band over the eyes, or null","ink_color":"#1b1b1b","extra_svg":"optional small SVG elements in head coordinates (head box x 111..193, y 43..129; eyes at y=86, x=138 and 166; mouth y≈106) e.g. freckles, scars, or null"},
 "torso_color":"the MAIN clothing color of the torso; areas of bare skin (neckline cutouts, off-shoulder, collarbone) must be drawn as skin-colored shapes in torso_print_svg","collar":"none|high|turtleneck|shirt|cape (drawn by the renderer around the neck)","collar_color":"hex or null (default torso color)","torso_print_svg":"SVG elements (no <svg> wrapper) in a 0..100 x 0..100 box covering the torso front. The torso is a trapezoid: top edge spans x 14..86, bottom edge full width 0..100; the neck is at top center x 38..62. Draw the clothing print: collars (e.g. high collar), lapels, buttons, zips, belts, logos, armor plates, shell plastron etc. Use fill colors in hex, simple shapes, 5-40 elements, no text unless a logo letter",
 "arm_color":"sleeve color (skin color if bare arms)","hand_color":"usually skin color; glove color if gloves",
 "arm_print_svg":"SVG in 0..100 box for ONE arm, used IDENTICALLY (mirrored) on BOTH arms and wrapped around the FULL circumference of the sleeve like real fabric (x = around the arm, y 0 = shoulder, 100 = wrist): draw sleeve patterns as full-width horizontal bands/stripes/cuffs spanning x 0..100, shoulder to hand: bare-skin shoulder area in skin color, sleeve cuffs, trims, flared sleeve ends; null if plain",
 "hip_color":"","leg_color":"","leg_right_color":"null unless legs differ","legs_print_svg":"SVG elements in 0..100 box covering hips+both legs (hips y 0..29, left leg x 0..46, right leg x 54..100, y 29..100): dress/skirt hem, belts, pockets, stockings, thigh-high boots with visible skin gap (skin-colored band at the right height), boot tops/cuffs, shoes (color the lower part); use the heights from inspection.legs. Or null",
 "hands_are_gloves":false,
 "torso_graphic_box":"if the shirt/torso has a colorful printed graphic/logo (t-shirt print), its bounding box in IMAGE A as [ymin,xmin,ymax,xmax] normalized 0-1000 (tight around the graphic only); else null",
 "torso_graphic_rect":"where to put that graphic on the torso in torso 0..100 coords [x,y,w,h], e.g. [24,18,52,58]; null if no graphic",
 "accessories_3d":"array of 3D accessories actually worn/held, each {\"type\":\"headphones|backpack|sword|shield|hair_ornament|bag\",\"style\":\"for bag: held|crossbody|belt\",\"shape\":\"for shield: triangle|round|oval\",\"kind\":\"for sword: short|long\",\"color\":\"#hex\",\"secondary_color\":\"#hex or null\"}; [] if none. Over-ear headphones => headphones (color = ear cup color, secondary = headband color). Use hair_style none for bald people",
 "author_touch_uk":"ALWAYS: one short Ukrainian sentence describing a tasteful extra creative print you add that fits the character (not visible in the photo), e.g. small emblem on the back, accent stripe on the legs, tiny logo on the hips",
 "torso_back_print_svg":"REQUIRED when the clothing is not plain: SVG elements in 0..100 box for the torso BACK. Clothing wraps around the body like real LEGO prints: a jacket/coat/shirt/armor printed on the front MUST continue on the back (back of the jacket, seams, collar from behind, belt, hem, straps) — infer the hidden side logically even if not visible in the photo. Never draw a separate backpiece; it is printed on the torso itself. The author touch may add a small emblem here.",
 "hips_print_svg":"SVG elements in 0..100 box over the hips front band (author touch: e.g. a small logo or belt buckle), or null",
 "accessories_uk":"accessories in Ukrainian","notes_uk":"short Ukrainian description of design choices"}`;

// deterministic post-rules that fix common model misses (run after every spec)
function postRules(sp, description) { if (!sp) return sp; const D = JSON.stringify([description || {}, sp.inspection, sp.notes_uk, sp.design, sp.identity, sp.appearance_note]).toLowerCase(); const f = sp.face = sp.face || {};
  const ex = String(description?.attrs?.expression || '') + ' ' + String(description?.face || '') + ' ' + JSON.stringify(sp.inspection?.face || '');
  if (/tongue|язик/i.test(ex)) f.expression = 'tongue';
  else if (/wink|підмор/i.test(ex)) f.expression = 'wink';
  else if (/surpris|open mouth|відкрит|здивован|shock/i.test(ex) && (!f.expression || /neutral|smile|grin/.test(f.expression))) f.expression = 'surprised';
  if (/serious|серйозн|stern|суворий/i.test(ex) && /smile|grin|laugh/.test(f.expression || '')) f.expression = 'neutral';
  if (!f.eye_color && /(teal|turquoise|бірюзов|aqua|cyan)[^"]{0,25}(eye|оч)|(eye|оч)[^"]{0,25}(teal|turquoise|бірюзов|aqua|cyan)/.test(D)) f.eye_color = '#3FB6A8';
  if (f.eye_color && /(teal|turquoise|бірюзов|aqua|cyan)[^"]{0,25}(eye|оч)|(eye|оч)[^"]{0,25}(teal|turquoise|бірюзов|aqua|cyan)/.test(D)) f.eye_color = '#3FB6A8';
  const fem = f.gender === 'female' || /female|woman|girl|жінк|дівчин/.test(String(description?.attrs?.gender || ''));
  if (fem) { f.gender = 'female'; const stylised = /anime|manga|genshin|honkai|game|гра|аніме|cartoon|waifu|maid|armou?r|корсет|corset|busty|large bust|об'ємн/.test(D);
    if (!['none', 'small', 'medium', 'large'].includes(sp.bust_size)) sp.bust_size = /large bust|busty|prominent|великі груди|об'ємн/.test(D) ? 'large' : (sp.bust === 'prominent' ? 'large' : 'medium');
    if (/корсет|corset|bustier|laced bodice/.test(D)) sp.outfit_corset = true;
    sp.bust = sp.bust_size === 'large' ? 'prominent' : 'subtle'; void stylised; }
  if (/\blong\b|довг|до пояса|waist/i.test(String(description?.hair || '') + String(description?.attrs?.hair_style || '') + JSON.stringify(sp.inspection?.hair || '')) && ['long_bangs', 'mid_length', 'bob', 'long_straight', 'long'].includes(sp.hair_style) && (sp.bust === 'prominent' || /anime|game|genshin|honkai|аніме|strand|пасм/.test(D))) { sp.hair_style = 'sculpt'; sp.hair_sculpt = { kind: 'long', length: 'long', fringe: /fringe|bangs|чубч|чолк/.test(D) ? 'straight' : 'side', volume: 0.6 }; }
  if (/maid head|headpiece|headdress|head ?band|tiara|ободок|діадем/.test(D) && (!sp.headgear || sp.headgear === 'none') ) { const ho = (sp.accessories_3d || []).find(x => x && x.type === 'hair_ornament'); if (ho) { if (!ho.style || ho.style === 'none') ho.style = 'headband'; } else (sp.accessories_3d = Array.isArray(sp.accessories_3d) ? sp.accessories_3d : []).push({ type: 'hair_ornament', color: '#F4F4F4', secondary_color: '#1b1b1b', style: 'headband' }); }
  if (!sp.footwear || typeof sp.footwear !== 'object') { const fd = String(description?.attrs?.footwear || description?.legs || '').toLowerCase(); const col = n => ({ black: '#1b1b1b', white: '#F4F4F4', red: '#C91A09', yellow: '#F2CD37', blue: '#0055BF', brown: '#582A12', gray: '#A0A5A9', grey: '#A0A5A9', green: '#237841' })[n];
    const cs = (fd.match(/black|white|red|yellow|blue|brown|gr[ae]y|green/g) || []).map(col); const ty = (fd.match(/flip-?flops?|sandals?|sneakers?|boots?|shoes?|barefoot/) || [])[0];
    if (ty) sp.footwear = { type: ty.replace(/s$/, '').replace('flip-flop', 'flip-flops'), color: cs[0] || '#1b1b1b', sole_color: cs[0] || '#1b1b1b', strap_color: cs[1] || cs[0] || '#1b1b1b', secondary_color: cs[2] || null }; }
  if (sp.bare_torso === true && !sp._briefs_done) { sp._briefs_done = true; // ONE briefs print on hips + top of legs; no AI torso/leg prints (avoids doubled underwear, shoe stripes on bare feet)
    const lum = c => { const n = parseInt(String(c || '#000').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; };
    const bc = sp.briefs_color && lum(sp.briefs_color) < 0.4 ? sp.briefs_color : sp.hip_color && sp.hip_color !== sp.skin_color && lum(sp.hip_color) < 0.4 ? sp.hip_color : '#35363A', wb = sp.briefs_waistband_color || '#A0A5A9';
    sp.torso_print_svg = null; sp.torso_back_print_svg = null; sp.hips_print_svg = null; sp.hip_color = bc; sp.legs_type = 'standard'; sp.leg_color = sp.skin_color; sp.leg_right_color = null;
    const keepFeet = sp.legs_print_svg ? `<defs><clipPath id='feetclip'><rect x='0' y='46' width='100' height='54'/></clipPath></defs><g clip-path='url(#feetclip)'>${String(sp.legs_print_svg).replace(/<\/?svg[^>]*>/g, '')}</g>` : '';
    sp.legs_print_svg = keepFeet + `<rect x='0' y='29' width='100' height='12' fill='${bc}'/><path d='M0,41 Q23,46 46,41 M54,41 Q77,46 100,41' stroke='${bc}' stroke-width='3' fill='none'/>`;
    sp.hips_print_svg = `<rect x='0' y='0' width='100' height='20' fill='${wb}'/><rect x='0' y='20' width='100' height='80' fill='${bc}'/>`; }
  if (sp.bare_torso === true) { const skinish = c => /^#(f6d7b3|d09168|e4cd9e|f3e6e2|ffc995|cc8e69|aa7d55|f2cd37|ffe1b5|fcc39e)$/i.test(c || ''); if (skinish(sp.leg_color)) sp.leg_color = sp.skin_color; if (skinish(sp.leg_right_color)) sp.leg_right_color = sp.skin_color; if (skinish(sp.hip_color)) sp.hip_color = sp.skin_color; }
  return sp; }
const LOCKMAP = { 'Голова': ['face', 'head_part', 'head_part_title', 'head_part_why_uk', 'skin_color', 'head_mold'], 'Волосся': ['hair_style', 'hair_color', 'hair_secondary_color'], 'Головний убір': ['headgear', 'headgear_color'],
  'Плащ / броня': ['neck_accessory', 'neck_accessory_color'], 'Торс': ['torso_color', 'torso_print_svg', 'torso_back_print_svg', 'collar', 'collar_color', 'torso_graphic_png', 'torso_graphic_box', 'double_torso', 'torso2'],
  'Рука': ['arm_color', 'arm_print_svg'], 'Кисть': ['hand_color', 'hands_are_gloves'], 'Низ / ноги': ['legs_type', 'hip_color', 'leg_color', 'leg_right_color', 'legs_print_svg', 'hips_print_svg', 'skirt_color'], 'Аксесуар': ['accessories_3d'] };
function lockedFields(lock_from, roles) {
  if (!lock_from || !/^[0-9]+-[a-z0-9]{4}$/.test(lock_from) || !Array.isArray(roles) || !roles.length) return null;
  let old; try { old = JSON.parse(require('fs').readFileSync(__dirname + '/out/' + lock_from + '.json', 'utf8')); } catch { return null; }
  const f = {}; for (const r of roles) for (const k of (LOCKMAP[r] || [])) if (old[k] !== undefined) f[k] = old[k]; return Object.keys(f).length ? f : null;
}
app.post('/api/generate', wrap(async ({ image, mime, crop, subject, description, lock_from, locked_roles }, stage = () => {}) => {
  const FIXED = lockedFields(lock_from, locked_roles);
  const T0 = Date.now(); const el = () => ((Date.now() - T0) / 1000).toFixed(1) + ' с';
  const cr = crop ? { data: crop, mime: 'image/jpeg' } : { data: image, mime: mime || 'image/jpeg' };
  const steps = []; const step = m => { steps.push(`[${el()}] ${m}`); stage(m); };
  step('1/5 Аналізую обраного персонажа…');
  const idj = await gem(TEXT_MODELS, { contents: [{ parts: [img(cr.data, cr.mime), { text: `Hint from earlier analysis: ${JSON.stringify(description || {}).slice(0, 800)}.
Identify this subject. Return JSON {"is_known_character":bool (fictional character from a movie/animated series/game/comic, or a famous real person),"character_name":"","identity":"e.g. Lyra (Men in Black: The Series)","franchise":"","medium":"animated|live-action|game|comic|photo","fandom_wiki":"the real existing fandom.com wiki subdomain for this franchise (e.g. tmnt → turtlepedia, Star Wars → starwars, Men in Black → meninblack)","fandom_wiki_alternatives":["2-3 more plausible subdomains"],"wikipedia_title":"or null","is_real_photo_of_real_person":bool}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { timeout: 10000 });
  const id = parseJSON(txt(idj));
  let refs = [];
  if (id.is_known_character) {
    step(`2/5 Шукаю референси «${id.identity || id.character_name}»…`);
    refs = (await Promise.all((await findReferences(id)).slice(0, 6).map(r => fetchImageB64(r.url).then(b => ({ ...r, b })).catch(() => null)))).filter(Boolean).slice(0, 4);
  } else step('2/5 Реальна людина / невідомий персонаж — працюю лише з фото.');
  step(`3/5 Gemini складає специфікацію фігурки${refs.length ? ` (порівнює з ${refs.length} референсами)` : ''}…`);
  const parts = [{ text: 'IMAGE A = the user-selected subject (this has priority):' }, img(cr.data, cr.mime)];
  refs.forEach((r, i) => parts.push({ text: `REFERENCE ${i + 1} (${r.source}: ${r.title}):` }, img(r.b.data, r.b.mime)));
  parts.push({ text: `Assumed identity: ${JSON.stringify(id)}.
${refs.length ? `First decide which references show the SAME character in the SAME depiction/medium as IMAGE A (e.g. animated vs live-action actor are different!). List their numbers in "refs_matching" as an array of integers (1-based); ignore all others completely.` : ''}
First fill "inspection" region by region (look carefully at IMAGE A), then design an official-style LEGO minifigure of the subject in IMAGE A that reproduces EVERY inspected detail as prints: skin-colored neckline/shoulder areas, trims, lace, sleeve shapes on arms, skirt hems, stockings/boot tops with skin gaps, hair ornaments as accessories_3d. Prints must be detailed (15-40 shapes on torso). Be careful: hair color is NOT skin color (e.g. blue hair + pale skin => skin pale, hair blue). Pick the hair_style closest to the hair silhouette. Encode clothing details into torso_print_svg and legs_print_svg.
${DESIGN_GUIDE}
${SPEC_DOC}
${FIXED ? `LOCKED PARTS (the user locked them — copy these values EXACTLY, design everything else to fit them): ${JSON.stringify({ ...FIXED, torso_graphic_png: undefined }).slice(0, 6000)}\n` : ''}Return ONLY the JSON, plus "refs_matching":[integers only, e.g. [1,3]] and "checklist":["4-6 key visual features to verify"].` });
  const sj = await gem(TEXT_MODELS, { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.15, seed: 4242 } }, { timeout: 40000, budget: 55000 });
  let spec = parseJSON(txt(sj));
  if (!id.is_known_character) { // ordinary real people → classic LEGO yellow skin
    const old = spec.skin_color; spec.skin_color = '#F2CD37'; if (!spec.hand_color || spec.hand_color === old) spec.hand_color = '#F2CD37'; if (spec.arm_color === old) spec.arm_color = '#F2CD37'; }
  const fixHands = sp => { if (sp && sp.hands_are_gloves !== true && sp.skin_color) sp.hand_color = sp.skin_color; normSpec(sp); };
  function normSpec(sp) { if (!sp) return;
    postRules(sp, description);
    if (sp.face && sp.face.gender === 'female' && !['subtle', 'prominent'].includes(sp.bust)) sp.bust = 'subtle';
    if (sp.face && sp.face.gender !== 'female') { delete sp.bust; delete sp.bust_size; delete sp.outfit_corset; }
    if (sp.face && sp.face.glasses === 'square') sp.face.glasses = 'rectangular';
    if (sp.face && sp.face.expression === 'serious') sp.face.expression = 'neutral';
    if (sp.bare_torso === true || sp.bare_torso === 'true') { sp.bare_torso = true; sp.torso_color = sp.skin_color; sp.arm_color = sp.skin_color; sp.hand_color = sp.skin_color; sp.sleeves = 'none'; }
    if (sp.sleeves === 'short' && sp.torso_color && (!sp.arm_color || sp.arm_color === sp.skin_color)) sp.arm_color = sp.torso_color;
    { const TD = (String(description?.torso || '') + ' ' + String(description?.attrs?.torso_print || '')).toLowerCase();
      if (!sp.layers && /open|unbutton|розстеб|накинут/.test(TD) && /t-shirt|tee|tank|футболк|майк/.test(TD)) sp.layers = { outer: { type: 'open_shirt', color: sp.arm_color || sp.torso_color || '#1b1b1b', pattern: /stripe|смуг/.test(TD) ? 'stripes' : /check|plaid|клітин/.test(TD) ? 'check' : 'plain', pattern_color: '#F4F4F4' }, under: { type: 'tee', color: /white|біл/.test(TD) ? '#F4F4F4' : '#F4F4F4' } };
      if (sp.layers && !sp.layers.outer) sp.layers = null; }
    { const HD = (String(description?.hair || '') + ' ' + String(description?.attrs?.hair_style || '')).toLowerCase();
      const shortH = /short|buzz|crew|fade|undercut|side.?part|коротк|стрижк/.test(HD), special = /curl|afro|dread|braid|mohawk|long|кучер|довг|spiky|anime/.test(HD);
      if (shortH && !special && (sp.hair_style === 'sculpt' || !sp.hair_style)) { sp.hair_style = /side|part|збоку|набік/.test(HD) ? 'short_side' : 'short'; delete sp.hair_sculpt; } }
    if (sp.hair_style === 'sculpt' && (!sp.hair_sculpt || typeof sp.hair_sculpt !== 'object')) sp.hair_sculpt = { kind: 'messy', length: 'short', fringe: 'side', volume: 0.5 };
    // long coats / trench coats / dresses / robes reaching knees-ankles => long skirt piece in coat colour
    const lt = JSON.stringify([sp.inspection?.legs, sp.inspection?.torso_front, sp.notes_uk, sp.design?.concept, sp.torso_desc, description?.torso, description?.legs]).toLowerCase();
    if ((!sp.legs_type || sp.legs_type === 'standard') && /trench|long coat|overcoat|maxi|gown|robe|cassock|duster|knee[- ]length coat|ankle[- ]length|floor[- ]length|long dress|long skirt|довг(ий|е|а) (плащ|пальто|сукн|спідниц)|тренч/.test(lt)) { sp.legs_type = 'long_robe'; sp.skirt_color = sp.skirt_color || sp.torso_color; log('normSpec: long coat/dress -> long_robe'); }
    // LEGO skin palette snap (real LEGO colours; avoids pinkish custom tones)
    const LCOL = ['#F2CD37','#F6D7B3','#D09168','#AA7D55','#CC702A','#7C503A','#352100','#F4F4F4','#4B9F4A','#0055BF','#A0A5A9','#6C6E68','#1b1b1b','#C91A09','#720E0F','#0A3463','#237841','#184632','#E4CD9E','#958A73','#582A12','#DCBC81','#898788','#FE8A18','#C870A0','#008F9B','#5A93DB','#E4ADC8'];
    const rgb = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const near = (h, list) => { if (!/^#[0-9a-f]{6}$/i.test(h || '')) return h; const a = rgb(h); let b = list[0], bd = 1e9; for (const c of list) { const q = rgb(c); const d = (a[0] - q[0]) ** 2 * 0.3 + (a[1] - q[1]) ** 2 * 0.59 + (a[2] - q[2]) ** 2 * 0.11; if (d < bd) { bd = d; b = c; } } return b; };
    for (const k of ['skin_color', 'hand_color']) if (sp[k]) sp[k] = near(sp[k], LCOL);
    if (sp.hands_are_gloves !== true && sp.skin_color) sp.hand_color = sp.skin_color;
    // print palette: snap every colour in print SVGs to the design palette (+ main colours, black, white) => harmonious, no stray tones
    const pal = [...new Set([...(Array.isArray(sp.design?.palette) ? sp.design.palette : []), sp.torso_color, sp.arm_color, sp.leg_color, sp.skin_color, '#1b1b1b', '#F4F4F4'].filter(c => /^#[0-9a-f]{6}$/i.test(c || '')))];
    if (pal.length >= 4) for (const k of ['torso_print_svg', 'torso_back_print_svg', 'arm_print_svg', 'legs_print_svg', 'hips_print_svg', 'torso2_print_svg']) if (typeof sp[k] === 'string') sp[k] = sp[k].replace(/#[0-9a-fA-F]{6}\b/g, h => near(h, pal));
    // reject filler prints: many tiny unrelated rectangles/polygons with no centred motif => drop to a clean garment print
    for (const k of ['torso_print_svg']) { const v = sp[k]; if (typeof v !== 'string') continue; const rects = (v.match(/<rect\b/g) || []).length, all = (v.match(/<(rect|path|circle|ellipse|polygon|line)\b/g) || []).length;
      const xs = [...v.matchAll(/x=['"]([\d.]+)['"][^>]*width=['"]([\d.]+)['"]/g)].map(m => +m[1] + +m[2] / 2); const centred = xs.some(c => Math.abs(c - 50) < 8) || /M\s*3\d|50/.test(v);
      if (all > 28 || (rects >= 6 && rects / all > 0.7 && !centred)) { log('print rejected as filler', k, all, rects); sp[k + '_rejected'] = true; sp[k] = v.split(/(?=<)/).slice(0, 12).join(''); } } const acc = Array.isArray(sp.accessories_3d) ? sp.accessories_3d : [];
    // glasses are never a separate part: printed on the face (goggles only via headgear aviator_goggles)
    const gl = acc.find(a => a && /glass|goggle/.test(a.type || '')); if (gl) { sp.face = sp.face || {}; if (!sp.face.glasses || sp.face.glasses === 'none') sp.face.glasses = /sun/.test(JSON.stringify(gl)) ? 'sunglasses' : 'round'; if (gl.color && !sp.face.glasses_color) sp.face.glasses_color = gl.color; }
    const cap = acc.find(a => a && a.type === 'cap'); if (cap && (!sp.headgear || sp.headgear === 'none')) { sp.headgear = 'cap'; sp.headgear_color = sp.headgear_color || cap.color; }
    sp.accessories_3d = acc.filter(a => a && !/glass|goggle|^cap$/.test(a.type || ''));
    if (['cap', 'hood', 'helmet_knight'].includes(sp.hair_style) && (!sp.headgear || sp.headgear === 'none')) { sp.headgear = sp.hair_style; sp.headgear_color = sp.headgear_color || sp.hair_color; }
  }
  fixHands(spec);
  const matching = (Array.isArray(spec.refs_matching) ? spec.refs_matching : []).map(Number).filter(n => Number.isInteger(n));
  const usedRefs = refs.filter((r, i) => matching.includes(i + 1)).map(({ b, ...r }) => r);
  log('refs', refs.length, 'matching', JSON.stringify(spec.refs_matching), 'wiki', id.fandom_wiki, id.fandom_wiki_alternatives);
  step('4/5 Вирізаю принт з фото й рендерю…');
  await addGraphic(spec, cr);
  // ordinary people get a COMPOSITE face (official-style layers: eyes/lashes, brows, mouth/lips, glasses) — whole official heads only for known characters
  if (id.is_known_character && !(spec.face && spec.face.eye_color)) try { const fp = await pickFace(spec, cr); if (fp) { spec.head_part = fp.part; spec.head_part_title = fp.title; spec.head_part_why_uk = fp.why_uk; } } catch (e) { log('pickFace', e.message); }
  let r1 = minifig.renderPng(spec);
  step('5/5 Gemini перевіряє рендер і виправляє специфікацію…');
  let final = r1, spec2 = null, verdict = null;
  try {
    const vj = await gem(SPEC_MODELS, { contents: [{ parts: [{ text: 'IMAGE A = original subject:' }, img(cr.data, cr.mime), { text: 'IMAGE B = rendered LEGO minifigure from the spec below:' }, img(r1.png.toString('base64'), 'image/png'),
      { text: `Current spec: ${JSON.stringify({ ...spec, torso_graphic_png: undefined })}
Also rate "hair_match" 0-10 (silhouette, length, curls/texture, fringe). If hair_match < 6 and the hair is long/curly/unusual, set corrected_spec.hair_style "sculpt" (short ordinary hair: always a standard official LEGO short hairpiece, never sculpt) with a hair_sculpt object describing the real hairstyle. Check female bust_size (none|small|medium|large, as in A) and outfit_corset, short sleeves, belt, glasses frame shape, eye colour, bare torso skin consistency. Compare B with A strictly (score 10 only if nothing could be improved; typical good result 7-8). First list every visible detail of A that is MISSING or wrong in B (hair shape/ornaments, face, neckline & exposed skin, trims, sleeves, skirt/stockings/boots, accessories) and add them to corrected_spec prints. Check skin color (must not be the hair color), hair style/color, face print (eyes, lipstick, glasses, beard, masks), torso colors and print, arms/hands, legs. Return JSON {"score":0-10,"problems_uk":"short Ukrainian list","corrected_spec":{...full corrected spec in the same format, or null if score>=9}}.
${DESIGN_GUIDE}
${SPEC_DOC}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { timeout: 25000, budget: 35000 });
    verdict = parseJSON(txt(vj));
    if (verdict.corrected_spec && typeof verdict.corrected_spec === 'object') { spec2 = { ...spec, ...verdict.corrected_spec, face: { ...(spec.face || {}), ...(verdict.corrected_spec.face || {}) } };
      if (JSON.stringify(spec2.torso_graphic_box) !== JSON.stringify(spec.torso_graphic_box)) await addGraphic(spec2, cr); else if (spec.torso_graphic_png) spec2.torso_graphic_png = spec.torso_graphic_png;
      if (!id.is_known_character) { const o = spec2.skin_color; spec2.skin_color = '#F2CD37'; if (spec2.hand_color === o) spec2.hand_color = '#F2CD37'; if (spec2.arm_color === o) spec2.arm_color = '#F2CD37'; } fixHands(spec2); for (const k of ['torso_graphic_box', 'torso_graphic_rect', 'author_touch_uk', 'torso_back_print_svg', 'hips_print_svg', 'accessories_3d', 'arm_print_svg', 'inspection', 'head_part', 'head_part_title', 'head_part_why_uk']) if (spec2[k] == null && spec[k] != null) spec2[k] = spec[k]; }
  } catch (e) { log('verify fail', e.message); }
  if (FIXED) { Object.assign(spec, FIXED); if (spec2) Object.assign(spec2, FIXED); log('locked parts kept', Object.keys(FIXED).join(',')); }
  steps.push(`[${el()}] Готово`);
  const fs = require('fs'); const outDir = __dirname + '/out'; fs.mkdirSync(outDir, { recursive: true });
  const fname = Date.now() + '-' + Math.random().toString(36).slice(2, 6); fs.writeFileSync(`${outDir}/${fname}.png`, final.png);
  try { const fs3 = { ...(spec2 || spec) }; fs3.textures = minifig.textures(fs3); fs.writeFileSync(`${outDir}/${fname}.json`, JSON.stringify(fs3)); } catch (e) { log('tex fail', e.message); }
  return { image: final.png.toString('base64'), mime: 'image/png', first_render: spec2 ? r1.png.toString('base64') : null, source: 'Шаблонний рендер (пропорції класичної мініфігурки) + специфікація Gemini',
    spec: { ...(spec2 || spec), torso_graphic_png: (spec2 || spec).torso_graphic_png ? '(PNG з фото)' : undefined }, verdict, author_touch_uk: (spec2 || spec).author_touch_uk, identity: (spec2 || spec).identity || id.identity, identity_confirmed: usedRefs.length > 0, checklist: spec.checklist, references: usedRefs, references_rejected: refs.filter((r, i) => !matching.includes(i + 1)).map(({ b, ...r }) => r),
    appearance_uk: { 'Шкіра': (spec2 || spec).skin_color, 'Зачіска': `${(spec2 || spec).hair_style} ${(spec2 || spec).hair_color}`, 'Тулуб': (spec2 || spec).torso_color, 'Руки': `${(spec2 || spec).arm_color} / кисті ${(spec2 || spec).hand_color}`, 'Ноги': (spec2 || spec).leg_color, 'Аксесуари': (spec2 || spec).accessories_uk, 'Авторський штрих': (spec2 || spec).author_touch_uk, 'Офіційний друк обличчя': (spec2 || spec).head_part ? `${(spec2 || spec).head_part} — ${(spec2 || spec).head_part_title}` : 'намальоване обличчя (запасний варіант)', 'Примітки': (spec2 || spec).notes_uk },
    steps, seconds: +((Date.now() - T0) / 1000).toFixed(1), score: verdict?.score ?? null, file: `out/${fname}.png`, viewer3d: `/viewer3d.html?id=${fname}` };
}));

app.get('/healthz', (req, res) => res.send('ok'));
app.listen(process.env.PORT || 8787, () => logger.info({ evt: 'start', accounts: require('./lib/sec/auth').enabled() }, 'up'));
