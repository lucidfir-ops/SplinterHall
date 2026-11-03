// Separate browsers (one per player, so none is a background tab) through the Wi-Fi host pack's relay.
//   node tools/dev/mprelay.mjs [players]     (needs: npm run build; starts dist/wifi-host/wifi-host.py itself)
import { spawn } from 'node:child_process'; import path from 'node:path'; import { chromium } from 'playwright';
const N = +(process.argv[2] || 3), port = 5300 + Math.floor(Math.random() * 600);
const py = spawn('python3', [path.resolve('dist/wifi-host/wifi-host.py'), '--port', String(port), '--local'], { stdio: 'ignore' });
process.on('exit', () => py.kill());
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
await wait(1.2);
const errs = [], browsers = [], pages = [];
for (let k = 0; k < N; k++) {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', (e) => errs.push(k + ' ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall/.test(m.text())) errs.push(k + ' ' + m.text().slice(0, 200)); });
  await p.goto(`http://127.0.0.1:${port}/index.html?test=1&quality=lite&render=${k === 1 ? 1 : 0}`);
  browsers.push(b); pages.push(p);
}
await wait(5);
for (let k = 0; k < N; k++) await pages[k].evaluate((k) => { const a = window.__splinterhall; a.settings.name = 'P' + k; a.settings.color = k * 2; }, k);
const st = (p) => p.evaluate(() => { const a = window.__splinterhall; const r = a.net.room; const m = a.match; return { menu: a.menus.cur && a.menus.cur.id, carrier: r && r.carrier, roster: r && r.roster.map((x) => x.name + (x.ready ? '+' : '') + (x.host ? '*' : '')).join(','), m: m && m.net ? { st: m.state, round: m.round, tick: m.tick, srv: Math.round(m.serverTick || 0), scores: m.scores.join('') } : null, rtt: r && r.rtt }; });
const show = async (label) => { for (let k = 0; k < N; k++) if (pages[k]) console.log(label, k, JSON.stringify(await st(pages[k]))); };
await pages[0].evaluate(() => window.__splinterhall.net.create());
await wait(1.5);
const code = await pages[0].evaluate(() => window.__splinterhall.net.room.code);
for (let k = 1; k < N; k++) await pages[k].evaluate((c) => window.__splinterhall.net.join(c), code);
await wait(3);
await show('lobby');
await pages[0].evaluate(() => { const a = window.__splinterhall; a.matchOpts.bots = 2; a.matchOpts.roundsToWin = 2; a.net.room.setInfo({ opts: a.matchOpts }); });
for (let k = 0; k < N; k++) await pages[k].evaluate(() => { const a = window.__splinterhall; a.net.room.setMe({ ready: true }); setTimeout(() => a.net.tryStart(), 50); });
// Wait (up to 12 s) for every page to be in the match; report how long the start took.
const tStart = Date.now();
for (let i = 0; i < 48; i++) {
  await wait(0.25);
  const ok = await Promise.all(pages.map((p) => p.evaluate(() => !!(window.__splinterhall.match && window.__splinterhall.match.net))));
  if (ok.every(Boolean)) break;
}
console.log('start took', ((Date.now() - tStart) / 1000).toFixed(2), 's');
await wait(2);
await show('match');
const g = 1;
const slot = await pages[g].evaluate(() => window.__splinterhall.match.localSlot);
const hx = () => pages[0].evaluate((s) => { const f = window.__splinterhall.match?.sim?.fighters[s]; return f && f.alive ? +f.pos().x.toFixed(2) : null; }, slot);
for (let i = 0; i < 40 && !(await pages[0].evaluate(() => window.__splinterhall.match?.sim?.phase === 'fight')); i++) await wait(0.25);
const x0 = await hx();
const dir = x0 > 20 ? 'ArrowLeft' : 'ArrowRight';
await pages[g].keyboard.down(dir); await wait(1.5); await pages[g].keyboard.up(dir);
console.log('guest', g, 'slot', slot, dir, 'host sees x', x0, '→', await hx());
// The guest's kick and haymaker (attack kind travels with the input) show up as those moves on the host.
await pages[0].evaluate((slot) => { const sim = window.__splinterhall.match.sim; window.__gs = []; const emit = sim.emit.bind(sim); sim.emit = (e) => { if (e.t === 'swing' && e.s === slot) window.__gs.push(e.k); return emit(e); }; }, slot);
await pages[g].keyboard.press('KeyC'); await wait(0.6); await pages[g].keyboard.press('KeyV'); await wait(0.8);
console.log('guest moves seen on host', JSON.stringify(await pages[0].evaluate(() => window.__gs)));
for (let i = 0; i < 60; i++) { await wait(2); if ((await st(pages[0])).menu === 'over') break; }
await show('over');
await pages[g].screenshot({ path: '/tmp/claude-0/-home-claude/2a99317c-0ce8-5f8d-965d-65dc7018fa18/scratchpad/guest-over.png' });
await pages[0].evaluate(() => window.__splinterhall.net.rematch());
await wait(4);
await show('rematch');
console.log('errors', errs.slice(0, 12));
for (const b of browsers) await b.close();
py.kill();
