// Views of everything the simulation tracks besides blocks and fighters.
import * as THREE from 'three';
import { PROP_DEF, propParts } from '../sim/props.js';
import { centredModel, itemModel, modelMaterials } from './models.js';
import { FIGHTER_COLORS } from '../core/consts.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let barrelMat = null;

const PORTAL_COL = [0xff7a1a, 0x2a8dff];

function propMesh(part, kind, setting) {
  const m = modelMaterials();
  let mesh;
  if (kind === 'crate') { mesh = centredModel('crate'); mesh.scale.setScalar(part.hx * 2 / 0.84); }
  else if (kind === 'barrel') {
    // Three draws a barrel (body, the three iron bands as one mesh, the warning mark); materials shared.
    const g = new THREE.Group();
    if (!barrelMat) barrelMat = new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(part.hx, part.hx * 0.92, part.hy * 2, 16), barrelMat);
    const ring = (y) => new THREE.CylinderGeometry(part.hx + 0.02, part.hx + 0.02, 0.06, 16).translate(0, y, 0);
    const bands = new THREE.Mesh(mergeGeometries([ring(part.hy * 0.7), ring(-part.hy * 0.7), ring(0)]), m.dark);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.05), m.red);
    mark.position.set(0, 0, part.hx + 0.01);
    g.add(body, bands, mark);
    mesh = g;
  } else if (kind === 'boulder') {
    mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(part.r, 1), new THREE.MeshStandardMaterial({ color: setting === 'forge' ? 0x231d1a : 0x6a6660, roughness: 0.95, flatShading: true }));
  } else if (kind === 'plank') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(part.hx * 2, part.hy * 2, 0.6), new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 }));
  } else if (kind === 'chain' || kind === 'lantern') {
    if (part.end) {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(part.hx * 2, part.hy * 2, part.hx * 2), new THREE.MeshStandardMaterial({ color: 0x1a1816, metalness: 0.7, roughness: 0.5, wireframe: false }));
      const core = new THREE.Mesh(new THREE.BoxGeometry(part.hx * 1.5, part.hy * 1.4, part.hx * 1.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffa040, emissiveIntensity: 4 }));
      g.add(frame, core);
      mesh = g;
    } else {
      const len = part.len;
      mesh = new THREE.Mesh(new THREE.TorusGeometry(len * 0.32, part.r * 0.9, 5, 12).scale(1, 1.5, 1), m.dark);
      if (part.link % 2) mesh.rotation.y = Math.PI / 2;
      const outer = new THREE.Group(); outer.add(mesh); mesh = outer;
      // Torus lies in xy; rotate so its long axis is along the link.
      mesh.children[0].rotation.z = Math.PI / 2;
      mesh.children[0].rotation.x = part.link % 2 ? Math.PI / 2 : 0;
    }
  } else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), m.dark);
  mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return mesh;
}

// A glowing tube between two points (beams, web lines).
function tube(color, radius, opacity = 1) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 8, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opacity >= 1, toneMapped: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
function stretch(mesh, x0, y0, x1, y1, z = 0.1) {
  const dx = x1 - x0, dy = y1 - y0;
  mesh.position.set(x0, y0, z);
  mesh.rotation.set(0, 0, Math.atan2(dy, dx));
  mesh.scale.set(Math.hypot(dx, dy), 1, 1);
}

export class Entities {
  constructor(scene) {
    this.scene = scene;
    this.objs = new Map();     // id -> { obj, kind, z, spin }
    this.portals = new Map();  // `${slot}:${w}` -> mesh group
    this.beams = [];           // per slot: { beam, line }
    this.ties = [];
    this.globs = [];
    for (let s = 0; s < 8; s++) {
      const beam = tube(0x3ff0ff, 0.09, 0.55);
      const core = tube(0xe8ffff, 0.03, 0.9);
      const line = tube(0xf4f6ee, 0.025);
      beam.visible = core.visible = line.visible = false;
      scene.add(beam, core, line);
      this.beams.push({ beam, core, line });
    }
  }

  clear() {
    for (const o of this.objs.values()) this.scene.remove(o.obj);
    this.objs.clear();
    for (const p of this.portals.values()) this.scene.remove(p);
    this.portals.clear();
    for (const t of this.ties) this.scene.remove(t.mesh);
    for (const g of this.globs) this.scene.remove(g.mesh);
    this.ties = []; this.globs = [];
  }

  // Props are built with the level, with ids in the same order the simulation hands them out.
  buildProps(level, setting, firstId = 1) {
    let id = firstId;
    for (const p of level.props) {
      if (!PROP_DEF[p.kind]) continue;
      for (const part of propParts(p)) {
        const obj = propMesh(part, p.kind, setting);
        obj.position.set(part.x, part.y, 0);
        this.scene.add(obj);
        this.objs.set(id, { obj, kind: 'prop' });
        id++;
      }
    }
    return id;
  }

  add(id, obj, kind, z = 0) {
    this.remove(id);
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(obj);
    this.objs.set(id, { obj, kind, z });
  }
  remove(id) {
    const o = this.objs.get(id);
    if (!o) return;
    this.scene.remove(o.obj);
    this.objs.delete(id);
  }
  has(id) { return this.objs.has(id); }

