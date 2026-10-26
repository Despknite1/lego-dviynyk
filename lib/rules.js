// General (photo-independent) sanity rules applied to the Gemini spec AFTER generation/verification.
// Pure functions, no I/O => unit-testable (tests/rules.test.js). Every rule is logged in `sp._qa` (list of strings).
const HELD_OK = new Set(['headphones', 'backpack', 'sword', 'shield', 'hair_ornament', 'bag']);
const WORDS = {
  sword: /sword|blade|katana|sabre|saber|dagger|knife|spear|rapier|меч|шабл|кинджал|спис|катан/i,
  shield: /shield|щит/i,
  // things that are NOT clothing prints: held/foreground/occluding objects
  occluder: /branch|twig|stick|firewood|bundle|leaf|leaves|foliage|fern|grass|flower|bouquet|bush|plant|гілк|гілоч|хмиз|дров|оберем|листя|лист\b|трав|квіт|букет|кущ|рослин/i,
  pants: /pants|trousers|jeans|joggers|sweatpants|palazzo|leggings|штани|джинс|брюки|легінс/i,
  skirtlike: /skirt|dress|gown|robe|kilt|sarong|cassock|спідниц|сукн|плаття|халат|ряса/i,
  wide: /wide|loose|baggy|flare|palazzo|oversize|широк|вільн|кліш|балон/i,
  embroid: /embroid|floral|flower print|pattern|ornament|вишив|орнамент|візерун/i,
  // photo is cropped: the model says so itself (framing / legs text)
  unseen: /crop|not (fully |clearly )?visible|not shown|out of (the )?(frame|shot)|waist[- ]up|half[- ]body|bust|cut off|hidden|assum|infer|can'?t see|no legs|не видно|обрізан|по пояс|по груд/i,
  dressTop: /dress|gown|robe|kimono|sundress|shirt-?dress|cassock|сукн|плаття|кімоно|халат|ряса/i,
  skirtOnly: /skirt|kilt|спідниц/i,
  tallboots: /knee[- ]high|thigh[- ]high|ankle boot|high boot|calf|tall boot|чобот|вис(о|ок)і/i,
};
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const rgb = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const isHex = h => /^#[0-9a-f]{6}$/i.test(h || '');
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = h => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const chroma = h => { const [r, g, b] = rgb(h); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.sqrt((x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11) / 255; };
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

// ---- tiny SVG element bbox (box 0..100) ----
function attrs(tag) { const o = {}; tag.replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (m, k, a, b) => { o[k] = a !== undefined ? a : b; return ''; }); return o; }
function pathBox(d) {
  const t = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0; const xs = [], ys = [];
  const pt = (px, py) => { x = px; y = py; xs.push(px); ys.push(py); };
  const n = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i])) cmd = t[i++]; const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(); if (C === 'Z') { x = sx; y = sy; continue; }
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { pt(ox + n(), oy + n()); sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
    else if (C === 'L' || C === 'T') pt(ox + n(), oy + n());
    else if (C === 'H') pt((rel ? x : 0) + n(), y);
    else if (C === 'V') pt(x, (rel ? y : 0) + n());
    else if (C === 'C') { const a = [ox + n(), oy + n(), ox + n(), oy + n()]; xs.push(a[0], a[2]); ys.push(a[1], a[3]); pt(ox + n(), oy + n()); }
    else if (C === 'S' || C === 'Q') { const a = [ox + n(), oy + n()]; xs.push(a[0]); ys.push(a[1]); pt(ox + n(), oy + n()); }
    else if (C === 'A') { n(); n(); n(); n(); n(); pt(ox + n(), oy + n()); }
    else i++;
  }
  if (!xs.length || xs.some(Number.isNaN) || ys.some(Number.isNaN)) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function elBox(name, a) {
  const f = k => num(a[k]);
  switch (name) {
    case 'rect': return { x0: f('x'), y0: f('y'), x1: f('x') + f('width'), y1: f('y') + f('height') };
    case 'circle': return { x0: f('cx') - f('r'), y0: f('cy') - f('r'), x1: f('cx') + f('r'), y1: f('cy') + f('r') };
    case 'ellipse': return { x0: f('cx') - f('rx'), y0: f('cy') - f('ry'), x1: f('cx') + f('rx'), y1: f('cy') + f('ry') };
    case 'line': return { x0: Math.min(f('x1'), f('x2')), y0: Math.min(f('y1'), f('y2')), x1: Math.max(f('x1'), f('x2')), y1: Math.max(f('y1'), f('y2')) };
    case 'polygon': case 'polyline': { const p = String(a.points || '').match(/-?\d*\.?\d+/g) || []; const xs = p.filter((_, i) => i % 2 === 0).map(Number), ys = p.filter((_, i) => i % 2 === 1).map(Number); return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null; }
    case 'path': return pathBox(a.d || '');
  }
  return null;
}
const EL = /<(rect|circle|ellipse|path|polygon|polyline|line)\b[^>]*?\/?>/gi;

