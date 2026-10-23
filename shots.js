// node shots.js <spec.json|-> <outprefix> [views]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [specFile, prefix, views = 'front,three,side,back'] = process.argv.slice(2);
  const spec = specFile && specFile !== '-' ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : {};
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 900 } });
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.addInitScript(s => { window.MINIFIG_SPEC = s; }, spec);
  const t = Date.now(); await p.goto('http://localhost:8787/viewer3d.html');
  await p.waitForFunction(() => window.READY, null, { timeout: 60000 });
  console.log('ready', Date.now() - t, 'ms build', await p.evaluate(() => window.BUILD_MS), await p.evaluate(() => JSON.stringify(window.DEBUG || null)));
  for (const v of views.split(',')) { await p.evaluate(v => window.setView(v), v); await p.waitForTimeout(600);
    await p.locator('.bar').evaluate(e => e.style.display = 'none'); await p.screenshot({ path: `test-out/3d_${prefix}_${v}.png` }); await p.locator('.bar').evaluate(e => e.style.display = ''); }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
