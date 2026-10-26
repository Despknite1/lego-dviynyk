// Regeneration + face sanity rules (pure functions, no I/O => unit-testable: tests/regen.test.js).
//  * signature(spec)   – compact fingerprint of the user-visible variant of head / hair / torso / legs
//  * enforceRegen()    – guarantees that every UNLOCKED role differs from everything in `history` (the "exclude list")
//  * sanitizeFace()    – conservative face rule: a busy / contradictory composite face falls back to a whole OFFICIAL head
// Roles use the same Ukrainian names as the 3D parts panel (public/viewer3d.js) and LOCKMAP (lib/locks.js).
const crypto = require('crypto');
const R = { head: 'Голова', hair: 'Волосся', hat: 'Головний убір', torso: 'Торс', legs: 'Низ / ноги' };
const h8 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const hnum = s => parseInt(h8(s), 16);
const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const lc = c => String(c || '').toLowerCase();

// ---------- official head catalog traits (from the LDraw titles) ----------
// franchise prints, printed hair/headsets, monsters, tears, odd eyes: never used by the automatic rules ("normal beats scary")
const THEMED = /\b(HP|SW|LOTR)\b|Insectoid|Ice Planet|Fabuland|Aquanaut|Headset|Headband|Tiara|Eye ?Patch|Fish|Brain|Pineapple|Spider-?Man|Fang|Red Eyes|Yellow Eyes|Uruk|Orc\b|Tusken|Maul|Villain|Foil|Soot|Mud|Sweat|Tear|Monocle|Eyepiece|Eye Grid|Microphone|Pencil|Missing Teeth|Implant|Sleeping|Screaming|Crosseyed|Uneven|Single Large|Large Black Eyes|Big Eyes|Oval Eyes|Squinted|Stripes on Cheeks|Green Lips|Muttonchops|Wiry|Pointed Hairline|Messy Hair|Black Hair|Brown Hair|Hair Part|Wrap-Around|Beauty Mark|Gold Tooth|Eyes and Mouth|Pointed Moustache/i;
function headTraits(title) {
  const t = String(title || '').replace(/^Minifig Head /, '');
  const fem = /\bFemale\b|Woman|Eyelashes|Lips|Lipstick|Lashes/i.test(t);
  const sun = /Sunglasses/i.test(t), gl = /Glasses/i.test(t) && !sun;
  const smile = /Smil|Grin|Laugh|Teeth|Tongue|Tounge|Cheerful|Open Mouth/i.test(t), open = /Open Mouth|Teeth|Tongue|Tounge|Wide Open|Laugh/i.test(t);
  const beard = /Moustache|Goatee|Beard|Sideburns|Stubble|Facial Hair/i.test(t);
  const smirk = /Smirk|Lopsided|Crooked|Lefty/i.test(t);
  const angry = /Angry|Scowl|Frown|Stern|Grim|Tense|Annoyed/i.test(t);
  const neutral = !smile && !/Sad|Determined|Worried|Queasy|Pursed/i.test(t) && !angry;
  return { fem, sun, glasses: gl, smile, open, beard, smirk, neutral, angry, freckles: /Freckle/i.test(t), old: /Wrinkle|Crow|Grey Eyebrows|White Eyebrows|Bushy|Laugh Lines|Cheek Lines/i.test(t),
    tongue: /Tongue|Tounge/i.test(t), twoSided: /2-Sided/.test(t), themed: THEMED.test(t) };
}
// parts rejected after a visual review of the whole catalog (printed hair, monsters, odd eyes/mouths, scary or messy prints)
const BAN_PARTS = new Set(('3626bp0d 3626bp0j 3626bp0k 3626bp0l 3626bp35 3626bp48 3626bp49 3626bp4c 3626bp4d 3626bp4e 3626bp4f 3626bp4h 3626bp4j 3626bp4k 3626bp4l 3626bp4m ' +
  '3626bp51 3626bp52 3626bp54 3626bp55 3626bp56 3626bp61 3626bp62 3626bp65 3626bp66 3626bp67 3626bp68 3626bp69 3626bp6a 3626bp6b 3626bp6y 3626bp7a 3626bp7f 3626bp81 3626bp82 3626bp89 ' +
  '3626bp8g 3626bp8n 3626bpa4 3626bpa6 3626bpa9 3626bpaa 3626bpab 3626bpao 3626bpb1 3626bpb3 3626bpb5 3626bpb7 3626bpc15 3626bpc25 3626bpc33 3626bpc42 3626bpn1 3626bps1 3626bpsn 3626bpsp ' +
  '3626bpw0 3626bpw1 3626bpw2 3626bpw3 3626bpw8 3626bpw9 3626cp02 3626cp06 3626cp09 3626cp0a 3626cp0l 3626cp0o 3626cp0y 3626cp16 3626cp20 3626cp77 3626cp78 3626cp7i 3626cp82 3626cp8f 3626cp89 3626bp41 3626bp3e ' +
  '3626bp3n 3626bp3q 3626bp3r 3626bp06 3626bp86').split(' '));
