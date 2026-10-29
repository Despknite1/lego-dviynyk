// node tests/my_store.test.js — unit: figure history store on SQLite (limits, ownership, revert, delete) + identity hashing.
process.env.SQLITE_PATH = require('os').tmpdir() + '/lego-unit-' + Date.now() + '.sqlite'; delete process.env.DATABASE_URL;
process.env.MY_MAX_FIGURES = '3'; process.env.MY_MAX_VERSIONS = '4';
const S = require('../lib/my/store'), I = require('../lib/my/identity');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
(async () => {
  const A = I.hashOf('a'.repeat(43)), Bo = I.hashOf('b'.repeat(43));
  ok(/^[0-9a-f]{64}$/.test(A) && A !== Bo && !A.includes('aaaa'), 'identity: only a sha256 hash, token not recoverable');
  const r1 = await S.addVersion(A, { title: 't', spec: { a: 1 }, outId: '1-aaaa', reason: 'generate' }); ok(r1.version === 1, 'first version = 1');
  const f = await S.findByOut(A, '1-aaaa'); ok(f && f.id === r1.figure_id, 'find figure by out id');
  ok(!(await S.findByOut(Bo, '1-aaaa')), 'other owner cannot find it');
  for (let i = 2; i <= 6; i++) await S.addVersion(A, { figId: r1.figure_id, spec: { a: i }, outId: '1-aaa' + i, reason: 'regenerate' });
  let d = await S.detail(A, r1.figure_id); ok(d.versions.length === 4 && d.versions[0].n === 3 && d.current_version === 6, 'version limit: oldest dropped, current = 6');
  ok(!(await S.detail(Bo, r1.figure_id)), 'detail checks owner');
  ok(!(await S.setCurrent(Bo, r1.figure_id, 4)), 'revert checks owner'); await S.setCurrent(A, r1.figure_id, 4); d = await S.detail(A, r1.figure_id); ok(d.current_version === 4, 'revert sets current version');
  let bad = false; try { await S.addVersion(A, { spec: {}, reason: 'evil' }); } catch { bad = true; } ok(bad, 'unknown reason rejected');
  bad = false; try { await S.addVersion(A, { spec: { x: 'y'.repeat(500e3) }, reason: 'generate' }); } catch { bad = true; } ok(bad, 'oversized spec rejected');
  for (let i = 0; i < 4; i++) await S.addVersion(A, { title: 'n' + i, spec: {}, reason: 'generate' });
  ok((await S.list(A)).length === 3, 'figure limit per owner (oldest dropped)'); ok((await S.list(Bo)).length === 0, 'other owner sees nothing');
  const l = await S.list(A); ok(!(await S.remove(Bo, l[0].id)) && (await S.remove(A, l[0].id)) && (await S.list(A)).length === 2, 'delete: owner only');
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
