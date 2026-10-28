import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { headMeshes } from '/heads_lib.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';

const $ = id => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
{ const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'); const gr = g.createRadialGradient(256, 200, 20, 256, 260, 420); gr.addColorStop(0, '#3a4258'); gr.addColorStop(0.55, '#1c2130'); gr.addColorStop(1, '#0b0d13'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t; }
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.target.set(0, 0, 0); controls.addEventListener('change', () => wake(400));
const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(-80, 160, 140); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 600 }); key.shadow.radius = 6; key.shadow.bias = -0.0005;
scene.add(key); const fill = new THREE.DirectionalLight('#ffffff', 0.5); fill.position.set(120, 40, 60); scene.add(fill);
scene.add(new THREE.HemisphereLight('#ffffff', '#dddddd', 0.35));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShadowMaterial({ opacity: 0.16 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// idle rendering: draw only while something moves (two WebGL canvases + a 2048px shadow map used to be redrawn 60x/s forever)
let until = performance.now() + 4000; const wake = (ms = 3000) => { until = Math.max(until, performance.now() + ms); }; // keep drawing for a few seconds after anything changes (late textures / decals)
function resize() { wake(); const w = canvas.parentElement.clientWidth || innerWidth, h = canvas.parentElement.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const params = new URLSearchParams(location.search);
async function getSpec() {
  if (window.MINIFIG_SPEC) return window.MINIFIG_SPEC;
  const id = params.get('id'); if (!id) return {};
  return (await fetch('/out/' + id + '.json')).json();
}
const loader = new LDrawLoader(); loader.smoothNormals = true; loader.setConditionalLineMaterial(LDrawConditionalLineMaterial); loader.setPartsLibraryPath('/ldraw/lib/');
const headLoader = new LDrawLoader(); headLoader.smoothNormals = true; headLoader.setConditionalLineMaterial(LDrawConditionalLineMaterial); headLoader.setPartsLibraryPath('/ldraw/lib/');
const headMatsReady = headLoader.preloadMaterials('/ldraw/lib/ldconfig.ldr').catch(e => console.error('ldconfig', e));
// printed official heads: parse() keeps the LDConfig colours (load() would reset them)
const loadPrintedHead = async name => { await headMatsReady; const txt = await (await fetch('/ldraw/lib/parts/' + name + '.dat')).text(); return new Promise((res, rej) => headLoader.parse(txt, res, rej)); };
const loadPart = name => new Promise((res, rej) => loader.load('/ldraw/lib/parts/' + name + '.dat', res, undefined, rej));

function plastic(hex, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex || '#cccccc'), roughness: 0.32, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.18, side: THREE.DoubleSide, ...opts });
}
// merge all meshes of an LDraw group (in group space) into one mesh with our material; drop edge lines
function toMesh(group, mat, smooth) {
  group.updateMatrixWorld(true); const geos = [];
  group.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); g.clearGroups(); geos.push(g.index ? g.toNonIndexed() : g); } });
  let merged = mergeGeometries(geos, false);
  if (smooth) { merged.deleteAttribute('normal'); merged = mergeVertices(merged, 1e-3); merged.computeVertexNormals(); }
  const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
// gold / silver print regions => metalness map (real LEGO metallic inks: Pearl Gold, Flat/Metallic Silver)
const METAL = [[220, 188, 129], [192, 196, 200], [137, 135, 136], [160, 165, 169], [204, 167, 74], [170, 127, 46]];
function metalMap(src) { const w = src.width, h = src.height, ctx = src.getContext('2d'); const d = ctx.getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const o = x.createImageData(w, h); let n = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; let m = 0; if (d[i + 3] > 40) for (const [R, G, B] of METAL) if (Math.abs(r - R) + Math.abs(g - G) + Math.abs(b - B) < 46) { m = 1; break; }
    o.data[i] = 0; o.data[i + 1] = m ? 70 : 82; o.data[i + 2] = m ? 255 : 0; o.data[i + 3] = 255; n += m; }
  if (n < 30) return null; x.putImageData(o, 0, 0); const t = new THREE.CanvasTexture(c); return t; }
const HAIR_SPLIT_Z = +(new URLSearchParams(location.search).get('hsplit') || -2);
function svgTexture(svg, w = 1024, h = 1024) {
  return new Promise(res => { if (!svg) return res(null); const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.metal = metalMap(c); res(t); };
    img.onerror = () => res(null); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
}
// mirror a (non-indexed) geometry across x=0 keeping correct winding + normals
function mirrorX(src) { const g = new THREE.BufferGeometry(); for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k].clone());
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  for (let i = 0; i < P.count; i++) { P.setX(i, -P.getX(i)); if (N) N.setX(i, -N.getX(i)); }
  for (const A of [P, N, U].filter(Boolean)) for (let t = 0; t + 2 < A.count; t += 3) for (let c = 0; c < A.itemSize; c++) { const a = A.array[(t + 1) * A.itemSize + c]; A.array[(t + 1) * A.itemSize + c] = A.array[(t + 2) * A.itemSize + c]; A.array[(t + 2) * A.itemSize + c] = a; }
  return g; }
// keep only triangles whose normal faces the projection side (|dot| dominant) so the 4 arm decals never overlap
// (overlapping transparent decals get re-sorted per frame => the print 'changed' while rotating)
function facingOnly(g, dir) { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) { nn.set(0, 0, 0); for (let j = 0; j < 3; j++) nn.add(a.fromBufferAttribute(n, i + j)); nn.normalize();
    const d = nn.dot(dir), side = Math.abs(nn.x * dir.z - nn.z * dir.x); if (d > 0 && d >= side - 1e-4) keep.push(i); }
  const P = new Float32Array(keep.length * 9), N = new Float32Array(keep.length * 9), U = new Float32Array(keep.length * 6);
  keep.forEach((i, k) => { for (let j = 0; j < 3; j++) { for (let t = 0; t < 3; t++) { P[k * 9 + j * 3 + t] = p.array[(i + j) * 3 + t]; N[k * 9 + j * 3 + t] = n.array[(i + j) * 3 + t]; } U[k * 6 + j * 2] = uv.array[(i + j) * 2]; U[k * 6 + j * 2 + 1] = uv.array[(i + j) * 2 + 1]; } });
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(null); return g; }
function decal(mesh, tex, center, size, rotY = 0) {
  if (!tex) return null;
  const g = new DecalGeometry(mesh, center, new THREE.Euler(0, rotY, 0), size);
  const mt = tex.userData && tex.userData.metal; const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1, metalness: mt ? 1 : 0, ...(mt ? { metalnessMap: mt, roughnessMap: mt } : { roughness: 0.32 }), clearcoat: 0.55, clearcoatRoughness: 0.18 }));
  (mesh.userData.decals = mesh.userData.decals || []).push(m);
  m.renderOrder = 2; return m;
}