const plainHeads = cat => (cat || []).filter(c => c && /^3626[bc]p[0-9a-z]+$/.test(c.part) && !BAN_PARTS.has(c.part) && !headTraits(c.title).themed);

// what the spec asks of a face -> wanted traits
function wantedFace(f = {}) {
  const e = lc(f.expression), g = lc(f.gender);
  const expr = /tongue/.test(e) ? 'tongue' : /grin|laugh|open/.test(e) ? 'grin' : /smile|happy/.test(e) ? 'smile' : /smirk/.test(e) ? 'smirk' : /angry|scowl|frown|stern/.test(e) ? 'angry' : 'neutral';
  const gl = f.glasses && f.glasses !== 'none' ? (f.glasses === 'sunglasses' ? 'sun' : 'glasses') : null;
  const beard = !!(f.beard && f.beard !== 'none') || !!f.stubble || !!f.mustache;
  return { fem: g === 'female' || f.lashes === true || (!!f.lipstick && g !== 'male'), expr, gl, beard, freckles: !!f.freckles, old: lc(f.age) === 'old' || !!f.wrinkles };
}
function scoreHead(c, w) {
  const t = headTraits(c.title); let s = 0;
  if (t.fem !== w.fem) return -99;                                   // gender is a hard rule
  if (!w.beard && t.beard) return -50;                               // never invent facial hair
  if (!w.gl && (t.glasses || t.sun)) return -40;                     // never invent glasses
  if (w.expr === 'neutral') { if (t.neutral) s += 6; if (t.smirk) s += 2.5; else if (t.smile && !t.open) s += 1; if (t.open) s -= 6; if (t.angry) s -= 8; }
  else if (w.expr === 'smile') { if (t.smile && !t.open) s += 7; else if (t.smile) s += 3; if (t.angry) s -= 15; if (t.tongue) s -= 6; }
  else if (w.expr === 'grin') { if (t.smile) s += 6; if (t.open) s += 2; if (t.angry) s -= 15; if (t.tongue) s -= 3; }
  else if (w.expr === 'tongue') { if (t.tongue) s += 14; else if (t.smile) s += 2; if (t.angry) s -= 15; }
  else if (w.expr === 'smirk') { if (t.smirk) s += 8; else if (t.smile && !t.open) s += 3; if (t.angry) s -= 10; }
  else if (w.expr === 'angry') { if (t.angry) s += 8; if (t.smile) s -= 10; }
  if (w.beard && t.beard) s += 5;
  if (w.gl === 'sun' && t.sun) s += 6; else if (w.gl === 'sun' && t.glasses) s += 2; else if (w.gl && t.glasses) s += 6; else if (w.gl && t.sun) s += 1;
  if (w.gl && /(Orange|Red|Blue|Lavender|Green) .*Glasses|(Orange|Red|Blue|Lavender) Sunglasses/i.test(c.title)) s -= 3;
  if (w.freckles && t.freckles) s += 2; else if (!w.freckles && t.freckles) s -= 2;
  if (w.old && t.old) s += 2; else if (!w.old && t.old) s -= 2;
  if (t.twoSided) s -= 0.5;                                          // the second side is not shown in 3D
  s -= Math.min(4, String(c.title).length / 40);                     // simpler print = more "normal"
  return s;
}
// ranked list of official heads for a face spec (best first); `exclude` = Set of part ids that must not be returned
function rankHeads(catalog, face, exclude = new Set()) {
  const w = wantedFace(face);
  return plainHeads(catalog).map(c => ({ c, s: scoreHead(c, w) })).filter(x => x.s > -20 && !exclude.has(x.c.part)).sort((a, b) => b.s - a.s || (a.c.part < b.c.part ? -1 : 1));
}
const MIN_HEAD_SCORE = 2; // below this an official head would lose the subject's key traits => keep a simplified composite face instead

