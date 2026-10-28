// node tests/ui_photo.test.js — headless browser, mocked API (zero Gemini calls).
// A click on the uploaded photo while the process is running must NOT restart it: it only selects the photo (frame + × top-right);
// a click elsewhere clears the selection; × removes the photo.
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP ui_photo: playwright not installed'); process.exit(0); }
const sharp = require('sharp'), fs = require('fs'), path = require('path'); const H = require('./helpers/harness');
const OUT = path.join(__dirname, '../test-out'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
(async () => {
  const h = await H.start({ port: 8852, fakePort: 8853 }); const b = await chromium.launch();
  const jpg = path.join(OUT, 'ui_photo_in.jpg'); await sharp({ create: { width: 320, height: 400, channels: 3, background: '#556' } }).jpeg().toFile(jpg);
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const calls = { detect: 0, describe: 0, search: 0 }; let release = false;
  await p.route('**/api/*', r => { const ep = r.request().url().split('/api/')[1]; if (ep in calls) { calls[ep]++; r.fulfill({ json: { job: 'mock-' + ep } }); } else r.continue(); });
  await p.route('**/job/mock-*', r => { const ep = r.request().url().split('/job/mock-')[1];
    if (ep === 'detect') return r.fulfill({ json: { status: 'done', result: { subjects: [{ label: 'людина', box_2d: [50, 100, 950, 900] }] } } });
    if (ep === 'describe') return r.fulfill({ json: release ? { status: 'done', result: { description: { summary_uk: 'Тест', hair: 'short' } } } : { status: 'pending', stage: 'Аналізую…' } });
    return r.fulfill({ json: { status: 'pending' } }); });
  await p.goto(h.base + '/'); await p.setInputFiles('input[type=file]', jpg);
  await p.waitForFunction(() => document.getElementById('st1').textContent.includes('Знайдено'), null, { timeout: 15000 });
  await p.waitForFunction(() => /Аналізую/.test(document.getElementById('desc').textContent), null, { timeout: 15000 });
  const d0 = calls.describe; ok(d0 === 1, 'describe started once (' + d0 + ')');
  ok(await p.locator('#xbtn').isVisible() === false, '× hidden while the photo is not selected');
  // click right in the middle of the photo (that is where the object box overlay is)
  const bb = await p.locator('#stage').boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1500);
  ok(calls.describe === d0 && calls.detect === 1, 'clicking the photo during processing does NOT restart anything (detect ' + calls.detect + ', describe ' + calls.describe + ')');
  ok(await p.locator('#stage.selected').count() === 1, 'photo is selected after the click'); ok(await p.locator('#xbtn').isVisible(), '× is visible on the selected photo');
  const xb = await p.locator('#xbtn').boundingBox(); ok(xb.x + xb.width / 2 > bb.x + bb.width * 0.8 && xb.y + xb.height / 2 < bb.y + bb.height * 0.2, '× is in the top-right corner of the photo');
  await p.screenshot({ path: OUT + '/photo_selected.png', clip: { x: 0, y: Math.max(0, bb.y - 40), width: 1200, height: Math.min(500, bb.height + 80) } });
  // the subject box itself (the same object) is also not a restart
  const bx = await p.locator('.box').first().boundingBox(); await p.mouse.click(bx.x + 20, bx.y + 20); await p.waitForTimeout(800);
  ok(calls.describe === d0, 'clicking the already chosen object box does not restart the process');
  await p.click('h1'); ok(await p.locator('#stage.selected').count() === 0, 'click elsewhere clears the selection');
  await p.mouse.click(bb.x + 30, bb.y + bb.height - 30); ok(await p.locator('#stage.selected').count() === 1, 'select again'); await p.keyboard.press('Escape'); ok(await p.locator('#stage.selected').count() === 0, 'Esc clears the selection');
  ok(calls.describe === d0, 'process untouched by selecting / deselecting');
  release = true; await p.waitForFunction(() => document.querySelector('#desc dl'), null, { timeout: 15000 }); ok(true, 'the ORIGINAL process finished normally after all the clicks');
  // × removes the photo (and drops late answers)
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); p.once('dialog', d => d.accept()); await p.click('#xbtn'); await p.waitForTimeout(300);
  ok(await p.locator('#sPrev.hide').count() === 1 && await p.locator('#sDesc.hide').count() === 1, '× removes the photo and hides the steps');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.stop(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
