#!/usr/bin/env node
// Run a snippet against the engine's modules inside headless Chrome, for debugging the graph offline.
//   node tools/music/probe.mjs path/to/snippet.js [out.wav]
// The snippet is the body of an async function (ctx is not created for you). It can `await import('/src/...')`
// and must return an AudioBuffer (written to out.wav) or any JSON value (printed).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from './serve.mjs';

const [snippetPath, outWav] = process.argv.slice(2);
const code = fs.readFileSync(snippetPath, 'utf8');
const port = 8900 + Math.floor(Math.random() * 90);
const server = await serve(port);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/music/render.html`);
await page.waitForFunction(() => window.ready === true);
const res = await page.evaluate(async (src) => {
  const fn = new Function('return (async () => {' + src + '})()');
  const out = await fn();
  if (out && typeof out.getChannelData === 'function') {
    const chans = [];
    for (let c = 0; c < out.numberOfChannels; c++) chans.push(Array.from(out.getChannelData(c)));
    return { audio: { sr: out.sampleRate, chans } };
  }
  return { json: out };
}, code);
if (res.audio && outWav) {
  const { sr, chans } = res.audio;
  const n = chans[0].length, ch = chans.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * ch * 2, 28);
  b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); b.writeInt16LE(Math.round(v * 32767), o); o += 2; }
  fs.writeFileSync(outWav, b);
  console.log('wrote', outWav);
} else console.log(JSON.stringify(res.json, null, 1));
await browser.close();
server.close();
