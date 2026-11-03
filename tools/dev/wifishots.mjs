// Screenshots of the Wi-Fi pairing screens inside the game (host room + guest join).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errs = [];
for (const [w, h] of [[1280, 720], [844, 390]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite`);
  await page.waitForTimeout(4000);
  await page.evaluate(() => { const a = window.__splinterhall; a.net.screen(); a.net.wifiScreen(); a.net.create('wifi'); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/wifi-lobby-${w}.png` });
  await page.evaluate(() => { const a = window.__splinterhall; a.net.wifiPair('host', a.net.room); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/wifi-host-${w}.png` });
  await page.close();
  const g = await browser.newPage({ viewport: { width: w, height: h } });
  await g.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite`);
  await g.waitForTimeout(4000);
  await g.evaluate(() => { const a = window.__splinterhall; a.net.screen(); a.net.wifiScreen(); a.net.wifiPair('guest', null); });
  await g.waitForTimeout(2500);
  await g.screenshot({ path: `${out}/wifi-guest-${w}.png` });
  await g.close();
}
console.log('errors', errs);
await browser.close(); server.close();
