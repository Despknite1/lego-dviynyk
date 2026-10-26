// node tests/ui_regen.test.js — headless browser: real UI + real server + FAKE Gemini. Needs playwright (dev tool, not in package.json).
// Checks: 3D figure assembles, locks survive regeneration, regeneration rebuilds from the NEUTRAL pose (legs/arms/hands in rest positions), quota error is human, mobile layout.
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP ui_regen: playwright not installed'); process.exit(0); }
const sharp = require('sharp'), fs = require('fs'), path = require('path'); const H = require('./helpers/harness'); const OUT = path.join(__dirname, '../test-out');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
// rest positions of the standard parts (world coords after fig.rotation.x = PI): [x,y,z, rx,ry,rz] — identical for EVERY figure
const NEUTRAL = { '973#a': [0, 0, 0], '3815#a': [0, -32, 0], '3816#a': [0, -44, 0], '3817#a': [0, -44, 0], '3818#a': [-15.55, -9, 0], '3819#a': [15.55, -9, 0] };
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.02);
const neutralOK = rep => Object.entries(NEUTRAL).every(([k, v]) => rep[k] && near(rep[k].slice(0, 3), v)) && ['3818#a', '3819#a'].every(k => Math.abs(Math.abs(rep[k][5]) - 10) < 0.2 && Math.abs(rep[k][3]) < 0.2 || Math.abs(Math.abs(rep[k][5]) - 10) < 0.2);
(async () => {
  const h = await H.start({ port: 8822, fakePort: 8823 }); const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const jpg = path.join(OUT, 'ui_in.jpg'); await sharp({ create: { width: 320, height: 400, channels: 3, background: '#7a8' } }).jpeg().toFile(jpg);
  const mocks = { detect: { subjects: [{ label: 'людина', box_2d: [50, 100, 950, 900] }] }, describe: { description: { summary_uk: 'Тестова людина', hair: 'коротке чорне', face: 'нейтральне', attrs: { gender: 'male' } } }, search: { results: [], close_enough: false, candidates_checked: 0, message_uk: '(мок)' } };
  async function page(vp, tag) {
    const p = await b.newPage({ viewport: vp }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**/api/*', r => { const ep = r.request().url().split('/api/')[1]; if (mocks[ep]) r.fulfill({ json: { job: 'mock-' + ep } }); else r.continue(); });
    await p.route('**/job/mock-*', r => { const ep = r.request().url().split('/job/mock-')[1]; r.fulfill({ json: { status: 'done', result: mocks[ep] } }); });
    await p.goto(h.base + '/'); await p.setInputFiles('input[type=file]', jpg); return { p, errs };
  }
  const ready = async (p, n = 1) => { await p.waitForFunction(() => { const f = document.getElementById('v3'); return f && f.contentWindow && f.contentWindow.READY === true; }, null, { timeout: 120000 }); await p.waitForTimeout(800); };
  const fr = p => p.frame({ url: /viewer3d/ });
  // ---------- desktop ----------
  const { p, errs } = await page({ width: 1300, height: 900 });
  await p.waitForSelector('#v3', { timeout: 60000 }); await ready(p);
  const id1 = (await p.getAttribute('#v3', 'src')).match(/id=([^&]+)/)[1];
  let rep1 = await fr(p).evaluate(() => window.poseReport()); ok(neutralOK(rep1), 'first figure: legs/arms/hands/torso in neutral positions');
  ok((await fr(p).evaluate(() => window.PARTS.length)) >= 9, '3D figure assembled (' + (await fr(p).evaluate(() => window.PARTS.length)) + ' parts)');
  await p.screenshot({ path: OUT + '/ui_regen_1_first.png', fullPage: false });
  // lock the legs + head via the 3D panel
  const roles = await fr(p).evaluate(() => [...document.querySelectorAll('#plist .lk')].map(x => x.dataset.r)); ok(roles.includes('Низ / ноги') && roles.includes('Торс') && !roles.includes('Деталь'), 'part roles by id: ' + [...new Set(roles)].join(', '));
  for (const r of ['Низ / ноги', 'Торс']) await fr(p).locator(`#plist .lk[data-r="${r}"]`).first().click();
  await p.waitForTimeout(300); ok(/Ноги/.test(await p.textContent('#lockbar')) && /Торс/.test(await p.textContent('#lockbar')), 'lock bar next to the result lists locked parts');
  const spec1 = await (await fetch(h.base + '/out/' + id1 + '.json')).json();
  // regenerate: button gets disabled + loading while working
  await p.click('.toolbar [data-regen-btn]'); await p.waitForTimeout(150);
  ok(await p.locator('.toolbar [data-regen-btn]').isDisabled(), 'regenerate button disabled while loading'); ok(await p.locator('#genProg .prog').count() === 1, 'progress block shown'); ok(await p.locator('#genBtn').isDisabled(), 'other generate button disabled too');
  await p.waitForFunction(id => { const f = document.getElementById('v3'); return f && !f.src.includes(id); }, id1, { timeout: 60000 }); await ready(p);
  const src2 = await p.getAttribute('#v3', 'src'); const id2 = src2.match(/id=([^&]+)/)[1]; ok(id2 !== id1, 'new figure id'); ok(/locks=/.test(src2) && decodeURIComponent(src2).includes('Низ / ноги'), 'locks carried to the NEW figure (url): ' + decodeURIComponent(src2).split('locks=')[1]);
  const lockedUI = await fr(p).evaluate(() => [...document.querySelectorAll('#plist .lk')].filter(x => x.textContent === '🔒').map(x => x.dataset.r)); ok(lockedUI.includes('Низ / ноги') && lockedUI.includes('Торс') && !lockedUI.includes('Голова'), 'new viewer shows the same 🔒 (no invisible locks): ' + [...new Set(lockedUI)].join(','));
  const spec2 = await (await fetch(h.base + '/out/' + id2 + '.json')).json();
  ok(spec2.legs_print_svg === spec1.legs_print_svg && spec2.leg_color === spec1.leg_color && spec2.torso_print_svg === spec1.torso_print_svg, 'locked legs + torso unchanged after regeneration');
  ok(spec2.head_part && spec2.head_part !== spec1.head_part && spec2.hair_style !== spec1.hair_style, `unlocked head/hair changed (${spec1.head_part || 'composite'} -> ${spec2.head_part}; ${spec1.hair_style} -> ${spec2.hair_style})`);
  ok(await p.locator('.diff li').count() >= 4, 'summary of what changed is shown'); ok(!(await p.locator('.toolbar [data-regen-btn]').isDisabled()), 'button enabled again after loading');
  const rep2 = await fr(p).evaluate(() => window.poseReport()); ok(neutralOK(rep2), 'regenerated figure: legs/arms/hands in neutral positions (not unfolded)');
  await p.screenshot({ path: OUT + '/ui_regen_2_after_regen.png' });
  // in-page rebuild from a skirt figure back to standard legs: the pose must be neutral again (no transform leaks)
  const fx = fr(p); const standard = JSON.parse(JSON.stringify(spec2)); const skirt = { ...spec2, legs_type: 'skirt', skirt_color: '#C91A09' };
  for (const sp of [skirt, standard, skirt, standard]) { sp.textures = sp.textures || undefined; await fx.evaluate(s => window.rebuild(s), sp); }
  const rep3 = await fx.evaluate(() => window.poseReport()); ok(neutralOK(rep3) && JSON.stringify(rep3) === JSON.stringify(rep2), 'rebuild skirt -> standard x2: pose identical to the first neutral build');
  ok(await fx.evaluate(() => window.PARTS.length) === await fx.evaluate(() => window.PARTS.length) && (await fx.evaluate(() => document.querySelectorAll('#plist .row').length)) === (await fx.evaluate(() => window.PARTS.length)), 'no duplicate / stale parts after rebuild');
  await fx.evaluate(() => window.setView('front')); await p.waitForTimeout(500); await p.locator('#v3').screenshot({ path: OUT + '/ui_regen_3_rebuilt_front.png' });
  // PNG saving
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('.toolbar button:has-text("Зберегти PNG")')]); ok(/\.png$/.test(dl.suggestedFilename()), 'PNG download works: ' + dl.suggestedFilename());
  // clear locks button
  await p.click('#clrLocks'); await p.waitForTimeout(200); ok(/Нічого не зафіксовано/.test(await p.textContent('#lockbar')), 'clear-locks button works');
  // ---------- mobile ----------
  const m = await page({ width: 390, height: 844 }); await m.p.waitForSelector('#v3', { timeout: 60000 }); await ready(m.p);
  const overflow = await m.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(overflow <= 1, 'mobile: no horizontal overflow (' + overflow + 'px)');
  const bw = await m.p.locator('.toolbar [data-regen-btn]').boundingBox(); ok(bw && bw.width > 300, 'mobile: regenerate button is full width next to the result (' + Math.round(bw && bw.width) + 'px)');
  await m.p.evaluate(() => document.getElementById('sGen').scrollIntoView()); await m.p.waitForTimeout(500); await m.p.screenshot({ path: OUT + '/ui_regen_5_mobile.png' }); ok(m.errs.length === 0, 'mobile: no page errors');
  // ---------- quota (last: the server stops calling Gemini for a while after a confirmed quota error) ----------
  await p.bringToFront();
  // quota exhausted -> human message
  h.st.quota = true; await p.click('.toolbar [data-regen-btn]'); await p.waitForSelector('#genProg .errbox', { timeout: 60000 }); const et = await p.textContent('#genProg .errbox');
  ok(/Ліміт ШІ вичерпано/.test(et) && !/429|RESOURCE|Gemini:|models\//.test(et.replace('Gemini на сьогодні', '')), 'quota => "Ліміт ШІ вичерпано, спробуй пізніше" (no technical text)'); ok(!(await p.locator('.toolbar [data-regen-btn]').isDisabled()), 'button usable again after error'); ok(await p.locator('#v3').count() === 1, 'previous figure is still shown after an error');
  await p.screenshot({ path: OUT + '/ui_regen_4_quota.png' }); h.st.quota = false;
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.stop(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
