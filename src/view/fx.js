// 3D effects: pooled instanced particles (no sprites), fireballs, shock rings and flash lights.
import * as THREE from 'three';
import { W, H, MAT, cellIndex } from '../core/consts.js';
import { MAT_LOOK } from './textures.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

// Upload only the live part of an instance buffer (a full pool is up to 90 KB a frame otherwise).
function upload(attr, n) {
  if (!n) return; // nothing is drawn (and a zero-length range would upload the whole buffer)
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

// One instanced pool. mode 'add': additive, colour fades to black. mode 'alpha': lit, alpha fades.
class Pool {
  constructor(scene, geo, mat, cap, mode) {
    this.cap = cap;
    this.mode = mode;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (mode === 'alpha') {
      this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      this.alpha.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAlpha', this.alpha);
    }
    this.p = []; // live particles
    scene.add(this.mesh);
  }
  add(o) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z || 0, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life, max: o.life, s0: o.s0 ?? 0.2, s1: o.s1 ?? 0, g: o.g ?? 0, drag: o.drag ?? 0,
      c: o.c || WHITE, a0: o.a0 ?? 1, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0,
      wx: o.wx || 0, wy: o.wy || 0, wz: o.wz || 0, stretch: o.stretch || 0, bounce: o.bounce || 0, grid: o.grid || null,
      sx: o.sx || 1, sy: o.sy || 1, sz: o.sz || 1,
    });
  }
  update(dt) {
    const P = this.p;
    if (!P.length && !this.mesh.count) return;
    let live = 0;
    for (let k = 0; k < P.length; k++) {
      const q = P[k];
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy += q.g * dt;
      const dk = Math.max(0, 1 - q.drag * dt);
      q.vx *= dk; q.vy *= dk; q.vz *= dk;
      let nx = q.x + q.vx * dt, ny = q.y + q.vy * dt;
      if (q.bounce && q.grid) {
        // Bounce off solid cells (debris only).
        const i = Math.floor(nx), j = Math.floor(ny);
        if (i >= 0 && j >= 0 && i < W && j < H && q.grid[cellIndex(i, j)]) {
          const pj = Math.floor(q.y);
          if (pj !== j) { q.vy *= -q.bounce; q.vx *= 0.7; ny = q.y; q.wz *= 0.6; }
          else { q.vx *= -q.bounce; nx = q.x; }
        }
      }
      q.x = nx; q.y = ny; q.z += q.vz * dt;
      q.rx += q.wx * dt; q.ry += q.wy * dt; q.rz += q.wz * dt;
      P[live++] = q;
    }
    P.length = live;
    const out = P;
    const m = this.mesh;
    m.count = out.length;
    m.visible = live > 0; // an empty pool would still cost a draw call
    const col = tmpC;
    for (let k = 0; k < out.length; k++) {
      const q = out[k];
      const t = 1 - q.life / q.max;
      const s = q.s0 + (q.s1 - q.s0) * t;
      if (q.stretch) {
        const sp = Math.hypot(q.vx, q.vy);
        tmpE.set(0, 0, Math.atan2(q.vy, q.vx));
        tmpQ.setFromEuler(tmpE);
        tmpS.set(s + sp * q.stretch, s * 0.35, s * 0.35);
      } else {
        tmpE.set(q.rx, q.ry, q.rz);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(s * q.sx, s * q.sy, s * q.sz);
      }
      tmpP.set(q.x, q.y, q.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(k, tmpM);
      if (this.mode === 'add') {
        const f = (1 - t) * q.a0;
        col.copy(q.c).multiplyScalar(f);
        m.setColorAt(k, col);
      } else {
        m.setColorAt(k, q.c);
        this.alpha.setX(k, q.a0 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85));
      }
    }
    upload(m.instanceMatrix, live);
    upload(m.instanceColor, live);
    if (this.alpha) upload(this.alpha, live);
  }
  clear() { this.p = []; this.mesh.count = 0; this.mesh.visible = false; }
}

