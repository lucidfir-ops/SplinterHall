// The 3D view: draws interpolated simulation frames and turns events into effects and sounds.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, FXAAEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, ChromaticAberrationEffect, HueSaturationEffect, BrightnessContrastEffect, NormalPass, SSAOEffect, BlendFunction } from 'postprocessing';
import { W, H, MAT, FIGHTER_COLORS, KILL_Y, cellIndex } from '../core/consts.js';
import { Blocks } from './blocks.js';
import { FighterView } from './fighters.js';
import { PlayerCam, EdgeMarkers } from './camera.js';
import { Entities } from './entities.js';
import { FX } from './fx.js';
import { Environment, LOOK } from './env.js';

// The looks. Each field is a cost knob (docs/CLAUDE-NOTES.md, Performance, says what each costs):
//   post: the HDR post chain (bloom, grade, tone mapping, vignette, colour fringing) · ao: ambient occlusion
//   aa: 'smaa' | 'fxaa' | 'none' (edge smoothing, its own full-screen passes) · bloomLevels: mip levels of the glow
//   bloomHalf: find the glow at half resolution · shadows: 0 off, 1 on · shadowSize: shadow map texels a side
//   particles: share of effect particles · lights: the Hall's brazier lights · pixelRatio: most pixels per CSS pixel
//   phone: knobs that change on a phone (isPhone below)
export const QUALITY = {
  lite: { name: 'Lite', post: false, ao: false, aa: 'none', shadows: 0, shadowSize: 1024, particles: 0.5, lights: false, pixelRatio: 1 },
  clean: { name: 'Clean', post: true, ao: false, aa: 'smaa', bloomLevels: 6, bloomHalf: true, shadows: 1, shadowSize: 2048, particles: 1, lights: true, pixelRatio: 1.5,
    phone: { aa: 'fxaa', shadowSize: 1024 } },
  everything: { name: 'Everything', post: true, ao: true, aa: 'smaa', bloomLevels: 8, bloomHalf: false, shadows: 2, shadowSize: 2048, particles: 1, lights: true, pixelRatio: 2 },
};

// A phone or small tablet: a touch screen whose short side is phone-sized.
export function isPhone() {
  try { return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600; } catch { return false; }
}
// A look's knobs on this device.
const lookOf = (name) => { const L = QUALITY[name] || QUALITY.clean; return { ...L, ...(isPhone() ? L.phone : null) }; };

const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const SETTING_GLOW = { bunker: 0xffb030, forge: 0xff5a10, fjord: 0x40fff0, hall: 0xff8a30 };
const BREAK_COLOR = { [MAT.STONE]: 0xc8c0b0, [MAT.WOOD]: 0xc89060, [MAT.IRON]: 0xffc080, [MAT.ICE]: 0xc0f0ff, [MAT.GLASS]: 0xe0ffff, [MAT.BEDROCK]: 0xffffff };

