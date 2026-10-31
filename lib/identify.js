// Ідентифікація персонажа ДО опису: Gemini + Google Search (grounding) → хто це, звідки, канонічні риси
// (матеріал, кольори, фірмові предмети). Плюс загальні правила кольору/одягу/матеріалу для специфікації.
// Pure helpers are unit-tested in tests/identify.test.js (grounding mocked).
const isHex = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const rgb = h => { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.sqrt((x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11) / 255; };
const LEGO_YELLOW = '#F2CD37';
// LEGO body/skin palette (real colours) incl. wood/earth tones so a wooden subject is not snapped to yellow
const BODY_PAL = ['#F2CD37', '#F6D7B3', '#D09168', '#AA7D55', '#CC702A', '#7C503A', '#352100', '#582A12', '#E4CD9E', '#958A73', '#DCBC81', '#A0A5A9', '#6C6E68', '#1b1b1b', '#F4F4F4', '#4B9F4A', '#237841', '#0055BF', '#5A93DB', '#C91A09', '#720E0F', '#FE8A18', '#C870A0', '#E4ADC8', '#008F9B'];
const snap = (h, pal = BODY_PAL) => { if (!isHex(h)) return h; let b = pal[0], bd = 9; for (const c of pal) { const d = dist(h, c); if (d < bd) { bd = d; b = c; } } return b; };

const ID_PROMPT = hint => `You are a character/meme identification expert. Like a reverse image search, decide WHO or WHAT the subject in the image is: a fictional character, mascot, internet meme / viral character (e.g. "Italian brainrot" AI characters, TikTok memes), game/anime/cartoon character, toy, or a famous real person. Use Google Search if available to confirm the name and its canonical look.
Hint from earlier analysis (may be wrong): ${String(hint || '').slice(0, 600)}
Return ONLY JSON (no markdown):
{"is_known_character":bool,"confidence":0-1,"character_name":"","identity":"name (franchise/origin)","franchise":"","origin":"where it comes from, e.g. 'Italian brainrot TikTok meme, 2025'","medium":"animated|live-action|game|comic|meme|photo|toy","subject_kind":"human|animal|creature|object_creature|figurine|object","is_humanoid":bool,
"traits":{"material":"body material if not skin, e.g. wood, metal, slime, plush; else null","texture":"e.g. wood grain, fur, scales or null","body_color_hex":"#rrggbb dominant body colour of THIS subject","body_color_name":"","colors":["#hex main colours"],"signature_props":["held/signature objects, e.g. wooden club"],"wears_clothing":bool,"clothing":"what it actually wears or 'none'","defining_features":["3-6 short canonical traits"]},
"fandom_wiki":"fandom.com subdomain or null","fandom_wiki_alternatives":[],"wikipedia_title":"English Wikipedia title or null","has_official_lego_minifig":bool,"search_terms_en":["2-4 English queries to find similar LEGO minifigs by traits, e.g. 'caveman club', 'wood'"],"is_real_photo_of_real_person":bool}`;

// gem(models, body, opts) is the server's Gemini caller. Grounded call first; fallback to the plain vision call.
async function identifyCharacter({ gem, models, image, mime, hint, log = () => {}, txt, parseJSON }) {
  const parts = [{ inline_data: { mime_type: mime || 'image/jpeg', data: image } }, { text: ID_PROMPT(hint) }];
  const tries = [
    { grounded: true, body: { contents: [{ parts }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } } },
    { grounded: false, body: { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } } }];
  for (const t of tries) {
    try {
      const j = await gem(models, t.body, { timeout: 25000, budget: 35000 });
      const o = parseJSON(txt(j)); const id = Array.isArray(o) ? o[0] || {} : o || {};
      const gm = j.candidates?.[0]?.groundingMetadata;
      id.grounded = t.grounded && !!gm; id.sources = (gm?.groundingChunks || []).map(c => c.web && { title: c.web.title, url: c.web.uri }).filter(Boolean).slice(0, 5);
      return normalizeIdentity(id);
    } catch (e) { if (e.quota && !t.grounded) throw e; log('identify ' + (t.grounded ? 'grounded' : 'plain') + ' fail', e.message); }
  }
  return null;
}
function normalizeIdentity(id) {
  id = id && typeof id === 'object' ? id : {};
  id.traits = id.traits && typeof id.traits === 'object' ? id.traits : {};
  const tr = id.traits;
  if (!isHex(tr.body_color_hex)) tr.body_color_hex = null;
  tr.colors = (Array.isArray(tr.colors) ? tr.colors : []).filter(isHex);
  tr.signature_props = (Array.isArray(tr.signature_props) ? tr.signature_props : []).map(String).slice(0, 4);
  tr.defining_features = (Array.isArray(tr.defining_features) ? tr.defining_features : []).map(String).slice(0, 8);
  if (+id.confidence < 0.45) id.is_known_character = false;
  id.is_known_character = !!id.is_known_character;
  return id;
}

