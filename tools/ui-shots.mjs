// Screenshots of menus, a match with HUD, and the editor at several screen sizes.
//   node tools/ui-shots.mjs <outdir> [sizes...]   sizes like 1280x720 844x390 390x844 1280x800
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'web');
const outDir = process.argv[2] || 'shots';
const sizes = process.argv.slice(3).length ? process.argv.slice(3) : ['1280x720'];
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const sz of sizes) {
  const [w, h] = sz.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < h || h < 500, isMobile: w < h || h < 500 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?test=1`);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${outDir}/${sz}-title.png` });
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
  await key('Enter'); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/${sz}-fight.png` });
  await key('Enter'); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/${sz}-versus.png` });
  await page.evaluate(() => window.__splinterhall && window.__splinterhall.startVersus());
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${outDir}/${sz}-match.png` });
  await key('Escape'); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/${sz}-pause.png` });
  await page.evaluate(() => window.__splinterhall && window.__splinterhall.openEditor());
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/${sz}-editor.png` });
  console.log(sz, errs.length ? 'ERRORS: ' + errs.slice(0, 5).join(' || ') : 'no errors');
  await page.close();
}
await browser.close();
server.close();
