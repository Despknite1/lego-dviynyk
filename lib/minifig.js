// Малювання мініфігурки у 2D: перетворює «специфікацію» (кольори, волосся, обличчя, одяг)
// у SVG-картинку та PNG, а також текстури (принти) для 3D-моделі.
// Deterministic LEGO minifigure renderer (front view), proportions traced from a real classic minifig photo.
// Coordinate space = reference photo space (300x400 px, ~8.7 px/mm: hip width 14.4 mm = 125 px).
const { Resvg } = require('@resvg/resvg-js');

const LEGO = { yellow: '#F2CD37', white: '#F4F4F4', black: '#1B2A34', red: '#C91A09', blue: '#0055BF', green: '#237841', brightgreen: '#4B9F4A',
  tan: '#E4CD9E', brown: '#583927', reddishbrown: '#582A12', lightgray: '#A0A5A9', darkgray: '#6C6E68', orange: '#FE8A18', pink: '#FC97AC', magenta: '#923978', darkblue: '#0A3463', lightnougat: '#F6D7B3', nougat: '#D09168' };

function hex(c, d = '#cccccc') { if (!c) return d; c = String(c).trim(); if (LEGO[c.toLowerCase().replace(/[^a-z]/g, '')]) return LEGO[c.toLowerCase().replace(/[^a-z]/g, '')];
  const m = c.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return d; let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join(''); return '#' + h.toLowerCase(); }
