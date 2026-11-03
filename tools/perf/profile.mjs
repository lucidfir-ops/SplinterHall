// Main-thread JavaScript per frame, by source file and by function (Chrome's sampling profiler over a live match).
//   node tools/perf/build-perf.mjs tools/perf/out/web          (unminified, so names survive)
//   node tools/perf/profile.mjs [--web tools/perf/out/web] [--size 640x300] [--dpr 1] [--query "..."] [--wait 6] [--secs 6] [--top 25]
// Time the main thread spends waiting for the (SwiftShader) GPU process shows up under WebGL calls and
// "(program)"; on a phone that wait is GPU time, not JavaScript. Keep the canvas small to keep it low.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const web = path.resolve(opt('web', path.join(root, 'tools', 'perf', 'out', 'web')));
const [W, H] = opt('size', '640x300').split('x').map(Number);
const dpr = +opt('dpr', '1');
const query = opt('query', 'bot=1&fighters=8&code=B7BGP1BR');
const wait = +opt('wait', '6');
const secs = +opt('secs', '6');
const top = +opt('top', '25');

// Map bundle lines to source files from esbuild's "// src/…" module markers.
const bundle = fs.readFileSync(path.join(web, 'game.js'), 'utf8').split('\n');
const marks = [];
bundle.forEach((l, i) => {
  if (!l.startsWith('// ') || !/\.m?js$/.test(l)) return;
  const lib = /node_modules\/(@[^/]+\/[^/]+|[^/]+)/.exec(l), src = /(?:^\/\/ |\/)(src\/\S+)$/.exec(l);
  if (lib) marks.push([i, lib[1]]); else if (src) marks.push([i, src[1]]);
});
const fileOf = (line) => { let lo = 0, hi = marks.length - 1, f = '?'; while (lo <= hi) { const mid = (lo + hi) >> 1; if (marks[mid][0] <= line) { f = marks[mid][1]; lo = mid + 1; } else hi = mid - 1; } return f; };

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
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
// The game's own frame-rate check would switch the look mid-test: mark it done.
await page.addInitScript(() => { try { localStorage.setItem('splinterhall.settings', JSON.stringify({ perfChecked: true, perfV: 2 })); } catch {} });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&${query}`);
await page.waitForFunction(() => window.__splinterhall && window.__splinterhall.match && window.__splinterhall.match.state === 'round', null, { timeout: 60000 });
await page.waitForTimeout(wait * 1000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const wall = Date.now() - t0;
const frames = await page.evaluate(() => window.__frames);

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let k = 0; k < profile.samples.length; k++) {
  const id = profile.samples[k], dt = (profile.timeDeltas[k] || 0) / 1000;
  self.set(id, (self.get(id) || 0) + dt);
}
const fn = new Map(), files = new Map();
let total = 0;
for (const [id, ms] of self) {
  const n = byId.get(id), cf = n.callFrame;
  const file = cf.url.endsWith('game.js') ? fileOf(cf.lineNumber) : cf.url ? path.basename(cf.url) : cf.functionName || '(native)';
  const key = `${cf.functionName || '(anon)'}  ${file}:${cf.lineNumber + 1}`;
  fn.set(key, (fn.get(key) || 0) + ms);
  files.set(file, (files.get(file) || 0) + ms);
  if (cf.functionName !== '(idle)') total += ms;
}
const per = (ms) => (ms / frames).toFixed(2).padStart(7);
console.log(`${frames} frames in ${(wall / 1000).toFixed(1)} s (${(frames / (wall / 1000)).toFixed(1)} fps); busy ${per(total)} ms/frame`);
console.log('-- by file (ms per frame)');
for (const [f, ms] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(per(ms), f);
console.log('-- by function (self ms per frame)');
for (const [f, ms] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(per(ms), f);
await browser.close();
server.close();
