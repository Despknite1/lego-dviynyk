// node tests/ui_my.test.js — headless UI for «Мої фігурки» (real server + FAKE Gemini): button, grid, 3D per version, timeline, revert, delete, rollback after regeneration, temp-storage warning.
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
  ok(!(await p.$('#mfUndo')), 'no rollback button after the first generation');
  const id1 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1];
  await p.waitForFunction(() => !document.querySelector('[data-regen-btn]').disabled, null, { timeout: 60000 }); await p.click('[data-regen-btn]');
  await p.waitForSelector('#mfUndo', { timeout: 60000 }); const id2 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1]; ok(id2 !== id1, 'regeneration -> «Відкат до попередньої» shown');
  await p.click('#mfUndo'); await p.waitForFunction(() => /Повернуто/.test(document.getElementById('mfUndo').textContent)); ok(!(await p.getAttribute('#v3', 'src')).includes(id2), 'rollback loads the previous version into 3D');
  await p.click('#mfBtn'); await p.waitForSelector('.mfCard'); ok((await p.$$('.mfCard')).length === 1 && (await p.$$('.mfCard img')).length === 2, 'grid: one figure with photo + figure thumbnails');
  ok(/тимчасове/.test(await p.textContent('#mfM')), 'temp-storage warning in the dialog'); await p.screenshot({ path: OUT + '/ui_my_grid.png' });
  await p.click('.mfCard'); await p.waitForSelector('.mfV'); ok((await p.$$('.mfV')).length === 2, 'timeline shows 2 versions');
  await p.waitForFunction(() => { const f = document.getElementById('mfV3'); return f && f.contentWindow && f.contentWindow.READY === true; }, null, { timeout: 120000 }); ok(true, 'version opens in 3D');
  ok(await p.$eval('[data-a=revert]', x => x.disabled), 'revert disabled for the current version');
  await p.click('.mfV[data-v="2"]'); await p.waitForSelector('[data-a=revert]:not([disabled])'); await p.click('[data-a=revert]'); await p.waitForFunction(() => /поточною/.test((document.getElementById('mfMsg') || {}).textContent || '')); ok(true, '«Повернути цю версію» works');
  await p.screenshot({ path: OUT + '/ui_my_fig.png' });
  p.once('dialog', d => d.accept()); await p.click('[data-a=del]'); await p.waitForFunction(() => /порожньо/.test(document.getElementById('mfM').textContent)); ok(true, 'delete -> empty grid');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(`${pass} passed, ${fail} failed (fake Gemini calls: ${h.st.calls})`); await b.close(); h.stop(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
