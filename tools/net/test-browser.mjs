// Browser tests for the room layer in headless Chrome (Playwright), one page per player:
//   NET_TEST_DEPS=/path/to/netdeps node tools/net/test-browser.mjs [--only=internet,direct,wifi,ui,camera,relay]
//
//  internet — the four-player scenario on the internet carrier through a local test broker (?broker=),
//             with the direct WebRTC path on (Trystero, signalling over the same broker)
//  direct   — the direct path comes up between pages; latency per path for inputs, snapshots and reliable
//             messages; the broker publish-rate cap; then the same with ?direct=0 (brokers only)
//  wifi     — Wi-Fi pairing by text codes (no camera): host + 3 guests, messages through the host's relay
//  ui       — the pairing screens (wifi-ui.js) end to end by pasting codes; the drawn QR read back with jsQR
//  camera   — the guest screen scans the host QR code through a fake camera (a Y4M video), two browsers
//  relay    — the scenario on the 'relay' carrier against Hoverline's wifi-host.py (GAME_RELAY_NAME=splinterhall),
//             when the Hoverline clone is present (HOVERLINE_DIR, default /home/claude/lucidfir-ops/hoverline)
//
// The test broker needs aedes and ws installed outside the repo (see broker.mjs). Chrome is /usr/bin/google-chrome
// (CHROME to override). ?ice=none keeps WebRTC to host candidates: this sandbox has no route to STUN servers.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { startBroker } from './broker.mjs';
import { runScenario, makeReport, waitFor, sleep, rosterAgrees } from './scenario.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (x) => !only.length || only.includes(x);
const out = fs.mkdtempSync(path.join(process.env.NET_TEST_OUT || os.tmpdir(), 'sh-net-'));
const reports = [];
const findings = {};

