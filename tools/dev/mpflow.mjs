// Two (or more) tabs in one browser over the local carrier: create, join, ready, fight, guest input, rematch, host drop.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const N = +(process.argv[2] || 2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const pages = [], errs = [];
for (let k = 0; k < N; k++) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(k + ' ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall/.test(m.text())) errs.push(k + ' ' + m.text().slice(0, 200)); });
  await p.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite&render=0&mp=local`);
  // Each tab acts as if it were the focused, visible one (in real play every player has their own device).
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  pages.push(p);
}
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
await wait(5);
for (let k = 0; k < N; k++) await pages[k].evaluate((k) => { const a = window.__splinterhall; a.settings.name = 'P' + k; a.settings.color = k * 2; }, k);
const st = (p) => p.evaluate(() => { const a = window.__splinterhall; const r = a.net.room; const m = a.match; return { menu: a.menus.cur && a.menus.cur.id, host: r && r.isHost, roster: r && r.roster.map((x) => x.name + (x.ready ? '+' : '') + (x.host ? '*' : '')).join(','), phase: r && r.phase, m: m && m.net ? { st: m.state, round: m.round, tick: m.tick, srv: Math.round(m.serverTick || 0), isHost: m.isHost } : null, q: r && r.quality().quality }; });
const show = async (label) => { for (let k = 0; k < pages.length; k++) if (pages[k]) console.log(label, k, JSON.stringify(await st(pages[k]))); };
await pages[0].evaluate(() => window.__splinterhall.net.create('local'));
await wait(1.5);
const code = await pages[0].evaluate(() => window.__splinterhall.net.room.code);
console.log('room', code);
for (let k = 1; k < N; k++) { await pages[k].evaluate((c) => window.__splinterhall.net.join(c), code); }
await wait(3);
await show('lobby');
await pages[0].evaluate(() => { const a = window.__splinterhall; a.matchOpts.bots = 2; a.matchOpts.roundsToWin = 1; a.net.room.setInfo({ opts: a.matchOpts }); });
for (let k = 0; k < N; k++) await pages[k].evaluate(() => { const a = window.__splinterhall; a.net.room.setMe({ ready: true }); setTimeout(() => a.net.tryStart(), 50); });
await wait(6);
await show('match');
for (let k = 0; k < N; k++) console.log('fps', k, await pages[k].evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res([n / 2, window.__splinterhall.match && window.__splinterhall.match.tick]); }; requestAnimationFrame(f); })));
if (process.env.PROFILE) {
  const c = await ctx.newCDPSession(pages[0]); await c.send('Profiler.enable'); await c.send('Profiler.start'); await wait(3); const { profile } = await c.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; const total = dt.reduce((a, b) => a + b, 0);
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + dt[i]); });
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => (v / total * 100).toFixed(1) + '% ' + k).join('\n'));
}
// Guest 1 holds right for 2 s: does its fighter move on the host?
const posOn = (p, slot) => p.evaluate((slot) => { const f = window.__splinterhall.match?.view?.cur?.fighters.find((x) => x.slot === slot); return f ? +f.parts[3].toFixed(2) : null; }, slot);
const gslot = await pages[1].evaluate(() => window.__splinterhall.match.localSlot);
const x0 = await posOn(pages[0], gslot);
const dir = x0 > 20 ? 'ArrowLeft' : 'ArrowRight';
await pages[1].keyboard.down(dir); await wait(1.5); await pages[1].keyboard.up(dir);
const x1 = await posOn(pages[0], gslot);
console.log('guest slot', gslot, 'x on host before/after', x0, x1, 'guest view', await posOn(pages[1], gslot));
// Play until the match is over (first to 1), up to 90 s.
for (let i = 0; i < 45; i++) { await wait(2); const s = await st(pages[0]); if (s.menu === 'over') break; }
await show('over');
await pages[0].evaluate(() => window.__splinterhall.net.rematch());
await wait(4);
await show('rematch');
// Second match, then the host drops out mid-fight.
for (let k = 0; k < N; k++) await pages[k].evaluate(() => { const a = window.__splinterhall; a.net.room.setMe({ ready: true }); setTimeout(() => a.net.tryStart(), 50); });
await wait(6);
await show('match2');
await pages[0].close(); pages[0] = null;
await wait(16);
await show('hostgone');
console.log('errors', errs.slice(0, 12));
await browser.close(); server.close();
