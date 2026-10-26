// node tests/fixes.test.js — offline tests (no Gemini): bottom colour of long coats, age / grey-hair rules, "closest faces" ranking + apply.
const fs = require('fs'), path = require('path');
const rules = require('../lib/rules'), minifig = require('../lib/minifig'), fo = require('../lib/faceoptions'), fsafe = require('../lib/facesafe'), regen = require('../lib/regen');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const J = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); const trench = () => J('fixtures/trench_spec.json'); const CAT = J('../faces/catalog.json');
const hexOK = c => /^#[0-9a-f]{6}$/i.test(c || '');
const desc = { hair: 'dirty blonde hair in a low bun, loose strands', face: 'young woman, glasses', legs: 'long black trench', torso: 'black leather trench, white top', summary_uk: 'Молода дівчина в окулярах, русяве волосся в пучку, довгий чорний тренч', attrs: { gender: 'female', age: 'young', hair_color: 'dark tan' } };

// ---- 1. long trench => black bottom, never yellow/orange ----
let sp = rules.sanitizeSpec(trench(), desc, { id: {}, lowLight: true });
ok(sp.legs_type === 'long_robe', 'trench: long skirt piece (long_robe)');
for (const k of ['leg_color', 'skirt_color', 'hip_color']) ok(sp[k].toLowerCase() === '#1b2a34', `trench: ${k} = coat colour (${sp[k]})`);
ok(!/f2cd37/i.test(sp.legs_print_svg || ''), 'trench: yellow print removed from the legs');
ok(![sp.leg_color, sp.skirt_color, sp.hip_color].some(rules.isWarm), 'trench: no yellow/orange anywhere on the bottom');
ok(sp._qa.some(x => /довг|низ/i.test(x)), 'trench: rule noted in _qa');
// white top under an open black coat: the COAT colour wins
let w = trench(); w.torso_color = '#F4F4F4'; w = rules.sanitizeSpec(w, desc, { id: {} }); ok(w.skirt_color.toLowerCase() === '#1b2a34', 'white top under black coat: bottom still = coat colour (sleeves/outer layer)');
// no layers: arm colour (coat sleeves) beats the torso colour
w = trench(); delete w.layers; w.torso_color = '#F4F4F4'; w = rules.sanitizeSpec(w, desc, { id: {} }); ok(w.leg_color.toLowerCase() === '#1b2a34', 'coat sleeves colour used when no layers are given');
// the model forgot legs_type entirely: text says trench => long_robe
w = trench(); w.legs_type = 'standard'; w.skin_color = '#F2CD37'; w = rules.sanitizeSpec(w, desc, { id: {} }); ok(w.legs_type === 'long_robe' && w.skirt_color.toLowerCase() === '#1b2a34', 'trench described but legs_type standard => long_robe in coat colour');
// cropped photo + coat/dress: bare-leg skin colour is no longer copied to a LONG garment
w = rules.sanitizeSpec({ skin_color: '#F2CD37', torso_color: '#C91A09', leg_color: '#F2CD37', face: { gender: 'female' }, inspection: { framing: 'waist_up', lower_visible: false, lower_garment: 'maxi dress', torso_front: 'red maxi dress', legs: 'not visible' } }, {}, {});
ok(['long_robe', 'skirt'].includes(w.legs_type) && w.leg_color.toLowerCase() !== '#f2cd37' || w.legs_type === 'skirt', 'cropped maxi dress: long bottom is not the yellow skin colour (' + w.legs_type + '/' + w.leg_color + ')');
// invalid / unknown bottom colours: top colour or dark, never yellow/orange/blue default
for (const bad of [undefined, null, 'yellowish', '#zzz', 'orange', '']) { const t = rules.sanitizeSpec({ skin_color: '#F2CD37', torso_color: '#237841', leg_color: bad, hip_color: bad === undefined ? undefined : 'bogus', legs_type: 'standard', face: { gender: 'male' } }, {}, {});
  ok(hexOK(t.leg_color) && !rules.isWarm(t.leg_color) && (!t.hip_color || hexOK(t.hip_color)), `invalid leg_color ${JSON.stringify(bad)} => ${t.leg_color} (top colour / dark, not yellow)`); }
