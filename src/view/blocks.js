// Instanced, chamfered blocks with PBR materials. Fixed cells sit on the grid; dynamic cells follow
// their body's transform plus their offset inside the body.
//
// Performance: each block is a 24-vertex box with a smooth chamfer (44 triangles; the old rounded box had
// 900 unshared vertices), so a whole level of blocks (about 300) is ~7,000 vertices a pass. Fixed cells are
// batched per chunk and material, with a bounding sphere per chunk so three.js can skip chunks outside the
// view and the shadow camera. At 24 vertices a block, culling saves almost nothing while every extra batch
// is another draw call (main-thread time on a phone): measured over 60 levels, 8x8-cell chunks meant 34
// draws a pass for the whole arena and 15 for a 15 m view, against 4 for one chunk. So the chunk is the
// whole arena; make CHUNK_W/CHUNK_H smaller only if blocks get much heavier. Loose cells (on moving bodies)
// go to one batch per material that is always drawn.
import * as THREE from 'three';
import { W, H, CELLS, MAT } from '../core/consts.js';
import { materialMaps } from './textures.js';
import { ihash } from '../core/rng.js';

export const BLOCK_DEPTH = 2;
const CHAMFER = 0.045;
const CHUNK_W = W, CHUNK_H = H;
const CX = Math.ceil(W / CHUNK_W);

