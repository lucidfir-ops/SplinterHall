// Plays the Learn tutorial from the title screen with the keyboard, step by step, and checks that each step
// ticks off and the finish screen appears.   node tools/dev/tutorial.mjs [shot-dir]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const shots = process.argv[2];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite${shots ? '' : '&render=0'}`);
await page.waitForTimeout(5000);
const wait = (ms) => page.waitForTimeout(ms);
const st = () => page.evaluate(() => { const a = window.__splinterhall, t = a.tutorial, m = a.match;
  const me = t && t.me(), dm = t && t.dummy();
  const it = m && m.sim ? [...m.sim.items.world.values()].map((w) => w.body.translation().x) : [];
  return { k: t ? t.k : null, title: t && t.panel ? t.panel.querySelector('.t').textContent : null, menu: a.menus.cur && a.menus.cur.id, phase: m && m.sim && m.sim.phase,
    x: me ? me.pos().x : 0, y: me ? me.pos().y : 0, alive: me ? me.alive : false, held: me && me.item ? me.item.kind : null, dx: dm ? dm.pos().x : 0, dAlive: dm ? dm.alive : false, items: it }; });
// Start from the title menu.
await page.evaluate(() => { const a = window.__splinterhall; const f = a.menus.focusables.find((q) => q.it.label === 'Learn'); f.it.onOk(); });
for (let i = 0; i < 40 && (await st()).phase !== 'fight'; i++) await wait(200);
const tap = async (key, ms = 60) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
// Walk until x is within `near` of target: left of it (side -1), right (1), or whichever side we're on (0).
async function walkTo(tx, near = 0.9, side = 0, limit = 6000) {
  const t0 = Date.now();
  if (!side) side = Math.sign((await st()).x - tx) || -1;
  while (Date.now() - t0 < limit) {
    const s = await st();
    const goal = tx + side * near;
    if (Math.abs(s.x - goal) < 0.25) break;
    const key = s.x < goal ? 'ArrowRight' : 'ArrowLeft';
    // Blocked (the stone box): hop over it while still walking.
    if (Math.abs(s.x - (walkTo.lastX ?? -99)) < 0.08) { await page.keyboard.down(key); await tap('Space'); await wait(350); await page.keyboard.up(key); }
    walkTo.lastX = s.x;
    await hold(key, Math.min(250, Math.abs(s.x - goal) * 120 + 30));
  }
  // Face the target.
  const s = await st();
  await tap(tx > s.x ? 'ArrowRight' : 'ArrowLeft', 30);
}
async function until(k, label, fn, limit = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const s = await st();
    if (s.k > k || s.menu === 'tut-done') { console.log('ok  ', String(k + 1).padStart(2), label); return true; }
    await fn(s);
  }
  const s = await st();
  console.log('FAIL', String(k + 1).padStart(2), label, JSON.stringify(s));
  return false;
}
let bad = 0;
const step = async (...a) => { if (!(await until(...a))) bad++; };
await step(0, 'run', () => hold('ArrowRight', 400));
await step(1, 'jump, jump again', async () => { await tap('Space'); await wait(260); await tap('Space'); await wait(900); });
await step(2, 'wall jump', async (s) => {
  if (s.x > 2.6) { await hold('ArrowLeft', Math.min(600, (s.x - 2.4) * 110)); return; }
  await page.keyboard.down('ArrowLeft'); await tap('Space'); await wait(330); await tap('Space'); await wait(400); await page.keyboard.up('ArrowLeft'); await wait(700);
});
await step(3, 'duck', () => hold('ArrowDown', 900));
if (shots) await page.screenshot({ path: shots + '/tut-duck.png' });
await step(4, 'jab', async (s) => { await walkTo(s.dx, 1.0, 0); await tap('KeyX'); await wait(300); });
const combo = async (s, dirKey, key) => { await walkTo(s.dx, 0.9, 0); await page.keyboard.down(dirKey); await tap(key); await page.keyboard.up(dirKey); await wait(600); };
await step(5, 'uppercut', (s) => combo(s, 'ArrowUp', 'KeyX'));
await step(6, 'slam', (s) => combo(s, 'ArrowDown', 'KeyX'));
await step(7, 'haymaker', async (s) => { await walkTo(s.dx, 1.05, 0); await tap('KeyV'); await wait(700); });
await step(8, 'kick', async (s) => { await walkTo(s.dx, 0.95, 0); await tap('KeyC'); await wait(500); });
if (shots) await page.screenshot({ path: shots + '/tut-kick.png' });
await step(9, 'pick up', async (s) => { if (s.items.length) { await walkTo(s.items[0], 0.1, Math.sign(s.items[0] - s.x) || 1); await tap('ArrowDown', 120); } await wait(400); });
await step(10, 'throw', async () => { await tap('KeyE'); await wait(500); });
await step(11, 'finish', async (s) => {
  if (!s.dAlive) { await wait(500); return; }
  // On the dummy's right: hop over it to get behind, so the haymakers drive it toward the pit.
  if (s.x > s.dx - 0.3) { await page.keyboard.down('ArrowLeft'); await tap('Space'); await wait(250); await tap('Space'); await wait(500); await page.keyboard.up('ArrowLeft'); await wait(300); return; }
  // Up on the box above the dummy: slam down at it; otherwise haymaker it toward the pit.
  if (s.y > 5) { await page.keyboard.down('ArrowDown'); await tap('KeyX'); await page.keyboard.up('ArrowDown'); await page.keyboard.down('ArrowRight'); await wait(300); await page.keyboard.up('ArrowRight'); await wait(500); return; }
  await walkTo(s.dx, 1.0, -1); await tap('KeyV'); await wait(800);
}, 40000);
await wait(600);
const end = await st();
const finished = end.menu === 'tut-done';
if (!finished) bad++;
console.log(finished ? 'ok   finish screen' : 'FAIL finish screen ' + JSON.stringify(end));
if (shots) await page.screenshot({ path: shots + '/tut-done.png' });
const done = await page.evaluate(() => window.__splinterhall.settings.tutorialDone);
console.log('tutorialDone saved:', done);
console.log('errors', errs);
console.log(bad ? bad + ' failed' : 'all as expected');
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
