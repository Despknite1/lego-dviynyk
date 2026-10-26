// node tests/viewer.pose.test.js — headless (playwright+chromium) test of the 3D viewer: after ANY number of rebuilds (= regenerations) the pose is neutral,
// nothing stacks up (groups / decals / meshes), lock state follows the figure. Needs a running server: BASE=http://localhost:8787 (default: starts its own on a random port)
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const base = { skin_color: '#F2CD37', torso_color: '#C91A09', arm_color: '#C91A09', hand_color: '#F2CD37', leg_color: '#0055BF', hair_style: 'short', hair_color: '#583927', face: { gender: 'male', expression: 'smile' } };
const SPECS = [base, { ...base, legs_type: 'skirt', skirt_color: '#C91A09', hair_style: 'long_wavy' }, { ...base, legs_type: 'dress_slope', hair_style: 'sculpt', hair_sculpt: { kind: 'curls', length: 'mid', fringe: 'side', volume: 0.6, seed: 77 } },
  { ...base, legs_type: 'long_robe', headgear: 'hood', accessories_3d: [{ type: 'sword', kind: 'long' }, { type: 'shield', shape: 'round', color: '#A0A5A9' }] }, { ...base, double_torso: true, accessories_3d: [{ type: 'bag', style: 'held', color: '#582A12' }], hair_style: 'bun_low_fringe' }, { ...base, legs_type: 'standard', neck_accessory: 'cape', _locked_roles: ['Торс', 'Низ / ноги'] }];
(async () => {
  let srv = null, url = process.env.BASE; if (!url) { const port = 8950 + Math.floor(Math.random() * 40); srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: port }, stdio: 'ignore' }); url = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(url + '/healthz')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); } }
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 700, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(s => { window.MINIFIG_SPEC = s; window.__msgs = []; addEventListener('message', e => { if (e.data && e.data.lego_locks) window.__msgs.push(e.data.lego_locks); }); }, SPECS[0]);
  await p.goto(url + '/viewer3d.html?id=1-abcd'); await p.waitForFunction(() => window.READY === true, null, { timeout: 90000 });
  const rebuild = async sp => { await p.evaluate(s => window.rebuildFigure(s), sp); await p.waitForFunction(() => window.READY === true, null, { timeout: 90000 }); return p.evaluate(() => ({ pose: window.poseReport(), parts: window.PARTS.length, lock: [...document.querySelectorAll('.lk')].map(x => x.dataset.r + ':' + x.textContent) })); };
  const R0 = await p.evaluate(() => ({ pose: window.poseReport(), parts: window.PARTS.length })); const canon = k => R0.pose[k];
  const poseSame = (a, keys) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(R0.pose[k]));
  ok(['973#a', '3815#a', '3816#a', '3817#a', '3818#a', '3819#a'].every(k => R0.pose[k]) , 'first build: body parts present (' + Object.keys(R0.pose).join(',') + ')');
  const lg = canon('3816#a'); ok(Math.abs(lg[4]) < 0.01 && Math.abs(lg[5]) < 0.01 && Math.abs(Math.abs(lg[3]) - 180) < 0.01, 'neutral legs: no yaw / roll, only the LDraw->three flip (rot ' + lg.slice(3) + ')');
  // 12 rebuilds cycling through different figures, then back to the first: neutral parts must be bit-identical every time
  let drift = [], stack = [];
  for (let i = 0; i < 12; i++) { const sp = SPECS[(i + 1) % SPECS.length]; const r = await rebuild(sp); const std = ['973#a', '3818#a', '3819#a', '3820#a', '3815#a', '3816#a', '3817#a'].filter(k => r.pose[k] && R0.pose[k] && !(sp.double_torso && /3815#a|3816#a|3817#a/.test(k)) && !(sp.legs_type && sp.legs_type !== 'standard' && /381[567]#a/.test(k)));
    if (!poseSame(r.pose, std.filter(k => !/3820#a/.test(k)))) drift.push(i + ':' + std.filter(k => JSON.stringify(r.pose[k]) !== JSON.stringify(R0.pose[k])).map(k => k + JSON.stringify(r.pose[k]) + 'vs' + JSON.stringify(R0.pose[k])).join('/')); }
  ok(drift.length === 0, '12 rebuilds with different figures: torso / arms / hips / legs placement identical to a fresh build' + (drift.length ? ' DRIFT ' + drift.join(' ') : ''));
  const rb = await rebuild(SPECS[0]); ok(JSON.stringify(rb.pose) === JSON.stringify(R0.pose) && rb.parts === R0.parts, 'after 12 rebuilds the first figure is IDENTICAL to the fresh build (pose report + part count ' + rb.parts + ')');
  for (let i = 0; i < 5; i++) await rebuild(SPECS[0]); const r5 = await p.evaluate(() => window.poseReport()); ok(r5.sceneMeshes === R0.pose.sceneMeshes && JSON.stringify(r5) === JSON.stringify(R0.pose), 'nothing stacks up: scene meshes/groups ' + R0.pose.sceneMeshes + ' == ' + r5.sceneMeshes + ' after 17 builds');
  // overlapping rebuilds (user clicks «ще раз» quickly): serialized, still one figure
  await p.evaluate(() => { window.rebuildFigure(window.MINIFIG_SPEC); window.rebuildFigure(window.MINIFIG_SPEC); return window.rebuildFigure(window.MINIFIG_SPEC); }); await p.waitForFunction(() => window.READY === true); await p.waitForTimeout(500);
  ok(JSON.stringify(await p.evaluate(() => window.poseReport())) === JSON.stringify(R0.pose), 'three overlapping rebuilds => still exactly one figure');
  await p.evaluate(() => localStorage.clear()); /* a regenerated figure has a NEW id => no stored locks for it, server's _locked_roles are used */ const rl = await rebuild(SPECS[5]); ok(rl.lock.includes('Торс:🔒') && rl.lock.includes('Низ / ноги:🔒') && rl.lock.includes('Рука:🔓'), 'locks the server applied are shown as 🔒 on the regenerated figure: ' + rl.lock.join(' '));
  ok((await p.evaluate(() => window.__msgs.at(-1))).roles.length === 2, 'lock state reported to the page at once (id ' + (await p.evaluate(() => window.__msgs.at(-1).id)) + ')');
  const armour = await rebuild({ ...base, neck_accessory: 'armor_breastplate' }); void armour; const roles = await p.evaluate(() => window.PARTS.map(x => x.id + '=' + x.role).join(' ')); ok(/2587=Плащ \/ броня/.test(roles) && /3818=Рука/.test(roles), 'breastplate is not mistaken for an arm: ' + roles.split(' ').filter(x => /2587|3818/.test(x)).join(' '));
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); if (srv) srv.kill(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
