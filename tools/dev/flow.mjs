import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const out = process.argv[2] || '/tmp/flow';
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite&render=0`);
await page.waitForTimeout(6000);
await page.evaluate(() => { const a = window.__splinterhall; a.matchOpts.roundsToWin = 1; a.matchOpts.bots = 1; a.matchOpts.aiSkill = 2; a.startVersus(); });
const state = () => page.evaluate(() => { const a = window.__splinterhall; const m = a.match; return { menu: a.menus.cur && a.menus.cur.id, state: m && m.state, round: m && m.round, scores: m && m.scores.slice(0, 8).join('') }; });
let last = '';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const s = await state();
  const k = JSON.stringify(s);
  if (k !== last) { console.log(i * 2, 's', k); last = k; }
  if (s.menu === 'over') break;
}
await page.screenshot({ path: out + '/over.png' });
await page.evaluate(() => { const a = window.__splinterhall; const f = a.menus.focusables.find(f => f.it.label === 'Rematch'); if (f) f.it.onOk(); });
await page.waitForTimeout(5000);
console.log('after rematch', JSON.stringify(await state()));
await page.evaluate(() => window.__splinterhall.leaveMatch());
await page.waitForTimeout(3000);
console.log('after leave', JSON.stringify(await state()));
console.log('errors', errs.slice(0, 8));
await browser.close(); server.close();
