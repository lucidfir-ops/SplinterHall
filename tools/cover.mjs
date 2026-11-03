// Render the itch.io cover (630x500) from ?cover mode at 2x, then downscale.
//   node tools/cover.mjs <out.png> [query]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'web');
const out = process.argv[2] || 'dist/splinterhall-cover.png';
const query = process.argv[3] || 'cover=1&code=JXAH67KH&quality=clean';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 630, height: 500 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${query}`);
await page.waitForFunction(() => window.__coverReady === true, null, { timeout: 240000 });
await page.waitForTimeout(2500);
const tmp = out.replace(/\.png$/, '@2x.png');
await page.screenshot({ path: tmp });
execSync(`ffmpeg -y -loglevel error -i "${tmp}" -vf scale=630:500:flags=lanczos "${out}"`);
console.log('cover written', out);
await browser.close(); server.close();
