// Test harness: FAKE Gemini HTTP server + the real app server pointed at it (GEMINI_BASE_URL). Zero real API calls.
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const SP = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/gen_spec.json'), 'utf8'));
async function start({ port = 8812, fakePort = 8813, spec = SP } = {}) {
  const st = { quota: false, calls: 0, spec };
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { st.calls++;
    if (st.quota) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, RESOURCE_EXHAUSTED per day PerDay' } })); }
    const t = (JSON.parse(b || '{}').contents?.[0]?.parts || []).map(p => p.text || '').join('\n'); let out;
    if (/Identify this subject/.test(t)) out = { is_known_character: false, character_name: '', identity: null, medium: 'photo', is_real_photo_of_real_person: true };
    else if (/IMAGE B = rendered/.test(t)) out = { score: 8, problems_uk: '', corrected_spec: null };
    else out = st.spec; // the "model" keeps returning the SAME spec (worst case): the exclude list alone must create variety
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] })); }); });
  await new Promise(r => fake.listen(fakePort, r));
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: port, GEMINI_API_KEY: 'fake-key', RATE_PER_IP: '1000', SQLITE_PATH: process.env.SQLITE_PATH || require('os').tmpdir() + '/lego-test-' + port + '-' + Date.now() + '.sqlite', GEMINI_BASE_URL: `http://localhost:${fakePort}` }, stdio: ['ignore', 'ignore', process.env.TEST_VERBOSE ? 'inherit' : 'ignore'] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) break; } catch {} await new Promise(z => setTimeout(z, 300)); }
  const base = `http://localhost:${port}`;
  const J = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
  const run = async (ep, body) => { const { job } = await J('/api/' + ep, body); for (let i = 0; i < 120; i++) { await new Promise(z => setTimeout(z, 500)); const s = await J('/job/' + job); if (s.status !== 'pending') return s; } throw new Error('timeout'); };
  return { st, base, J, run, stop() { try { srv.kill(); } catch {} fake.close(); } };
}
module.exports = { start, SP };
