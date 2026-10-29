// Figure history storage (figures + figure_versions) on top of lib/sec/db.js (Postgres via DATABASE_URL, else SQLite file).
const { init } = require('../sec/db');
const log = require('../sec/log');
const MAX_FIGS = +process.env.MY_MAX_FIGURES || 50, MAX_VERS = +process.env.MY_MAX_VERSIONS || 20, MAX_SPEC = 400e3, MAX_THUMB = 120e3;
const REASONS = ['generate', 'regenerate', 'face_pick', 'manual', 'revert'];
const MIGRATIONS = [
  ['001_figures', [
    `CREATE TABLE IF NOT EXISTS identities (owner_hash TEXT PRIMARY KEY, user_id TEXT, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS figures (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, title TEXT, photo_thumb TEXT, current_version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE INDEX IF NOT EXISTS figures_owner ON figures(owner_hash, updated_at)`,
    `CREATE TABLE IF NOT EXISTS figure_versions (id TEXT PRIMARY KEY, figure_id TEXT NOT NULL, n INTEGER NOT NULL, spec TEXT NOT NULL, png_thumb TEXT, out_id TEXT, reason TEXT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS figver_n ON figure_versions(figure_id, n)`,
    `CREATE INDEX IF NOT EXISTS figver_out ON figure_versions(out_id)`,
  ]],
];
let ready = null;
function db() {
  return ready = ready || (async () => {
    const d = await init();
    await d.q(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`);
    const done = new Set((await d.q('SELECT name FROM schema_migrations')).map(r => r.name));
    for (const [name, stmts] of MIGRATIONS) if (!done.has(name)) { for (const s of stmts) await d.q(s); await d.q('INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2)', [name, Date.now()]); log.info({ evt: 'db.migrate', name, kind: d.kind }); }
    if (d.kind !== 'postgres') log.warn({ evt: 'db.ephemeral' }, 'DATABASE_URL не задано: історія фігурок зберігається у локальному SQLite (на Render — тимчасово, зникне при перезапуску/деплої)');
    return d;
  })().catch(e => { ready = null; throw e; });
}
const rid = () => require('crypto').randomUUID();
const persistent = () => !!process.env.DATABASE_URL;
async function touchIdentity(d, owner) { await d.q(d.kind === 'postgres' ? 'INSERT INTO identities(owner_hash,created_at) VALUES($1,$2) ON CONFLICT DO NOTHING' : 'INSERT OR IGNORE INTO identities(owner_hash,created_at) VALUES($1,$2)', [owner, Date.now()]); }
async function getFig(owner, id) { const d = await db(); return (await d.q('SELECT * FROM figures WHERE id=$1 AND owner_hash=$2', [String(id), owner]))[0] || null; }
async function list(owner) {
  const d = await db();
  return d.q(`SELECT f.id, f.title, f.photo_thumb, f.current_version, f.created_at, f.updated_at, v.png_thumb, (SELECT COUNT(*) FROM figure_versions x WHERE x.figure_id=f.id) AS versions
    FROM figures f LEFT JOIN figure_versions v ON v.figure_id=f.id AND v.n=f.current_version WHERE f.owner_hash=$1 ORDER BY f.updated_at DESC LIMIT ${MAX_FIGS}`, [owner]);
}
async function detail(owner, id) {
  const f = await getFig(owner, id); if (!f) return null; const d = await db();
  const versions = await d.q('SELECT n, png_thumb, reason, created_at, out_id FROM figure_versions WHERE figure_id=$1 ORDER BY n', [f.id]);
  return { ...f, versions };
}
async function version(owner, id, n) { const f = await getFig(owner, id); if (!f) return null; const d = await db(); const v = (await d.q('SELECT * FROM figure_versions WHERE figure_id=$1 AND n=$2', [f.id, +n]))[0]; return v ? { fig: f, v } : null; }
async function findByOut(owner, outId) { if (!outId) return null; const d = await db(); return (await d.q('SELECT f.* FROM figure_versions v JOIN figures f ON f.id=v.figure_id WHERE v.out_id=$1 AND f.owner_hash=$2', [String(outId), owner]))[0] || null; }
// add a version; creates the figure when figId is null. Enforces per-owner/per-figure limits (oldest dropped).
async function addVersion(owner, { figId, title, photoThumb, spec, pngThumb, outId, reason }) {
  if (!REASONS.includes(reason)) throw new Error('bad reason');
  const js = JSON.stringify(spec); if (js.length > MAX_SPEC) throw new Error('spec too large');
  if (pngThumb && pngThumb.length > MAX_THUMB) pngThumb = null; if (photoThumb && photoThumb.length > MAX_THUMB) photoThumb = null;
  const d = await db(); const now = Date.now(); await touchIdentity(d, owner);
  let f = figId ? await getFig(owner, figId) : null;
  if (!f) {
    const old = await d.q('SELECT id FROM figures WHERE owner_hash=$1 ORDER BY updated_at DESC', [owner]);
    for (const o of old.slice(MAX_FIGS - 1)) await remove(owner, o.id);
    f = { id: rid() }; await d.q('INSERT INTO figures(id,owner_hash,created_at,updated_at,title,photo_thumb,current_version) VALUES($1,$2,$3,$4,$5,$6,1)', [f.id, owner, now, now, String(title || 'Фігурка').slice(0, 120), photoThumb || null]);
  }
  const n = +((await d.q('SELECT MAX(n) AS m FROM figure_versions WHERE figure_id=$1', [f.id]))[0]?.m || 0) + 1;
  if (outId) await d.q('UPDATE figure_versions SET out_id=NULL WHERE figure_id=$1 AND out_id=$2', [f.id, outId]); // out file overwritten in place (face pick)
  await d.q('INSERT INTO figure_versions(id,figure_id,n,spec,png_thumb,out_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [rid(), f.id, n, js, pngThumb || null, outId || null, reason, now]);
  await d.q('UPDATE figures SET current_version=$1, updated_at=$2 WHERE id=$3', [n, now, f.id]);
  const vs = await d.q('SELECT n FROM figure_versions WHERE figure_id=$1 ORDER BY n', [f.id]);
  for (const v of vs.slice(0, Math.max(0, vs.length - MAX_VERS))) await d.q('DELETE FROM figure_versions WHERE figure_id=$1 AND n=$2', [f.id, v.n]);
  return { figure_id: f.id, version: n };
}
async function setCurrent(owner, id, n, outId) { const x = await version(owner, id, n); if (!x) return null; const d = await db(); await d.q('UPDATE figures SET current_version=$1, updated_at=$2 WHERE id=$3', [x.v.n, Date.now(), x.fig.id]); if (outId) await d.q('UPDATE figure_versions SET out_id=$1 WHERE id=$2', [outId, x.v.id]); return x; }
async function remove(owner, id) { const f = await getFig(owner, id); if (!f) return false; const d = await db(); await d.q('DELETE FROM figure_versions WHERE figure_id=$1', [f.id]); await d.q('DELETE FROM figures WHERE id=$1', [f.id]); return true; }
module.exports = { db, list, detail, version, findByOut, addVersion, setCurrent, remove, persistent, MAX_FIGS, MAX_VERS };
