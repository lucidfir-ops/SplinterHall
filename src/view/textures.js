// Procedural surface detail for block materials: albedo, roughness and normal maps made at load
// from noise (no image files). One texture tile = 1 m.
import * as THREE from 'three';
import { MAT } from '../core/consts.js';

const SIZE = 256;

// Tileable value noise.
function makeNoise(seed) {
  const P = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256; i++) P[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const G = new Float32Array(256);
  for (let i = 0; i < 256; i++) G[i] = rnd();
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const w = (a) => ((a % period) + period) % period;
    const h = (a, b) => G[P[P[w(a) & 255] + (w(b) & 255)]];
    const u = fade(xf), v = fade(yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(noise, x, y, oct, base) {
  let v = 0, amp = 0.5, f = base, tot = 0;
  for (let o = 0; o < oct; o++) { v += noise(x * f, y * f, f) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return v / tot;
}

// Builds height, albedo (rgb), roughness per pixel with a material-specific function.
function bake(fn, seed) {
  const noise = makeNoise(seed);
  const h = new Float32Array(SIZE * SIZE);
  const alb = new Uint8Array(SIZE * SIZE * 4);
  const rough = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    const o = fn(u, v, noise);
    const k = y * SIZE + x;
    h[k] = o.h;
    alb[k * 4] = Math.max(0, Math.min(255, o.r * 255));
    alb[k * 4 + 1] = Math.max(0, Math.min(255, o.g * 255));
    alb[k * 4 + 2] = Math.max(0, Math.min(255, o.b * 255));
    alb[k * 4 + 3] = 255;
    const r = Math.max(0, Math.min(255, o.rough * 255));
    rough[k * 4] = r; rough[k * 4 + 1] = r; rough[k * 4 + 2] = r; rough[k * 4 + 3] = 255;
  }
  // Normal from height (wrapping Sobel).
  const nrm = new Uint8Array(SIZE * SIZE * 4);
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const strength = 2.2;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (y * SIZE + x) * 4;
    nrm[k] = ((-dx / l) * 0.5 + 0.5) * 255;
    nrm[k + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
    nrm[k + 2] = (1 / l) * 0.5 * 255 + 127;
    nrm[k + 3] = 255;
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(alb, true), roughnessMap: tex(rough, false), normalMap: tex(nrm, false) };
}

const mix = (a, b, t) => a + (b - a) * t;
const sat = (x) => Math.max(0, Math.min(1, x));

// Palettes per setting tint the same material differently.
export const MAT_LOOK = {
  bunker: {
    [MAT.BEDROCK]: { base: [0.27, 0.27, 0.27], rune: [0.95, 0.75, 0.25] },
    [MAT.STONE]: { base: [0.62, 0.61, 0.58] },
    [MAT.WOOD]: { base: [0.48, 0.33, 0.2] },
    [MAT.IRON]: { base: [0.42, 0.43, 0.44], rust: [0.4, 0.25, 0.16], rustAmt: 0.45 },
    [MAT.ICE]: { base: [0.65, 0.85, 0.92] },
    [MAT.GLASS]: { base: [0.6, 0.75, 0.75] },
  },
  forge: {
    [MAT.BEDROCK]: { base: [0.12, 0.11, 0.11], rune: [1, 0.42, 0.1] },
    [MAT.STONE]: { base: [0.27, 0.24, 0.22] },
    [MAT.WOOD]: { base: [0.36, 0.23, 0.14] },
    [MAT.IRON]: { base: [0.26, 0.24, 0.22], rust: [0.42, 0.18, 0.08] },
    [MAT.ICE]: { base: [0.65, 0.85, 0.92] },
    [MAT.GLASS]: { base: [0.5, 0.45, 0.4] },
  },
  fjord: {
    [MAT.BEDROCK]: { base: [0.16, 0.18, 0.21], rune: [0.4, 0.95, 0.9] },
    [MAT.STONE]: { base: [0.36, 0.39, 0.43] },
    [MAT.WOOD]: { base: [0.36, 0.26, 0.18] },
    [MAT.IRON]: { base: [0.3, 0.32, 0.34], rust: [0.35, 0.2, 0.12] },
    [MAT.ICE]: { base: [0.62, 0.86, 0.95] },
    [MAT.GLASS]: { base: [0.6, 0.8, 0.85] },
  },
  hall: {
    [MAT.BEDROCK]: { base: [0.2, 0.18, 0.16], rune: [1, 0.55, 0.2] },
    [MAT.STONE]: { base: [0.45, 0.42, 0.38] },
    [MAT.WOOD]: { base: [0.42, 0.25, 0.13] },
    [MAT.IRON]: { base: [0.22, 0.21, 0.2], rust: [0.35, 0.16, 0.08] },
    [MAT.ICE]: { base: [0.65, 0.85, 0.92] },
    [MAT.GLASS]: { base: [0.55, 0.5, 0.42] },
  },
};

const GEN = {
  [MAT.STONE]: (L) => (u, v, n) => {
    // Board-formed concrete / rock: large blotches, pores, faint horizontal formwork lines.
    const big = fbm(n, u, v, 4, 3);
    const fine = fbm(n, u + 7, v + 3, 3, 24);
    const pore = n(u * 48, v * 48, 48) > 0.86 ? 1 : 0;
    const board = Math.abs(((v * 4) % 1) - 0.5) > 0.47 ? 1 : 0;
    const shade = 0.82 + big * 0.3 + fine * 0.12 - pore * 0.25 - board * 0.06;
    return { r: L.base[0] * shade, g: L.base[1] * shade, b: L.base[2] * shade, h: big * 0.6 + fine * 0.4 - pore * 0.8 - board * 0.2, rough: 0.82 + fine * 0.12 };
  },
  [MAT.BEDROCK]: (L) => (u, v, n) => {
    const big = fbm(n, u, v, 4, 2);
    const fine = fbm(n, u + 2, v + 9, 3, 16);
    // A carved rune band (the glow is added in the shader via emissive map).
    const shade = 0.75 + big * 0.35 + fine * 0.1;
    return { r: L.base[0] * shade, g: L.base[1] * shade, b: L.base[2] * shade, h: big * 0.7 + fine * 0.5, rough: 0.9 };
  },
  [MAT.WOOD]: (L) => (u, v, n) => {
    // Planks along u with grain.
    const plank = Math.floor(v * 4);
    const gv = v * 4 - plank;
    const grain = Math.sin((u * 6 + n(u * 3, plank * 1.7, 3) * 4) * Math.PI * 4 + plank * 2.1) * 0.5 + 0.5;
    const knot = n(u * 8 + plank, v * 8, 8) > 0.82 ? 0.25 : 0;
    const seam = gv < 0.05 || gv > 0.95 ? 1 : 0;
    const shade = 0.75 + grain * 0.22 - knot - seam * 0.45 + (n(plank * 3.1, 0.5, 8) - 0.5) * 0.2;
    return { r: L.base[0] * shade, g: L.base[1] * shade, b: L.base[2] * shade, h: grain * 0.3 - seam * 0.9 - knot * 0.5, rough: 0.7 + grain * 0.15 };
  },
  [MAT.IRON]: (L) => (u, v, n) => {
    const rust = sat(fbm(n, u, v, 4, 4) * 1.6 - 0.55) * (L.rustAmt ?? 1);
    const scratch = n(u * 64, v * 4, 64) > 0.8 ? 0.08 : 0;
    // Rivets near the edges.
    const ru = (u * 4) % 1, rv = (v * 4) % 1;
    const edge = u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92;
    const rivet = edge && Math.hypot(ru - 0.5, rv - 0.5) < 0.18 ? 1 : 0;
    const plate = edge ? 0.9 : 1;
    const r = mix(L.base[0], L.rust[0], rust) * plate + scratch;
    const g = mix(L.base[1], L.rust[1], rust) * plate + scratch;
    const b = mix(L.base[2], L.rust[2], rust) * plate + scratch;
    return { r, g, b, h: rivet * 1.2 + rust * 0.3 - (edge ? 0.2 : 0), rough: mix(0.35, 0.85, rust) };
  },
  [MAT.ICE]: (L) => (u, v, n) => {
    const cloud = fbm(n, u, v, 4, 3);
    const crack = Math.abs(n(u * 10, v * 10, 10) - 0.5) < 0.02 ? 1 : 0;
    const shade = 0.85 + cloud * 0.25 + crack * 0.3;
    return { r: L.base[0] * shade, g: L.base[1] * shade, b: L.base[2] * shade, h: cloud * 0.3 - crack * 0.6, rough: 0.08 + cloud * 0.12 };
  },
  [MAT.GLASS]: (L) => (u, v, n) => {
    const frame = u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94;
    const smudge = fbm(n, u, v, 3, 4);
    const shade = frame ? 0.35 : 0.9 + smudge * 0.1;
    return { r: L.base[0] * shade, g: L.base[1] * shade, b: L.base[2] * shade, h: frame ? 0.6 : 0, rough: frame ? 0.6 : 0.05 + smudge * 0.1 };
  },
};

// Bedrock runes: an emissive pattern made of straight strokes.
function runeTexture(seed) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const strokes = [];
  // 2 glyphs per tile, each 3-4 straight strokes inside a 0.3 box.
  for (let gIdx = 0; gIdx < 1; gIdx++) {
    const cx = 0.5, cy = 0.5;
    strokes.push([cx, cy - 0.16, cx, cy + 0.16]);
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const y0 = cy + (rnd() - 0.5) * 0.3, y1 = y0 + (rnd() - 0.5) * 0.25;
      const side = rnd() < 0.5 ? -1 : 1;
      strokes.push([cx, y0, cx + side * 0.1, y1]);
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let d = 1;
    for (const [x0, y0, x1, y1] of strokes) {
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(u - x0 - dx * t, v - y0 - dy * t));
    }
    const glow = d < 0.008 ? 1 : Math.max(0, 1 - (d - 0.008) / 0.02) * 0.25;
    const k = (y * S + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = glow * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}

// Molten veins for forge basalt: thin cracks that glow.
function veinTexture(seed) {
  const S = 256;
  const noise = makeNoise(seed);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const n = fbm(noise, u, v, 3, 3);
    const line = Math.abs(n - 0.5);
    const glow = line < 0.007 ? 1 : Math.max(0, 1 - (line - 0.007) / 0.016) * 0.3;
    const k = (y * S + x) * 4;
    data[k] = glow * 255; data[k + 1] = glow * 255; data[k + 2] = glow * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}

const cache = new Map();
export function materialMaps(setting, mat) {
  const key = setting + mat;
  if (cache.has(key)) return cache.get(key);
  const L = MAT_LOOK[setting][mat];
  const maps = bake(GEN[mat](L), 1000 + mat * 77 + setting.length * 13);
  if (mat === MAT.BEDROCK) maps.emissiveMap = runeTexture(4242 + setting.length);
  if (mat === MAT.STONE && setting === 'forge') maps.emissiveMap = veinTexture(777);
  cache.set(key, maps);
  return maps;
}
