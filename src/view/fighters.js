// Fighter meshes: instanced capsules and heads in each fighter's colour with a glowing core,
// a dark inverted-hull outline, held items in the hand and the jetpack on the back.
// Bodies are drawn from the animated 3D skeleton in each frame (joints), so limbs reach toward and away from
// the camera; the ragdoll's joints come through the same way when a fighter is knocked loose.
import * as THREE from 'three';
import { PARTS, LARM_F, TORSO, HEAD } from '../sim/fighter.js';
import { J, SEGS } from '../anim/skeleton.js';
import { FIGHTER_COLORS, FIGHTER_HP } from '../core/consts.js';
import { itemModel } from './models.js';

const Z = [0, 0, -0.16, -0.16, 0.16, 0.16, -0.09, -0.09, 0.09, 0.09];

// Stick proportions: thin glowing limbs, a slim spine and a big round head.
const VIS_R = { head: 0.235, torso: 0.085, uarmB: 0.068, larmB: 0.064, uarmF: 0.068, larmF: 0.064, thighB: 0.075, shinB: 0.07, thighF: 0.075, shinF: 0.07 };
function partGeometry(def) {
  if (def.shape === 'ball') return new THREE.SphereGeometry(VIS_R.head, 18, 12); // indexed: about a tenth of the vertices of the old icosahedron
  const r = VIS_R[def.name] || def.r;
  // The spine reaches from the hips to the neck, so the torso capsule is drawn a little longer.
  const len = def.name === 'torso' ? def.hh * 2 + 0.16 : def.hh * 2 + (def.r - r) * 2;
  return new THREE.CapsuleGeometry(r, len, 6, 12);
}

function bodyMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        // A glowing core: the fighter's own colour, strongest facing the camera.
        float facing = clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
        totalEmissiveRadiance += vColor.rgb * (0.22 + 0.5 * pow(facing, 3.0));
      #endif`);
  };
  m.customProgramCacheKey = () => 'fighterBody';
  return m;
}

function outlineMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.026;');
  };
  m.customProgramCacheKey = () => 'fighterOutline';
  return m;
}