// "decor spot" = a compact filled shape (not a garment region, band or fold line)
function decorInfo(tag, name) {
  const a = attrs(tag); const fill = a.fill; if (!isHex(fill)) return null; const b = elBox(name.toLowerCase(), a); if (!b) return null;
  const w = b.x1 - b.x0, h = b.y1 - b.y0; if (w <= 0 || h <= 0) return null;
  if (w > 38 || h > 45) return null; // garment region / band / long fold line — not a spot
  return { a, b, w, h, area: w * h, fill, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}
const scaleAbout = (tag, cx, cy, s) => `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${s.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})">${tag}</g>`;
const setFill = (tag, c) => tag.replace(/fill\s*=\s*(["'])#[0-9a-f]{6}\1/i, `fill="${c}"`);

// Remove / shrink / pastelise oversized pattern spots on a print. Returns {svg, notes}.
//  base: garment colour; kind: 'legs' | 'torso'; occluders: true when the photo has foreground objects (leaves, branches, hair) that
//  must NOT become prints => saturated organic-coloured spots are dropped entirely.
function tidyPrint(svg, base, kind, { occluders = false } = {}) {
  const notes = []; if (typeof svg !== 'string' || !svg) return { svg, notes }; if (!isHex(base)) base = '#F4F4F4';
  const light = lum(base) > 0.6, CAP = light ? 70 : 140, TOTAL = kind === 'legs' ? 420 : 700; let total = 0, dropped = 0, shrunk = 0, pastel = 0;
  const out = svg.replace(EL, (tag, name) => {
    const d = decorInfo(tag, name); if (!d) return tag;
    const organic = chroma(d.fill) > 0.18 && dist(d.fill, base) > 0.25; // coloured blob on a differently coloured garment
    if (occluders && light && organic && d.area > 25) { dropped++; return ''; }
    if (total + Math.min(d.area, CAP) > TOTAL) { dropped++; return ''; }
    let t = tag, area = d.area;
    if (light && organic && chroma(d.fill) > 0.12) { t = setFill(t, mix(d.fill, base, 0.6)); pastel++; }
    if (area > CAP) { const s = Math.sqrt(CAP / area); t = scaleAbout(t, d.cx, d.cy, s); area = CAP; shrunk++; }
    total += area; return t;
  });
  if (dropped) notes.push(`${kind}: прибрано ${dropped} великих/зайвих плям візерунка`);
  if (shrunk) notes.push(`${kind}: зменшено ${shrunk} плям до ≤${CAP} од.²`);
  if (pastel) notes.push(`${kind}: ${pastel} плям зроблено пастельними`);
  return { svg: out, notes };
}
// delicate embroidery: tiny sprigs (stem + 3 dots) on the outer thigh/shin of each leg (legs box: left leg x 0..46, right x 54..100, y 29..100)
function sprigs(color) {
  const c = color, one = (x, y, s) => `<path d='M${x},${y + 9 * s} Q${x + 2 * s},${y + 4 * s} ${x},${y}' stroke='${c}' stroke-width='0.6' fill='none'/><circle cx='${x - 2.2 * s}' cy='${y + 3 * s}' r='${1.1 * s}' fill='${c}'/><circle cx='${x + 2.2 * s}' cy='${y + 5 * s}' r='${1.1 * s}' fill='${c}'/><circle cx='${x}' cy='${y - 0.4}' r='${1.3 * s}' fill='${c}'/>`;
  return [[11, 44, 1], [14, 62, 0.9], [89, 44, 1], [86, 62, 0.9], [22, 80, 0.7], [78, 80, 0.7]].map(([x, y, s]) => one(x, y, s)).join('');
}

const HAIR_PAL = ['#1b1b1b', '#352100', '#582A12', '#583927', '#7C503A', '#A95500', '#AA7D55', '#D09168', '#958A73', '#E4CD9E', '#F2CD37', '#F8BB3D', '#DCBC81', '#F4F4F4', '#A0A5A9', '#6C6E68', '#C91A09', '#720E0F', '#FC97AC', '#C870A0', '#0055BF', '#5A93DB', '#008F9B', '#237841', '#6C2A6F', '#FE8A18'];
function snapHair(c) { if (!isHex(c)) return c; let b = c, bd = 1e9; for (const p of HAIR_PAL) { const d = dist(c, p); if (d < bd) { bd = d; b = p; } } return bd < 0.22 ? b : c; }

// text evidence the model itself wrote about the accessories / foreground
const evidence = (sp, desc) => [sp.accessories_uk, sp.inspection && sp.inspection.accessories, sp.notes_uk, desc && desc.accessories, desc && desc.summary_uk, sp.design && sp.design.concept, sp.design && sp.design.motifs && sp.design.motifs.join(' ')].filter(Boolean).join(' | ');


// ---- animals: never a "yellow human with stripes" ----
const ANIMAL = /\b(animal|tiger|lion|dog|cat|wolf|bear|fox|horse|bird|cow|pig|rabbit|deer|monkey|elephant|leopard|cheetah|puppy|kitten)\b|тварин|тигр|лев\b|собак|кіт|кішк|вовк|ведмід/i;
function isAnimal(id, desc, sp) {
  if (id && /^(animal|creature_animal)$/i.test(String(id.subject_kind || ''))) return true;
  if (id && id.subject_kind && /^(human|person|character|figurine|object)$/i.test(String(id.subject_kind))) return false;
  if (sp && /^animal$/i.test(String(sp.subject_kind || ''))) return true;
  const t = String((desc && desc.type) || ''); // the describe step's own type field only (never free-text identity: "man walking a dog")
  return ANIMAL.test(t) && !/person|human|man\b|woman|людин|чолов|жінк|дівч|хлоп/i.test(t) && !(id && id.is_known_character);
}
function applyAnimal(sp, note) {
  sp.subject_kind = 'animal';
  const fur = [sp.fur_color, sp.hair_color, sp.torso_color, sp.design && sp.design.palette && sp.design.palette[0]].find(c => isHex(c) && !/^#f2cd37$/i.test(c)) || '#CC702A';
  if (!isHex(sp.skin_color) || /^#f2cd37$/i.test(sp.skin_color)) { sp.skin_color = fur; sp.hand_color = fur; note('тварина: шкіра/хутро = колір звіра, а не жовтий «людський» LEGO'); }
  sp.face = sp.face || {}; if (sp.face.gender === 'female') { sp.face.gender = 'neutral'; note('тварина: без жіночих вій/бюсту'); }
  delete sp.bust; delete sp.bust_size; delete sp.outfit_corset; sp.lashes = undefined;
  if (!sp.headgear || sp.headgear === 'none') { sp.headgear = 'hood_fur'; sp.headgear_color = sp.headgear_color || fur; sp.hair_style = 'none'; note('тварина: хутряний капюшон замість людської зачіски'); }
  sp.accessories_3d = (sp.accessories_3d || []).filter(a => a && a.type === 'hair_ornament' ? false : true).filter(a => !['sword', 'shield', 'bag', 'backpack', 'headphones'].includes(a.type));
  if (!sp.legs_type || /skirt|robe|dress/.test(sp.legs_type)) sp.legs_type = 'standard';
  sp.animal_note_uk = 'Це тварина: збудовано фігурку в «костюмі звіра» (хутро, смуги/плями, капюшон), а не людину.';
}

// ---- cropped photos (waist-up / bust): the part below the frame is INFERRED from the upper garment, not invented ----
function lowerBody(sp, desc, note) {
  const insp = sp.inspection || {}, framing = String(insp.framing || '').toLowerCase();
  const framedCrop = /thigh|waist|half|bust|chest|torso|head|hip|upper/.test(framing) && !/full|knee/.test(framing);
  const legsTxt = [insp.legs, insp.hips, insp.lower_visible === false ? 'not visible' : '', desc && desc.legs].filter(Boolean).join(' ');
  const unseen = insp.lower_visible === false || framedCrop || (!!legsTxt && WORDS.unseen.test(legsTxt) && !/full[- ]body/.test(framing));
  if (!unseen) return null;
  const lower = String(insp.lower_garment || '').toLowerCase();
  const topTxt = [insp.torso_front, sp.design && sp.design.concept, sp.identity, sp.torso_desc, desc && desc.torso].filter(Boolean).join(' ');
  const explicitSkirt = WORDS.skirtOnly.test(lower) || WORDS.dressTop.test(lower);
  const dressy = explicitSkirt || (!lower && WORDS.dressTop.test(topTxt));
  const trousersSaid = WORDS.pants.test(lower); const trousersSaidInsp = WORDS.pants.test(String(insp.legs || '') + ' ' + String(insp.hips || ''));
  const male = sp.face && sp.face.gender === 'male'; let dressOut = false;
  if (dressy && !trousersSaid && !(male && !/robe|cassock|kimono|халат|ряса/.test(lower + topTxt))) {
    if (!sp.legs_type || sp.legs_type === 'standard' || sp.legs_type === 'short') { sp.legs_type = /gown|maxi|long|floor|ankle|довг/.test(lower + topTxt) ? 'long_robe' : 'skirt'; }
    if (!isHex(sp.skirt_color)) sp.skirt_color = sp.torso_color;
    if (isHex(sp.skin_color) && (!isHex(sp.leg_color) || trousersSaidInsp || dist(sp.skirt_color, sp.leg_color) < 0.05)) sp.leg_color = sp.skin_color; // the trousers the model guessed under the dress are dropped: bare legs below the hem
    dressOut = true;
    note('низ кадру не видно: верх — сукня/халат → низ продовжує вбрання (' + sp.legs_type + '), а не вигадані штани');
  } else {
    if (sp.legs_type && !['standard', 'short'].includes(sp.legs_type) && !explicitSkirt) { note(`низ кадру не видно, верх — не сукня → штани (legs_type ${sp.legs_type} → standard)`); sp.legs_type = 'standard'; sp.skirt_color = null; }
    if (!isHex(sp.leg_color) || (isHex(sp.skin_color) && dist(sp.leg_color, sp.skin_color) < 0.06)) { sp.leg_color = '#1B2A34'; note('низ не видно: нейтральні темні штани замість «голих» ніг'); }
    if (typeof sp.legs_print_svg === 'string' && sp.legs_print_svg) { let n = 0; const v = sp.legs_print_svg.replace(EL, (t, nm) => { if (decorInfo(t, nm)) { n++; return ''; } return t; }); if (n) { sp.legs_print_svg = v; note(`низ не видно: ${n} вигаданих кольорових плям на штанах прибрано (складки лишено)`); } }
  }
  if (sp.footwear && typeof sp.footwear === 'object' && isHex(sp.footwear.color) && chroma(sp.footwear.color) > 0.25) { sp.footwear.color = '#1b1b1b'; note('взуття не видно: нейтральний чорний колір'); }
  return dressOut ? 'dress' : 'trousers';
}

function sanitizeSpec(sp, desc, ctx = {}) {
  if (!sp || typeof sp !== 'object') return sp; const qa = [], note = m => { qa.push(m); };
  const AE = evidence(sp, desc);
  const ALL = [AE, sp.inspection && JSON.stringify(sp.inspection), desc && JSON.stringify(desc)].filter(Boolean).join(' | ');
  const occ = WORDS.occluder.test(ALL);
  // 1. accessories: only real, evidenced items; branches/leaves/other objects are skipped (never turned into a sword)
  let acc = Array.isArray(sp.accessories_3d) ? sp.accessories_3d.filter(a => a && typeof a === 'object') : [];
  const before = acc.length;
  acc = acc.filter(a => {
    const t = String(a.type || '').toLowerCase();
    if (!HELD_OK.has(t)) { note(`аксесуар «${t}» не підтримується — пропущено`); return false; }
    const kindTxt = AE + ' ' + JSON.stringify(a);
    if (t === 'sword' && !WORDS.sword.test(AE)) { note('«меч» без підтвердження в описі (імовірно гілка/палиця) — прибрано'); return false; }
    if (t === 'shield' && !WORDS.shield.test(AE)) { note('«щит» без підтвердження в описі — прибрано'); return false; }
    void kindTxt; return true; });
  const held = acc.filter(a => ['sword', 'shield', 'bag'].includes(a.type) && !/crossbody|belt/i.test(a.style || ''));
  if (held.length > 2) { const keep = new Set(held.slice(0, 2)); acc = acc.filter(a => !held.includes(a) || keep.has(a)); note('більше 2 предметів у руках — зайве прибрано'); }
  if (acc.length !== before || sp.accessories_3d === undefined) sp.accessories_3d = acc; else sp.accessories_3d = acc;
  let lb = null; if (ctx.animal || isAnimal(ctx.id, desc, sp)) applyAnimal(sp, note); else lb = lowerBody(sp, desc, note);
  // 2. pants vs skirt: trousers must stay standard legs unless the text really has a skirt/dress/robe
  const legsTxt = [sp.inspection && sp.inspection.legs, sp.notes_uk, sp.design && sp.design.concept, desc && desc.legs].filter(Boolean).join(' ');
  const pants = WORDS.pants.test(legsTxt), skirty = WORDS.skirtlike.test(legsTxt) && !/(pants|trousers|штани|брюки)\s+(under|with)/i.test(legsTxt);
  if (pants && !skirty && lb !== 'dress' && sp.legs_type && sp.legs_type !== 'standard' && sp.legs_type !== 'short') { note(`штани, а не спідниця: legs_type ${sp.legs_type} → standard`); sp.legs_type = 'standard'; sp.skirt_color = null; }
  const wide = pants && WORDS.wide.test(legsTxt);
  // 3. footwear: wide/long trousers cover the shoes (only toes visible), colour separate from the trousers
  if (sp.footwear && typeof sp.footwear === 'object') { const fw = sp.footwear, ty = String(fw.type || '').toLowerCase();
    if (wide && /boot|shoe|sneak/.test(ty) && !WORDS.tallboots.test(legsTxt) && !fw.height) { fw.height = 'low'; note('широкі штани закривають взуття — видно лише носок (height=low)'); }
    if (isHex(fw.color) && isHex(sp.leg_color) && dist(fw.color, sp.leg_color) < 0.08 && !/barefoot|none/.test(ty)) { fw.sole_color = lum(fw.color) > 0.5 ? '#6C6E68' : '#F4F4F4'; note('колір взуття збігається зі штанами — підошва контрастна'); } }
  // 4. patterns: no big blobs on light garments; foreground objects (leaves, branches, hair, bag) are never prints
  const lp = tidyPrint(sp.legs_print_svg, sp.leg_color, 'legs', { occluders: occ }); sp.legs_print_svg = lp.svg; lp.notes.forEach(note);
  const tp = tidyPrint(sp.torso_print_svg, sp.torso_color, 'torso', { occluders: occ }); sp.torso_print_svg = tp.svg; tp.notes.forEach(note);
  if (wide && WORDS.embroid.test(legsTxt) && typeof sp.legs_print_svg === 'string' && !/data-embroidery/.test(sp.legs_print_svg) && isHex(sp.leg_color)) {
    const c = lum(sp.leg_color) > 0.6 ? mix('#8FA08A', sp.leg_color, 0.45) : mix('#DCBC81', sp.leg_color, 0.2);
    sp.legs_print_svg += `<g data-embroidery='1'>${sprigs(c)}</g>`; note('додано дрібну ніжну вишивку на штанях'); }
  // 5. hair colour: nearest real LEGO colour
  if (isHex(sp.hair_color)) { const s = snapHair(sp.hair_color); if (s !== sp.hair_color) { note(`колір волосся ${sp.hair_color} → ${s} (палітра LEGO)`); sp.hair_color = s; } }
  sp._qa = qa; return sp;
}

// read-only checks, used by tests / logging
function qaSpec(sp) {
  const w = []; if (!sp) return ['порожня специфікація'];
  for (const a of sp.accessories_3d || []) if (!HELD_OK.has(String(a.type))) w.push('невідомий аксесуар ' + a.type);
  for (const k of ['legs_print_svg', 'torso_print_svg']) { const v = sp[k]; if (typeof v !== 'string') continue; const base = k === 'legs_print_svg' ? sp.leg_color : sp.torso_color; let big = 0; v.replace(EL, (t, n) => { const d = decorInfo(t, n); if (d && lum(base || '#fff') > 0.6 && d.area > 80 && chroma(d.fill) > 0.18) big++; return t; }); if (big) w.push(`${k}: ${big} великих кольорових плям на світлому одязі`); }
  const legs = (sp.legs_type || 'standard'); if (sp.footwear && sp.footwear.color && sp.leg_color && dist(sp.footwear.color, sp.leg_color) < 0.05 && !/barefoot/.test(sp.footwear.type)) w.push('взуття того ж кольору, що й штани');
  void legs; return w;
}
module.exports = { sanitizeSpec, isAnimal, lowerBody, qaSpec, tidyPrint, snapHair, elBox };
