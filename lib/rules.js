// Правила-«виправлялки» для згенерованої фігурки: прибирає дивні кольори,
// правильно фарбує ноги/довгий одяг, тварин, волосся тощо. Викликається сервером після генерації.
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
// hue (0..360) of a #rrggbb colour; foliage = green / yellow-green / olive, twig = dark brown. Used to tell leaves & branches in FRONT of the trousers from a real print.
function hue(h) { const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x; }
const foliageLike = c => { if (!isHex(c) || chroma(c) < 0.1) return false; const hh = hue(c); return (hh >= 55 && hh <= 175) || (hh >= 15 && hh < 55 && lum(c) < 0.55); };
// a REAL print repeats on both legs (mirror image about x=50 at about the same height); a leaf / twig in front of the legs is a one-off
function hasMirrorTwin(pre, i) { const a = pre[i]; return pre.some((b, j) => j !== i && b && Math.abs(a.cx + b.cx - 100) < 14 && Math.abs(a.cy - b.cy) < 12 && b.area / a.area > 0.4 && b.area / a.area < 2.5 && dist(a.fill, b.fill) < 0.18); }
const scaleAbout = (tag, cx, cy, s) => `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${s.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})">${tag}</g>`;
const setFill = (tag, c) => tag.replace(/fill\s*=\s*(["'])#[0-9a-f]{6}\1/i, `fill="${c}"`);

// Remove / shrink / pastelise oversized pattern spots on a print. Returns {svg, notes}.
//  base: garment colour; kind: 'legs' | 'torso'; occluders: true when the photo has foreground objects (leaves, branches, hair) that
//  must NOT become prints => saturated organic-coloured spots are dropped entirely.
function tidyPrint(svg, base, kind, { occluders = false } = {}) {
  const notes = []; if (typeof svg !== 'string' || !svg) return { svg, notes }; if (!isHex(base)) base = '#F4F4F4';
  const pre = []; svg.replace(EL, (tag, name) => { pre.push(decorInfo(tag, name)); return tag; }); let idx = 0, fg = 0;
  const light = lum(base) > 0.6, CAP = light ? 70 : 140, TOTAL = kind === 'legs' ? 420 : 700; let total = 0, dropped = 0, shrunk = 0, pastel = 0;
  const out = svg.replace(EL, (tag, name) => {
    const i = idx++, d = pre[i]; if (!d) return tag;
    // foreground test (legs): green/olive/brown spots that are NOT mirrored on the other leg are leaves/twigs lying in front of the trousers, not a print
    if (occluders && kind === 'legs' && d.area >= 4 && foliageLike(d.fill) && !foliageLike(base) && dist(d.fill, base) > 0.12 && !hasMirrorTwin(pre, i)) { fg++; dropped++; return ''; }
    const organic = chroma(d.fill) > 0.18 && dist(d.fill, base) > 0.25; // coloured blob on a differently coloured garment
    if (occluders && light && organic && d.area > 25) { dropped++; return ''; }
    if (total + Math.min(d.area, CAP) > TOTAL) { dropped++; return ''; }
    let t = tag, area = d.area;
    if (light && organic && chroma(d.fill) > 0.12) { t = setFill(t, mix(d.fill, base, 0.6)); pastel++; }
    if (area > CAP) { const s = Math.sqrt(CAP / area); t = scaleAbout(t, d.cx, d.cy, s); area = CAP; shrunk++; }
    total += area; return t;
  });
  if (dropped) notes.push(`${kind}: прибрано ${dropped} великих/зайвих плям візерунка`);
  if (fg) notes.push(`${kind}: ${fg} зелених/коричневих плям без дзеркальної пари на другій нозі — це листя/гілки перед штанами, не принт`);
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
    if (isHex(sp.skin_color) && (!isHex(sp.leg_color) || trousersSaidInsp || dist(sp.skirt_color, sp.leg_color) < 0.05)) sp.leg_color = sp.legs_type === 'skirt' ? sp.skin_color : sp.skirt_color; // trousers guessed under the dress are dropped: a short skirt shows bare legs, a LONG dress/coat hides them => its own colour (was: skin = yellow)
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


// ---- lower body colour: a long coat / trench / dress colours the whole bottom; never a yellow/orange default ----
const SKIRT_FAMILY = new Set(['skirt', 'long_robe', 'wide_skirt', 'dress_slope']);
const LONG_OUTER = /trench|long coat|overcoat|duster|maxi|gown|\brobe|cassock|knee[- ]length coat|calf[- ]length|ankle[- ]length|floor[- ]length|long dress|long skirt|midi (dress|skirt|coat)|довг(ий|е|а|і)\s+(плащ|пальто|сукн|спідниц|тренч)|тренч|плащ-?пальто/i;
const WARM_OK = /yellow|orange|mustard|gold|amber|saffron|жовт|оранж|гірчич|золот|помаранч/i;
const SKIN_BARE = /shorts|bare[- ]legs|barefoot|swim|bikini|mini ?skirt|шорти|голі ноги|купальн/i;
const FALLBACK_LOWER = '#1B2A34';
// hue/chroma test: "yellow or orange" family (LEGO yellow #F2CD37, orange #FE8A18, nougat-like #CC702A, bright light orange #F8BB3D)
function isWarm(h) { if (!isHex(h)) return false; const [r, g, b] = rgb(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b); if ((mx - mn) / 255 < 0.35 || r < g) return false; const d = mx - mn, hue = 60 * (((g - b) / d) % 6); const hh = hue < 0 ? hue + 360 : hue; return hh >= 18 && hh <= 62 && mx > 150; }
function lowerText(sp, desc) { return [sp.inspection && sp.inspection.legs, sp.inspection && sp.inspection.hips, sp.inspection && sp.inspection.lower_garment, sp.inspection && sp.inspection.torso_front, sp.notes_uk, sp.design && sp.design.concept, sp.torso_desc, sp.accessories_uk, desc && desc.torso, desc && desc.legs, desc && desc.summary_uk, desc && desc.attrs && (desc.attrs.legs_color + ' ' + desc.attrs.torso_print), sp.layers && JSON.stringify(sp.layers)].filter(Boolean).join(' | '); }
// colour of the OUTERMOST layer (the coat), not of the garment under it
function outerColor(sp) {
  const ok = c => isHex(c) && !isWarm(c) && !(isHex(sp.skin_color) && dist(c, sp.skin_color) < 0.08);
  if (sp.layers && sp.layers.outer && ok(sp.layers.outer.color)) return sp.layers.outer.color;
  if (ok(sp.arm_color)) return sp.arm_color;      // coat sleeves = coat colour even when the top under an open coat is white
  if (ok(sp.torso_color)) return sp.torso_color;
  return FALLBACK_LOWER;
}
function fallbackLower(sp) { const ok = c => isHex(c) && !isWarm(c) && !(isHex(sp.skin_color) && dist(c, sp.skin_color) < 0.08); return ok(sp.torso_color) ? sp.torso_color : ok(sp.arm_color) ? sp.arm_color : FALLBACK_LOWER; }
function dropWarmSpots(svg, base, note, kind) {
  if (typeof svg !== 'string' || !svg || isWarm(base)) return svg; let n = 0;
  const v = svg.replace(EL, (tag, name) => { const a = attrs(tag); if (isWarm(a.fill)) { n++; return ''; } return tag; }); if (n) note(`${kind}: ${n} жовтих/оранжевих фігур прибрано (низ має колір вбрання)`); return v; }
// long outer garment => legs_type long_robe in the COAT colour (hip + legs + skirt all equal), print has no yellow
function longOuterwear(sp, desc, note) {
  if (sp.bare_torso === true) return false; const T = lowerText(sp, desc); if (!LONG_OUTER.test(T)) return false;
  if (!sp.legs_type || sp.legs_type === 'standard' || sp.legs_type === 'short') { sp.legs_type = 'long_robe'; note('довге пальто/тренч/сукня → довга спідниця (long_robe) кольору вбрання'); }
  if (!SKIRT_FAMILY.has(sp.legs_type)) return false;
  if (sp.legs_type === 'skirt') return false; // a short skirt keeps its own (possibly bare) legs
  const col = outerColor(sp);
  const prev = [sp.skirt_color, sp.leg_color, sp.hip_color].map(x => String(x).toLowerCase()).join('/');
  sp.skirt_color = col; sp.leg_color = col; sp.hip_color = col; sp.leg_right_color = null;
  if (prev !== [col, col, col].map(x => x.toLowerCase()).join('/')) note(`низ довгого вбрання = колір верхнього шару (${col}), без жовтого дефолту`);
  sp.legs_print_svg = dropWarmSpots(sp.legs_print_svg, col, note, 'ноги'); sp.hips_print_svg = dropWarmSpots(sp.hips_print_svg, col, note, 'ноги');
  return true;
}
// last line of defence: no invalid / unknown / yellow-orange bottom colour — fall back to the top colour or black
function lowerColorGuard(sp, desc, note) {
  if (sp.bare_torso === true) return; const T = lowerText(sp, desc), warmOk = WARM_OK.test(T), longG = SKIRT_FAMILY.has(sp.legs_type) && sp.legs_type !== 'skirt';
  const fb = fallbackLower(sp); const skinLike = c => isHex(sp.skin_color) && isHex(c) && dist(c, sp.skin_color) < 0.06;
  for (const k of ['leg_color', 'hip_color', 'leg_right_color', 'skirt_color']) {
    const v = sp[k]; if (v === undefined || v === null || v === '') { if (k === 'leg_color') { sp.leg_color = fb; note(`колір ніг не заданий → ${fb} (колір верху/темний, не жовтий)`); } continue; }
    if (!isHex(v)) { sp[k] = fb; note(`невалідний ${k} «${String(v).slice(0, 20)}» → ${fb}`); continue; }
    if ((isWarm(v) && !warmOk && !skinLike(v)) || (longG && skinLike(v) && !SKIN_BARE.test(T))) { if (k === 'leg_color' && skinLike(v) && !longG && !warmOk) continue; sp[k] = fb; note(`${k} ${v} (жовтий/оранжевий/шкіра без підтвердження в описі) → ${fb}`); }
  }
  if (SKIRT_FAMILY.has(sp.legs_type) && !isHex(sp.skirt_color)) sp.skirt_color = isHex(sp.leg_color) && !skinLike(sp.leg_color) ? sp.leg_color : fb;
}

// ---- age / hair colour: never "grandma" without evidence; blond/light-brown hair in a dark photo is not grey ----
const OLD_EV = /wrinkl|elderly|aged\b|old (man|woman|person|lady|gentleman)|grand(ma|pa|mother|father)|senior|pensioner|retired|зморшк|літн|старий|стара\b|старенька|бабус|дідус|пенсіон|сивий чолов|сива жінк/i;
const YOUNG_EV = /young|teen|girl\b|boy\b|child|kid\b|\b[1-3]\d[- ]?(y|yo|years?|р\b|років|рік)|20s|30s|youth|student|молод|дівчин|дівчат|хлопч|хлопець|підліт|дитин|студент/i;
const GREY_EV = /gr[ae]y[- ]?hair|gr[ae]y[- ]haired|silver[- ]?hair|white[- ]?hair|hair is (gr[ae]y|silver|white)|(gr[ae]y|silver|white) hair|salt[- ]and[- ]pepper|сив(е|ий|а|ину|ина|ого)|срібляст(е|ий|а) волосс|біле волосс/i;
const GREY_LOOSE = /(gr[ae]y|silver|white|platinum|сив|срібн|срібляст|біл)[^|,;.]{0,18}(hair|волосс)|(hair|волосс)[^|,;.]{0,18}(gr[ae]y|silver|white|platinum|сив|срібн|срібляст|біл)|salt[- ]and[- ]pepper|\bсивин/i;
const BLOND_EV = /dirty[- ]blond|blond|light[- ]brown|ash|honey|dark[- ]blond|russia?n|русяв|світл(е|ий|а|о)|блонд|золотист|медов|попелясть/i;
const BUN_EV = /\bbun\b|top[- ]?knot|updo|chignon|пучок|пучка|гулька|гулю|вузол/i;
const GREYISH = h => isHex(h) && chroma(h) < 0.10 && lum(h) > 0.22 && lum(h) < 0.92;
const LEGO_BLOND = '#AA7D55', LEGO_DARK_TAN = '#958A73', LEGO_BLOND_LIGHT = '#DCBC81', DEFAULT_BROWN = '#583927';
function hairOnly(sp, desc) { return [sp.inspection && sp.inspection.hair, desc && desc.hair, desc && desc.attrs && desc.attrs.hair_color].filter(Boolean).join(' | '); }
function hairText(sp, desc) { return [sp.inspection && sp.inspection.hair, desc && desc.hair, desc && desc.attrs && (desc.attrs.hair_color + ' ' + desc.attrs.hair_style), desc && desc.summary_uk, sp.notes_uk, sp.design && sp.design.concept, sp.accessories_uk].filter(Boolean).join(' | '); }
function ageHair(sp, desc, ctx, note) {
  if (!sp || typeof sp !== 'object' || isAnimal(ctx && ctx.id, desc, sp) || (ctx && ctx.id && ctx.id.is_known_character)) return;
  const f = sp.face = sp.face && typeof sp.face === 'object' ? sp.face : {}; if (f.mask && f.mask !== 'none') return;
  const faceTxt = [sp.inspection && sp.inspection.face, desc && desc.face, desc && desc.attrs && desc.attrs.age, desc && desc.summary_uk, desc && desc.type, sp.notes_uk].filter(Boolean).join(' | ');
  // age
  let age = String(f.age || '').toLowerCase(); if (!['young', 'adult', 'old'].includes(age)) age = f.age ? 'adult' : age;
  const oldEv = OLD_EV.test(faceTxt) || OLD_EV.test(hairText(sp, desc)), youngEv = YOUNG_EV.test(faceTxt), greyRaw = GREY_EV.test(hairText(sp, desc)) || GREY_LOOSE.test(hairOnly(sp, desc)), greyEv = greyRaw && !(ctx && ctx.lowLight && age !== 'old' && !/dye|bleach|silver|platinum|фарб|срібн|платин/i.test(hairText(sp, desc)));
  if (age === 'old' && (!oldEv || youngEv)) { f.age = youngEv ? 'young' : 'adult'; note(`вік: «old» без ознак старості (зморшки/літня людина) у описі → ${f.age}`); age = f.age; }
  else if (!age) { f.age = youngEv ? 'young' : 'adult'; age = f.age; }
  if (age !== 'old') for (const k of ['wrinkles', 'forehead_wrinkles']) if (f[k]) { delete f[k]; note(`вік ${age}: зморшки (${k}) прибрано`); }
  if (age !== 'old' && f.cheek_lines && !/dimple|смуг|ямоч|smile line/i.test(faceTxt)) { delete f.cheek_lines; note('молоде обличчя: лінії щік прибрано'); }
  // hair colour: grey/white/light-grey only with an explicit statement in the description
  const ht = hairText(sp, desc);
  if (isHex(sp.hair_color) && sp.hair_style !== 'bandana_tails' && !(sp.headgear && sp.headgear !== 'none' && !sp.hair_style) && !greyEv && !(age === 'old' && oldEv) && GREYISH(sp.hair_color) && !/bald|none/.test(String(sp.hair_style || ''))) {
    const dark = !!(ctx && ctx.lowLight), blond = BLOND_EV.test(ht);
    const was = sp.hair_color; sp.hair_color = blond ? (/dirty|light[- ]brown|dark[- ]blond|ash|russia?n|русяв|попелясть/i.test(ht) ? LEGO_DARK_TAN : LEGO_BLOND_LIGHT) : (dark || age !== 'old' ? LEGO_DARK_TAN : DEFAULT_BROWN);
    note(`волосся ${was} виглядало сивим, але в описі немає ознак сивини${dark ? ' (темне/нічне фото)' : ''} → ${sp.hair_color}`); }
  if (isHex(sp.hair_secondary_color) && GREYISH(sp.hair_secondary_color) && !greyEv && !/cap|helmet/.test(String(sp.hair_style))) sp.hair_secondary_color = null;
  // bun
  if (BUN_EV.test(ht) && !/bun/.test(String(sp.hair_style || '')) && !['sculpt', 'none', 'bald'].includes(String(sp.hair_style || 'x')) && !(sp.headgear && sp.headgear !== 'none')) {
    const was = sp.hair_style; sp.hair_style = /high|top|верх|на маківці/i.test(ht) ? 'bun_high' : /fringe|bangs|strand|loose|чубч|чолк|пасм|low|низьк/i.test(ht) ? 'bun_low_fringe' : 'bun'; delete sp.hair_sculpt; delete sp.hair_part; note(`пучок у описі → hair_style ${was} → ${sp.hair_style}`); }
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
  const legEv = /^(uncertain|none|foreground|leaves|no)/i.test(String(sp.inspection && sp.inspection.legs_print_evidence || '')); // the model itself says: no clearly REAL print on the trousers
  const lp = tidyPrint(sp.legs_print_svg, sp.leg_color, 'legs', { occluders: occ || legEv }); sp.legs_print_svg = lp.svg; lp.notes.forEach(note);
  const tp = tidyPrint(sp.torso_print_svg, sp.torso_color, 'torso', { occluders: occ }); sp.torso_print_svg = tp.svg; tp.notes.forEach(note);
  if (wide && WORDS.embroid.test(legsTxt) && typeof sp.legs_print_svg === 'string' && !/data-embroidery/.test(sp.legs_print_svg) && isHex(sp.leg_color)) {
    const c = lum(sp.leg_color) > 0.6 ? mix('#8FA08A', sp.leg_color, 0.45) : mix('#DCBC81', sp.leg_color, 0.2);
    sp.legs_print_svg += `<g data-embroidery='1'>${sprigs(c)}</g>`; note('додано дрібну ніжну вишивку на штанях'); }
  // 4b. long coat / trench / dress => bottom = coat colour; then never an invalid / yellow / orange bottom
  if (!(ctx.animal || isAnimal(ctx.id, desc, sp))) { longOuterwear(sp, desc, note); lowerColorGuard(sp, desc, note); }
  // 4c. age + hair colour + bun sanity (dark photos, glasses, ...)
  ageHair(sp, desc, ctx, note);
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
module.exports = { longOuterwear, lowerColorGuard, ageHair, isWarm, outerColor, sanitizeSpec, isAnimal, lowerBody, qaSpec, tidyPrint, snapHair, elBox };
