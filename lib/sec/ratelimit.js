// Minimal in-memory sliding-window limiter (single instance). Key = route + ip/account.
const buckets = new Map();
function hit(key, max, windowMs) { const now = Date.now(); const a = (buckets.get(key) || []).filter(t => now - t < windowMs); a.push(now); buckets.set(key, a); return a.length <= max; }
function limit(name, max, windowMs, keyFn = req => req.ip) { return (req, res, next) => hit(name + ':' + keyFn(req), max, windowMs) ? next() : res.status(429).json({ error: 'Забагато спроб. Спробуйте пізніше.' }); }
setInterval(() => { const now = Date.now(); for (const [k, a] of buckets) if (!a.length || now - a[a.length - 1] > 3600e3) buckets.delete(k); }, 600e3).unref();
module.exports = { hit, limit };