export class View {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.qname = opts.quality || 'clean';
    this.q = lookOf(this.qname);
    this.resScale = opts.resolution || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // three r187 dropped PCFSoft and used PCF anyway
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 2000);
    this.camera.position.set(W / 2, H / 2, 50);
    this.cam = { x: W / 2, y: H / 2, w: W, tx: W / 2, ty: H / 2, tw: W, vx: 0, vy: 0, vw: 0 };
    this.playerCam = new PlayerCam();
    this.edges = typeof document !== 'undefined' ? new EdgeMarkers(document.body) : null;
    this.env = new Environment(this.renderer, this.scene, this.q);
    this.blocks = new Blocks(this.scene, this.q);
    this.fighters = new FighterView(this.scene);
    this.ents = new Entities(this.scene);
    this.fx = new FX(this.scene, this.q);
    this.frames = [];          // received frames, oldest first
    this.pending = [];         // events waiting for their tick
    this.bodyMap = new Map();
    this.cur = null;
    this.localSlot = -1;
    this.onSound = opts.onSound || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.shakeScale = 1;
    this.flashes = true;
    this.time = 0;
    this.focus = null;
    this.ca = 0;
    this.env.viewCamera = this.camera; // the key light fits its shadow camera to this view
    this.setupPost();
    this.resize();
  }

  setupPost() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    this.bloom = this.chroma = this.grade = this.contrast = null;
    const r = this.renderer, q = this.q;
    r.shadowMap.enabled = q.shadows > 0;
    if (!q.post) {
      r.toneMapping = THREE.AgXToneMapping;
      return;
    }
    r.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(this.scene, this.camera));
    let ssao = null;
    if (q.ao) {
      // Ambient occlusion grounds the blocks against each other.
      const normalPass = new NormalPass(this.scene, this.camera);
      // The normals pass draws the scene again; it must not draw the shadow map a second time.
      const drawNormals = normalPass.render.bind(normalPass);
      normalPass.render = (...a) => { const sm = r.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false; drawNormals(...a); sm.autoUpdate = au; };
      composer.addPass(normalPass);
      ssao = new SSAOEffect(this.camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY, samples: 16, rings: 4, radius: 0.08, intensity: 2.4, bias: 0.025, fade: 0.02,
        worldDistanceThreshold: 60, worldDistanceFalloff: 10, worldProximityThreshold: 1.2, worldProximityFalloff: 0.6,
        luminanceInfluence: 0.6, resolutionScale: 0.5, depthAwareUpsampling: true,
      });
    }
    // The glow: by default the bright-pass runs at full resolution and the blur takes 8 halvings; at half
    // resolution and 6 levels it costs far less and looks the same to the eye (the radius makes up the spread).
    const levels = q.bloomLevels || 8;
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, intensity: 0.75, radius: levels >= 8 ? 0.65 : 0.65 + (8 - levels) * 0.07, levels });
    if (q.bloomHalf) this.bloom.luminancePass.resolution.scale = 0.5;
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.2 });
    this.grade = new HueSaturationEffect({ saturation: 0 });
    this.contrast = new BrightnessContrastEffect({ contrast: 0.06 });
    if (this.setting) { const L = LOOK[this.setting]; this.grade.saturation = L.grade.sat - 1; this.contrast.contrast = (L.grade.contrast - 1) * 0.6; }
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    if (ssao) composer.addPass(new EffectPass(this.camera, ssao));
    composer.addPass(new EffectPass(this.camera, this.bloom, this.chroma, this.grade, this.contrast, tone, vignette));
    // Edge smoothing: SMAA is three full-screen passes, FXAA one.
    if (q.aa === 'smaa') composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    else if (q.aa === 'smaa-low') composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.LOW })));
    else if (q.aa === 'fxaa') composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    this.composer = composer;
  }

  // Change the look in place (no level rebuild, so broken blocks stay broken). `over` changes single knobs (tests).
  setQuality(name, resolution, over = null) {
    this.qname = name;
    Object.assign(this.q, lookOf(name), over || {});
    if (resolution) this.resScale = resolution;
    this.setupPost();
    this.resize();
    const key = this.env.key;
    if (key) {
      key.castShadow = this.q.shadows > 0;
      const sm = this.q.shadowSize || 1024;
      if (key.shadow.mapSize.x !== sm) { key.shadow.mapSize.set(sm, sm); if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; } }
    }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  async setLevel(level, keepState = false) {
    this.level = level;
    this.setting = level.setting;
    await this.env.build(level.setting, level.code);
    this.blocks.build(level, level.setting);
    this.ents.clear();
    this.ents.buildProps(level, level.setting);
    // Item pads: low iron plates with a glowing rune line.
    if (this.pads) { this.scene.remove(this.pads); this.pads.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.pads = new THREE.Group();
    // All pads in two draws: the plates and their rune lines.
    const plate = new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.8, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: SETTING_GLOW[level.setting] || 0xffa030, emissiveIntensity: 2.2 });
    const n = level.pads.length;
    if (n) {
      const base = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.08, 1.3), plate, n);
      const line = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 0.08), glow, n);
      const m = new THREE.Matrix4();
      level.pads.forEach((p, k) => {
        base.setMatrixAt(k, m.makeTranslation(p.x, p.y + 0.04, 0));
        line.setMatrixAt(k, m.makeTranslation(p.x, p.y + 0.095, 0.5));
      });
      base.receiveShadow = true;
      base.computeBoundingSphere(); line.computeBoundingSphere();
      this.pads.add(base, line);
    }
    this.scene.add(this.pads);
    this.fx.setLevel(level.grid, level.setting);
    const L = LOOK[level.setting];
    if (this.grade) { this.grade.saturation = L.grade.sat - 1; this.contrast.contrast = (L.grade.contrast - 1) * 0.6; }
    this.frames = [];
    this.pending = [];
    this.cur = null;
    this.bodyMap.clear();
    this.grid = new Uint8Array(level.grid);
    if (!keepState) { this.cam.x = this.cam.tx = W / 2; this.cam.y = this.cam.ty = H / 2; this.cam.w = this.cam.tw = W + 2; }
  }

  // ------------------------------------------------------------ frames and events
  pushFrame(frame, events) {
    this.frames.push(frame);
    if (this.frames.length > 40) this.frames.shift();
    for (const e of events || []) { e._tick = frame.tick; this.pending.push(e); }
  }

  // Interpolated frame at a fractional tick.
  sample(tick) {
    const F = this.frames;
    if (!F.length) return null;
    let a = F[0], b = F[F.length - 1];
    if (tick <= a.tick) b = a;
    else if (tick >= b.tick) a = b;
    else for (let k = 0; k < F.length - 1; k++) if (F[k].tick <= tick && F[k + 1].tick >= tick) { a = F[k]; b = F[k + 1]; break; }
    // Drop frames we will never need again.
    while (F.length > 2 && F[1].tick < tick - 2) F.shift();
    const t = b.tick === a.tick ? 0 : (tick - a.tick) / (b.tick - a.tick);
    if (t === 0 || a === b) return this.unpackBodies(b === a ? a : a);
    // Interpolated fighters reuse one object and buffers per slot (no garbage per frame).
    const pool = this.samplePool || (this.samplePool = []);
    const fighters = this.sampleList || (this.sampleList = []);
    fighters.length = 0;
    for (const fb of b.fighters) {
      const fa = a.fighters.find((x) => x.slot === fb.slot);
      if (!fa) { fighters.push(fb); continue; }
      const buf = pool[fb.slot] || (pool[fb.slot] = { o: {}, parts: new Float32Array(30), joints: new Float32Array(45) });
      const o = Object.assign(buf.o, fb), parts = buf.parts, joints = buf.joints;
      o.parts = parts;
      for (let k = 0; k < 10; k++) {
        parts[k * 3] = fa.parts[k * 3] + (fb.parts[k * 3] - fa.parts[k * 3]) * t;
        parts[k * 3 + 1] = fa.parts[k * 3 + 1] + (fb.parts[k * 3 + 1] - fa.parts[k * 3 + 1]) * t;
        parts[k * 3 + 2] = lerpAng(fa.parts[k * 3 + 2], fb.parts[k * 3 + 2], t);
      }
      if (fa.joints && fb.joints && fb.joints.length === 45) {
        for (let k = 0; k < 45; k++) joints[k] = fa.joints[k] + (fb.joints[k] - fa.joints[k]) * t;
        o.joints = joints;
      }
      fighters.push(o);
    }
    const bodies = [];
    const am = new Map();
    for (let k = 0; k < a.bodies.length; k += 4) am.set(a.bodies[k], k);
    for (let k = 0; k < b.bodies.length; k += 4) {
      const id = b.bodies[k], ka = am.get(id);
      if (ka === undefined) { bodies.push(id, b.bodies[k + 1], b.bodies[k + 2], b.bodies[k + 3]); continue; }
      bodies.push(id, a.bodies[ka + 1] + (b.bodies[k + 1] - a.bodies[ka + 1]) * t, a.bodies[ka + 2] + (b.bodies[k + 2] - a.bodies[ka + 2]) * t, lerpAng(a.bodies[ka + 3], b.bodies[k + 3], t));
    }
    const proj = [];
    const pm = new Map();
    for (let k = 0; k < a.proj.length; k += 4) pm.set(a.proj[k], k);
    for (let k = 0; k < b.proj.length; k += 4) {
      const ka = pm.get(b.proj[k]);
      if (ka === undefined) { proj.push(b.proj[k], b.proj[k + 1], b.proj[k + 2], b.proj[k + 3]); continue; }
      proj.push(b.proj[k], a.proj[ka + 1] + (b.proj[k + 1] - a.proj[ka + 1]) * t, a.proj[ka + 2] + (b.proj[k + 2] - a.proj[ka + 2]) * t, b.proj[k + 3]);
    }
    return this.unpackBodies({ ...b, fighters, bodies, proj, killY: a.killY + (b.killY - a.killY) * t });
  }

  unpackBodies(f) {
    this.bodyMap.clear();
    for (let k = 0; k < f.bodies.length; k += 4) this.bodyMap.set(f.bodies[k], [f.bodies[k + 1], f.bodies[k + 2], f.bodies[k + 3]]);
    return f;
  }

  applyEvents(tick) {
    if (!this.pending.length) return;
    const due = [], keep = [];
    for (const e of this.pending) (e._tick <= tick + 0.001 ? due : keep).push(e);
    this.pending = keep;
    for (const e of due) this.event(e);
  }

  // Positions: pan -1..1 and a distance factor for sounds.
  pan(x) { return Math.max(-1, Math.min(1, (x - this.cam.x) / (this.cam.w * 0.6))); }
  dist(x, y) { return Math.min(1, Math.hypot(x - this.cam.x, y - this.cam.y) / (this.cam.w * 0.9)); }
  snd(name, x = this.cam.x, y = this.cam.y, o = {}) { this.onSound(name, { x: this.pan(x), dist: this.dist(x, y), ...o }); }

  event(e) {
    const fx = this.fx;
    this.onEvent(e);
    switch (e.t) {
      case 'break': {
        const p = { x: e.x, y: e.y };
        this.blocks.removeCell(e.c);
        if (this.grid) this.grid[e.c] = 0;
        const n = e.m === MAT.GLASS ? 8 : e.m === MAT.ICE ? 7 : 5;
        fx.chunks(p.x, p.y, e.m, n, 5);
        if (e.m !== MAT.GLASS && e.m !== MAT.ICE && Math.random() < 0.6) fx.puff(p.x, p.y, 1, { size: 0.3, dark: this.setting === 'forge' ? 0.05 : 0.3, life: 1.0, alpha: 0.5 });
        if (e.m === MAT.GLASS || e.m === MAT.ICE) fx.sparks(p.x, p.y, 10, BREAK_COLOR[e.m], 6, 0.35);
        if (e.m === MAT.WOOD && this.setting !== 'fjord') fx.embers(p.x, p.y, 2, 0.6);
        this.snd('break_' + ({ 2: 'stone', 3: 'wood', 4: 'iron', 5: 'ice', 6: 'glass', 1: 'stone' }[e.m] || 'stone'), p.x, p.y);
        break;
      }
      case 'crack': this.blocks.setDamage(e.c, e.f); break;
      case 'detach': this.blocks.detach(e.id, e.cells, e.x, e.y); if (e.cells.length > 2) this.snd('collapse', e.x, e.y, { vol: Math.min(1, e.cells.length / 12) }); break;
      case 'split': this.blocks.split(e.id, e.parts); break;
      case 'slam': fx.puff(e.x, e.y - 0.5, Math.min(6, e.n), { size: 0.4, dark: this.setting === 'forge' ? 0.05 : 0.3, speed: 3, life: 1.2, alpha: 0.5 }); fx.shake = Math.min(1, fx.shake + Math.min(0.6, e.n * 0.04)); this.snd('collapse', e.x, e.y); break;
      case 'gone': this.blocks.bodyGone(e.id); this.ents.remove(e.id); if (e.x !== undefined) fx.puff(e.x, e.y, 1, { size: 0.2, life: 0.6 }); break;
      case 'item': this.ents.item(e.id, e.k, e.c); break;
      case 'uncrate': this.ents.uncrate(e.id); fx.chunks(e.x, e.y, MAT.WOOD, 8, 4); fx.sparks(e.x, e.y, 12, 0xffb050, 5, 0.4); this.snd('crate_land', e.x, e.y); break;
      case 'pick': this.ents.remove(e.id); this.snd('pickup'); break;
      case 'throw': this.snd('throw'); break;
      case 'bomb': this.ents.bomb(e.id); this.snd('throw'); break;
      case 'bounce': this.snd('bomb_bounce'); break;
      case 'proj': if (e.k === 'rocket') { this.ents.rocket(e.id); this.snd('rocket_launch', e.x, e.y); fx.puff(e.x, e.y, 4, { size: 0.3, dark: 0.5, life: 0.8 }); } else { this.ents.glob(e.id); this.snd('web_splat', e.x, e.y, { vol: 0.4, pitch: 1.4 }); } break;
      case 'boom': fx.explosion(e.x, e.y, e.r, e.f !== 0); this.snd(e.r >= 3 ? 'explosion_big' : e.r >= 2.4 ? 'explosion_mid' : 'explosion_small', e.x, e.y); this.ca = Math.min(1, this.ca + 0.6); break;
      case 'hurt': {
        const col = FIGHTER_COLORS[e.s].hex;
        fx.shards(e.x, e.y, Math.min(16, 3 + e.a / 3), col, 6 + e.a / 6);
        if (e.k !== 'impact') fx.sparks(e.x, e.y, 6, 0xffffff, 6, 0.2);
        const big = e.k === 'haymaker' || e.k === 'dropkick' || e.k === 'uppercut' || e.k === 'stomp';
        if (e.a >= 25 || big) { fx.shake = Math.min(1, fx.shake + 0.25); this.ca = Math.min(1, this.ca + 0.25); }
        if (big) fx.impactRing(e.x, e.y, 1.3);
        const nm = e.k === 'punch' ? (e.a > 14 ? 'punch_mid' : 'punch_light') : e.k === 'kick' || e.k === 'slam' ? 'punch_mid' : e.k === 'hammer' || e.k === 'serpent' || e.k === 'haymaker' || e.k === 'uppercut' || e.k === 'dropkick' || e.k === 'stomp' ? 'punch_heavy' : e.k === 'axe' ? 'axe_chop' : e.k === 'sword' ? 'sword_slash' : e.k === 'impact' ? 'thud' : e.k === 'web' ? 'web_splat' : e.k === 'throw' ? 'punch_mid' : null;
        if (nm) this.snd(nm, e.x, e.y);
        break;
      }
      case 'death': fx.shards(e.x, e.y, 26, FIGHTER_COLORS[e.s].hex, 11); fx.sparks(e.x, e.y, 18, FIGHTER_COLORS[e.s].hex, 10, 0.5);
        this.snd(e.c === 'fall' ? (this.setting === 'forge' ? 'lava_hiss' : this.setting === 'fjord' ? 'splash' : 'fall_whoosh') : 'death', e.x, e.y);
        if (e.c === 'fall' && this.setting === 'forge') { fx.flames(e.x, this.cur ? this.cur.killY + 1.9 : -0.6, 14, 0.4, 5); fx.puff(e.x, -0.5, 8, { dark: 0.2 }); }
        if (e.c === 'fall' && this.setting === 'fjord') fx.sparks(e.x, -0.5, 30, 0xd0f0ff, 8, 0.8);
        break;
      case 'swing': {
        const sw = { punch: [e.c ? 1.2 : 1.5, e.c ? 0.6 : 0.4], kick: [1.25, 0.5], haymaker: [0.8, 0.75], uppercut: [1.1, 0.6], slam: [0.75, 0.7], dropkick: [0.9, 0.75], stomp: [0.6, 0.6], hammer: [0.7, 0.8] }[e.k] || [1, 0.8];
        this.snd('sword_swing', undefined, undefined, { pitch: sw[0], vol: sw[1] });
        break;
      }
      case 'clang': fx.sparksDir(e.x, e.y, 0, 1, 8, e.m === MAT.WOOD ? 0xd8a060 : 0xffd090, 5, 2.5); this.snd(e.k === 'hammer' ? 'hammer_smash' : e.m === MAT.WOOD ? 'axe_chop' : 'blade_stick', e.x, e.y, { vol: 0.6 }); break;
      case 'clash': fx.sparks(e.x, e.y, 6, 0xffffff, 5, 0.2); break;
      case 'shot': {
        for (const [hx, hy] of e.hits) {
          const dx = hx - e.x, dy = hy - e.y, l = Math.hypot(dx, dy) || 1;
          for (let s = 0; s < 3; s++) { const k = Math.random(); fx.spark.add({ x: e.x + dx * k, y: e.y + dy * k, vx: (dx / l) * 40, vy: (dy / l) * 40, life: 0.08, s0: 0.06, s1: 0.06, c: new THREE.Color(3, 2.4, 1.2), stretch: 0.012 }); }
          fx.sparks(hx, hy, 2, 0xffc080, 4, 0.25);
        }
        fx.flames(e.x + Math.cos(e.a) * 0.5, e.y + Math.sin(e.a) * 0.5, 8, 0.25, 2);
        fx.puff(e.x + Math.cos(e.a) * 0.8, e.y + Math.sin(e.a) * 0.8, 5, { size: 0.3, dark: 0.55, life: 1.2, speed: 3 });
        fx.shake = Math.min(1, fx.shake + 0.2);
        this.snd('blunderbuss', e.x, e.y);
        break;
      }
      case 'splat': this.ents.splat(e.x, e.y, 2.5); this.snd('web_splat', e.x, e.y); break;
      case 'webtie': this.ents.tie(e.s, e.x, e.y, e.d); break;
      case 'glue': this.ents.splat(e.x, e.y, e.d); break;
      case 'line': if (e.on) this.snd('web_line', undefined, undefined, { vol: 0.8 }); break;
      case 'beam': this.snd(e.on ? 'tractor_on' : 'tractor_off', undefined, undefined, { vol: 0.6 }); break;
      case 'fling': fx.sparks(e.x, e.y, 10, 0x60f0ff, 7, 0.3); break;
      case 'rip': fx.chunks(e.x, e.y, MAT.STONE, 3, 3); fx.sparks(e.x, e.y, 12, 0x60f0ff, 6, 0.4); this.snd('break_stone', e.x, e.y, { vol: 0.5 }); break;
      case 'portal':
        this.ents.portal(e.s, e.w, e.x, e.y, e.nx, e.ny, e.off);
        if (!e.off) { fx.sparks(e.x, e.y, 20, e.w ? 0x2a8dff : 0xff7a1a, 6, 0.4); this.snd('portal_open', e.x, e.y); }
        break;
      case 'warp': fx.sparks(e.x, e.y, 10, 0xffffff, 5, 0.3); fx.sparks(e.x2, e.y2, 14, 0xffffff, 7, 0.3); this.snd('portal_pass', e.x2, e.y2); break;
      case 'projwarp': break;
      case 'serpent': this.ents.serpent(e.ids); this.snd('serpent_rise', e.x, 0); fx.shake = Math.min(1.4, fx.shake + 0.6); break;
      case 'serpentEnd': this.snd('serpent_crunch', undefined, undefined, { vol: 0.5 }); break;
      case 'horn': this.snd('serpent_rise', e.x, e.y, { vol: 0.7, pitch: 0.8 }); break;
      case 'stick': fx.sparks(e.x, e.y, 6, 0xffe0b0, 4, 0.25); this.snd('blade_stick', e.x, e.y); break;
      case 'propBreak': fx.chunks(e.x, e.y, MAT.WOOD, 8, 5); this.ents.remove(e.id); this.snd('break_wood', e.x, e.y); break;
      case 'jump':
        if (e.d || e.w) fx.puff(e.x, e.y - 0.6, e.w ? 5 : 3, { size: 0.15, dark: 0.7, life: 0.5, alpha: 0.4, rise: 0 });
        this.snd('jump', e.x, e.y, { vol: 0.35, pitch: e.w ? 1.15 : 1 });
        break;
      case 'stomp': // a dive lands: dust ring, a crack of grit, a thump
        fx.impactRing(e.x, e.y, 1.6);
        fx.puff(e.x, e.y, 10, { size: 0.25, dark: 0.55, life: 0.8, alpha: 0.5, rise: 0.4, speed: 5 });
        fx.sparksDir(e.x, e.y, 0, 1, 10, 0xd8c8a8, 6, 1.2);
        fx.shake = Math.min(1, fx.shake + 0.35);
        this.snd('hammer_smash', e.x, e.y, { vol: 0.8, pitch: 0.8 });
        break;
      case 'land': fx.puff(e.x, e.y, Math.min(6, e.v / 3), { size: 0.2, dark: 0.5, life: 0.7, alpha: 0.4, rise: 0.3, speed: 2.5 }); this.snd('land', e.x, e.y, { vol: Math.min(1, e.v / 15) }); break;
      case 'jet': break;
      case 'final': this.focus = { x: e.x, y: e.y, t: 1.4 }; this.ca = 1; break;
      case 'ragnarok': fx.shake = 1; this.snd('collapse'); break;
    }
  }

  // ------------------------------------------------------------ per frame
  // tick: fractional tick to draw. dt: real seconds since last draw.
  draw(tick, dt) {
    this.time += dt;
    this.applyEvents(tick);
    const f = this.sample(tick);
    this.cur = f;
    if (f) {
      this.blocks.update((id) => this.bodyMap.get(id));
      // The round-start marker: full through the drop-in, then fades as the fight starts.
      this.intro = f.phase === 'dropin' ? 1 : Math.max(0, (this.intro || 0) - dt / 0.9);
      this.fighters.update(f.fighters, this.time, this.localSlot, this.localAim ?? null, this.intro);
      this.ents.update(dt, this.time, (id) => this.bodyMap.get(id), f.proj, f.fighters);
      this.env.setKillY(f.killY);
      this.continuous(f, dt);
      this.updateCamera(f, dt);
    } else this.updateCamera(null, dt);
    if (!this.freezeFx) {
      this.fx.update(dt);
      this.env.update(dt, this.fx, this.camera);
    }
    if (this.chroma) {
      this.ca = Math.max(0, this.ca - dt * 3);
      const o = this.flashes ? this.ca * 0.004 : 0;
      this.chroma.offset.set(o, o * 0.6);
    }
    this.renderer.info.autoReset = !this.composer;
    if (this.composer) { this.renderer.info.reset(); this.composer.render(dt); }
    else this.renderer.render(this.scene, this.camera);
    window.__drawCalls = this.renderer.info.render.calls;
    window.__tris = this.renderer.info.render.triangles;
  }

  // Effects that run every frame: jet flames, rocket trails, fuses, beams.
  continuous(f, dt) {
    const fx = this.fx;
    this.loopT = this.loopT || {};
    for (const fi of f.fighters) {
      if (fi.jet) {
        const n = this.fighters.jetNozzle(fi);
        const k = 'j' + fi.slot;
        if (!(this.loopT[k] > this.time)) { this.snd('jetpack', n.x, n.y, { vol: 0.75 }); this.loopT[k] = this.time + 0.27; }
        fx.flames(n.x, n.y, 2, 0.16, -6, 0x66c8ff);
        fx.flames(n.x, n.y, 1, 0.12, -5);
        if (Math.random() < 0.3) fx.puff(n.x, n.y - 0.3, 1, { size: 0.18, dark: 0.55, life: 0.6, alpha: 0.35, rise: -1 });
      }
      if (fi.stuck && Math.random() < 0.2) fx.sparks(fi.parts[3], fi.parts[4], 1, 0xffffff, 1, 0.3);
    }
    for (let k = 0; k < f.proj.length; k += 4) {
      const o = this.ents.objs.get(f.proj[k]);
      if (!o || o.kind !== 'rocket') continue;
      const x = f.proj[k + 1], y = f.proj[k + 2], a = f.proj[k + 3];
      fx.flames(x - Math.cos(a) * 0.35, y - Math.sin(a) * 0.35, 1, 0.18, 0);
      if (Math.random() < 0.6) fx.puff(x - Math.cos(a) * 0.5, y - Math.sin(a) * 0.5, 1, { size: 0.22, dark: 0.55, life: 1.4, alpha: 0.5, rise: 0.4, speed: 0.3 });
    }
    for (const [id, o] of this.ents.objs) {
      if (o.kind !== 'bomb') continue;
      const b = this.bodyMap.get(id);
      if (b && !(this.loopT['b' + id] > this.time)) { this.snd('bomb_fuse', b[0], b[1], { vol: 0.45 }); this.loopT['b' + id] = this.time + 0.55; }
      if (b && Math.random() < 0.7) fx.embers(b[0] + Math.sin(b[2]) * -0.3, b[1] + Math.cos(b[2]) * 0.3, 1, 0.05, 0xffa040);
    }
    for (const p of this.ents.portals.values()) if (Math.random() < 0.3) fx.embers(p.position.x, p.position.y, 1, 1.2, p.children[0].material.emissive.getHex());
  }

  updateCamera(f, dt) {
    const C = this.cam;
    const aspect = this.camera.aspect;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    if (f) for (const fi of f.fighters) {
      if (!fi.alive) continue;
      const x = fi.parts[3], y = fi.parts[4];
      if (y < KILL_Y - 2) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); n++;
    }
    let tx = W / 2, ty = H / 2, tw = W + 2, follow = null;
    if (!this.fixedCam && !(this.focus && this.focus.t > 0)) follow = this.playerCam.target(this, f, dt);
    if (this.fixedCam) { tx = this.fixedCam.x; ty = this.fixedCam.y; tw = this.fixedCam.w; }
    else if (follow) {
      // Close on your own fighter, kept inside the arena where it can be.
      tw = follow.tw; tx = follow.tx; ty = follow.ty;
      const th = tw / aspect;
      tx = Math.max(-1 + tw / 2, Math.min(W + 1 - tw / 2, tx));
      ty = Math.max(-2 + th / 2, Math.min(H + 3 - th / 2, ty));
    } else if (this.focus && this.focus.t > 0) {
      this.focus.t -= dt;
      tx = this.focus.x; ty = this.focus.y; tw = 18;
    } else if (n > 0) {
      const pw = maxX - minX + 9, ph = maxY - minY + 7;
      tw = Math.max(pw, ph * aspect, 18);
      tw = Math.min(tw, Math.max(W + 2, (H + 3) * aspect));
      tx = (minX + maxX) / 2; ty = (minY + maxY) / 2 + 1;
      // Keep the view inside the arena where it can be.
      const th = tw / aspect;
      const lo = -1 + tw / 2, hi = W + 1 - tw / 2;
      tx = lo > hi ? W / 2 : Math.max(lo, Math.min(hi, tx));
      const vlo = -2 + th / 2, vhi = H + 3 - th / 2;
      ty = vlo > vhi ? H / 2 : Math.max(vlo, Math.min(vhi, ty));
    } else if (this.menuDrift) {
      tx = W / 2 + Math.sin(this.time * 0.07) * 6; ty = H / 2; tw = W - 4;
    }
    C.tx = tx; C.ty = ty; C.tw = tw;
    // Critically damped follow.
    const k = this.focus && this.focus.t > 0 ? 6 : follow ? follow.k : 3.2;
    const step = (v, vel, target, kk = k) => { const a = (target - v) * kk * kk - 2 * kk * vel; vel += a * dt; return [v + vel * dt, vel]; };
    [C.x, C.vx] = step(C.x, C.vx, tx);
    [C.y, C.vy] = step(C.y, C.vy, ty);
    [C.w, C.vw] = step(C.w, C.vw, tw, follow ? 3.6 : k);
    this.edges?.update(f, this.camera, !!follow, this.localSlot);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const vh = C.w / aspect;
    const dist = vh / 2 / Math.tan(fov / 2);
    const sh = this.fx.shake * this.shakeScale * 0.35;
    const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
    const tilt = Math.tan(THREE.MathUtils.degToRad(6)) * dist;
    this.camera.position.set(C.x + sx, C.y + tilt + sy, dist);
    this.camera.lookAt(C.x + sx * 0.5, C.y + sy * 0.5, 0);
    // Shadow camera follows the view.
    if (this.env.key) {
      const L = LOOK[this.setting || 'bunker'].key.dir;
      this.env.key.target.position.set(C.x, C.y, 0);
      this.env.key.position.set(C.x + L[0] * 60, C.y + L[1] * 60, L[2] * 60);
    }
  }

  dispose() {
    this.renderer.dispose();
    if (this.composer) this.composer.dispose();
  }
}