// Dominant colour of the subject region: centre 50% of the crop, cluster pixels, drop near-white/near-black background
async function dominantColor(b64, sharp = require('sharp')) {
  try {
    const buf = Buffer.from(b64, 'base64'); const m = await sharp(buf).metadata();
    const w = Math.round(m.width * 0.5), h = Math.round(m.height * 0.6);
    const { data } = await sharp(buf).extract({ left: Math.round((m.width - w) / 2), top: Math.round((m.height - h) / 2), width: w, height: h }).resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return dominantFromPixels(data);
  } catch { return null; }
}
function dominantFromPixels(data) {
  const bins = new Map();
  for (let i = 0; i + 2 < data.length; i += 3) { const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 235 && mn > 220) continue; if (mx < 25) continue; // background white / deep shadow
    const k = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5); const o = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; o.n++; o.r += r; o.g += g; o.b += b; bins.set(k, o); }
  let best = null; for (const o of bins.values()) if (!best || o.n > best.n) best = o;
  return best ? hex([best.r / best.n, best.g / best.n, best.b / best.n]) : null;
}

// ---- prop → closest LEGO accessory ----
const PROP_MAP = [
  [/club|bat\b|baseball bat|cudgel|mace|truncheon|baton|log|stick|дубин|бит[аи]|палиц|кийок/i, { type: 'club' }],
  [/sword|katana|sabre|saber|blade|меч|катан/i, { type: 'sword', kind: 'long' }],
  [/shield|щит/i, { type: 'shield', shape: 'round' }],
  [/headphone|навушн/i, { type: 'headphones' }],
  [/backpack|рюкзак/i, { type: 'backpack' }],
  [/bag|purse|сумк/i, { type: 'bag', style: 'held' }]];
function mapProp(name, color) { const s = String(name || ''); for (const [re, a] of PROP_MAP) if (re.test(s)) { const o = { ...a, from: s }; if (o.type === 'club') { o.color = isHex(color) ? color : /wood|дерев/i.test(s) ? '#7C503A' : '#582A12'; o.kind = /baseball|bat\b|бит/i.test(s) ? 'bat' : 'club'; } return o; } return null; }

