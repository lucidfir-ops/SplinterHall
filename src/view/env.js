// The four settings: sky, light, fog, image-based light, the liquid or abyss below, deep 3D
// backdrops and drifting weather. Everything here is real geometry; nothing is a flat picture.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { W, H } from '../core/consts.js';
import { makeRng } from '../core/rng.js';
import { materialMaps } from './textures.js';
import { MAT } from '../core/consts.js';

const CX = W / 2, CY = H / 2;

export const LOOK = {
  bunker: {
    fog: 0x262b30, fogNear: 50, fogFar: 240, sky: [0x0b0e11, 0x3a3c3c, 0x08090a],
    key: { c: 0xfff0d8, i: 4.2, dir: [-0.85, 0.75, 0.9] }, hemi: [0x8a9cb0, 0x1a1815, 0.4], env: 0.45, exposure: 1.0,
    grade: { sat: 0.92, contrast: 1.08 },
  },
  forge: {
    fog: 0x1c0904, fogNear: 50, fogFar: 230, sky: [0x040202, 0x3a1206, 0xa03a0a],
    key: { c: 0xc0c8e0, i: 2.8, dir: [-0.5, 0.9, 0.85] }, hemi: [0x2a1a14, 0xc05420, 1.0], env: 0.35, exposure: 1.15,
    under: { c: 0xff5a18, i: 1.3 }, grade: { sat: 1.08, contrast: 1.12 },
  },
  fjord: {
    fog: 0x0a1626, fogNear: 60, fogFar: 300, sky: [0x01030a, 0x10263c, 0x020508],
    key: { c: 0xb6ccff, i: 2.0, dir: [-0.6, 0.9, 0.7] }, hemi: [0x2c4a70, 0x05090f, 0.7], env: 0.45, exposure: 1.1,
    grade: { sat: 1.0, contrast: 1.1 },
  },
  hall: {
    fog: 0x1c120b, fogNear: 45, fogFar: 220, sky: [0x080504, 0x2c1a0e, 0x060403],
    key: { c: 0xffc488, i: 3.6, dir: [0.55, 1, 0.85] }, hemi: [0x5a3a26, 0x0c0705, 0.7], env: 0.5, exposure: 1.3,
    grade: { sat: 1.05, contrast: 1.1 },
  },
};

function skyMaterial(top, mid, bottom, extra = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(top) }, uMid: { value: new THREE.Color(mid) }, uBot: { value: new THREE.Color(bottom) }, uGlow: { value: extra } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop, uMid, uBot; uniform float uGlow; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uMid, uTop, pow(clamp(y,0.0,1.0), 0.55)) : mix(uMid, uBot, pow(clamp(-y,0.0,1.0), 0.4));
        c += uMid * uGlow * exp(-abs(y) * 9.0);
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

function lavaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
      void main(){ vec2 p = vW.xz * 0.12; vec2 q = vec2(fbm(p + uT*0.05), fbm(p + vec2(5.2,1.3) - uT*0.04));
        float f = fbm(p + q*2.5 + uT*0.03);
        float crust = smoothstep(0.34, 0.5, f);
        vec3 hot = vec3(1.7, 0.42, 0.06), crustC = vec3(0.05, 0.015, 0.01);
        vec3 c = mix(hot * (0.6 + f), crustC, crust);
        float d = length(vW.xz - vec2(20.0, 0.0));
        // Only the lava right under the arena glows hot; farther out it crusts over into the dark.
        c *= mix(1.0, 0.12, smoothstep(12.0, 70.0, d));
        c = mix(c, vec3(0.05, 0.015, 0.008), smoothstep(40.0, 160.0, d));
        gl_FragColor = vec4(c, 1.0); }`,
    toneMapped: false, fog: false,
  });
}

function mistMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uO: { value: opacity } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT, uO; uniform vec3 uC; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){ vec2 p = vW.xz * 0.05 + vec2(uT*0.02, uT*0.01);
        float m = n(p) * 0.6 + n(p*2.7 - uT*0.03) * 0.4;
        float edge = 1.0 - smoothstep(80.0, 300.0, length(vW.xz - vec2(24.0, -40.0)));
        gl_FragColor = vec4(uC, uO * smoothstep(0.25, 0.85, m) * edge); }`,
    transparent: true, depthWrite: false, fog: false,
  });
}