// A box with chamfered edges whose chamfer vertices share the face normals, so the lighting rolls over the
// edge like a rounded bevel. Box UVs in world units: one texture tile per metre on every face.
export function blockGeometry(w = 1, h = 1, d = BLOCK_DEPTH, r = CHAMFER) {
  const half = [w / 2, h / 2, d / 2];
  const pos = [], nrm = [], uv = [], index = [];
  const vid = new Map(); // `${axis}${sign}|${sb}${sc}` -> vertex index
  const other = (a) => [(a + 1) % 3, (a + 2) % 3];
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    const [b, c] = other(a);
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const p = [0, 0, 0];
      p[a] = s * half[a]; p[b] = sb * (half[b] - r); p[c] = sc * (half[c] - r);
      const n = [0, 0, 0]; n[a] = s;
      vid.set(`${a}${s}|${sb}${sc}`, pos.length / 3);
      pos.push(...p); nrm.push(...n);
      if (a === 2) uv.push(p[0] + 0.5, p[1] + 0.5);
      else if (a === 1) uv.push(p[0] + 0.5, p[2] + 0.5);
      else uv.push(p[2] + 0.5, p[1] + 0.5);
    }
  }
  // The vertex of face (axis a, sign s) nearest the corner/edge given by signs per axis.
  const v = (a, sg) => { const [b, c] = other(a); return vid.get(`${a}${sg[a]}|${sg[b]}${sg[c]}`); };
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const tri = (i, j, k) => {
    // Wind outwards: the box is convex and centred, so the normal must point away from the centre.
    const A = P(i), B = P(j), C = P(k);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], t = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
    const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) index.push(i, k, j); else index.push(i, j, k);
  };
  const quad = (i, j, k, l) => { tri(i, j, k); tri(i, k, l); };
  // Faces.
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    const [b, c] = other(a);
    const g = (sb, sc) => { const sg = [0, 0, 0]; sg[a] = s; sg[b] = sb; sg[c] = sc; return v(a, sg); };
    quad(g(-1, -1), g(1, -1), g(1, 1), g(-1, 1));
  }
  // Edge chamfers: between face a and face b, along axis c.
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const c = 3 - a - b;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const sg = (sc) => { const q = [0, 0, 0]; q[a] = sa; q[b] = sb; q[c] = sc; return q; };
      quad(v(a, sg(-1)), v(a, sg(1)), v(b, sg(1)), v(b, sg(-1)));
    }
  }
  // Corners.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const sg = [sx, sy, sz];
    tri(v(0, sg), v(1, sg), v(2, sg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Each instance shifts its texture by a hash of its grid position so tiles don't repeat.
function patchMaterial(mat, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = { value: opts.snow ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDamage;\nattribute float aSeed;\nvarying float vDamage;\nvarying vec3 vWN;\nvarying float vH;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
          float hh = aSeed;
          vH = hh;
          vec2 off = vec2(hh, fract(hh * 7.13));
          #ifdef USE_MAP
            vMapUv += off;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv += off;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv += off;
          #endif
        #endif
        vDamage = aDamage;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying float vDamage;\nvarying vec3 vWN;\nvarying float vH;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Damage darkens and roughens a block before it breaks.
        diffuseColor.rgb *= mix(1.0, 0.45, vDamage);
        diffuseColor.rgb *= 0.9 + vH * 0.2;
        // Snow settles on upward faces.
        float snow = uSnow * smoothstep(0.55, 0.95, vWN.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snow * 0.85);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, vDamage * 0.6);');
  };
  mat.customProgramCacheKey = () => 'block' + (opts.snow ? 's' : '');
  return mat;
}

// One InstancedMesh of cells of one material: a fixed chunk, or the loose cells of that material.
// Removing a cell moves the last instance into its slot, so the mesh never draws empty instances.
// Only changed instances are uploaded (the loose batch uploads its live part once a frame).
function touch(attr, i, n = 1) {
  attr.addUpdateRange(i * attr.itemSize, n * attr.itemSize);
  attr.needsUpdate = true;
}

class Batch {
  constructor(owner, base, material, cap, sphere) {
    this.owner = owner;
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, base.attributes[k]);
    g.setIndex(base.index);
    g.boundingBox = base.boundingBox; g.boundingSphere = base.boundingSphere;
    this.dmg = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    g.setAttribute('aDamage', this.dmg);
    g.setAttribute('aSeed', this.seed);
    const mesh = new THREE.InstancedMesh(g, material, cap);
    mesh.count = 0;
    mesh.visible = false;
    if (sphere) mesh.boundingSphere = sphere;
    else mesh.frustumCulled = false;
    if (!sphere) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh;
    this.cells = new Int32Array(cap).fill(-1);
    this.cap = cap;
    this.loose = !sphere;
    this.dirty = false;
  }
  add(c, seed) {
    const m = this.mesh;
    if (m.count >= this.cap) return -1;
    const i = m.count++;
    this.cells[i] = c;
    this.dmg.array[i] = 0; this.seed.array[i] = seed;
    touch(this.dmg, i); touch(this.seed, i);
    m.visible = true;
    return i;
  }
  setMatrix(i, mat) {
    this.mesh.setMatrixAt(i, mat);
    if (this.loose) this.dirty = true; else touch(this.mesh.instanceMatrix, i);
  }
  remove(i) {
    const m = this.mesh, last = m.count - 1;
    if (i !== last) {
      const c = this.cells[last];
      m.instanceMatrix.array.copyWithin(i * 16, last * 16, last * 16 + 16);
      this.dmg.array[i] = this.dmg.array[last];
      this.seed.array[i] = this.seed.array[last];
      this.cells[i] = c;
      this.owner.slot[c] = i;
      touch(m.instanceMatrix, i); touch(this.dmg, i); touch(this.seed, i);
    }
    this.cells[last] = -1;
    m.count = last;
    m.visible = last > 0;
  }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.mesh.count) touch(this.mesh.instanceMatrix, 0, this.mesh.count);
  }
  dispose() { this.mesh.geometry.dispose(); }
}

