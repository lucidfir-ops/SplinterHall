// Browser check of the live music: unlock audio, menu tune, a match, intensity readings.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const root = path.resolve('dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|404/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test=1&quality=lite`);
await page.waitForTimeout(3000);
await page.keyboard.press('ArrowDown');
const t0 = Date.now();
const st = () => page.evaluate(() => { const a = window.__splinterhall; const s = a.audio.state(); return s && { lv: s.levelName, i: +(s.intensity || 0).toFixed(2), bpm: s.bpm, style: s.style, name: s.name, play: s.playing, v: s.voices, bar: s.bar, ready: a.audio.ready, warn: a.audio.music && a.audio.music.warnings().length, ctx: a.audio.ctx && a.audio.ctx.state }; });
for (let i = 0; i < 12; i++) { await page.waitForTimeout(1000); const s = await st(); console.log(((Date.now() - t0) / 1000).toFixed(0), 'menu', JSON.stringify(s)); if (s && s.play && s.bar > 1) break; }
await page.evaluate(() => { const a = window.__splinterhall; a.matchOpts.roundsToWin = 2; a.matchOpts.bots = 5; a.matchOpts.aiSkill = 2; a.startVersus(); });
for (let i = 0; i < 25; i++) { await page.waitForTimeout(2000); console.log('match', JSON.stringify(await st()), await page.evaluate(() => window.__splinterhall.match && window.__splinterhall.match.state)); }
console.log('errors', errs.slice(0, 12));
await browser.close(); server.close();
