#!/usr/bin/env node
// Browser check of the track player (run after a build): a key press starts the tracks, the title widget shows the
// song, Next moves on, sound reaches the music bus, a missing file is skipped, Options → Music → Source switches to
// the live generator and back, a match starts and ends, nothing errors, and no live-generator sample is fetched
// while Source is Tracks.
//   node tools/music/trackflow.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(ROOT, 'dist/web');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.png': 'image/png', '.hdr': 'application/octet-stream' };
// a static server with byte ranges, as a real host has (media elements stream with Range requests)
const server = http.createServer((req, res) => {
  const p = path.join(web, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(p).size, type = types[path.extname(p)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
    fs.createReadStream(p, { start: a, end: b }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [], requests = [];
let expect404 = false;
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  if (/GPU stall/.test(t)) return;
  if (/status of 404/.test(t)) return;   // 404s are checked by URL below
  if (expect404 && /music track failed to load/.test(t)) return;
  errors.push(m.type() + ' ' + t.slice(0, 200));
});
page.on('request', (r) => requests.push({ url: r.url().replace(base, ''), t: Date.now() }));
const missing = [];
page.on('response', (r) => { if (r.status() === 404) missing.push(r.url().replace(base, '')); });

let fails = 0;
const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fails++; };
const wait = (ms) => page.waitForTimeout(ms);
const st = () => page.evaluate(() => window.__splinterhall.audio.state());
const widget = () => page.evaluate(() => { const e = document.querySelector('.sh-player .now'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; });
const liveFetches = () => requests.filter((r) => r.url.startsWith('/assets/audio/music/'));
/** RMS of the music bus over 300 ms (an analyser tapped onto it). */
const busLevel = () => page.evaluate(async () => {
  const a = window.__splinterhall.audio;
  const an = a.ctx.createAnalyser(); an.fftSize = 2048; a.musicBus.connect(an);
  const buf = new Float32Array(2048);
  let s = 0, n = 0;
  for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) { s += v * v; n++; } }
  a.musicBus.disconnect(an);
  return Math.sqrt(s / n);
});
const until = async (fn, ms = 8000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };

try {
  await page.goto(`${base}/index.html?test=1&quality=lite`);
  await page.waitForFunction(() => window.__splinterhall && window.__splinterhall.menus.cur && window.__splinterhall.menus.cur.id === 'title', null, { timeout: 30000 });
  await page.evaluate(() => { const a = window.__splinterhall; a.settings.musicSource = 'tracks'; a.audio.source = 'tracks'; });
  await wait(1500);
  ok((await st()) === null, 'no music before the first key (state null)');
  ok(liveFetches().length === 0, 'no live-generator files fetched on load');

  // 1. a key starts the tracks
  await page.keyboard.press('ArrowDown');
  const s1 = await until(async () => { const s = await st(); return s && s.playing && s.title ? s : null; });
  ok(!!s1, `a key press starts the track player: ${s1 && `"${s1.title}" by ${s1.artist} (${s1.style})`}`);
  const w1 = await until(async () => { const w = await widget(); return w && s1 && w.includes(s1.title.toUpperCase()) || (w && s1 && w.toUpperCase().includes(s1.title.toUpperCase())) ? w : null; }, 3000);
  ok(!!w1, `the title widget shows it: ${await widget()}`);
  await until(async () => { const s = await st(); return s && s.time > 3; }, 15000);   // past the song's fade-in
  const lvl = await busLevel();
  ok(lvl > 0.003, `sound reaches the music bus (RMS ${lvl.toFixed(4)} at ${(await st()).time.toFixed(1)} s into the song)`);
  const fader = await page.evaluate(() => window.__splinterhall.audio.tracks.out.gain.value);
  ok(Math.abs(fader - 0.5) < 0.05, `menus play at the menu level (fader ${fader.toFixed(2)})`);

  // 2. Next (the title screen's button)
  const before = (await st()).file;
  await page.click('.sh-btn:has-text("Next")');
  const s2 = await until(async () => { const s = await st(); return s && s.file !== before && s.playing ? s : null; });
  ok(!!s2, `Next changes the track: ${before} -> ${s2 && s2.file}`);
  const w2 = await until(async () => { const w = await widget(); return w && s2 && w.toUpperCase().includes(s2.title.toUpperCase()) ? w : null; }, 3000);
  ok(!!w2, `the widget follows: ${await widget()}`);
  await wait(1600);
  const decks = await page.evaluate(() => window.__splinterhall.audio.tracks.decks.map((d) => ({ paused: d.el.paused, src: (d.el.getAttribute('src') || '').slice(-40), active: d === window.__splinterhall.audio.tracks.active })));
  ok(decks.filter((d) => !d.paused).length === 1, `after the crossfade one deck plays: ${JSON.stringify(decks)}`);

  // 2b. the end of a song hands over to the next with no gap (seek to 3 s before the end)
  const ho = await page.evaluate(async () => {
    const p = window.__splinterhall.audio.tracks;
    const first = p.current.file, el = p.active.el;
    el.currentTime = el.duration - 3;
    let overlap = false, gap = false, t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 100));
      const playing = p.decks.filter((d) => !d.el.paused && d.el.currentTime > 0.05).length;
      if (playing === 2) overlap = true;
      if (playing === 0 && p.current && p.current.file !== first) gap = true;
      if (p.current.file !== first && !p.decks.some((d) => d !== p.active && !d.el.paused)) break;
    }
    return { first, next: p.current.file, overlap, gap, playing: !p.active.el.paused };
  });
  ok(ho.next !== ho.first && ho.playing && ho.overlap, `a song's end hands over gap-free: ${JSON.stringify(ho)}`);

  // 3. style buttons: Power plays power songs
  await page.click('.sh-btn:has-text("power")');
  const s3 = await until(async () => { const s = await st(); return s && s.style === 'power' && s.playing ? s : null; });
  ok(!!s3, `the Power button moves to a power song: ${s3 && s3.title}`);
  await page.click('.sh-btn:has-text("power")');   // back to Any

  // 4. a missing file is skipped
  expect404 = true;
  const s4 = await page.evaluate(async () => {
    const p = window.__splinterhall.audio.tracks;
    const ghost = { file: 'no-such-song.mp3', title: 'Ghost', artist: '', style: 'battle' };
    p.tracks.push(ghost); p.queue = [ghost];
    p.next();
    await new Promise((r) => setTimeout(r, 2500));
    return { bad: [...p.bad], cur: p.current && p.current.file, playing: !!(p.active && !p.active.el.paused) };
  });
  ok(s4.bad.includes('no-such-song.mp3') && s4.cur && s4.cur !== 'no-such-song.mp3' && s4.playing, `a missing file is skipped: ${JSON.stringify(s4)}`);
  expect404 = false;
  ok(liveFetches().length === 0, `still no live-generator files fetched (${requests.filter((r) => r.url.startsWith('/assets/audio/tracks/')).length} track requests so far)`);

  // 5. Options → Music → Source: Live generator
  await page.evaluate(() => { const a = window.__splinterhall; a.optionsScreen(); a.optMusic(); });
  await wait(300);
  const srcItem = page.locator('.sh-set', { hasText: 'Source' });
  await srcItem.click();
  const live = await until(async () => { const s = await st(); return s && s.source === 'live' && s.playing && s.bar > 0 ? s : null; }, 30000, 500);
  ok(!!live, `Source → Live generator starts the band: ${live && `"${live.title}" ${live.style} ${live.bpm} bpm, ${live.levelName}`}`);
  ok(liveFetches().length > 20, `the live samples load only now (${liveFetches().length} requests)`);
  const tracksPaused = await until(() => page.evaluate(() => window.__splinterhall.audio.tracks.decks.every((d) => d.el.paused)), 3000);
  const deckInfo = () => page.evaluate(() => { const p = window.__splinterhall.audio.tracks; return { wanted: p.wanted, decks: p.decks.map((d) => ({ paused: d.el.paused, ended: d.el.ended, track: d.track && d.track.file, src: (d.el.getAttribute('src') || '').slice(0, 40), t: +d.el.currentTime.toFixed(2), serial: d.serial, active: d === p.active, gain: d.gain && +d.gain.gain.value.toFixed(3) })) }; });
  ok(!!tracksPaused, 'the tracks stop' + (tracksPaused ? '' : ': ' + JSON.stringify(await deckInfo())));
  ok(await page.evaluate(() => !!document.querySelector('.sh-set') && [...document.querySelectorAll('.sh-set .k')].some((e) => /Simple/.test(e.textContent))), 'the Simple toggle shows for the live generator');
  ok(/BPM/.test(await widget() || ''), `the widget shows the live tune: ${await widget()}`);
  const liveApi = await page.evaluate(() => window.__splinterhall.music === window.__splinterhall.audio.music && !!window.__splinterhall.audio.music);
  ok(liveApi, 'app.music is the live generator');

  // 6. and back to Tracks
  await page.evaluate(() => { window.__oldLive = window.__splinterhall.audio.music; });
  await page.locator('.sh-set', { hasText: 'Source' }).click();
  const back = await until(async () => { const s = await st(); return s && s.source === 'tracks' && s.playing ? s : null; });
  ok(!!back, `Source → Tracks plays the tracks again: ${back && back.title}`);
  const stopped = await page.evaluate(() => { const m = window.__oldLive; const b = m._internals().band; return { playing: b.playing, timer: !!b.timer, music: window.__splinterhall.audio.music }; });
  ok(!stopped.playing && !stopped.timer && stopped.music === null, `the live generator is stopped and dropped: ${JSON.stringify(stopped)}`);
  const noop = await page.evaluate(() => { const m = window.__splinterhall.music; m.event('hit'); m.tension({ alive: 2 }); m.roundStart(); m.finalKill(); m.roundEnd(true); m.matchEnd(); return Object.isFrozen(m); });
  ok(noop, 'with Tracks, app.music is a frozen no-op');
  const n0 = liveFetches().length;

  // 7. a match starts and ends
  await page.evaluate(() => { const a = window.__splinterhall; a.menus.close(); a.matchOpts.roundsToWin = 1; a.matchOpts.bots = 3; a.matchOpts.aiSkill = 2; a.startVersus(); });
  const inMatch = await until(() => page.evaluate(() => { const m = window.__splinterhall.match; return m && m.state === 'round'; }), 30000, 500);
  ok(!!inMatch, 'a match starts');
  await wait(1500);
  const fm = await page.evaluate(() => window.__splinterhall.audio.tracks.out.gain.value);
  ok(fm > 0.9, `matches play at full level (fader ${fm.toFixed(2)})`);
  const sm = await st();
  ok(sm && sm.playing, `the track keeps playing into the match: ${sm && sm.title}`);
  const lm = await busLevel();
  ok(lm > 0.003, `sound on the music bus in the match (RMS ${lm.toFixed(4)})`);
  await wait(10000);
  let state = await page.evaluate(() => window.__splinterhall.match && window.__splinterhall.match.state);
  if (state === 'round') await page.evaluate(() => { const m = window.__splinterhall.match; m.endRound(m.roster[0].slot); });
  const over = await until(() => page.evaluate(() => { const a = window.__splinterhall; return a.match && a.match.state === 'over' && a.menus.cur && a.menus.cur.id === 'over'; }), 15000, 500);
  ok(!!over, 'the match ends on the champion screen');
  await page.evaluate(() => window.__splinterhall.leaveMatch());
  const fb = await until(() => page.evaluate(() => { const v = window.__splinterhall.audio.tracks.out.gain.value; return v < 0.6 ? v : null; }), 4000);
  ok(fb != null, `back in the menus at the menu level (fader ${fb != null ? fb.toFixed(2) : '?'})`);
  const se = await st();
  ok(se && se.playing, `music still playing after the match: ${se && se.title}`);
  ok(liveFetches().length === n0, 'no live-generator files fetched while Tracks played the match');

  // 8. the credits page carries the CC BY lines
  await page.evaluate(() => window.__splinterhall.creditsScreen());
  await wait(300);
  const cred = await page.evaluate(() => document.querySelector('.sh-screen').innerText);
  ok(/Raid_FolkMetal/.test(cred) && /CC BY 4\.0/.test(cred) && /PeriTune/.test(cred), 'the Credits page credits the CC BY tracks');

  // 9. a saved Source of Live generator: after a reload the band starts, and no track file is fetched
  await page.evaluate(() => { const a = window.__splinterhall; a.settings.musicSource = 'live'; a.saveSettings(); });
  requests.length = 0;
  await page.reload();
  await page.waitForFunction(() => window.__splinterhall && window.__splinterhall.menus.cur && window.__splinterhall.menus.cur.id === 'title', null, { timeout: 30000 });
  await wait(1000);
  await page.keyboard.press('ArrowDown');
  const l2 = await until(async () => { const s = await st(); return s && s.source === 'live' && s.playing && s.bar > 0 ? s : null; }, 30000, 500);
  ok(!!l2, `with Source saved as Live, the first key starts the band: ${l2 && l2.title}`);
  const trackFiles = requests.filter((r) => /^\/assets\/audio\/tracks\/.+\.mp3/.test(r.url));
  ok(trackFiles.length === 0, `and no track files are fetched (${trackFiles.length})`);
  await page.evaluate(() => { const a = window.__splinterhall; a.settings.musicSource = 'tracks'; a.saveSettings(); });
} catch (e) {
  console.log('FAIL exception', e.message);
  fails++;
}
const bad404 = missing.filter((u) => !/favicon|no-such-song/.test(u));
ok(bad404.length === 0, `no missing files${missing.length ? ' (404s: ' + missing.join(', ') + ')' : ''}`);
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 8).join(' | ') : ''}`);
await browser.close();

// 10. Chrome's real autoplay policy (no override), a phone page and one tap: the music must start on that tap.
// pointerdown, where the app unlocks, isn't a user activation for touch; the player retries on touchend.
{
  const b2 = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const ctx2 = await b2.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  try {
    await p2.goto(`${base}/index.html?test=1&quality=lite`);
    await p2.waitForFunction(() => window.__splinterhall && window.__splinterhall.menus.cur && window.__splinterhall.menus.cur.id === 'title', null, { timeout: 30000 });
    await p2.waitForTimeout(1500);
    await p2.touchscreen.tap(30, 370);
    let s = null;
    for (let i = 0; i < 24 && !(s && s.playing && s.time > 0.2); i++) { await p2.waitForTimeout(250); s = await p2.evaluate(() => window.__splinterhall.audio.state()); }
    const ctxState = await p2.evaluate(() => window.__splinterhall.audio.ctx && window.__splinterhall.audio.ctx.state);
    ok(s && s.playing && s.time > 0.2 && ctxState === 'running', `real autoplay policy: one tap starts the tracks (${s && s.title}, ${s && s.time.toFixed(1)} s in, context ${ctxState})`);
    ok(errs2.length === 0, `no page errors on the phone page${errs2.length ? ': ' + errs2.join(' | ') : ''}`);
  } catch (e) { console.log('FAIL exception', e.message); fails++; }
  await b2.close();
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
server.close();
process.exit(fails ? 1 : 0);
