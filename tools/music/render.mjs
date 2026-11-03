#!/usr/bin/env node
// Offline render of a scripted match per style, through headless Chrome (Playwright) and an
// OfflineAudioContext. Writes WAVs to a scratch dir, 128 kbps MP3 previews to dist/previews/, and a JSON log
// of bars and states for tools/music/analyse.py.
//
//   node tools/music/render.mjs [--styles viking,battle,power] [--seconds 150] [--out DIR] [--simple]
//                               [--preview-start 0 --preview-len 80] [--seed NAME]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const styles = (args.styles || 'viking,battle,power').split(',');
const seconds = +(args.seconds || 150);
const outDir = path.resolve(args.out || process.env.MUSIC_RENDER_DIR || '/tmp/splinterhall-music-renders');
const simple = !!args.simple;
const seeds = { viking: 'longship-7', battle: 'siege-3', power: 'dragon-12' };

/**
 * The scripted match (seconds): a round that climbs from Prowl to Crescendo, falls back while the fight
 * spreads out, climbs again, ends on a final kill; round end; a second short round that ends the match.
 */
export function matchScript(total = 150) {
  const s = [];
  const ev = (t, k, w) => s.push([t, 'event', k, w]);
  const ten = (t, alive, closePairs = 0, ragnarok = false) => s.push([t, 'tension', { alive, closePairs, ragnarok }]);
  s.push([0, 'start', 'match']);
  s.push([0.2, 'roundStart']);
  ten(0.3, 8, 0);
  // 0-12 s: prowl; first scuffles
  for (const t of [9, 10.5, 12]) ev(t, 'hit');
  // 14-30 s: the fight builds
  for (let t = 14; t < 30; t += 1.3) ev(t, t % 4 < 2 ? 'heavy' : 'hit');
  ev(18, 'pickup'); ev(21, 'blast'); ev(24, 'break', 6); ev(26, 'kill'); ten(26, 7, 2);
  // 30-48 s: big action to Crescendo
  ev(31, 'blast'); ev(32, 'kill'); ev(33, 'summon'); ev(34, 'break', 8);
  for (let t = 34; t < 48; t += 0.8) ev(t, t % 3 < 1 ? 'heavy' : 'hit');
  ev(38, 'blast'); ev(41, 'kill'); ev(44, 'blast'); ten(41, 5, 3);
  // 48-70 s: the fighters scatter: decay and fall
  ten(49, 5, 0);
  ev(58, 'hit'); ev(63, 'hit');
  // 70-92 s: climb again, three left then two, Ragnarok
  for (let t = 70; t < 92; t += 1.0) ev(t, t % 5 < 2 ? 'heavy' : 'hit');
  ev(73, 'kill'); ten(73, 4, 1); ev(76, 'blast'); ev(80, 'kill'); ten(80, 3, 1); ev(84, 'blast'); ev(86, 'kill'); ten(86, 2, 1, true);
  // 93 s: the final kill, 1.2 s of slow motion, round end
  s.push([93, 'finalKill']);
  s.push([95.2, 'roundEnd', true]);
  // 102 s: round 2, short and violent
  s.push([102, 'roundStart']); ten(102.1, 8, 0);
  for (let t = 108; t < 128; t += 0.9) ev(t, t % 4 < 2 ? 'heavy' : 'hit');
  ev(110, 'blast'); ev(112, 'kill'); ten(112, 4, 2); ev(115, 'summon'); ev(118, 'kill'); ten(118, 2, 1); ev(122, 'blast');
  s.push([128, 'finalKill']);
  s.push([130.5, 'matchEnd']);
  return s.filter((x) => x[0] < total);
}

/** A compressed match for the listening previews (about 80 s): Prowl, a climb through every rung to a
 * Crescendo, a short fall, a second climb, the final kill and the round-end cadence, then the match end. */
export function previewScript() {
  const s = [];
  const ev = (t, k, w) => s.push([t, 'event', k, w]);
  const ten = (t, alive, closePairs = 0, ragnarok = false) => s.push([t, 'tension', { alive, closePairs, ragnarok }]);
  s.push([0, 'start', 'match']);
  s.push([0.2, 'roundStart']);
  ten(0.3, 8, 0);
  for (const t of [6, 7.5, 9]) ev(t, 'hit');
  for (let t = 10; t < 24; t += 1.1) ev(t, t % 4 < 2 ? 'heavy' : 'hit');
  ev(13, 'blast'); ev(16, 'kill'); ten(16, 7, 2); ev(19, 'blast');
  ev(23, 'summon'); ev(24, 'kill'); ev(25, 'blast');
  for (let t = 25; t < 38; t += 0.8) ev(t, t % 3 < 1 ? 'heavy' : 'hit');
  ev(30, 'kill'); ten(30, 5, 3); ev(34, 'blast');
  ten(39, 5, 0);
  ev(46, 'hit');
  for (let t = 49; t < 62; t += 0.9) ev(t, t % 4 < 2 ? 'heavy' : 'hit');
  ev(50, 'kill'); ten(50, 3, 1); ev(53, 'blast'); ev(56, 'kill'); ten(56, 2, 1, true);
  s.push([62, 'finalKill']);
  s.push([64.2, 'roundEnd', true]);
  s.push([71.5, 'matchEnd']);
  return s;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'dist/previews'), { recursive: true });
  const port = 8100 + Math.floor(Math.random() * 800);
  const server = await serve(port);
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/music/render.html`);
  await page.waitForFunction(() => window.ready === true);
  const preview = !!args.preview;
  const spec = preview ? previewScript() : matchScript(seconds);
  const summary = {};
  for (const style of styles) {
    const seed = args.seed || seeds[style] || style;
    const t0 = Date.now();
    const solo = args.solo ? String(args.solo).split(',') : null;
    const res = await page.evaluate((o) => window.renderMusic(o), { seconds, seed, style, spec, simple, solo });
    const tag = `${preview ? 'preview-' : ''}${style}${simple ? '-simple' : ''}${solo ? '-solo-' + solo.join('+') : ''}`;
    const wavPath = path.join(outDir, `${preview ? '' : 'match-'}${tag}.wav`);
    fs.writeFileSync(wavPath, Buffer.from(res.wav, 'base64'));
    delete res.wav;
    res.spec = spec;
    fs.writeFileSync(path.join(outDir, `${preview ? '' : 'match-'}${tag}.json`), JSON.stringify(res, null, 1));
    console.log(`${tag}: "${res.name}" ${res.tune.bpm} bpm ${res.tune.meter} riff=${res.tune.riff.join(' | ')} ` +
      `rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s, clip samples ${res.clip}, peak voices ${res.peakVoices}, ` +
      `decoded ${res.decoded.toFixed(1)} s, warnings ${res.warnings.length}`);
    if (res.warnings.length) console.log('  ' + res.warnings.slice(0, 5).join('\n  '));
    // the preview MP3: the whole preview render, or a window of a match render (--preview-start/--preview-len)
    if (solo || (!preview && !args['preview-len'])) { summary[tag] = { wav: wavPath, name: res.name }; continue; }
    const mp3 = path.join(ROOT, 'dist/previews', `preview-${style}${simple ? '-simple' : ''}.mp3`);
    const ps = +(args['preview-start'] || 0), pl = +(args['preview-len'] || seconds);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(ps), '-t', String(pl), '-i', wavPath,
      '-af', `afade=t=out:st=${Math.max(0, pl - 1.5)}:d=1.5`, '-c:a', 'libmp3lame', '-b:a', '128k', mp3]);
    summary[tag] = { wav: wavPath, mp3, name: res.name };
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
