// /api/my/* — anonymous figure history. Feature flag: FIGURES_ENABLED (default on; set "false" to disable).
const express = require('express'), fs = require('fs'), path = require('path');
const id = require('./identity'), store = require('./store'), log = require('../sec/log'), { limit } = require('../sec/ratelimit');
const enabled = () => process.env.FIGURES_ENABLED !== 'false';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let sharp; const thumb = async (b64, w = 160) => { try { sharp = sharp || require('sharp'); return (await sharp(Buffer.from(b64, 'base64'), { limitInputPixels: 40e6 }).rotate().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer()).toString('base64'); } catch { return null; } }; // sharp drops EXIF/metadata by default
const strip = sp => { const s = { ...sp }; delete s.textures; if (typeof s.torso_graphic_png === 'string' && s.torso_graphic_png.length > 200e3) delete s.torso_graphic_png; return s; };
// called from /api/generate and /api/face-apply. Never throws (history must not break generation).
async function record(owner, { reason, spec, png, crop, outId, prevOutId, title }) {
  if (!enabled() || !owner || !spec) return null;
  try {
    const prev = prevOutId ? await store.findByOut(owner, prevOutId) : null;
    if (reason === 'regenerate' && !prev) reason = 'generate';
    if (reason === 'face_pick' && !prev) return null;
    const r = await store.addVersion(owner, { figId: prev && prev.id, title, photoThumb: !prev && crop ? await thumb(crop) : null, spec: strip(spec), pngThumb: png ? await thumb(Buffer.isBuffer(png) ? png.toString('base64') : png, 200) : null, outId, reason });
    return { ...r, persistent: store.persistent() };
  } catch (e) { log.error({ evt: 'my.record', err: e.message }); return null; }
}
function router({ outDir, materialize }) {
  const r = express.Router();
  r.use((req, res, next) => enabled() ? next() : res.status(503).json({ error: 'Історія фігурок вимкнена', disabled: true }));
  r.use(limit('my', +process.env.MY_RATE_PER_IP || 120, 600e3));
  r.get('/csrf', (req, res) => { id.owner(req, res, true); res.json({ csrf: id.issueCsrf(req, res), persistent: store.persistent() }); });
  r.use(id.checkCsrf);
  r.use((req, res, next) => { req.owner = id.owner(req, res, false); if (!req.owner) return req.method === 'GET' && req.path === '/figures' ? res.json({ figures: [], persistent: store.persistent() }) : res.status(404).json({ error: 'Фігурку не знайдено' }); next(); });
  const wrap = fn => (req, res) => fn(req, res).catch(e => { log.error({ evt: 'my.error', err: e.message }); res.status(500).json({ error: 'Помилка сервера' }); });
  const chk = (req, res) => { if (!UUID.test(req.params.id)) { res.status(404).json({ error: 'Фігурку не знайдено' }); return false; } return true; };
  r.get('/figures', wrap(async (req, res) => res.json({ figures: (await store.list(req.owner)).map(f => ({ ...f, versions: +f.versions, created_at: +f.created_at, updated_at: +f.updated_at })), persistent: store.persistent(), limits: { figures: store.MAX_FIGS, versions: store.MAX_VERS } })));
  r.get('/figures/:id', wrap(async (req, res) => { if (!chk(req, res)) return; const f = await store.detail(req.owner, req.params.id); if (!f) return res.status(404).json({ error: 'Фігурку не знайдено' });
    const { owner_hash, ...pub } = f; res.json({ figure: { ...pub, created_at: +f.created_at, updated_at: +f.updated_at, versions: f.versions.map(v => ({ n: +v.n, png_thumb: v.png_thumb, reason: v.reason, created_at: +v.created_at })) }, persistent: store.persistent() }); }));
  // open a version in 3D: writes out/<id>.json (+png) from the stored spec when the ephemeral file is gone
  async function open(req, n, setCur) {
    const x = setCur ? await store.version(req.owner, req.params.id, n) : await store.version(req.owner, req.params.id, n); if (!x) return null;
    let outId = x.v.out_id; if (!outId || !fs.existsSync(path.join(outDir, outId + '.json'))) outId = await materialize(JSON.parse(x.v.spec));
    if (setCur) await store.setCurrent(req.owner, req.params.id, x.v.n, outId);
    return { figure_id: x.fig.id, version: +x.v.n, out_id: outId, viewer3d: '/viewer3d.html?id=' + outId };
  }
  r.post('/figures/:id/open', express.json({ limit: '2kb' }), wrap(async (req, res) => { if (!chk(req, res)) return; const n = parseInt(req.body && req.body.version, 10); const o = await open(req, n, false); o ? res.json(o) : res.status(404).json({ error: 'Версію не знайдено' }); }));
  r.post('/figures/:id/revert', express.json({ limit: '2kb' }), wrap(async (req, res) => { if (!chk(req, res)) return; const n = parseInt(req.body && req.body.version, 10); if (!(n > 0)) return res.status(400).json({ error: 'Потрібна версія' });
    const o = await open(req, n, true); o ? res.json({ ok: true, ...o }) : res.status(404).json({ error: 'Версію не знайдено' }); }));
  r.delete('/figures/:id', wrap(async (req, res) => { if (!chk(req, res)) return; (await store.remove(req.owner, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: 'Фігурку не знайдено' }); }));
  return r;
}
module.exports = { router, record, enabled, thumb };