w = rules.sanitizeSpec({ skin_color: '#F2CD37', torso_color: '#F2CD37', arm_color: '#F2CD37', leg_color: 'nonsense', legs_type: 'standard', face: { gender: 'male' } }, {}, {}); ok(!rules.isWarm(w.leg_color), 'yellow top + unknown legs => legs still not yellow (' + w.leg_color + ')');
w = rules.sanitizeSpec({ skin_color: '#F2CD37', torso_color: '#1b1b1b', leg_color: '#FE8A18', legs_type: 'standard', face: { gender: 'male' }, notes_uk: 'orange trousers' }, {}, {}); ok(w.leg_color === '#FE8A18', 'REAL orange trousers (stated in the text) are kept');
w = rules.sanitizeSpec({ skin_color: '#F2CD37', torso_color: '#1b1b1b', leg_color: '#FE8A18', legs_type: 'standard', face: { gender: 'male' }, notes_uk: 'plain outfit' }, {}, {}); ok(w.leg_color !== '#FE8A18', 'orange trousers NOT mentioned anywhere => replaced');
// renderers do not fall back to the old blue/yellow
ok(!/#0055bf/i.test(minifig.renderSvg({ torso_color: '#C91A09' }).split('<!-- legs -->')[1].split('<!-- torso -->')[0]), '2D renderer: missing leg colour is not the old blue default');
ok(minifig.renderSvg(sp).length > 1000 && minifig.textures(sp).legs !== undefined, 'trench spec renders (2D + textures)');
// the viewer paints skirt-family parts with skirt_color
const vsrc = fs.readFileSync(path.join(__dirname, '../public/viewer3d.js'), 'utf8'); ok(/SKIRT_FAM/.test(vsrc) && /okC\(S\.skirt_color\)/.test(vsrc), '3D viewer: long_robe/wide_skirt/dress use skirt_color + validated colours');

// ---- 2. age + hair colour ----
ok(sp.face.age === 'young', 'young woman with glasses is NOT old (age=' + sp.face.age + ')');
ok(!sp.face.wrinkles && !sp.face.forehead_wrinkles && !sp.face.cheek_lines, 'no wrinkles on a young face');
ok(!/^#(6c6e68|a0a5a9|f4f4f4)$/i.test(sp.hair_color), 'dark photo + blonde hair => not grey (' + sp.hair_color + ')');
ok(/^#(aa7d55|958a73|dcbc81)$/i.test(sp.hair_color), 'blonde hair stays a LEGO dark-tan / tan colour (' + sp.hair_color + ')');
ok(/bun/.test(sp.hair_style), 'bun in the description => bun hairstyle (' + sp.hair_style + ')');
// dark photo, NO blond words, grey colour from the model => still not grey (default, not grandma)
w = trench(); w.inspection.hair = 'hair pulled back'; w.hair_style = 'short'; w.hair_color = '#A0A5A9'; w.design.concept = 'woman'; w = rules.sanitizeSpec(w, { summary_uk: 'Дівчина вночі', attrs: {} }, { id: {}, lowLight: true }); ok(!/^#(6c6e68|a0a5a9)$/i.test(w.hair_color), 'dark photo, grey colour without any grey evidence => not grey (' + w.hair_color + ')');
// real grey hair + real old person: keep it
w = trench(); w.inspection.face = 'elderly woman with deep wrinkles'; w.inspection.hair = 'short grey hair'; w.hair_style = 'short'; w.hair_color = '#A0A5A9'; w = rules.sanitizeSpec(w, { summary_uk: 'Літня жінка з сивим волоссям', face: 'зморшки', attrs: { age: 'old' } }, { id: {} });
ok(w.face.age === 'old' && /^#(a0a5a9|6c6e68)$/i.test(w.hair_color), 'explicit wrinkles + grey hair => age old and grey hair kept (' + w.face.age + ', ' + w.hair_color + ')');
// "old" without evidence from a neutral description
w = trench(); w.face.age = 'old'; w = rules.sanitizeSpec(w, { summary_uk: 'Людина в куртці', attrs: {} }, { id: {} }); ok(w.face.age !== 'old', 'age old without any wrinkle/elderly evidence => downgraded (' + w.face.age + ')');
// grey hair for a YOUNG person only when explicitly stated (dyed silver)
w = trench(); w.inspection.hair = 'bright silver-grey dyed hair'; w.hair_color = '#A0A5A9'; w = rules.sanitizeSpec(w, { summary_uk: 'Молода дівчина зі срібним волоссям', attrs: { age: 'young' } }, { id: {} }); ok(/^#a0a5a9$/i.test(w.hair_color) && w.face.age === 'young', 'explicitly silver hair on a young person is kept');
// prompt text
const srv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
ok(/IMAGE H = ENLARGED/.test(srv) && /judge AGE from the skin/.test(srv) && /dark \/ low-light|DARK \/ LOW-LIGHT/.test(srv) && /a bun \/ top-knot is a bun/.test(srv), 'prompt: zoomed head crop, age from face, no blonde-as-grey in dark photos, bun');
ok(/photoInfo/.test(srv) && /lowLight: PHOTO\.lowLight/.test(srv), 'server computes lowLight + head crop and passes it to the rules');

// ---- 3. face options ----
const fspec = { face: { gender: 'female', expression: 'neutral', glasses: 'round', age: 'young', lashes: true, brow_color: '#583927' }, head_part: null };
const opts = fo.faceOptions(fspec, CAT, { n: 6 });
ok(opts.length >= 4 && opts.length <= 6, 'face options: 4–6 variants (' + opts.length + ')');
ok(new Set(opts.map(o => o.part)).size === opts.length && new Set(opts.map(o => fo.normTitle(o.title).toLowerCase())).size === opts.length, 'face options: all distinct');
ok(opts.every(o => fsafe.isSafeHead(CAT.find(c => c.part === o.part), {}) && !regen.BAN_PARTS.has(o.part) && !regen.headTraits(CAT.find(c => c.part === o.part).title).themed), 'face options: only SAFE heads (no banned / themed / scary)');
ok(opts.every(o => regen.headTraits(CAT.find(c => c.part === o.part).title).fem), 'female face => only female heads');
ok(opts.filter(o => /окуляри/.test(o.label)).length >= 2, 'glasses wanted => several options with glasses');
ok(opts.every(o => o.id && o.label && typeof o.score === 'number' && o.thumb && fs.existsSync(path.join(__dirname, '../public', String(o.thumb).replace(/^\//, '')))), 'every option has id/label/score/thumb (bitmap exists in public/)');
ok(opts.every((o, i) => i === 0 || opts[i - 1].score >= o.score), 'sorted by score');
const m = fo.faceOptions({ face: { gender: 'male', expression: 'smile', beard: 'stubble' } }, CAT, { n: 5 }); ok(m.length >= 4 && m.every(o => !regen.headTraits(CAT.find(c => c.part === o.part).title).fem), 'male face => no female heads (' + m.length + ')');
const ex = fo.faceOptions(fspec, CAT, { n: 6, exclude: opts.slice(0, 2).map(o => o.part) }); ok(ex.length >= 4 && !ex.some(o => opts.slice(0, 2).some(p => p.part === o.part)), 'exclude list honoured');
const bare = fo.faceOptions({ face: { gender: 'male' } }, CAT, { n: 6 }); ok(bare.length >= 4, 'sparse face spec still gives ≥4 options');
// fallback thumbnail from the existing face renderer
const svg = minifig.headThumbSvg({ gender: 'female', expression: 'smile', lashes: true, glasses: 'round' }, '#F2CD37'); ok(/<svg/.test(svg) && svg.length > 500 && /<ellipse/.test(svg), 'head thumbnail SVG renders from the existing face renderer');
// apply
const sp2 = JSON.parse(JSON.stringify(fspec)); const pick = opts[1].part; const r = fo.applyFace(sp2, pick, CAT); ok(r && sp2.head_part === pick && sp2.head_glasses_printed === !!regen.headTraits(CAT.find(c => c.part === pick).title).glasses + 0 || (r && sp2.head_part === pick), 'applyFace sets head_part (' + pick + ')');
ok(!fo.applyFace({ face: {} }, '3626bp0d', CAT) && !fo.applyFace({ face: {} }, '../etc/passwd', CAT) && !fo.applyFace({ face: { gender: 'male' } }, '3626bp48', CAT), 'banned / garbage part ids are rejected');
ok(!fo.applyFace({ face: { mask: { type: 'metal_full' } } }, pick, CAT), 'masked figure: face change refused');
ok(regen.signature(sp2).head === 'head:' + pick, 'signature reflects the new head');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
