// node tests/ui_faces.test.js — headless browser + real server + FAKE Gemini (zero live calls).
// Covers: trench => black bottom in 3D, "Найпохожіші обличчя" panel (≥4 safe faces), choosing a face applies it + locks the head + rebuilds the 3D figure,
// the choice survives a regeneration; screenshots before/after the fixes into test-out/.
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP ui_faces: playwright not installed'); process.exit(0); }
const sharp = require('sharp'), fs = require('fs'), path = require('path'); const H = require('./helpers/harness'); const rules = require('../lib/rules'), minifig = require('../lib/minifig');
const OUT = path.join(__dirname, '../test-out'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/trench_spec.json'), 'utf8'));
const desc = { hair: 'dirty blonde hair in a low bun, loose strands', face: 'young woman, glasses', legs: 'long black trench', torso: 'black leather trench, white top', summary_uk: 'Молода дівчина в окулярах, русяве волосся в пучку, довгий чорний тренч', attrs: { gender: 'female', age: 'young', hair_color: 'dark tan' } };
(async () => {
  const h = await H.start({ port: 8832, fakePort: 8833, spec: JSON.parse(JSON.stringify(RAW)) }); const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const jpg = path.join(OUT, 'ui_faces_in.jpg'); await sharp({ create: { width: 320, height: 400, channels: 3, background: '#222' } }).jpeg().toFile(jpg); // a DARK photo
  const mocks = { detect: { subjects: [{ label: 'дівчина', box_2d: [50, 100, 950, 900] }] }, describe: { description: desc }, search: { results: [], close_enough: false, candidates_checked: 0, message_uk: '(мок)' } };
  const p = await b.newPage({ viewport: { width: 1300, height: 1500 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/api/*', r => { const ep = r.request().url().split('/api/')[1]; if (mocks[ep]) r.fulfill({ json: { job: 'mock-' + ep } }); else r.continue(); });
  await p.route('**/job/mock-*', r => { const ep = r.request().url().split('/job/mock-')[1]; r.fulfill({ json: { status: 'done', result: mocks[ep] } }); });
  await p.goto(h.base + '/'); await p.setInputFiles('input[type=file]', jpg);
  const ready = async () => { await p.waitForFunction(() => { const f = document.getElementById('v3'); return f && f.contentWindow && f.contentWindow.READY === true; }, null, { timeout: 120000 }); await p.waitForTimeout(800); };
  const fr = () => p.frame({ url: /viewer3d/ });
  await p.waitForSelector('#v3', { timeout: 90000 }); await ready();
  const id1 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1];
  const spec1 = await (await fetch(h.base + '/out/' + id1 + '.json')).json();
  // ---- end-to-end through the server rules (fake Gemini returned the BAD trench spec) ----
  ok(spec1.legs_type === 'long_robe' && /^#1b2a34$/i.test(spec1.leg_color) && /^#1b2a34$/i.test(spec1.skirt_color), 'server: trench bottom is black (' + spec1.legs_type + ' ' + spec1.leg_color + '/' + spec1.skirt_color + ')');
  ok(spec1.face.age === 'young' && !spec1.face.wrinkles, 'server: age young, no wrinkles'); ok(!/^#(6c6e68|a0a5a9)$/i.test(spec1.hair_color) && /bun/.test(spec1.hair_style), `server: blonde bun, not grey (${spec1.hair_style} ${spec1.hair_color})`);
  const calls0 = h.st.calls;
  // ---- 3D: bottom part really is black ----
  const parts = await fr().evaluate(() => window.PARTS.map(x => ({ id: x.id, color: x.color }))); const robe = parts.find(x => x.id === '36036'); ok(!!robe, 'long skirt part 36036 present'); if (robe) ok(!/f2cd37|fe8a18/i.test(String(robe.color)), 'long skirt part colour is not yellow/orange (' + robe.color + ')');
  await fr().evaluate(() => window.setView('front')); await p.waitForTimeout(500);
  // ---- face panel ----
  // ---- the picker is a FLYOUT to the right of the 3D, next to the parts list; it opens only when the head is hovered / clicked ----
  ok(await p.locator('#facePanel.open').count() === 0, 'face picker is closed until the head is hovered / clicked');
  ok(await p.locator('#facePanel .fp-card').count() === 0, 'nothing is fetched before the first hover (lazy)');
  await fr().locator('#plist .row', { hasText: 'Голова' }).first().hover();
  await p.waitForSelector('#facePanel.open .fp-card', { timeout: 20000 });
  { const pb = await p.locator('#facePanel').boundingBox(), fb = await p.locator('#v3').boundingBox(), vb = await p.locator('#v3box').boundingBox();
    ok(pb.x >= fb.x && pb.x + pb.width <= fb.x + fb.width + 1 && pb.y >= fb.y - 1 && pb.y + pb.height <= fb.y + fb.height + 1, 'flyout sits inside the 3D screen area');
    ok(Math.abs((pb.x + pb.width) - (fb.x + fb.width - 340)) < 24, 'flyout is directly beside the parts / locks list (right side), gap ' + Math.round((fb.x + fb.width - 340) - (pb.x + pb.width)) + 'px');
    ok(pb.x + pb.width / 2 > fb.x + fb.width / 2, 'flyout is on the right half of the 3D screen'); void vb; }
  await p.locator('#facePanel [data-fp-close]').click(); ok(await p.locator('#facePanel.open').count() === 0, '× closes the flyout');
  { await p.locator('#v3box').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollTo(0, document.getElementById('v3box').getBoundingClientRect().top + scrollY - 20)); await p.waitForTimeout(400); const hp = await fr().evaluate(() => window.headPoint()); ok(!!hp, 'head screen position known'); await p.mouse.move(5, 5);
    const fb = await p.locator('#v3').boundingBox(); await p.mouse.move(fb.x + hp.x, fb.y + hp.y, { steps: 4 }); await p.mouse.down(); await p.mouse.up();
    await p.waitForSelector('#facePanel.open .fp-card', { timeout: 20000 }); ok(true, 'clicking the head ON THE 3D figure opens the flyout'); }
  await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok(await p.locator('#facePanel.open').count() === 0, 'Esc closes the flyout');
  await fr().locator('#plist .row', { hasText: 'Голова' }).first().click(); await p.waitForSelector('#facePanel.open .fp-card', { timeout: 20000 });
  const n = await p.locator('#facePanel .fp-card').count(); ok(n >= 4 && n <= 6, 'face panel shows 4–6 faces (' + n + ')');
  const labels = await p.locator('#facePanel .fp-label').allTextContents(); ok(new Set(labels).size >= 4, 'distinct labels: ' + labels.slice(0, 3).join(' | ') + ' …');
  const imgsOk = await p.evaluate(() => [...document.querySelectorAll('#facePanel img')].every(i => i.complete && i.naturalWidth > 20)); ok(imgsOk, 'all face thumbnails loaded');
  ok(await p.locator('#facePanel [data-pick]').count() === n && /Обрати/.test(await p.locator('#facePanel [data-pick]').first().textContent()), '«Обрати» button on every card');
  ok(h.st.calls === calls0, 'face panel needs NO Gemini call'); await p.locator('#v3box').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + '/faces_panel_page.png', fullPage: false });
  await p.locator('#facePanel').screenshot({ path: OUT + '/faces_panel.png' });
  // ---- pick the 2nd face ----
  const part = await p.locator('#facePanel [data-pick]').nth(1).getAttribute('data-pick'); await p.locator('#facePanel [data-pick]').nth(1).click();
  await p.waitForSelector(`#facePanel .fp-card.sel[data-face="${part}"]`, { timeout: 90000 }); await ready();
  const pids = await fr().evaluate(() => window.PARTS.map(x => x.id)); ok(pids.includes(part), '3D rebuilt with the chosen head ' + part);
  ok(/Голова/.test(await p.textContent('#lockbar')), 'head is locked (lock bar: Голова)');
  const lockedUI = await fr().evaluate(() => [...document.querySelectorAll('#plist .lk')].filter(x => x.textContent === '🔒').map(x => x.dataset.r)); ok(lockedUI.includes('Голова'), 'viewer shows 🔒 on the head');
  const spec2 = await (await fetch(h.base + '/out/' + id1 + '.json', { cache: 'no-store' })).json(); ok(spec2.head_part === part && spec2.head_user_picked === true, 'server file stores the chosen head');
  ok(h.st.calls === calls0, 'applying a face needs NO Gemini call');
  ok(await p.locator('.fp-card.sel').count() === 1 && /Обрано/.test(await p.locator('.fp-card.sel [data-pick]').textContent()), 'selected card is marked');
  await p.screenshot({ path: OUT + '/faces_after_pick.png' });
  // ---- API: ≥4 distinct safe faces, no Gemini, rejects bad ids ----
  const J = (u, body) => fetch(h.base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ s: r.status, j: await r.json() }));
  const a = await J('/api/face-options', { spec: { face: { gender: 'female', expression: 'smile', glasses: 'none' } } }); ok(a.s === 200 && a.j.options.length >= 4 && new Set(a.j.options.map(o => o.id)).size === a.j.options.length, 'POST /api/face-options {spec} => ≥4 distinct options');
  ok(a.j.options.every(o => o.id && o.label && o.score > 0 && o.thumb), 'option shape {id,label,score,thumb}');
  ok((await J('/api/face-options', {})).s === 400, 'face-options without id/spec => 400'); ok((await J('/api/face-apply', { id: id1, part: '3626bp0d' })).s === 400, 'banned head refused'); ok((await J('/api/face-apply', { id: '../x', part: part })).s === 400, 'bad id refused'); ok((await J('/api/face-apply', { id: '999-abcd', part })).s === 404, 'unknown figure => 404');
  ok(h.st.calls === calls0, 'still zero Gemini calls for the whole face feature');
  // ---- regeneration keeps the chosen head (locked) ----
  await p.click('.toolbar [data-regen-btn]'); await p.waitForFunction(id => { const f = document.getElementById('v3'); return f && !f.src.includes(id); }, id1, { timeout: 90000 }); await ready();
  const id2 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1]; const spec3 = await (await fetch(h.base + '/out/' + id2 + '.json')).json(); ok(spec3.head_part === part, 'regeneration keeps the chosen (locked) head');
  ok(await p.locator('#facePanel.open').count() === 0, 'new figure: flyout closed again'); await fr().locator('#plist .row', { hasText: 'Голова' }).first().hover(); await p.waitForSelector('#facePanel.open .fp-card', { timeout: 20000 }); ok(await p.locator('#facePanel .fp-card').count() >= 4, 'face panel re-appears for the new figure on head hover');
  // ---- screenshots before / after of the fixes (3D viewer, front) ----
  const v = await b.newPage({ viewport: { width: 700, height: 820 } }); await v.goto(h.base + '/viewer3d.html');
  const shot = async (spec, file) => { spec.textures = minifig.textures(spec); await v.evaluate(s => window.rebuild(s), spec); await v.waitForFunction(() => window.READY === true, null, { timeout: 120000 }); await v.evaluate(() => window.setView && window.setView('front')); await v.waitForTimeout(900); await v.screenshot({ path: file }); };
  // BEFORE = what the old pipeline produced from this spec (bad: skin-coloured long skirt, grey hair, old face) ; AFTER = same spec through the new rules
  const before = JSON.parse(JSON.stringify(RAW)); before.hair_style = 'bun'; before.skirt_color = null; before.legs_print_svg = null; await shot(before, OUT + '/trench_before.png');
  const after = rules.sanitizeSpec(JSON.parse(JSON.stringify(RAW)), desc, { id: {}, lowLight: true }); await shot(after, OUT + '/trench_after.png');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.stop();
  // combined image: before | after | face panel
  try { const W = 700, A = await sharp(OUT + '/trench_before.png').resize({ width: W }).toBuffer(), B = await sharp(OUT + '/trench_after.png').resize({ width: W }).toBuffer(), Cp = await sharp(OUT + '/faces_panel.png').resize({ width: 2 * W }).toBuffer();
    const ah = (await sharp(A).metadata()).height, ch = (await sharp(Cp).metadata()).height;
    await sharp({ create: { width: 2 * W, height: ah + ch, channels: 3, background: '#0e1015' } }).composite([{ input: A, left: 0, top: 0 }, { input: B, left: W, top: 0 }, { input: Cp, left: 0, top: ah }]).png().toFile(OUT + '/trench_before_after_faces.png'); } catch (e) { console.log('combine fail', e.message); }
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
