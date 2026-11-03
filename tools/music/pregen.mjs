#!/usr/bin/env node
// Pre-rendered tracks for the track player (assets/audio/tracks/). Renders songs from the live generator through
// headless Chrome and an OfflineAudioContext (one at a time), masters them (fade in and out, about -14 LUFS
// integrated, true peak under -1 dBTP), encodes 96 kbps stereo MP3 (plays everywhere, Safari and iOS included)
// and updates tracks.json. Also loudness-matches downloaded tracks so they sit level with the rest.
//
//   node tools/music/pregen.mjs                       render, master and encode every song in SONGS
//   node tools/music/pregen.mjs --only viking-a,power-b   just those
//   node tools/music/pregen.mjs --list                print the songs' tunes (no rendering)
//   node tools/music/pregen.mjs --master-only         re-master from the WAVs of an earlier render
//   node tools/music/pregen.mjs --import IN --out NAME.mp3 [--fade-in 0.05] [--fade-out 1.5]
//                                                     trim silence, fade, loudness-match and encode a download
//   node tools/music/pregen.mjs --check               measure every track in the manifest and the folder size
//
// WAVs and render logs go to MUSIC_RENDER_DIR (default /tmp/splinterhall-music-renders).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { generateTune } from '../../src/audio/music/tune.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TRACKS = path.join(ROOT, 'assets/audio/tracks');
const MANIFEST = path.join(TRACKS, 'tracks.json');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const renderDir = path.resolve(process.env.MUSIC_RENDER_DIR || '/tmp/splinterhall-music-renders');

export const TARGET_LUFS = -14;
export const MAX_TP = -1.2;      // what the master aims under (the encoded MP3 must stay under -1 dBTP)
export const BITRATE = '96k';

// Song arcs, in seconds from the first bar; each target moves onto the nearest 4-bar phrase line.
// Intensity: Prowl < 0.15 < Riff < 0.4 < Charge < 0.65 < Battle < 0.85 < Crescendo.
export const ARCS = {
  // quiet start, a steady climb to a long peak, a fall back to the riff, a second climb, the end
  A: { points: [[0, 0.05], [12, 0.27], [24, 0.5], [36, 0.74], [48, 0.95], [66, 0.3], [82, 0.52], [92, 0.76], [102, 0.95]], end: 118 },
  // riff early, a build straight to Battle, a breakdown right back to Prowl, a longer last climb
  B: { points: [[0, 0.05], [10, 0.27], [22, 0.74], [34, 0.95], [50, 0.05], [72, 0.27], [80, 0.52], [90, 0.76], [100, 0.95]], end: 118 },
};

export const SONGS = [
  { id: 'viking-a', style: 'viking', seed: 'pregen-viking-5', arc: 'A' },
  { id: 'viking-b', style: 'viking', seed: 'pregen-viking-12', arc: 'B' },
  { id: 'battle-a', style: 'battle', seed: 'pregen-battle-5', arc: 'A' },
  { id: 'battle-b', style: 'battle', seed: 'pregen-battle-2', arc: 'B' },
  { id: 'power-a', style: 'power', seed: 'pregen-power-2', arc: 'A' },
  { id: 'power-b', style: 'power', seed: 'pregen-power-3', arc: 'B' },
];

const GEN_ARTIST = 'Splinterhall band';
const GEN_LICENCE = 'Game original (samples CC0 and CC BY 3.0)';
const GEN_CREDIT = 'Rendered by Splinterhall\'s own generator from the music samples listed in the credits';

// ------------------------------------------------------------------------------------------- ffmpeg helpers
/** Run ffmpeg; returns its stderr (where loudnorm prints its measurement). Throws on failure. */
function ff(a) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').slice(-800)}`);
  return r.stderr || '';
}

/** Integrated loudness (LUFS), true peak (dBTP) and loudness range of a file through a filter chain. */
export function measure(file, chain = '') {
  const err = ff(['-i', file, '-af', (chain ? chain + ',' : '') + 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']);
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  return { i: +j.input_i, tp: +j.input_tp, lra: +j.input_lra };
}

export function duration(file) {
  return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim();
}

/** Where the sound starts and stops (first and last sample above -50 dBFS), in seconds. */
function soundBounds(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '11025', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const thr = Math.pow(10, -50 / 20);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b]) < thr) b--;
  return { start: a / 11025, end: (b + 1) / 11025, total: x.length / 11025 };
}

/**
 * Master a file into an MP3: cut [start, end], fade in and out, gain to TARGET_LUFS, a gentle limiter only if
 * the gain would push the true peak over MAX_TP, 96 kbps stereo. Re-measures the MP3 and corrects once or twice.
 */
