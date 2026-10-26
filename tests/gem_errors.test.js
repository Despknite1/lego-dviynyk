// node tests/gem_errors.test.js — offline: boots the real server with a fake Gemini (all models 429 quota; retired models 404)
// and checks the user-facing text, no raw model names/status codes, no hammering after quota, retired models called once.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemerr-')), preload = path.join(dir, 'mock.js'), calls = path.join(dir, 'calls.txt');
fs.writeFileSync(preload, `const fs=require('fs'),of=globalThis.fetch;globalThis.fetch=async(u,o)=>{const s=String(u);if(!s.includes('generativelanguage'))return of(u,o);const m=(s.match(/models\\/([^:]+):/)||[])[1];fs.appendFileSync(${JSON.stringify(calls)},m+'\\n');
 if(/2\\.5/.test(m))return new Response(JSON.stringify({error:{message:'This model is no longer available'}}),{status:404});
 return new Response(JSON.stringify({error:{message:'You exceeded your current quota, please check your plan and billing details.'}}),{status:429});};`);
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const port = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: port, GEMINI_API_KEY: 'test-key', NODE_OPTIONS: '-r ' + preload, TRUST_PROXY_HOPS: '1' }, stdio: 'ignore' });
const base = 'http://127.0.0.1:' + port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function gen() { const r = await (await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: png, mime: 'image/png' }) })).json();
  for (let i = 0; i < 60; i++) { await sleep(300); const j = await (await fetch(base + '/job/' + r.job)).json(); if (j.status !== 'pending') return j; } return { status: 'timeout' }; }
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await sleep(250); }
  const j = await gen();
  ok(j.status === 'error' && j.code === 'quota', 'quota => job.code=quota');
  ok(/вичерпано/.test(j.error) && /10:00/.test(j.error), 'friendly quota text with reset time: ' + j.error.slice(0, 60));
  ok(!/gemini-|429|RESOURCE|exceeded|\bAPI\b/i.test(j.error.replace(/Gemini/g, '')), 'no raw model names / status codes shown to the user');
  const n1 = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean); const retired = n1.filter(m => /2\.5/.test(m));
  ok(new Set(retired).size === retired.length, 'retired (404) models are called at most once each: ' + retired.length);
  const j2 = await gen(); const n2 = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length;
  ok(j2.code === 'quota' && n2 === n1.length, `second request right after quota makes 0 new Gemini calls (${n1.length} → ${n2})`);
  srv.kill(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