const WOOD = /wood|timber|log|bark|дерев|колод/i;
// General identity/colour/clothing rules applied to the spec (after generation and after verification)
function applyIdentityRules(sp, id, { photoColor = null, desc = null } = {}) {
  if (!sp || typeof sp !== 'object') return sp;
  const qa = (sp._qa = sp._qa || []); const note = m => { if (!qa.includes(m)) qa.push(m); };
  const tr = (id && id.traits) || {};
  const nonHuman = !!id && (/creature|object|figurine|animal/i.test(String(id.subject_kind || '')) || (!!tr.material && !/skin|flesh/i.test(tr.material)));
  // 1. body colour: canonical traits > sampled photo colour > model's choice; never default LEGO yellow for a non-yellow subject
  let body = tr.body_color_hex || null;
  if (!body && photoColor && nonHuman) body = photoColor;
  if (body) { body = snap(body);
    const subjectYellow = dist(body, LEGO_YELLOW) < 0.08;
    if (!subjectYellow && (!isHex(sp.skin_color) || dist(sp.skin_color, LEGO_YELLOW) < 0.08 || (nonHuman && dist(sp.skin_color, body) > 0.12))) {
      const old = sp.skin_color; sp.skin_color = body; if (!sp.hand_color || sp.hand_color === old || sp.hands_are_gloves !== true) sp.hand_color = body;
      if (!sp.arm_color || sp.arm_color === old) sp.arm_color = body; note(`колір тіла взято з ${tr.body_color_hex ? 'канонічних рис персонажа' : 'фото'} (${body}), а не жовтий LEGO`); } }
  // 2. no invented clothing for non-human creatures that wear nothing
  const naked = nonHuman && (tr.wears_clothing === false || /^(none|no|нема)/i.test(String(tr.clothing || '')));
  if (naked && isHex(sp.skin_color)) {
    if (sp.leg_color !== sp.skin_color || sp.torso_color !== sp.skin_color) note('персонаж без одягу — тулуб і ноги кольору тіла (вигадані шорти/футболку прибрано)');
    sp.torso_color = sp.skin_color; sp.arm_color = sp.skin_color; sp.leg_color = sp.skin_color; sp.hips_color = sp.skin_color; sp.sleeves = 'none'; sp.bare_torso = true;
    if (sp.legs_type && sp.legs_type !== 'standard') sp.legs_type = 'standard'; sp.layers = null; delete sp.skirt_color; }
  // 3. material/texture → print notes (wood grain etc.)
  const mat = [tr.material, tr.texture].filter(Boolean).join(', ');
  if (mat && !/^(skin|flesh|none)$/i.test(mat)) { sp.material_print = mat;
    if (WOOD.test(mat) && isHex(sp.skin_color)) { const dark = hex(rgb(sp.skin_color).map(v => v * 0.68));
      const grain = `<path data-grain='1' d='M30,0 Q26,50 32,100 M50,0 Q54,50 48,100 M70,0 Q66,50 71,100' fill='none' stroke='${dark}' stroke-width='1.4' opacity='0.7'/>`;
      for (const k of ['torso_print_svg', 'legs_print_svg']) if (!/data-grain/.test(sp[k] || '')) sp[k] = (typeof sp[k] === 'string' && !naked ? sp[k] : '') + grain;
      if (!/data-grain/.test(sp.arm_print_svg || '')) sp.arm_print_svg = grain; }
    sp.notes_uk = [sp.notes_uk, 'Матеріал: ' + mat + ' — передано принтом.'].filter(Boolean).join(' ');
    note('матеріал «' + mat + '» → принт'); }
  // 4. signature props → closest LEGO accessory
  const acc = Array.isArray(sp.accessories_3d) ? sp.accessories_3d : [];
  for (const p of tr.signature_props || []) { const a = mapProp(p, WOOD.test(p) ? snap(tr.body_color_hex || sp.skin_color || '#7C503A') : null); if (a && !acc.some(x => x && x.type === a.type)) { acc.push(a); note(`фірмовий предмет «${p}» → LEGO ${a.type}`); } }
  sp.accessories_3d = acc;
  if (id && id.is_known_character) { sp.identity = sp.identity || id.identity; sp.identity_traits = tr.defining_features; }
  void desc; return sp;
}

// Similar-figure search: plain message when the identified character has no official minifig; trait-based ranking boost
function noOfficialMessage(id) { if (!id || !id.is_known_character || id.has_official_lego_minifig) return null;
  return `Офіційної LEGO-мініфігурки «${id.character_name || id.identity}» не існує. Нижче — найближчі за рисами (${[id.traits?.material, ...(id.traits?.signature_props || [])].filter(Boolean).join(', ') || 'загальний вигляд'}), а не випадкові фігурки.`; }
function traitScore(id, name, cat) { if (!id || !id.traits) return { sc: 0, m: [] }; const t = (String(name) + ' ' + String(cat || '')).toLowerCase(); const m = []; let sc = 0;
  const words = [id.traits.material, id.traits.texture, ...(id.traits.signature_props || []), ...(id.search_terms_en || [])].join(' ').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !/with|wooden|that|from|holding/.test(w));
  const mat = String(id.traits.material || '').toLowerCase();
  if (mat && /wood/.test(mat) && /wood|tree|ent\b|groot|log|timber|bark/.test(t)) { sc += 4; m.push('дерево'); }
  for (const w of new Set(words)) if (t.includes(w)) { sc += 2; m.push(w); }
  if ((id.traits.signature_props || []).some(p => /club|bat|stick|cudgel/i.test(p)) && /club|bat|caveman|troll|ogre|baseball/.test(t)) { sc += 3; m.push('дубина/бита'); }
  return { sc, m: [...new Set(m)] }; }

module.exports = { identifyCharacter, normalizeIdentity, dominantColor, dominantFromPixels, applyIdentityRules, mapProp, noOfficialMessage, traitScore, snap, ID_PROMPT, LEGO_YELLOW };
