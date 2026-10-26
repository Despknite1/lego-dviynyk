// node tests/regen.e2e.test.js — END-TO-END regeneration test with a FAKE Gemini (no quota, no network):
// real server.js + real /api/generate pipeline; the fake model returns the SAME design every time (worst case = old behaviour).
// Checks: unlocked parts always change, locked parts stay byte-identical, face sanity, final render, 6 chained regenerations.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process'); const sharp = require('sharp');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const SPEC = { skin_color: '#F2CD37', hair_style: 'short', hair_color: '#582A12', headgear: 'none', torso_color: '#0055BF', arm_color: '#0055BF', hand_color: '#F2CD37', leg_color: '#1b1b1b', hip_color: '#1b1b1b', legs_type: 'standard', sleeves: 'long',
  torso_print_svg: "<rect x='45' y='0' width='10' height='100' fill='#F4F4F4'/><rect x='20' y='70' width='60' height='6' fill='#582A12'/>", torso_back_print_svg: "<rect x='20' y='70' width='60' height='6' fill='#582A12'/>", arm_print_svg: "<rect x='0' y='90' width='100' height='10' fill='#F4F4F4'/>",
  legs_print_svg: "<rect x='0' y='29' width='100' height='6' fill='#582A12'/>", footwear: { type: 'shoes', color: '#1b1b1b', sole_color: '#A0A5A9' }, face: { gender: 'male', expression: 'smile', glasses: 'round', brows_thick: true, eye_size: 'large' },
  design: { concept: 'blue casual shirt', motifs: ['white placket', 'brown belt'], palette: ['#0055BF', '#F4F4F4', '#582A12'] }, author_touch_uk: 'Маленький логотип на спині.', accessories_3d: [], refs_matching: [], checklist: ['blue shirt'] };
const reply = o => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] });
let calls = 0;
const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { calls++; res.setHeader('Content-Type', 'application/json');
  if (/IMAGE B = rendered/.test(b)) return res.end(reply({ score: 9, problems_uk: '', corrected_spec: null }));
  if (/official-style LEGO minifigure of the subject/.test(b)) return res.end(reply(JSON.parse(JSON.stringify(SPEC))));
  if (/Identify this subject/.test(b)) return res.end(reply({ is_known_character: false, character_name: '', identity: 'Людина' }));
  res.end(reply({})); }); });