// ---------- face sanity ----------
const KNOWN_EXPR = new Set(['neutral', 'smile', 'grin', 'smirk', 'angry', 'worried', 'surprised', 'tongue', 'wink', 'laugh', 'none']);
const EXPR_FIX = { serious: 'neutral', pursed: 'neutral', calm: 'neutral', blank: 'neutral', stern: 'neutral', happy: 'smile', smiling: 'smile', cheerful: 'smile', sad: 'worried', frown: 'angry', open: 'grin', shocked: 'surprised', surprise: 'surprised', tongue_out: 'tongue', winking: 'wink' };
function faceFeatures(f) {
  const a = []; if (f.glasses && f.glasses !== 'none') a.push('glasses'); if (f.beard && f.beard !== 'none') a.push('beard'); if (f.stubble) a.push('stubble'); if (f.mustache) a.push('mustache');
  if (f.freckles) a.push('freckles'); if (f.cheeks) a.push('cheeks'); if (f.lipstick) a.push('lipstick'); if (f.wrinkles || f.age === 'old') a.push('wrinkles');
  if (f.eye_color && isHex(f.eye_color) && !/^#(000000|1b1b1b|582a12)$/i.test(f.eye_color)) a.push('eye_color'); if (f.brows_thick) a.push('thick_brows'); if (f.nose && f.nose !== 'none') a.push('nose');
  if (f.dimples || f.cheek_lines) a.push('lines'); if (f.eye_size === 'large') a.push('big_eyes'); if (f.forehead_wrinkles) a.push('forehead'); return a;
}
const hasMask = f => !!(f && f.mask && f.mask !== 'none' && (f.mask.type || f.mask) !== 'none');
// returns {confidence 0..1, issues[]}; < 0.7 => composite face is not trusted
function faceSanity(f0) {
  const f = f0 && typeof f0 === 'object' ? f0 : {}; const issues = []; let c = 1; const pen = (v, m) => { c -= v; issues.push(m); };
  const e = lc(f.expression); if (e && !KNOWN_EXPR.has(e)) pen(EXPR_FIX[e] ? 0.1 : 0.35, `невідомий вираз «${f.expression}»`);
  if (f.face_extra_svg) pen(0.5, 'довільний малюнок на обличчі (не перевірений)');
  const fem = lc(f.gender) === 'female' || f.lashes === true, beard = (f.beard && f.beard !== 'none' && f.beard !== 'stubble') || f.mustache;
  if (fem && beard) pen(0.5, 'жіноче обличчя з бородою/вусами');
  if (lc(f.gender) === 'male' && f.lipstick) pen(0.4, 'чоловіче обличчя з помадою');
  const sun = f.glasses === 'sunglasses', gl = f.glasses && f.glasses !== 'none';
  if (gl && /wink/.test(e)) pen(0.4, 'підморгування під окулярами');
  if (sun && f.eye_color) pen(0.15, 'колір очей під темними окулярами');
  if (f.lipstick && /grin|laugh|surpris|tongue/.test(e)) pen(0.2, 'помада разом з відкритим ротом');
  if (/tongue/.test(e) && gl) pen(0.15, 'язик + окуляри');
  if (/tongue|wink|surpris/.test(e) && beard) pen(0.2, 'виразна міміка + вуса/борода');
  if (typeof f.confidence === 'number' && f.confidence < 0.6) pen(0.4, `низька впевненість моделі (${f.confidence})`);
  const n = faceFeatures(f).length; if (n > 5) pen(0.5, `забагато деталей на обличчі (${n})`); else if (n > 4) pen(0.3, `багато деталей на обличчі (${n})`);
  return { confidence: Math.max(0, +c.toFixed(2)), issues, features: n };
}
// strip the riskiest bits so a composite face stays "normal" (used when no good official head exists)
const DROP_ORDER = ['face_extra_svg', 'cheeks', 'nose', 'dimples', 'cheek_lines', 'forehead_wrinkles', 'eye_size', 'brows_thick', 'freckles', 'wrinkles'];
function simplifyFace(f0) {
  const f = { ...(f0 || {}) }; const dropped = [];
  const e = lc(f.expression); if (e && !KNOWN_EXPR.has(e)) { f.expression = EXPR_FIX[e] || 'neutral'; dropped.push('expression'); }
  if (lc(f.gender) === 'male' && f.lipstick) { delete f.lipstick; dropped.push('lipstick'); }
  if ((lc(f.gender) === 'female' || f.lashes === true) && ((f.beard && f.beard !== 'none' && f.beard !== 'stubble') || f.mustache)) { f.beard = 'none'; delete f.mustache; dropped.push('beard'); }
  if (f.glasses && f.glasses !== 'none' && /wink/.test(lc(f.expression))) { f.expression = 'smile'; dropped.push('wink'); }
  for (const k of DROP_ORDER) { if (faceFeatures(f).length <= 3 && !f.face_extra_svg) break; if (f[k]) { delete f[k]; dropped.push(k); } }
  if (f.age === 'old' && faceFeatures(f).length > 3) { f.age = null; dropped.push('age'); }
  return { face: f, dropped };
}
function faceFromHead(c, base = {}) { // consistent face spec for the 2D template when an official head is used
  const t = headTraits(c.title); const f = { gender: t.fem ? 'female' : (base.gender === 'female' ? 'female' : 'male') };
  f.expression = t.tongue ? 'tongue' : t.open || /Grin/.test(c.title) ? 'grin' : t.smile ? 'smile' : t.smirk ? 'smirk' : t.angry ? 'angry' : 'neutral';
  if (t.fem) f.lashes = true; if (t.glasses || t.sun) f.glasses = t.sun ? 'sunglasses' : 'round'; if (t.beard) f.beard = 'mustache'; if (t.freckles) f.freckles = true;
  return f;
}
const GLASSES_IN_HEAD = c => { const t = headTraits(c.title); return t.glasses || t.sun; };
function useHead(spec, c, why) {
  spec.head_part = c.part; spec.head_part_title = c.title; spec.head_part_why_uk = why; spec.head_glasses_printed = !!GLASSES_IN_HEAD(c);
  spec.face = { ...faceFromHead(c, spec.face || {}) };
}
// conservative face rule. Composite face is kept ONLY when it is valid and confident; otherwise a whole official head with the
// matching gender / expression is used (or, if none matches well, a simplified composite). Returns notes (Ukrainian) for _qa.
function sanitizeFace(spec, catalog, { isKnown = false } = {}) {
  const notes = []; if (!spec || typeof spec !== 'object') return notes; const f = spec.face && typeof spec.face === 'object' ? spec.face : (spec.face = {});
  if (hasMask(f) || f.eye_mask || spec.hair_style === 'bandana_tails' || (spec.head_mold && spec.head_mold !== 'standard') || (isKnown && spec.head_part)) return notes;
  if (spec.head_part && /^3626[bc]p[0-9a-z]+$/.test(spec.head_part)) return notes; // whole official head already
  if (lc(f.expression) in EXPR_FIX) f.expression = EXPR_FIX[lc(f.expression)];
  const s = faceSanity(f); spec._face_conf = s.confidence;
  if (s.confidence >= 0.7) return notes;
  const best = rankHeads(catalog, f)[0];
  if (best && best.s >= MIN_HEAD_SCORE) { useHead(spec, best.c, 'Складене обличчя виглядало ризиковано → беру цілу офіційну голову з відповідним виразом/статтю.'); notes.push(`обличчя: впевненість ${s.confidence} (${s.issues.join('; ')}) → ціла офіційна голова ${best.c.part}`); return notes; }
  const sf = simplifyFace(f); spec.face = sf.face; notes.push(`обличчя: впевненість ${s.confidence} (${s.issues.join('; ')}), підходящої цілої голови немає → спрощено (${sf.dropped.join(', ') || '—'})`);
  return notes;
}

// ---------- signatures ----------
const headSig = sp => sp.head_part ? 'head:' + lc(sp.head_part) : 'face:' + h8(JSON.stringify(Object.keys(sp.face || {}).sort().map(k => [k, (sp.face || {})[k]]).filter(([k]) => k !== 'confidence')));
const hairSig = sp => 'hair:' + lc(sp.hair_style || 'none') + ':' + (sp.hair_style === 'sculpt' ? h8(JSON.stringify(sp.hair_sculpt || {})) : '') + ':' + lc(sp.hair_part || '');
const torsoSig = sp => 'torso:' + lc(sp.torso_color) + ':' + h8((sp.torso_print_svg || '') + '|' + (sp.collar || '') + '|' + (sp.collar_color || ''));
const legsSig = sp => 'legs:' + lc(sp.legs_type || 'standard') + ':' + lc(sp.leg_color) + ':' + h8(sp.legs_print_svg || '');
function signature(sp) { sp = sp || {}; return { head: headSig(sp), hair: hairSig(sp), torso: torsoSig(sp), legs: legsSig(sp) }; }
const cleanHist = h => (Array.isArray(h) ? h : []).slice(-30).filter(x => x && typeof x === 'object').map(x => { const o = {}; for (const k of ['head', 'hair', 'torso', 'legs']) if (typeof x[k] === 'string' && x[k].length < 80) o[k] = x[k]; return o; });

// ---------- variation generators ----------
const FAMILIES = [['#C91A09', '#720E0F', '#FE8A18', '#B40000'], ['#0055BF', '#5A93DB', '#0A3463', '#008F9B'], ['#237841', '#184632', '#4B9F4A', '#A5CA18'], ['#F2CD37', '#F8BB3D', '#FE8A18', '#DCBC81'],
  ['#E4CD9E', '#958A73', '#582A12', '#AA7D55'], ['#A0A5A9', '#6C6E68', '#898788', '#0A3463'], ['#1b1b1b', '#6C6E68', '#0A3463', '#720E0F'], ['#F4F4F4', '#E4CD9E', '#A0A5A9', '#5A93DB'], ['#6C2A6F', '#C870A0', '#0A3463', '#E4ADC8'], ['#582A12', '#7C503A', '#E4CD9E', '#958A73']];
const rgb = h => { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const cdist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.sqrt((x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11); };
function colorAlternatives(c) { // nearest family of the colour, then its other members (closest first); never returns c itself
  if (!isHex(c)) return []; const fam = FAMILIES.map(f => ({ f, d: Math.min(...f.map(x => cdist(c, x))) })).sort((a, b) => a.d - b.d)[0].f;
  return fam.filter(x => lc(x) !== lc(c)).sort((a, b) => cdist(c, a) - cdist(c, b)); }
const HAIR_GROUPS = { male: ['short', 'short_side', 'spiky', 'curly'], female: ['long_straight', 'long_wavy', 'long_bangs', 'mid_length', 'bob', 'ponytail_side', 'side_braid', 'pigtails_braided'], sculptLong: ['long_straight', 'long_wavy', 'long_bangs'], sculptCurl: ['curly', 'mid_length'], sculptMessy: ['short', 'spiky', 'short_side'] };
function hairAlternatives(sp) {
  const fem = lc(sp.face && sp.face.gender) === 'female'; const st = sp.hair_style || 'short'; let g;
  if (st === 'sculpt') { const k = sp.hair_sculpt && sp.hair_sculpt.kind; g = k === 'long' ? HAIR_GROUPS.sculptLong : k === 'curls' ? HAIR_GROUPS.sculptCurl : HAIR_GROUPS.sculptMessy; if (fem && k !== 'curls') g = g.concat(HAIR_GROUPS.female.slice(3)); }
  else if (HAIR_GROUPS.female.includes(st) || /ponytail|braid|bun|tails|bangs/.test(st)) g = HAIR_GROUPS.female;
  else g = fem ? HAIR_GROUPS.female : HAIR_GROUPS.male;
  return g.filter(x => x !== st);
}
const TORSO_KEYS = ['torso_color', 'arm_color', 'collar', 'collar_color', 'torso_print_svg', 'torso_back_print_svg', 'arm_print_svg'];
function torsoVariants(sp) { // ordered list of mutations; each produces a visibly different torso (colour family x trim = ~16 variants)
  const base = sp.torso_color; const dark = isHex(base) && (0.3 * rgb(base)[0] + 0.59 * rgb(base)[1] + 0.11 * rgb(base)[2]) < 70;
  const recolor = alt => s => { const old = s.torso_color; s.torso_color = alt;
    if (lc(s.arm_color) === lc(old)) s.arm_color = alt; if (lc(s.collar_color) === lc(old)) s.collar_color = alt;
    for (const k of ['torso_print_svg', 'torso_back_print_svg', 'arm_print_svg']) if (typeof s[k] === 'string') s[k] = s[k].split(old).join(alt).split(old.toUpperCase()).join(alt).split(old.toLowerCase()).join(alt); };
  const trim = (c, w) => s => { s.torso_print_svg = (s.torso_print_svg || '') + `<rect x='0' y='${100 - w}' width='100' height='${w}' fill='${c}'/><rect x='0' y='${100 - w - 2}' width='100' height='1.2' fill='${c}' opacity='0.7'/>`; };
  const collar = s => { s.collar = s.collar && s.collar !== 'none' ? 'none' : 'v'; };
  const trims = [null, trim(dark ? '#A0A5A9' : '#1b1b1b', 7), trim(dark ? '#C91A09' : '#0055BF', 5), trim(dark ? '#F4F4F4' : '#6C6E68', 9), collar];
  const colors = [null, ...colorAlternatives(base).map(recolor)]; const v = [];
  for (const t of trims) for (const c of colors) { if (!t && !c) continue; v.push(s => { if (c) c(s); if (t) t(s); }); }
  return v;
}
function legVariants(sp) {
  const v = []; for (const alt of colorAlternatives(sp.leg_color)) v.push(s => { const old = s.leg_color; s.leg_color = alt; if (lc(s.hip_color) === lc(old)) s.hip_color = alt; if (s.leg_right_color && lc(s.leg_right_color) === lc(old)) s.leg_right_color = alt; if (typeof s.legs_print_svg === 'string') s.legs_print_svg = s.legs_print_svg.split(old).join(alt); });
  const hem = (a, b) => s => { s.legs_print_svg = (s.legs_print_svg || '') + `<rect x='0' y='96' width='100' height='4' fill='${a}'/><rect x='0' y='29' width='100' height='1.4' fill='${b}'/>`; };
  v.push(hem('#1b1b1b', '#A0A5A9'), hem('#F4F4F4', '#6C6E68')); const n = v.length; for (let i = 0; i < n - 2; i++) v.push(s => { v[i](s); hem('#1b1b1b', '#A0A5A9')(s); }); return v;
}
const pick = (arr, seed) => arr.length ? arr[hnum(seed) % arr.length] : null;

// Make every UNLOCKED role differ from everything in `history` (list of signatures of earlier figures). Returns {notes, changed:[roles]}.
function enforceRegen(spec, { history = [], locked = [], catalog = [], seed = '' } = {}) {
  const notes = [], changed = []; if (!spec || typeof spec !== 'object') return { notes, changed }; const L = new Set(locked), H = cleanHist(history); if (!H.length) return { notes, changed };
  const seen = k => new Set(H.map(x => x[k]).filter(Boolean));
  const headLocked = L.has(R.head), maskedHead = hasMask(spec.face) || (spec.head_mold && spec.head_mold !== 'standard') || (spec.face && spec.face.eye_mask) || spec.hair_style === 'bandana_tails';
  // 1. head / face: a new official head (the previous ones are the exclude list)
  if (!headLocked && !maskedHead && seen('head').has(headSig(spec))) {
    const ex = new Set(H.map(x => (x.head || '').replace(/^head:/, '')).filter(Boolean)); if (spec.head_part) ex.add(lc(spec.head_part));
    const faceNow = spec.face || {}; let ranked = rankHeads(catalog, faceNow, ex).filter(x => x.s >= MIN_HEAD_SCORE);
    if (!ranked.length) ranked = rankHeads(catalog, faceNow, ex).slice(0, 6);
    if (!ranked.length) ranked = rankHeads(catalog, { gender: faceNow.gender }, ex).slice(0, 6);
    if (!ranked.length) { const recent = new Set(H.slice(-2).map(x => (x.head || '').replace(/^head:/, '')).filter(Boolean)); if (spec.head_part) recent.add(lc(spec.head_part)); ranked = rankHeads(catalog, faceNow, recent).slice(0, 6); } // pool exhausted: only the last two are excluded
    const top = ranked.slice(0, Math.min(5, ranked.length)); const c = top.length ? pick(top, seed + 'head' + H.length) : null; // rotate by seed so repeated clicks walk through the catalog
    if (c) { const was = spec.head_part || 'складене обличчя'; useHead(spec, c.c, 'Нова голова при перегенерації: попередній варіант додано у виключення.'); notes.push(`голова: ${was} → ${spec.head_part}`); changed.push(R.head); }
    else { const alts = ['smile', 'neutral', 'smirk', 'grin'].filter(x => x !== lc(faceNow.expression)); spec.face = { ...faceNow, expression: alts[hnum(seed) % alts.length] }; delete spec.head_part; notes.push('голова: змінено вираз складеного обличчя (каталог недоступний)'); changed.push(R.head); }
  }
  // 2. hair (only when visible: not bald, no headgear)
  const bald = !spec.hair_style || spec.hair_style === 'none' || spec.hair_style === 'bald', hg = spec.headgear && spec.headgear !== 'none';
  if (!L.has(R.hair) && !bald && !hg && !(spec.head_mold && spec.head_mold !== 'standard') && seen('hair').has(hairSig(spec))) {
    const ex = new Set(H.map(x => (x.hair || '').split(':')[1]).filter(Boolean)); let alts = hairAlternatives(spec); const fresh = alts.filter(a => !ex.has(a)); if (fresh.length) alts = fresh;
    const st = pick(alts, seed + 'hair' + H.length); if (st) { const was = spec.hair_style; spec.hair_style = st; delete spec.hair_sculpt; delete spec.hair_part; notes.push(`волосся: ${was} → ${st}`); changed.push(R.hair); } }
  // 3. torso (+ sleeves follow); 4. legs
  const tryVariants = (role, sig, keys, variants) => { const seenSet = seen(sig); const off = hnum(seed + role);
    for (let i = 0; i < variants.length; i++) { const test = JSON.parse(JSON.stringify(spec)); variants[(i + off) % variants.length](test); if (!seenSet.has(({ torso: torsoSig, legs: legsSig })[sig](test))) { for (const k of keys) if (test[k] !== undefined) spec[k] = test[k]; return true; } } return false; };
  if (!L.has(R.torso) && spec.bare_torso !== true && seen('torso').has(torsoSig(spec))) { const was = spec.torso_color; if (tryVariants('torso', 'torso', TORSO_KEYS, torsoVariants(spec))) { notes.push(`торс: ${was} → ${spec.torso_color}`); changed.push(R.torso); } }
  if (!L.has(R.legs) && spec.bare_torso !== true && seen('legs').has(legsSig(spec))) { if (tryVariants('legs', 'legs', ['leg_color', 'hip_color', 'leg_right_color', 'legs_print_svg'], legVariants(spec))) { notes.push(`ноги: ${spec.leg_color}`); changed.push(R.legs); } }
  return { notes, changed };
}
module.exports = { BAN_PARTS, R, signature, cleanHist, enforceRegen, sanitizeFace, faceSanity, simplifyFace, rankHeads, plainHeads, headTraits, wantedFace, colorAlternatives, hairAlternatives, torsoSig, headSig, hairSig, legsSig, hasMask, faceFeatures };