export function master(input, output, { start = 0, end, fadeIn = 1.5, fadeOut = 3, tags = {} } = {}) {
  const len = end - start;
  const pre = `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=${fadeIn}:curve=qsin,afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(3)}:d=${fadeOut}:curve=qsin`;
  const m0 = measure(input, pre);
  let gain = TARGET_LUFS - m0.i;
  let res = null;
  for (let pass = 0; pass < 4; pass++) {
    const limit = m0.tp + gain > MAX_TP - 0.3;
    const chain = `${pre},volume=${gain.toFixed(2)}dB` +
      (limit ? `,alimiter=limit=${Math.pow(10, (MAX_TP - 0.4) / 20).toFixed(4)}:attack=4:release=80:level=0` : '') +
      ',aresample=44100';
    const meta = [];
    for (const [k, v] of Object.entries(tags)) if (v) meta.push('-metadata', `${k}=${v}`);
    ff(['-v', 'error', '-y', '-i', input, '-af', chain, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', BITRATE,
      '-compression_level', '0', '-id3v2_version', '3', ...meta, output]);
    res = { ...measure(output), limited: limit, gain };
    const di = TARGET_LUFS - res.i;
    if (res.tp > -1.05) { gain -= res.tp + 1.2; continue; }
    if (Math.abs(di) > 0.4) { gain += di; continue; }
    break;
  }
  res.seconds = duration(output);
  res.bytes = fs.statSync(output).size;
  res.input = m0;
  return res;
}

// ------------------------------------------------------------------------------------------- manifest
/** Read tracks.json, forgiving trailing commas (so adding a track is one pasted line). */
export function readManifest() {
  try {
    const text = fs.readFileSync(MANIFEST, 'utf8').replace(/,(\s*[\]}])/g, '$1');
    const j = JSON.parse(text);
    return { about: j.about, tracks: Array.isArray(j.tracks) ? j.tracks : [] };
  } catch { return { about: null, tracks: [] }; }
}

const ABOUT = 'Music for the track player. One track per line: put the MP3 in this folder and add a line. ' +
  'style: viking | battle | power | folk (folk plays with Viking and Any). Credit lines show on the in-game Credits page.';
const KEYS = ['file', 'title', 'artist', 'style', 'licence', 'credit', 'source', 'id'];