  item(id, kind, crated) { this.add(id, centredModel(crated ? 'crate' : kind), crated ? 'crate' : 'item', 0); this.objs.get(id).itemKind = kind; }
  uncrate(id) { const o = this.objs.get(id); if (o) this.item(id, o.itemKind, false); }
  bomb(id) { this.add(id, new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 2), modelMaterials().dark), 'bomb'); }
  rocket(id) {
    const g = new THREE.Group();
    const m = modelMaterials();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).rotateZ(Math.PI / 2), m.olive);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 10).rotateZ(-Math.PI / 2), m.red);
    tip.position.x = 0.34;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.02), m.dark);
    fin.position.x = -0.22;
    g.add(body, tip, fin);
    this.add(id, g, 'rocket');
  }
  glob(id) { this.add(id, new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), modelMaterials().white), 'glob'); }
  serpent(ids) {
    ids.forEach((id, k) => {
      const obj = itemModel(k === 0 ? 'serpentHead' : 'serpentSeg');
      const s = k === 0 ? 1 : 1 - (k / ids.length) * 0.45;
      obj.scale.setScalar(s);
      this.add(id, obj, 'serpent');
    });
  }

  portal(slot, w, x, y, nx, ny, off) {
    const key = slot + ':' + w;
    const old = this.portals.get(key);
    if (old) { this.scene.remove(old); this.portals.delete(key); }
    if (off) return;
    const g = new THREE.Group();
    const col = PORTAL_COL[w];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.1, 8, 40).scale(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 4 }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(col) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uT; uniform vec3 uC; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float sw = sin(a * 5.0 + r * 12.0 - uT * 6.0) * 0.5 + 0.5;
          vec3 c = mix(uC * 0.15, uC * 2.2, sw * (1.0 - r) + pow(r, 6.0));
          gl_FragColor = vec4(c, 1.0); }`,
      toneMapped: false, side: THREE.DoubleSide,
    }));
    g.add(ring, disc);
    // The ring stands on the surface, facing along its normal; squash it in depth so it reads side-on.
    g.position.set(x + nx * 0.05, y + ny * 0.05, 0);
    g.lookAt(x + nx, y + ny, 0);
    g.scale.set(1, 1, 1);
    g.userData.disc = disc;
    this.scene.add(g);
    this.portals.set(key, g);
  }

  tie(slot, x, y, dur) {
    const mesh = tube(0xf4f6ee, 0.02);
    this.scene.add(mesh);
    this.ties.push({ mesh, slot, x, y, until: dur });
  }
  splat(x, y, dur = 3) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1).scale(1, 1, 0.5), modelMaterials().white);
    mesh.position.set(x, y, 0.4);
    this.scene.add(mesh);
    this.globs.push({ mesh, until: dur });
  }

  // getBody(id) -> [x, y, rot] | null ; proj: flat [id, x, y, ang]; fighters: frame entries.
  update(dt, t, getBody, proj, fighters) {
    for (const [id, o] of this.objs) {
      const b = getBody(id);
      if (!b) continue;
      o.obj.position.set(b[0], b[1], o.z || 0);
      o.obj.rotation.set(0, 0, b[2]);
    }
    for (let k = 0; k < proj.length; k += 4) {
      const o = this.objs.get(proj[k]);
      if (!o) continue;
      o.obj.position.set(proj[k + 1], proj[k + 2], 0);
      o.obj.rotation.set(0, 0, proj[k + 3]);
    }
    for (const p of this.portals.values()) p.userData.disc.material.uniforms.uT.value = t;
    // Beams and web lines from the fighters' hands.
    const bySlot = new Map(fighters.map((f) => [f.slot, f]));
    this.beams.forEach((B, s) => {
      const f = bySlot.get(s);
      B.beam.visible = B.core.visible = B.line.visible = false;
      if (!f) return;
      const hx = f.parts[15] + Math.sin(f.parts[17]) * 0.55, hy = f.parts[16] - Math.cos(f.parts[17]) * 0.55;
      if (f.beam) {
        stretch(B.beam, hx, hy, f.beam[0], f.beam[1], 0.15);
        stretch(B.core, hx, hy, f.beam[0], f.beam[1], 0.15);
        const pulse = 1 + Math.sin(t * 40) * 0.25;
        B.beam.scale.y = B.beam.scale.z = pulse;
        B.beam.visible = B.core.visible = true;
      }
      if (f.line) {
        const lx = f.parts[15] + Math.sin(f.parts[17]) * 0.2, ly = f.parts[16] - Math.cos(f.parts[17]) * 0.2;
        stretch(B.line, lx, ly, f.line[0], f.line[1], 0.18);
        B.line.visible = true;
      }
    });
    this.ties = this.ties.filter((T) => {
      T.until -= dt;
      const f = bySlot.get(T.slot);
      if (T.until <= 0 || !f) { this.scene.remove(T.mesh); return false; }
      stretch(T.mesh, f.parts[3], f.parts[4], T.x, T.y, 0.1);
      return true;
    });
    this.globs = this.globs.filter((g) => { g.until -= dt; if (g.until <= 0) { this.scene.remove(g.mesh); return false; } return true; });
  }
}

export const portalColor = (w) => PORTAL_COL[w];
export const fighterHex = (s) => FIGHTER_COLORS[s].hex;
