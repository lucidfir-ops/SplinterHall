// 3D models for items, crates, the jetpack and serpent segments, built from geometry at load.
// Item models lie along +x with the grip at the origin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const M = {};
function mats() {
  if (M.metal) return M;
  M.metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.28 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.8, roughness: 0.45 });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.9, roughness: 0.35 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, metalness: 0, roughness: 0.75 });
  M.leather = new THREE.MeshStandardMaterial({ color: 0x3a2318, metalness: 0, roughness: 0.85 });
  M.bone = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, metalness: 0, roughness: 0.6 });
  M.olive = new THREE.MeshStandardMaterial({ color: 0x4a5236, metalness: 0.5, roughness: 0.55 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.35 });
  const glow = (c, i = 3) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: i, roughness: 0.4 });
  M.cyan = glow(0x3ff0ff); M.orange = glow(0xff7a1a); M.blue = glow(0x2a7dff); M.white = glow(0xf0fff8, 1.6);
  M.red = glow(0xff2a1a, 2); M.rune = glow(0xffa030, 2.5); M.green = glow(0x8bff5a, 2.5);
  M.stone = new THREE.MeshStandardMaterial({ color: 0x5c5853, metalness: 0, roughness: 0.92, flatShading: true });
  M.stoneDark = new THREE.MeshStandardMaterial({ color: 0x3a3633, metalness: 0, roughness: 0.95, flatShading: true });
  return M;
}

const cyl = (r0, r1, len, seg = 12) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateZ(-Math.PI / 2); // along +x, r0 at -x
const at = (g, x, y = 0, z = 0) => g.translate(x, y, z);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const extrude = (pts, depth, bevel = 0.008) => {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
};

function group(parts) {
  // parts: [[geometry, material], ...] → merges geometries that share a material.
  const byMat = new Map();
  for (const [g, m] of parts) { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g.index ? g.toNonIndexed() : g); }
  const grp = new THREE.Group();
  for (const [m, gs] of byMat) {
    for (const g of gs) { g.deleteAttribute('uv'); }
    const merged = mergeGeometries(gs.map((g) => { if (!g.attributes.normal) g.computeVertexNormals(); return g; }), false);
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    grp.add(mesh);
  }
  return grp;
}

