// node tests/rules.test.js  — offline unit tests for the general spec rules (no Gemini, no server)
const { sanitizeSpec, qaSpec, tidyPrint, snapHair } = require('../lib/rules'); const minifig = require('../lib/minifig'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const mk = () => JSON.parse(fs.readFileSync(__dirname + '/forest_spec.json', 'utf8'));
const desc = { accessories: 'holds a bundle of dry branches', legs: 'wide trousers with leaves on them' };
let sp = sanitizeSpec(mk(), desc);
ok(!sp.accessories_3d.some(a => a.type === 'sword'), 'branches mapped to sword => dropped');
ok(sp.accessories_3d.length === 0, 'no accessory invented for carried branches');
ok(!/#237841/i.test(sp.legs_print_svg), 'green leaf blobs removed from white trousers');
ok(sp.legs_type === 'standard', 'wide trousers stay standard legs');
ok(sp.footwear.height === 'low', 'wide trousers => low footwear');
ok(/data-embroidery/.test(sp.legs_print_svg), 'delicate embroidery added instead');
ok(qaSpec(sp).length === 0, 'qaSpec clean after sanitize: ' + qaSpec(sp).join(';'));
ok(qaSpec(mk()).length >= 1, 'qaSpec flags the raw bad spec');
let k = sanitizeSpec({ accessories_3d: [{ type: 'sword', kind: 'long' }], accessories_uk: 'довгий меч лицаря', legs_print_svg: null }, {});
ok(k.accessories_3d.length === 1, 'real sword kept');
k = sanitizeSpec({ legs_type: 'wide_skirt', skirt_color: '#fff', inspection: { legs: 'jeans' }, leg_color: '#0055BF' }, {});
ok(k.legs_type === 'standard', 'jeans never become a skirt');
k = sanitizeSpec({ legs_type: 'long_robe', inspection: { legs: 'long dress' }, leg_color: '#0055BF' }, {});
ok(k.legs_type === 'long_robe', 'real dress keeps long skirt');
const big = "<path d='M10,46 Q4,56 10,70 Q18,66 18,56 Z' fill='#237841'/><rect x='0' y='60' width='100' height='6' fill='#DCBC81'/>";
const t = tidyPrint(big, '#F4F4F4', 'legs'); ok(/scale\(/.test(t.svg) || !/#237841/.test(t.svg), 'big blob shrunk/pastelised'); ok(/width='100'/.test(t.svg), 'full-width band untouched');
ok(snapHair('#8c6239') !== '#8c6239', 'hair colour snapped to LEGO palette');
const svg = minifig.renderSvg(sp); ok(svg.length > 1000 && minifig.textures(sp).legs, 'renders 2D + textures after rules');

// ---- cropped photos: the lower body is inferred from the upper garment (QA 26.10) ----
const base = () => ({ skin_color: '#F2CD37', torso_color: '#720E0F', leg_color: '#1B2A34', face: { gender: 'female' }, footwear: { type: 'shoes', color: '#FF3300' }, legs_type: 'standard', legs_print_svg: "<path d='M20,30 Q50,40 80,30' fill='none' stroke='#1b1b1b'/><circle cx='30' cy='60' r='5' fill='#FF0000'/>" });
let c = sanitizeSpec({ ...base(), inspection: { framing: 'waist_up', lower_visible: false, lower_garment: 'dress', torso_front: 'belted burgundy shirt-dress, pattern runs to the bottom edge', legs: 'black trousers' } }, {});
ok(c.legs_type === 'skirt' || c.legs_type === 'long_robe', 'cropped one-piece dress => skirt, not invented trousers (' + c.legs_type + ')');
ok(c.skirt_color === '#720E0F', 'skirt continues the dress colour');
c = sanitizeSpec({ ...base(), legs_type: 'wide_skirt', skirt_color: '#0055BF', leg_color: '#F2CD37', inspection: { framing: 'waist_up', lower_visible: false, lower_garment: 'jeans', torso_front: 'light blue denim jacket over grey tee', legs: 'not fully visible, assume dark trousers' } }, {});
ok(c.legs_type === 'standard' && c.skirt_color == null, 'cropped jacket => trousers, never a skirt');
ok(c.leg_color === '#1B2A34', 'bare/yellow legs under a cropped jacket => neutral dark trousers');
ok(!/FF0000/i.test(c.legs_print_svg || ''), 'prints invented for unseen trousers are removed');
ok(c.footwear.color === '#1b1b1b', 'unseen shoes: neutral colour');
c = sanitizeSpec({ ...base(), face: { gender: 'male' }, legs_type: 'skirt', inspection: { framing: 'bust', torso_front: 'black leather jacket', legs: 'not visible' } }, {});
ok(c.legs_type === 'standard', 'cropped man in a jacket never gets a skirt');
c = sanitizeSpec({ ...base(), legs_type: 'long_robe', inspection: { framing: 'full_body', lower_visible: true, lower_garment: 'trousers', torso_front: 'shirt', legs: 'jeans' } }, {});
ok(c.legs_type === 'standard', 'full body unchanged logic still ok (jeans stay jeans)');
c = sanitizeSpec({ ...base(), legs_type: 'skirt', skirt_color: '#fff', inspection: { framing: 'full_body', lower_visible: true, lower_garment: 'skirt', torso_front: 'blouse', legs: 'pleated skirt, white socks' } }, {});
ok(c.legs_type === 'skirt', 'full body with a real skirt keeps the skirt');
const real = JSON.parse(fs.readFileSync(__dirname + '/crop_dress_spec.json', 'utf8'));
c = sanitizeSpec(real, {}); ok(c.legs_type !== 'standard' && !(c.leg_color === '#1B2A34' && c.legs_type === 'standard'), 'real QA spec (belted shirt-dress cropped at hips): no black trousers (' + c.legs_type + ')');
ok(minifig.renderSvg(c).length > 1000, 'cropped-dress spec renders');

// ---- animals: not a yellow human ----
const { isAnimal } = require('../lib/rules');
ok(isAnimal({ subject_kind: 'animal' }, {}, {}) && !isAnimal({ subject_kind: 'human' }, { type: 'animal' }, {}), 'subject_kind decides');
ok(!isAnimal({}, { type: 'person' }, { identity: 'man walking a dog' }), 'a man with a dog is not an animal');
let a = sanitizeSpec({ skin_color: '#F2CD37', hand_color: '#F2CD37', torso_color: '#CC702A', hair_style: 'long', hair_color: '#CC702A', face: { gender: 'female' }, bust: 'subtle', bust_size: 'medium', accessories_3d: [{ type: 'sword' }, { type: 'bag' }], legs_type: 'skirt', identity: 'Bengal tiger' }, {}, { id: { subject_kind: 'animal' } });
ok(a.skin_color === '#CC702A', 'tiger skin = fur colour, not LEGO yellow');
ok(a.headgear === 'hood_fur' && a.hair_style === 'none', 'tiger: fur hood instead of human hair');
ok(a.face.gender === 'neutral' && a.bust === undefined && a.bust_size === undefined, 'tiger: no female lashes/bust');
ok(a.accessories_3d.length === 0 && a.legs_type === 'standard', 'tiger: no weapons/bags, ordinary legs');
ok(/тварин/i.test(a.animal_note_uk), 'tiger: Ukrainian note says it is an animal');
ok(minifig.renderSvg(a).length > 1000, 'animal spec renders');
// ---- legs foreground test: leaf/twig spots in front of DARK trousers are dropped, a REAL mirrored print survives ----
{
  const dark = '#1B2A34';
  const leaf = "<circle cx='20' cy='55' r='4' fill='#4B9F4A'/><rect x='62' y='40' width='6' height='5' fill='#582A12'/>"; // one green + one brown spot, no mirror twin
  const r1 = tidyPrint(leaf, dark, 'legs', { occluders: true }); ok(!/4B9F4A/i.test(r1.svg) && !/582A12/i.test(r1.svg), 'unpaired green/brown spots on dark trousers => foreground, dropped');
  const real = "<circle cx='20' cy='55' r='4' fill='#4B9F4A'/><circle cx='80' cy='55' r='4' fill='#4B9F4A'/>"; // mirrored on both legs
  const r2 = tidyPrint(real, dark, 'legs', { occluders: true }); ok((r2.svg.match(/4B9F4A/gi) || []).length === 2, 'mirrored (both legs) green print survives');
  const r3 = tidyPrint(leaf, dark, 'legs', { occluders: false }); ok(/4B9F4A/i.test(r3.svg), 'no occluders in the photo => rule does not touch the print');
  const r4 = tidyPrint("<circle cx='20' cy='55' r='4' fill='#4B9F4A'/>", '#237841', 'legs', { occluders: true }); ok(/4B9F4A/i.test(r4.svg), 'green trousers keep their own green spots (same colour family as the cloth)');
  const sp2 = mk(); sp2.inspection = Object.assign({}, sp2.inspection, { legs_print_evidence: 'uncertain', occluders: '' }); sp2.leg_color = dark; sp2.legs_print_svg = leaf;
  const o2 = sanitizeSpec(sp2, { legs: 'dark trousers' }); ok(!/4B9F4A/i.test(o2.legs_print_svg || ''), 'model says legs_print_evidence=uncertain => foreground spots dropped even without leaf words');
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
