// Screenshots in headless Chrome (SwiftShader WebGL).
//   node tools/shot.mjs "<query>" <out.png> [width height waitSeconds]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'web');
const [query = 'bot=1', out = 'shot.png', w = '1280', h = '720', wait = '6'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json', '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?${query}`);
await page.waitForTimeout(+wait * 1000);
await page.screenshot({ path: out });
const fps = await page.evaluate(() => [window.__fps, window.__drawCalls, window.__tris]).catch(() => null);
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
if (fps) console.log('fps', fps);
await browser.close();
server.close();
