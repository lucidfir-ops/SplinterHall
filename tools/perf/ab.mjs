// Before/after timing that holds up on a busy machine: two builds open side by side in one browser, both
// stepped to the same moment (same level, seed and tick) and frozen, then frames rendered alternately
// A, B, A, B… so any other load on the machine hits both alike.
//   node tools/perf/ab.mjs <webA> <webB> [--size 844x390] [--dpr 1.5] [--query "bot=1&fighters=8&code=B7BGP1BR&quality=clean"]
//                          [--queryB "..."] [--seed perf1] [--tick 900] [--n 12] [--cam 20,11.5,42] [--zoom 0]
// The camera is placed exactly (--cam x,y,width; the default is the whole arena), or on the fighters at --zoom m.
// Prints, per build: low quartile, minimum and median of the frame time (SwiftShader: a proxy for GPU work),
// the main-thread time to issue a frame (three.js + WebGL calls) and draw calls.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const dirs = [path.resolve(argv[0]), path.resolve(argv[1])];
const [W, H] = opt('size', '844x390').split('x').map(Number);
const dpr = +opt('dpr', '1.5');
const qA = opt('query', 'bot=1&fighters=8&code=B7BGP1BR&quality=clean'), qB = opt('queryB', qA);
const seed = opt('seed', 'perf1'), tick = +opt('tick', '900'), N = +opt('n', '12'), zoom = +opt('zoom', '0');
const cam = opt('cam', '20,11.5,42').split(',').map(Number);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json', '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const [, which, ...rest] = decodeURIComponent(req.url.split('?')[0]).split('/');
  const root = dirs[which === 'b' ? 1 : 0];
  const p = path.join(root, rest.join('/') || 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const pages = [];
for (const [k, q] of [['a', qA], ['b', qB]]) {
  const mobile = W > H && H < 500; // a phone held sideways: touch, so the game's isPhone() is true
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: mobile, isMobile: mobile });
  // The game's own frame-rate check would switch the look mid-test: mark it done.
  await page.addInitScript(() => { try { localStorage.setItem('splinterhall.settings', JSON.stringify({ perfChecked: true, perfV: 2 })); } catch {} });
  await page.goto(`http://127.0.0.1:${server.address().port}/${k}/index.html?test=1&${q}`);
  await page.waitForFunction(() => window.__splinterhall && window.__splinterhall.match && window.__splinterhall.match.state === 'round', null, { timeout: 180000, polling: 500 });
  // Same moment in both: restart with a fixed seed, step to the tick, apply the events, drop their effects.
  await page.evaluate(async ({ seed, tick }) => {
    const app = window.__splinterhall, old = app.match, M = old.constructor;
    const opts = { ...old.opts, seed }, code = old.code, roster = old.roster;
    app.endMatch();
    const m = new M(app, roster, opts);
    app.match = m;
    await m.startRound(code);
    app.paused = true;
    m.acc = 0;
    while (m.tick < tick && m.state === 'round') m.hostUpdate(1 / 60);
    app.view.applyEvents(m.tick);
    app.view.fx.clear();
  }, { seed, tick });
  // Place the camera exactly (no easing), draw that frame once, then stop the page's own drawing so the
  // two pages don't compete while they load.
  await page.evaluate(({ cam, zoom }) => {
    const app = window.__splinterhall, v = app.view;
    v.draw(app.match.renderTick, 1 / 60);
    let [x, y, w] = cam;
    if (zoom) { const f = v.cur.fighters.filter((q) => q.alive); x = f.reduce((s, q) => s + q.parts[3], 0) / f.length; y = f.reduce((s, q) => s + q.parts[4], 0) / f.length + 1; w = zoom; }
    v.fixedCam = { x, y, w };
    Object.assign(v.cam, { x, y, w, tx: x, ty: y, tw: w, vx: 0, vy: 0, vw: 0 });
    for (let k = 0; k < 3; k++) v.draw(app.match.renderTick, 1 / 60);
    v.freezeFx = true; v.draw = () => {};
  }, { cam, zoom });
  pages.push(page);
}
const timeOne = (page) => page.evaluate(() => {
  const v = window.__splinterhall.view, r = v.renderer, gl = r.getContext(), px = new Uint8Array(4);
  const go = () => { if (v.composer) { r.info.autoReset = false; r.info.reset(); v.composer.render(1 / 60); } else { r.info.autoReset = true; r.render(v.scene, v.camera); } };
  go(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now(); go(); const t1 = performance.now();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { ms: performance.now() - t0, cpu: t1 - t0, calls: r.info.render.calls, buffer: [r.domElement.width, r.domElement.height] };
});
const acc = [[], []];
for (let i = 0; i < N; i++) for (const k of i % 2 ? [1, 0] : [0, 1]) acc[k].push(await timeOne(pages[k]));
const q = (x, f) => { const y = [...x].sort((a, b) => a - b); return y[Math.floor((y.length - 1) * f)]; };
const rows = acc.map((a, k) => ({ build: path.basename(path.dirname(dirs[k])) + '/' + path.basename(dirs[k]), p25: q(a.map((x) => x.ms), 0.25), min: q(a.map((x) => x.ms), 0), med: q(a.map((x) => x.ms), 0.5), cpu: q(a.map((x) => x.cpu), 0.25), calls: a[0].calls, buffer: a[0].buffer.join('x') }));
for (const r of rows) console.log(`${r.build.padEnd(28)} frame low quartile ${r.p25.toFixed(0).padStart(6)} ms  min ${r.min.toFixed(0).padStart(6)}  median ${r.med.toFixed(0).padStart(6)}  issue ${r.cpu.toFixed(1)} ms  calls ${r.calls}  buffer ${r.buffer}`);
console.log(`B/A low quartile ${(rows[1].p25 / rows[0].p25).toFixed(2)}  min ${(rows[1].min / rows[0].min).toFixed(2)}  median ${(rows[1].med / rows[0].med).toFixed(2)}  issue ${(rows[1].cpu / rows[0].cpu).toFixed(2)}`);
await browser.close();
server.close();