function rgb(h) { h = hex(h); return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function toHex(a) { return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
// shade: f<1 darker, f>1 lighter (towards white)
function shade(h, f) { const c = rgb(h); return f <= 1 ? toHex(c.map(v => v * f)) : toHex(c.map(v => v + (255 - v) * (f - 1))); }
const lum = h => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

let gid = 0;
function cylGrad(c, dir = 'h', strong = 1) { // cylindrical plastic shading
  const id = 'g' + (++gid); const k = strong;
  const stops = [[0, shade(c, 1 - 0.34 * k)], [0.12, shade(c, 1 - 0.12 * k)], [0.32, shade(c, 1 + 0.16 * k)], [0.42, shade(c, 1 + 0.08 * k)], [0.75, shade(c, 1 - 0.06 * k)], [0.93, shade(c, 1 - 0.22 * k)], [1, shade(c, 1 - 0.38 * k)]];
  const [x2, y2] = dir === 'h' ? [1, 0] : [0, 1];
  return { id, def: `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, s]) => `<stop offset="${o}" stop-color="${s}"/>`).join('')}</linearGradient>` };
}
function radGrad(c, cx = 0.38, cy = 0.3) { const id = 'g' + (++gid);
  return { id, def: `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.85"><stop offset="0" stop-color="${shade(c, 1.22)}"/><stop offset="0.45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, 0.66)}"/></radialGradient>` }; }

// sanitize Gemini-made SVG fragments
function cleanSvg(s) {
  if (!s || typeof s !== 'string') return '';
  s = s.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, '').replace(/<\/?svg[^>]*>/gi, '');
  s = s.replace(/<(script|style|foreignObject|image|use|a|iframe)[\s\S]*?<\/\1>/gi, '').replace(/<(script|image|use|a|foreignObject)[^>]*\/?>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/(xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const ok = /^(path|rect|circle|ellipse|line|polygon|polyline|g|text|tspan|defs|linearGradient|radialGradient|stop|clipPath)$/i;
  s = s.replace(/<\/?\s*([a-zA-Z]+)[^>]*>/g, (m, t) => ok.test(t) ? m : '');
  return s.slice(0, 20000);
}

// ---------------- geometry ----------------
const G = {
  stud: { x: 125, y: 30, w: 54, h: 15 },
  head: { x: 111, y: 43, w: 82, h: 86, r: 15 },
  neck: { x: 122, y: 127, w: 60, h: 11 },
  torso: 'M104,137 L200,137 Q205,137 206,142 L219,258 Q220,263 214,263 L90,263 Q84,263 85,258 L98,142 Q99,137 104,137 Z',
  armL: 'M100,141 Q78,141 70,160 L48,226 Q46,236 56,240 L80,242 Q88,242 90,234 L99,190 Z',
  armR: 'M204,141 Q226,141 234,160 L256,226 Q258,236 248,240 L224,242 Q216,242 214,234 L205,190 Z',
  hips: 'M88,262 L216,262 L216,300 L88,300 Z',
  legL: 'M88,298 L147,298 L147,388 Q146,393 141,393 L88,393 Q83,393 83,388 L86,318 Z',
  legR: 'M157,298 L216,298 L218,318 L221,388 Q221,393 216,393 L163,393 Q157,393 157,388 Z',
};
function handSvg(cx, cy, col) {
  const g = radGrad(col, 0.4, 0.3); const d = shade(col, 0.55);
  // wrist + C-hand seen from the front: thick ring, dark hole, opening at the bottom-front
  return { def: g.def, svg: `<rect x="${cx - 8}" y="${cy - 20}" width="16" height="12" rx="3" fill="${shade(col, 0.82)}" stroke="${d}" stroke-width="0.6"/>
  <ellipse cx="${cx}" cy="${cy}" rx="18" ry="15" fill="url(#${g.id})" stroke="${d}" stroke-width="0.9"/>
  <ellipse cx="${cx}" cy="${cy + 2}" rx="9.5" ry="8" fill="${shade(col, 0.42)}"/>
  <path d="M${cx - 6},${cy + 6} L${cx - 7},${cy + 16} L${cx + 7},${cy + 16} L${cx + 6},${cy + 6} Z" fill="#ffffff"/>
  <path d="M${cx - 7},${cy + 7} L${cx - 8},${cy + 15}" stroke="${d}" stroke-width="0.9"/><path d="M${cx + 7},${cy + 7} L${cx + 8},${cy + 15}" stroke="${d}" stroke-width="0.9"/>
  <path d="M${cx - 12},${cy - 8} Q${cx - 4},${cy - 14} ${cx + 5},${cy - 12}" stroke="#fff" stroke-opacity="0.55" stroke-width="2.4" fill="none" stroke-linecap="round"/>` };
}

// ---------------- hair / headgear library ----------------
function hairSvg(type, col, col2) {
  const g = radGrad(col, 0.4, 0.25); const dk = shade(col, 0.6); const f = `url(#${g.id})`; const defs = [g.def];
  const strands = (pts) => pts.map(p => `<path d="${p}" stroke="${dk}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.7"/>`).join('');
  const shine = (d) => `<path d="${d}" stroke="#fff" stroke-opacity="0.45" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  const capTop = 'M103,98 Q94,34 152,27 Q210,34 201,98 L194,100 Q193,74 186,68 Q170,76 150,70 Q130,78 118,70 Q111,76 110,100 Z';
  let back = '', front = '';
  switch (type) {
    case 'long_straight': case 'long_wavy': case 'bob': case 'mid_length': case 'long_bangs': return hairSvg('long', col, col2);
    case 'ponytail_side': case 'side_braid': case 'twin_tails': case 'pigtails_braided': case 'ponytail_bangs': return hairSvg('ponytail', col, col2);
    case 'bun_fringe': return hairSvg('bun', col, col2);
    case 'none': case 'bald': return { back: '', front: '', defs: '', hideStud: false };
    case 'short':
      front = `<path d="${capTop}" fill="${f}" stroke="${dk}" stroke-width="1"/>` + strands(['M130,40 Q124,55 120,68', 'M152,34 Q150,52 150,68', 'M174,40 Q180,55 184,66']) + shine('M126,46 Q138,36 156,36'); break;
    case 'long':
      back = `<path d="M100,70 Q98,36 152,28 Q206,36 204,70 L210,178 Q196,186 186,176 L186,110 L118,110 L118,176 Q108,186 94,178 Z" fill="${shade(col, 0.82)}" stroke="${dk}" stroke-width="1"/>`;
      front = `<path d="M100,98 Q96,38 152,28 Q208,38 204,98 L208,176 Q198,184 190,174 L188,100 Q186,74 180,66 Q160,80 132,70 Q120,74 116,100 L114,174 Q106,184 96,176 Z" fill="${f}" stroke="${dk}" stroke-width="1"/>`
        + strands(['M106,110 L104,170', 'M198,110 L200,170', 'M140,38 Q128,52 122,70', 'M166,38 Q178,52 184,64']) + shine('M120,46 Q138,34 160,35'); break;
    case 'ponytail':
      back = `<path d="M190,60 Q228,70 222,130 Q218,168 204,182 Q200,150 196,120 Z" fill="${shade(col, 0.85)}" stroke="${dk}" stroke-width="1"/>`;
      front = `<path d="${capTop}" fill="${f}" stroke="${dk}" stroke-width="1"/>` + strands(['M132,40 Q126,56 122,68', 'M170,38 Q178,54 182,66']) + shine('M126,46 Q138,36 156,36'); break;
    case 'bun':
      front = `<circle cx="152" cy="26" r="17" fill="${f}" stroke="${dk}" stroke-width="1"/><path d="${capTop}" fill="${f}" stroke="${dk}" stroke-width="1"/>` + shine('M126,46 Q138,36 156,36'); break;
    case 'spiky':
      front = `<path d="M104,98 L100,60 L112,62 L110,36 L126,48 L132,22 L146,42 L156,18 L164,42 L180,24 L182,48 L198,38 L194,62 L206,62 L200,98 L194,98 Q192,76 186,70 Q160,80 140,72 Q118,78 110,98 Z" fill="${f}" stroke="${dk}" stroke-width="1"/>`; break;
    case 'curly':
      front = `<path d="M102,100 Q92,86 100,74 Q92,58 106,50 Q106,32 124,32 Q134,18 152,24 Q170,18 180,32 Q198,32 198,50 Q212,58 204,74 Q212,86 202,100 L194,100 Q192,78 184,72 Q160,82 138,74 Q118,80 112,100 Z" fill="${f}" stroke="${dk}" stroke-width="1"/>`
        + strands(['M118,46 q6,6 0,12', 'M142,34 q6,6 0,12', 'M168,36 q6,6 0,12', 'M188,52 q6,6 0,12']); break;
    case 'cap':
      front = `<path d="M106,82 Q104,34 152,30 Q200,34 198,82 Z" fill="${f}" stroke="${dk}" stroke-width="1"/><path d="M100,82 Q152,70 204,82 Q206,92 196,92 Q152,84 108,92 Q98,92 100,82 Z" fill="${shade(col2 || col, 0.9)}" stroke="${dk}" stroke-width="1"/><circle cx="152" cy="32" r="4" fill="${shade(col, 0.8)}"/>` + shine('M124,44 Q138,36 156,36'); break;
    case 'hood':
      back = `<path d="M94,150 Q84,40 152,22 Q220,40 210,150 Q190,160 152,158 Q114,160 94,150 Z" fill="${shade(col, 0.8)}" stroke="${dk}" stroke-width="1"/>`;
      front = `<path d="M98,140 Q90,44 152,26 Q214,44 206,140 L194,132 Q198,62 152,54 Q106,62 110,132 Z" fill="${f}" stroke="${dk}" stroke-width="1"/>` + shine('M114,70 Q126,40 156,34'); break;
    case 'helmet_knight': case 'helmet': {
      const m = radGrad(col, 0.35, 0.25); defs.push(m.def);
      front = `<path d="M100,112 Q94,30 152,24 Q210,30 204,112 L196,116 L194,80 L110,80 L108,116 Z" fill="url(#${m.id})" stroke="${dk}" stroke-width="1.2"/>
        <rect x="104" y="74" width="96" height="9" rx="3" fill="${shade(col, 0.75)}"/><path d="M147,80 L157,80 L156,108 L148,108 Z" fill="${shade(col, 0.85)}" stroke="${dk}" stroke-width="0.8"/>
        <circle cx="114" cy="96" r="2.5" fill="${shade(col, 0.6)}"/><circle cx="190" cy="96" r="2.5" fill="${shade(col, 0.6)}"/>` + shine('M118,46 Q134,32 160,32') + (col2 ? `<path d="M150,24 Q156,4 176,8 Q164,16 158,26 Z" fill="${col2}" stroke="${shade(col2, 0.6)}"/>` : ''); break; }
    case 'bandana_tails': // ninja-turtle style band: drawn on face layer; tails at back right
      back = `<path d="M188,80 Q214,92 226,124 Q214,122 206,108 Q212,130 206,150 Q196,128 192,96 Z" fill="${shade(col, 0.85)}" stroke="${dk}" stroke-width="1"/>`;
      return { back, front: '', defs: defs.join(''), hideStud: false, bandana: col };
    default: return hairSvg('short', col, col2);
  }
  return { back, front, defs: defs.join(''), hideStud: true };
}

// ---------------- face print ----------------
// Official-LEGO-style face prints (proportions measured from a grid of real heads):
// head print box x111..193 (W=82), eyes at y86, centres x140/164, eye ≈ 4.6×5.6, brows thin & short ~7 above eyes, mouth ≈ y106, smile ≈ 14 wide.
function glassesSvg(f) { const out = [];
  if (f.glasses && f.glasses !== 'none') { const gc = hex(f.glasses_color, '#1b1b1b');
    if (f.glasses === 'sunglasses') out.push(`<path d="M132,82 L148,82 Q148,92 140,92 Q132,92 132,82 Z M156,82 L172,82 Q172,92 164,92 Q156,92 156,82 Z" fill="${gc}"/><path d="M148,83.5 L156,83.5 M132,83 L120,81.5 M172,83 L184,81.5" stroke="${gc}" stroke-width="1.1"/><path d="M134,84 l4,0" stroke="#fff" stroke-width="0.8" opacity="0.7"/>`);
    else if (/square|rect/.test(f.glasses)) out.push(`<rect x="129" y="79.5" width="21" height="13.5" rx="2.6" fill="none" stroke="${gc}" stroke-width="2"/><rect x="154" y="79.5" width="21" height="13.5" rx="2.6" fill="none" stroke="${gc}" stroke-width="2"/><path d="M150,84 Q152,82.6 154,84 M129,83.5 L117,82 M175,83.5 L187,82" stroke="${gc}" stroke-width="1.6"/><path d="M132,82 l4,-1.2 M157,82 l4,-1.2" stroke="#fff" stroke-width="0.9" opacity="0.85" stroke-linecap="round"/>`);
    else out.push(`<circle cx="140" cy="86" r="8" fill="none" stroke="${gc}" stroke-width="1.8"/><circle cx="164" cy="86" r="8" fill="none" stroke="${gc}" stroke-width="1.8"/><path d="M135,81.5 q2,-1.4 4.4,-1.2 M159,81.5 q2,-1.4 4.4,-1.2" stroke="#fff" stroke-width="0.9" fill="none" stroke-linecap="round" opacity="0.85"/><path d="M148,85 Q152,83 156,85 M132,85 L118,83 M172,85 L186,83" stroke="${gc}" stroke-width="1.5"/>`); }
  return out.join('');
}
// face masks printed on the head (metal mask, balaclava, half masks, face paint) + free-form extra face print
function maskSvg(f) {
  const out = []; const m = f.mask && typeof f.mask === 'object' ? f.mask : (typeof f.mask === 'string' && f.mask !== 'none' ? { type: f.mask } : null);
  if (m && m.type && m.type !== 'none') {
    const c = hex(m.color, m.type === 'balaclava' ? '#1b1b1b' : '#A0A5A9'), c2 = hex(m.secondary_color, shade(c, 0.6)), id = 'mk' + (++gid);
    const metal = /metal|iron|silver|gold|steel/.test(m.type + ' ' + (m.material || '')) || m.type === 'metal_full';
    out.push(`<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${shade(c, 0.7)}"/><stop offset="0.35" stop-color="${metal ? lighten(c) : c}"/><stop offset="0.6" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, 0.65)}"/></linearGradient></defs>`);
    const holes = 'M131.5,86 a8,4.6 0 1,0 17,0 a8,4.6 0 1,0 -17,0 Z M155.5,86 a8,4.6 0 1,0 17,0 a8,4.6 0 1,0 -17,0 Z';
    if (m.type === 'metal_full' || m.type === 'full') {
      // forged metal mask (Baldwin IV style): oval plate, embossed brow, almond eye SLITS with the eyes inside, nose ridge, breathing holes, rivets, side straps
      const dk = shade(c, 0.45), hl = lighten(c);
      out.push(`<defs><radialGradient id="${id}r" cx="0.42" cy="0.35" r="0.75"><stop offset="0" stop-color="${hl}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, 0.62)}"/></radialGradient></defs>`,
        `<path d="M111,82 L118,82 M186,82 L193,82 M111,100 L117,100 M187,100 L193,100" stroke="${shade(c2, 0.8)}" stroke-width="2.4"/>`,
        `<path d="M118,72 Q152,56 186,72 L186,100 Q183,124 152,131 Q121,124 118,100 Z" fill="url(#${id}r)" stroke="${dk}" stroke-width="1.3"/>`,
        `<path d="M124,80 Q138,74 150,79 L154,79 Q166,74 180,80" stroke="${dk}" stroke-width="1.4" fill="none"/><path d="M125,78.6 Q138,72.6 150,77.6 M154,77.6 Q166,72.6 179,78.6" stroke="#fff" stroke-width="0.8" opacity="0.55" fill="none"/>`,
        `<path d="M130,87 Q140,81.5 149,86.5 Q140,90.5 130,87 Z M155,86.5 Q164,81.5 174,87 Q164,90.5 155,86.5 Z" fill="#141414"/>`,
        `<circle cx="141" cy="86.2" r="1.6" fill="#3a3a3a"/><circle cx="163" cy="86.2" r="1.6" fill="#3a3a3a"/><circle cx="141.6" cy="85.6" r="0.6" fill="#fff"/><circle cx="163.6" cy="85.6" r="0.6" fill="#fff"/>`,
        `<path d="M152,80 L150,104 Q152,106 154,104 Z" fill="${shade(c, 0.8)}" stroke="${dk}" stroke-width="0.6"/><path d="M151.4,82 L150.6,102" stroke="#fff" stroke-width="0.6" opacity="0.6"/>`,
        ...[[146,113],[152,113],[158,113],[149,118],[155,118]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${dk}"/>`),
        ...[[121,75],[183,75],[119,93],[185,93],[123,110],[181,110],[138,126],[166,126]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="${shade(c, 0.55)}"/><circle cx="${x - 0.35}" cy="${y - 0.35}" r="0.45" fill="#fff" opacity="0.8"/>`),
        `<path d="M124,98 Q128,114 140,122" stroke="#fff" stroke-width="1" opacity="0.35" fill="none"/>`);
    } else if (m.type === 'half_mask_lower' || m.type === 'half_mask') {
      out.push(`<path d="M114,95 Q152,92 190,95 L189,106 Q185,125 152,130 Q119,125 115,106 Z" fill="url(#${id})" stroke="${c2}" stroke-width="1"/><path d="M130,108 L174,108 M132,115 L172,115" stroke="${c2}" stroke-width="0.9" opacity="0.6"/>`);
    } else if (m.type === 'domino' || m.type === 'eye_mask') {
      out.push(`<path fill-rule="evenodd" d="M122,79 Q152,75 182,79 Q184,93 172,94 Q160,95 152,90 Q144,95 132,94 Q120,93 122,79 Z ${holes}" fill="url(#${id})"/>`);
    } else if (m.type === 'balaclava') {
      out.push(`<path fill-rule="evenodd" d="M111,47 L193,47 L193,133 L111,133 Z M124,78 Q152,74 180,78 L180,95 Q152,99 124,95 Z" fill="url(#${id})"/>`);
    } else if (/paint/.test(m.type)) {
      out.push(`<path d="M124,94 l10,4 M124,99 l10,3 M180,94 l-10,4 M180,99 l-10,3" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><path d="M138,72 L166,72" stroke="${c}" stroke-width="2" opacity="0.8"/>`);
    }
  }
  const ex = cleanSvg(f.face_extra_svg); if (ex) out.push(`<svg x="111" y="47" width="82" height="86" viewBox="0 0 100 100" preserveAspectRatio="none">${ex}</svg>`);
  return out.join('');
}
const lighten = c => { const n = parseInt(c.slice(1), 16); const m = v => Math.min(255, Math.round(v + (255 - v) * 0.45)); return '#' + [m(n >> 16), m((n >> 8) & 255), m(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); };
function faceSvg(f0 = {}, skin) {
  { const mt = f0.mask && (f0.mask.type || f0.mask); if (mt === 'metal_full' || mt === 'full') { const sv = maskSvg(f0); return { defs: '', svg: sv }; } }
  const f = { ...f0 }; const out = []; const K = '#1b1b1b'; const ink = K; const ey = 86, ex = [140, 164];
  const sk = hex(skin, '#F2CD37'); const shadeInk = shade(sk, 0.62); // darker-skin lines for wrinkles/cheeks (as LEGO prints use dark tan/brown lines)
  const fem = f.gender === 'female' || f.lashes === true; const V = Math.max(0, Math.min(5, Math.round(+f.variant || 0))); // cosmetic face variant (regeneration): 0 default, 1..5 subtle alternatives of brows/mouth/nose/eyes
  let expr = f.expression || ({ grin: 'grin', open: 'grin', frown: 'angry', smirk: 'smirk', neutral: 'neutral', o: 'surprised', small: 'smile' })[f.mouth] || 'neutral';
  if (/tongue/.test(expr)) expr = 'tongue'; if (/wink/.test(expr)) expr = 'wink'; if (/surpris|open/.test(expr)) expr = 'surprised';
  // mask band (turtles) keeps the liked style: white eyes with pupils over the band
  if (f.eye_mask) { const mc = hex(f.eye_mask); const mg = cylGrad(mc, 'h', 0.9); out.push({ def: mg.def }, `<path d="M111,74 L193,74 L193,96 L111,96 Z" fill="url(#${mg.id})"/>`);
    ex.forEach((x, i) => out.push(`<ellipse cx="${x}" cy="${ey}" rx="6.5" ry="5" fill="#fff"/><ellipse cx="${x + (i ? -1 : 1)}" cy="${ey}" rx="2.6" ry="3.2" fill="${K}"/><circle cx="${x + (i ? -1.8 : 0.2)}" cy="${ey - 1.3}" r="0.9" fill="#fff"/>`)); }
  else {
    // eyes: small black beans with a tiny white glint
    const big = (f.eye_size === 'large' ? 1.18 : 1) * (V === 5 ? 1.12 : 1); const ry = (expr === 'surprised' ? 5.4 : 4.8) * big, rx = 3.9 * big;
    const ec = f.eye_color && !/^#?(000|1b1b1b|000000|black|brown|#582a12)$/i.test(f.eye_color) ? hex(f.eye_color) : null;
    const wk = i => expr === 'wink' && i === 1; // winking eye: not drawn at all (no patch over the skin gradient)
    if (ec) ex.forEach((x, i) => wk(i) ? 0 : out.push(`<ellipse cx="${x}" cy="${ey}" rx="${rx + 0.4}" ry="${ry + 0.3}" fill="${K}"/><ellipse cx="${x}" cy="${ey + 0.5}" rx="${rx - 0.7}" ry="${ry - 0.9}" fill="${ec}"/><ellipse cx="${x}" cy="${ey + 0.7}" rx="1.5" ry="1.9" fill="${K}"/><circle cx="${x + (i ? -1.3 : 1.3)}" cy="${ey - 1.6}" r="1.2" fill="#fff"/>`));
    else ex.forEach((x, i) => wk(i) ? 0 : out.push(`<ellipse cx="${x}" cy="${ey}" rx="${rx}" ry="${ry}" fill="${K}"/><circle cx="${x + (i ? -1 : 1)}" cy="${ey - 1.6}" r="1.2" fill="#fff"/>`));
    if (fem && !f.no_lashes) ex.forEach((x, i) => { const s = i ? 1 : -1; out.push(`<path d="M${x + s * 3.4},${ey - 2.4} l${s * 3.6},-1.4 M${x + s * 2.8},${ey - 3.8} l${s * 3.4},-2.6 M${x + s * 1.2},${ey - 4.7} l${s * 2.2},-3.2" stroke="${K}" stroke-width="1.35" stroke-linecap="round"/>`); });
    if (f.age === 'old' || f.wrinkles) ex.forEach((x, i) => { const s = i ? 1 : -1; out.push(`<path d="M${x + s * 5},${ey - 1} q${s * 2},1.5 ${s * 1.6},3.5 M${x + s * 5.4},${ey + 2.6} q${s * 1.6},0.8 ${s * 1.4},2.6" stroke="${shadeInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`); });
    // brows: thin, short, slightly arched; expression changes angle
    if (f.brows !== false) { let bc = hex(f.brow_color, K); { const n = parseInt(bc.slice(1), 16), L = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; if (L > 0.38) bc = K; }
      const bw = (fem ? 1.1 : (f.brows_thick ? 2.4 : 1.7)) * (V === 5 ? 0.85 : 1);
      ex.forEach((x, i) => { const s = i ? 1 : -1; const y = ey - 7.5 + (V === 1 ? -1.6 : V === 2 ? 1.2 : 0) - (f.glasses && f.glasses !== 'none' && f.glasses !== 'sunglasses' ? 2.4 : 0);
        let d;
        if (expr === 'angry') d = `M${x - s * 1.5},${y + 2} L${x + s * 4.2},${y - 1.2}`;
        else if (expr === 'worried') d = `M${x - s * 3.4},${y - 1.6} Q${x},${y - 1.6} ${x + s * 3.6},${y + 1}`;
        else if (expr === 'surprised') d = `M${x - s * 3.6},${y - 0.6} Q${x},${y - 4.6} ${x + s * 3.6},${y - 0.6}`;
        else if (expr === 'smirk' && i === 1) d = `M${x - 3.6},${y - 1} Q${x},${y - 4} ${x + 3.6},${y - 1.6}`;
        else d = `M${x - s * 3.6},${y + 0.6} Q${x - s * 0.4},${y - 2.6} ${x + s * 3.8},${y + 0.2}`;
        out.push(`<g transform="translate(${x},${y - 2.5}) scale(1.45) translate(${-x},${-y})"><path d="${d}" stroke="${bc}" stroke-width="${bw}" fill="none" stroke-linecap="round"/></g>`); });
      if (expr === 'angry') ex.forEach((x, i) => out.push(`<path d="M${152 + (i ? 2.5 : -2.5)},${ey - 6} l${i ? 0.6 : -0.6},2.2" stroke="${shadeInk}" stroke-width="0.6" stroke-linecap="round"/>`)); }
  }
  if (expr === 'wink') out.push(`<path d="M${ex[1] - 4.5},${ey + 0.5} Q${ex[1]},${ey - 3.5} ${ex[1] + 4.5},${ey + 0.5}" stroke="${K}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  if ((f.nose && f.nose !== 'none') || V === 4) out.push(`<path d="M151,94 Q149.2,99.5 151.2,100.6 Q153,101.2 154.4,100.2" stroke="${shadeInk}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`);
  // freckles / blush / cheek lines
  if (f.freckles) [[133, 95], [136, 97], [131, 98], [134, 100], [168, 95], [171, 97], [173, 98], [170, 100]].forEach(([x, y]) => out.push(`<circle cx="${x}" cy="${y}" r="0.8" fill="${shadeInk}"/>`));
  if (f.cheeks) out.push(`<ellipse cx="132" cy="98" rx="3.6" ry="2.2" fill="${hex(f.cheeks, '#F2A0A0')}" opacity="0.5"/><ellipse cx="172" cy="98" rx="3.6" ry="2.2" fill="${hex(f.cheeks, '#F2A0A0')}" opacity="0.5"/>`);
  if (f.cheek_lines || f.dimples || f.age === 'old' || V === 3) out.push(`<path d="M140,101 q-1.6,3 -0.4,6 M164,101 q1.6,3 0.4,6" stroke="${shadeInk}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`);
  if (f.age === 'old' || f.forehead_wrinkles) out.push(`<path d="M144,${ey - 13} q8,-1.6 16,0 M146,${ey - 15.4} q6,-1.2 12,0" stroke="${shadeInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`);
  // facial hair (dark shades, LEGO-like)
  const bc = hex(f.beard_color, '#5A3A22');
  if (f.beard === 'stubble' || f.stubble) { let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let y = 99; y < 124; y += 1.8) for (let x = 128; x < 177; x += 1.8) { const dx = (x - 152) / 24, dy = (y - 104) / 20; if (dx * dx + dy * dy > 1 || (y < 112 && Math.abs(x - 152) < 9 && y > 101) ) continue; if (rnd() < 0.45) out.push(`<circle cx="${(x + rnd() - 0.5).toFixed(1)}" cy="${(y + rnd() - 0.5).toFixed(1)}" r="0.6" fill="${bc}" opacity="0.7"/>`); } }
  if (f.beard === 'full') out.push(`<path d="M128,98 Q129,122 152,126 Q175,122 176,98 Q171,112 162,113 Q152,110 142,113 Q133,112 128,98 Z" fill="${bc}"/>`);
  if (f.beard === 'goatee') out.push(`<path d="M146,113 Q152,123 158,113 Q152,115 146,113 Z" fill="${bc}"/>`);
  if (f.beard === 'mustache' || f.beard === 'full' || f.mustache) out.push(`<g transform="translate(152,101) scale(1.5) translate(-152,-103)"><path d="M142,104 Q147,100 152,102.4 Q157,100 162,104 Q157,105.6 152,104.2 Q147,105.6 142,104 Z" fill="${bc}"/></g>`);
  // mouth (small, LEGO style)
  const lips = f.lipstick ? hex(f.lipstick) : null; const softLip = fem && !lips && ['neutral', 'smile', 'smirk', 'pursed', 'serious'].includes(expr); const mY = 106;
  const mouth = { smile: `<path d="M145,${mY} Q152,${mY + 4.4} 159,${mY}" stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    grin: `<path d="M144,${mY - 1} Q152,${mY} 160,${mY - 1} Q159,${mY + 6} 152,${mY + 6.2} Q145,${mY + 6} 144,${mY - 1} Z" fill="${K}"/><path d="M145.4,${mY - 0.2} Q152,${mY + 0.8} 158.6,${mY - 0.2} L158,${mY + 1.8} Q152,${mY + 2.6} 146,${mY + 1.8} Z" fill="#fff"/>`,
    neutral: `<path d="M147,${mY + 1} Q152,${mY + 1.6} 157,${mY + 1}" stroke="${K}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
    smirk: `<path d="M146,${mY + 1.4} Q153,${mY + 2.4} 159,${mY - 1.2}" stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    angry: `<path d="M146,${mY + 2.6} Q152,${mY - 0.6} 158,${mY + 2.6}" stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    worried: `<path d="M146,${mY + 2} Q149,${mY} 152,${mY + 1.4} Q155,${mY + 2.6} 158,${mY + 0.6}" stroke="${K}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
    tongue: `<path d="M144.5,${mY - 0.6} Q152,${mY + 0.6} 159.5,${mY - 0.6} Q158.6,${mY + 5.4} 152,${mY + 5.6} Q145.4,${mY + 5.4} 144.5,${mY - 0.6} Z" fill="${K}"/><path d="M145.6,${mY - 0.1} Q152,${mY + 0.9} 158.4,${mY - 0.1} L157.9,${mY + 1.4} Q152,${mY + 2.1} 146.1,${mY + 1.4} Z" fill="#fff"/><path d="M147.6,${mY + 3} Q152,${mY + 1.8} 156.4,${mY + 3} L156.2,${mY + 7.4} Q152,${mY + 11.4} 147.8,${mY + 7.4} Z" fill="#E8506A" stroke="${K}" stroke-width="0.8"/><path d="M152,${mY + 4.2} L152,${mY + 8.2}" stroke="#B23A50" stroke-width="0.7"/>`,
    wink: `<path d="M145,${mY} Q152,${mY + 4.4} 159,${mY}" stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    surprised: `<ellipse cx="152" cy="${mY + 1.6}" rx="2.6" ry="3.2" fill="${K}"/>`,
    laugh: `<path d="M143,${mY - 2} Q152,${mY - 0.6} 161,${mY - 2} Q160,${mY + 8} 152,${mY + 8.2} Q144,${mY + 8} 143,${mY - 2} Z" fill="${K}"/><path d="M144.4,${mY - 1.2} Q152,${mY} 159.6,${mY - 1.2} L159,${mY + 1.2} Q152,${mY + 2} 145,${mY + 1.2} Z" fill="#fff"/><path d="M147,${mY + 6} Q152,${mY + 4} 157,${mY + 6} Q152,${mY + 7.6} 147,${mY + 6} Z" fill="#C8504A"/>` };
  const M0 = out.length;
  if (lips && !['grin', 'laugh', 'surprised', 'tongue'].includes(expr)) out.push(`<path transform="${expr === 'neutral' ? 'translate(152,' + mY + ') scale(0.82,0.75) translate(-152,' + (-mY) + ')' : ''}" d="M146,${mY + 0.4} Q149,${mY - 1.4} 152,${mY - 0.2} Q155,${mY - 1.4} 158,${mY + 0.4} Q155,${mY + 3.6} 152,${mY + 3.6} Q149,${mY + 3.6} 146,${mY + 0.4} Z" fill="${lips}"/><path d="M146.6,${mY + 0.6} Q152,${mY + (expr === 'neutral' ? 0.4 : 1.4)} 157.4,${mY + 0.6}" stroke="${K}" stroke-width="0.6" fill="none"/>`);
  else if (expr !== 'none') { out.push(mouth[expr] || mouth.smile); if (softLip) out.push(`<path d="M148,${mY + 1.6} Q152,${mY + 5.4} 156,${mY + 1.6} Q152,${mY + 2.6} 148,${mY + 1.6} Z" fill="#C9766A"/>`); }
  if (lips && ['grin', 'laugh'].includes(expr)) out.push(`<path d="M144,${mY - 1} Q152,${mY} 160,${mY - 1}" stroke="${lips}" stroke-width="0.9" fill="none"/>`);
  { const ms = out.splice(M0).join(''); out.push(`<g transform="translate(152,${mY}) scale(${+(1.7 * (V === 3 ? 1.12 : V === 4 ? 0.92 : 1)).toFixed(3)}) translate(-152,${-mY})">${ms}</g>`); }
  out.push(maskSvg(f));
  out.push(glassesSvg(f));
  return { defs: out.filter(o => o.def).map(o => o.def).join(''), svg: out.filter(o => typeof o === 'string').join('') };
}

function collarSvg(type, c) {
  if (!type || type === 'none') return '';
  const g = 'g' + (++gid), e = shade(c, 0.55);
  const grad = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shade(c, 0.7)}"/><stop offset="0.35" stop-color="${shade(c, 1.15)}"/><stop offset="1" stop-color="${shade(c, 0.65)}"/></linearGradient></defs>`;
  if (type === 'high' || type === 'turtleneck') return grad + `<path d="M116,128 L188,128 L192,146 Q152,154 112,146 Z" fill="url(#${g})" stroke="${e}" stroke-width="1"/>`;
  if (type === 'shirt') return grad + `<path d="M120,136 L152,150 L136,162 Z M184,136 L152,150 L168,162 Z" fill="url(#${g})" stroke="${e}" stroke-width="1"/>`;
  if (type === 'cape') return grad + `<path d="M108,138 L196,138 L200,150 Q152,158 104,150 Z" fill="url(#${g})" stroke="${e}" stroke-width="1"/>`;
  return '';
}
// ---------------- full figure ----------------
function renderSvg(spec) {
  gid = 0;
  const S = spec || {};
  const skin = hex(S.skin_color, LEGO.yellow), torsoC = hex(S.torso_color, LEGO.red), armC = hex(S.arm_color, torsoC), handC = hex(S.hand_color, skin);
  const legL = hex(S.leg_color, LEGO.black), hipC = hex(S.hip_color, legL),  legR = hex(S.leg_right_color, legL), hairC = hex(S.hair_color, LEGO.brown);
  const defs = []; const add = g => { defs.push(g.def); return `url(#${g.id})`; };
  const hair = hairSvg(S.hair_style || 'short', hairC, S.hair_secondary_color ? hex(S.hair_secondary_color) : null); defs.push(hair.defs);
  const face = faceSvg({ ...(S.face || {}), eye_mask: S.face?.eye_mask || hair.bandana || null }, skin); defs.push(face.defs);
  const hl = handSvg(66, 256, handC), hr = handSvg(238, 256, handC); defs.push(hl.def, hr.def);
  const H = G.head;
  const torsoBox = { x: 85, y: 137, w: 134, h: 126 }, legsBox = { x: 83, y: 262, w: 138, h: 131 };
  const torsoPrint = cleanSvg(S.torso_print_svg), legsPrint = cleanSvg(S.legs_print_svg);
  defs.push(`<clipPath id="ct"><path d="${G.torso}"/></clipPath><clipPath id="cl"><path d="${G.hips}"/><path d="${G.legL}"/><path d="${G.legR}"/></clipPath><clipPath id="ch"><rect x="${H.x}" y="${H.y}" width="${H.w}" height="${H.h}" rx="${H.r}"/></clipPath>
   <linearGradient id="tsh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.32"/><stop offset="0.14" stop-color="#000" stop-opacity="0.06"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="0.9" stop-color="#000" stop-opacity="0.16"/><stop offset="1" stop-color="#000" stop-opacity="0.34"/></linearGradient>
   <linearGradient id="tv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
   <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`);
  const edge = c => shade(c, 0.55);
  const body = `
  <ellipse cx="152" cy="396" rx="92" ry="9" fill="url(#shadow)"/>
  ${hair.back}
  <!-- legs -->
  <path d="${G.legL}" fill="${add(cylGrad(legL, 'h', 0.8))}" stroke="${edge(legL)}" stroke-width="1"/>
  <path d="${G.legR}" fill="${add(cylGrad(legR, 'h', 0.8))}" stroke="${edge(legR)}" stroke-width="1"/>
  <path d="M84,384 L146,384 M158,384 L221,384" stroke="${shade(legL, 0.7)}" stroke-width="1.2" opacity="0.7"/>
  <path d="${G.hips}" fill="${add(cylGrad(hipC, 'h', 0.6))}" stroke="${edge(hipC)}" stroke-width="1"/>
  <path d="M147,300 L147,318 L157,318 L157,300" fill="${shade(hipC, 0.5)}"/>
  <path d="M88,299 L216,299" stroke="${shade(hipC, 0.6)}" stroke-width="1.4"/>
  ${legsPrint ? `<g clip-path="url(#cl)"><svg x="${legsBox.x}" y="${legsBox.y}" width="${legsBox.w}" height="${legsBox.h}" viewBox="0 0 100 100" preserveAspectRatio="none">${legsPrint}</svg></g>` : ''}
  <!-- torso -->
  <path d="${G.torso}" fill="${torsoC}"/>
  ${torsoPrint ? `<g clip-path="url(#ct)"><svg x="${torsoBox.x}" y="${torsoBox.y}" width="${torsoBox.w}" height="${torsoBox.h}" viewBox="0 0 100 100" preserveAspectRatio="none">${torsoPrint}</svg></g>` : ''}
  ${S.torso_graphic_png && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(S.torso_graphic_png) ? (() => { const [x, y, w, h] = (S.torso_graphic_rect || [22, 14, 56, 62]).map(Number); return `<svg x="85" y="137" width="134" height="126" viewBox="0 0 100 100" preserveAspectRatio="none"><image href="${S.torso_graphic_png}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`; })() : ''}
  <path d="${G.torso}" fill="url(#tsh)"/><path d="${G.torso}" fill="url(#tv)"/>
  <path d="${G.torso}" fill="none" stroke="${edge(torsoC)}" stroke-width="1.2"/>
  <!-- neck + head -->
  <rect x="${G.neck.x}" y="${G.neck.y}" width="${G.neck.w}" height="${G.neck.h}" rx="3" fill="${add(cylGrad(skin, 'h', 0.9))}" stroke="${edge(skin)}" stroke-width="0.8"/>
  ${hair.hideStud ? '' : `<rect x="${G.stud.x}" y="${G.stud.y}" width="${G.stud.w}" height="${G.stud.h + 4}" rx="4" fill="${add(cylGrad(S.head_top_color ? hex(S.head_top_color) : (hair.bandana && S.hair_style === 'bandana_tails' ? skin : skin), 'h', 0.9))}" stroke="${edge(skin)}" stroke-width="0.8"/>`}
  <rect x="${H.x}" y="${H.y}" width="${H.w}" height="${H.h}" rx="${H.r}" fill="${add(cylGrad(skin, 'h', 1))}" stroke="${edge(skin)}" stroke-width="1"/>
  <g clip-path="url(#ch)"><g transform="translate(0,-4)">${face.svg}</g></g>
  <path d="M${H.x + 10},${H.y + 6} Q${H.x + 30},${H.y + 1} ${H.x + 50},${H.y + 3}" stroke="#fff" stroke-opacity="0.35" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${collarSvg(S.collar, S.collar_color ? hex(S.collar_color) : torsoC)}
  ${hair.front}
  <!-- arms + hands -->
  <path d="${G.armL}" fill="${add(cylGrad(armC, 'h', 0.9))}" stroke="${edge(armC)}" stroke-width="1"/>
  <path d="${G.armR}" fill="${add(cylGrad(armC, 'h', 0.9))}" stroke="${edge(armC)}" stroke-width="1"/>
  ${S.arm_print_svg ? '' : ''}
  ${hl.svg}${hr.svg}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-48 -6 400 412" width="1000" height="1030"><rect x="-48" y="-6" width="400" height="412" fill="#ffffff"/><defs>${defs.join('')}</defs>${body}</svg>`;
}
// transparent print textures for the 3D viewer (decals); same coordinate boxes as the 2D template
function textures(spec) {
  gid = 0; const S = spec || {}; const skin = hex(S.skin_color, LEGO.yellow); const torsoC = hex(S.torso_color, LEGO.red);
  const hair = hairSvg(S.hair_style || 'short', hex(S.hair_color, LEGO.brown));
  const f = faceSvg({ ...(S.face || {}), eye_mask: (S.face && S.face.eye_mask) || hair.bandana || null }, skin);
  const wrap = (vb, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1024" height="${Math.round(1024 * vb.split(' ')[3] / vb.split(' ')[2])}"><defs>${defs}</defs>${body}</svg>`;
  const tp = cleanSvg(S.torso_print_svg), lp = cleanSvg(S.legs_print_svg), bp = cleanSvg(S.torso_back_print_svg), hp = cleanSvg(S.hips_print_svg);
  const box100 = (x, y, w, h, inner) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 100 100" preserveAspectRatio="none">${inner}</svg>`;
  // photo graphic cut from the user's image (posterized PNG), placed in torso 0..100 coords
  let gr = '';
  if (S.torso_graphic_png && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(S.torso_graphic_png)) {
    const r = S.torso_graphic_rect || [22, 14, 56, 62]; const [x, y, w, h] = r.map(Number);
    gr = box100(85, 137, 134, 126, `<image href="${S.torso_graphic_png}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  // automatic official-style details (always applied, on top of the AI print)
  const fem = (S.face && S.face.gender === 'female');
  const sh = c => { const n = parseInt(hex(c).slice(1), 16); const f = (x) => Math.max(0, Math.round(x * 0.62)); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(x => x.toString(16).padStart(2, '0')).join(''); };
  const lineC = S.bare_torso ? sh(skin) : (parseInt(torsoC.slice(1), 16) < 0x333333 ? '#4a4a4a' : sh(torsoC));
  let auto = '';
  if (S.bare_torso) auto += `<rect x="0" y="0" width="100" height="100" fill="${skin}"/>`;
  const bsz = ['none', 'small', 'medium', 'large'].includes(S.bust_size) ? S.bust_size : (S.bust === 'prominent' ? 'large' : S.bust === 'subtle' ? 'medium' : 'medium');
  if (fem && !S.bare_torso && bsz !== 'none') { const hiC = shade(torsoC, 1.45), dk = shade(torsoC, 0.55), ink = lineC;
    // bust size -> print: large=anime, medium=shaded, small=faint classic; corset outfit overrides for medium/large
    const style = (S.outfit_corset && bsz !== 'small') ? 'corset' : bsz === 'large' ? 'anime' : bsz === 'medium' ? 'shaded' : 'classic';
    const CUR = (y = 44, d = 14, w = 1.6, c = ink, o = 1) => `<path d="M${50 - 22},${y - 3} Q${50 - 15},${y + d * 0.42} ${50 - 4},${y + 1} M${50 + 4},${y + 1} Q${50 + 15},${y + d * 0.42} ${50 + 22},${y - 3}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity="${o}"/>`;
    const BIG = `<path d="M22,44 Q24,58 37,58 Q46,58 49.5,50 M50.5,50 Q54,58 63,58 Q76,58 78,44" stroke="${dk}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
    const BIGSH = `<path d="M22,44 Q24,58 37,58 Q46,58 49.5,50 Q53,58 63,58 Q76,58 78,44 Q72,54 63,54 Q54,54 50,46 Q46,54 37,54 Q28,54 22,44 Z" fill="${dk}" opacity="0.4"/>`;
    const SH = `<path d="M28,41 Q35,52 46,46 Q36,48 28,41 Z M72,41 Q65,52 54,46 Q64,48 72,41 Z" fill="${dk}" opacity="0.55"/>`;
    const FOLDS = `<path d="M33,60 Q35,70 34,80 M67,60 Q65,70 66,80 M43,59 Q44,66 43.5,72 M57,59 Q56,66 56.5,72" stroke="${dk}" stroke-width="1" fill="none" stroke-linecap="round" opacity="0.7"/>`;
    let bp = '';
    if (style === 'classic') bp = CUR(44, 12, 1.5);
    else if (style === 'shaded') bp = SH + CUR(44, 12, 1.5);
    else if (style === 'corset') { bp = `<path d="M22,46 Q36,60 50,48 Q64,60 78,46 L76,112 L24,112 Z" fill="${dk}" opacity="0.45"/><path d="M22,46 Q36,60 50,48 Q64,60 78,46" stroke="${ink}" stroke-width="1.8" fill="none"/><path d="M33,55 Q34,82 36,110 M67,55 Q66,82 64,110" stroke="${ink}" stroke-width="1.1" fill="none" opacity="0.8"/>`;
      for (let y = 56; y < 106; y += 7) bp += `<path d="M46,${y} L54,${y + 5} M54,${y} L46,${y + 5}" stroke="${hiC}" stroke-width="1.1" opacity="0.9"/><circle cx="46" cy="${y}" r="0.9" fill="${hiC}"/><circle cx="54" cy="${y}" r="0.9" fill="${hiC}"/>`;
      bp += CUR(43, 10, 1.3, ink, 0.8); }
    else bp = BIGSH + BIG + `<path d="M49.6,41 Q50,45 50,49" stroke="${dk}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.8"/>` + FOLDS; // anime
    auto += `<g transform="translate(0,-11)"${bsz === 'small' ? ' opacity="0.45"' : ''}>${bp}</g>`; // bust sits high, near the armpit line (official LEGO female torsos)
  }
  else if (S.bare_torso) { const build = String(S.body_build || 'athletic').toLowerCase();
    const ATH = `<g fill="none" stroke="${lineC}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24,27 Q25,43 38,45 Q46,45.5 49,39 L49,26 Z M76,27 Q75,43 62,45 Q54,45.5 51,39 L51,26 Z" fill="${lineC}" fill-opacity="0.10" stroke="none"/>
    <path d="M40,46 L49,46 L49,81 Q44,82 40,79 Q38,62 40,46 Z M60,46 L51,46 L51,81 Q56,82 60,79 Q62,62 60,46 Z" fill="${lineC}" fill-opacity="0.07" stroke="none"/>
    <path d="M30,15 Q39,19 46.5,16.5 M53.5,16.5 Q61,19 70,15" stroke-width="1.1" opacity="0.8"/>
    <path d="M24,27 Q25,43 38,45 Q46,45.5 49,39 M76,27 Q75,43 62,45 Q54,45.5 51,39" stroke-width="1.5"/>
    <path d="M50,22 L50,40" stroke-width="0.9" opacity="0.7"/>
    <path d="M40,47 Q38,63 40.5,80 M60,47 Q62,63 59.5,80" stroke-width="1.2"/>
    <path d="M50,46 L50,83" stroke-width="1.2"/>
    <path d="M40.5,55 Q45,56.8 49,55 M51,55 Q55,56.8 59.5,55 M40,64 Q45,65.8 49,64 M51,64 Q55,65.8 60,64 M40.5,73 Q45,74.6 49,73 M51,73 Q55,74.6 59.5,73" stroke-width="1.1"/>
    <path d="M26,47 l6,2.6 M25.5,53 l6.5,2.6 M26,59 l6,2.6 M74,47 l-6,2.6 M74.5,53 l-6.5,2.6 M74,59 l-6,2.6" stroke-width="1" opacity="0.85"/>
    <path d="M30,68 Q35,80 44,90 M70,68 Q65,80 56,90" stroke-width="1.1" opacity="0.85"/>
  </g><circle cx="35" cy="39" r="1.5" fill="${lineC}" opacity="0.85"/><circle cx="65" cy="39" r="1.5" fill="${lineC}" opacity="0.85"/><ellipse cx="50" cy="87" rx="1.3" ry="1.8" fill="${lineC}"/>`;
    const SLIM = `<g fill="none" stroke="${lineC}" stroke-linecap="round"><path d="M30,15 Q39,19 46.5,16.5 M53.5,16.5 Q61,19 70,15" stroke-width="1" opacity="0.75"/><path d="M27,30 Q30,41 39,42.5 Q46,43 48.5,38 M73,30 Q70,41 61,42.5 Q54,43 51.5,38" stroke-width="1.2" opacity="0.85"/><path d="M50,46 L50,80" stroke-width="0.9" opacity="0.6"/><path d="M42,58 Q46,59.2 49,58 M51,58 Q54,59.2 58,58 M42,67 Q46,68.2 49,67 M51,67 Q54,68.2 58,67" stroke-width="0.8" opacity="0.55"/><path d="M33,74 Q37,83 44,90 M67,74 Q63,83 56,90" stroke-width="0.9" opacity="0.7"/></g><circle cx="35" cy="38.5" r="1.3" fill="${lineC}" opacity="0.8"/><circle cx="65" cy="38.5" r="1.3" fill="${lineC}" opacity="0.8"/><ellipse cx="50" cy="86" rx="1.2" ry="1.7" fill="${lineC}"/>`;
    const HEAVY = `<path d="M22,52 Q24,90 50,94 Q76,90 78,52 Q66,60 50,60 Q34,60 22,52 Z" fill="${lineC}" fill-opacity="0.08"/><g fill="none" stroke="${lineC}" stroke-linecap="round"><path d="M30,15 Q39,18 46.5,16.5 M53.5,16.5 Q61,18 70,15" stroke-width="0.9" opacity="0.6"/><path d="M22,30 Q22,47 36,49 Q45,50 49,44 M78,30 Q78,47 64,49 Q55,50 51,44" stroke-width="1.4"/><path d="M24,58 Q30,86 50,90 Q70,86 76,58" stroke-width="1.3" opacity="0.85"/><path d="M28,64 Q33,70 38,72 M72,64 Q67,70 62,72" stroke-width="0.9" opacity="0.6"/></g><circle cx="34" cy="42" r="1.5" fill="${lineC}" opacity="0.85"/><circle cx="66" cy="42" r="1.5" fill="${lineC}" opacity="0.85"/><ellipse cx="50" cy="76" rx="1.5" ry="2" fill="${lineC}"/>`;
    auto += /heavy|chubby|fat|stocky|round|plump|big belly/.test(build) ? HEAVY : /slim|thin|skinny|lean|slender/.test(build) ? SLIM : ATH;
    if (S.chest_hair === true || S.chest_hair === 'true' || /light|medium|heavy/.test(String(S.chest_hair || ''))) { const hc = hex(S.chest_hair_color || S.hair_color, '#3A2A20'); let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280; let hs = '';
      const n = /heavy/.test(String(S.chest_hair)) ? 70 : /light/.test(String(S.chest_hair)) ? 24 : 44;
      for (let k = 0; k < n; k++) { const t = rnd(), x = 50 + (rnd() - 0.5) * (t < 0.55 ? 26 : 6), y = t < 0.55 ? 28 + rnd() * 16 : 46 + rnd() * 40; const ang = (rnd() - 0.5) * 1.4; hs += `<path d="M${x.toFixed(1)},${y.toFixed(1)} l${(Math.sin(ang) * 2.2).toFixed(2)},${(Math.cos(ang) * 2.2).toFixed(2)}" />`; }
      auto += `<g stroke="${hc}" stroke-width="0.7" stroke-linecap="round" opacity="0.8">${hs}</g>`; }
  }
  // layered outfit: open shirt/jacket over an undershirt => outer panels on the sides, undershirt visible in the centre
  const LY = S.layers && typeof S.layers === 'object' && S.layers.outer ? S.layers : null;
  const patFill = (o, id) => { const pc = hex(o.pattern_color, '#F4F4F4'), pt = String(o.pattern || 'plain').toLowerCase();
    if (/stripe|смуг/.test(pt)) return `<pattern id="${id}" width="7" height="100" patternUnits="userSpaceOnUse"><rect width="7" height="100" fill="${hex(o.color, '#1b1b1b')}"/><rect x="0" width="2.6" height="100" fill="${pc}"/></pattern>`;
    if (/check|plaid|клітин/.test(pt)) return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${hex(o.color, '#1b1b1b')}"/><rect width="10" height="3" fill="${pc}" opacity="0.6"/><rect width="3" height="10" fill="${pc}" opacity="0.6"/></pattern>`;
    return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${hex(o.color, '#1b1b1b')}"/></pattern>`; };
  let layerSvg = '';
  if (LY && !S.bare_torso) { const o = LY.outer, u = LY.under || {}, uc = hex(u.color, skin), ol = '#1b1b1b';
    layerSvg = `<defs>${patFill(o, 'lyo')}</defs><rect x="0" y="0" width="100" height="100" fill="url(#lyo)"/>`
      + `<path d="M37,0 L63,0 L66,100 L34,100 Z" fill="${uc}"/>` + (/tee|t-shirt|футб/.test(String(u.type || 'tee')) ? `<path d="M40,0 Q50,9 60,0" fill="none" stroke="${shade(uc, 0.8)}" stroke-width="1.6"/>` : '')
      + `<path d="M37,0 L34,100 M63,0 L66,100" stroke="${ol}" stroke-width="1.1" opacity="0.75"/>`
      + `<path d="M24,0 L37,0 L41,22 L33,15 Z M76,0 L63,0 L59,22 L67,15 Z" fill="url(#lyo)" stroke="${ol}" stroke-width="0.9"/>`; }
  const autoTop = S.bare_torso && tp ? '' : '';
  const torsoInner = (S.bare_torso ? auto + (tp || '') : layerSvg ? layerSvg + auto : (tp || '') + auto);
  // short sleeves: shirt colour on the upper arm, skin on the lower arm
  let armP = cleanSvg(S.arm_print_svg) || '';
  if (S.sleeves === 'short' || S.sleeves === 'none') armP += `<rect x="0" y="${S.sleeves === 'none' ? 0 : 46}" width="100" height="${S.sleeves === 'none' ? 100 : 54}" fill="${skin}"/>` + (S.sleeves === 'short' ? `<rect x="0" y="42" width="100" height="4" fill="${sh(hex(S.arm_color, torsoC))}"/>` : '');
  if (LY && S.sleeves === 'short') armP += `<defs>${patFill(LY.outer, 'lya')}</defs><rect x="0" y="0" width="100" height="42" fill="url(#lya)"/>`;
  // belt with buckle on the hips
  // footwear printed from the spec (always, on top of the AI leg print) — legs box: legs y 29..100, left leg x 0..46, right x 54..100
  let feet = ''; { const fw = S.footwear && typeof S.footwear === 'object' ? S.footwear : null, ty = String(fw?.type || '').toLowerCase();
    if (fw && ty && !/barefoot|none/.test(ty)) { const c = hex(fw.color, '#1b1b1b'), so = hex(fw.sole_color || fw.color, '#1b1b1b'), st = hex(fw.strap_color || fw.color, c), s2 = fw.secondary_color ? hex(fw.secondary_color) : null;
      for (const x0 of [0, 54]) { const w = 46;
        if (/flip|slipper|thong|в'єтнам|шльоп/.test(ty)) { const ol = '#1b1b1b'; // sole in the main colour + strap with a dark outline so it reads on skin
          feet += `<rect x="${x0}" y="94.5" width="${w}" height="5.5" fill="${c}"/><rect x="${x0}" y="94.5" width="${w}" height="1.2" fill="${so}"/><rect x="${x0 + 3}" y="90.6" width="${w - 6}" height="3.8" fill="${ol}"/><rect x="${x0 + 3.6}" y="91.2" width="${(w - 7.2) * (s2 ? 0.55 : 1)}" height="2.6" fill="${st}"/>` + (s2 ? `<rect x="${x0 + 3.6 + (w - 7.2) * 0.55}" y="91.2" width="${(w - 7.2) * 0.45}" height="2.6" fill="${s2}"/>` : ''); }
        else if (/sandal/.test(ty)) feet += `<rect x="${x0}" y="96" width="${w}" height="4" fill="${so}"/><rect x="${x0}" y="91" width="${w}" height="2.2" fill="${st}"/><rect x="${x0}" y="87" width="${w}" height="2" fill="${st}"/>`;
        else if (/boot/.test(ty) && fw.height !== 'low') feet += `<rect x="${x0}" y="70" width="${w}" height="30" fill="${c}"/><rect x="${x0}" y="70" width="${w}" height="2.5" fill="${s2 || shade(c, 0.7)}"/><rect x="${x0}" y="96" width="${w}" height="4" fill="${so}"/>`;
        else feet += `<rect x="${x0}" y="86" width="${w}" height="14" fill="${c}"/><rect x="${x0}" y="96.5" width="${w}" height="3.5" fill="${so === c ? '#F4F4F4' : so}"/>` + (s2 ? `<path d="M${x0 + 8},90 L${x0 + w - 8},90" stroke="${s2}" stroke-width="2"/>` : '') + (/sneak|trainer|кросів/.test(ty) ? `<path d="M${x0 + 14},88 l4,3 M${x0 + 20},88 l4,3 M${x0 + 26},88 l4,3" stroke="${s2 || '#F4F4F4'}" stroke-width="1"/>` : '');
      } } }
  let hipAuto = '';
  if (S.belt) { const bc = hex(S.belt.color || S.belt_color, '#582A12'), kc = hex(S.belt.buckle_color, '#898788'); hipAuto = `<rect x="0" y="4" width="100" height="22" fill="${bc}"/><rect x="40" y="2" width="20" height="26" rx="3" fill="none" stroke="${kc}" stroke-width="4"/><rect x="48" y="8" width="4" height="14" fill="${kc}"/>`; }
  const bald = !S.hair_style || /^(none|bald)$/.test(S.hair_style);
  const baldShade = bald ? `<radialGradient id="bs"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` : '';
  return {
    face: wrap('111 47 82 86', f.svg + (bald ? '<ellipse cx="152" cy="50" rx="30" ry="7" fill="url(#bs)"/><path d="M121,52 Q152,44 183,52" stroke="#000" stroke-opacity="0.07" stroke-width="2" fill="none"/>' : ''), f.defs + baldShade),
    torso: (torsoInner || gr || S.collar) ? wrap('85 137 134 126', `${torsoInner ? box100(85, 137, 134, 126, torsoInner) : ''}${gr}${collarSvg(S.collar, S.collar_color ? hex(S.collar_color) : torsoC)}`) : null,
    glasses: (S.face && S.face.glasses && S.face.glasses !== 'none' && !S.head_glasses_printed) ? wrap('111 47 82 86', glassesSvg(S.face)) : null,
    arms_mirror: armP ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" preserveAspectRatio="none"><g transform="translate(100,0) scale(-1,1)">${armP}</g></svg>` : null,
    torso2: cleanSvg(S.torso2_print_svg) ? wrap('85 137 134 126', box100(85, 137, 134, 126, cleanSvg(S.torso2_print_svg))) : null,
    torso2_back: cleanSvg(S.torso2_back_print_svg) ? wrap('85 137 134 126', box100(85, 137, 134, 126, cleanSvg(S.torso2_back_print_svg))) : null,
    arms: armP ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" preserveAspectRatio="none">${armP}</svg>` : null,
    torso_back: bp ? wrap('85 137 134 126', box100(85, 137, 134, 126, bp)) : null,
    legs: (lp || hp || hipAuto || feet) ? wrap('83 262 138 131', `${lp ? box100(83, 262, 138, 131, lp) : ''}${feet ? box100(83, 262, 138, 131, feet) : ''}${hp ? box100(83, 262, 138, 38, hp) : ''}${hipAuto ? box100(83, 262, 138, 38, hipAuto) : ''}`) : null,
  };
}
// standalone head thumbnail (SVG string) from a face spec — the same face renderer as the figure; used when no bitmap thumbnail is available
function headThumbSvg(face, skin) {
  gid = 0; const sk = hex(skin, LEGO.yellow), f = faceSvg(face || {}, sk), g = cylGrad(sk, 'h', 1), H = G.head;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 24 112 112" width="112" height="112"><defs>${g.def}${f.defs}<clipPath id="chh"><rect x="${H.x}" y="${H.y}" width="${H.w}" height="${H.h}" rx="${H.r}"/></clipPath></defs>`
    + `<rect x="${G.stud.x}" y="${G.stud.y}" width="${G.stud.w}" height="${G.stud.h + 4}" rx="4" fill="url(#${g.id})" stroke="${shade(sk, 0.55)}"/><rect x="${H.x}" y="${H.y}" width="${H.w}" height="${H.h}" rx="${H.r}" fill="url(#${g.id})" stroke="${shade(sk, 0.55)}" stroke-width="1"/>`
    + `<g clip-path="url(#chh)"><g transform="translate(0,-4)">${f.svg}</g></g></svg>`;
}
function renderPng(spec, width = 1024) {
  const svg = renderSvg(spec);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff', font: { loadSystemFonts: true } }).render().asPng();
  return { png: Buffer.from(png), svg };
}
module.exports = { headThumbSvg, renderSvg, renderPng, textures, LEGO, hex, cleanSvg };