// part placement in LDraw units (y down). Torso origin = neck top.
const HAIR = { short_side: '20877', bob: '29633', mid_length: '2632', long_straight: '12890', long_wavy: '11255', long_bangs: '3850', ponytail_side: '15427', side_braid: '13750', twin_tails: '20596', pigtails_braided: '13784', bun_fringe: '25613', bun_low_fringe: '87990+99240', bun_low_bangs_long: '2633', bun_high: '27186', short: '3901', long: '92083', ponytail: '13785', bun: '99240', spiky: '98385', curly: '87995', cap: '3624', hood: '30381', helmet_knight: '3844', helmet: '3844', none: null, bald: null, bandana_tails: null };
// headgear library: [part, 'main'|'second'] — worn instead of hair
const HEADGEAR = { none: [], cap: [['86035']], cap_long: [['4485b']], baseball_cap: [['93219']], cap_classic: [['3624']], cap_headphones: [['11303c01']],
  helmet_knight: [['3844']], helmet_castle: [['3896']], helmet_space: [['3842b']], helmet_motorcycle: [['15851']], helmet_construction: [['16175']], helmet_police: [['13789']], helmet_pilot: [['30370']],
  aviator_goggles: [['30171b'], ['30170b', 'second']], fedora: [['13565']], cowboy: [['15424']], wizard: [['17349']], newsboy: [['2514']], top_hat: [['101777']], beanie: [['10164']],
  hood: [['30381']], hood_fur: [['30287']], cowl: [['4505a']], bandana: [['30133']], ninja_wrap: [['24496']] };
const HEADMOLD = { standard: null, turtle: '12607', snake: '18955' };
// neck / torso accessories (placed at torso origin)
const NECKACC = { none: null, cape: '4524', armor_breastplate: '2587', shoulder_pads: '11097', life_vest: '97895', life_vest_classic: '2610', life_jacket: '97895', vest: '3840', epaulettes: '2526', turtle_shell: '12609' };
// lower body: [part, y]
const SKIRT_FAM = new Set(['skirt', 'long_robe', 'wide_skirt', 'dress_slope']);
const LEGS = { standard: null, short: [['41879a', 32]], mermaid_tail: [['51345', 32]], skirt: [['3815', 32], ['3816', 44], ['3817', 44], ['u9209c01', 32, 0, 0, 'skirt']], long_robe: [['36036', 32]], wide_skirt: [['24068', 32]], dress_slope: [['3678b', 32, -10, Math.PI]], snake_tail: [['3815', 32]], genie_tail: [['19859', 32]] };
const XF = (x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Matrix4(); m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')); m.setPosition(x, y, z); return m; };
const D = Math.PI / 180; const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const shade = hex => '#' + new THREE.Color(hex).multiplyScalar(0.75).getHexString();
function RoundedBox(w, h, d, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * Math.min(r, 1), bevelEnabled: true, bevelThickness: Math.min(r, 1), bevelSize: Math.min(r, 1), bevelSegments: 2 }); g.center(); return g; }

// ---- neutral pose guard: the figure is ALWAYS assembled from the neutral (rest) pose; a rebuild wipes every previous mesh, decal and transform ----
let BASE_CHILDREN = null;
function resetScene() {
  if (!BASE_CHILDREN) BASE_CHILDREN = new Set(scene.children);
  for (const o of [...scene.children]) { if (BASE_CHILDREN.has(o)) continue; scene.remove(o);
    o.traverse(n => { if (n.geometry) n.geometry.dispose(); const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : []; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }); }
  window.PARTS = []; window.CUSTOM_PARTS = []; window.READY = false; (typeof mini !== 'undefined') && (mini.scene = null); window.OFFICIAL_HEAD = false; window.FACE = null; ground.position.set(0, 0, 0);
  camera.position.set(0, 0, 100); camera.up.set(0, 1, 0); camera.quaternion.identity(); controls.target.set(0, 0, 0); controls.update();
}
// snapshot of the standard body parts' world placement (position + rotation) — identical for EVERY figure built from the neutral pose
window.poseReport = () => { const out = {}; for (const p of window.PARTS || []) { if (!['973', '3818', '3819', '3820', '3815', '3816', '3817'].includes(p.id) || !p.mesh || !p.mesh.isMesh) continue; p.mesh.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), pos = new THREE.Vector3(); p.mesh.matrixWorld.decompose(pos, q, new THREE.Vector3()); const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'); const k = p.id + '#' + (out[p.id] ? 'b' : 'a');
    out[k] = [pos.x, pos.y, pos.z, e.x / D, e.y / D, e.z / D].map(v => +v.toFixed(2)); } return out; };
