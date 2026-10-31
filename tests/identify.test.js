// node tests/identify.test.js — character identification (grounding mocked) + identity colour/clothing/material/prop rules
const I = require('../lib/identify'); const { sanitizeSpec } = require('../lib/rules');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const txt = j => (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
const parseJSON = s => { s = s.replace(/```json|```/g, ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); };
const SAHUR = { is_known_character: true, confidence: 0.9, character_name: 'Tung Tung Tung Sahur', identity: 'Tung Tung Tung Sahur (Italian brainrot)', origin: 'TikTok meme 2025', subject_kind: 'object_creature',
  traits: { material: 'wood', texture: 'wood grain', body_color_hex: '#B07A4A', colors: ['#B07A4A'], signature_props: ['wooden baseball bat'], wears_clothing: false, clothing: 'none', defining_features: ['log body', 'big eyes'] }, has_official_lego_minifig: false, search_terms_en: ['caveman club', 'wood'] };
(async () => {
  // 1. grounded call succeeds → grounded flag + sources
  let calls = [];
  const gemOk = async (m, body) => { calls.push(body); return { candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(SAHUR) + '\n```' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'Know Your Meme', uri: 'https://example.org/sahur' } }] } }] }; };
  let id = await I.identifyCharacter({ gem: gemOk, models: [], image: 'AAA', txt, parseJSON });
  ok(calls[0].tools && calls[0].tools[0].google_search, 'first call uses google_search grounding');
  ok(id.grounded && id.sources.length === 1 && id.character_name === 'Tung Tung Tung Sahur', 'grounded identity parsed with sources');
  // 2. grounding unavailable (400) → falls back to plain call
  calls = []; const gemFb = async (m, body) => { calls.push(body); if (body.tools) throw new Error('400 tools not supported'); return { candidates: [{ content: { parts: [{ text: JSON.stringify(SAHUR) }] } }] }; };
  id = await I.identifyCharacter({ gem: gemFb, models: [], image: 'AAA', txt, parseJSON });
  ok(calls.length === 2 && !calls[1].tools && id && !id.grounded && id.is_known_character, 'fallback without grounding');
  // 3. everything fails (non-quota) → null, no throw
  id = await I.identifyCharacter({ gem: async () => { throw new Error('503'); }, models: [], image: 'A', txt, parseJSON }); ok(id === null, 'total failure → null (graceful)');
  // quota on the plain call propagates
  let threw = false; try { await I.identifyCharacter({ gem: async () => { const e = new Error('quota'); e.quota = true; throw e; }, models: [], image: 'A', txt, parseJSON }); } catch (e) { threw = e.quota; } ok(threw, 'quota error propagates');
  ok(!I.normalizeIdentity({ is_known_character: true, confidence: 0.2 }).is_known_character, 'low confidence → not known');

  // rules: the bad spec from the bug report (yellow skin + black shorts)
  const bad = () => ({ skin_color: '#F2CD37', hand_color: '#F2CD37', arm_color: '#F2CD37', torso_color: '#F2CD37', leg_color: '#1b1b1b', legs_type: 'standard', accessories_3d: [], face: { gender: 'male' } });
  let sp = I.applyIdentityRules(bad(), I.normalizeIdentity({ ...SAHUR }));
  ok(sp.skin_color !== '#F2CD37' && I.snap(sp.skin_color) === sp.skin_color, 'body colour from canonical traits, not LEGO yellow (' + sp.skin_color + ')');
  ok(sp.leg_color === sp.skin_color && sp.torso_color === sp.skin_color, 'no invented shorts: legs/torso body-coloured');
  ok(/data-grain/.test(sp.torso_print_svg) && /data-grain/.test(sp.legs_print_svg), 'wood material → grain print');
  ok(sp.accessories_3d.some(a => a.type === 'club' && a.kind === 'bat'), 'signature bat → club accessory');
  ok(sanitizeSpec(sp, {}).accessories_3d.some(a => a.type === 'club'), 'club survives sanitizeSpec');
  // photo colour used when traits have no colour
  sp = I.applyIdentityRules(bad(), I.normalizeIdentity({ is_known_character: false, subject_kind: 'creature', traits: { wears_clothing: false } }), { photoColor: '#4B9F4A' });
  ok(sp.skin_color === '#4B9F4A', 'sampled photo colour used for non-human subject');
  // ordinary human stays untouched (yellow allowed)
  sp = I.applyIdentityRules(bad(), I.normalizeIdentity({ is_known_character: false, subject_kind: 'human', traits: {} }), { photoColor: '#AA7D55' });
  ok(sp.skin_color === '#F2CD37' && sp.leg_color === '#1b1b1b', 'ordinary human: rules do not change skin/clothes');
  // genuinely yellow subject keeps yellow
  sp = I.applyIdentityRules(bad(), I.normalizeIdentity({ is_known_character: true, subject_kind: 'creature', traits: { body_color_hex: '#F5CD30', wears_clothing: true } }));
  ok(sp.skin_color === '#F2CD37', 'yellow subject stays yellow');
  // clothed creature keeps clothes
  sp = I.applyIdentityRules(bad(), I.normalizeIdentity({ is_known_character: true, subject_kind: 'creature', traits: { body_color_hex: '#4B9F4A', wears_clothing: true, clothing: 'black shorts' } }));
  ok(sp.leg_color === '#1b1b1b', 'real clothing kept');
  // pixel sampler ignores white background
  const px = []; for (let i = 0; i < 100; i++) px.push(255, 255, 255); for (let i = 0; i < 60; i++) px.push(176, 122, 74);
  const d = I.dominantFromPixels(Buffer.from(px)); ok(d && Math.abs(parseInt(d.slice(1, 3), 16) - 176) < 4, 'dominant colour skips white background (' + d + ')');
  // prop mapping
  ok(I.mapProp('wooden club').type === 'club' && I.mapProp('katana').type === 'sword' && I.mapProp('flower') === null, 'prop → closest accessory');
  // search: plain message + trait ranking
  ok(/не існує/.test(I.noOfficialMessage(I.normalizeIdentity({ ...SAHUR }))), 'no-official-minifig message');
  ok(I.noOfficialMessage({ is_known_character: true, has_official_lego_minifig: true }) === null, 'no message when official exists');
  const S = I.normalizeIdentity({ ...SAHUR });
  ok(I.traitScore(S, 'Caveman with Club', 'Collectible Minifigures').sc > I.traitScore(S, 'Construction Worker, Tan Legs', 'City').sc, 'trait ranking prefers club/caveman over random tan figure');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