function alphaMaterial(params) {
  const m = new THREE.MeshStandardMaterial({ ...params, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  m.customProgramCacheKey = () => 'alphaInst' + (params.emissive ? 'e' : '');
  return m;
}

const addMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });

// Fireball: a noisy sphere that glows white-yellow in the middle and red at the rim.
function fireballMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `uniform float uT; varying vec3 vN; varying float vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){ vec3 p = position; float d = n(p*2.6 + uT*3.0)*0.5 + n(p*5.0 - uT*4.0)*0.25; vD = d;
        p += normal * d * 0.45; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: `uniform float uFade; varying vec3 vN; varying float vD;
      void main(){ float rim = 1.0 - clamp(abs(vN.z), 0.0, 1.0);
        vec3 hot = vec3(5.0, 3.8, 1.8), mid = vec3(3.6, 1.2, 0.2), cool = vec3(0.5, 0.06, 0.01);
        vec3 c = mix(hot, mid, smoothstep(0.1, 0.6, rim + vD*0.4));
        c = mix(c, cool, smoothstep(0.55, 1.0, rim + (1.0-uFade)*0.8));
        gl_FragColor = vec4(c * uFade, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  });
}

export class FX {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    const lite = quality.particles < 1;
    const sc = lite ? 0.5 : 1;
    this.spark = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), addMat(), Math.floor(700 * sc), 'add');
    this.fire = new Pool(scene, new THREE.IcosahedronGeometry(1, 1), addMat(), Math.floor(260 * sc), 'add');
    this.smoke = new Pool(scene, new THREE.DodecahedronGeometry(1, 0), alphaMaterial({ color: 0xffffff, roughness: 1, flatShading: true, envMapIntensity: 0 }), Math.floor(260 * sc), 'alpha');
    this.shard = new Pool(scene, new THREE.TetrahedronGeometry(1, 0), addMat(), Math.floor(260 * sc), 'add');
    this.ember = new Pool(scene, new THREE.OctahedronGeometry(1, 0), addMat(), Math.floor(500 * sc), 'add');
    this.weather = new Pool(scene, new THREE.OctahedronGeometry(1, 0), addMat(), Math.floor(1400 * sc), 'add');
    this.debris = new Map(); // mat -> Pool (lit, uses the block material colour)
    this.balls = [];
    this.rings = [];
    this.lights = [];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), fireballMaterial());
      m.visible = false; scene.add(m); this.balls.push({ m, t: 0, life: 0, r: 1 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), addMat());
      ring.visible = false; scene.add(ring); this.rings.push({ m: ring, t: 0, life: 0, r: 1 });
    }
    for (let k = 0; k < 3; k++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
      l.visible = false; scene.add(l); this.lights.push({ l, life: 0, max: 1, i: 0 });
    }
    this.shake = 0;
    this.grid = null;
  }

  setLevel(grid, setting) {
    this.grid = grid;
    this.setting = setting;
    for (const p of this.debris.values()) { this.scene.remove(p.mesh); }
    this.debris.clear();
    const looks = MAT_LOOK[setting];
    for (let m = 1; m <= 6; m++) {
      const c = new THREE.Color(...looks[m].base);
      const mat = alphaMaterial({ color: 0xffffff, roughness: m === MAT.ICE || m === MAT.GLASS ? 0.1 : 0.85, metalness: m === MAT.IRON ? 0.7 : 0, flatShading: true });
      const pool = new Pool(this.scene, new THREE.BoxGeometry(1, 1, 1), mat, this.q.particles < 1 ? 90 : 180, 'alpha');
      pool.baseColor = c;
      this.debris.set(m, pool);
    }
    for (const p of [this.spark, this.fire, this.smoke, this.shard, this.ember, this.weather]) p.clear();
  }

  // ------------------------------------------------------------ emitters
  sparks(x, y, n, color = 0xffc070, speed = 9, life = 0.4) {
    const c = new THREE.Color(color).multiplyScalar(2.2);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
      this.spark.add({ x, y, z: (Math.random() - 0.5) * 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, vz: (Math.random() - 0.5) * 3,
        life: life * (0.5 + Math.random()), s0: 0.05, s1: 0.02, g: -20, drag: 1.5, c, stretch: 0.025 });
    }
  }

  sparksDir(x, y, dx, dy, n, color, speed, spread = 0.5) {
    const c = new THREE.Color(color).multiplyScalar(2.2);
    const base = Math.atan2(dy, dx);
    for (let k = 0; k < n; k++) {
      const a = base + (Math.random() - 0.5) * spread, s = speed * (0.5 + Math.random() * 0.8);
      this.spark.add({ x, y, z: (Math.random() - 0.5) * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.15 + Math.random() * 0.25, s0: 0.05, s1: 0.015, g: -14, drag: 2, c, stretch: 0.03 });
    }
  }

  puff(x, y, n, opts = {}) {
    const dark = opts.dark ?? 0.18;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (opts.speed ?? 2) * Math.random();
      const g = dark + Math.random() * 0.12;
      this.smoke.add({ x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.3, z: (Math.random() - 0.5) * 1.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s + (opts.rise ?? 1.5), vz: (Math.random() - 0.5),
        life: (opts.life ?? 1.6) * (0.6 + Math.random() * 0.6), s0: (opts.size ?? 0.35) * 0.5, s1: (opts.size ?? 0.35) * 1.7, drag: 1.2,
        c: new THREE.Color(g, g * 0.96, g * 0.92), a0: opts.alpha ?? 0.85, rx: Math.random() * 3, ry: Math.random() * 3, wx: (Math.random() - 0.5) * 2, wy: (Math.random() - 0.5) * 2 });
    }
  }

  flames(x, y, n, size = 0.25, vy = 3, color = null) {
    for (let k = 0; k < n; k++) {
      const c = color ? new THREE.Color(color) : new THREE.Color().setHSL(0.04 + Math.random() * 0.07, 1, 0.55);
      c.multiplyScalar(2.6);
      this.fire.add({ x: x + (Math.random() - 0.5) * 0.3, y, z: (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 1.5, vy: vy * (0.6 + Math.random() * 0.6),
        life: 0.25 + Math.random() * 0.3, s0: size, s1: size * 0.1, drag: 1, c, rx: Math.random() * 3, wz: (Math.random() - 0.5) * 6 });
    }
  }

  embers(x, y, n, spread = 1, color = 0xff8a30) {
    const c = new THREE.Color(color).multiplyScalar(2.5);
    for (let k = 0; k < n; k++) {
      this.ember.add({ x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, z: (Math.random() - 0.5) * spread, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5),
        life: 0.8 + Math.random() * 1.2, s0: 0.05, s1: 0.0, g: -3, drag: 0.8, c, wx: 4, wy: 3 });
    }
  }

  shards(x, y, n, color, speed = 7) {
    const c = new THREE.Color(color).multiplyScalar(1.8);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.shard.add({ x, y, z: (Math.random() - 0.5) * 0.4, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 3, vz: (Math.random() - 0.5) * 2,
        life: 0.35 + Math.random() * 0.4, s0: 0.09, s1: 0.0, g: -18, drag: 1, c, wx: 10, wy: 7, wz: 9, rx: Math.random() * 6 });
    }
  }

  // A broken block throws tumbling chunks of its material.
  chunks(x, y, mat, n, speed = 5, rot = 0) {
    const pool = this.debris.get(mat);
    if (!pool) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      const sz = 0.16 + Math.random() * 0.22;
      const shade = 0.75 + Math.random() * 0.35;
      pool.add({ x: x + (Math.random() - 0.5) * 0.7, y: y + (Math.random() - 0.5) * 0.7, z: (Math.random() - 0.5) * 1.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 3, vz: (Math.random() - 0.5) * 3,
        life: 1.6 + Math.random() * 1.4, s0: sz, s1: sz * 0.85, g: -22, drag: 0.2, c: pool.baseColor.clone().multiplyScalar(shade), a0: 1,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: rot, wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 12, wz: (Math.random() - 0.5) * 12,
        bounce: 0.35, grid: this.grid, sx: 1, sy: 0.7 + Math.random() * 0.5, sz: 0.8 + Math.random() * 0.4 });
    }
  }

  // A pale shock ring with no fire (a haymaker landing).
  impactRing(x, y, r) {
    const ring = this.rings.find((q) => q.life <= 0) || this.rings[0];
    ring.m.position.set(x, y, 0); ring.t = 0; ring.life = 0.22; ring.r = r; ring.m.visible = true;
    ring.m.material.color.setRGB(2.2, 2.2, 2.2);
  }

  explosion(x, y, r, fire = true) {
    const b = this.balls.find((q) => q.life <= 0) || this.balls[0];
    b.m.position.set(x, y, 0); b.t = 0; b.life = 0.38; b.r = r * 0.55; b.m.visible = fire;
    const ring = this.rings.find((q) => q.life <= 0) || this.rings[0];
    ring.m.position.set(x, y, 0); ring.t = 0; ring.life = 0.35; ring.r = r * 1.4; ring.m.visible = true;
    ring.m.material.color.setRGB(2.5, 1.6, 0.8);
    const l = this.lights.find((q) => q.life <= 0) || this.lights[0];
    l.l.position.set(x, y, 2.5); l.life = 0.45; l.max = 0.45; l.i = fire ? 60 * r : 15; l.l.visible = true;
    l.l.color.set(fire ? 0xff8a3a : 0xaad4ff);
    if (fire) {
      this.flames(x, y, 26, r * 0.3, 5);
      this.sparks(x, y, 40, 0xffb060, 13, 0.6);
      this.embers(x, y, 24, r);
    } else this.sparks(x, y, 20, 0xd0e8ff, 8, 0.4);
    this.puff(x, y, fire ? 10 : 6, { size: r * 0.15, life: 1.3, speed: 4, rise: 1.6, dark: fire ? 0.035 : 0.25, alpha: 0.85 });
    this.shake = Math.min(1.2, this.shake + r * 0.25);
  }

  update(dt) {
    for (const p of [this.spark, this.fire, this.smoke, this.shard, this.ember, this.weather]) p.update(dt);
    for (const p of this.debris.values()) p.update(dt);
    for (const b of this.balls) {
      if (b.life <= 0) { b.m.visible = false; continue; }
      b.t += dt; b.life -= dt;
      const k = b.t / 0.38;
      const s = b.r * (0.3 + 0.7 * (1 - Math.pow(1 - Math.min(1, k * 3), 3)));
      b.m.scale.setScalar(s);
      b.m.material.uniforms.uT.value = b.t;
      b.m.material.uniforms.uFade.value = Math.max(0, 1 - k * k);
    }
    for (const r of this.rings) {
      if (r.life <= 0) { r.m.visible = false; continue; }
      r.t += dt; r.life -= dt;
      const k = r.t / 0.35;
      r.m.scale.setScalar(r.r * (0.2 + k));
      r.m.material.color.setRGB(2.5 * (1 - k), 1.6 * (1 - k), 0.8 * (1 - k));
    }
    for (const l of this.lights) {
      if (l.life <= 0) { l.l.visible = false; continue; }
      l.life -= dt;
      l.l.intensity = l.i * Math.pow(l.life / l.max, 2);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  clear() {
    for (const p of [this.spark, this.fire, this.smoke, this.shard, this.ember, this.weather, ...this.debris.values()]) p.clear();
    for (const b of this.balls) { b.life = 0; b.m.visible = false; }
    for (const r of this.rings) { r.life = 0; r.m.visible = false; }
  }
}
