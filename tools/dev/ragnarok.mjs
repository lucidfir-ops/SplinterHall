// Screenshots of the rising kill line (Ragnarök) in each setting: node tools/dev/ragnarok.mjs <dir> [killY]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [S = '.', ky = '9'] = process.argv.slice(2);
for (const setting of ['bunker', 'hall']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&bot=1&quality=clean&setting=${setting}`);
  await page.waitForTimeout(7000);
  await page.evaluate((ky) => { window.__splinterhall.match.sim.killY = ky; }, +ky);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${S}/rag-${setting}.png` });
  await page.close();
}
await browser.close(); server.close();
