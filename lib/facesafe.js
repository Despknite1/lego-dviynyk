// Безпечні обличчя: відсіює невідповідні голови LEGO з каталогу, підбирає найкращу
// голову під опис і «чистить» намальоване обличчя від зайвого.
// Face quality rules: "less similar but pleasant beats ugly".
//  1) official printed heads (faces/catalog.json): only a curated safe subset (no printed hair/headsets/eye patches, no monsters, tears, crossed eyes ...)
//  2) composite (drawn) faces: sanitizeFace() removes overlapping / odd combinations and returns a sanity score 0..100
//  3) whenever the score stays low => simplest friendly face by gender/expression (simpleFace)
const { Resvg } = require('@resvg/resvg-js');

// ---------------- official heads ----------------
// never used (visually reviewed in /workspace/qa2/faces_catalog_*.png): printed hair/headgear/eyepatch, monsters, tears, odd eyes/mouths, scary or messy prints
const BAN_PARTS = new Set(('3626bp0d 3626bp0j 3626bp0k 3626bp0l 3626bp35 3626bp48 3626bp49 3626bp4c 3626bp4d 3626bp4e 3626bp4f 3626bp4h 3626bp4j 3626bp4k 3626bp4l 3626bp4m ' +
  '3626bp51 3626bp52 3626bp54 3626bp55 3626bp56 3626bp61 3626bp62 3626bp65 3626bp66 3626bp67 3626bp68 3626bp69 3626bp6a 3626bp6b 3626bp6y 3626bp7a 3626bp7f 3626bp81 3626bp82 3626bp89 ' +
  '3626bp8g 3626bp8n 3626bpa4 3626bpa6 3626bpa9 3626bpaa 3626bpab 3626bpao 3626bpb1 3626bpb3 3626bpb5 3626bpb7 3626bpc15 3626bpc25 3626bpc33 3626bpc42 3626bpn1 3626bps1 3626bpsn 3626bpsp ' +
  '3626bpw0 3626bpw1 3626bpw2 3626bpw3 3626bpw8 3626bpw9 3626cp02 3626cp06 3626cp09 3626cp0a 3626cp0l 3626cp0o 3626cp0y 3626cp16 3626cp20 3626cp77 3626cp78 3626cp7i 3626cp82 3626cp8f 3626cp89 3626bp41 3626bp3e ' +
  '3626bp3n 3626bp3q 3626bp3r 3626bp06 3626bp86').split(' '));
// character specific heads: allowed only when the identity text matches
const FRANCHISE = [[/^3626bph/, /harry potter|hogwarts|wizarding|malfoy|dumbledore|snape|hagrid|weasley|voldemort|hermione|goyle|crabbe/i],
  [/^3626bpm/, /lord of the rings|lotr|hobbit|uruk|mordor|orc/i], [/^3626bps[0-9a-z]$/, /star wars|jedi|sith|rebel|clone|mandalorian|tatooine|vader|maul|tusken/i], [/^3626bpsc$|^3626bpsd$/, /star wars/i]];
// generic safe SW prints (plain faces that only carry a 'SW' tag in the name)
const GENERIC_OK = new Set('3626bps0 3626bps2 3626bps3 3626bps5 3626bpsc 3626bpsd 3626bpsf 3626bpsk 3626bpsm 3626bpso 3626bpsr'.split(' '));
const TITLE_BAN = /Hair|Headset|Headband|Tiara|Fish|Brain|Pineapple|Insectoid|Foil|Tusken|Maul|Spider|Orc\b|Fang|Red Eyes|Yellow Eyes|Tear\b|Sweat|Soot|Mud|Eye Patch|Fabuland|Needs Work|Implant|Crosseyed|Uneven|Missing Teeth|Lefty|Crooked|Queasy|Screaming|Sleeping|Single Large|Oval Eyes|Squinted|Green Lips|Tonque|Monocle|Villain|Microphone|Pencil|Hairline|Muttonchops|Face Paint|Stripes on Cheeks|Aluminum|Beauty Mark/i;
const TONGUE_ONLY = new Set(['3626cp04', '3626cp8e', '3626bpc44']);
const SMILE = /Smil|Grin|Open Mouth|Laugh|Teeth|Tongue|Cheerful/i, NEUTRAL_OK = /Closed Mouth|Neutral|Smirk|Determined|Straight|Stern|Serious|Standard Woman|Frown|Eyebrows,? Pupils/i;