async function build() {
  resetScene();
  const S = await getSpec(); const t0 = performance.now();
  const skin = S.skin_color || '#F2CD37', torsoC = S.torso_color || '#C91A09', armC = S.arm_color || torsoC, handC = S.hand_color || skin;
  const okC = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); // invalid/missing bottom colour => top colour or black, NEVER the old blue/yellow default
  const lowFb = okC(S.skirt_color) && SKIRT_FAM.has(S.legs_type || '') ? S.skirt_color : okC(S.torso_color) ? S.torso_color : '#1B2A34';
  const legL = okC(S.leg_color) ? S.leg_color : lowFb, hipC = okC(S.hip_color) ? S.hip_color : legL, legR = okC(S.leg_right_color) ? S.leg_right_color : legL, hairC = S.hair_color || '#583927';
  const hg = HEADGEAR[S.headgear] ? S.headgear : 'none';
  if (hg === 'none' && S.hair_style && !(S.hair_style in HAIR) && !S.hair_part) { S.hair_sculpt = S.hair_sculpt || { kind: /curl|afro/.test(S.hair_style) ? 'curls' : /long/.test(S.hair_style) ? 'long' : 'messy' }; S.hair_style = 'sculpt'; } // unknown style => sculpt
  const hairPart = hg !== 'none' ? null : (S.hair_part || HAIR[S.hair_style || 'short'] || null);
  const hgParts = HEADGEAR[hg] || [];
  const mold = HEADMOLD[S.head_mold] || null;
  const neckP = NECKACC[S.neck_accessory] || null;
  const legsT = LEGS[S.legs_type] ? S.legs_type : 'standard';
  const dbl = !!S.double_torso; const dy = dbl ? 32 : 0;
  window.ROLE_SETS = { hair: new Set(hairPart ? hairPart.split('+') : []), hat: new Set(hgParts.map(p => p[0])), neck: new Set(neckP ? [neckP] : []) };
  const names = [...new Set(['3626c', '973', '3818', '3819', '3820', '3815', '3816', '3817', ...(hairPart ? hairPart.split('+') : []), ...hgParts.map(p => p[0]), ...(mold ? [mold] : []), ...(neckP ? [neckP] : []), ...((LEGS[legsT] || []).map(p => p[0]))])];
  const groups = await Promise.all(names.map(n => loadPart(n).catch(e => { console.error(n, e); return null; })));
  const P = Object.fromEntries(names.map((n, i) => [n, groups[i]]));
  const fig = new THREE.Group();
  const PARTS = window.PARTS = []; const hexOf = mat => '#' + mat.color.getHexString();
  const place = (name, mat, m) => { const g = P[name]; if (!g) return null; const mesh = toMesh(g, mat, /^381[89]$|^3815$/.test(name)); mesh.applyMatrix4(m); fig.add(mesh); PARTS.push({ id: name, color: hexOf(mat), mesh }); return mesh; };
  const hasMask = !!(S.face && ((S.face.mask && S.face.mask !== 'none' && (S.face.mask.type || typeof S.face.mask === 'string') && (S.face.mask.type || S.face.mask) !== 'none') || S.face.face_extra_svg));
  const useOfficial = !mold && !hasMask && S.head_part && /^3626[bc]p[0-9a-z]+$/.test(S.head_part) && S.hair_style !== 'bandana_tails';
  let head = null;
  if (useOfficial) { try { const g = await loadPrintedHead(S.head_part); const hm = headMeshes(g, skin); hm.applyMatrix4(XF(0, -24, 0)); fig.add(hm); PARTS.push({ id: S.head_part, color: skin, mesh: hm }); head = hm.children.find(m => m.userData.key === 'skin') || hm.children[0]; } catch (e) { console.error('official head', e); } }
  if (!head && mold) head = place(mold, plastic(skin), XF(0, 0, 0)); // special molds have origin at the neck
  if (!head) head = place('3626c', plastic(skin), XF(0, -24, 0));
  window.OFFICIAL_HEAD = !!useOfficial && !!head;
  const torsos = [], arms = [], hands = [], handM = [];
  for (let k = 0; k < (dbl ? 2 : 1); k++) {
    const y = k * 32, tc = k ? (S.torso2_color || torsoC) : torsoC, ac = k ? (S.arm2_color || S.torso2_color || armC) : armC;
    torsos.push(place('973', plastic(tc), XF(0, y, 0)));
    arms.push(place('3818', plastic(ac), XF(-15.552, 9 + y, 0, 0, 0, 10 * D)), place('3819', plastic(ac), XF(15.552, 9 + y, 0, 0, 0, -10 * D)));
    const hmR = XF(-23.1, 26.6 + y, -9.8, 45 * D, 0, 10 * D), hmL = XF(23.1, 26.6 + y, -9.8, 45 * D, 0, -10 * D).multiply(!k && (S.accessories_3d || []).some(a => a && a.type === 'shield') ? new THREE.Matrix4().makeRotationZ(Math.PI) : new THREE.Matrix4()); handM.push(hmR, hmL); hands.push(place('3820', plastic(handC), hmR), place('3820', plastic(handC), hmL));
  }
  const torso = torsos[0], [armR, armL] = arms;
  const [handR, handL] = hands;
  let hips = null, lr = null, ll = null; const lowers = [];
  if (legsT === 'standard') { hips = place('3815', plastic(hipC, { roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.55 }), XF(0, 32 + dy, 0)); lr = place('3816', plastic(legR), XF(0, 44 + dy, 0)); ll = place('3817', plastic(legL), XF(0, 44 + dy, 0)); }
  else for (const [n, y, z = 0, ry = 0, ck] of LEGS[legsT]) { const m = place(n, plastic(ck === 'skirt' ? (okC(S.skirt_color) ? S.skirt_color : legL) : n === '3815' ? hipC : n === '3816' ? legR : (SKIRT_FAM.has(legsT) && okC(S.skirt_color)) ? S.skirt_color : legL, ck === 'skirt' ? { roughness: 0.6, clearcoat: 0.1 } : {}), XF(0, y + dy, z, 0, ry, 0)); if (m) lowers.push(m); }
  if (hairPart && hairPart.includes('+')) { // composite hair: FRONT (fringe) of one official mould + BACK (bun) of another, one colour, one plastic
    const [fp, bp] = hairPart.split('+'), mat = plastic(hairC, { roughness: 0.4 }), SPLIT = HAIR_SPLIT_Z;
    const clip = (name, keep) => { if (!P[name]) return null; const g = toMesh(P[name], mat).geometry; const n = g.index ? g.toNonIndexed() : g; const pa = n.attributes.position, na = n.attributes.normal, P2 = [], N2 = [];
      for (let i = 0; i < pa.count; i += 3) { const cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3, cy = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3; if (!keep(cz, cy)) continue; for (let k = 0; k < 3; k++) { P2.push(pa.getX(i + k), pa.getY(i + k), pa.getZ(i + k)); N2.push(na.getX(i + k), na.getY(i + k), na.getZ(i + k)); } }
      const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3)); return o; };
    const gF = clip(fp, z => z < SPLIT + 1.5), gB = clip(bp, z => z >= SPLIT - 1.5);
    const hbx = gB ? (gB.computeBoundingBox(), gB.boundingBox) : null, extra = [];
    if (hbx && /bun_low/.test(S.hair_style || '')) { // sculpted LOW bun at the back (smooth LEGO plastic, gently 'messy' lobes)
      const h = hbx.max.y - hbx.min.y, cy = hbx.min.y + h * 0.66, cz = hbx.max.z + 0.8, add = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz)); const g = geo.clone().toNonIndexed(); g.applyMatrix4(m); g.deleteAttribute('uv'); extra.push(g); };
      add(new THREE.SphereGeometry(5.4, 40, 28), 0, cy, cz, 1.25, 0.95, 0.85);
      add(new THREE.SphereGeometry(3.2, 28, 18), -1.6, cy + 1.2, cz + 2.2, 1.3, 0.85, 0.8); add(new THREE.SphereGeometry(2.8, 28, 18), 2.2, cy - 0.8, cz + 2.4, 1.2, 0.9, 0.8);
      add(new THREE.SphereGeometry(2.4, 24, 16), -4.6, cy - 2.2, cz + 1.2, 1.2, 0.8, 0.9); add(new THREE.SphereGeometry(2.2, 24, 16), 4.4, cy + 2, cz + 1.0, 1.25, 0.8, 0.9);
      add(new THREE.SphereGeometry(1.9, 20, 14), 1.4, cy - 3.6, cz + 0.8, 1.4, 0.7, 0.9); }
    const geo = mergeGeometries([gF, gB, ...extra].filter(Boolean), false); if (geo) { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.applyMatrix4(XF(0, -24, 0)); fig.add(mesh);
      PARTS.push({ id: 'custom-hair', title: `Зачіска-композит: чубчик з ${fp} + пучок з ${bp} (одна деталь, один колір)`, color: hexOf(mat), mesh }); window.CUSTOM_PARTS = window.CUSTOM_PARTS || []; window.CUSTOM_PARTS.push(`Зачіска ${fp}+${bp}`); } }
  else if (hairPart) place(hairPart, plastic(hairC, { roughness: 0.4 }), XF(0, -24, 0));
  for (const [n, k] of hgParts) place(n, plastic(k === 'second' ? (S.headgear_secondary_color || '#1b1b1b') : (S.headgear_color || hairC), { roughness: 0.35 }), /hood|cowl/.test(hg) ? XF(0, -24.6, 0).multiply(new THREE.Matrix4().makeScale(1.045, 1.01, 1.045)) : XF(0, -24, 0)); // hoods: tiny scale-up so the cloth never clips torso/arms
  let neckMesh = null;
  if (neckP) neckMesh = place(neckP, plastic(S.neck_accessory_color || '#A0A5A9', S.neck_accessory === 'armor_breastplate' || S.neck_accessory === 'shoulder_pads' ? { metalness: 0.5, roughness: 0.3 } : {}), XF(0, 0, 0));
  // LDraw: y down, -z = front. Flip to three.js (y up, +z front)
  fig.position.set(0, 0, 0); fig.scale.set(1, 1, 1); fig.rotation.set(Math.PI, 0, 0); scene.add(fig); fig.updateMatrixWorld(true);
  if (legsT === 'snake_tail') { (window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Хвіст змії (немає офіційної деталі LDraw)'); // molded serpent tail (Ninjago-style): drops from the hips, curls back into a flat coil that the figure stands on
    const Y0 = 52 + dy, G = 84 + dy; // hips bottom, ground (LDraw y down, -z = front)
    const pts = [V3(0, Y0 - 6, 0), V3(0, Y0 + 6, 0.5), V3(0, Y0 + 16, 3), V3(0, G - 9, 9), V3(0, G - 7, 20), V3(-14, G - 6, 24), V3(-22, G - 5, 10), V3(-18, G - 4, -6), V3(-4, G - 4, -14), V3(12, G - 3.5, -12), V3(20, G - 3, 2), V3(18, G - 2.5, 14)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4); const seg = 220, rs = 28;
    const g = new THREE.TubeGeometry(curve, seg, 1, rs, false); const p = g.attributes.position, c = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) { const t = i / seg; const rx = 17.5 * (1 - 0.82 * Math.pow(t, 1.15)) + 0.6, rz = 10.5 * (1 - 0.72 * Math.pow(t, 1.1)) + 0.6; const cp = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const horiz = Math.min(1, Math.max(0, (t - 0.18) / 0.15)); // blend: upper part elliptical (hip width), coil round
      for (let j = 0; j <= rs; j++) { const k = i * (rs + 1) + j; c.fromBufferAttribute(p, k).sub(cp); const r = THREE.MathUtils.lerp(rx, rz * 0.95 + 1.5, horiz); const sx = THREE.MathUtils.lerp(rx, r, 1), sz = THREE.MathUtils.lerp(rz, r, horiz);
        c.x *= (1 - horiz) * rx + horiz * r; c.z *= (1 - horiz) * rz + horiz * r; c.y *= (1 - horiz) * rz + horiz * r; c.add(cp); if (c.y > G) c.y = G; p.setXYZ(k, c.x, c.y, c.z); } }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, plastic(legL)); m.castShadow = true; m.receiveShadow = true;
    // tip cap + flat underside disc for stability
    fig.add(m); lowers.push(m); PARTS.push({ id: 'custom-snake-tail', title: 'Хвіст змії (власна 3D-модель, офіційної деталі немає)', color: '#' + m.material.color.getHexString(), mesh: m }); }
  // decals (projected from the front in world space)
  // real face print zone of 3626c: between top rim and neck rim (local y -1..23); texture viewBox y 47..133, eyes at 86 (=45% from top, ~55% up from neck rim), mouth at 106 (~69% from top)
  let FT = fig.localToWorld(new THREE.Vector3(0, -1 - 24, 0)).y; let FB = fig.localToWorld(new THREE.Vector3(0, 23 - 24, 0)).y;
  if (mold && head) { const hb1 = new THREE.Box3().setFromObject(head), h = hb1.max.y - hb1.min.y; FT = hb1.max.y - 0.3 * h; FB = hb1.min.y + 0.08 * h; }
  const EY = FT - (86 - 47) / 86 * (FT - FB); window.FACE = { FT, FB, EY };
  const T = window.MINIFIG_TEX || S.textures || {};
  const [ftex, ttex, ltex, btex, atex, atexM, gtex, t2tex, b2tex] = await Promise.all([svgTexture(T.face, 1024, 1074), svgTexture(T.torso, 1024, 962), svgTexture(T.legs, 1024, 972), svgTexture(T.torso_back, 1024, 962), svgTexture(T.arms, 512, 512), svgTexture(T.arms_mirror || T.arms, 512, 512), svgTexture(T.glasses, 1024, 1074), svgTexture(T.torso2 || T.torso, 1024, 962), svgTexture(T.torso2_back || T.torso_back, 1024, 962)]);
  const bb = m => new THREE.Box3().setFromObject(m);
  // bbox of the front-facing surface only (vertices within 1.5 LDU of the frontmost z)
  const frontBox = (m, dz = 1.5) => { m.updateMatrixWorld(true); const p = m.geometry.attributes.position, v = new THREE.Vector3(); let mz = -1e9; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); mz = Math.max(mz, v.z); }
    const b = new THREE.Box3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.z > mz - dz) b.expandByPoint(v); } b.max.z = mz; return b; };
  // arms: print wraps the full circumference (front, back, outer, inner), mirrored on the left arm => symmetric
  // arm prints: decals are built on the RIGHT arm of each pair (4 sides => full circumference) and MIRRORED onto the left arm,
  // so both arms always carry an identical, symmetric print regardless of the spec
  for (let i = 0; i < arms.length; i += 2) { const arm = arms[i], twin = arms[i + 1]; if (!arm || !atex) continue;
    const b = bb(arm), c = b.getCenter(new THREE.Vector3()), W = b.max.x - b.min.x, H = b.max.y - b.min.y, Dp = b.max.z - b.min.z;
    for (const [pos, rot, w, d] of [[c.clone().setZ(b.max.z), 0, W, Dp], [c.clone().setZ(b.min.z), Math.PI, W, Dp], [c.clone().setX(b.max.x), Math.PI / 2, Dp, W], [c.clone().setX(b.min.x), -Math.PI / 2, Dp, W]]) {
      const dc = decal(arm, atex, pos, new THREE.Vector3(w * 1.02, H, d), rot); if (!dc) continue; facingOnly(dc.geometry, new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot))); if (!dc.geometry.attributes.position.count) continue; scene.add(dc);
      if (twin) { const g = mirrorX(dc.geometry); const mat = dc.material; const m2 = new THREE.Mesh(g, mat); m2.renderOrder = 2; scene.add(m2); (twin.userData.decals = twin.userData.decals || []).push(m2); } } }
  if (head && !window.OFFICIAL_HEAD) { const b = bb(head); const w = b.max.x - b.min.x; const d = decal(head, ftex, new THREE.Vector3(0, (FT + FB) / 2, b.max.z), new THREE.Vector3(w, FT - FB, 30)); if (d) fig.parent.add(d); }
  if (head && window.OFFICIAL_HEAD && gtex) { const b = bb(head); const w = b.max.x - b.min.x; const d = decal(head, gtex, new THREE.Vector3(0, (FT + FB) / 2, b.max.z), new THREE.Vector3(w, FT - FB, 30)); if (d) { d.material.polygonOffsetFactor = -8; d.renderOrder = 3; fig.parent.add(d); } }
  // cape (4524) hangs over the torso back: carry the back print/author touch onto the cape so it stays visible
  if (neckMesh && S.neck_accessory === 'cape' && btex) { const cb = bb(neckMesh), tb0 = torso ? frontBox(torso, 3) : cb; const h = tb0.max.y - tb0.min.y, w = tb0.max.x - tb0.min.x;
    const dc = decal(neckMesh, btex, new THREE.Vector3(0, (tb0.max.y + tb0.min.y) / 2, cb.min.z), new THREE.Vector3(w * 1.05, h, (cb.max.z - cb.min.z) * 0.6), Math.PI); if (dc) scene.add(dc); }
  torsos.forEach((tr, k) => { if (!tr) return; const b = frontBox(tr, 3), bf = bb(tr); const d = decal(tr, k ? t2tex : ttex, new THREE.Vector3(0, (b.max.y + b.min.y) / 2, b.max.z), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, (bf.max.z - bf.min.z) * 0.9)); if (d) scene.add(d);
    const db = decal(tr, k ? b2tex : btex, new THREE.Vector3(0, (b.max.y + b.min.y) / 2, bf.min.z), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, (bf.max.z - bf.min.z) * 0.9), Math.PI); if (db) scene.add(db); });
  if (hips && ll && lr) { const b = frontBox(hips, 3).union(frontBox(ll, 3)).union(frontBox(lr, 3)); const d1 = decal(hips, ltex, new THREE.Vector3(0, (b.max.y + b.min.y) / 2, b.max.z), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, 30)); if (d1) scene.add(d1);
    for (const lg of [ll, lr]) { const d = decal(lg, ltex, new THREE.Vector3(0, (b.max.y + b.min.y) / 2, b.max.z), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, 30)); if (d) scene.add(d); } }
  else if (lowers.length && ltex) { const ms = lowers.filter(m => m.geometry.attributes.position.count < 200000); const b = ms.map(m => bb(m)).reduce((a, x) => a.union(x)); for (const m of ms) { const d = decal(m, ltex, new THREE.Vector3(0, (b.max.y + b.min.y) / 2, b.max.z), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, (b.max.z - b.min.z) * 0.6)); if (d) scene.add(d); } }
  // bandana / eye mask band with tails as simple geometry around the head
  if (S.hair_style === 'bandana_tails' && head) {
    const b = bb(head); const r = (b.max.x - b.min.x) / 2 + 0.35; const cy = EY;
    const mat = plastic(hairC, { side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 5.2, 64, 1, true), mat); ring.position.set(0, cy, (b.max.z + b.min.z) / 2); ring.castShadow = true; scene.add(ring);
    // eye holes are printed in the face texture (whites drawn on top)
    const knot = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 16), mat); knot.position.set(0, cy, b.min.z - 0.8); scene.add(knot);
    for (const s of [-1, 1]) { const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 11, 0.9), mat); tail.position.set(s * 2.6, cy - 5.5, b.min.z - 1.6); tail.rotation.z = s * 0.35; tail.rotation.x = 0.25; tail.castShadow = true; scene.add(tail); }
    // eyes sit ON TOP of the band (white eye + pupil + glint), at the face-print eye positions
    const w = b.max.x - b.min.x, cz = (b.max.z + b.min.z) / 2;
    const ey = EY;
    for (const ex of [(138 - 152) / 82 * w, (166 - 152) / 82 * w]) {
      const z = cz + Math.sqrt(Math.max(0, r * r - ex * ex)) + 0.15;
      const white = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), plastic('#ffffff')); white.scale.set(2.1, 1.6, 0.35); white.position.set(ex, ey, z); scene.add(white);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), plastic('#151515')); pup.scale.set(1.05, 1.05, 0.3); pup.position.set(ex + (ex < 0 ? 0.35 : -0.35), ey, z + 0.3); scene.add(pup);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' })); gl.position.set(ex + (ex < 0 ? 0.1 : -0.6), ey + 0.45, z + 0.62); scene.add(gl);
    }
  }
  // ---- 3D accessory library (simple geometry, LEGO-like plastic) ----
  const acc = Array.isArray(S.accessories_3d) ? S.accessories_3d : [];
  const has = t => acc.find(a => a && a.type === t);
  const hb = head ? bb(head) : null;
  const add = (geo, mat, pos, rot, sc) => { const m = new THREE.Mesh(geo, mat); m.position.copy(pos); if (rot) m.rotation.set(...rot); if (sc) m.scale.set(...sc); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let a;
  // ---- procedurally SCULPTED LEGO hair (real hairstyle -> smooth sculpted ABS piece) ----
  if (hb && S.hair_style === 'sculpt' && hg === 'none') {
    const HS = S.hair_sculpt || {}, kind = HS.kind || 'messy', len = HS.length || 'short', fr = HS.fringe || 'side', vol = Math.max(0, Math.min(1, +HS.volume || 0.5));
    let seed = 1234; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cx = (hb.min.x + hb.max.x) / 2, cz = (hb.min.z + hb.max.z) / 2, H = hb.max.y - hb.min.y, R = (hb.max.x - hb.min.x) / 2;
    const cy = hb.max.y - H * 0.42, brow = hb.min.y + H * 0.66, geos = [];
    const put = (geo, x, y, z, s = [1, 1, 1], r = [0, 0, 0]) => { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.deleteAttribute('uv'); g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s))); geos.push(g); };
    // cap shell: front edge above the brows, back/sides lower (by length)
    const backY = { short: hb.min.y + H * 0.42, mid: hb.min.y + H * 0.1, long: hb.min.y - H * 0.2 }[len] || hb.min.y + H * 0.4;
    { const sg = new THREE.SphereGeometry(R * (1.13 + vol * 0.12), 56, 40).toNonIndexed(); sg.deleteAttribute('uv'); const p = sg.attributes.position, n = sg.attributes.normal, P2 = [], N2 = [];
      for (let i = 0; i < p.count; i += 3) { let ok = true; for (let k = 0; k < 3; k++) { const x = p.getX(i + k), y = p.getY(i + k) * 1.05 + cy, z = p.getZ(i + k); const t = Math.max(0, Math.min(1, (z / R + 1) / 2)); const lim = backY + (brow + 1 - backY) * t * t; if (y < lim) ok = false; }
        if (ok) for (let k = 0; k < 3; k++) { P2.push(p.getX(i + k) + cx, p.getY(i + k) * 1.05 + cy, p.getZ(i + k) + cz); N2.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k)); } }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3)); geos.push(cg); }
    const ang = (a, el, rr = R * 1.12) => [cx + Math.sin(a) * Math.cos(el) * rr, cy + Math.sin(el) * rr * 1.05, cz + Math.cos(a) * Math.cos(el) * rr];
    if (kind === 'curls') { // loose, longer curls (not a perfect round afro): elongated lobes, hanging lower at the sides/back
      for (let i = 0; i < 46 + vol * 30; i++) { const a = rnd() * Math.PI * 2, front = Math.cos(a) > 0.55; const el = front ? 0.35 + rnd() * 1.1 : -0.35 + rnd() * 1.6; const [x, y, z] = ang(a, el);
        const r = R * (0.2 + rnd() * 0.1) * (1 + vol * 0.35); put(new THREE.SphereGeometry(r, 16, 12), x, y - (front ? 0 : r * 0.4), z, [1, 1.45, 1], [rnd() * 0.6 - 0.3, a, rnd() * 0.6 - 0.3]); }
      for (let i = 0; i < 7; i++) { const a = -1.0 + i * 0.33; const [x, y, z] = ang(a, 0.55); put(new THREE.TorusGeometry(R * 0.17, R * 0.09, 10, 18), x, y - R * 0.15, z + R * 0.08, [1, 1.3, 1], [0.3, a, 0]); }
    } else if (kind === 'long') { // long hair: distinct strand clumps + bangs
      const L = { short: H * 0.5, mid: H * 1.0, long: H * 1.9 }[len] || H * 1.3;
      for (let i = 0; i < 15; i++) { const a = Math.PI * (0.38 + i * 0.088) * (1) ; const aa = a + Math.PI * 0.0; const [x, , z] = ang(aa, 0.05, R * 1.08); const l = L * (0.8 + rnd() * 0.3);
        put(new THREE.CapsuleGeometry(R * 0.2, l, 6, 14), x, cy - l / 2 + R * 0.2, z, [1, 1, 0.75], [0, aa, (Math.sin(aa)) * 0.12]); }
      for (let i = 0; i < 4; i++) { const sx = i < 2 ? -1 : 1, [x, , z] = ang(sx * (0.95 + (i % 2) * 0.35), 0.05, R * 1.06); const l = L * 0.85; put(new THREE.CapsuleGeometry(R * 0.17, l, 6, 14), x, cy - l / 2, z, [1, 1, 0.7], [0, sx * 0.9, sx * 0.08]); }
    } else { // textured messy hair: tufts on top/back
      for (let i = 0; i < 30 + vol * 16; i++) { const a = rnd() * Math.PI * 2, el = 0.25 + rnd() * 1.2; const [x, y, z] = ang(a, el, R * 1.1); put(new THREE.ConeGeometry(R * 0.24, R * (0.38 + rnd() * 0.2), 12), x, y - R * 0.05, z, [1, 1, 0.6], [-(Math.PI / 2 - el) * Math.cos(a) - 1.0, a, (Math.PI / 2 - el) * Math.sin(a) * 0.8 + 0.4]); }
    }
    if (fr !== 'none') { // fringe falling onto the forehead
      const n = fr === 'straight' ? 7 : 6; for (let i = 0; i < n; i++) { const t = i / (n - 1) - 0.5, a = t * 1.5 + (fr === 'side' ? 0.25 : 0); const [x, , z] = ang(a, 0.5, R * 1.08); const l = H * (fr === 'messy' ? 0.26 + rnd() * 0.1 : 0.27);
        put(new THREE.CapsuleGeometry(R * 0.15, l, 5, 12), x, brow + l * 0.55 + 0.6, z + 0.4, [1.15, 1, 0.55], [-0.22, a, fr === 'side' ? 0.38 : fr === 'messy' ? (rnd() - 0.5) * 0.5 : 0]); } }
    const geo = mergeGeometries(geos, false); if (geo) { const mesh = new THREE.Mesh(geo, plastic(hairC, { roughness: 0.38 })); mesh.castShadow = true; scene.add(mesh);
      PARTS.push({ id: 'custom-hair-sculpt', title: `Скульптурна зачіска (власна LEGO-деталь: ${kind}, ${len}, чубчик ${fr})`, color: hairC, mesh }); (window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Скульптурна зачіска'); }
  }
  // (bust is PRINT only — no 3D overlay part)
  if ((a = has('headphones')) && ((window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Навушники'), true) && hb) {
    const c = a.color || '#1E5AA8', c2 = a.secondary_color || c, hw = (hb.max.x - hb.min.x) / 2, cy = EY - 0.5, cz = (hb.max.z + hb.min.z) / 2, topY = hb.max.y;
    const R = hw + 2.2, yc = cy + 1.5; // headband arc over the top (stud) from ear to ear
    add(new THREE.TorusGeometry(R, 1.1, 14, 48, Math.PI), plastic(c2), V(0, yc, cz), null, [1, Math.max(1, (topY + 2 - yc) / R), 1]);
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(4.6, 4.6, 3.2, 32), plastic(c), V(sx * (hw + 1.9), cy, cz), [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 28), plastic('#2a2a2a'), V(sx * (hw + 0.2), cy, cz), [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(1.4, 1.4, 1.2, 16), plastic(c2), V(sx * (hw + 3.8), cy, cz), [0, 0, Math.PI / 2]);
    }
  }
  if ((a = has('cap')) && hb && !hairPart && hg === 'none') {
    const g = await loadPart('3624').catch(() => null);
    if (g) { const m = toMesh(g, plastic(a.color || '#C91A09')); m.applyMatrix4(XF(0, -24, 0)); fig.add(m); fig.updateMatrixWorld(true); }
  }
  if ((a = has('hair_ornament')) && a.style === 'headband' && hb) { // maid headdress / headband with frills over the hair
    const cx = (hb.min.x + hb.max.x) / 2, cz = (hb.min.z + hb.max.z) / 2, H = hb.max.y - hb.min.y, R = (hb.max.x - hb.min.x) / 2, cy = hb.max.y - H * 0.42, rr = R * 1.3, gs = [];
    const P = (geo, m) => { const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.deleteAttribute('uv'); g.applyMatrix4(m); gs.push(g); };
    const base = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy - R * 0.2, cz + R * 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)), new THREE.Vector3(1, 1.02, 1));
    P(new THREE.TorusGeometry(rr, R * 0.11, 10, 40, Math.PI), base);
    for (let i = 0; i < 9; i++) { const t = 0.12 + i * (0.76 / 8), ang = t * Math.PI; P(new THREE.SphereGeometry(R * 0.2, 16, 10), base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(ang) * rr, Math.sin(ang) * rr, R * 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)), new THREE.Vector3(1.1, 0.7, 0.45)))); }
    const m = new THREE.Mesh(mergeGeometries(gs, false), plastic(a.color || '#F4F4F4')); m.castShadow = true; scene.add(m);
    PARTS.push({ id: 'custom-headband', title: 'Ободок-наколка покоївки (власна деталь)', color: a.color || '#F4F4F4', mesh: m }); (window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Ободок'); }
  else if ((a = has('hair_ornament')) && ((window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Прикраса для волосся'), true) && hb) {
    const c = a.color || '#E4ADC8', c2 = a.secondary_color || '#F2CD37', g = new THREE.Group();
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), plastic(c)); p.scale.set(1, 0.6, 1.5); p.position.set(Math.cos(k * 1.2566) * 1.7, Math.sin(k * 1.2566) * 1.7, 0); p.rotation.z = k * 1.2566; g.add(p); }
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), plastic(c2)));
    g.position.set(-(hb.max.x - hb.min.x) / 2 - 1.2, hb.max.y - 3, (hb.max.z + hb.min.z) / 2 + 2); g.rotation.y = -1.2; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g);
  }
  const bagA = has('bag'); // held handbag is placed below with the held parts; crossbody/belt bags are printed on the torso
  if ((a = has('backpack')) && ((window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Рюкзак'), true) && torso) {
    const tb = bb(torso), c = a.color || '#5A3A22', w = (tb.max.x - tb.min.x) * 0.62, h = (tb.max.y - tb.min.y) * 0.8, cy = (tb.max.y + tb.min.y) / 2;
    const bag = new THREE.Mesh(new RoundedBox(w, h, 8, 2), plastic(c)); bag.position.set(0, cy, tb.min.z - 4); bag.castShadow = true; scene.add(bag);
    add(new RoundedBox(w * 0.8, h * 0.35, 3, 1.2), plastic(a.secondary_color || shade(c)), V(0, cy - h * 0.18, tb.min.z - 9.2));
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(2.4, h * 0.95, 0.8), plastic(c), V(sx * w * 0.32, cy, tb.max.z + 0.2));
  }
  // held items: LDraw convention — a held part's origin is the centre of its grip bar, bar along local Y.
  // The C-clip of hand 3820 has its axis along (0,-0.968,-0.25) through (0,-0.82,-9.9) in hand space.
  const GRIP = new THREE.Matrix4().makeTranslation(0, -0.82, -9.9).multiply(new THREE.Matrix4().makeRotationX(Math.atan2(0.25, 0.968)));
  const held = async (part, hm, mat, extra) => { const g = await loadPart(part).catch(() => null); if (!g) return null; const m = toMesh(g, mat); m.applyMatrix4(hm.clone().multiply(GRIP).multiply(extra || new THREE.Matrix4())); fig.add(m); PARTS.push({ id: part, color: '#' + mat.color.getHexString(), mesh: m }); return m; };
  if ((a = has('sword')) && handM[0]) await held(/long|great/i.test(a.kind || '') ? '18031' : '3847', handM[0], plastic(a.color || '#A0A5A9', { metalness: 0.55, roughness: 0.28 }), new THREE.Matrix4().makeRotationY(Math.PI / 2));
  if (bagA && !/crossbody|belt/i.test(bagA.style || '')) { const hmx = handM[!has('shield') ? 1 : 0]; if (hmx) { (window.CUSTOM_PARTS = window.CUSTOM_PARTS || []).push('Сумочка в руці (мініфіг-масштаб; найближча офіційна — Friends handbag 93091)');
    const hp = new THREE.Vector3().setFromMatrixPosition(hmx.clone().multiply(GRIP)), c = bagA.color || '#1b1b1b', g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBox(9, 7, 3.4, 1.3), plastic(c)); body.position.y = -8.6; g.add(body); const flap = new THREE.Mesh(new RoundedBox(9.3, 3.2, 3.8, 1.1), plastic(c)); flap.position.y = -6.3; g.add(flap);
    const hd = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.45, 8, 20, Math.PI), plastic(c)); hd.position.y = -5.0; g.add(hd);
    const cl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.4), plastic(bagA.secondary_color || '#898788', { metalness: 1, roughness: 0.3 })); cl.position.set(0, -7.4, 1.95); g.add(cl);
    g.position.copy(hp); g.rotation.x = Math.PI; g.position.z += 1; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); fig.add(g); fig.updateMatrixWorld(true);
    PARTS.push({ id: 'custom-handbag', title: 'Сумочка (власна 3D-модель; офіційний аналог — BrickLink 93091)', color: c, mesh: g }); } }
  if ((a = has('shield')) && handM[1]) { const sh = await held(a.shape === 'round' ? '3876' : a.shape === 'oval' ? '2586' : '3846', handM[1], plastic(a.color || '#A0A5A9'), new THREE.Matrix4().makeRotationY(0));
    if (sh && a.secondary_color) { sh.updateMatrixWorld(true); const b0 = new THREE.Box3().setFromObject(sh); }
  }
  fig.updateMatrixWorld(true);
  // frame camera
  const box = new THREE.Box3(); scene.children.forEach(o => { if (o.isMesh && o !== ground || o.isGroup) box.expandByObject(o); }); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
  ground.position.y = new THREE.Box3().setFromObject(fig).min.y; controls.target.copy(c);
  window.VIEWS = { front: [0, 0.05, 1], side: [1, 0.05, 0], back: [0, 0.05, -1], three: [0.75, 0.22, 1] };
  const dist = sz.y * 2.35;
  window.setView = v => { wake(); const d = new THREE.Vector3(...window.VIEWS[v]).normalize().multiplyScalar(dist); camera.position.copy(c).add(d); controls.update(); };
  setView(params.get('view') || 'three');
  await buildPanel();
  $('msg').textContent = ''; wake(); window.READY = true; window.BUILD_MS = Math.round(performance.now() - t0);
}
// ---- parts breakdown panel + isolated mini 3D view ----
const ROLE = [[/Head|Headdress/, 'Голова'], [/Hair/, 'Волосся'], [/Helmet|Hat|Cap\b|Hood|Cowl|Bandana|Wrap|Beanie/, 'Головний убір'], [/Torso/, 'Торс'], [/Arm/, 'Рука'], [/Hand/, 'Кисть'], [/Hips|Leg|Skirt|Slope/, 'Низ / ноги'], [/Cape|Armour|Vest|Jacket|Lifevest|Epaulette|Shell|Breastplate|Neck/, 'Плащ / броня'], [/Sword|Shield/, 'Аксесуар']];
// role of a part is decided by its ID (never by the free-text title: "Minifig Armour" must not become an arm)
const ROLE_IDS = { head: /^3626|^12607$|^18955$/, torso: /^973$/, arm: /^381[89]$/, hand: /^3820$/, legs: /^(3815|3816|3817|41879a|51345|3678b|u9209c01|36036|24068|19859|custom-snake-tail)$/ };
function roleOf(p, hairIds, hatIds, neckIds) {
  const id = String(p.id); if (ROLE_IDS.head.test(id)) return 'Голова'; if (id === 'custom-hair' || id === 'custom-hair-sculpt' || hairIds.has(id)) return 'Волосся'; if (hatIds.has(id)) return 'Головний убір'; if (neckIds.has(id)) return 'Плащ / броня';
  if (ROLE_IDS.torso.test(id)) return 'Торс'; if (ROLE_IDS.arm.test(id)) return 'Рука'; if (ROLE_IDS.hand.test(id)) return 'Кисть'; if (ROLE_IDS.legs.test(id)) return 'Низ / ноги';
  if (/^(3847|18031|3846|3876|2586)$/.test(id) || /^custom-(handbag|headband|backpack)/.test(id)) return 'Аксесуар'; return null; }
