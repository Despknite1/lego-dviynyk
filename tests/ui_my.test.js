// node tests/ui_my.test.js — headless UI for «Мої фігурки» (real server + FAKE Gemini): variant strip, non-destructive switching, per-part regeneration modal, history -> workspace restore (photo + description + variants), explicit delete, temp-storage warning.
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP ui_my: playwright not installed'); process.exit(0); }
const sharp = require('sharp'), path = require('path'); const H = require('./helpers/harness'); const OUT = path.join(__dirname, '../test-out');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
(async () => {
  const h = await H.start({ port: 8842, fakePort: 8843 }); const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const jpg = path.join(OUT, 'ui_my_in.jpg'); await sharp({ create: { width: 320, height: 400, channels: 3, background: '#7a8' } }).jpeg().toFile(jpg);
  const mocks = { detect: { subjects: [{ label: 'людина', box_2d: [50, 100, 950, 900] }] }, describe: { description: { summary_uk: 'Тестова людина', hair: 'коротке', face: 'нейтральне', attrs: { gender: 'male' } } }, search: { results: [], close_enough: false, candidates_checked: 0, message_uk: '(мок)' } };
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/api/*', r => { const ep = r.request().url().split('/api/')[1]; if (mocks[ep]) r.fulfill({ json: { job: 'mock-' + ep } }); else r.continue(); });
  await p.route('**/job/mock-*', r => { const ep = r.request().url().split('/job/mock-')[1]; r.fulfill({ json: { status: 'done', result: mocks[ep] } }); });
  await p.goto(h.base + '/'); await p.waitForSelector('#mfBtn'); ok(true, '«Мої фігурки» button in header');
  await p.setInputFiles('input[type=file]', jpg);
  await p.waitForSelector('#v3', { timeout: 60000 }); await p.waitForSelector('#mfTmp'); ok(/тимчасове/.test(await p.textContent('#mfTmp')), 'temp-storage note after generation (no DATABASE_URL)');
  ok(!(await p.$('#mfUndo')), 'no rollback/revert button concept anymore');
  const gens = []; p.on('request', q => { if (/\/api\/generate$/.test(q.url())) try { gens.push(q.postDataJSON()); } catch {} });
  const nv = n => p.waitForFunction(k => document.querySelectorAll('#variants .vCard').length === k, n, { timeout: 90000 });
  const idle = () => p.waitForFunction(() => !document.querySelector('[data-regen-btn]').disabled, null, { timeout: 90000 });
  const ready = () => p.waitForFunction(() => { const f = document.getElementById('v3'); return f && f.contentWindow && f.contentWindow.READY === true; }, null, { timeout: 120000 });
  await nv(1); ok(true, 'variant strip shows the first variant'); await ready(); await p.waitForTimeout(500);
  { const a = await p.locator('#sPrev').boundingBox(), v = await p.locator('#v3').boundingBox(); ok(a.x + a.width <= v.x && v.y < 900 && Math.abs(a.y - v.y) < 400, 'desktop: photo column | 3D viewer side by side (horizontal workspace)'); }
  await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: OUT + '/ui3_main.png' });
  const id1 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1];
  await idle(); await p.click('[data-regen-btn]'); await nv(2); const id2 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1]; ok(id2 !== id1, 'regeneration appends variant #2');
  ok((await p.getAttribute('#variants .vCard.sel', 'data-vn')) === '2', 'new variant is selected');
  await idle(); await ready(); await p.click('text=🎯 Перегенерувати деталі…'); await p.waitForSelector('#partsModal'); ok(await p.$eval('#pmGo', x => x.disabled), 'parts modal: «regenerate» disabled until a part is ticked');
  await p.check('#partsModal input[value="Торс"]'); await p.screenshot({ path: OUT + '/ui3_regen_modal.png' }); await p.click('#pmGo');
  ok(!(await p.$('#partsModal')), 'parts modal closes on start'); await nv(3); const last = gens[gens.length - 1] || {};
  ok(Array.isArray(last.locked_roles) && !last.locked_roles.includes('Торс') && last.locked_roles.includes('Голова'), 'only the ticked part is regenerated (others locked): ' + (last.locked_roles || []).join(','));
  await idle(); await p.click('#variants .vCard[data-vn="1"]'); await p.waitForFunction(i => !document.getElementById('v3').src.includes(i), id2 + '&'); await ready(); ok((await p.$$('#variants .vCard')).length === 3, 'switching to variant #1 is non-destructive (still 3 variants)');
  await p.goto(h.base + '/'); await p.waitForSelector('#mfBtn'); await p.click('#mfBtn'); await p.waitForSelector('.mfCard'); ok((await p.$$('.mfCard')).length === 1 && (await p.$$('.mfCard .mfPair img')).length === 2, 'grid: one figure with photo + figure thumbnails');
  ok(/тимчасове/.test(await p.textContent('#mfM')), 'temp-storage warning in the dialog'); ok(!(await p.$('[data-a=revert]')), 'no «Повернути цю версію» button'); await p.screenshot({ path: OUT + '/ui3_history.png' });
  await p.click('.mfCard .mfT'); await nv(3); ok(await p.$eval('#mfM', x => x.style.display === 'none'), 'history click closes the dialog and goes to the workspace');
  ok(/^data:image\/webp;base64,/.test(await p.getAttribute('#prev', 'src')) && await p.isVisible('#sPrev'), 'cached photo restored in the workspace'); ok(await p.isVisible('#sDesc'), 'description restored'); await ready(); ok(true, 'stored variant opens in 3D');
  await p.screenshot({ path: OUT + '/ui3_restored.png' });
  await idle(); await p.click('[data-regen-btn]'); await nv(4); ok(true, 'regenerate from history appends variant #4 to the SAME figure');
  await p.click('#mfBtn'); await p.waitForSelector('.mfCard'); ok((await p.$$('.mfCard')).length === 1, 'still one figure in history');
  p.once('dialog', d => d.accept()); await p.click('.mfDel'); await p.waitForFunction(() => /порожньо/.test(document.getElementById('mfM').textContent)); ok(true, 'explicit delete (with confirm) -> empty grid');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(`${pass} passed, ${fail} failed (fake Gemini calls: ${h.st.calls})`); await b.close(); h.stop(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
