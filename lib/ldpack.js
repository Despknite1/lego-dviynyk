// Збирає деталь LDraw (3D-креслення деталі LEGO) з усіма підфайлами в один файл для 3D-переглядача.
// minimal packer: inline a part and its subfiles into an MPD (restored)
const fs = require('fs'), path = require('path');
const ROOT = process.env.LDRAW_DIR || '/workspace/ldraw/ldraw';
function find(n) { n = n.replace(/\\/g, '/').toLowerCase(); for (const d of ['parts', 'p']) { const p = path.join(ROOT, d, n); if (fs.existsSync(p)) return p; } return null; }
function pack(part) { const seen = new Set(), out = []; const go = n => { if (seen.has(n)) return; seen.add(n); const p = find(n); if (!p) return; const t = fs.readFileSync(p, 'utf8'); out.push('0 FILE ' + n + '\n' + t);
  for (const l of t.split('\n')) { const k = l.trim().split(/\s+/); if (k[0] === '1' && k.length >= 15) go(k.slice(14).join(' ').toLowerCase()); } };
  const n = part.toLowerCase().replace(/\.dat$/, '') + '.dat'; if (!find(n)) throw new Error('no part ' + part); go(n); return out.join('\n'); }
module.exports = { pack };