export function writeManifest(tracks) {
  const line = (t) => '    ' + JSON.stringify(Object.fromEntries([...KEYS.filter((k) => t[k] != null).map((k) => [k, t[k]]),
    ...Object.entries(t).filter(([k]) => !KEYS.includes(k))]));
  const text = `{\n  "about": ${JSON.stringify(ABOUT)},\n  "tracks": [\n${tracks.map(line).join(',\n')}\n  ]\n}\n`;
  fs.writeFileSync(MANIFEST, text);
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ------------------------------------------------------------------------------------------- commands
function list() {
  for (const s of SONGS) {
    const t = generateTune(s.seed + '#0', s.style);
    const bar = (60 / t.bpm / t.spb) * t.barSteps;
    console.log(`${s.id.padEnd(9)} ${t.title.padEnd(30)} ${t.style.padEnd(6)} ${t.bpm} bpm ${t.meter} ${t.keyLabel.padEnd(16)} ` +
      `riff ${t.riff.type.padEnd(7)} hook ${t.palette.hook.padEnd(7)} bar ${bar.toFixed(2)} s, about ${(Math.round(ARCS[s.arc].end / (bar * 4)) * 4 * bar + bar * 2 + 4.6).toFixed(0)} s`);
  }
}

async function renderAll(songs) {
  fs.mkdirSync(renderDir, { recursive: true });
  const port = 8100 + Math.floor(Math.random() * 800);
  const server = await serve(port);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  try {
    for (const s of songs) {
      // a fresh page per song, so one render's buffers are gone before the next starts
      await page.goto(`http://127.0.0.1:${port}/tools/music/pregen.html`);
      await page.waitForFunction(() => window.ready === true);
      const t0 = Date.now();
      const res = await page.evaluate((o) => window.renderSong(o), { seed: s.seed, style: s.style, arc: ARCS[s.arc] });
      fs.writeFileSync(path.join(renderDir, `song-${s.id}.wav`), Buffer.from(res.wav, 'base64'));
      delete res.wav;
      fs.writeFileSync(path.join(renderDir, `song-${s.id}.json`), JSON.stringify({ song: s, ...res }, null, 1));
      const ladder = res.bars.map((b) => (b.build ? '^' : '') + b.level).join('');
      console.log(`${s.id}: "${res.title}" ${res.bpm} bpm ${res.meter} ${res.key}, ${res.seconds.toFixed(1)} s rendered in ` +
        `${((Date.now() - t0) / 1000).toFixed(0)} s, clip ${res.clip}, voices ${res.peakVoices}, warnings ${res.warnings.length}\n  rungs ${ladder}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

function masterSongs(songs) {
  const man = readManifest();
  let tracks = man.tracks.slice();
  for (const s of songs) {
    const log = JSON.parse(fs.readFileSync(path.join(renderDir, `song-${s.id}.json`), 'utf8'));
    const wav = path.join(renderDir, `song-${s.id}.wav`);
    const file = `gen-${s.id}-${slug(log.title)}.mp3`;
    // keep a hair of the first attack; end 4.4 s after the last hit, fading over its last 3.4 s
    const start = Math.max(0, log.lead - 0.02);
    const end = log.finalHit + 4.4;
    const r = master(wav, path.join(TRACKS, file), {
      start, end, fadeIn: 1.8, fadeOut: 3.4,
      tags: { title: log.title, artist: GEN_ARTIST, album: 'Splinterhall', genre: `${s.style} metal`, comment: `${log.bpm} bpm ${log.meter} ${log.key}` },
    });
    // drop the song's old file if its name changed
    for (const t of tracks) if (t.id === `gen-${s.id}` && t.file !== file) fs.rmSync(path.join(TRACKS, t.file), { force: true });
    const entry = { file, title: log.title, artist: GEN_ARTIST, style: s.style, licence: GEN_LICENCE, credit: GEN_CREDIT, source: `tools/music/pregen.mjs (${s.seed}, arc ${s.arc})`, id: `gen-${s.id}` };
    const k = tracks.findIndex((t) => t.id === entry.id);
    if (k >= 0) tracks[k] = entry; else tracks.push(entry);
    console.log(`${file}: ${fmtTime(r.seconds)}, ${(r.bytes / 1048576).toFixed(2)} MB, ${r.i.toFixed(1)} LUFS, true peak ${r.tp.toFixed(1)} dBTP ` +
      `(render was ${r.input.i.toFixed(1)} LUFS / ${r.input.tp.toFixed(1)} dBTP, gain ${r.gain.toFixed(1)} dB${r.limited ? ', limited' : ''})`);
  }
  // generator songs first (in SONGS order), then everything else as it was
  const order = (t) => { const k = SONGS.findIndex((s) => t.id === `gen-${s.id}`); return k < 0 ? 1e3 : k; };
  tracks = tracks.map((t, i) => [t, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map((x) => x[0]);
  writeManifest(tracks);
}

function importTrack() {
  const input = path.resolve(String(args.import));
  const out = path.join(TRACKS, path.basename(String(args.out || slug(path.basename(input, path.extname(input))) + '.mp3')));
  const b = soundBounds(input);
  const fadeIn = +(args['fade-in'] || 0.05), fadeOut = +(args['fade-out'] || 1.5);
  const r = master(input, out, { start: Math.max(0, b.start - 0.01), end: Math.min(b.total, b.end + 0.25), fadeIn, fadeOut, tags: {
    title: args.title || '', artist: args.artist || '', comment: args.comment || '' } });
  console.log(`${path.basename(out)}: ${fmtTime(r.seconds)} (source ${fmtTime(b.total)}, sound ${b.start.toFixed(2)}-${b.end.toFixed(2)} s), ` +
    `${(r.bytes / 1048576).toFixed(2)} MB, ${r.i.toFixed(1)} LUFS, true peak ${r.tp.toFixed(1)} dBTP ` +
    `(source ${r.input.i.toFixed(1)} LUFS / ${r.input.tp.toFixed(1)} dBTP, gain ${r.gain.toFixed(1)} dB${r.limited ? ', limited' : ''})`);
  console.log('Now add a line for it to assets/audio/tracks/tracks.json (and its credit to CREDITS.md).');
}

function check() {
  const { tracks } = readManifest();
  let total = 0;
  for (const t of tracks) {
    const f = path.join(TRACKS, t.file);
    if (!fs.existsSync(f)) { console.log(`MISSING ${t.file}`); continue; }
    const m = measure(f), sz = fs.statSync(f).size;
    total += sz;
    console.log(`${t.file.padEnd(48)} ${String(t.style).padEnd(6)} ${fmtTime(duration(f))} ${(sz / 1048576).toFixed(2)} MB ${m.i.toFixed(1)} LUFS ${m.tp.toFixed(1)} dBTP  ${t.title} · ${t.artist}`);
  }
  let folder = 0;
  for (const f of fs.readdirSync(TRACKS)) folder += fs.statSync(path.join(TRACKS, f)).size;
  console.log(`${tracks.length} tracks, ${(total / 1048576).toFixed(2)} MB of audio; folder ${(folder / 1048576).toFixed(2)} MB`);
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function main() {
  fs.mkdirSync(TRACKS, { recursive: true });
  if (args.list) return list();
  if (args.check) return check();
  if (args.import) return importTrack();
  const only = args.only ? String(args.only).split(',') : null;
  const songs = SONGS.filter((s) => !only || only.includes(s.id));
  if (!songs.length) throw new Error('no such song: ' + args.only);
  if (!args['master-only']) await renderAll(songs);
  masterSongs(songs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