const mini = { r: null, scene: null, cam: null, ctl: null };
function showMini(p) {
  const cv = $('mini'); if (!mini.r) { mini.r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true }); mini.r.setPixelRatio(Math.min(2, devicePixelRatio)); mini.r.toneMapping = THREE.NeutralToneMapping; mini.r.outputColorSpace = THREE.SRGBColorSpace;
    mini.cam = new THREE.PerspectiveCamera(30, 1, 0.5, 3000); mini.ctl = new OrbitControls(mini.cam, cv); mini.ctl.enableDamping = true; mini.until = performance.now() + 3000; mini.ctl.addEventListener('change', () => { mini.until = Math.max(mini.until, performance.now() + 400); }); (function l() { requestAnimationFrame(l); if (mini.scene) { const mv = mini.ctl.update(); if (mv || performance.now() < mini.until) mini.r.render(mini.scene, mini.cam); } })(); }
  const w = cv.clientWidth, h = cv.clientHeight; mini.r.setSize(w, h, false); mini.cam.aspect = w / h; mini.cam.updateProjectionMatrix();
  const sc = new THREE.Scene(); sc.background = new THREE.Color('#1c2130'); if (!mini.env) mini.env = new THREE.PMREMGenerator(mini.r).fromScene(new RoomEnvironment(), 0.04).texture; sc.environment = mini.env;
  const k = new THREE.DirectionalLight('#fff', 1.6); k.position.set(-80, 160, 140); sc.add(k); const f2 = new THREE.DirectionalLight('#fff', 0.6); f2.position.set(100, 40, -120); sc.add(f2); sc.add(new THREE.HemisphereLight('#fff', '#ddd', 0.5));
  const add = o => { o.updateMatrixWorld(true); const c = o.clone(); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); sc.add(c); };
  add(p.mesh); const ms = []; p.mesh.traverse(o => { if (o.userData.decals) ms.push(...o.userData.decals); }); ms.forEach(add);
  const box = new THREE.Box3().setFromObject(p.mesh); const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length();
  mini.ctl.target.copy(c); mini.cam.position.copy(c).add(new THREE.Vector3(0.7, 0.35, 1).normalize().multiplyScalar(r * 1.9)); mini.ctl.update(); mini.scene = sc; mini.until = performance.now() + 3000;
  $('minihdr').innerHTML = `<b>${p.role}</b> · ${p.id} — ${p.title || ''} <span style="color:#777">(обертайте мишею; ззаду видно приховані принти)</span>`;
}
const LOCK_ID = params.get('id') || '';
// ---- "closest faces" trigger: hovering / clicking the HEAD (in the parts list or on the 3D figure) asks the parent page to open the face picker flyout ----
const askHead = (open, src) => { try { parent.postMessage({ lego_head: { id: LOCK_ID, open, src } }, location.origin); } catch {} };
const HEAD_ROLES = new Set(['Голова', 'Волосся', 'Головний убір']);
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let headT = 0, lastMv = 0, overHead = false, downAt = null;
function headHit(e) { const ms = (window.PARTS || []).filter(p => HEAD_ROLES.has(p.role) && p.mesh).map(p => p.mesh); if (!ms.length) return false; const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObjects(ms, true).length > 0; }
let mvT = 0;
function onMove(e) { lastMv = performance.now(); const h = headHit(e); canvas.style.cursor = h ? 'pointer' : ''; if (h && !overHead) { clearTimeout(headT); headT = setTimeout(() => askHead(true, '3d'), 200); } if (!h) clearTimeout(headT); overHead = h; }
canvas.addEventListener('pointermove', e => { if (e.buttons) return; clearTimeout(mvT); if (performance.now() - lastMv < 90) { mvT = setTimeout(() => onMove(e), 100); return; } onMove(e); }); // throttled, with a trailing call so the LAST position always counts
window.headPoint = () => { const ms = (window.PARTS || []).filter(p => p.role === 'Голова' && p.mesh).map(p => p.mesh); if (!ms.length) return null; const b = new THREE.Box3(); ms.forEach(m => b.expandByObject(m)); const c = b.getCenter(new THREE.Vector3()).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height }; }; // test hook: where the head is on screen
addEventListener('keydown', e => { if (e.key === 'Escape') askHead(false, 'esc'); }); // focus is inside the iframe after a click on the figure
canvas.addEventListener('pointerleave', () => { clearTimeout(headT); clearTimeout(mvT); overHead = false; });
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => { if (!downAt) return; const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5; downAt = null; if (!moved && headHit(e)) askHead(true, '3d-click'); }); let LOCKS = new Set((params.get('locks') || '').split(',').filter(Boolean));
// the parent page owns the lock state (survives regeneration); we only report changes. No localStorage: a stale id used to leave invisible locks on a NEW figure.
function saveLocks() { const v = { id: LOCK_ID, roles: [...LOCKS] }; try { parent.postMessage({ lego_locks: v }, location.origin); } catch {} }
const paintLocks = () => $('plist').querySelectorAll('.lk').forEach(x => { const on = LOCKS.has(x.dataset.r); x.textContent = on ? '🔒' : '🔓'; x.setAttribute('aria-pressed', on); x.title = on ? 'Деталь зафіксована — зняти замочок' : 'Зафіксувати деталь при повторній генерації'; });
addEventListener('message', e => { if (e.origin !== location.origin || !e.data || !Array.isArray(e.data.set_locks)) return; LOCKS = new Set(e.data.set_locks); paintLocks(); });
async function buildPanel() {
  const P = window.PARTS || []; await Promise.all(P.map(async p => { if (!p.title) { try { p.title = (await (await fetch('/ldraw/lib/parts/' + p.id + '.dat')).text()).split('\n')[0].replace(/^0\s+~?/, '').trim(); } catch { p.title = ''; } } const rs = window.ROLE_SETS || { hair: new Set(), hat: new Set(), neck: new Set() }; const byId = roleOf(p, rs.hair, rs.hat, rs.neck); const r = ROLE.find(([re]) => re.test(p.title)); p.role = byId || (r ? r[1] : 'Деталь'); }));
  const order = ['Голова', 'Волосся', 'Головний убір', 'Плащ / броня', 'Торс', 'Рука', 'Кисть', 'Низ / ноги', 'Аксесуар', 'Деталь']; P.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const bl = id => id.startsWith('custom') ? '' : `<a target="_blank" href="https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(id.replace(/^3626[bc]p.*/, '3626c'))}">BrickLink</a> · <a target="_blank" href="https://library.ldraw.org/parts/list?s=${encodeURIComponent(id)}">LDraw</a>`;
  $('plist').innerHTML = `<b>Деталі фігурки (${P.length})</b><div style="color:#777;font-size:.85em">🔒 — зафіксувати деталь (колір і принт): «Згенерувати ще раз» її не чіпатиме, усе інше буде новим</div>` + P.map((p, i) => `<div class="row" data-i="${i}"><span class="sw" style="background:${p.color}"></span><button class="lk" data-r="${p.role}" title="Зафіксувати деталь при повторній генерації" style="border:0;background:none;cursor:pointer;font-size:16px">${LOCKS.has(p.role) ? '🔒' : '🔓'}</button><div><b>${p.role}</b> · <code>${p.id}</code><br><span style="color:#555">${p.title}</span><br><span style="color:#888">колір ${p.color}</span> ${bl(p.id)}</div></div>`).join('')
    + ((window.CUSTOM_PARTS || []).length ? `<div style="color:#a00;margin-top:6px">Декоративні 3D-елементи без офіційної деталі: ${window.CUSTOM_PARTS.join(', ')}</div>` : '') + `<div style="color:#777;margin:6px 0">Принти — друк на деталях; золото/срібло — металеві чорнила.</div>`;
  $('plist').querySelectorAll('.lk').forEach(b => b.onclick = e => { e.stopPropagation(); const r = b.dataset.r; LOCKS.has(r) ? LOCKS.delete(r) : LOCKS.add(r); saveLocks(); paintLocks(); });
  paintLocks(); saveLocks();
  $('plist').querySelectorAll('.row').forEach(el => { if (P[+el.dataset.i].role !== 'Голова') return; let ht = 0; el.addEventListener('mouseenter', () => { clearTimeout(ht); ht = setTimeout(() => askHead(true, 'row'), 120); }); el.addEventListener('mouseleave', () => clearTimeout(ht)); el.addEventListener('click', () => { clearTimeout(ht); askHead(true, 'row-click'); }); });
  $('plist').querySelectorAll('.row').forEach(el => el.onclick = e => { if (e.target.tagName === 'A' || e.target.classList.contains('lk')) return; $('plist').querySelectorAll('.row').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); showMini(P[+el.dataset.i]); });
  const t = P.find(p => p.role === 'Торс'); if (t) { showMini(t); $('plist').querySelector(`.row[data-i="${P.indexOf(t)}"]`)?.classList.add('sel'); }
}
document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => setView(b.dataset.v));
$('rot').onclick = () => { wake(); controls.autoRotate = !controls.autoRotate; $('rot').classList.toggle('on', controls.autoRotate); };
controls.autoRotateSpeed = 2.5; controls.autoRotate = params.get('rotate') === '1';
$('png').onclick = () => window.savePng();
(function loop() { requestAnimationFrame(loop); const moved = controls.update(); if (moved || controls.autoRotate || performance.now() < until) renderer.render(scene, camera); })();
let building = Promise.resolve();
const doBuild = () => (building = building.then(() => build()).catch(e => { $('msg').textContent = 'Помилка 3D: ' + e.message; console.error(e); window.READY = 'error'; }));
// in-place rebuild (used by tests and by the page when a new spec arrives): always from the neutral pose, never from the previous figure's state
window.rebuild = spec => { window.MINIFIG_SPEC = JSON.parse(JSON.stringify(spec || {})); $('msg').textContent = 'Збираю фігурку…'; return doBuild(); };
window.savePng = () => { wake(); renderer.render(scene, camera); const a = document.createElement('a'); a.download = 'lego-minifig-3d.png'; a.href = canvas.toDataURL('image/png'); a.click(); };
doBuild();
