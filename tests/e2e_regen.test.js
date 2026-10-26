// node tests/e2e_regen.test.js — full /api/generate flow against a FAKE Gemini (zero real API calls):
// first generation -> regenerate with locks -> regenerate without locks; checks exclude-list + locks + friendly quota error.
const sharp = require('sharp'); const regen = require('../lib/regen');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const H = require('./helpers/harness');
let st, J, run;
(async () => {
  const h = await H.start(); st = h.st; J = h.J; run = h.run;
  const crop = (await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer()).toString('base64'); const base = { crop, subject: { label: 'x' }, description: { summary_uk: 'тест', attrs: { gender: 'male' } } };
  const get = async id => (await J('/out/' + id + '.json'));
  const idOf = r => r.result.viewer3d.split('id=')[1];
  // 1. first generation
  const g1 = await run('generate', base); ok(g1.status === 'done', 'first generation works (fake Gemini): ' + (g1.error || '')); const id1 = idOf(g1), s1 = await get(id1);
  ok(!g1.result.regenerated && g1.result.signature && g1.result.signature.head, 'first generation returns a signature, not flagged as regeneration');
  // 2. regenerate with torso + legs locked: head/hair change, torso/legs byte-identical
  const g2 = await run('generate', { ...base, prev_id: id1, lock_from: id1, locked_roles: ['Торс', 'Низ / ноги'], history: [g1.result.signature] }); ok(g2.status === 'done' && g2.result.regenerated, 'regeneration flagged'); const id2 = idOf(g2), s2 = await get(id2);
  ok(s2.torso_color === s1.torso_color && s2.torso_print_svg === s1.torso_print_svg && s2.leg_color === s1.leg_color && s2.legs_print_svg === s1.legs_print_svg, 'locked torso + legs identical after regeneration');
  ok(regen.headSig(s2) !== regen.headSig(s1), `unlocked head changed (${regen.headSig(s1)} -> ${regen.headSig(s2)})`); ok(s2.hair_style !== s1.hair_style, `unlocked hair changed (${s1.hair_style} -> ${s2.hair_style})`);
  ok(JSON.stringify(g2.result.locks_applied) === JSON.stringify(['Торс', 'Низ / ноги']) && !g2.result.locks_missing, 'server reports which locks were applied');
  // 3. regenerate again, nothing locked, history from both previous figures: everything differs from BOTH
  const g3 = await run('generate', { ...base, prev_id: id2, history: [g1.result.signature, g2.result.signature] }); const s3 = await get(idOf(g3)); const sg = [regen.signature(s1), regen.signature(s2)], n3 = regen.signature(s3);
  ok(sg.every(x => x.head !== n3.head && x.hair !== n3.hair && x.torso !== n3.torso && x.legs !== n3.legs), '3rd figure differs from both earlier ones in head, hair, torso and legs');
  // 4. a vanished lock source is reported instead of silently ignored
  const g4 = await run('generate', { ...base, prev_id: '1-zzzz', lock_from: '1-zzzz', locked_roles: ['Торс'] }); ok(g4.status === 'done' && g4.result.locks_missing === true, 'missing lock source => locks_missing flag for the UI');
  // 5. hostile input
  const g5 = await run('generate', { ...base, prev_id: '../../etc/passwd', locked_roles: ['__proto__', 5, null], history: 'evil' }); ok(g5.status === 'done', 'hostile prev_id / roles / history are ignored safely');
  // 6. Gemini quota exhausted => machine-readable code (UI shows "ліміт ШІ вичерпано")
  st.quota = true; const g6 = await run('generate', base); ok(g6.status === 'error' && g6.code === 'quota', 'quota error carries code=quota: ' + (g6.error || '').slice(0, 60)); st.quota = false;
  console.log(`${pass} passed, ${fail} failed (fake Gemini calls: ${st.calls})`); h.stop(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
