// Capture the move showcase (?reel=1) frame by frame and make an MP4 (and contact sheets for checking poses).
//   node tools/dev/reel.mjs <outdir> [only=a,b] [fps=30] [size=1280x720] [quality=clean] [sheet=1]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const out = path.resolve(process.argv[2] || 'reel-out');
const arg = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
const fps = +(arg.fps || 30), [W, H] = (arg.size || '1280x720').split('x').map(Number);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'f'), { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const q = `reel=1&quality=${arg.quality || 'clean'}&test=1&mute=1` + (arg.only ? `&only=${arg.only}` : '');
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${q}`);
await page.waitForFunction(() => window.__reelReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const per = Math.round(60 / fps);
let n = 0, scene = null; const sheets = {};
for (;;) {
  const d0 = await page.evaluate(() => window.__reel.drawn());
  const r = await page.evaluate((per) => window.__reel.frame(per), per);
  if (!r) break;
  await page.waitForFunction((d) => window.__reel.drawn() > d, d0, { polling: 'raf', timeout: 120000 });
  const file = path.join(out, 'f', String(n).padStart(5, '0') + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  if (r.scene !== scene) { scene = r.scene; sheets[scene] = []; }
  sheets[scene].push(file);
  n++;
  if (n % 50 === 0) console.log('frame', n, scene);
}
console.log('frames', n, 'errors', errs.slice(0, 10));
await browser.close(); server.close();
execSync(`ffmpeg -y -loglevel error -framerate ${fps} -i "${out}/f/%05d.jpg" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart "${out}/reel.mp4"`);
if (arg.sheet) {
  // Contact sheets: 12 frames across each scene.
  for (const [id, files] of Object.entries(sheets)) {
    const pick = Array.from({ length: 12 }, (_, i) => files[Math.min(files.length - 1, Math.floor((i * files.length) / 12))]);
    const list = path.join(out, id + '.txt');
    fs.writeFileSync(list, pick.map((f) => `file '${f}'`).join('\n'));
    execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${list}" -vf "crop=iw*0.62:ih*0.8:iw*0.19:ih*0.12,scale=420:-1,tile=4x3" -frames:v 1 "${out}/sheet-${id}.jpg"`);
  }
}
console.log('wrote', out + '/reel.mp4');
