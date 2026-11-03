// Where does a frame go? Runs a level in headless Chrome (SwiftShader), freezes it on one moment, then times
// the same frame rendered with parts of the scene or of the post chain switched off, back to back.
//   node tools/perf/bench.mjs [--web dir] [--size 844x390] [--dpr 3] [--query "bot=1&code=..."] [--wait 9]
//                             [--n 5] [--rounds 2] [--live 3] [--configs base,nopost,...] [--shot out.png] [--json out.json]
//                             [--zoom 16] (hold the camera on the fighters at that width before freezing)
//                             [--seed S --tick T] (the same moment in every build)
//                             [--shotconfigs a,b --shotdir dir] (a screenshot of the frozen moment per config)
//                             [--workconfigs a,b] (work counts with each config applied)
//                             [--cam x,y,w] (camera placed exactly, for screenshots that line up)
// SwiftShader is a CPU rasteriser, so its milliseconds are a relative proxy for GPU work (vertices + pixels):
// compare configs and builds against each other, never against a phone. `--live` also times whole live frames
// and splits them into simulation (match.update), view JS (draw minus the GL submit) and GL submit.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const web = path.resolve(opt('web', path.join(root, 'dist', 'web')));
const [W, H] = opt('size', '844x390').split('x').map(Number);
const dpr = +opt('dpr', '3');
const query = opt('query', 'bot=1&fighters=8&code=BAAAAAAA');
const wait = +opt('wait', '9');
const N = +opt('n', '5');
const R = +opt('rounds', '2');
const live = +opt('live', '0');
const configs = opt('configs', 'base').split(',');
const shot = opt('shot', null);
const jsonOut = opt('json', null);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json', '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(web, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const mobile = W > H && H < 500;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: mobile, isMobile: mobile });
// The game's own frame-rate check would switch the look mid-test: mark it done.
await page.addInitScript(() => { try { localStorage.setItem('splinterhall.settings', JSON.stringify({ perfChecked: true, perfV: 2 })); } catch {} });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&${query}`);
await page.waitForFunction(() => window.__splinterhall && window.__splinterhall.match && window.__splinterhall.match.state === 'round', null, { timeout: 60000 });
await page.waitForTimeout(wait * 1000);

const result = { size: `${W}x${H}`, dpr, query };
// The old block geometry, for the roundgeo config.
const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js');
const ROUND = (() => {
  const g = new RoundedBoxGeometry(1, 1, 2, 2, 0.045), pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    if (nz >= nx && nz >= ny) uv.setXY(i, x + 0.5, y + 0.5); else if (ny >= nx) uv.setXY(i, x + 0.5, z + 0.5); else uv.setXY(i, z + 0.5, y + 0.5);
  }
  return { position: [...pos.array], normal: [...nrm.array], uv: [...uv.array] };
})();

// Live frames: whole-loop frame time and its split.
if (live > 0) {
  result.live = await page.evaluate(async (secs) => {
    const app = window.__splinterhall, m = app.match, v = app.view, r = v.renderer;
    const acc = { sim: 0, draw: 0, gl: 0 };
    const wrap = (obj, key, slot) => { const f = obj[key]; obj[key] = function (...a) { const t = performance.now(); const out = f.apply(this, a); acc[slot] += performance.now() - t; return out; }; return () => { obj[key] = f; }; };
    const undo = [wrap(m, 'update', 'sim'), wrap(m, 'draw', 'draw'), v.composer ? wrap(v.composer, 'render', 'gl') : wrap(r, 'render', 'gl')];
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const T = performance.now() - t0;
    undo.forEach((u) => u());
    return { fps: +(frames / (T / 1000)).toFixed(1), frameMs: +(T / frames).toFixed(1), simMs: +(acc.sim / frames).toFixed(2), viewJsMs: +((acc.draw - acc.gl) / frames).toFixed(2), submitMs: +(acc.gl / frames).toFixed(2) };
  }, live);
}

// --seed S --tick T: restart the match with a fixed seed and step the simulation to tick T, so two builds
// show the same moment (the simulation is deterministic for a code, round and seed).
const seed = opt('seed', null), tick = +opt('tick', '0');
if (seed) {
  await page.evaluate(async ({ seed, tick }) => {
    const app = window.__splinterhall, old = app.match, M = old.constructor;
    const roster = old.roster, opts = { ...old.opts, seed }, code = old.code;
    app.endMatch();
    const m = new M(app, roster, opts);
    app.match = m;
    await m.startRound(code);
    app.paused = true;
    m.acc = 0;
    while (m.tick < tick && m.state === 'round') m.hostUpdate(1 / 60);
    // Apply the stepped events now (broken and falling blocks), then drop their effects: they would all go off at once.
    const v = app.view;
    v.applyEvents(m.tick);
    v.fx.clear();
  }, { seed, tick });
  await page.waitForTimeout(2500);
}
// --cam x,y,w: put the camera exactly there (no easing), so screenshots of two builds line up.
const camArg = opt('cam', null);
if (camArg) {
  await page.evaluate(([x, y, w]) => { const v = window.__splinterhall.view; v.fixedCam = { x, y, w }; Object.assign(v.cam, { x, y, w, tx: x, ty: y, tw: w, vx: 0, vy: 0, vw: 0 }); }, camArg.split(',').map(Number));
  await page.waitForTimeout(1500);
}
// Optionally hold the camera close on the fighters, the way the match camera will frame the local player.
const zoom = +opt('zoom', '0');
if (zoom) {
  await page.evaluate((w) => {
    const v = window.__splinterhall.view, f = v.cur && v.cur.fighters.filter((x) => x.alive);
    const x = f && f.length ? f.reduce((s, q) => s + q.parts[3], 0) / f.length : 20, y = f && f.length ? f.reduce((s, q) => s + q.parts[4], 0) / f.length : 12;
    v.fixedCam = { x, y: y + 1, w };
  }, zoom);
  await page.waitForTimeout(3500);
}
// Freeze one moment: no simulation, no particle motion, no weather.
await page.evaluate(() => { const app = window.__splinterhall; app.paused = true; app.view.freezeFx = true; });
await page.waitForTimeout(300);
if (shot) await page.screenshot({ path: shot, timeout: 180000 });

result.scene = await page.evaluate(() => {
  const app = window.__splinterhall, v = app.view;
  // Triangles and vertices by part of the scene (one draw each, before shadows), and shadow casters.
  const cats = {};
  const blockSet = new Set(v.blocks.all ? v.blocks.all() : [...v.blocks.meshes.values()]);
  const fighterSet = new Set([...v.fighters.meshes, ...v.fighters.outlines]);
  const fxSet = new Set([v.fx.spark, v.fx.fire, v.fx.smoke, v.fx.shard, v.fx.ember, v.fx.weather, ...v.fx.debris.values()].map((p) => p.mesh));
  const envSet = new Set(); v.env.root.traverse((o) => envSet.add(o));
  v.scene.updateMatrixWorld();
  v.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const g = o.geometry; if (!g) return;
    const inst = o.isInstancedMesh ? o.count : 1;
    if (!inst) return;
    const idx = g.index ? g.index.count : g.attributes.position.count;
    const cat = blockSet.has(o) ? 'blocks' : fighterSet.has(o) ? 'fighters' : fxSet.has(o) ? 'fx' : envSet.has(o) ? 'backdrop' : 'other';
    const c = cats[cat] || (cats[cat] = { draws: 0, tris: 0, verts: 0, casters: 0, casterTris: 0, transparent: 0 });
    c.draws++; c.tris += (idx / 3) * inst; c.verts += g.attributes.position.count * inst;
    if (o.castShadow) { c.casters++; c.casterTris += (idx / 3) * inst; }
    if (o.material && o.material.transparent) c.transparent++;
  });
  for (const c of Object.values(cats)) { c.tris = Math.round(c.tris); }
  const r = v.renderer;
  return { cats, pixelRatio: r.getPixelRatio(), drawingBuffer: [r.domElement.width, r.domElement.height], programs: r.info.programs.length, textures: r.info.memory.textures, geometries: r.info.memory.geometries, quality: v.qname, setting: v.setting };
});

// Install the configs (things to switch off or change) as window.__perfApply(name) -> undo().
await page.evaluate(({ ROUND }) => {
  const app = window.__splinterhall, v = app.view, r = v.renderer;
  const blocks = () => (v.blocks.all ? v.blocks.all() : [...v.blocks.meshes.values()]);
  const backdrop = () => v.env.root.children.filter((o) => !o.isLight && !(o.isObject3D && v.env.key && o === v.env.key.target));
  const hide = (list) => { const was = list.map((o) => o.visible); list.forEach((o) => { o.visible = false; }); return () => list.forEach((o, k) => { o.visible = was[k]; }); };
  const setPR = (pr) => { const old = r.getPixelRatio(); const w = r.domElement.clientWidth, h = r.domElement.clientHeight; r.setPixelRatio(pr); r.setSize(w, h, false); if (v.composer) v.composer.setSize(w, h); return () => { r.setPixelRatio(old); r.setSize(w, h, false); if (v.composer) v.composer.setSize(w, h); }; };
  const C = {
    base: () => () => {},
    nopost: () => { const c = v.composer, tm = r.toneMapping; v.composer = null; r.setRenderTarget(null); r.toneMapping = 6; /* AgX, as the lite path */ return () => { v.composer = c; r.toneMapping = tm; }; },
    nosmaa: () => { const P = v.composer && v.composer.passes; if (!P) return () => {}; const last = P[P.length - 1], prev = P[P.length - 2]; last.enabled = false; prev.renderToScreen = true; return () => { last.enabled = true; prev.renderToScreen = false; }; },
    nobloom: () => { const b = v.bloom; if (!b || !v.composer) return () => {}; const u = b.update; b.update = () => {}; return () => { b.update = u; }; },
    noao: () => { const P = v.composer && v.composer.passes; if (!P || P.length < 5) return () => {}; P[1].enabled = false; P[2].enabled = false; return () => { P[1].enabled = true; P[2].enabled = true; }; },
    noshadow: () => { const k = v.env.key, was = k.castShadow; k.castShadow = false; return () => { k.castShadow = was; }; },
    shadow1k: () => { const k = v.env.key, s = k.shadow.mapSize.x; const set = (n) => { k.shadow.mapSize.set(n, n); if (k.shadow.map) { k.shadow.map.dispose(); k.shadow.map = null; } }; set(1024); return () => set(s); },
    noblocks: () => hide(blocks()),
    nofighters: () => hide([...v.fighters.meshes, ...v.fighters.outlines]),
    nooutlines: () => hide([...v.fighters.outlines]),
    nofx: () => hide([v.fx.spark, v.fx.fire, v.fx.smoke, v.fx.shard, v.fx.ember, v.fx.weather, ...v.fx.debris.values()].map((p) => p.mesh)),
    nobackdrop: () => hide(backdrop()),
    nosky: () => hide(backdrop().filter((o) => o.renderOrder === -10)),
    nomist: () => hide([...(v.env.mist || []), ...(v.env.curtain ? [v.env.curtain] : []), ...(v.env.liquid && !v.env.mist ? [v.env.liquid] : [])]),
    noenvmap: () => { const e = v.scene.environment; v.scene.environment = null; return () => { v.scene.environment = e; }; },
    nopoint: () => { const L = []; v.scene.traverse((o) => { if (o.isPointLight && o.visible) L.push(o); }); return hide(L); },
    onlyblocks: () => { const keep = new Set(blocks()); const L = []; v.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !keep.has(o) && o.visible) L.push(o); }); return hide(L); },
    empty: () => { const L = []; v.scene.traverse((o) => { if (o.isMesh && o.visible) L.push(o); }); return hide(L); },
    // The pre-optimisation block: RoundedBoxGeometry(1, 1, 2, 2, 0.045), 900 unshared vertices (arrays made in Node).
    roundgeo: () => {
      const bl = v.blocks; if (!bl.geo || !bl.all) return () => {};
      const G = bl.geo, BA = G.attributes.position.constructor;
      const old = { position: G.attributes.position, normal: G.attributes.normal, uv: G.attributes.uv, index: G.index };
      const neu = { position: new BA(new Float32Array(ROUND.position), 3), normal: new BA(new Float32Array(ROUND.normal), 3), uv: new BA(new Float32Array(ROUND.uv), 2) };
      const set = (a) => { for (const m of bl.all()) { const g = m.geometry; for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, a[k]); g.setIndex(a.index || null); } };
      set(neu);
      return () => set(old);
    },
    pr1: () => setPR(1), 'pr1.25': () => setPR(1.25), 'pr1.5': () => setPR(1.5), pr2: () => setPR(2), pr3: () => setPR(3),
  };
  // k:key=value;key=value sets look knobs through view.setQuality (the new build only).
  const knob = (spec) => {
    const over = {};
    for (const kv of spec.split(';')) { const [k, val] = kv.split('='); over[k] = val === 'true' ? true : val === 'false' ? false : isNaN(+val) ? val : +val; }
    const name = v.qname, res = v.resScale, was = {};
    for (const k of Object.keys(over)) was[k] = v.q[k];
    v.setQuality(name, res, over);
    return () => v.setQuality(name, res, was);
  };
  // Composite configs: a+b+c.
  window.__perfApply = (name) => { const undos = name.split('+').map((p) => { if (p.startsWith('k:')) return knob(p.slice(2)); if (!C[p]) throw new Error('unknown config ' + p); return C[p](); }); return () => undos.reverse().forEach((u) => u()); };
}, { ROUND });

// Work counts for this frozen frame, independent of how busy the machine is (same seed and tick = same frame):
// draws, triangles and vertex-shader runs in the main and shadow passes (after frustum culling), fragments
// shaded in the main pass (each fragment that passes the depth test adds 1 to a pixel; summed), and the
// full-screen post passes with the pixels they write.
const workOf = (cfg) => page.evaluate((cfg) => {
  const app = window.__splinterhall, v = app.view, r = v.renderer, gl = r.getContext();
  const undoCfg = window.__perfApply(cfg);
  const render = () => { if (v.composer) v.composer.render(1 / 60); else r.render(v.scene, v.camera); };
  render();
  v.scene.updateMatrixWorld(true);
  // Frustum planes from a camera (Gribb-Hartmann), and a sphere test like three.js's own culling.
  const planes = (cam) => {
    cam.updateMatrixWorld();
    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
    const P = [[m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]], [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]], [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]]];
    return P.map(([a, b, c, d]) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l, d / l]; });
  };
  const sphereOf = (o) => {
    let s = o.isInstancedMesh ? (o.boundingSphere || (o.computeBoundingSphere(), o.boundingSphere)) : (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
    const c = s.center.clone().applyMatrix4(o.matrixWorld), e = o.matrixWorld.elements;
    const sc = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    return [c.x, c.y, c.z, s.radius * sc];
  };
  const inside = (P, [x, y, z, rad]) => P.every(([a, b, c, d]) => a * x + b * y + c * z + d >= -rad);
  const count = (cam, filter) => {
    const P = planes(cam), out = { draws: 0, tris: 0, verts: 0 };
    v.scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry || !filter(o)) return;
      const inst = o.isInstancedMesh ? o.count : 1;
      if (!inst || (o.frustumCulled && !inside(P, sphereOf(o)))) return;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      out.draws++; out.tris += Math.round(n / 3) * inst; out.verts += (g.index ? g.attributes.position.count : n) * inst;
    });
    return out;
  };
  const main = count(v.camera, () => true);
  const key = v.env.key;
  const shadow = key && key.castShadow && r.shadowMap.enabled ? count(key.shadow.camera, (o) => o.castShadow) : null;
  // Post passes: every full-screen render after the scene pass, and the pixels it writes.
  const post = { passes: 0, mpix: 0 };
  if (v.composer) {
    const f = r.render;
    r.render = function (scene, cam) {
      if (scene !== v.scene) { const t = r.getRenderTarget(); post.passes++; post.mpix += t ? t.width * t.height : r.domElement.width * r.domElement.height; }
      return f.call(this, scene, cam);
    };
    v.composer.render(1 / 60);
    r.render = f;
    post.mpix = +(post.mpix / 1e6).toFixed(2);
  }
  // Fragments: every fragment that passes the depth test adds 1/255, drawn in the scene's own sorted order
  // (each object keeps its place through renderOrder = its rank in three.js's render list) with its own
  // side and depth settings.
  const BasicMat = v.ents.beams[0].line.material.constructor;
  // Counted per channel: red the blocks, green the scenery (sky, backdrop, liquid, mist), blue the rest.
  const blockSet = new Set(v.blocks.all ? v.blocks.all() : [...v.blocks.meshes.values()]);
  const envSet = new Set(); v.env.root.traverse((o) => envSet.add(o));
  const variants = new Map();
  const variant = (m, o) => {
    const ch = blockSet.has(o) ? 0 : envSet.has(o) ? 1 : 2;
    const k = `${m.side}|${m.depthTest}|${m.depthWrite}|${ch}`;
    if (!variants.has(k)) {
      const mm = new BasicMat({ blending: 2 /* additive */, fog: false, toneMapped: false, side: m.side, depthTest: m.depthTest, depthWrite: m.depthWrite });
      mm.color.setRGB(ch === 0 ? 1 / 255 : 0, ch === 1 ? 1 / 255 : 0, ch === 2 ? 1 / 255 : 0); // linear, written as is
      variants.set(k, mm);
    }
    return variants.get(k);
  };
  const list = r.renderLists.get(v.scene, 0);
  const items = [...list.opaque, ...list.transmissive, ...list.transparent];
  const saved = new Map();
  items.forEach((it, i) => { const o = it.object; if (saved.has(o)) return; saved.set(o, [o.material, o.renderOrder]); o.renderOrder = i; o.material = variant(it.material, o); });
  const keep = { bg: v.scene.background, cs: r.outputColorSpace, tm: r.toneMapping, sm: r.shadowMap.autoUpdate };
  v.scene.background = null; r.outputColorSpace = 'srgb-linear'; r.toneMapping = 0; r.shadowMap.autoUpdate = false;
  r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear();
  r.render(v.scene, v.camera);
  const w = r.domElement.width, h = r.domElement.height, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let frags = 0, maxLayer = 0;
  const by = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) { by[0] += px[i]; by[1] += px[i + 1]; by[2] += px[i + 2]; const n = px[i] + px[i + 1] + px[i + 2]; frags += n; if (n > maxLayer) maxLayer = n; }
  for (const [o, [m, ro]] of saved) { o.material = m; o.renderOrder = ro; }
  v.scene.background = keep.bg; r.outputColorSpace = keep.cs; r.toneMapping = keep.tm; r.shadowMap.autoUpdate = keep.sm;
  for (const m of variants.values()) m.dispose();
  render();
  undoCfg();
  return { main, shadow, post, pixels: w * h, fragments: frags, fragBlocks: by[0], fragScenery: by[1], fragOther: by[2], overdraw: +(frags / (w * h)).toFixed(2), maxLayer };
}, cfg);
result.work = await workOf('base');
result.workConfigs = {};
for (const c of (opt('workconfigs', '') || '').split(',').filter(Boolean)) result.workConfigs[c] = await workOf(c);

// Screenshots of the frozen moment with configs applied (to see what each costs the look).
const shotConfigs = opt('shotconfigs', null), shotDir = opt('shotdir', '.');
if (shotConfigs) {
  for (const name of shotConfigs.split(',')) {
    await page.evaluate((n) => { window.__perfUndo = window.__perfApply(n); }, name);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shotDir, name.replace(/[^a-z0-9.=+-]+/gi, '_') + '.png'), timeout: 180000 });
    await page.evaluate(() => window.__perfUndo());
  }
}

result.configs = await page.evaluate(({ configs, N, R }) => {
  const app = window.__splinterhall, v = app.view, r = v.renderer, gl = r.getContext();
  const apply = window.__perfApply;
  // cpu: main-thread time to issue the frame (three.js + WebGL calls), before waiting for the GPU process.
  const renderOnce = (cpu) => {
    const t0 = performance.now();
    if (v.composer) { r.info.autoReset = false; r.info.reset(); v.composer.render(1 / 60); } else { r.info.autoReset = true; r.render(v.scene, v.camera); }
    // gl.finish() does not wait in Chrome; reading a pixel back does.
    if (cpu) cpu.push(performance.now() - t0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // the screen is bound after the last pass
  };
  const px = new Uint8Array(4);
  // Samples interleave the configs one render at a time (in a rotating order), so other work on the machine
  // lands on all configs alike. Busy-machine noise only ever adds time, so the low quartile and the minimum
  // are the steadiest estimates; compare those.
  const acc = {};
  const undoAll = {};
  for (let s = 0; s < N * R; s++) {
    for (let j = 0; j < configs.length; j++) {
      const name = configs[(j + s) % configs.length];
      const undo = apply(name);
      renderOnce(); renderOnce(); // compile and warm up (render targets and shaders are cached after the first time)
      const cs = [];
      const t = performance.now(); renderOnce(cs); const ms = performance.now() - t;
      const a = acc[name] || (acc[name] = { ts: [], cs: [] });
      a.ts.push(ms); a.cs.push(cs[0]);
      a.calls = r.info.render.calls; a.tris = r.info.render.triangles; a.programs = r.info.programs.length;
      undo();
    }
  }
  for (let k = 0; k < 2; k++) renderOnce();
  const q = (x, f) => { const y = [...x].sort((p, q2) => p - q2); return +y[Math.floor((y.length - 1) * f)].toFixed(1); };
  const out = {};
  for (const [name, a] of Object.entries(acc)) out[name] = { ms: q(a.ts, 0.5), p25: q(a.ts, 0.25), min: q(a.ts, 0), cpu: q(a.cs, 0.25), calls: a.calls, tris: a.tris, programs: a.programs };
  return out;
}, { configs, N, R });

console.log(JSON.stringify({ size: result.size, dpr, query, live: result.live, scene: { ...result.scene, cats: undefined } }));
const fmtWork = (wk) => `main ${wk.main.draws} draws ${wk.main.tris} tris ${wk.main.verts} verts · shadow ${wk.shadow ? `${wk.shadow.draws} draws ${wk.shadow.tris} tris ${wk.shadow.verts} verts` : 'off'} · fragments ${(wk.fragments / 1e6).toFixed(2)} M (${wk.overdraw}x of ${(wk.pixels / 1e6).toFixed(2)} Mpx; blocks ${(wk.fragBlocks / 1e6).toFixed(2)}, scenery ${(wk.fragScenery / 1e6).toFixed(2)}, rest ${(wk.fragOther / 1e6).toFixed(2)}) · post ${wk.post.passes} passes ${wk.post.mpix} Mpx`;
for (const [k, w] of Object.entries(result.workConfigs || {})) console.log(`  work with ${k}: ${fmtWork(w)}`);
const wk = result.work;
console.log(`  work: main ${wk.main.draws} draws ${wk.main.tris} tris ${wk.main.verts} verts · shadow ${wk.shadow ? `${wk.shadow.draws} draws ${wk.shadow.tris} tris ${wk.shadow.verts} verts` : 'off'} · fragments ${(wk.fragments / 1e6).toFixed(2)} M (${wk.overdraw}x of ${(wk.pixels / 1e6).toFixed(2)} Mpx; blocks ${(wk.fragBlocks / 1e6).toFixed(2)}, scenery ${(wk.fragScenery / 1e6).toFixed(2)}, rest ${(wk.fragOther / 1e6).toFixed(2)}) · post ${wk.post.passes} passes ${wk.post.mpix} Mpx`);
for (const [k, c] of Object.entries(result.scene.cats)) console.log(`  ${k.padEnd(9)} draws ${String(c.draws).padStart(4)}  tris ${String(c.tris).padStart(7)}  verts ${String(c.verts).padStart(7)}  casters ${String(c.casters).padStart(3)} (${c.casterTris} tris)  transparent ${c.transparent}`);
const first = Object.values(result.configs)[0];
for (const [k, c] of Object.entries(result.configs)) console.log(`  ${k.padEnd(30)} low quartile ${String(c.p25).padStart(7)} ms  min ${String(c.min).padStart(7)}  median ${String(c.ms).padStart(7)}  (Δ low quartile vs first ${(c.p25 - first.p25).toFixed(0).padStart(6)})  cpu ${c.cpu}  calls ${c.calls}  tris ${c.tris}`);
if (logs.length) console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 12).join('\n'));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1));
await browser.close();
server.close();
