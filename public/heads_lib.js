import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// Build meshes from an LDraw printed head, keeping print colours; main colour (code 16) becomes the skin colour.
export function headMeshes(group, skin) {
  group.updateMatrixWorld(true); const by = new Map();
  group.traverse(o => { if (!o.isMesh) return; const mats = Array.isArray(o.material) ? o.material : [o.material];
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) { const m = mats[gr.materialIndex || 0]; const code = String(m.userData?.code ?? ''); const key = code === '16' || code === 'Main_Colour' ? 'skin' : '#' + m.color.getHexString();
      const g = new THREE.BufferGeometry(); for (const a of ['position', 'normal']) { const src = geo.attributes[a]; if (!src) continue; g.setAttribute(a, new THREE.BufferAttribute(src.array.slice(gr.start * 3, (gr.start + gr.count) * 3), 3)); }
      if (!g.attributes.normal) g.computeVertexNormals(); g.applyMatrix4(o.matrixWorld); (by.get(key) || by.set(key, []).get(key)).push(g); } });
  const out = new THREE.Group();
  for (const [k, gs] of by) { const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(k === 'skin' ? skin : k), roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.18, side: THREE.DoubleSide, polygonOffset: k !== 'skin', polygonOffsetFactor: -1 });
    const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.castShadow = true; m.receiveShadow = true; m.userData.key = k; out.add(m); }
  return out;
}
