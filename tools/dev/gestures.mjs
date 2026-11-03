// Real touches on the gesture square in a phone-sized page (Chrome turns CDP touch events into pointer events):
// tap, hold, short swipes, a big sweep, a kick-band swipe; checks the input the game reads and the move the
// local fighter makes. Also checks the move pad: dragging down ducks.   node tools/dev/gestures.mjs [shot.png]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&dev=1&fighters=2&quality=lite&code=BXAH67KH${process.argv[2] ? '' : '&render=0'}`);
await page.waitForTimeout(6000);
const cdp = await ctx.newCDPSession(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
// A gesture: a list of points (shares of the square), ms between points.
async function gesture(points, stepMs = 16, holdMs = 0) {
  const r = await page.evaluate(() => { const b = document.querySelector('.sh-tact').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const P = points.map(([u, v]) => [r.x + u * r.w, r.y + v * r.h]);
  await touch('touchStart', ...P[0]);
  for (const p of P.slice(1)) { await wait(stepMs); await touch('touchMove', ...p); }
  if (holdMs) await wait(holdMs);
  await touch('touchEnd');
}
const state = () => page.evaluate(() => { const a = window.__splinterhall, i = a.input, m = a.match, f = m.sim.fighters[m.localSlot];
  return { jp: i.jp, ap: i.ap, ak: i.ak, ad: i.ad, swing: f.swing && f.swing.kind, y: +f.pos().y.toFixed(2), ducking: f.ducking, aim: +f.aim.toFixed(2), visible: getComputedStyle(document.querySelector('.sh-tact')).display }; });
// The AI opponent stands still, far off.
await page.evaluate(() => { const m = window.__splinterhall.match; m.bots = []; });
// Record swing events of the local fighter.
await page.evaluate(() => { const m = window.__splinterhall.match; const sim = m.sim; window.__sw = []; const emit = sim.emit.bind(sim); sim.emit = (e) => { if (e.t === 'swing' && e.s === m.localSlot) window.__sw.push(e.k); if ((e.t === 'jump' || e.t === 'throw') && e.s === m.localSlot) window.__sw.push(e.t); const r = emit(e); if (e.t === 'throw') { const it = sim.items.world.get(e.id); window.__throwV = it && it.body.linvel(); } return r; }; });
const take = () => page.evaluate(() => { const r = window.__sw.slice(); window.__sw.length = 0; return r; });
let bad = 0;
async function check(name, fn, expect) {
  await take();
  const before = await state();
  await fn();
  await wait(450);
  const after = await state(), moves = await take();
  const ok = expect(before, after, moves);
  if (!ok) bad++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name.padEnd(30), 'moves', JSON.stringify(moves), 'ak', after.ak, 'ad', after.ad, 'jp+', after.jp - before.jp, 'ap+', after.ap - before.ap);
}
console.log('square visible:', (await state()).visible);
// Wait for the fight phase.
for (let i = 0; i < 30 && !(await page.evaluate(() => window.__splinterhall.match.sim.phase === 'fight')); i++) await wait(200);
await check('tap (empty hands) = jump', () => gesture([[0.5, 0.3]], 16, 60), (b, a, m) => a.ap === b.ap + 1 && a.ak === 6 && m.includes('jump'));
await wait(900);
await check('hold still = no jump', () => gesture([[0.5, 0.3]], 16, 500), (b, a, m) => a.jp === b.jp && a.ap === b.ap && !m.includes('jump'));
await wait(400);
// The stick pushed up jumps (a real drag on the left half).
{
  const p0 = await page.evaluate(() => ({ x: innerWidth * 0.2, y: innerHeight * 0.6 }));
  await take(); const b = await state();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y, id: 3 }] });
  for (let k = 1; k <= 4; k++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + k * 2, y: p0.y - k * 22, id: 3 }] }); }
  await wait(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(400);
  const a = await state(), m = await take();
  const ok = a.jp === b.jp + 1 && m.includes('jump');
  if (!ok) bad++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' stick up = jump'.padEnd(31), 'moves', JSON.stringify(m), 'jp+', a.jp - b.jp);
  await wait(900);
}
await check('short swipe right = jab', () => gesture([[0.4, 0.3], [0.5, 0.3], [0.6, 0.3], [0.68, 0.3]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 0 && m.includes('punch'));
await wait(300);
await check('swipe up = uppercut', () => gesture([[0.5, 0.5], [0.5, 0.4], [0.5, 0.3], [0.5, 0.2]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 3 && m.includes('uppercut'));
await wait(900);
await check('swipe down = slam', () => gesture([[0.5, 0.15], [0.5, 0.25], [0.5, 0.35], [0.5, 0.45]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 4 && m.includes('slam'));
await wait(400);
await check('diagonal swipe = jab that way', () => gesture([[0.4, 0.5], [0.47, 0.43], [0.54, 0.36], [0.6, 0.3]]), (b, a, m) => a.ak === 0 && m.includes('punch') && Math.abs(a.ad - 159) <= 6);
await wait(300);
await check('slow big sweep = haymaker', () => gesture([[0.9, 0.3], [0.82, 0.3], [0.74, 0.3], [0.66, 0.31], [0.58, 0.31], [0.5, 0.31], [0.42, 0.32], [0.34, 0.32], [0.26, 0.32], [0.18, 0.32]], 30), (b, a, m) => a.ap === b.ap + 1 && a.ak === 1 && m.includes('haymaker'));
await wait(600);
await check('swipe and hold = held', () => gesture([[0.4, 0.3], [0.5, 0.3], [0.6, 0.3]], 16, 400), (b, a, m) => a.ap === b.ap + 1 && a.ak === 0);
await wait(300);
await check('big sweep left = haymaker', () => gesture([[0.9, 0.3], [0.75, 0.3], [0.6, 0.31], [0.45, 0.31], [0.3, 0.32], [0.15, 0.32]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 1 && m.includes('haymaker'));
await wait(600);
await check('bottom-band swipe = kick', () => gesture([[0.3, 0.82], [0.4, 0.82], [0.5, 0.83], [0.6, 0.83]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 2 && m.includes('kick'));
await wait(500);
await check('long band sweep = dropkick', () => gesture([[0.1, 0.82], [0.3, 0.82], [0.5, 0.83], [0.7, 0.83], [0.85, 0.83]]), (b, a, m) => a.ap === b.ap + 1 && a.ak === 5 && m.includes('dropkick'));
await wait(1500);
// Throw: holding an item, a tap on the square throws it along the stick's aim.
await page.evaluate(() => { const m = window.__splinterhall.match; m.sim.fighters[m.localSlot].item = { kind: 'axe', ammo: Infinity, id: 990 }; });
{
  // The stick aiming forward and a little up (set directly: the stick itself is covered above), then a tap.
  await take();
  await page.evaluate(() => { const T = window.__splinterhall.input.touch; T.x = 0.9; T.y = 0.3; });
  await wait(120);
  await gesture([[0.5, 0.3]], 16, 50);
  await wait(400);
  await page.evaluate(() => { const T = window.__splinterhall.input.touch; T.x = 0; T.y = 0; });
  const moves = await take();
  const v = await page.evaluate(() => window.__throwV || null);
  const ok = moves.includes('throw') && v && v.x > 5 && v.y > 0;
  if (!ok) bad++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' holding: tap = throw'.padEnd(31), 'moves', JSON.stringify(moves), 'axe flying at', v ? `${v.x.toFixed(1)}, ${v.y.toFixed(1)}` : '-');
}
await wait(400);
await wait(1800); // let the fighter get up after the dropkick and the throw
await check('double tap = double jump', async () => { await gesture([[0.5, 0.3]], 16, 50); await wait(180); await gesture([[0.5, 0.3]], 16, 50); }, (b, a, m) => a.ap === b.ap + 2 && m.filter((x) => x === 'jump').length === 2);
await wait(900);
// Move pad: drag down and hold = duck.
const pad = await page.evaluate(() => ({ x: innerWidth * 0.2, y: innerHeight * 0.6 }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pad.x, y: pad.y, id: 2 }] });
for (let k = 1; k <= 4; k++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pad.x, y: pad.y + k * 20, id: 2 }] }); }
await wait(500);
const ducked = await state();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(600);
const stood = await state();
const duckOk = ducked.ducking && !stood.ducking && ducked.y < stood.y - 0.2;
if (!duckOk) bad++;
console.log((duckOk ? 'ok  ' : 'FAIL') + ' pad held down = duck'.padEnd(31), 'torso y ducked', ducked.y, 'standing', stood.y);
if (process.argv[2]) {
  await gesture([[0.9, 0.3], [0.7, 0.3], [0.5, 0.31], [0.3, 0.32]]);
  await wait(60);
  await page.screenshot({ path: process.argv[2] });
}
console.log('errors', errs);
console.log(bad ? bad + ' failed' : 'all as expected');
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