export class Blocks {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.geo = blockGeometry();
    this.mat = new Map();       // material id -> THREE material
    this.chunks = new Map();    // chunk * 8 + material id -> Batch (fixed cells)
    this.loose = new Map();     // material id -> Batch (cells on moving bodies)
    this.batch = new Array(CELLS).fill(null); // cell -> its Batch
    this.slot = new Int32Array(CELLS).fill(-1); // cell -> instance index in its batch
    this.dyn = new Map();       // body id -> { cells: [{ c, ox, oy }] }
    this.cellBody = new Int32Array(CELLS).fill(-1);
    this.mats = new Uint8Array(CELLS);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._z = new THREE.Vector3(0, 0, 1);
  }

  // Every block mesh (for tests and tools).
  all() { return [...this.chunks.values(), ...this.loose.values()].map((b) => b.mesh); }

  material(setting, m) {
    const maps = materialMaps(setting, m);
    const isGlass = m === MAT.GLASS, isIce = m === MAT.ICE, isIron = m === MAT.IRON;
    const mat = new THREE.MeshStandardMaterial({
      map: maps.map, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1, metalness: isIron ? 0.75 : 0.02,
      envMapIntensity: isIce || isGlass ? 1.6 : 0.8,
      transparent: isGlass, opacity: isGlass ? 0.55 : 1,
    });
    if (maps.emissiveMap) {
      mat.emissiveMap = maps.emissiveMap;
      const rune = { bunker: 0xffb030, forge: 0xff5a10, fjord: 0x40fff0, hall: 0xff8a30 }[setting];
      mat.emissive = new THREE.Color(rune);
      mat.emissiveIntensity = 1.1;
    }
    if (isIce) { mat.emissive = new THREE.Color(0x0b3a4a); mat.emissiveIntensity = 0.5; }
    if (m === MAT.STONE && setting === 'forge') { mat.emissiveMap = maps.emissiveMap; mat.emissive = new THREE.Color(0xff4a0c); mat.emissiveIntensity = 0.95; }
    return patchMaterial(mat, { snow: setting === 'fjord' && (m === MAT.STONE || m === MAT.BEDROCK || m === MAT.WOOD) });
  }

  materialFor(m) {
    if (!this.mat.has(m)) this.mat.set(m, this.material(this.setting, m));
    return this.mat.get(m);
  }

  newBatch(m, cap, sphere) {
    const b = new Batch(this, this.geo, this.materialFor(m), cap, sphere);
    b.mesh.castShadow = m !== MAT.GLASS;
    b.mesh.receiveShadow = true;
    this.scene.add(b.mesh);
    return b;
  }

  chunkOf(c, m) {
    const i = c % W, j = (c / W) | 0;
    const ci = (i / CHUNK_W) | 0, cj = (j / CHUNK_H) | 0;
    const key = (cj * CX + ci) * 8 + m;
    let b = this.chunks.get(key);
    if (!b) {
      // A sphere around the chunk's cells, deep enough for the stepped facade (z from -1 to about 1.75).
      const x0 = ci * CHUNK_W, y0 = cj * CHUNK_H, x1 = Math.min(W, x0 + CHUNK_W), y1 = Math.min(H, y0 + CHUNK_H);
      const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
      const sphere = new THREE.Sphere(new THREE.Vector3(x0 + hx, y0 + hy, 0.4), Math.hypot(hx + 0.1, hy + 0.1, 1.45));
      b = this.newBatch(m, CHUNK_W * CHUNK_H, sphere);
      this.chunks.set(key, b);
    }
    return b;
  }

  looseOf(m) {
    let b = this.loose.get(m);
    if (!b) { b = this.newBatch(m, CELLS, null); this.loose.set(m, b); }
    return b;
  }

  build(level, setting) {
    this.clear();
    this.setting = setting;
    for (let c = 0; c < CELLS; c++) if (level.grid[c]) this.addCell(c, level.grid[c]);
  }

  addCell(c, m) {
    if (!m || m > 6) return;
    if (this.batch[c]) this.removeCell(c);
    const b = this.chunkOf(c, m);
    const idx = b.add(c, ihash(c, 7));
    if (idx < 0) return;
    this.batch[c] = b;
    this.slot[c] = idx;
    this.mats[c] = m;
    this.place(c, (c % W) + 0.5, ((c / W) | 0) + 0.5, 0);
  }

  place(c, x, y, rot) {
    const b = this.batch[c], idx = this.slot[c];
    if (!b || idx < 0) return;
    const m = this.mats[c];
    this._q.setFromAxisAngle(this._z, rot);
    // A stepped facade: each cell sticks out by its own amount so blocks cast shadows on each other.
    const h = ihash(c, 3);
    const depth = m === MAT.GLASS ? 0.5 : m === MAT.BEDROCK ? 1.2 : h < 0.55 ? 1 : h < 0.85 ? 1.18 : 1.36;
    this._s.set(1, 1, depth);
    this._p.set(x, y, (depth - 1) * (BLOCK_DEPTH / 2) * (h > 0.5 ? 1 : 0.4));
    this._m.compose(this._p, this._q, this._s);
    this._s.set(1, 1, 1);
    b.setMatrix(idx, this._m);
  }

  removeCell(c) {
    const b = this.batch[c], idx = this.slot[c];
    if (!b || idx < 0) return;
    b.remove(idx);
    this.batch[c] = null;
    this.slot[c] = -1;
    this.mats[c] = 0;
    const body = this.cellBody[c];
    if (body >= 0) {
      const d = this.dyn.get(body);
      if (d) d.cells = d.cells.filter((e) => e.c !== c);
      this.cellBody[c] = -1;
    }
  }

  setDamage(c, f) {
    const b = this.batch[c], idx = this.slot[c];
    if (!b || idx < 0) return;
    b.dmg.array[idx] = 1 - f;
    touch(b.dmg, idx);
  }

  // Move a fixed cell into its material's loose batch, keeping where it is drawn and how damaged it is.
  loosen(c) {
    const b = this.batch[c], idx = this.slot[c], m = this.mats[c];
    if (!b || idx < 0 || this.loose.get(m) === b) return;
    const L = this.looseOf(m);
    b.mesh.getMatrixAt(idx, this._m);
    const dmg = b.dmg.array[idx], seed = b.seed.array[idx];
    b.remove(idx);
    const j = L.add(c, seed);
    if (j < 0) { this.batch[c] = null; this.slot[c] = -1; this.mats[c] = 0; return; }
    L.dmg.array[j] = dmg;
    L.setMatrix(j, this._m);
    this.batch[c] = L;
    this.slot[c] = j;
  }

  // A group of cells now moves as body `id`, which was at (x, y) with rotation 0 when it detached.
  detach(id, cells, x, y) {
    const list = cells.map((c) => ({ c, ox: (c % W) + 0.5 - x, oy: ((c / W) | 0) + 0.5 - y }));
    for (const e of list) {
      const old = this.cellBody[e.c];
      if (old >= 0 && old !== id) { const d = this.dyn.get(old); if (d) d.cells = d.cells.filter((q) => q.c !== e.c); }
      this.cellBody[e.c] = id;
      this.loosen(e.c);
    }
    this.dyn.set(id, { cells: list });
  }

  split(id, parts) {
    this.dyn.delete(id);
    for (const [c, nid] of parts) {
      this.cellBody[c] = nid;
      this.loosen(c);
      this.dyn.set(nid, { cells: [{ c, ox: 0, oy: 0 }] });
    }
  }

  bodyGone(id) {
    const d = this.dyn.get(id);
    if (!d) return;
    for (const e of d.cells) if (this.mats[e.c]) this.removeCell(e.c);
    this.dyn.delete(id);
  }

  // Place dynamic cells from body transforms: get(id) -> [x, y, rot] or null.
  update(get) {
    for (const [id, d] of this.dyn) {
      const t = get(id);
      if (!t) continue;
      const x = t[0], y = t[1], r = t[2];
      const cs = Math.cos(r), sn = Math.sin(r);
      const cells = d.cells;
      for (let k = 0; k < cells.length; k++) { const e = cells[k]; this.place(e.c, x + cs * e.ox - sn * e.oy, y + sn * e.ox + cs * e.oy, r); }
    }
    for (const b of this.loose.values()) b.flush();
  }

  // World position of a cell right now (for effects).
  cellPos(c) {
    const b = this.batch[c], idx = this.slot[c];
    if (!b || idx < 0) return { x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 };
    b.mesh.getMatrixAt(idx, this._m);
    return { x: this._m.elements[12], y: this._m.elements[13] };
  }

  clear() {
    for (const b of [...this.chunks.values(), ...this.loose.values()]) { this.scene.remove(b.mesh); b.dispose(); }
    for (const mat of this.mat.values()) mat.dispose();
    this.chunks.clear(); this.loose.clear(); this.mat.clear(); this.dyn.clear();
    this.batch.fill(null); this.slot.fill(-1); this.cellBody.fill(-1); this.mats.fill(0);
  }
}