// ---------- the test page ----------
await esbuild.build({
  entryPoints: [path.join(here, 'browser-entry.js')],
  bundle: true,
  format: 'esm',
  outfile: path.join(out, 'net-test.js'),
  logLevel: 'warning',
});
// A stand-in for the game's brutalist stylesheet: just the classes and variables the pairing screens use.
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>net test</title>
<style>
:root{--ink:#0C0C0B;--bone:#E8E2D4;--accent:#F2C230;--dim:#77736B}
*{border-radius:0!important}body{margin:0;background:var(--ink);color:var(--bone);font:14px/1.4 monospace}
.sh-panel{display:flex;flex-direction:column;gap:12px;padding:20px;border-left:6px solid var(--accent);background:#151513;max-width:620px}
.sh-title{font:900 28px/1 Impact,sans-serif;text-transform:uppercase;letter-spacing:.02em}
.sh-label{font-size:12px;text-transform:uppercase;color:var(--dim)}.sh-mono{font-family:monospace;font-size:12px}
.sh-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
.sh-btn{background:var(--bone);color:var(--ink);border:0;padding:10px 14px;font:700 13px monospace;text-transform:uppercase;clip-path:polygon(0 0,100% 0,100% 70%,calc(100% - 10px) 100%,0 100%)}
.sh-btn.sh-primary{background:var(--accent)}
</style><body><script type="module" src="./net-test.js"></script>`,
);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(out) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: [
    // A fake camera that is always allowed: the Wi-Fi pairing asks for the camera first (see cameraProbe).
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function openPages(names, query, context = null) {
  const ctx = context || (await browser.newContext());
  const pages = {};
  for (const n of names) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [${n} page error] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        const t = m.text();
        if (!/favicon|Trystero: relay failure|Failed to load resource|WebSocket connection to/.test(t)) console.log(`  [${n} ${m.type()}] ${t.slice(0, 300)}`);
      }
    });
    await page.goto(`${base}${query ? `?${query}` : ''}`);
    await page.waitForFunction(() => !!window.NT);
    pages[n] = page;
  }
  return { ctx, pages };
}

function pageAdapter(pages) {
  const ev = (n, fn, arg) => pages[n].evaluate(fn, arg);
  return {
    create: (n, o) => ev(n, ([n, o]) => window.NT.create(n, o), [n, o]),
    join: (n, c, o) => ev(n, ([n, c, o]) => window.NT.join(n, c, o), [n, c, o]),
    state: (n) => ev(n, (n) => window.NT.state(n), n),
    events: (n, t) => ev(n, ([n, t]) => window.NT.events(n, t), [n, t]),
    clear: (n) => ev(n, (n) => window.NT.clear(n), n),
    call: (n, m, a) => ev(n, ([n, m, a]) => window.NT.call(n, m, a), [n, m, a]),
    spam: (n, k, o) => ev(n, ([n, k, o]) => window.NT.spam(n, k, o), [n, k, o]),
    burst: (n, o) => ev(n, ([n, o]) => window.NT.burst(n, o), [n, o]),
    freeze: (n) => ev(n, (n) => window.NT.freeze(n), n),
    tap: (n) => ev(n, (n) => window.NT.tap(n), n),
    latency: (n) => ev(n, (n) => window.NT.latency(n), n),
    resetLatency: (n) => ev(n, (n) => window.NT.resetLatency(n), n),
    leaveAll: async () => {
      for (const n of Object.keys(pages)) await ev(n, () => window.NT.leaveAll()).catch(() => {});
    },
  };
}

let broker = null;
if (want('internet') || want('direct')) {
  broker = await startBroker();
  console.log(`test broker ${broker.url}`);
}
const bq = () => `broker=${encodeURIComponent(broker.url)}`;

// ---------- internet: the scenario ----------
if (want('internet')) {
  console.log('\ninternet carrier (test broker + direct WebRTC), 4 pages:');
  const R = makeReport('internet: ');
  reports.push(R);
  const { ctx, pages } = await openPages(['A', 'B', 'C', 'D'], `${bq()}&ice=none`);
  await runScenario(pageAdapter(pages), R, { carrier: 'internet', timeout: 20000 });
  await pageAdapter(pages).leaveAll();
  await ctx.close();
}

// ---------- direct path and latency ----------
async function latencyRun(label, query, { expectDirect }) {
  const R = makeReport(`${label}: `);
  reports.push(R);
  const names = ['H', 'P1', 'P2', 'P3'];
  const { ctx, pages } = await openPages(names, query);
  const A = pageAdapter(pages);
  const result = {};
  await R.check('room of 4 up', async () => {
    const st = await A.create('H', { carrier: 'internet', me: { name: 'H', color: 0 } });
    for (const n of names.slice(1)) {
      const j = await A.join(n, st.code, { carrier: 'internet', me: { name: n, color: 1 } });
      if (j.error) throw new Error(j.error);
    }
    await waitFor(() => rosterAgrees(A, names, 4), { timeout: 20000, what: 'roster' });
  });
  if (expectDirect)
    await R.check('direct WebRTC path comes up between every pair of pages', async () => {
      const t0 = Date.now();
      await waitFor(
        async () => {
          const sts = await Promise.all(names.map((n) => A.state(n)));
          return sts.every((s) => s.roster.every((e) => e.direct) && s.quality.quality === 'direct' && s.quality.directPeers === 3);
        },
        { timeout: 40000, every: 250, what: 'direct everywhere' },
      );
      result.directAfterMs = Date.now() - t0;
      const ev = await A.events('P1', 'status');
      return `all direct ${result.directAfterMs} ms after the roster settled; P1 status events: ${ev.map((e) => e.args[0].quality).join('→')}`;
    });
  else
    await R.check('brokers only: quality says brokers, nobody direct', async () => {
      await sleep(3000);
      const sts = await Promise.all(names.map((n) => A.state(n)));
      if (sts.some((s) => s.quality.quality !== 'brokers' || s.roster.some((e) => e.direct)))
        throw new Error(JSON.stringify(sts.map((s) => s.quality)));
      return `quality ${sts[1].quality.quality}, brokersOpen ${sts[1].quality.brokersOpen}`;
    });

  await R.check('latency: inputs P1→host (fast, 30/s), snapshots host→all (fast, 20/s, 1.6 KB), reliable P1→host (10/s)', async () => {
    for (const n of names) {
      await A.tap(n);
      await A.resetLatency(n);
      await A.clear(n);
    }
    const H = await A.state('H');
    const t0 = Date.now();
    await Promise.all([
      A.burst('P1', { kind: 'in', n: 180, rate: 30, to: H.myId }),
      A.burst('H', { kind: 'snap', n: 120, rate: 20, size: 1600 }),
      A.burst('P1', { kind: null, n: 60, rate: 10 }),
    ]);
    const t1 = Date.now();
    await sleep(1500);
    const atH = await A.latency('H');
    const atP2 = await A.latency('P2');
    result.atHost = atH;
    result.atP2 = atP2;
    const snaps = (await A.events('P2', 'fast')).filter((e) => e.args[0] === 'snap').length;
    const ins = (await A.events('H', 'fast')).filter((e) => e.args[0] === 'in').length;
    result.delivered = { snapsAtP2: `${snaps}/120 in ${((t1 - t0) / 1000).toFixed(1)} s`, inputsAtHost: `${ins}/180` };
    result.brokerPeak = broker.peakRate(t0, t1, (id) => id.startsWith('sh1-'));
    result.brokerMinGapMs = broker.minGap(t0, t1, (id) => id.startsWith('sh1-'));
    result.fastChannels = await pages.P2.evaluate(() => window.NT.fastChannels('P2'));
    result.senderGaps = {};
    for (const n of names) result.senderGaps[n] = await pages[n].evaluate((n) => window.NT.publishGaps(n), n);
    const fmt = (o) =>
      Object.entries(o)
        .sort()
        .map(([k, v]) => `${k} n=${v.n} p50=${v.p50} p95=${v.p95}`)
        .join('; ');
    if (expectDirect && !(result.fastChannels?.open === 3 && result.fastChannels.received >= 100))
      throw new Error(`fast channels at P2: ${JSON.stringify(result.fastChannels)}`);
    return `\n      at host: ${fmt(atH)}\n      at P2: ${fmt(atP2)}\n      delivered: ${JSON.stringify(result.delivered)}; P2's unordered fast channels: ${JSON.stringify(result.fastChannels)}`;
  });
  await R.check('broker publish cap: one publish per 125 ms per client per broker (8 a second)', async () => {
    // The sender's own publish times decide; arrival times at the broker carry socket jitter (shown too).
    const worst = Math.min(...Object.values(result.senderGaps).map((g) => g.min ?? Infinity));
    if (worst < 124.5) throw new Error(`a sender published ${worst} ms after its last publish`);
    return `smallest gap at the senders ${worst} ms; at the broker (arrival jitter) ${result.brokerMinGapMs} ms, busiest second ${result.brokerPeak.peak}`;
  });
  findings[label] = result;
  await A.leaveAll();
  await ctx.close();
}

