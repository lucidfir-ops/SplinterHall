// Screenshots of the Learn coach on a landscape phone (touch prompts) and a desktop (key prompts).
//   node tools/dev/tutshots.mjs <dir>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const S = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
for (const [name, opts, steps] of [['phone', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, [0, 5, 6]], ['desk', { viewport: { width: 1280, height: 720 } }, [4]]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite`);
  await page.waitForTimeout(5000);
  if (name === 'phone') await page.screenshot({ path: `${S}/tut-title-${name}.png` });
  await page.evaluate(() => window.__splinterhall.menus.focusables.find((q) => q.it.label === 'Learn').it.onOk());
  for (let i = 0; i < 60 && !(await page.evaluate(() => window.__splinterhall.match?.sim?.phase === 'fight')); i++) await page.waitForTimeout(250);
  for (const k of steps) {
    await page.evaluate((k) => window.__splinterhall.tutorial.begin(k), k);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${S}/tut-${name}-${k + 1}.png` });
  }
  await ctx.close();
}
console.log('errors', errs);
await browser.close(); server.close();
