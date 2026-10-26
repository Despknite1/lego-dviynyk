// node tests/regen.test.js — offline tests: exclude-list regeneration, locks, conservative face rule (no Gemini, no server)
const regen = require('../lib/regen'); const locks = require('../lib/locks'); const minifig = require('../lib/minifig'); const CAT = require('../faces/catalog.json');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const mk = () => ({ skin_color: '#F2CD37', torso_color: '#0055BF', arm_color: '#0055BF', hand_color: '#F2CD37', leg_color: '#1b1b1b', hip_color: '#1b1b1b', hair_style: 'short', hair_color: '#582A12', headgear: 'none', legs_type: 'standard',
  torso_print_svg: "<rect x='45' y='0' width='10' height='100' fill='#F4F4F4'/>", legs_print_svg: "<rect x='0' y='90' width='100' height='10' fill='#6C6E68'/>", collar: 'none',
  face: { gender: 'male', expression: 'smile' } });
const same = (a, b, keys) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// ---- 1. exclude list: every unlocked role changes (100%), locked roles stay byte-identical
{ const prev = mk(); regen.sanitizeFace(prev, CAT); const hist = [regen.signature(prev)];
  const s = mk(); const r = regen.enforceRegen(s, { history: hist, locked: [], catalog: CAT, seed: 'a' }); const sig = regen.signature(s), ps = hist[0];
  ok(sig.head !== ps.head && /^head:/.test(sig.head), 'unlocked head => a different official head id (' + s.head_part + ')');
  ok(sig.hair !== ps.hair, 'unlocked hair => different style (' + prev.hair_style + ' -> ' + s.hair_style + ')');
  ok(sig.torso !== ps.torso, 'unlocked torso => different colour/print (' + prev.torso_color + ' -> ' + s.torso_color + ')');
  ok(sig.legs !== ps.legs, 'unlocked legs => different colour/print');
  ok(r.changed.length === 4, 'all 4 visible roles reported as changed: ' + r.changed.join(','));
  ok(s.arm_color === s.torso_color, 'sleeves follow the new torso colour');
  ok(regen.headTraits(s.head_part_title).fem === false, 'male subject never gets a female head'); }
{ const prev = mk(); const hist = [regen.signature(prev)]; const locked = ['Голова', 'Торс'];
  const s = mk(); regen.enforceRegen(s, { history: hist, locked, catalog: CAT, seed: 'b' });
  ok(same(s, prev, ['face', 'head_part', 'torso_color', 'torso_print_svg', 'arm_color', 'collar']), 'locked head + torso stay EXACTLY the same');
  ok(s.hair_style !== prev.hair_style && regen.signature(s).legs !== regen.signature(prev).legs, 'unlocked hair + legs still change'); }
{ const prev = mk(); prev.face = { gender: 'female', expression: 'neutral', lashes: true }; const s = JSON.parse(JSON.stringify(prev)); s.hair_style = 'bob';
  regen.enforceRegen(s, { history: [regen.signature(prev)], locked: [], catalog: CAT, seed: 'f' }); ok(regen.headTraits(s.head_part_title).fem, 'female subject keeps a female head'); ok(s.hair_style !== prev.hair_style, 'female hair changes within the female group'); }
// 12 regenerations in a row: no head id, hair style or torso variant ever repeats (history accumulates)
{ const hist = []; const heads = new Set(), torsos = new Set(), hairs = new Set(); let dup = false; let cur = mk();
  for (let i = 0; i < 12; i++) { const s = mk(); if (i === 0) { regen.sanitizeFace(s, CAT); } else regen.enforceRegen(s, { history: hist, locked: [], catalog: CAT, seed: 'r' + i }); const sg = regen.signature(s);
    if (heads.has(sg.head) && i > 0) dup = true; heads.add(sg.head); if (torsos.has(sg.torso) && i > 0) dup = true; torsos.add(sg.torso); hist.push(sg); hairs.add(sg.hair); cur = s; }
  ok(!dup, '12 regenerations: head id / torso never repeat (' + heads.size + ' heads, ' + torsos.size + ' torsos, ' + hairs.size + ' hair variants)'); void cur; }
{ const prev = mk(); prev.headgear = 'cap'; prev.hair_style = 'none'; const s = JSON.parse(JSON.stringify(prev)); regen.enforceRegen(s, { history: [regen.signature(prev)], locked: [], catalog: CAT, seed: 'c' }); ok(s.hair_style === 'none' && s.headgear === 'cap', 'hidden hair / headgear is not touched'); }
{ const prev = mk(); prev.bare_torso = true; const s = JSON.parse(JSON.stringify(prev)); regen.enforceRegen(s, { history: [regen.signature(prev)], locked: [], catalog: CAT, seed: 'c' }); ok(s.torso_color === prev.torso_color, 'bare torso (skin) is not recoloured'); }
{ const prev = mk(); prev.face = { mask: { type: 'metal_full' } }; const s = JSON.parse(JSON.stringify(prev)); regen.enforceRegen(s, { history: [regen.signature(prev)], locked: [], catalog: CAT, seed: 'c' }); ok(!s.head_part, 'masked head (metal mask) never replaced by a plain head'); }
{ const s = mk(); const before = JSON.stringify(s); regen.enforceRegen(s, { history: [], locked: [], catalog: CAT }); ok(JSON.stringify(s) === before, 'first generation (empty history) is untouched'); }
ok(regen.cleanHist([{ head: 'x'.repeat(200), hair: 'ok', evil: 1 }, null, 'str'])[0].head === undefined, 'history from the client is sanitised');

