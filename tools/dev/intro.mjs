// Screenshots of the round-start marker: during the drop-in and just after the fight starts.
//   node tools/dev/intro.mjs <dir>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const S = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&dev=1&fighters=6&quality=clean&code=FT841KQH`);
for (let i = 0; i < 60; i++) { await page.waitForTimeout(100); if (await page.evaluate(() => window.__splinterhall?.match?.sim?.phase === 'dropin' && window.__splinterhall.match.sim.time > 0.8).catch(() => false)) break; }
await page.screenshot({ path: `${S}/intro-dropin.png` });
for (let i = 0; i < 80; i++) { await page.waitForTimeout(100); if (await page.evaluate(() => window.__splinterhall.match.sim.phase === 'fight')) break; }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${S}/intro-after.png` });
console.log('errors', errs);
await browser.close(); server.close();