const same = (a, b, keys) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
(async () => {
  await new Promise(r => fake.listen(0, r)); const fport = fake.address().port; const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'lego-out-')); const PORT = 8800 + Math.floor(Math.random() * 150);
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, OUT_DIR: OUT, GEMINI_API_BASE: `http://127.0.0.1:${fport}/v1beta`, GEMINI_API_KEY: 'test-key', ACCOUNTS_ENABLED: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}`; for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  const crop = (await sharp({ create: { width: 96, height: 128, channels: 3, background: '#c08060' } }).jpeg().toBuffer()).toString('base64');
  const gen = async (extra = {}) => { const j = await (await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crop, subject: { label: 'test', box_2d: [0, 0, 1000, 1000] }, description: {}, ...extra }) })).json();
    for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 500)); const s = await (await fetch(base + '/job/' + j.job)).json(); if (s.status === 'error') throw new Error(s.error); if (s.status === 'done') { const id = s.result.file.replace(/^out\/|\.png$/g, ''); return { r: s.result, id, spec: JSON.parse(fs.readFileSync(path.join(OUT, id + '.json'), 'utf8')) }; } } throw new Error('timeout'); };
  try {
    const g1 = await gen(); ok(!g1.r.regenerated, 'first generation is not a regeneration');
    ok(g1.spec.face.glasses === 'round' && !g1.spec.face.brows_thick && g1.spec.face.eye_size !== 'large', 'face sanity: thick brows / large eyes removed behind glasses');
    ok(typeof g1.r.face_score === 'number' && g1.r.face_score >= 70, 'face sanity score reported (' + g1.r.face_score + ')');
    // 1) plain "try again" (no locks, the UI sends nothing): same crop => previous figure remembered => every part differs
    const g2 = await gen(); ok(g2.r.regenerated && g2.spec._regen_of === g1.id, 'second generation of the same crop is a regeneration of the previous figure');
    const roles = ['face', 'hair_style', 'torso_print_svg', 'arm_print_svg', 'legs_print_svg']; const diff = k => JSON.stringify(g2.spec[k]) !== JSON.stringify(g1.spec[k]);
    ok(diff('hair_style'), 'unlocked HAIR changed: ' + g1.spec.hair_style + ' -> ' + g2.spec.hair_style);
    ok(diff('face'), 'unlocked FACE changed (variant ' + (g1.spec.face.variant || 0) + ' -> ' + g2.spec.face.variant + ')');
    ok(diff('torso_print_svg') && diff('legs_print_svg') && diff('arm_print_svg'), 'unlocked TORSO / LEGS / ARM prints changed');
    ok(g2.r.regen_changed.length >= 5, 'server reports changed roles: ' + g2.r.regen_changed.join(', '));
    ok(g2.spec.torso_color === g1.spec.torso_color && g2.spec.skin_color === g1.spec.skin_color, 'photo-dictated colours stay (torso colour, skin)');
    // 2) locks: head + torso locked, taken from the figure the user is looking at
    const g3 = await gen({ lock_from: g2.id, locked_roles: ['Голова', 'Торс'] });
    ok(same(g3.spec, g2.spec, ['face', 'torso_color', 'torso_print_svg', 'torso_back_print_svg', 'skin_color', 'collar']), 'locked head + torso identical to the shown figure');
    ok(g3.spec.hair_style !== g2.spec.hair_style && g3.spec.legs_print_svg !== g2.spec.legs_print_svg && g3.spec.arm_print_svg !== g2.spec.arm_print_svg, 'unlocked hair / legs / arms changed while head+torso locked');
    ok(g3.spec._locked_roles && g3.spec._locked_roles.length === 2, 'locked roles stored in the new figure (UI keeps the 🔒 after regeneration)');
    // 3) everything locked => identical parts, nothing diversified
    const g4 = await gen({ lock_from: g3.id, locked_roles: ['Голова', 'Волосся', 'Торс', 'Рука', 'Кисть', 'Низ / ноги', 'Головний убір', 'Аксесуар', 'Плащ / броня'] });
    ok(same(g4.spec, g3.spec, ['face', 'hair_style', 'hair_color', 'torso_print_svg', 'arm_print_svg', 'legs_print_svg', 'footwear', 'leg_color']), 'all locked => every part identical');
    // 4) chain of 6 regenerations, only hair unlocked: hair never repeats the previous one, locked leg print never accumulates
    let prev = g4, hairs = [g4.spec.hair_style], legsOk = true, lockedSame = true;
    for (let i = 0; i < 6; i++) { const g = await gen({ lock_from: prev.id, locked_roles: ['Голова', 'Торс', 'Рука', 'Кисть', 'Низ / ноги'] }); hairs.push(g.spec.hair_style); legsOk = legsOk && g.spec.legs_print_svg === prev.spec.legs_print_svg; lockedSame = lockedSame && same(g.spec, prev.spec, ['face', 'torso_print_svg', 'arm_print_svg', 'leg_color', 'footwear']); prev = g; }
    ok(hairs.every((h, i) => i === 0 || h !== hairs[i - 1]), '6 chained regenerations: hair differs from the previous one every time (' + hairs.join(' > ') + ')');
    ok(legsOk && lockedSame, '6 chained regenerations: locked legs/torso/arms/head never drift or accumulate');
    ok(fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length >= 10 && fs.statSync(path.join(OUT, prev.id + '.png')).size > 5000, '2D PNG is rendered from the FINAL spec');
    ok(calls < 200, 'fake Gemini calls used: ' + calls + ' (real quota untouched)');
  } catch (e) { ok(false, 'e2e crashed: ' + e.message); }
  srv.kill(); fake.close(); fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