// ---- 2. conservative face rule
{ const s = mk(); s.face = { gender: 'male', expression: 'neutral', glasses: 'round', beard: 'full', freckles: true, lipstick: '#C91A09', cheeks: '#F2A0A0', nose: 'small', eye_color: '#3FB6A8' };
  const n = regen.sanitizeFace(s, CAT); ok(/^3626[bc]p/.test(s.head_part || ''), 'busy / contradictory composite face => whole official head (' + s.head_part + ')'); ok(n.length === 1 && /впевненість/.test(n[0]), 'fallback is logged in _qa notes');
  ok(!s.face.face_extra_svg && !s.face.lipstick, '2D face spec is cleaned to match the official head'); }
{ const s = mk(); s.face = { gender: 'female', expression: 'smile', lashes: true, beard: 'full' }; regen.sanitizeFace(s, CAT); ok(s.head_part && regen.headTraits(s.head_part_title).fem && !regen.headTraits(s.head_part_title).beard, 'female + beard is invalid => clean female head'); }
{ const s = mk(); s.face = { gender: 'male', expression: 'wink', glasses: 'sunglasses', eye_color: '#00ff00' }; regen.sanitizeFace(s, CAT); ok(!!s.head_part || s.face.expression !== 'wink', 'wink under sunglasses is fixed'); }
{ const s = mk(); s.face = { gender: 'male', expression: 'smile', face_extra_svg: "<circle cx='50' cy='50' r='30' fill='#f0f'/>" }; regen.sanitizeFace(s, CAT); ok(!s.face.face_extra_svg, 'free-form face art removed'); ok(!!s.head_part, 'free-form face art => official head'); }
{ const s = mk(); s.face = { gender: 'male', expression: 'smile', glasses: 'round' }; regen.sanitizeFace(s, CAT); ok(!s.head_part && s.face.glasses === 'round', 'simple valid composite face (smile + glasses) is kept'); ok(s._face_conf >= 0.7, 'confidence reported (' + s._face_conf + ')'); }
{ const s = mk(); s.face = { gender: 'male', expression: 'pursed' }; regen.sanitizeFace(s, CAT); ok(s.face.expression === 'neutral', "unknown expression 'pursed' => neutral (it used to render as a smile)"); }
{ const s = mk(); s.face = { gender: 'male', expression: 'neutral', glasses: 'round', beard: 'full', freckles: true, lipstick: '#C91A09', cheeks: '#F2A0A0', nose: 'small', eye_color: '#3FB6A8', age: 'old' }; const empty = []; regen.sanitizeFace(s, empty); ok(!s.head_part && regen.faceFeatures(s.face).length <= 3, 'no catalog => composite face is simplified, never left busy'); }
{ const s = mk(); s.head_part = '3626bp01'; s.face = { glasses: 'round', beard: 'full', freckles: true, lipstick: '#f00', cheeks: '#f00', nose: 'x' }; const f = JSON.stringify(s.face); regen.sanitizeFace(s, CAT); ok(JSON.stringify(s.face) === f, 'already-official head is not touched'); }
{ const t = regen.faceSanity({ gender: 'male', expression: 'smile' }); ok(t.confidence === 1, 'plain face has full confidence'); }
{ const heads = regen.plainHeads(CAT); ok(heads.length > 60 && !heads.some(c => /\bHP\b|\bSW\b|LOTR|Insectoid|Fish|Pineapple/.test(c.title)), 'plain head pool excludes franchise / bizarre prints (' + heads.length + ' heads)'); }
{ const s = mk(); s.face = { gender: 'male', expression: 'neutral', glasses: 'round', beard: 'full', freckles: true, lipstick: '#C91A09', cheeks: '#F2A0A0', nose: 'small', eye_color: '#3FB6A8' }; regen.sanitizeFace(s, CAT); s.textures = minifig.textures(s); ok(!s.head_glasses_printed || !s.textures.glasses, 'glasses are never drawn twice (print on head + overlay)'); }

// ---- 3. locks
{ const old = { torso_color: '#0055BF', leg_color: '#111111', legs_type: 'skirt', hair_style: 'bob' }; const rd = id => id === '111-abcd' ? old : null;
  let r = locks.lockedFields('111-abcd', ['Низ / ноги'], rd); ok(r.fixed && r.fixed.legs_type === 'skirt' && !('torso_color' in r.fixed), 'lock copies only the locked role');
  r = locks.lockedFields('111-abcd', ['Hacked', '__proto__', 'Торс'], rd); ok(r.roles.length === 1 && r.roles[0] === 'Торс', 'unknown roles are dropped');
  r = locks.lockedFields('../../etc/passwd', ['Торс'], rd); ok(r.missing && !r.fixed, 'bad lock_from id is rejected');
  r = locks.lockedFields('222-abcd', ['Торс'], rd); ok(r.missing === true, 'vanished source figure is reported (UI warns instead of silently ignoring)');
  r = locks.lockedFields('111-abcd', [], rd); ok(!r.fixed && !r.missing, 'no locks => nothing to copy'); }
// pool exhausted (60 regenerations of a female face, pool is 15 heads): still never the same head twice in a row
{ const hist = []; let prevHead = null, rep = false; for (let i = 0; i < 60; i++) { const s = mk(); s.face = { gender: 'female', expression: 'smile', lashes: true }; if (i === 0) regen.sanitizeFace(s, CAT); else regen.enforceRegen(s, { history: hist, locked: [], catalog: CAT, seed: 'x' + i }); const sg = regen.signature(s); if (sg.head === prevHead) rep = true; prevHead = sg.head; hist.push(sg); }
  ok(!rep, 'exhausted pool: consecutive regenerations never give the same head'); }
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