// The abyss seen side-on: dark below the kill line, ragged and faintly lit at its top edge, so the depths
// rising in Ragnarök read as clearly as the lava and the sea.
function abyssCurtainMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uTop: { value: -0.6 }, uC: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT, uTop; uniform vec3 uC; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float wisp = n(vec2(vW.x * 0.35 + uT * 0.25, uT * 0.3)) * 0.6 + n(vec2(vW.x * 1.1 - uT * 0.4, vW.y * 0.6 + uT * 0.2)) * 0.4;
        float edge = uTop + (wisp - 0.5) * 1.6;
        float below = 1.0 - smoothstep(edge - 2.5, edge + 0.4, vW.y);
        float lip = exp(-pow((vW.y - edge) * 1.4, 2.0)) * 0.5;
        vec3 c = mix(uC * 0.2, uC * 2.8 + 0.07, lip);
        gl_FragColor = vec4(c, clamp(below * 0.96 + lip * 0.6, 0.0, 0.97)); }`,
    transparent: true, depthWrite: false, fog: false,
  });
}

function auroraMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; varying vec2 vUv;
      float h(float x){ return fract(sin(x*127.1)*43758.5453); }
      float n(float x){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h(i),h(i+1.0),f); }
      void main(){ float rays = n(vUv.x*60.0 + uT*0.6) * 0.6 + n(vUv.x*17.0 - uT*0.3) * 0.4;
        float fadeY = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        float fadeX = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
        vec3 c = mix(vec3(0.1, 1.6, 0.8), vec3(0.8, 0.2, 1.4), smoothstep(0.3, 0.9, vUv.y));
        gl_FragColor = vec4(c * rays * fadeY * fadeX * 0.9, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
}

// Simple 2D value noise for terrain heightfields.
function noise2(seed) {
  const r = makeRng(seed);
  const G = Array.from({ length: 512 }, () => r.next());
  const hsh = (x, y) => G[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function mountains(seed, opts) {
  // A strip of mountains: a heightfield plane facing the camera, coloured by height and slope.
  const n = noise2(seed);
  const { w, d, segW, segD, peak, x, z, rock, snow, snowLine } = opts;
  const g = new THREE.PlaneGeometry(w, d, segW, segD).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = [];
  const rc = new THREE.Color(rock), sc = new THREE.Color(snow || rock);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), pz = pos.getZ(i);
    const fz = 1 - Math.abs(pz / (d / 2));
    let h = 0, amp = 1, f = 0.012;
    for (let o = 0; o < 5; o++) { h += (n(px * f + 31, pz * f + 7) - 0.4) * amp; amp *= 0.5; f *= 2.1; }
    h = Math.max(0, h) * peak * Math.pow(Math.max(0, fz), 0.7);
    pos.setY(i, h);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const hgt = pos.getY(i), slope = nrm.getY(i);
    const s = snow && hgt > snowLine && slope > 0.55 ? 1 : 0;
    const c = rc.clone().lerp(sc, s).multiplyScalar(0.8 + Math.random() * 0.2);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  m.position.set(x, opts.y || -20, z);
  m.receiveShadow = false;
  return m;
}

// The scenery never moves, so meshes that share a material are merged into one: the same picture in a
// handful of draw calls instead of a hundred or more (each draw costs main-thread time on a phone).
// Meshes marked userData.live (they move or animate on their own) are left alone.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.live || Array.isArray(o.material)) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(o);
  });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((m) => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g; });
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = list.some((m) => m.castShadow);
    mesh.receiveShadow = list.some((m) => m.receiveShadow);
    mesh.renderOrder = list[0].renderOrder;
    for (const m of list) { m.parent.remove(m); m.geometry.dispose(); }
    root.add(mesh);
  }
  // Groups left empty by the merge.
  for (const c of [...root.children]) if (c.isGroup && !c.children.length) root.remove(c);
}

// One material per colour, shared, so the merge can join everything of that colour.
const matCache = new Map();
function std(params) {
  const key = JSON.stringify(params);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(params));
  return matCache.get(key);
}

const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export class Environment {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.q = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envCache = new Map();
    this.time = 0;
    this.anim = [];       // { update(dt, t) }
    this.weather = null;  // pool-like ambient particles
    this.liquid = null;
    this.key = null;
  }

  async loadEnv(setting) {
    if (this.envCache.has(setting)) return this.envCache.get(setting);
    let tex = null;
    try {
      const hdr = await new HDRLoader().loadAsync(`assets/hdri/${setting}.hdr`);
      tex = this.pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
    } catch {
      tex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    this.envCache.set(setting, tex);
    return tex;
  }

  clear() {
    for (const c of [...this.root.children]) {
      this.root.remove(c);
      c.traverse?.((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.anim = [];
    this.liquid = null;
    this.mist = null;
    this.curtain = null;
  }

  async build(setting, code) {
    this.clear();
    this.setting = setting;
    const L = LOOK[setting];
    const scene = this.scene;
    const r = makeRng('env/' + code);
    scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    scene.background = new THREE.Color(L.fog);
    scene.environment = await this.loadEnv(setting);
    scene.environmentIntensity = L.env;
    this.renderer.toneMappingExposure = L.exposure;

    // Sky dome.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMaterial(...L.sky, setting === 'forge' ? 0.8 : 0.3));
    sky.renderOrder = -10;
    this.root.add(sky);

    // Key light with a shadow map fitted to the arena.
    const key = new THREE.DirectionalLight(L.key.c, L.key.i);
    const [dx, dy, dz] = L.key.dir;
    key.position.set(CX + dx * 60, CY + dy * 60, dz * 60);
    key.target.position.set(CX, CY, 0);
    key.castShadow = this.q.shadows > 0;
    const sm = this.q.shadowSize || 1024;
    key.shadow.mapSize.set(sm, sm);
    const cam = key.shadow.camera;
    cam.left = -28; cam.right = 28; cam.top = 22; cam.bottom = -22; cam.near = 10; cam.far = 160;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    // Fit the shadow camera to the view each time the shadow map is drawn (after the camera has moved).
    const base = key.shadow.updateMatrices.bind(key.shadow);
    key.shadow.updateMatrices = (...args) => { this.fitShadow(); base(...args); };
    this.root.add(key, key.target);
    this.key = key;
    const hemi = new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]);
    this.root.add(hemi);
    if (L.under) {
      const under = new THREE.DirectionalLight(L.under.c, L.under.i);
      under.position.set(CX, -40, 20); under.target.position.set(CX, CY, 0);
      this.root.add(under, under.target);
    }

    const B = { bunker: this.bunker, forge: this.forge, fjord: this.fjord, hall: this.hall }[setting];
    B.call(this, r);
    mergeStatic(this.root);
    // Draw order: the arena (renderOrder 0) first, then the scenery behind it, then the sky, so the depth test
    // throws away the hidden scenery and sky before they are shaded.
    for (const c of this.root.children) if (c.isMesh && !c.material.transparent && c !== sky) c.renderOrder = 1;
    sky.renderOrder = 2;
    // Weather colours, made once (particles share them).
    const w = this.weather;
    if (w) w.c = w.kind === 'snow' ? new THREE.Color(1.1, 1.15, 1.25) : w.kind === 'embers' ? new THREE.Color(w.color).multiplyScalar(2.5) : new THREE.Color(w.color).multiplyScalar(0.7);
    this.fireC = new THREE.Color().setHSL(0.06, 1, 0.55).multiplyScalar(2.4);
  }

  // The key light's shadow camera covers what the view sees (with a margin), not a fixed 56 x 44 m box, so
  // the same map gives sharper shadows (about 40 x 36 m for the whole arena, 20 x 16 m for a 15 m player
  // view) and casters that can't shadow the screen are culled. The blur radius is scaled so the soft edge
  // stays the same width in the world.
  fitShadow() {
    const key = this.key, cam = this.viewCamera;
    if (!key || !cam) return;
    const sc = key.shadow.camera;
    key.updateMatrixWorld(); key.target.updateMatrixWorld(); cam.updateMatrixWorld();
    _o.setFromMatrixPosition(key.matrixWorld);
    _z.setFromMatrixPosition(key.target.matrixWorld).sub(_o).normalize().negate(); // camera looks down -z
    _x.crossVectors(sc.up, _z).normalize();
    _y.crossVectors(_z, _x);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const cp = cam.position;
    // Where the view's corner rays cross the back (z -1.3) and front (z 2.4) of the arena slab.
    for (const [nx, ny] of _ndc) {
      _v.set(nx, ny, 0.5).unproject(cam).sub(cp);
      for (const zp of [-1.3, 2.4]) {
        const t = _v.z < -1e-4 ? (zp - cp.z) / _v.z : 400;
        const px = cp.x + _v.x * t - _o.x, py = cp.y + _v.y * t - _o.y, pz = cp.z + _v.z * t - _o.z;
        const lx = px * _x.x + py * _x.y + pz * _x.z, ly = px * _y.x + py * _y.y + pz * _y.z;
        if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (ly < y0) y0 = ly; if (ly > y1) y1 = ly;
      }
    }
    // Snap the size to 2 m steps so the shadow texels don't crawl while the camera zooms.
    const m = 1.5, hx = Math.ceil(((x1 - x0) / 2 + m) / 2) * 2, hy = Math.ceil(((y1 - y0) / 2 + m) / 2) * 2;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const L = Math.min(cx - hx, -1), R = Math.max(cx + hx, 1), B = Math.min(cy - hy, -1), T = Math.max(cy + hy, 1);
    if (sc.left !== L || sc.right !== R || sc.bottom !== B || sc.top !== T) {
      sc.left = L; sc.right = R; sc.bottom = B; sc.top = T;
      sc.updateProjectionMatrix();
    }
    // The old fixed 56 x 44 m frustum at 2048 texels with radius 3: keep that world-space softness.
    const texel = ((R - L) + (T - B)) / 2 / key.shadow.mapSize.x;
    key.shadow.radius = Math.min(4, Math.max(1, (3 * 50 / 2048) / texel));
  }

  // ------------------------------------------------------------ settings
  bunker(r) {
    const maps = materialMaps('bunker', MAT.STONE);
    const conc = new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normalMap, roughness: 0.92, color: 0x5a5852 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb45a, emissiveIntensity: 2.2 });
    const far = new THREE.Group();
    // Brutalist towers receding into the haze.
    for (let k = 0; k < 26; k++) {
      const w = r.float(8, 24), h = r.float(30, 130), d = r.float(8, 20);
      const x = r.float(-140, 190), z = -r.float(70, 260);
      const g = new THREE.BoxGeometry(w, h, d);
      g.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? h / 6 : w / 6; });
      const m = new THREE.Mesh(g, conc);
      m.position.set(x, h / 2 - 30, z);
      far.add(m);
      // Cantilevered slabs and window slits.
      if (r.chance(0.5)) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w * 1.6, r.float(3, 6), d * 1.2), conc);
        c.position.set(x + r.float(-4, 4), r.float(0, h - 30) - 0, z);
        far.add(c);
      }
      const rows = Math.floor(h / 9);
      for (let q = 0; q < rows; q++) if (r.chance(0.35)) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w * r.float(0.3, 0.8), 0.5, 0.3), winMat);
        s.position.set(x, q * 9 - 22, z + d / 2 + 0.2);
        far.add(s);
      }
    }
    this.root.add(far);
    // Floodlight masts with light cones.
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, metalness: 0.7, roughness: 0.5 });
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.025, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const [x, z] of [[-10, -32], [CX + r.float(-6, 6), -48], [W + 10, -30]]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 70, 0.8), steel);
      mast.position.set(x, 10, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 1.2), std({ color: 0x222222, emissive: 0xfff2d8, emissiveIntensity: 3 }));
      head.position.set(x, 45, z);
      this.root.add(mast, head);
    }
    // Piers falling into the abyss under the arena.
    for (let k = 0; k < 14; k++) {
      const w = r.float(2, 5), x = r.float(-20, W + 20), z = -r.float(4, 30);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 60, w * r.float(0.8, 1.4)), conc);
      m.position.set(x, -32 + r.float(-6, 6), z);
      this.root.add(m);
    }
    this.abyss(0x2c3136, 0.5);
    this.weather = { kind: 'dust', rate: 22, color: 0xfff2dc };
  }

  forge(r) {
    // Lava sea.
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900, 1, 1).rotateX(-Math.PI / 2), lavaMaterial());
    lava.position.set(CX, -0.6, -300);
    lava.userData.live = true;
    this.root.add(lava);
    this.liquid = lava;
    this.anim.push((dt, t) => { lava.material.uniforms.uT.value = t; });
    const basalt = new THREE.MeshStandardMaterial({ color: 0x1b1715, roughness: 0.9, metalness: 0.05, flatShading: true });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x110805, emissive: 0xff4a10, emissiveIntensity: 2.5 });
    // Hexagonal basalt columns rising from the lava.
    for (let k = 0; k < 60; k++) {
      const rad = r.float(1.2, 4), h = r.float(6, 40);
      const x = r.float(-70, W + 70), z = -r.float(14, 120);
      const g = new THREE.CylinderGeometry(rad, rad * 1.1, h, 6);
      const m = new THREE.Mesh(g, basalt);
      m.position.set(x, h / 2 - 2, z);
      m.rotation.y = r.float(0, 1);
      this.root.add(m);
      if (r.chance(0.3)) { const s = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, 0.25, 6), glowMat); s.position.set(x, h * r.float(0.2, 0.8), z); s.rotation.y = m.rotation.y; this.root.add(s); }
    }
    // Giant forge chimneys with glowing mouths.
    for (let k = 0; k < 7; k++) {
      const x = r.float(-60, W + 60), z = -r.float(110, 260), h = r.float(70, 150), rad = r.float(5, 11);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad * 1.3, h, 10), basalt);
      c.position.set(x, h / 2 - 5, z);
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.82, rad * 0.82, 2, 10), glowMat);
      mouth.position.set(x, h - 5, z);
      this.root.add(c, mouth);
    }
    this.root.add(mountains('forge-ridge', { w: 900, d: 160, segW: 120, segD: 24, peak: 90, x: CX, z: -420, rock: 0x120c0a, y: -10 }));
    // Chains hanging from the dark above.
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.8, roughness: 0.5 });
    const linkAt = [];
    for (let k = 0; k < 8; k++) {
      const x = r.float(-10, W + 10), z = -r.float(6, 24);
      const len = r.float(20, 50);
      for (let i = 0, n = Math.floor(len / 0.55); i < n; i++) {
        const mm = new THREE.Matrix4().makeRotationY(i % 2 ? Math.PI / 2 : 0);
        mm.setPosition(x, H + 12 - i * 0.55 + 6, z);
        linkAt.push(mm);
      }
    }
    // All eight chains in one draw.
    const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.35, 0.09, 5, 10), iron, linkAt.length);
    linkAt.forEach((mm, i) => links.setMatrixAt(i, mm));
    links.computeBoundingSphere();
    this.root.add(links);
    this.weather = { kind: 'embers', rate: 60, color: 0xff7a24 };
  }

  fjord(r) {
    // Sea.
    const seaG = new THREE.PlaneGeometry(1400, 900, 140, 90).rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(seaG, new THREE.MeshStandardMaterial({ color: 0x06141f, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.5 }));
    sea.material.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.seaT = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float wv = sin(wp.x * 0.18 + uT * 1.1) * 0.25 + sin(wp.z * 0.23 - uT * 0.8) * 0.2 + sin((wp.x + wp.z) * 0.6 + uT * 2.0) * 0.06;
          transformed.y += wv;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec4 wq = modelMatrix * vec4(position, 1.0);
          objectNormal = normalize(vec3(-cos(wq.x*0.18 + uT*1.1)*0.045 - cos((wq.x+wq.z)*0.6+uT*2.0)*0.036, 1.0, -cos(wq.z*0.23 - uT*0.8)*0.046));`);
    };
    sea.position.set(CX, -0.6, -300);
    sea.userData.live = true;
    this.root.add(sea);
    this.liquid = sea;
    this.anim.push((dt, t) => { if (this.seaT) this.seaT.value = t; });
    // Fjord walls.
    this.root.add(mountains('fjord-l', { w: 300, d: 200, segW: 70, segD: 50, peak: 140, x: -150, z: -170, rock: 0x232a31, snow: 0xdfe8f2, snowLine: 40, y: -6 }));
    this.root.add(mountains('fjord-r', { w: 300, d: 200, segW: 70, segD: 50, peak: 150, x: W + 160, z: -180, rock: 0x232a31, snow: 0xdfe8f2, snowLine: 40, y: -6 }));
    this.root.add(mountains('fjord-far', { w: 900, d: 200, segW: 120, segD: 30, peak: 190, x: CX, z: -520, rock: 0x1b2128, snow: 0xc8d4e2, snowLine: 70, y: -10 }));
    // Icebergs.
    const iceM = new THREE.MeshStandardMaterial({ color: 0xbfe6f2, roughness: 0.25, emissive: 0x0b2a38, flatShading: true, envMapIntensity: 1.4 });
    for (let k = 0; k < 18; k++) {
      const s = r.float(1.5, 7);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0).scale(1.4, r.float(0.5, 1.1), 1), iceM);
      m.position.set(r.float(-60, W + 60), -0.6, -r.float(10, 160));
      m.rotation.set(r.float(0, 1), r.float(0, 6), 0);
      this.root.add(m);
    }
    // Stars on the dome, the moon, the aurora.
    const stars = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }), 900);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 900; i++) {
      const a = r.float(0, Math.PI * 2), e = Math.asin(r.float(0.08, 1));
      const R = 820, s = r.float(0.6, 1.8) * (r.chance(0.1) ? 1.8 : 1);
      mm.makeScale(s, s, s);
      mm.setPosition(Math.cos(a) * Math.cos(e) * R + CX, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R);
      stars.setMatrixAt(i, mm);
      stars.setColorAt(i, new THREE.Color().setHSL(0.6, 0.4, r.float(0.6, 1.2)));
    }
    this.root.add(stars);
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(26, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0), fog: false, toneMapped: false }));
    moon.position.set(-160, 260, -700);
    this.root.add(moon);
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(700, 220, 80, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 0.012 + k * 2) * 60); }
      const a = new THREE.Mesh(g, auroraMaterial());
      a.position.set(CX + r.float(-100, 100), 220 + k * 40, -600 - k * 60);
      a.rotation.x = 0.25;
      this.root.add(a);
      this.anim.push((dt, t) => { a.material.uniforms.uT.value = t + k * 10; });
    }
    this.weather = { kind: 'snow', rate: 90, color: 0xeaf2ff };
  }

  hall(r) {
    const woodMaps = materialMaps('hall', MAT.WOOD);
    const wood = new THREE.MeshStandardMaterial({ map: woodMaps.map, normalMap: woodMaps.normalMap, roughness: 0.8, color: 0xc8a888 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2826, metalness: 0.8, roughness: 0.45 });
    // Two rows of colossal carved pillars receding.
    for (const z of [-26, -60, -96, -134, -176, -220]) for (const x of [-34, W + 34, CX - 70, CX + 70]) {
      const h = 120;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, h, 8), wood);
      p.position.set(x, h / 2 - 50, z);
      p.rotation.y = 0.39;
      this.root.add(p);
      for (const y of [-10, 18, 40]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.2, 8), iron);
        band.position.set(x, y, z); band.rotation.y = 0.39;
        this.root.add(band);
      }
      // Round shields with bosses (3D discs) on the pillars facing the camera.
      if (r.chance(0.7)) {
        const col = r.pick([0x7a1a14, 0xc8a050, 0x2a3a5a, 0xe8dcc0]);
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 20).rotateX(Math.PI / 2), std({ color: col, roughness: 0.7 }));
        sh.position.set(x, r.float(4, 30), z + 3.9);
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), iron);
        boss.position.set(sh.position.x, sh.position.y, z + 4.05);
        this.root.add(sh, boss);
      }
    }
    // Rafters and roof.
    for (const z of [-26, -60, -96, -134, -176, -220]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(220, 3, 3), darkWood);
      beam.position.set(CX, 62, z);
      this.root.add(beam);
    }
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(160, 2, 420), darkWood);
    roofL.position.set(CX - 60, 90, -150); roofL.rotation.z = 0.5;
    const roofR = roofL.clone(); roofR.position.x = CX + 60; roofR.rotation.z = -0.5;
    this.root.add(roofL, roofR);
    // Braziers with fire and a light each.
    const fireSpots = [];
    for (const [x, z] of [[-12, -18], [W + 12, -18], [CX - 30, -50], [CX + 30, -50]]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.8, 1.2, 8, 1, true), iron);
      bowl.position.set(x, 8, z);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 40, 6), iron);
      stand.position.set(x, -12, z);
      const coals = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 8), std({ color: 0x110500, emissive: 0xff5a10, emissiveIntensity: 3 }));
      coals.position.set(x, 8.4, z);
      this.root.add(bowl, stand, coals);
      fireSpots.push([x, 8.8, z]);
    }
    if (this.q.lights) {
      for (const [x, y, z] of fireSpots.slice(0, 2)) {
        const l = new THREE.PointLight(0xff8a3a, 120, 70, 1.4);
        l.position.set(x, y + 2, z + 4);
        this.root.add(l);
        this.anim.push((dt, t) => { l.intensity = 110 + Math.sin(t * 13 + x) * 18 + Math.sin(t * 7.3) * 12; });
      }
    }
    this.fireSpots = fireSpots;
    // Banners: cloth slabs with a rune stripe.
    for (let k = 0; k < 6; k++) {
      const x = r.float(-30, W + 30), z = -r.float(30, 120);
      const ban = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 0.15), std({ color: r.pick([0x6a1410, 0x1e2c48, 0x3a2a12]), roughness: 0.9 }));
      ban.position.set(x, 42, z);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 12, 0.2), std({ color: 0x111111, emissive: 0xd8a040, emissiveIntensity: 1.2 }));
      stripe.position.set(x, 42, z + 0.1);
      this.root.add(ban, stripe);
    }
    this.abyss(0x3a2414, 0.6);
    this.weather = { kind: 'embers', rate: 18, color: 0xff9a40 };
  }

  abyss(color, opacity) {
    const layers = [];
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 700).rotateX(-Math.PI / 2), mistMaterial(color, opacity * (1 - k * 0.15)));
      m.position.set(CX, -1.2 - k * 3.5, -250);
      m.userData.live = true;
      this.root.add(m);
      layers.push(m);
      this.anim.push((dt, t) => { m.material.uniforms.uT.value = t + k * 13; });
    }
    this.liquid = layers[0];
    this.mist = layers;
    // In front of the play plane; its top sits at the kill line's surface, out of sight below the floor until Ragnarök.
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(W + 160, 60), abyssCurtainMaterial(color));
    curtain.position.set(CX, 0, 2.2); // just in front of the deepest block faces (z ≈ 1.75)
    curtain.renderOrder = 5;
    curtain.userData.live = true;
    this.root.add(curtain);
    this.anim.push((dt, t) => { curtain.material.uniforms.uT.value = t; });
    this.curtain = curtain;
  }

  setKillY(y) {
    const surf = y + 1.9;
    if (this.curtain) { this.curtain.material.uniforms.uTop.value = surf - 0.6; this.curtain.position.y = surf - 29; }
    if (this.mist) this.mist.forEach((m, k) => { m.position.y = surf - 0.6 - k * 3.5; });
    else if (this.liquid) this.liquid.position.y = surf;
  }

  update(dt, fx, camera) {
    this.time += dt;
    for (const a of this.anim) a(dt, this.time);
    // Weather drifts through the view.
    const w = this.weather;
    if (w && fx) {
      const n = w.rate * dt * (this.q.particles < 1 ? 0.4 : 1);
      let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      const cx = camera ? camera.position.x : CX;
      while (count-- > 0) {
        const x = cx + (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 30 - 4;
        if (w.kind === 'snow') fx.weather.add({ x, y: H + 6, z, vx: 1.2 + Math.random(), vy: -2.2 - Math.random() * 1.5, vz: 0, life: 14, s0: 0.05, s1: 0.04, c: w.c, wx: 2, wy: 2 });
        else if (w.kind === 'embers') fx.weather.add({ x, y: -2, z, vx: (Math.random() - 0.5), vy: 1.5 + Math.random() * 2.5, vz: 0, life: 10, s0: 0.06, s1: 0.0, c: w.c, wx: 3, wy: 2 });
        else fx.weather.add({ x, y: Math.random() * (H + 6), z, vx: 0.3 + Math.random() * 0.4, vy: (Math.random() - 0.5) * 0.3, vz: 0, life: 9, s0: 0.035, s1: 0.035, c: w.c, wx: 1, wy: 1 });
      }
      if (this.fireSpots) for (const [x, y, z] of this.fireSpots) if (Math.random() < 0.6) fx.fire.add({ x: x + (Math.random() - 0.5) * 2, y, z, vx: 0, vy: 3 + Math.random() * 2, life: 0.5, s0: 0.7, s1: 0.1, c: this.fireC, wz: 3 });
    }
  }
}
