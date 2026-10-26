// Regeneration ("спробувати ще раз") logic: lock map, state reconciliation, and guaranteed change of every UNLOCKED part.
const crypto = require('crypto');
const facesafe = require('./facesafe');

// role (as shown in the 3D parts list) -> spec fields it owns. Dependent fields are included so a locked part never mixes with new values of its own helpers
const LOCKMAP = {
  'Голова': ['face', 'head_part', 'head_part_title', 'head_part_why_uk', 'skin_color', 'head_mold'],
  'Волосся': ['hair_style', 'hair_color', 'hair_secondary_color', 'hair_sculpt', 'hair_part'],
  'Головний убір': ['headgear', 'headgear_color', 'headgear_secondary_color'],
  'Плащ / броня': ['neck_accessory', 'neck_accessory_color'],
  'Торс': ['torso_color', 'torso_print_svg', 'torso_print_svg_rejected', 'torso_back_print_svg', 'collar', 'collar_color', 'torso_graphic_png', 'torso_graphic_box', 'torso_graphic_rect', 'double_torso', 'torso2_color', 'torso2_print_svg', 'torso2_back_print_svg',
    'bare_torso', 'body_build', 'chest_hair', 'chest_hair_color', 'layers', 'bust', 'bust_size', 'outfit_corset'],
  'Рука': ['arm_color', 'arm_print_svg', 'sleeves'],
  'Кисть': ['hand_color', 'hands_are_gloves'],
  'Низ / ноги': ['legs_type', 'hip_color', 'leg_color', 'leg_right_color', 'legs_print_svg', 'hips_print_svg', 'skirt_color', 'footwear', 'belt', 'belt_color', 'briefs_color', '_briefs_done'],
  'Аксесуар': ['accessories_3d'],
};
const ID_RE = /^[0-9]+-[a-z0-9]{4}$/;
const fs = require('fs'), path = require('path');
function loadSpec(id, dir) { if (!id || !ID_RE.test(id)) return null; try { const o = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); delete o.textures; return o; } catch { return null; } }
function pickLocked(old, roles) {
  if (!old || !Array.isArray(roles)) return null; const f = {};
  for (const r of roles) for (const k of (LOCKMAP[r] || [])) if (old[k] !== undefined) f[k] = old[k];
  return Object.keys(f).length ? f : null; }
const validRoles = roles => (Array.isArray(roles) ? roles : []).filter(r => Object.prototype.hasOwnProperty.call(LOCKMAP, r));

// make helper-fields consistent after locked values were put over a freshly designed spec
function reconcile(sp) {
  if (!sp) return sp;
  if (sp.hands_are_gloves !== true && sp.skin_color) sp.hand_color = sp.skin_color;
  if (sp.bare_torso === true) { sp.torso_color = sp.skin_color; sp.arm_color = sp.skin_color; sp.hand_color = sp.skin_color; sp.sleeves = 'none'; }
  if (sp.face && sp.face.gender !== 'female') { delete sp.bust; delete sp.bust_size; delete sp.outfit_corset; }
  else if (sp.face && sp.face.gender === 'female' && !['subtle', 'prominent'].includes(sp.bust)) sp.bust = 'subtle';
  if (sp.hair_style !== 'sculpt') delete sp.hair_sculpt;
  return sp; }

