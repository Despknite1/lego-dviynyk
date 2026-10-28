// node tests/perf.test.js — offline: compression, cache headers, and "one Gemini model at a time for text calls" (fake Gemini).
const H = require('./helpers/harness'), sharp = require('sharp');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
(async () => {
  const h = await H.start({ port: 8862, fakePort: 8863 });
  const get = async (u, ae) => { const r = await fetch(h.base + u, { headers: { 'accept-encoding': ae || 'gzip' } }); const b = Buffer.from(await r.arrayBuffer()); return { s: r.status, h: r.headers, n: b.length }; };
  const three = await get('/vendor/three/build/three.module.js'); ok(/gzip|br/.test(three.h.get('content-encoding') || ''), 'three.module.js is sent compressed (content-encoding ' + three.h.get('content-encoding') + ')');
  const idx = await get('/'); ok(/gzip|br/.test(idx.h.get('content-encoding') || ''), 'index.html is compressed (' + idx.n + ' B)'); ok(/no-cache/.test(idx.h.get('cache-control')), 'index.html is always revalidated (a deploy is visible at once)');
  const js = await get('/viewer3d.js'); ok(/no-cache/.test(js.h.get('cache-control')), 'own JS is revalidated (ETag => 304)');
  const et = (await fetch(h.base + '/viewer3d.js')).headers.get('etag'); const st304 = await new Promise(z => require('http').get(h.base + '/viewer3d.js', { headers: { 'if-none-match': et } }, r => { r.resume(); z(r.statusCode); })); ok(!!et && st304 === 304, 'ETag works: second load is a 304');
  const th = await get('/face_thumbs/3626bp01.png'); ok(th.s === 200 && /max-age=604800/.test(th.h.get('cache-control')), 'face thumbnails are cached for 7 days');
  ok(/max-age=604800/.test((await get('/vendor/three/build/three.module.js')).h.get('cache-control')), 'three.js cached for 7 days');
  const hz = await get('/healthz'); ok(hz.s === 200, '/healthz 200');
  // text calls use ONE model at a time
  const png = (await sharp({ create: { width: 64, height: 64, channels: 3, background: '#778' } }).png().toBuffer()).toString('base64');
  h.st.spec = { subjects: [{ label: 'x', box_2d: [0, 0, 1000, 1000] }] }; const c0 = h.st.calls; const r = await h.run('detect', { image: png, mime: 'image/png' });
  ok(r.status === 'done', 'detect works with the fake Gemini (' + r.status + ')'); ok(h.st.calls - c0 === 1, 'one text request => exactly ONE Gemini call (was 2 hedged ones): ' + (h.st.calls - c0));
  h.stop(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
