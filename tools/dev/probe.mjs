import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const q = process.argv[2] || 'bot=1';
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('console', (m) => { if (!/deprecated|PCFSoft|404/.test(m.text())) console.log('console', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${q}`);
for (let i = 0; i < 6; i++) { await page.waitForTimeout(4000); console.log('t', (i + 1) * 4, await page.evaluate(() => [window.__drawCalls, window.__tris]).catch((e) => 'eval fail ' + e.message)); }
await browser.close(); server.close();