// Swing trails: a fading ribbon behind whatever is striking (fist, foot, blade), so fast arcs read.
const TRAIL_N = 18, TRAIL_LIFE = 0.14;
const REACH = { 6: 0.95, 7: 1.55, 8: 1.15 };
class Trail {
  constructor(scene, color) {
    this.pts = []; // { a: [x,y,z], b: [x,y,z], t }
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.alpha = new Float32Array(TRAIL_N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(color).multiplyScalar(1.4) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(mix(uC, vec3(1.0), 0.35) * 1.3, vA * 0.55); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  // f: frame fighter; t: view time.
  update(f, t) {
    const j = f.joints, s = f.strike | 0;
    if (j && s && f.alive) {
      const P = (k) => [j[k * 3], j[k * 3 + 1], j[k * 3 + 2]];
      let a, b;
      if (s === 1) { a = P(J.ELB_F); b = P(J.HAND_F); }
      else if (s === 2) { a = P(J.ELB_B); b = P(J.HAND_B); }
      else if (s === 3) { a = P(J.KNEE_F); b = P(J.FOOT_F); }
      else if (s === 4) { a = P(J.KNEE_B); b = P(J.FOOT_B); }
      else if (s === 5) { const k1 = P(J.KNEE_F), k2 = P(J.KNEE_B), f1 = P(J.FOOT_F), f2 = P(J.FOOT_B); a = k1.map((v, i) => (v + k2[i]) / 2); b = f1.map((v, i) => (v + f2[i]) / 2); }
      else {
        const e = P(J.ELB_F), h = P(J.HAND_F), d = [h[0] - e[0], h[1] - e[1], h[2] - e[2]], l = Math.hypot(...d) || 1, r = REACH[s] || 1;
        a = [h[0] + (d[0] / l) * r * 0.35, h[1] + (d[1] / l) * r * 0.35, h[2] + (d[2] / l) * r * 0.35];
        b = [h[0] + (d[0] / l) * (r + 0.05), h[1] + (d[1] / l) * (r + 0.05), h[2] + (d[2] / l) * (r + 0.05)];
      }
      // Only the outer part of a limb trails (the fist or foot end).
      if (s <= 5) a = [a[0] + (b[0] - a[0]) * 0.45, a[1] + (b[1] - a[1]) * 0.45, a[2] + (b[2] - a[2]) * 0.45];
      const last = this.pts[this.pts.length - 1];
      if (!last || Math.hypot(b[0] - last.b[0], b[1] - last.b[1], b[2] - last.b[2]) > 0.02) this.pts.push({ a, b, t });
      if (this.pts.length > TRAIL_N) this.pts.shift();
    }
    while (this.pts.length && t - this.pts[0].t > TRAIL_LIFE) this.pts.shift();
    const n = this.pts.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const k = i * 6;
      this.pos[k] = p.a[0]; this.pos[k + 1] = p.a[1]; this.pos[k + 2] = p.a[2];
      this.pos[k + 3] = p.b[0]; this.pos[k + 4] = p.b[1]; this.pos[k + 5] = p.b[2];
      const life = i < n ? Math.max(0, 1 - (t - p.t) / TRAIL_LIFE) * (i / (n - 1)) : 0;
      this.alpha[i * 2] = life * 0.15; this.alpha[i * 2 + 1] = life;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class FighterView {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    this.outlines = [];
    const bm = bodyMaterial(), om = outlineMaterial();
    PARTS.forEach((def) => {
      const g = partGeometry(def);
      const mesh = new THREE.InstancedMesh(g, bm, 8);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 8;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ol = new THREE.InstancedMesh(g, om, 8);
      ol.frustumCulled = false;
      ol.count = 8;
      scene.add(mesh, ol);
      this.meshes.push(mesh);
      this.outlines.push(ol);
    });
    this.colors = FIGHTER_COLORS.map((c) => new THREE.Color(c.hex));
    this._c = new THREE.Color();
    this._grey = new THREE.Color(0x555555);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._z = new THREE.Vector3(0, 0, 1);
    this._y = new THREE.Vector3(0, 1, 0);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._bx = new THREE.Vector3(); this._by = new THREE.Vector3(); this._bz = new THREE.Vector3();
    this.held = Array.from({ length: 8 }, () => ({ kind: null, obj: null, back: null, backObj: null }));
    this.trails = FIGHTER_COLORS.map((c) => new Trail(scene, c.hex));
    this.marker = this.makeMarker();
    this.spot = this.makeSpot();
    this.local = -1;
    this.hide();
  }

  makeMarker() {
    // A small 3D chevron above the local fighter's head.
    const sh = new THREE.Shape([new THREE.Vector2(-0.22, 0.18), new THREE.Vector2(0, -0.08), new THREE.Vector2(0.22, 0.18), new THREE.Vector2(0.22, 0.32), new THREE.Vector2(0, 0.06), new THREE.Vector2(-0.22, 0.32)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.5 });
    const mesh = new THREE.Mesh(g, m);
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  // Round start: an octagon around the local fighter, a light shaft above and a big chevron, in their colour.
  // It holds through the drop-in and fades as the fight starts.
  makeSpot() {
    const g = new THREE.Group();
    const add = { transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending };
    const top = { ...add, depthTest: false }; // drawn over the scenery so nothing hides who you are
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.2, 8, 1, Math.PI / 8), new THREE.MeshBasicMaterial({ color: 0xffffff, ...top }));
    ring.position.z = 0.7;
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.85, 8, 1, Math.PI / 8), new THREE.MeshBasicMaterial({ color: 0xffffff, ...top }));
    inner.position.z = 0.7;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 26), new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color() }, uO: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uC; uniform float uO; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * (1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0)); gl_FragColor = vec4(uC * 1.6, a * uO); }',
      ...add,
    }));
    beam.position.set(0, 13 + 1.1, -0.3);
    const chev = new THREE.Mesh(this.marker.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, ...top }));
    for (const m of [ring, inner, chev]) m.renderOrder = 20;
    chev.scale.setScalar(2.4);
    g.add(ring, inner, beam, chev);
    g.visible = false;
    this.scene.add(g);
    return { g, ring, inner, beam, chev };
  }

  hide() {
    this._m.makeScale(0, 0, 0);
    for (const arr of [this.meshes, this.outlines]) for (const mesh of arr) {
      for (let i = 0; i < 8; i++) mesh.setMatrixAt(i, this._m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const h of this.held) { if (h.obj) h.obj.visible = false; if (h.backObj) h.backObj.visible = false; }
    this.marker.visible = false;
    this.spot.g.visible = false;
  }

  // fighters: frame fighter entries (interpolated parts), t: time for pulses.
  // localAim: on a client, the local fighter's arm follows the stick at once (visual only).
  update(fighters, t, localSlot, localAim = null, intro = 0) {
    if (localAim !== null) {
      // A client's own aiming arm follows the stick at once (guns and tools; melee poses come from the host).
      const me = fighters.find((f) => f.slot === localSlot && f.alive && !f.swing && f.item && f.joints && !['axe', 'sword', 'hammer'].includes(f.item));
      if (me) {
        const j = me.joints = Float32Array.from(me.joints);
        const sx = j[J.SHO_F * 3], sy = j[J.SHO_F * 3 + 1];
        const dx = Math.cos(localAim), dy = Math.sin(localAim);
        j[J.ELB_F * 3] = sx + dx * 0.3; j[J.ELB_F * 3 + 1] = sy + dy * 0.3;
        j[J.HAND_F * 3] = sx + dx * 0.6; j[J.HAND_F * 3 + 1] = sy + dy * 0.6;
      }
    }
    this.hide();
    for (const f of fighters) {
      const s = f.slot;
      const base = this.colors[s];
      const col = this._c.copy(base);
      if (!f.alive) col.multiplyScalar(0.28);
      else if (f.hp < FIGHTER_HP) col.lerp(this._grey, (1 - f.hp / FIGHTER_HP) * 0.55);
      if (f.flash) col.setRGB(3, 3, 3);
      const jt = f.joints;
      for (let k = 0; k < 10; k++) {
        if (jt) {
          const [ia, ib] = SEGS[k];
          this._a.set(jt[ia * 3], jt[ia * 3 + 1], jt[ia * 3 + 2]);
          this._b.set(jt[ib * 3], jt[ib * 3 + 1], jt[ib * 3 + 2]);
          this._p.addVectors(this._a, this._b).multiplyScalar(0.5);
          this._d.subVectors(this._b, this._a);
          const l = this._d.length();
          if (l > 1e-4) this._q.setFromUnitVectors(this._y, this._d.multiplyScalar(1 / l));
          else this._q.identity();
        } else {
          const x = f.parts[k * 3], y = f.parts[k * 3 + 1], a = f.parts[k * 3 + 2];
          this._q.setFromAxisAngle(this._z, a);
          this._p.set(x, y, Z[k]);
        }
        this._m.compose(this._p, this._q, this._s);
        this.meshes[k].setMatrixAt(s, this._m);
        this.meshes[k].setColorAt(s, col);
        this.outlines[k].setMatrixAt(s, this._m);
      }
      this.updateHeld(f);
      this.trails[s].update(f, t);
      if (s === localSlot && f.alive) {
        const hx = jt ? jt[J.HEAD * 3] : f.parts[HEAD * 3], hy = jt ? jt[J.HEAD * 3 + 1] : f.parts[HEAD * 3 + 1];
        this.marker.visible = true;
        this.marker.position.set(hx, hy + 0.55 + Math.sin(t * 5) * 0.06, -0.04);
        this.marker.material.emissive.copy(base);
        if (intro > 0.01) {
          const S = this.spot, tx = f.parts[TORSO * 3], ty = f.parts[TORSO * 3 + 1];
          const e = intro * intro * (3 - 2 * intro); // smooth fade
          S.g.visible = true;
          S.g.position.set(tx, ty, 0);
          const pulse = 1 + 0.08 * Math.sin(t * 7);
          S.ring.scale.setScalar((0.55 + 0.45 * e) * pulse);
          S.inner.scale.setScalar((0.55 + 0.45 * e) / pulse);
          S.ring.rotation.z = t * 0.6; S.inner.rotation.z = -t * 0.9;
          for (const m of [S.ring.material, S.inner.material, S.chev.material]) m.color.copy(base).multiplyScalar(1.6);
          S.ring.material.opacity = 0.95 * e; S.inner.material.opacity = 0.6 * e; S.chev.material.opacity = e;
          S.beam.material.uniforms.uC.value.copy(base); S.beam.material.uniforms.uO.value = 0.55 * e;
          S.chev.position.set(0, hy - ty + 1.35 + Math.sin(t * 5) * 0.12, 0.2);
        }
      }
    }
    for (let s = 0; s < 8; s++) if (!fighters.some((f) => f.slot === s)) this.trails[s].mesh.visible = false;
    for (const mesh of this.meshes) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    for (const mesh of this.outlines) mesh.instanceMatrix.needsUpdate = true;
  }

  updateHeld(f) {
    const h = this.held[f.slot];
    if (h.kind !== f.item) {
      if (h.obj) this.scene.remove(h.obj);
      h.obj = f.item ? itemModel(f.item) : null;
      if (h.obj) this.scene.add(h.obj);
      h.kind = f.item;
    }
    if (h.obj && f.joints) {
      // Grip in the near hand, the item along the forearm in 3D, its blade side from the pose.
      const j = f.joints;
      this._a.set(j[J.ELB_F * 3], j[J.ELB_F * 3 + 1], j[J.ELB_F * 3 + 2]);
      this._b.set(j[J.HAND_F * 3], j[J.HAND_F * 3 + 1], j[J.HAND_F * 3 + 2]);
      const X = this._bx.subVectors(this._b, this._a);
      if (X.lengthSq() < 1e-6) X.set(f.facing, 0, 0);
      X.normalize();
      const u = f.wup || [0, 1, 0];
      const Y = this._by.set(u[0], u[1], u[2]);
      Y.addScaledVector(X, -Y.dot(X));
      if (Y.lengthSq() < 1e-4) Y.set(-X.y, X.x, 0);
      if (Y.lengthSq() < 1e-4) Y.set(0, 1, 0);
      Y.normalize();
      const Zv = this._bz.crossVectors(X, Y);
      this._m.makeBasis(X, Y, Zv);
      h.obj.visible = true;
      h.obj.position.copy(this._b).addScaledVector(X, 0.03);
      h.obj.quaternion.setFromRotationMatrix(this._m);
      h.obj.scale.set(1, 1, 1);
    } else if (h.obj) {
      // Grip at the end of the front forearm, pointing along it.
      const k = LARM_F;
      const x = f.parts[k * 3], y = f.parts[k * 3 + 1], a = f.parts[k * 3 + 2];
      const dx = Math.sin(a), dy = -Math.cos(a);
      h.obj.visible = true;
      h.obj.position.set(x + dx * 0.2, y + dy * 0.2, Z[k] + 0.06);
      h.obj.rotation.set(0, 0, Math.atan2(dy, dx));
      h.obj.scale.set(1, f.facing < 0 ? -1 : 1, 1);
    }
    if (h.back !== f.back) {
      if (h.backObj) this.scene.remove(h.backObj);
      h.backObj = f.back ? itemModel(f.back) : null;
      if (h.backObj) this.scene.add(h.backObj);
      h.back = f.back;
    }
    if (h.backObj && f.joints) {
      const b = this.backFrame(f);
      h.backObj.visible = true;
      h.backObj.position.copy(b.pos);
      h.backObj.quaternion.setFromRotationMatrix(this._m.makeBasis(b.fwd, b.spine, this._bz.crossVectors(b.fwd, b.spine)));
      h.backObj.scale.set(1, 1, 1);
    } else if (h.backObj) {
      const x = f.parts[TORSO * 3], y = f.parts[TORSO * 3 + 1], a = f.parts[TORSO * 3 + 2];
      const off = -0.2 * f.facing;
      h.backObj.visible = true;
      h.backObj.position.set(x + Math.cos(a) * off, y + Math.sin(a) * off + 0.05, -0.05);
      h.backObj.rotation.set(0, 0, a);
      h.backObj.scale.set(f.facing < 0 ? -1 : 1, 1, 1);
    }
  }

  // Where the back sits: between the shoulder blades, facing out behind the body.
  backFrame(f) {
    const j = f.joints, P = (k, v) => v.set(j[k * 3], j[k * 3 + 1], j[k * 3 + 2]);
    const pel = P(J.PELVIS, new THREE.Vector3()), ch = P(J.CHEST, new THREE.Vector3());
    const spine = ch.clone().sub(pel).normalize();
    const sl = P(J.SHO_F, new THREE.Vector3()).sub(P(J.SHO_B, new THREE.Vector3())).normalize();
    const fwd = new THREE.Vector3().crossVectors(spine, sl).multiplyScalar(f.facing).normalize();
    if (fwd.lengthSq() < 0.5) fwd.set(f.facing, 0, 0);
    const pos = pel.add(ch).multiplyScalar(0.5).addScaledVector(spine, 0.05).addScaledVector(fwd, -0.2);
    return { pos, spine, fwd };
  }

  // The nozzle positions of a fighter's jetpack (for flames).
  jetNozzle(f) {
    if (f.joints) { const b = this.backFrame(f); return { x: b.pos.x - b.spine.x * 0.3, y: b.pos.y - b.spine.y * 0.3 }; }
    const x = f.parts[TORSO * 3], y = f.parts[TORSO * 3 + 1], a = f.parts[TORSO * 3 + 2];
    const off = -0.2 * f.facing;
    return { x: x + Math.cos(a) * off + Math.sin(a) * 0.3, y: y + Math.sin(a) * off - Math.cos(a) * 0.3 };
  }

  dispose() {
    for (const m of [...this.meshes, ...this.outlines]) this.scene.remove(m);
    for (const h of this.held) { if (h.obj) this.scene.remove(h.obj); if (h.backObj) this.scene.remove(h.backObj); }
    this.scene.remove(this.marker);
    for (const tr of this.trails) tr.dispose(this.scene);
  }
}