// ---------------- signatures ----------------
const h = x => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x === undefined ? null : x)).digest('hex').slice(0, 12);
const FACE_KEYS = ['expression', 'gender', 'age', 'brows', 'brows_thick', 'brow_color', 'lipstick', 'cheeks', 'cheek_lines', 'dimples', 'freckles', 'nose', 'eye_size', 'eye_color', 'beard', 'beard_color', 'stubble', 'mustache', 'glasses', 'glasses_color', 'mask', 'face_extra_svg', 'variant', 'no_lashes', 'wrinkles', 'forehead_wrinkles'];
const faceSig = sp => sp.head_part ? 'official:' + sp.head_part : 'drawn:' + h(FACE_KEYS.map(k => (sp.face || {})[k] ?? null));
const SIG = {
  'Голова': faceSig,
  'Волосся': sp => h([sp.hair_style, sp.hair_color, sp.hair_sculpt, sp.hair_part]),
  'Головний убір': sp => h([sp.headgear, sp.headgear_color]),
  'Плащ / броня': sp => h([sp.neck_accessory, sp.neck_accessory_color]),
  'Торс': sp => h([sp.torso_color, sp.torso_print_svg, sp.torso_back_print_svg, sp.collar, sp.layers, sp.bare_torso, sp.chest_hair]),
  'Рука': sp => h([sp.arm_color, sp.arm_print_svg, sp.sleeves]),
  'Кисть': sp => h([sp.hand_color]),
  'Низ / ноги': sp => h([sp.legs_type, sp.leg_color, sp.legs_print_svg, sp.hips_print_svg, sp.footwear, sp.belt]),
  'Аксесуар': sp => h(sp.accessories_3d || []),
};
// a part that is derived (hands = skin colour) or has no alternative is exempt from "must differ"
function roleSig(role, sp) { return SIG[role] ? SIG[role](sp) : null; }
// similarity (0..1) of two print SVGs by their element tokens; >0.85 counts as 'the same print'
function printSim(a, b) { const tk = s => new Set(String(s || '').replace(/\s+/g, ' ').match(/<[^>]+>/g) || []); const A = tk(a), B = tk(b); if (!A.size && !B.size) return 1; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

// ---------------- alternatives ----------------
const HAIR_FAMILIES = [['short', 'short_side'], ['spiky', 'short', 'short_side'], ['curly'], ['bob', 'mid_length', 'long_straight', 'long_wavy', 'long_bangs', 'long'], ['ponytail', 'ponytail_side', 'side_braid', 'twin_tails', 'pigtails_braided'], ['bun', 'bun_fringe', 'bun_low_fringe', 'bun_high']];
const HEADGEAR_FAMILIES = [['cap', 'cap_long', 'baseball_cap', 'cap_classic'], ['helmet_knight', 'helmet_castle'], ['helmet_space', 'helmet_motorcycle', 'helmet_construction', 'helmet_police', 'helmet_pilot'], ['fedora', 'cowboy', 'newsboy', 'top_hat'], ['hood', 'hood_fur', 'cowl'], ['beanie']];
const family = (fams, v) => { const f = fams.find(x => x.includes(v)); return f ? f : null; };
// sample from the same style family, never the previous value
function altFrom(fam, prevVal, rnd) { const opts = (fam || []).filter(x => x !== prevVal); return opts.length ? opts[Math.floor(rnd() * opts.length)] : null; }

const darker = (c, f) => { const n = parseInt(String(c || '#808080').replace('#', '').padEnd(6, '0').slice(0, 6), 16); const m = v => Math.max(0, Math.min(255, Math.round(v * f))); return '#' + [m(n >> 16), m((n >> 8) & 255), m(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); };
const lumOf = c => { const n = parseInt(String(c || '#808080').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const ink = c => lumOf(c) < 0.22 ? '#5a5a5a' : darker(c, 0.6);
const accent = c => lumOf(c) < 0.3 ? '#8f8f8f' : darker(c, 0.78);
// tasteful, thin, symmetrical trims (SVG 0..100 boxes). index = variant id
const TORSO_V = [
  (c) => `<path d='M22,42 h15 v13 h-15 z' stroke='${ink(c)}' stroke-width='1.1' fill='none'/><path d='M22,46 h15' stroke='${ink(c)}' stroke-width='0.8'/>`,
  (c) => `<path d='M50,20 L50,92' stroke='${ink(c)}' stroke-width='1.1'/>` + [32, 47, 62, 77].map(y => `<circle cx='50' cy='${y}' r='1.3' fill='${accent(c)}' stroke='${ink(c)}' stroke-width='0.5'/>`).join(''),
  (c) => `<path d='M14,12 Q50,26 86,12' stroke='${ink(c)}' stroke-width='1.2' fill='none'/><path d='M20,30 Q50,38 80,30' stroke='${ink(c)}' stroke-width='0.7' fill='none' opacity='0.6'/>`,
  (c) => `<rect x='0' y='48' width='100' height='3.2' fill='${accent(c)}'/><rect x='0' y='54' width='100' height='1' fill='${ink(c)}' opacity='0.7'/>`,
  (c) => `<path d='M0,92 h100' stroke='${ink(c)}' stroke-width='1.2'/><path d='M19,52 L17,100 M81,52 L83,100' stroke='${ink(c)}' stroke-width='0.9' opacity='0.8'/>`,
  (c) => `<path d='M36,0 L50,20 L64,0' stroke='${ink(c)}' stroke-width='1.5' fill='none'/><path d='M40,0 L50,13 L60,0' fill='${accent(c)}' opacity='0.5'/>`,
];
const ARM_V = [
  (c) => `<rect x='0' y='88' width='100' height='12' fill='${accent(c)}'/><rect x='0' y='87' width='100' height='1.2' fill='${ink(c)}'/>`,
  (c) => `<path d='M0,48 h100' stroke='${ink(c)}' stroke-width='1.2'/><path d='M0,52 h100' stroke='${ink(c)}' stroke-width='0.6' opacity='0.6'/>`,
  (c) => `<rect x='0' y='20' width='100' height='3' fill='${accent(c)}'/><rect x='0' y='80' width='100' height='3' fill='${accent(c)}'/>`,
  (c) => `<path d='M0,70 h100 M0,76 h100' stroke='${ink(c)}' stroke-width='0.9' opacity='0.8'/>`,
];
const LEGS_V = [
  (c) => `<path d='M23,29 L23,100 M77,29 L77,100' stroke='${ink(c)}' stroke-width='0.8' opacity='0.6'/>`,
  (c) => `<path d='M6,44 q9,3 19,0 M75,44 q9,3 19,0' stroke='${ink(c)}' stroke-width='1' fill='none'/>`,
  (c) => `<path d='M10,52 L12,98 M36,52 L34,98 M64,52 L66,98 M90,52 L88,98' stroke='${ink(c)}' stroke-width='0.8' opacity='0.5'/>`,
  (c) => `<rect x='0' y='58' width='46' height='2.2' fill='${accent(c)}' opacity='0.8'/><rect x='54' y='58' width='46' height='2.2' fill='${accent(c)}' opacity='0.8'/>`,
  (c) => `<path d='M4,35 h38 M58,35 h38' stroke='${ink(c)}' stroke-width='0.9' opacity='0.7'/>`,
];
const BACK_V = [(c) => `<path d='M50,14 L50,96' stroke='${ink(c)}' stroke-width='1' opacity='0.8'/>`, (c) => `<path d='M14,16 Q50,30 86,16' stroke='${ink(c)}' stroke-width='1.1' fill='none'/>`];

function pickVariant(list, prevIdx, rnd) { const n = list.length; return ((Number.isInteger(prevIdx) ? prevIdx : -1) + 1 + Math.floor(rnd() * (n - 1))) % n; }

// Guarantees: every role NOT in lockedRoles has a different signature than in prev (when there is anything to choose from).
// Returns {changed:[role...], exempt:[role...], notes:[...]}.  rnd: () => [0,1)
function diversify(spec, prev, lockedRoles = [], opt = {}) {
  const rnd = opt.rnd || Math.random, locked = new Set(lockedRoles), changed = [], exempt = [], notes = []; if (!prev) return { changed, exempt, notes };
  spec._variants = { ...(spec._variants || {}) }; const pv = prev._variants || {};
  const same = (role) => roleSig(role, spec) === roleSig(role, prev);
  for (const role of Object.keys(LOCKMAP)) {
    if (locked.has(role)) continue; if (!SIG[role]) continue;
    if (role === 'Кисть') { exempt.push(role); continue; } // hand colour = skin colour, nothing to choose
    let did = false;
    const done = (msg) => { did = true; notes.push(role + ': ' + msg); };
    switch (role) {
      case 'Голова': {
        if (spec.face && spec.face.mask && (spec.face.mask.type || spec.face.mask) === 'metal_full') break;
        if (spec.head_part && spec.head_part === prev.head_part) { // identical official head => pick another safe one
          const alt = opt.catalog ? facesafe.bestHead(opt.catalog, spec.face || {}, { identity: opt.identity }, [prev.head_part, spec.head_part], rnd) : null;
          if (alt) { spec.head_part = alt.part; spec.head_part_title = alt.title; spec.head_part_why_uk = 'Інший варіант обличчя при повторній генерації.'; done('official head ' + prev.head_part + ' -> ' + alt.part); } else { delete spec.head_part; delete spec.head_part_title; delete spec.head_part_why_uk; spec.face = { ...(spec.face || {}), variant: pickVariant([0, 1, 2, 3, 4, 5], pv.face, rnd) }; spec._variants.face = spec.face.variant; done('official head dropped -> drawn face variant ' + spec.face.variant); }
        }
        if (same(role) && !spec.head_part) { spec.face = { ...(spec.face || {}) }; const cur = +spec.face.variant || 0, prv = Number.isInteger(pv.face) ? pv.face : (+(prev.face || {}).variant || 0); let v = pickVariant([0, 1, 2, 3, 4, 5], Math.max(cur, prv), rnd); if (v === prv) v = (v + 1) % 6; spec.face.variant = v; spec._variants.face = v; done('drawn face variant ' + prv + ' -> ' + v); }
        break; }
      case 'Волосся': {
        if (!same(role)) break; const hs = spec.hair_style || 'short';
        if (hs === 'none' || hs === 'bald' || hs === 'bandana_tails') { exempt.push(role); break; }
        if (hs === 'sculpt') { const o = spec.hair_sculpt || {}, prvSeed = (prev.hair_sculpt || {}).seed || 1234; const seed = 1 + Math.floor(rnd() * 90000); const vol = Math.max(0.2, Math.min(1, (+o.volume || 0.5) + (rnd() < 0.5 ? -0.18 : 0.18))); spec.hair_sculpt = { ...o, seed: seed === prvSeed ? seed + 1 : seed, volume: +vol.toFixed(2) }; done('sculpted hair re-sculpted'); break; }
        const alt = altFrom(family(HAIR_FAMILIES, hs), hs, rnd);
        if (alt) { spec.hair_style = alt; done(hs + ' -> ' + alt); } else { // no other piece in this family: change shade to the neighbouring LEGO hair colour
          const SH = ['#582A12', '#352100', '#7C503A', '#AA7D55']; const cur = String(spec.hair_color || '').toUpperCase(); const alt2 = SH.find(c => c.toUpperCase() !== cur && Math.abs(lumOf(c) - lumOf(cur)) < 0.25); if (alt2) { spec.hair_color = alt2; done('hair shade ' + cur + ' -> ' + alt2); } else exempt.push(role); }
        break; }
      case 'Головний убір': {
        if (!same(role)) break; const hg = spec.headgear || 'none'; if (hg === 'none') { exempt.push(role); break; }
        const alt = altFrom(family(HEADGEAR_FAMILIES, hg), hg, rnd); if (alt) { spec.headgear = alt; done(hg + ' -> ' + alt); } else exempt.push(role); break; }
      case 'Плащ / броня': { if (same(role)) exempt.push(role); break; } // cape/armour is dictated by the photo: no alternative piece
      case 'Торс': {
        if (spec.bare_torso) { if (same(role)) { const lv = ['light', 'medium', 'heavy']; if (spec.chest_hair && spec.chest_hair !== 'none' && spec.chest_hair !== false) { const cur = String(spec.chest_hair === true ? 'medium' : spec.chest_hair); spec.chest_hair = lv[(Math.max(0, lv.indexOf(cur)) + 1) % 3]; done('chest hair density'); } else exempt.push(role); } break; }
        const same1 = same(role) || printSim(spec.torso_print_svg, prev.torso_print_svg) > 0.85 && spec.torso_color === prev.torso_color && !spec.layers;
        if (same1) { const k = pickVariant(TORSO_V, pv.torso, rnd), c = spec.torso_color; spec.torso_print_svg = (spec.torso_print_svg || '') + TORSO_V[k](c); spec._variants.torso = k;
          const kb = pickVariant(BACK_V, pv.torso_back, rnd); spec.torso_back_print_svg = (spec.torso_back_print_svg || '') + BACK_V[kb](c); spec._variants.torso_back = kb; done('print trim variant ' + k); }
        break; }
      case 'Рука': { if (spec.bare_torso || spec.sleeves === 'none') { if (same(role)) exempt.push(role); break; }
        if (same(role) || printSim(spec.arm_print_svg, prev.arm_print_svg) > 0.85) { const k = pickVariant(ARM_V, pv.arm, rnd); spec.arm_print_svg = (spec.arm_print_svg || '') + ARM_V[k](spec.arm_color || spec.torso_color); spec._variants.arm = k; done('sleeve trim variant ' + k); } break; }
      case 'Низ / ноги': {
        if (spec.bare_torso && /standard/.test(spec.legs_type || 'standard') && spec._briefs_done) { if (same(role)) exempt.push(role); break; }
        if (['mermaid_tail', 'snake_tail', 'genie_tail'].includes(spec.legs_type)) { if (same(role)) exempt.push(role); break; }
        if (same(role) || printSim(spec.legs_print_svg, prev.legs_print_svg) > 0.85) { const k = pickVariant(LEGS_V, pv.legs, rnd); spec.legs_print_svg = (spec.legs_print_svg || '') + LEGS_V[k](spec.leg_color); spec._variants.legs = k; done('legs trim variant ' + k); } break; }
      case 'Аксесуар': {
        const acc = Array.isArray(spec.accessories_3d) ? spec.accessories_3d : []; if (!acc.length) { exempt.push(role); break; }
        if (same(role)) { let ok = false; spec.accessories_3d = acc.map(a => { a = { ...a };
          if (a.type === 'sword') { a.kind = a.kind === 'long' ? 'short' : 'long'; ok = true; } else if (a.type === 'shield') { const sh = ['triangle', 'round', 'oval'].filter(x => x !== (a.shape || 'triangle')); a.shape = sh[Math.floor(rnd() * sh.length)]; ok = true; }
          else if (a.type === 'bag') { const st = ['held', 'crossbody', 'belt'].filter(x => x !== (a.style || 'held')); a.style = st[Math.floor(rnd() * st.length)]; ok = true; } return a; });
          if (ok) done('accessory form changed'); else exempt.push(role); }
        break; }
    }
    if (did) changed.push(role);
  }
  return { changed, exempt, notes }; }

// prompt note for Gemini (what the previous version looked like; what must differ)
function regenNote(prev, lockedRoles = []) {
  if (!prev) return ''; const L = new Set(lockedRoles); const free = Object.keys(LOCKMAP).filter(r => !L.has(r) && r !== 'Кисть');
  const p = { hair_style: prev.hair_style, hair_color: prev.hair_color, headgear: prev.headgear, head_part: prev.head_part, face_expression: prev.face && prev.face.expression, face_variant: (prev.face || {}).variant, neck_accessory: prev.neck_accessory, legs_type: prev.legs_type,
    torso_concept: prev.design && prev.design.concept, torso_motifs: prev.design && prev.design.motifs, palette: prev.design && prev.design.palette, author_touch: prev.author_touch_uk };
  return `RE-ROLL OF AN EARLIER RESULT. The previous version was: ${JSON.stringify(p)}.\nThe user pressed "try again": every part in this list is UNLOCKED and MUST look clearly DIFFERENT from the previous version: ${free.join(', ')}. For those parts choose a different (still photo-faithful) design: another hair piece from the same style family, different print layout/motifs/trims/seams/embroidery, a different author-touch idea, different accessory form. Keep what the photo dictates (gender, colours, glasses, beard, key identity features, expression class: neutral stays neutral). Do NOT repeat the previous hair_style, motifs or author touch.\n`;
}
module.exports = { LOCKMAP, ID_RE, loadSpec, pickLocked, validRoles, reconcile, roleSig, printSim, diversify, regenNote, HAIR_FAMILIES, HEADGEAR_FAMILIES, faceSig };