function franchiseOk(part, identityText) { for (const [re, kw] of FRANCHISE) if (re.test(part) && !GENERIC_OK.has(part)) return kw.test(identityText || ''); return true; }
// is this catalog entry allowed for this subject?  ctx: {identity:string, expression, gender, glasses, beard}
function isSafeHead(c, ctx = {}) {
  const part = c.part, t = c.title || '';
  if (BAN_PARTS.has(part)) return false;
  if (TITLE_BAN.test(t) && !GENERIC_OK.has(part)) return false;
  if (!franchiseOk(part, ctx.identity)) return false;
  if (TONGUE_ONLY.has(part) && !/tongue/.test(String(ctx.expression || ''))) return false;
  return true;
}
function safeCatalog(cat, ctx = {}) { return cat.filter(c => isSafeHead(c, ctx)); }
const headGender = t => /Female|Eyelashes|Lips|Lipstick|Woman/i.test(t) ? 'female' : /Moustache|Beard|Goatee|Stubble|Sideburns/i.test(t) ? 'male' : 'any';
// fit score of an official head to the wanted face spec (higher = closer); used to rank, never to override the safe list
function headFit(c, face = {}) {
  const t = c.title || '', g = String(face.gender || '').toLowerCase(), ex = String(face.expression || '').toLowerCase(), hg = headGender(t); let s = 0;
  if (g === 'female') s += hg === 'female' ? 3 : hg === 'male' ? -6 : 0; else if (g === 'male') s += hg === 'female' ? -6 : hg === 'male' ? 0 : 0;
  const wantsBeard = face.beard && face.beard !== 'none' || face.stubble, hasBeard = /Moustache|Beard|Goatee|Stubble|Sideburns/i.test(t); s += wantsBeard ? (hasBeard ? 3 : -2) : (hasBeard ? -4 : 0);
  const gl = face.glasses && face.glasses !== 'none', hasGl = /Glasses|Sunglasses/i.test(t), hasSun = /Sunglasses/i.test(t), wantSun = face.glasses === 'sunglasses'; s += gl ? (hasGl ? 3 : -2) : (hasGl ? -5 : 0); if (gl && hasGl) s += hasSun === wantSun ? 1.5 : -1.5;
  const smile = SMILE.test(t); if (/neutral|serious|pursed|duck|smirk|angry|worried/.test(ex)) s += smile ? -4 : (NEUTRAL_OK.test(t) ? 2 : 0); else if (/smile|grin|laugh|surpris|tongue/.test(ex)) s += smile ? 2 : -1;
  const grumpy = /Scowl|Angry|Frown|Sad|Grim|Stern|Tense|Determined|Annoyed/i.test(t); if (grumpy) s += /angry|serious|worried|neutral/.test(ex) ? (/angry|serious/.test(ex) ? 2 : 0) : -6;
  if (face.freckles) s += /Freckle/i.test(t) ? 1.5 : 0; else if (/Freckle/i.test(t)) s -= 1;
  if (face.age === 'old') s += /Wrinkle|Crow|Grey|Bushy/i.test(t) ? 1.5 : 0;
  if (/Glasses|Sunglasses/i.test(t) && !gl) s -= 3; if (/Scar|Tear|Mask/i.test(t)) s -= 6; return s;
}
// pick the best SAFE official head. exclude: parts that must not repeat (regeneration). Returns catalog entry or null (=> composite face fallback)
function bestHead(cat, face, ctx = {}, exclude = [], rnd = null) {
  const ex = new Set((exclude || []).map(String)); const list = safeCatalog(cat, { ...ctx, expression: face.expression }).filter(c => headFit(c, face) > -3);
  const ranked = list.map(c => ({ c, s: headFit(c, face) })).sort((a, b) => b.s - a.s || a.c.title.length - b.c.title.length);
  const pool = ranked.filter(r => !ex.has(r.c.part)); if (!pool.length) return null;
  const top = pool.filter(r => r.s >= pool[0].s - 2).slice(0, 6); // top-N close candidates
  return (rnd ? top[Math.floor(rnd() * top.length)] : top[0]).c;
}

