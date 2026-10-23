// node e2e.js URL image prefix [mobile]  -> full main-page flow, checks 3D iframe appears and renders
const { chromium, devices } = require('playwright');
(async () => {
  const [U, IMG, PFX, MOB] = process.argv.slice(2); const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext(MOB ? { ...devices['Pixel 7'] } : { viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage(); const errs = []; globalThis.P = p; globalThis.E = errs;
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('response', r => { if (r.status() >= 400 && !/\/ldraw\/lib\//.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('console ' + m.text()); });
  await p.goto(U, { waitUntil: 'networkidle' });
  await p.setInputFiles('#file', IMG);
  await p.waitForSelector('#genBtn', { state: 'visible', timeout: 60000 }); await p.waitForFunction(() => { try { return !!DESC; } catch { return false; } }, null, { timeout: 60000 });
  console.log('described', t()); await p.click('#genBtn');
  await p.waitForSelector('#v3', { timeout: 60000 }); console.log('iframe in page', t());
  const fr = p.frameLocator('#v3'); let f; for (let i = 0; i < 100 && !f; i++) { f = p.frames().find(x => /viewer3d/.test(x.url())); if (!f) await p.waitForTimeout(200); }
  await f.waitForFunction(() => window.READY === true || window.READY === 'error', null, { timeout: 60000 });
  console.log('3D ready', t(), await f.evaluate(() => [window.READY, window.BUILD_MS]));
  await f.evaluate(() => { document.getElementById('rot').click(); setView('three'); }); await p.waitForTimeout(800);
  await p.locator('#v3wrap').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await p.locator('#v3wrap').screenshot({ path: `test-out/${PFX}.png` });
  await p.screenshot({ path: `test-out/${PFX}_page.png` });
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})().catch(async e => { console.error('FAIL', e.message.split('\n')[0]); try { console.error('GEN:', await globalThis.P.evaluate(() => document.getElementById('gen').innerText.slice(0, 400)), globalThis.E); } catch {} process.exit(1); });
