// Headless test for the sound effects: loads src/audio/sfx.js in Chrome, decodes
// every file in assets/audio/sfx/sfx.json, checks each one, then renders a busy
// sequence through an OfflineAudioContext and checks the mix.
//
//   node tools/sfx/test-sfx.mjs            (exit code 1 on any failure)
//
// Per file: decodes, mono, 0.02..2 s long, not silent (peak > -30 dBFS), not
// clipped (peak <= -0.5 dBFS), no leading silence (first sample above -40 dB re
// peak within 15 ms), ends quietly.
// Through the player (base gain applied): each effect renders on its own and its
// played peak sits in its class range (explosions loudest, UI quietest).
// Behaviour: 50 ms rate limit, break_* capped at 6 voices, 24-voice global cap,
// panning by x, distance attenuation, synth fallback for undecoded names, init
// resolves when files are missing.
// Mix: a 6-second brawl sequence of ~200 calls renders without clipping
// (peak < 0 dBFS before any limiter) and is not silent.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>sfx test</title><body></body>');
    return;
  }
  const p = path.join(root, url);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const logs = [];
// 404s are expected: the fallback check points the player at a folder with no files
page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) logs.push('console: ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/__test.html`);

const result = await page.evaluate(async () => {
  const { createSfx } = await import('/src/audio/sfx.js');
  const base = '/assets/audio/sfx/';
  const doc = await (await fetch(base + 'sfx.json')).json();
  const E = doc.effects;
  const names = Object.keys(E);
  const fails = [];
  const rows = [];
  const SR = 44100;
  const dB = (v) => 20 * Math.log10(Math.max(v, 1e-9));
  const stats = (ch) => {
    let pk = 0, first = -1, sum = 0;
    for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > pk) pk = a; sum += ch[i] * ch[i]; }
    const thr = pk * 0.01; // -40 dB re peak: the first audible sample
    for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > thr) { first = i; break; }
    // last 10 ms level relative to peak
    let tail = 0; const n = Math.min(ch.length, Math.floor(0.01 * SR));
    for (let i = ch.length - n; i < ch.length; i++) tail = Math.max(tail, Math.abs(ch[i]));
    return { peak: pk, rms: Math.sqrt(sum / ch.length), first, tail };
  };
  const peakOf = (buf) => { let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); } return pk; };

  // 1. decode every file directly and check it
  const decodeCtx = new OfflineAudioContext(1, SR, SR);
  let totalBytes = 0;
  for (const name of names) {
    for (const f of E[name].files) {
      try {
        const ab = await (await fetch(base + f)).arrayBuffer();
        const bytes = ab.byteLength;   // read before decodeAudioData detaches the buffer
        totalBytes += bytes;
        const buf = await decodeCtx.decodeAudioData(ab);
        const s = stats(buf.getChannelData(0));
        const row = { file: f, dur: +buf.duration.toFixed(3), ch: buf.numberOfChannels, sr: buf.sampleRate, peakDb: +dB(s.peak).toFixed(1), lead: +(s.first / buf.sampleRate * 1000).toFixed(1), tailDb: +dB(s.tail / s.peak).toFixed(1), kb: +(bytes / 1024).toFixed(1) };
        rows.push(row);
        if (buf.numberOfChannels !== 1) fails.push(f + ': not mono');
        if (buf.duration < 0.02 || buf.duration > 2.0) fails.push(f + ': duration ' + buf.duration);
        if (s.peak < 0.0316) fails.push(f + ': silent (peak ' + row.peakDb + ' dB)');
        if (s.peak > 0.9441) fails.push(f + ': clipping risk (peak ' + row.peakDb + ' dB)');
        if (row.lead > 15) fails.push(f + ': ' + row.lead + ' ms leading silence');
        if (row.tailDb > -12) fails.push(f + ': ends abruptly (last 10 ms at ' + row.tailDb + ' dB re peak)');
      } catch (e) { fails.push(f + ': decode failed ' + e); }
    }
  }

  // 2. each effect alone through the player (OfflineAudioContext), stereo
  const CLASS = (n) => /^explosion|^serpent_rise|^collapse|^hammer|^blunderbuss|^round_/.test(n) ? [-8, -1.5]
    : /^ui_/.test(n) ? [-24, -10] : /^step|^debris/.test(n) ? [-24, -12] : [-18, -3.5];
  const played = {};
  for (const name of names) {
    const ctx = new OfflineAudioContext(2, Math.floor(SR * 2.2), SR);
    const sfx = createSfx();
    await sfx.init(ctx, { base, manifest: doc });
    if (!sfx.ready(name)) fails.push(name + ': not ready after init');
    // pitch 1, vol 1, centre, no random variation
    sfx.play(name, { when: 0.0, vary: false });
    const buf = await ctx.startRendering();
    const pk = dB(peakOf(buf));
    played[name] = +pk.toFixed(1);
    const [lo, hi] = CLASS(name);
    if (pk < lo - 1 || pk > hi + 1) fails.push(`${name}: played peak ${pk.toFixed(1)} dB outside ${lo}..${hi}`);
  }

  // 3. behaviour
  const beh = {};
  {
    // rate limit: 10 plays 10 ms apart -> 2 voices (t=0 and t=0.05..0.06)
    const ctx = new OfflineAudioContext(2, SR, SR);
    const sfx = createSfx(); await sfx.init(ctx, { base, manifest: doc });
    for (let i = 0; i < 10; i++) sfx.play('punch_light', { when: i * 0.01 });
    beh.rateLimited = sfx.active();
    if (beh.rateLimited !== 2) fails.push('rate limit: expected 2 voices, got ' + beh.rateLimited);
    // break cap: 12 different break_* names at once (a test manifest adds names
    // that reuse the stone files, so the 50 ms per-name limit doesn't interfere)
    // -> exactly 6 voices, and a non-break effect still plays alongside them
    const doc2 = JSON.parse(JSON.stringify(doc));
    for (let i = 0; i < 12; i++) doc2.effects['break_test_' + i] = { ...doc.effects.break_stone };
    const ctx2 = new OfflineAudioContext(2, SR, SR);
    const s2 = createSfx(); await s2.init(ctx2, { base, manifest: doc2 });
    for (let i = 0; i < 12; i++) s2.play('break_test_' + i, { when: 0.002 * i });
    beh.breakVoices = s2.active();
    s2.play('punch_heavy', { when: 0.03 });
    beh.breakPlusPunch = s2.active();
    if (beh.breakVoices !== 6) fails.push('break cap: expected 6 voices, got ' + beh.breakVoices);
    if (beh.breakPlusPunch !== 7) fails.push('break cap blocked a non-break effect');
    // global cap: 40 different-name long plays -> <= 24
    const ctx3 = new OfflineAudioContext(2, SR * 3, SR);
    const s3 = createSfx(); await s3.init(ctx3, { base, manifest: doc });
    for (const n of names) s3.play(n, { when: 0 });
    beh.globalVoices = s3.active();
    if (beh.globalVoices > 24) fails.push('global cap: ' + beh.globalVoices + ' > 24');
    // panning: x = -1 -> left louder than right by > 10 dB
    const ctx4 = new OfflineAudioContext(2, SR, SR);
    const s4 = createSfx(); await s4.init(ctx4, { base, manifest: doc });
    s4.play('punch_heavy', { x: -1, when: 0 });
    const b4 = await ctx4.startRendering();
    let l = 0, r = 0; const L = b4.getChannelData(0), R = b4.getChannelData(1);
    for (let i = 0; i < L.length; i++) { l += L[i] * L[i]; r += R[i] * R[i]; }
    beh.panLeftMinusRightDb = +(10 * Math.log10(l / Math.max(r, 1e-12))).toFixed(1);
    if (beh.panLeftMinusRightDb < 10) fails.push('pan: left only ' + beh.panLeftMinusRightDb + ' dB louder');
    // distance: dist = 1 is 12 dB quieter than dist = 0 (gain 0.25), plus a little top-end cut
    const lvl = async (dist) => {
      const c = new OfflineAudioContext(2, SR, SR); const s = createSfx(); await s.init(c, { base, manifest: doc });
      s.play('explosion_small', { dist, when: 0, vary: false }); return dB(peakOf(await c.startRendering()));
    };
    const near = await lvl(0), far = await lvl(1);
    beh.distanceDropDb = +(near - far).toFixed(1);
    if (beh.distanceDropDb < 11) fails.push('distance: only ' + beh.distanceDropDb + ' dB quieter at dist 1');
    // fallback: an init with no reachable files still resolves and still makes sound
    const ctx5 = new OfflineAudioContext(2, SR, SR);
    const s5 = createSfx();
    const r5 = await s5.init(ctx5, { base: '/nowhere/', manifest: doc });
    beh.missingFilesFailed = r5.failed.length;
    s5.play('explosion_big', { when: 0 }); s5.play('ui_focus', { when: 0.2 }); s5.play('break_glass', { when: 0.4 });
    const b5 = await ctx5.startRendering();
    beh.fallbackPeakDb = +dB(peakOf(b5)).toFixed(1);
    if (r5.failed.length !== Object.values(E).reduce((a, e) => a + e.files.length, 0)) fails.push('fallback init: expected every file to fail');
    if (beh.fallbackPeakDb < -40) fails.push('fallback: silent');
    if (beh.fallbackPeakDb > -1) fails.push('fallback: too loud ' + beh.fallbackPeakDb);
    // setVolume(0) -> silence
    const ctx6 = new OfflineAudioContext(2, SR, SR);
    const s6 = createSfx(); await s6.init(ctx6, { base, manifest: doc });
    s6.setVolume(0); s6.play('explosion_big', { when: 0.1 });
    beh.mutedPeakDb = +dB(peakOf(await ctx6.startRendering())).toFixed(1);
    if (beh.mutedPeakDb > -60) fails.push('setVolume(0) not silent: ' + beh.mutedPeakDb);
    // names()
    if (s6.names().length !== names.length) fails.push('names() length mismatch');
  }

  // 3b. a real (realtime) AudioContext: init, decode and play without errors
  {
    const rt = new AudioContext();
    const s = createSfx();
    const r = await s.init(rt, { base, manifest: doc });
    s.play('ui_confirm'); s.play('explosion_small', { x: 0.5, dist: 0.3 }); s.setVolume(0.5);
    beh.realtimeLoaded = r.loaded;
    if (r.failed.length) fails.push('AudioContext: ' + r.failed.length + ' files failed to decode');
    if (s.active() < 2) fails.push('AudioContext: plays did not start');
    await rt.close();
  }

  // 4. a 6 s brawl sequence through the player
  const DUR = 6;
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const sfx = createSfx();
  const info = await sfx.init(ctx, { base, manifest: doc });
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const busy = ['punch_light', 'punch_mid', 'punch_heavy', 'step', 'step', 'land', 'thud', 'jump', 'sword_swing', 'sword_slash', 'axe_chop', 'break_stone', 'break_wood', 'break_glass', 'break_ice', 'break_iron', 'debris', 'debris', 'blade_stick', 'throw', 'bomb_bounce'];
  let calls = 0;
  sfx.play('round_start', { when: 0.05 }); calls++;
  for (let t = 0.3; t < DUR - 1; t += 0.03) {
    sfx.play(busy[Math.floor(rnd() * busy.length)], { when: t, x: rnd() * 2 - 1, dist: rnd() * 0.6 }); calls++;
  }
  for (const [t, n] of [[1.0, 'explosion_small'], [1.6, 'blunderbuss'], [2.2, 'rocket_launch'], [2.5, 'explosion_mid'], [3.1, 'collapse'], [3.3, 'explosion_big'], [3.35, 'break_stone'], [3.4, 'break_wood'], [3.5, 'serpent_rise'], [4.2, 'hammer_smash'], [4.6, 'death'], [4.9, 'round_win']]) {
    sfx.play(n, { when: t, x: 0, dist: 0 }); calls++;
  }
  const mixBuf = await ctx.startRendering();
  const mixPk = dB(peakOf(mixBuf));
  let ss = 0, n = 0; for (let c = 0; c < 2; c++) { const d = mixBuf.getChannelData(c); for (let i = 0; i < d.length; i++) { ss += d[i] * d[i]; n++; } }
  const mixRms = dB(Math.sqrt(ss / n));
  if (mixPk > 0) fails.push('mix clips: peak ' + mixPk.toFixed(2) + ' dBFS');
  if (mixRms < -40) fails.push('mix too quiet: rms ' + mixRms.toFixed(1));

  return { fails, rows, played, beh, mix: { calls, peakDb: +mixPk.toFixed(2), rmsDb: +mixRms.toFixed(1), loaded: info.loaded, failed: info.failed.length }, totalKB: +(totalBytes / 1024).toFixed(1), effects: names.length };
});

console.log('effects', result.effects, 'files', result.rows.length, 'total', result.totalKB, 'KB');
for (const r of result.rows) console.log(`  ${r.file.padEnd(24)} ${String(r.dur).padStart(6)}s ${r.sr}Hz ch${r.ch} peak ${String(r.peakDb).padStart(5)} lead ${String(r.lead).padStart(4)}ms tail ${String(r.tailDb).padStart(6)} ${r.kb}KB`);
console.log('played peaks (dBFS, base gain applied, centre, dist 0):');
console.log('  ' + Object.entries(result.played).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('behaviour', JSON.stringify(result.beh));
console.log('mix', JSON.stringify(result.mix));
const all = [...result.fails, ...logs];
if (all.length) { console.log('FAIL\n  ' + all.join('\n  ')); }
else console.log('PASS');
await browser.close();
server.close();
process.exit(all.length ? 1 : 0);