const BUILD = {
  axe() {
    const m = mats();
    return group([
      [at(cyl(0.03, 0.026, 1.0), 0.35), m.wood],
      [at(cyl(0.035, 0.035, 0.1), -0.08), m.leather],
      [extrude([[0.68, 0.02], [0.86, 0.06], [0.98, 0.2], [1.0, 0.04], [0.96, -0.2], [0.82, -0.32], [0.74, -0.18], [0.68, -0.05]], 0.03), m.metal],
      [at(box(0.08, 0.1, 0.07), 0.7, 0.0), m.dark],
    ]);
  },
  sword() {
    const m = mats();
    return group([
      [at(cyl(0.03, 0.03, 0.26), 0.0), m.leather],
      [at(new THREE.OctahedronGeometry(0.06), -0.16), m.brass],
      [at(box(0.06, 0.34, 0.07), 0.15), m.dark],
      [extrude([[0.18, 0.055], [1.42, 0.04], [1.58, 0], [1.42, -0.04], [0.18, -0.055]], 0.025, 0.006), m.metal],
      [extrude([[0.2, 0.012], [1.35, 0.008], [1.35, -0.008], [0.2, -0.012]], 0.032, 0.002), m.dark],
    ]);
  },
  hammer() {
    const m = mats();
    return group([
      [at(cyl(0.034, 0.03, 1.12), 0.45), m.wood],
      [at(cyl(0.038, 0.038, 0.14), -0.06), m.leather],
      [at(new THREE.BoxGeometry(0.26, 0.56, 0.28), 1.05), m.dark],
      [at(new THREE.BoxGeometry(0.3, 0.08, 0.3), 1.05, 0.2), m.metal],
      [at(new THREE.BoxGeometry(0.3, 0.08, 0.3), 1.05, -0.2), m.metal],
      [at(new THREE.BoxGeometry(0.27, 0.05, 0.29), 1.05, 0.0), m.rune],
    ]);
  },
  blunderbuss() {
    const m = mats();
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.045 + Math.pow(t, 3) * 0.1, t * 0.95)); }
    pts.push(new THREE.Vector2(0.12, 0.95));
    const barrel = new THREE.LatheGeometry(pts, 14).rotateZ(-Math.PI / 2);
    return group([
      [at(barrel, 0.05, 0.04), m.brass],
      [extrude([[0.12, 0.02], [-0.25, 0.0], [-0.42, -0.1], [-0.44, -0.2], [-0.3, -0.16], [-0.05, -0.08], [0.12, -0.04]], 0.07), m.wood],
      [at(box(0.06, 0.06, 0.03), 0.12, -0.08), m.dark],
    ]);
  },
  rocket() {
    const m = mats();
    return group([
      [at(cyl(0.1, 0.1, 1.2, 16), 0.25, 0.08), m.olive],
      [at(cyl(0.12, 0.12, 0.08, 16), 0.84, 0.08), m.dark],
      [at(cyl(0.12, 0.12, 0.08, 16), -0.33, 0.08), m.dark],
      [at(new THREE.ConeGeometry(0.075, 0.2, 12).rotateZ(-Math.PI / 2), 0.96, 0.08), m.red],
      [at(box(0.06, 0.14, 0.05), 0.0, -0.06), m.dark],
      [at(box(0.18, 0.05, 0.04), 0.3, 0.2), m.dark],
    ]);
  },
  bombs() {
    const m = mats();
    return group([
      [at(new THREE.IcosahedronGeometry(0.2, 2), 0.18), m.dark],
      [at(cyl(0.05, 0.05, 0.08, 10).rotateZ(Math.PI / 2), 0.18, 0.22), m.brass],
      [at(cyl(0.012, 0.012, 0.12, 6).rotateZ(Math.PI / 2), 0.2, 0.3), m.leather],
      [at(new THREE.IcosahedronGeometry(0.03, 0), 0.21, 0.37), m.orange],
    ]);
  },
  web() {
    const m = mats();
    return group([
      [at(box(0.42, 0.14, 0.12), 0.18, 0.05), m.dark],
      [at(cyl(0.065, 0.065, 0.26, 12), 0.16, 0.18), m.glass],
      [at(cyl(0.05, 0.05, 0.24, 12), 0.16, 0.18), m.white],
      [at(cyl(0.04, 0.02, 0.18, 10), 0.48, 0.05), m.metal],
      [at(box(0.06, 0.16, 0.06), 0.02, -0.08), m.leather],
    ]);
  },
  tractor() {
    const m = mats();
    const ring = (x, r) => at(new THREE.TorusGeometry(r, 0.02, 6, 16).rotateY(Math.PI / 2), x, 0.04);
    return group([
      [at(cyl(0.07, 0.09, 0.5, 12), 0.2, 0.04), m.dark],
      [ring(0.5, 0.11), m.cyan], [ring(0.58, 0.085), m.cyan], [ring(0.65, 0.06), m.cyan],
      [at(box(0.06, 0.16, 0.06), 0.02, -0.08), m.dark],
      [at(cyl(0.03, 0.03, 0.06, 8), 0.47, 0.04), m.cyan],
    ]);
  },
  portal() {
    const m = mats();
    return group([
      [at(box(0.44, 0.15, 0.13), 0.18, 0.05), m.bone],
      [at(cyl(0.045, 0.06, 0.16, 12), 0.47, 0.05), m.dark],
      [at(new THREE.TorusGeometry(0.06, 0.018, 6, 14).rotateY(Math.PI / 2), 0.52, 0.05), m.orange],
      [at(new THREE.TorusGeometry(0.05, 0.016, 6, 14).rotateY(Math.PI / 2), 0.57, 0.05), m.blue],
      [at(box(0.06, 0.16, 0.06), 0.02, -0.08), m.dark],
      [at(new THREE.IcosahedronGeometry(0.04, 1), 0.25, 0.14), m.white],
    ]);
  },
  horn() {
    const m = mats();
    // A curved horn swept along a quadratic curve with a widening radius.
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(0.35, 0.3, 0), new THREE.Vector3(0.75, 0.05, 0));
    const N = 18, R = 10;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPoint(t), tan = curve.getTangent(t);
      const nrm = new THREE.Vector3(-tan.y, tan.x, 0), bin = new THREE.Vector3(0, 0, 1);
      const r = 0.025 + Math.pow(t, 2.2) * 0.13;
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        pos.push(p.x + (nrm.x * Math.cos(a) + bin.x * Math.sin(a)) * r, p.y + (nrm.y * Math.cos(a)) * r, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.setIndex(idx);
    hg.computeVertexNormals();
    const band = (t) => { const p = curve.getPoint(t); return at(new THREE.TorusGeometry(0.025 + Math.pow(t, 2.2) * 0.13 + 0.012, 0.014, 5, 12).rotateY(Math.PI / 2).rotateZ(Math.atan2(curve.getTangent(t).y, curve.getTangent(t).x)), p.x, p.y); };
    return group([[hg, m.bone], [band(0.25), m.brass], [band(0.6), m.brass], [band(0.97), m.rune]]);
  },
  jetpack() {
    const m = mats();
    return group([
      [at(new THREE.CapsuleGeometry(0.09, 0.32, 4, 10), 0, 0, 0.11), m.olive],
      [at(new THREE.CapsuleGeometry(0.09, 0.32, 4, 10), 0, 0, -0.11), m.olive],
      [at(box(0.08, 0.42, 0.3), 0.09), m.dark],
      [at(new THREE.ConeGeometry(0.06, 0.12, 10).rotateX(Math.PI), 0, -0.3, 0.11), m.dark],
      [at(new THREE.ConeGeometry(0.06, 0.12, 10).rotateX(Math.PI), 0, -0.3, -0.11), m.dark],
      [at(box(0.03, 0.06, 0.22), -0.08, 0.12), m.orange],
    ]);
  },
  crate() {
    const m = mats();
    const parts = [[new THREE.BoxGeometry(0.84, 0.84, 0.84), m.wood]];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push([at(box(0.1, 0.1, 0.9), sx * 0.4, sy * 0.4), m.dark]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([at(box(0.1, 0.9, 0.1), sx * 0.4, 0, sz * 0.4), m.dark]);
    parts.push([at(box(0.5, 0.06, 0.02), 0, 0.0, 0.43), m.rune], [at(box(0.06, 0.4, 0.02), 0, 0.0, 0.43), m.rune]);
    return group(parts);
  },
  serpentHead() {
    const m = mats();
    const skull = new THREE.DodecahedronGeometry(0.85, 0).scale(1.35, 0.8, 0.85);
    return group([
      [skull, m.stone],
      [at(new THREE.DodecahedronGeometry(0.5, 0).scale(1.6, 0.35, 0.8), 0.7, -0.45), m.stoneDark],
      [at(new THREE.ConeGeometry(0.16, 0.7, 5).rotateZ(-Math.PI / 2 - 0.5), 0.2, 0.75, 0.32), m.stoneDark],
      [at(new THREE.ConeGeometry(0.16, 0.7, 5).rotateZ(-Math.PI / 2 - 0.5), 0.2, 0.75, -0.32), m.stoneDark],
      [at(new THREE.OctahedronGeometry(0.12, 0), 0.75, 0.22, 0.42), m.rune],
      [at(new THREE.OctahedronGeometry(0.12, 0), 0.75, 0.22, -0.42), m.rune],
    ]);
  },
  serpentSeg() {
    const m = mats();
    return group([
      [new THREE.DodecahedronGeometry(0.72, 0).scale(1.1, 0.95, 0.95), m.stone],
      [at(new THREE.ConeGeometry(0.14, 0.6, 4), 0, 0.75), m.stoneDark],
      [at(new THREE.BoxGeometry(0.2, 0.9, 1.25), 0.1, 0), m.rune],
    ]);
  },
};

const cache = new Map();
export function itemModel(kind) {
  if (!cache.has(kind)) {
    const g = BUILD[kind] ? BUILD[kind]() : BUILD.crate();
    cache.set(kind, g);
  }
  return cache.get(kind).clone();
}

// A model centred on its bounding box (for items lying in the world, whose bodies are centred).
export function centredModel(kind) {
  const inner = itemModel(kind);
  const box3 = new THREE.Box3().setFromObject(inner);
  const c = box3.getCenter(new THREE.Vector3());
  inner.position.sub(c);
  inner.position.z = 0;
  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}

export function modelMaterials() { return mats(); }
