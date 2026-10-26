// "Найпохожіші обличчя": deterministic ranking of SAFE official heads for the figure's face spec (no Gemini needed).
//  faceOptions(spec, catalog, {n, exclude, identity}) -> [{id, part, label, title, score, why, thumb}]  (4..6 distinct heads)
//  applyFace(spec, part, catalog)                    -> spec with the chosen head applied (head_part / glasses flag / face), validated against the safe set
const fs = require('fs'), path = require('path');
const regen = require('./regen'), facesafe = require('./facesafe'), minifig = require('./minifig');
const lc = x => String(x || '').toLowerCase(); const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const lumOf = h => { const n = parseInt(h.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; };
const THUMB_DIR = path.join(__dirname, '../public/face_thumbs');

// extra traits beyond regen.scoreHead: eyebrow colour, dimples / smile lines, lipstick, wrinkles
function extra(c, face = {}) {
  const t = c.title || ''; let s = 0;
  if (face.dimples || face.cheek_lines) s += /Dimple|Cheek Lines|Laugh Lines/i.test(t) ? 2 : 0;
  if (isHex(face.brow_color)) { const L = lumOf(face.brow_color); const dark = L < 0.25, mid = L >= 0.25 && L < 0.55;
    if (/Black Eyebrows|Dark Eyebrows/i.test(t)) s += dark ? 1.5 : -0.5; if (/Brown Eyebrows|Dark Brown Eyebrows/i.test(t)) s += mid ? 1.5 : 0; if (/White Eyebrows|Grey Eyebrows|Gray Eyebrows/i.test(t)) s += L > 0.7 ? 1.5 : -1.5; if (/Blond/i.test(t)) s += L > 0.55 && L <= 0.7 ? 1.5 : -0.5; }
  if (face.lipstick && /Lips|Lipstick/i.test(t)) s += 1.5; if (!face.lipstick && /Red Lips|Lipstick/i.test(t) && !/Female|Lashes/i.test(t)) s -= 0.5;
  if (lc(face.age) !== 'old' && /Wrinkle|Crow/i.test(t)) s -= 2; // young faces: no age wrinkles
  if (!face.glasses_color && /(Light Blue|Orange|Lavender|Red|Pink|Green|Yellow) (Glasses|Sunglasses)/i.test(t)) s -= 3; // coloured lenses only when the photo has them
  if (face.brows_thick && /Bushy|Thick/i.test(t)) s += 1; if (face.eye_size === 'large' && /Large Eyes|Big Eyes/i.test(t)) s += 1;
  return s;
}
const normTitle = t => String(t || '').replace(/^Minifig Head( with)? /i, '').replace(/\s*\([^)]*\)/g, '').replace(/\s*Pattern\s*$/i, '').replace(/\s+/g, ' ').trim();
function label(c, face = {}) {
  const t = regen.headTraits(c.title), p = [];
  p.push(t.fem ? 'Жіноче' : t.beard ? 'Чоловіче' : 'Унісекс');
  p.push(t.tongue ? 'язик' : t.open ? 'відкритий рот' : t.smirk ? 'усмішка скоса' : t.smile ? 'усмішка' : t.angry ? 'суворе' : 'спокійне');
  if (t.sun) p.push('темні окуляри'); else if (t.glasses) p.push('окуляри'); if (t.beard) p.push('вуса/борода'); if (t.freckles) p.push('ластовиння'); if (/Dimple/i.test(c.title)) p.push('ямочки'); if (t.old) p.push('зморшки');
  const brow = (c.title.match(/(Black|Dark Brown|Brown|Blond|Grey|Gray|White|Red|Auburn) Eyebrows/i) || [])[1]; if (brow) p.push('брови: ' + ({ black: 'чорні', 'dark brown': 'темно-коричневі', brown: 'коричневі', blond: 'світлі', grey: 'сиві', gray: 'сиві', white: 'білі', red: 'руді', auburn: 'руді' })[brow.toLowerCase()]);
  return p.join(' · ');
}
function thumbFor(c, face) {
  const f = path.join(THUMB_DIR, c.part + '.png'); if (fs.existsSync(f)) return '/face_thumbs/' + c.part + '.png';
  try { return 'data:image/svg+xml;base64,' + Buffer.from(minifig.headThumbSvg(regen.faceFromHead ? regen.faceFromHead(c, face) : { gender: face.gender }, '#F2CD37')).toString('base64'); } catch { return null; }
}
function candidates(catalog, face, ctx) {
  const safe = facesafe.safeCatalog(regen.plainHeads(catalog), { identity: ctx.identity || '', expression: face.expression }); const w = regen.wantedFace(face);
  return safe.map(c => ({ c, s: regen.scoreHead(c, w) + extra(c, face) }));
}
function faceOptions(spec, catalog, { n = 6, exclude = [], identity = '' } = {}) {
  n = Math.max(4, Math.min(6, +n || 6)); const face = spec && spec.face && typeof spec.face === 'object' ? spec.face : {}; const ex = new Set((exclude || []).map(lc));
  const all = candidates(catalog || [], face, { identity }).filter(x => !ex.has(lc(x.c.part)));
  const w = regen.wantedFace(face); const pools = [all.filter(x => x.s > -20), all.filter(x => regen.headTraits(x.c.title).fem === w.fem && !(!w.gl && (regen.headTraits(x.c.title).glasses || regen.headTraits(x.c.title).sun))), all];
  const out = [], seen = new Set(), cur = lc(spec && spec.head_part);
  for (const pool of pools) { for (const x of pool.sort((a, b) => b.s - a.s || (a.c.part < b.c.part ? -1 : 1))) { if (out.length >= n) break; const k = normTitle(x.c.title).toLowerCase(); if (seen.has(k) || out.some(o => o.part === x.c.part)) continue; seen.add(k); out.push(x); } if (out.length >= Math.max(4, n)) break; }
  return out.slice(0, n).map(x => ({ id: x.c.part, part: x.c.part, label: label(x.c, face), title: normTitle(x.c.title), score: Math.max(1, Math.min(99, Math.round(60 + x.s * 3.2))), current: lc(x.c.part) === cur, thumb: thumbFor(x.c, face) }));
}
// apply a chosen head. Only SAFE catalog heads are accepted. Returns {spec, head} or null.
function applyFace(spec, part, catalog, { identity = '' } = {}) {
  part = lc(part); if (!/^3626[bc]p[0-9a-z]+$/.test(part) || !spec || typeof spec !== 'object') return null;
  const c = candidates(catalog || [], spec.face || {}, { identity }).find(x => x.c.part === part); if (!c) return null;
  const old = { mask: spec.face && spec.face.mask, eye_mask: spec.face && spec.face.eye_mask }; if ((old.mask && old.mask !== 'none') || old.eye_mask || (spec.head_mold && spec.head_mold !== 'standard') || spec.hair_style === 'bandana_tails') return null;
  regen.useHead(spec, c.c, 'Обличчя обрано користувачем зі списку «Найпохожіші обличчя».'); spec.head_user_picked = true; return { spec, head: c.c };
}
module.exports = { faceOptions, applyFace, label, normTitle };