if (want('direct')) {
  console.log('\ndirect path + latency (test broker, ?ice=none):');
  await latencyRun('direct', `${bq()}&ice=none`, { expectDirect: true });
  console.log('\nbrokers only (?direct=0):');
  await latencyRun('brokers-only', `${bq()}&direct=0`, { expectDirect: false });

  const R = makeReport('internet: ');
  reports.push(R);
  await R.check('joining when no broker can be reached gives a clear error', async () => {
    // A port nothing listens on (a server opened and closed again).
    const dead = await new Promise((resolve) => {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    const { ctx, pages } = await openPages(['X'], `broker=${encodeURIComponent(`ws://127.0.0.1:${dead}/mqtt`)}`);
    const t0 = Date.now();
    const j = await pages.X.evaluate(() => window.NT.join('X', 'ABCDE', { carrier: 'internet', me: { name: 'X' } }));
    await ctx.close();
    if (!j.error || !/relays could not be reached/.test(j.error)) throw new Error(JSON.stringify(j));
    return `${j.error} (${Date.now() - t0} ms)`;
  });
}

// ---------- Wi-Fi with no internet: text codes, host relays ----------
if (want('wifi')) {
  console.log('\nWi-Fi, no internet (text codes, no camera), host + 3 guests:');
  const R = makeReport('wifi: ');
  reports.push(R);
  const names = ['H', 'G1', 'G2', 'G3'];
  const { ctx, pages } = await openPages(names, '');
  const A = pageAdapter(pages);
  let code;
  await R.check('host + 3 guests pair by swapping codes; roster agrees', async () => {
    const st = await A.create('H', { carrier: 'wifi', me: { name: 'Host', color: 0 } });
    code = st.code;
    // The camera first, as the pairing screen does: with it allowed Chrome offers real addresses, not mDNS names.
    for (const n of names) await pages[n].evaluate(() => window.NW.cameraProbe());
    const sizes = [];
    for (const [i, g] of names.slice(1).entries()) {
      const offer = await pages.H.evaluate(() => window.NW.offer('H'));
      const ans = await pages[g].evaluate((o) => window.NW.answer('k', o), offer);
      sizes.push(`${offer.length}/${ans.reply.length}`);
      await pages.H.evaluate((r) => window.NW.accept('H', r), ans.reply);
      await pages[g].evaluate(() => window.NW.opened('k'));
      const j = await A.join(g, ans.code, { carrier: 'wifi', me: { name: `Guest ${i + 1}`, color: i + 1 } });
      if (j.error) throw new Error(`${g}: ${j.error}`);
    }
    const sts = await waitFor(() => rosterAgrees(A, names, 4), { timeout: 15000, what: 'roster' });
    if (sts[0].roster.map((e) => e.slot).join() !== '0,1,2,3') throw new Error('slots');
    return `room ${code}; code lengths host/reply ${sizes.join(', ')} characters`;
  });
  await R.check('reliable messages relayed in order; addressed ones reach only their player', async () => {
    for (const n of names) await A.clear(n);
    const G3 = await A.state('G3');
    await A.spam('G1', 150, { toEvery: 3, to: G3.myId });
    await waitFor(
      async () =>
        (await A.events('G3', 'message')).length >= 150 &&
        (await A.events('G2', 'message')).length >= 100 &&
        (await A.events('H', 'message')).length >= 100,
      { timeout: 10000, what: 'relay delivery' },
    );
    await sleep(500);
    for (const [n, k] of [
      ['H', 100],
      ['G2', 100],
      ['G3', 150],
    ]) {
      const got = (await A.events(n, 'message')).map((e) => e.args[0].i);
      if (got.length !== k) throw new Error(`${n} got ${got.length}`);
      for (let x = 1; x < got.length; x++) if (!(got[x] > got[x - 1])) throw new Error(`${n} order`);
    }
  });
  await R.check('fast messages through the relay are newest-wins; latency guest→guest via host', async () => {
    for (const n of names) {
      await A.clear(n);
      await A.tap(n);
      await A.resetLatency(n);
    }
    await A.burst('G1', { kind: 'snap', n: 100, rate: 30, size: 1600 });
    await A.burst('G2', { kind: null, n: 30, rate: 30 });
    await sleep(800);
    const got = (await A.events('G3', 'fast')).filter((e) => e.args[0] === 'snap').map((e) => e.args[1].i);
    for (let x = 1; x < got.length; x++) if (!(got[x] > got[x - 1])) throw new Error('older after newer');
    const l3 = await A.latency('G3');
    findings.wifi = l3;
    const s = Object.entries(l3)
      .map(([k, v]) => `${k} n=${v.n} p50=${v.p50} p95=${v.p95}`)
      .join('; ');
    return `G3 got ${got.length}/100 snapshots; ${s}`;
  });
  await R.check('a guest leaves: the others see it at once (the host relays the goodbye)', async () => {
    for (const n of names) await A.clear(n);
    const G3 = await A.state('G3');
    const t0 = Date.now();
    await A.call('G3', 'leave', []);
    await waitFor(
      async () => (await Promise.all(['H', 'G1', 'G2'].map((n) => A.state(n)))).every((s) => s.roster.length === 3),
      { timeout: 6000, what: 'G3 gone' },
    );
    const ev = await A.events('G1', 'peerLeft');
    if (!ev.some((e) => e.args[0] === G3.myId)) throw new Error('no peerLeft at G1');
    return `${Date.now() - t0} ms`;
  });
  await R.check('reconnect() on a Wi-Fi guest keeps its connection and slot', async () => {
    const G2 = await A.state('G2');
    await A.call('G2', 'reconnect', []);
    await sleep(500);
    await A.clear('H');
    await A.spam('G2', 3, {});
    await waitFor(async () => (await A.events('H', 'message')).length >= 3, { timeout: 5000, what: 'after reconnect' });
    const st = await A.state('H');
    if (st.roster.find((e) => e.id === G2.myId)?.slot !== 2) throw new Error('slot');
  });
  await R.check('the host leaves: guests get a clear error and the room closes', async () => {
    await A.call('H', 'leave', []);
    await waitFor(async () => (await A.state('G1')).state === 'closed' && (await A.state('G2')).state === 'closed', {
      timeout: 8000,
      what: 'guests closed',
    });
    const err = await A.events('G1', 'error');
    if (!err.length) throw new Error('no error event');
    return err[0].args[0];
  });
  await A.leaveAll();
  await ctx.close();
}

// ---------- the pairing screens ----------
if (want('ui')) {
  console.log('\nWi-Fi pairing screens (wifi-ui.js), by pasting codes:');
  const R = makeReport('ui: ');
  reports.push(R);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const { pages } = await openPages(['H', 'G'], '', ctx);
  const A = pageAdapter(pages);
  const codeOf = (p, role) =>
    p.evaluate((role) => {
      const t = [...document.querySelectorAll(`#wifi-${role} .sh-mono`)].map((e) => e.textContent).find((x) => x.startsWith('CODE'));
      return t ? t.replace(/^CODE · /, '').replace(/\s+/g, '') : null;
    }, role);
  await R.check('host screen shows a code and a QR code that reads back as the same text', async () => {
    await A.create('H', { carrier: 'wifi', me: { name: 'Host' } });
    await pages.H.evaluate(() => window.NW.mount('host', 'H'));
    const code = await waitFor(() => codeOf(pages.H, 'host'), { timeout: 8000, what: 'host code' });
    const fromQr = await pages.H.evaluate(() => window.NW.readQr('host'));
    if (fromQr !== code) throw new Error(`QR read ${fromQr}`);
    const bad = await pages.H.evaluate(() =>
      [...document.querySelectorAll('#wifi-host *')].filter((e) => getComputedStyle(e).borderRadius !== '0px').length,
    );
    if (bad) throw new Error(`${bad} elements with rounded corners`);
    return `${code.length} characters`;
  });
  await R.check('guest pastes the code, shows a reply; host pastes it; guest joins (onDone gets the room)', async () => {
    const code = await codeOf(pages.H, 'host');
    await pages.G.evaluate(() => window.NW.mount('guest', null, { name: 'UI guest', color: 3 }));
    await pages.G.fill('#wifi-guest textarea', code);
    await pages.G.click('#wifi-guest button:has-text("Use code")');
    const reply = await waitFor(() => codeOf(pages.G, 'guest'), { timeout: 8000, what: 'reply' });
    const fromQr = await pages.G.evaluate(() => window.NW.readQr('guest'));
    if (fromQr !== reply) throw new Error('reply QR');
    await pages.G.screenshot({ path: path.join(out, 'pair-guest.png') });
    await pages.H.fill('#wifi-host textarea', reply);
    await pages.H.click('#wifi-host button:has-text("Use code")');
    await waitFor(() => pages.G.evaluate(() => window.__ui.done), { timeout: 10000, what: 'guest onDone' });
    await waitFor(async () => (await A.state('H')).roster.length === 2, { timeout: 8000, what: 'roster of 2' });
    // The host's screen moves on to a fresh code for the next player.
    await waitFor(async () => (await codeOf(pages.H, 'host')) && (await codeOf(pages.H, 'host')) !== code, {
      timeout: 8000,
      what: 'next code',
    });
    await pages.H.screenshot({ path: path.join(out, 'pair-host.png') });
    return `screenshots in ${out}`;
  });
  await R.check('a wrong code gets a clear message', async () => {
    await pages.H.fill('#wifi-host textarea', 'hello');
    await pages.H.click('#wifi-host button:has-text("Use code")');
    const msg = await pages.H.evaluate(() => document.querySelector('#wifi-host [role=status]').textContent);
    if (!/isn't a Splinterhall Wi-Fi code/.test(msg)) throw new Error(msg);
    return msg;
  });
  await A.leaveAll();
  await ctx.close();
}

// ---------- scanning with a camera ----------
// Chrome's fake camera plays a Y4M file: one made of the host's QR code lets the guest's pairing screen scan it
// for real (getUserMedia, video, then BarcodeDetector or jsQR: Chrome on Linux has no BarcodeDetector, so this
// is the jsQR path the Steam Deck, Firefox and Safari take). Two browser instances, as two devices.
function writeY4m(file, text, { w = 640, h = 480, tilt = 0 } = {}) {
  const M = qrMatrixForTest(text);
  const n = M.length + 8;
  const k = Math.floor((h * 0.8) / n);
  const ox = Math.floor((w - n * k) / 2);
  const oy = Math.floor((h - n * k) / 2);
  const Y = Buffer.alloc(w * h, 90); // a grey room around the screen
  for (let y = 0; y < n * k; y++)
    for (let x = 0; x < n * k; x++) {
      // A slight shear, as a phone held at an angle sees it.
      const mx = Math.floor((x + tilt * (y - (n * k) / 2)) / k) - 4;
      const my = Math.floor(y / k) - 4;
      const dark = mx >= 0 && my >= 0 && mx < M.length && my < M.length && M[my][mx];
      Y[(oy + y) * w + ox + x] = dark ? 22 : 225;
    }
  const UV = Buffer.alloc((w / 2) * (h / 2) * 2, 128);
  const head = Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV]);
  fs.writeFileSync(file, Buffer.concat([head, frame, frame]));
}
let qrMatrixForTest;
if (want('camera')) {
  ({ qrMatrix: qrMatrixForTest } = await import('../../src/net/qr.js'));
  console.log('\ncamera scan (fake camera playing the QR code), two browsers:');
  const R = makeReport('camera: ');
  reports.push(R);
  const { ctx, pages } = await openPages(['H'], '');
  const A = pageAdapter(pages);
  await R.check("guest's camera reads the host's QR code; pairing completes", async () => {
    await A.create('H', { carrier: 'wifi', me: { name: 'Host' } });
    await pages.H.evaluate(() => window.NW.cameraProbe());
    const offer = await pages.H.evaluate(() => window.NW.offer('H'));
    const y4m = path.join(out, 'host-qr.y4m');
    writeY4m(y4m, offer, { tilt: 0.04 });
    const guestBrowser = await chromium.launch({
      executablePath: process.env.CHROME || '/usr/bin/google-chrome',
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
    });
    try {
      const g = await (await guestBrowser.newContext()).newPage();
      g.on('pageerror', (e) => console.log(`  [guest page error] ${e.message}`));
      await g.goto(base);
      await g.waitForFunction(() => !!window.NT);
      const hasBD = await g.evaluate(() => 'BarcodeDetector' in window);
      await g.evaluate(() => window.NW.mount('guest', null, { name: 'Camera guest', color: 2 }));
      const t0 = Date.now();
      await g.click('#wifi-guest button:has-text("Scan a code")');
      const reply = await waitFor(
        () =>
          g.evaluate(() => {
            const t = [...document.querySelectorAll('#wifi-guest .sh-mono')].map((e) => e.textContent).find((x) => x.startsWith('CODE'));
            return t ? t.replace(/^CODE · /, '').replace(/\s+/g, '') : null;
          }),
        { timeout: 15000, what: 'the camera to read the code' },
      );
      const scanMs = Date.now() - t0;
      await pages.H.evaluate((r) => window.NW.accept('H', r), reply);
      await waitFor(() => g.evaluate(() => window.__ui.done), { timeout: 10000, what: 'guest joined' });
      await waitFor(async () => (await A.state('H')).roster.length === 2, { timeout: 8000, what: 'roster of 2' });
      return `read in ${scanMs} ms with ${hasBD ? 'BarcodeDetector' : 'jsQR'}; joined across two browser instances`;
    } finally {
      await guestBrowser.close();
    }
  });
  await A.leaveAll();
  await ctx.close();
}

// ---------- the Wi-Fi host pack's relay ----------
const hov = process.env.HOVERLINE_DIR || '/home/claude/lucidfir-ops/hoverline';
if (want('relay') && fs.existsSync(path.join(hov, 'wifi-host', 'wifi-host.py'))) {
  console.log("\nrelay carrier against Hoverline's wifi-host.py (GAME_RELAY_NAME=splinterhall):");
  const R = makeReport('relay: ');
  reports.push(R);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const py = spawn('python3', ['-I', path.join(hov, 'wifi-host', 'wifi-host.py'), '--root', out, '--port', String(port), '--local'], {
    env: { ...process.env, GAME_RELAY_NAME: 'splinterhall' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(1200);
  const relayBase = `http://127.0.0.1:${port}/index.html`;
  const ctx = await browser.newContext();
  const pages = {};
  for (const n of ['A', 'B', 'C', 'D']) {
    pages[n] = await ctx.newPage();
    pages[n].on('pageerror', (e) => console.log(`  [${n} page error] ${e.message}`));
    await pages[n].goto(relayBase);
    await pages[n].waitForFunction(() => !!window.NT);
  }
  await R.check('the page finds the Wi-Fi host pack (relay name splinterhall)', async () => {
    const st = await pages.A.evaluate(async () => {
      const r = await window.NT.create('probe', {});
      const c = r.carrier;
      window.NT.rooms.probe.leave();
      return c;
    });
    if (st !== 'relay') throw new Error(`carrier ${st}`);
    return 'no carrier given: picked relay';
  });
  await runScenario(pageAdapter(pages), R, { carrier: 'relay', timeout: 20000 });
  await pageAdapter(pages).leaveAll();
  await ctx.close();
  py.kill();
}

// ---------- summary ----------
await browser.close();
if (broker) await broker.close();
server.close();
fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(findings, null, 2));
const all = reports.flatMap((r) => r.results);
const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} passed · findings in ${path.join(out, 'findings.json')}`);
for (const f of failed) console.log(`FAILED ${f.name}\n${f.detail}`);
process.exit(failed.length ? 1 : 0);