// ---------------- composite (drawn) faces ----------------
const EXPRS = ['smile', 'grin', 'laugh', 'neutral', 'smirk', 'angry', 'surprised', 'tongue', 'wink', 'worried', 'pursed', 'serious', 'open', 'none'];
const lum = h => { const m = String(h || '').match(/^#?([0-9a-f]{6})$/i); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// coarse bbox of a face_extra_svg element (0..100 box); eyes ≈ (35,45)/(65,45), mouth ≈ (50,70)
function elBBox(tag) {
  const num = n => { const m = tag.match(new RegExp('\\s' + n + "=['\"]([-\\d.]+)")); return m ? +m[1] : null; };
  const t = (tag.match(/^<\s*(\w+)/) || [])[1]; let b = null;
  if (t === 'rect') { const x = num('x') || 0, y = num('y') || 0, w = num('width') || 0, h = num('height') || 0; b = [x, y, x + w, y + h]; }
  else if (t === 'circle') { const cx = num('cx') || 0, cy = num('cy') || 0, r = num('r') || 0; b = [cx - r, cy - r, cx + r, cy + r]; }
  else if (t === 'ellipse') { const cx = num('cx') || 0, cy = num('cy') || 0, rx = num('rx') || 0, ry = num('ry') || 0; b = [cx - rx, cy - ry, cx + rx, cy + ry]; }
  else { const d = (tag.match(/\s(?:d|points)=['"]([^'"]+)/) || [])[1]; if (d) { const ns = (d.match(/-?\d*\.?\d+/g) || []).map(Number); const xs = ns.filter((_, i) => i % 2 === 0), ys = ns.filter((_, i) => i % 2 === 1); if (xs.length && ys.length) b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; } }
  return b; }
const hit = (b, z) => b && b[0] < z[2] && b[2] > z[0] && b[1] < z[3] && b[3] > z[1];
const EYE_Z = [[28, 38, 42, 52], [58, 38, 72, 52]], MOUTH_Z = [40, 64, 60, 78];
// returns cleaned svg + list of problems
function sanitizeExtra(svg) {
  if (!svg || typeof svg !== 'string') return { svg: null, problems: [] }; const problems = []; const tags = svg.match(/<\s*(rect|circle|ellipse|path|line|polygon|polyline)\b[^>]*>/gi) || []; const keep = [];
  if (tags.length > 10) problems.push('face_extra: too many elements'); 
  for (const tg of tags.slice(0, 10)) { const b = elBBox(tg); const filled = !/fill=['"]none['"]/i.test(tg) && (/fill=['"]#/i.test(tg) || !/stroke=/i.test(tg) || /<(rect|circle|ellipse|polygon)/i.test(tg)); const area = b ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : 0;
    if (b && (b[0] < -5 || b[1] < -5 || b[2] > 105 || b[3] > 105)) { problems.push('face_extra: shifted outside the head'); continue; }
    if (filled && area > 450) { problems.push('face_extra: big filled shape'); continue; }
    if (filled && (EYE_Z.some(z => hit(b, z)) || hit(b, MOUTH_Z))) { problems.push('face_extra: filled shape over eyes/mouth'); continue; }
    if (!filled && EYE_Z.some(z => b && b[0] < z[2] - 4 && b[2] > z[0] + 4 && b[1] < z[3] - 4 && b[3] > z[1] + 4)) { problems.push('face_extra: line across an eye'); continue; }
    keep.push(tg.endsWith('/>') ? tg : tg); }
  return { svg: keep.length ? keep.join('') : null, problems }; }

const SIMPLE_EXPR = e => ({ pursed: 'neutral', serious: 'neutral', open: 'surprised', none: 'neutral' })[e] || (EXPRS.includes(e) ? e : 'smile');
// the simplest friendly face for this subject (gender + expression); keeps photo-critical glasses/beard when they are safe
function simpleFace(face = {}, keep = {}) {
  const fem = String(face.gender).toLowerCase() === 'female', ex = SIMPLE_EXPR(String(face.expression || 'smile').toLowerCase());
  const f = { gender: fem ? 'female' : (face.gender === 'male' ? 'male' : face.gender), age: face.age === 'old' ? 'old' : 'adult', expression: ['angry', 'worried', 'wink', 'laugh', 'tongue'].includes(ex) && !keep.expr ? (ex === 'angry' ? 'neutral' : 'smile') : ex, brows: true };
  if (fem && face.lipstick) f.lipstick = face.lipstick; if (keep.beard && face.beard && face.beard !== 'none') { f.beard = face.beard; f.beard_color = face.beard_color; }
  if (keep.glasses && face.glasses && face.glasses !== 'none') { f.glasses = face.glasses; f.glasses_color = face.glasses_color; } return f; }

const fx = f => !!(f.mask && (f.mask.type || f.mask) && (f.mask.type || f.mask) !== 'none');
// main entry: returns {face, score, raw_score, fixes[], fallback:boolean}
function sanitizeFace(face0, ctx = {}) {
  const f = JSON.parse(JSON.stringify(face0 || {})); const fixes = []; let pen = 0; const fix = (msg, p = 8) => { fixes.push(msg); pen += p; };
  const fem = f.gender === 'female' || f.lashes === true, gl = f.glasses && f.glasses !== 'none', sun = f.glasses === 'sunglasses', clearGl = gl && !sun;
  if (f.glasses === 'square') f.glasses = 'rectangular';
  if (f.expression && !EXPRS.includes(String(f.expression).toLowerCase()) && !/tongue|wink|surpris|open/i.test(f.expression)) { fix('unknown expression -> smile', 6); f.expression = 'smile'; }
  const ex = String(f.expression || '').toLowerCase();
  if (f.metal_full || (f.mask && (f.mask.type === 'metal_full' || f.mask.type === 'full' || f.mask === 'metal_full'))) return { face: f, score: 100, raw_score: 100, fixes, fallback: false, official_mask: true };
  const mask = fx(f), mt = mask ? (f.mask.type || f.mask) : null;
  if (gl && /wink/.test(ex) && sun) { f.expression = 'smile'; fix('wink under sunglasses -> smile', 4); }
  if (clearGl && f.brows_thick) { f.brows_thick = false; fix('thick brows collide with glasses -> thin', 6); }
  if (clearGl && f.eye_size === 'large') { f.eye_size = 'normal'; fix('large eyes inside glasses -> normal', 6); }
  if (clearGl && fem && !f.no_lashes) { f.no_lashes = true; fix('lashes overlap the frame -> removed', 4); }
  if (clearGl && f.eye_color) { delete f.eye_color; fix('coloured iris inside glasses -> plain', 4); }
  if (f.eye_size === 'large' && f.brows_thick) { f.brows_thick = false; fix('large eyes + thick brows -> thin brows', 5); }
  if (mask && gl && /domino|eye_mask/.test(mt)) { f.glasses = 'none'; fix('eye mask + glasses overlap -> glasses dropped', 12); }
  if (f.eye_mask && gl) { f.glasses = 'none'; fix('eye band + glasses overlap -> glasses dropped', 12); }
  if (mask && /balaclava|half_mask/.test(mt) && f.beard && f.beard !== 'none') { f.beard = 'none'; f.stubble = false; fix('mask hides beard -> beard dropped', 6); }
  if (f.lipstick && String(f.gender).toLowerCase() === 'male' && !f.lashes) { f.lipstick = null; fix('lipstick on a male face -> removed', 6); }
  if (f.beard && f.beard !== 'none' && f.beard !== 'stubble' && f.stubble) { f.stubble = false; fix('stubble over a beard -> removed', 3); }
  if (f.beard_color && Math.abs(lum(f.beard_color) - lum(ctx.skin || '#F2CD37')) < 0.18) { f.beard_color = '#4A3020'; fix('beard colour equals skin -> dark brown', 5); }
  // too many small details => noisy face: keep at most 3 (priority: freckles > cheek_lines/dimples > nose > blush > wrinkles > stubble)
  const det = ['freckles', 'cheek_lines', 'dimples', 'nose', 'cheeks', 'wrinkles', 'forehead_wrinkles', 'stubble'].filter(k => f[k] && f[k] !== 'none'); const over = det.length - (f.age === 'old' ? 4 : 3);
  if (over > 0) { for (const k of det.slice().reverse().slice(0, over)) { delete f[k]; } fix('too many small details dropped: ' + over, 6 * over); }
  if (f.age === 'old' && (f.freckles && f.cheeks)) { delete f.cheeks; fix('old + freckles + blush noisy -> blush dropped', 3); }
  // free-form extra print: drop anything that covers the eyes/mouth or is huge
  if (f.face_extra_svg) { const r = sanitizeExtra(f.face_extra_svg); if (r.problems.length) { fix(r.problems[0], 14); } f.face_extra_svg = r.svg; if (!r.svg) delete f.face_extra_svg; }
  if (f.face_extra_svg && gl) { delete f.face_extra_svg; fix('extra print + glasses overlap -> extra dropped', 10); }
  if (f.eye_color && !/^#[0-9a-f]{6}$/i.test(f.eye_color)) { delete f.eye_color; fix('invalid eye colour dropped', 3); }
  // 'sanity score': 100 minus penalties of everything that had to be repaired, minus residual-risk heuristics
  let resid = 0;
  if (gl && f.face_extra_svg) resid += 15; if (mask && (f.face_extra_svg || f.freckles)) resid += 8; if (ex === 'tongue' && f.beard === 'full') resid += 6; if (f.mask && mt === 'face_paint' && gl) resid += 15;
  const raw = Math.max(0, 100 - pen - resid); let score = raw, fallback = false, out = f;
  // pen counts repairs (they fixed real problems => face is fine afterwards) – only a heavily broken source falls back to the simple face
  const unrepaired = resid + (fixes.filter(m => /face_extra|eye mask|eye band|unknown/.test(m)).length * 10);
  score = Math.max(0, 100 - resid - Math.round(pen * 0.5));
  if (raw < 60 || unrepaired >= 25 || score < 70) { out = simpleFace(f, { glasses: !mask && !f.eye_mask, beard: !mask && true, expr: false }); if (mask && !/metal/.test(mt)) out.mask = f.mask; fallback = true; fixes.push('fallback to simple face (' + (out.expression || 'smile') + ', ' + (out.gender || '?') + ')'); score = Math.max(score, 85); }
  return { face: out, score, raw_score: raw, fixes, fallback };
}

// pixel sanity of a rendered face texture: share of ink-coloured pixels (too dense = messy) — used by tests/matrix
function inkCoverage(faceSvgFn, skin) {
  const { defs, svg } = faceSvgFn; const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="111 47 82 86" width="164" height="172"><defs>${defs}</defs><rect x="111" y="47" width="82" height="86" fill="${skin}"/>${svg}</svg>`;
  const r = new Resvg(doc).render(); const px = r.pixels; let ink = 0; const n = r.width * r.height; const sk = parseInt(skin.slice(1), 16), sr = sk >> 16, sg = (sk >> 8) & 255, sb = sk & 255;
  for (let i = 0; i < px.length; i += 4) { const d = Math.abs(px[i] - sr) + Math.abs(px[i + 1] - sg) + Math.abs(px[i + 2] - sb); if (d > 150) ink++; } return ink / n; }

module.exports = { isSafeHead, safeCatalog, headFit, bestHead, sanitizeFace, simpleFace, sanitizeExtra, inkCoverage, BAN_PARTS, headGender, SMILE, NEUTRAL_OK };
