// Node tests for the room layer (no browser needed): node tools/net/test-node.mjs
//  - envelope layer: duplicates over two paths, out-of-order paths, gap skipping, stubs, newest-wins, epochs
//  - QR encoder (decoded back with jsQR), Wi-Fi pairing codes, room codes
//  - the four-player room scenario on the local carrier (BroadcastChannel, as ?mp=local)
//  - host going silent (no goodbye), a full room, a room with no host
// Optional: NET_BROKER=ws://127.0.0.1:PORT/mqtt also runs the scenario on the internet carrier in Node
// (brokers only: Node has no WebRTC). See test-browser.mjs for the broker + direct path in Chrome.

import './node-env.mjs'; // first: sets location.search from NET_BROKER before the kit reads it
import { makeHarness } from './harness.js';
import { runScenario, makeReport, waitFor, sleep, rosterAgrees } from './scenario.mjs';
import { createEndpoint, BatchQueue, stubText } from '../../src/net/endpoint.js';
import { qrMatrix } from '../../src/net/qr.js';
import { pack, unpack, fromSdp, toSdp } from '../../src/net/wifi.js';
import { roomCode, normaliseCode, CODE_RE } from '../../src/net/config.js';
import jsQRmod from 'jsqr';

const jsQR = typeof jsQRmod === 'function' ? jsQRmod : jsQRmod.default;
const R = makeReport();
const reports = [R];

// ---------- envelope layer ----------
function pair(opts = {}) {
  const got = [];
  const fast = [];
  const rx = createEndpoint({
    id: 'rx',
    epoch: 1,
    firstContactMs: opts.hold ?? 0,
    tune: { gapMs: 300, ...(opts.tune || {}) },
    handlers: {
      onMessage: (env) => got.push(env.m ?? env.y),
      onFast: (k, d) => fast.push([k, d]),
    },
  });
  const sent = [];
  const tx = createEndpoint({ id: 'tx', epoch: 5, firstContactMs: 0, handlers: {} });
  tx.addPath({ push: (env, text) => sent.push(text), close() {} });
  return { rx, tx, got, fast, sent, close: () => (rx.close({ bye: false }), tx.close({ bye: false })) };
}

await R.check('endpoint: copies over two paths are delivered once, in order', async () => {
  const p = pair();
  for (let i = 1; i <= 50; i++) p.tx.send({ i });
  const texts = p.sent.filter((t) => JSON.parse(t).s);
  // Path 1 delivers in order; path 2 delivers everything again in reverse.
  for (const t of texts) p.rx.receiveText(t, 'a');
  for (const t of [...texts].reverse()) p.rx.receiveText(t, 'b');
  p.close();
  if (p.got.length !== 50 || p.got.some((m, k) => m.i !== k + 1)) throw new Error(JSON.stringify(p.got.slice(0, 5)));
  return `${p.rx.stats.dupes} copies dropped`;
});

await R.check('endpoint: out-of-order arrivals wait for the gap, a lost one is skipped after gapMs', async () => {
  const p = pair();
  for (let i = 1; i <= 6; i++) p.tx.send({ i });
  const t = p.sent.filter((x) => JSON.parse(x).s);
  p.rx.receiveText(t[0]);
  p.rx.receiveText(t[2]);
  p.rx.receiveText(t[1]);
  if (p.got.map((m) => m.i).join() !== '1,2,3') throw new Error(`reordered: ${p.got.map((m) => m.i)}`);
  p.rx.receiveText(t[4]);
  p.rx.receiveText(t[5]); // 4 never arrives
  if (p.got.length !== 3) throw new Error('delivered past a gap');
  await sleep(450);
  p.close();
  if (p.got.map((m) => m.i).join() !== '1,2,3,5,6') throw new Error(`after gap: ${p.got.map((m) => m.i)}`);
  return `skipped ${p.rx.stats.skipped}`;
});

await R.check('endpoint: first contact holds briefly so a slower path can fill in earlier messages', async () => {
  const p = pair({ hold: 200 });
  for (let i = 1; i <= 3; i++) p.tx.send({ i });
  const t = p.sent.filter((x) => JSON.parse(x).s);
  p.rx.receiveText(t[2], 'fast');
  await sleep(50);
  p.rx.receiveText(t[0], 'slow');
  p.rx.receiveText(t[1], 'slow');
  await sleep(250);
  p.close();
  if (p.got.map((m) => m.i).join() !== '1,2,3') throw new Error(`${p.got.map((m) => m.i)}`);
});

await R.check('endpoint: a stub fills the gap for others, the addressee waits for the full copy', async () => {
  const p = pair();
  p.tx.send({ i: 1 });
  p.tx.send({ i: 2 }, 'rx');
  p.tx.send({ i: 3 });
  const t = p.sent.map((x) => JSON.parse(x)).filter((e) => e.s);
  // As another player: the stub for 2 lets 3 through.
  const other = createEndpoint({ id: 'zz', epoch: 1, firstContactMs: 0, handlers: { onMessage: (e) => got2.push(e.m) } });
  const got2 = [];
  other.receive(t[0]);
  other.receive(JSON.parse(stubText(t[1])));
  other.receive(t[2]);
  other.close({ bye: false });
  if (got2.map((m) => m.i).join() !== '1,3') throw new Error(`other got ${JSON.stringify(got2)}`);
  // As the addressee: the stub is ignored, the full copy arrives later and is delivered.
  p.rx.receive(t[0]);
  p.rx.receive(JSON.parse(stubText(t[1])));
  p.rx.receive(t[2]);
  if (p.got.map((m) => m.i).join() !== '1') throw new Error('addressee consumed the stub');
  p.rx.receive(t[1]);
  p.close();
  if (p.got.map((m) => m.i).join() !== '1,2,3') throw new Error(`addressee got ${p.got.map((m) => m.i)}`);
});

await R.check('endpoint: fast messages are newest-wins per kind; copies and older ones dropped', async () => {
  const p = pair();
  for (let i = 1; i <= 5; i++) p.tx.sendFast('snap', i);
  p.tx.sendFast('in', 'x');
  const t = p.sent.filter((x) => JSON.parse(x).k);
  p.rx.receiveText(t[3]); // snap 4
  p.rx.receiveText(t[1]); // snap 2: older, dropped
  p.rx.receiveText(t[3]); // copy, dropped
  p.rx.receiveText(t[5]); // in
  p.rx.receiveText(t[4]); // snap 5
  p.close();
  const s = p.fast.map(([k, d]) => `${k}${d}`).join();
  if (s !== 'snap4,inx,snap5') throw new Error(s);
});

await R.check('endpoint: a new epoch (reconnect) restarts the sequence; old-epoch copies are ignored', async () => {
  const got = [];
  const rx = createEndpoint({ id: 'rx', epoch: 1, firstContactMs: 0, handlers: { onMessage: (e) => got.push(e.m.i) } });
  rx.receive({ f: 'p', e: 1, s: 1, m: { i: 'a1' } });
  rx.receive({ f: 'p', e: 1, s: 2, m: { i: 'a2' } });
  rx.receive({ f: 'p', e: 2, s: 1, m: { i: 'b1' } });
  rx.receive({ f: 'p', e: 1, s: 3, m: { i: 'a3-late' } });
  rx.receive({ f: 'p', e: 2, s: 2, m: { i: 'b2' } });
  // A goodbye, then a late copy from before it: must not bring the player back.
  rx.receive({ f: 'p', e: 2, t: '_bye' });
  rx.receive({ f: 'p', e: 2, t: '_hb' });
  const back = rx.has('p');
  rx.close({ bye: false });
  if (got.join() !== 'a1,a2,b1,b2') throw new Error(got.join());
  if (back) throw new Error('a late heartbeat brought a departed player back');
});

await R.check("endpoint: a broker's last will only soft-expires a player who is still heard elsewhere", async () => {
  const left = [];
  const rx = createEndpoint({
    id: 'rx',
    epoch: 1,
    tune: { silenceMs: 2000, willMs: 600 },
    handlers: { onLeave: (id) => left.push(id) },
  });
  rx.receive({ f: 'p', e: 3, t: '_hb' });
  rx.receive({ f: 'q', e: 3, t: '_hb' });
  rx.receive({ f: 'p', e: 3, t: '_bye', w: 1 });
  rx.receive({ f: 'q', e: 3, t: '_bye', w: 1 });
  // p is still heard on another path; q is not.
  const keep = setInterval(() => rx.receive({ f: 'p', e: 3, t: '_hb' }, 'direct'), 200);
  await sleep(1300);
  clearInterval(keep);
  rx.close({ bye: false });
  if (left.join() !== 'q') throw new Error(`left: ${left}`);
});

await R.check('batch queue: reliable kept in order, only the newest fast message of each kind waits', async () => {
  const q = new BatchQueue();
  const e = (o) => [o, JSON.stringify(o)];
  q.push(...e({ s: 1 }));
  q.push(...e({ k: 'snap', n: 1 }));
  q.push(...e({ s: 2 }));
  q.push(...e({ k: 'snap', n: 2 }));
  q.push(...e({ k: 'in', n: 1, to: 'h' }));
  q.push(...e({ t: '_hb' }));
  q.push(...e({ t: '_hb' }));
  const b = JSON.parse(q.take().text);
  const s = b.map((x) => x.s ?? `${x.k ?? x.t}${x.n ?? ''}`).join();
  if (s !== '1,2,snap2,in1,_hb') throw new Error(s);
});

await R.check('batch queue: a big backlog leaves in publishes under maxBatchBytes', async () => {
  const q = new BatchQueue();
  for (let i = 0; i < 100; i++) q.push({ s: i }, JSON.stringify({ s: i, pad: 'x'.repeat(1000) }));
  let n = 0;
  let max = 0;
  for (let b; (b = q.take(48 * 1024)); n++) max = Math.max(max, b.text.length);
  if (max > 48 * 1024) throw new Error(`batch of ${max} bytes`);
  return `${n} publishes, largest ${max} bytes`;
});

// ---------- codes ----------
function decodeMatrix(M, quiet = 4, k = 4) {
  const n = M.length + quiet * 2;
  const w = n * k;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < M.length; y++)
    for (let x = 0; x < M.length; x++)
      if (M[y][x])
        for (let dy = 0; dy < k; dy++)
          for (let dx = 0; dx < k; dx++) {
            const o = (((y + quiet) * k + dy) * w + (x + quiet) * k + dx) * 4;
            data[o] = data[o + 1] = data[o + 2] = 0;
          }
  return jsQR(data, w, w)?.data;
}

await R.check('QR encoder: alphanumeric and byte mode codes decode back (jsQR)', async () => {
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const texts = ['HELLO', 'F7K2Q9XM', 'Splinterhall · ünïcode', 'https://example.com/?a=1'];
  for (const len of [40, 120, 178, 230, 300]) {
    let t = 'SH';
    for (let i = 0; i < len; i++) t += B32[(i * 7 + len) % 32];
    texts.push(t);
  }
  const versions = [];
  for (const t of texts) {
    const M = qrMatrix(t);
    versions.push((M.length - 17) / 4);
    const back = decodeMatrix(M);
    if (back !== t) throw new Error(`"${t.slice(0, 20)}…" decoded as ${back}`);
  }
  return `versions ${versions.join(',')}`;
});

await R.check('Wi-Fi codes: pack/unpack round trip and SDP template', async () => {
  const sdp = [
    'v=0',
    'a=ice-ufrag:Ab3d',
    'a=ice-pwd:0123456789abcdefghijklmn',
    `a=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, i) => ((i * 37) & 255).toString(16).toUpperCase().padStart(2, '0')).join(':')}`,
    'a=candidate:1 1 udp 2113937151 192.168.1.20 54321 typ host generation 0',
    'a=candidate:2 1 udp 2113937151 1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9.local 50000 typ host generation 0',
    'a=candidate:3 1 udp 1677729535 203.0.113.9 6000 typ srflx raddr 0.0.0.0 rport 0',
  ].join('\r\n');
  const o = fromSdp(sdp);
  if (o.cands.length !== 2 || o.cands[0].a !== '192.168.1.20') throw new Error(JSON.stringify(o.cands));
  const code = pack({ ...o, kind: 1, code: 'ABCDE', tag: 4321 });
  if (!/^SH[0-9A-Z]+$/.test(code)) throw new Error(code);
  const back = unpack(code.toLowerCase().replace(/(.{5})/g, '$1 '));
  if (!back || back.code !== 'ABCDE' || back.tag !== 4321 || back.uf !== 'Ab3d' || back.fp !== o.fp) throw new Error('round trip');
  if (back.cands[1].a !== o.cands[1].a || back.cands[0].port !== 54321) throw new Error('candidates');
  const sdp2 = toSdp(back, 'active');
  if (!sdp2.includes('a=setup:active') || !sdp2.includes('192.168.1.20 54321 typ host')) throw new Error('template');
  if (unpack('HLABCDEF') !== null || unpack('SH') !== null) throw new Error('accepted junk');
  const M = qrMatrix(code);
  if (decodeMatrix(M) !== code) throw new Error('QR of a pairing code');
  return `${code.length} characters, QR version ${(M.length - 17) / 4}`;
});

await R.check('room codes: 5 letters from the alphabet without 0/O/1/I', async () => {
  for (let i = 0; i < 2000; i++) {
    const c = roomCode();
    if (!CODE_RE.test(c) || /[01OI]/.test(c)) throw new Error(c);
  }
  if (normaliseCode(' ab-cd e ') !== 'ABCDE') throw new Error('normalise');
});

// ---------- rooms on the local carrier ----------
const H = makeHarness();
const adapter = {
  create: (n, o) => H.create(n, o),
  join: (n, c, o) => H.join(n, c, o),
  state: async (n) => H.state(n),
  events: async (n, t) => H.events(n, t),
  clear: async (n) => H.clear(n),
  call: async (n, m, a) => H.call(n, m, a),
  spam: async (n, k, o) => H.spam(n, k, o),
  burst: (n, o) => H.burst(n, o),
  freeze: async (n) => H.freeze(n),
};

console.log('\nlocal carrier (BroadcastChannel), 4 players:');
const RL = makeReport('local: ');
reports.push(RL);
await runScenario(adapter, RL, { carrier: 'local' });
H.leaveAll();
await sleep(300);

console.log('\nlocal carrier, failure cases:');
const tune = { silenceMs: 2500, joinTimeoutMs: 1500, heartbeatMs: 500 };
await R.check('host goes silent (no goodbye): lowest slot takes over everywhere', async () => {
  const st = await H.create('h1', { carrier: 'local', me: { name: 'H' }, tune });
  for (const n of ['g1', 'g2', 'g3']) await H.join(n, st.code, { carrier: 'local', me: { name: n }, tune });
  await waitFor(() => rosterAgrees(adapter, ['h1', 'g1', 'g2', 'g3'], 4), { what: 'roster' });
  const g1 = H.state('g1');
  H.freeze('h1');
  const t0 = Date.now();
  await waitFor(
    () => ['g1', 'g2', 'g3'].every((n) => H.state(n).hostId === g1.myId) && H.state('g1').isHost,
    { timeout: 8000, what: 'g1 as host' },
  );
  const took = Date.now() - t0;
  await waitFor(() => rosterAgrees(adapter, ['g1', 'g2', 'g3'], 3), { what: 'roster of 3' });
  H.leaveAll();
  return `took over after ${took} ms (silenceMs 2500 in this test; 12000 in the game)`;
});

await R.check('a frozen host that wakes up steps down for the new host (higher term wins)', async () => {
  const st = await H.create('h2', { carrier: 'local', me: { name: 'H' }, tune });
  for (const n of ['k1', 'k2']) await H.join(n, st.code, { carrier: 'local', me: { name: n }, tune });
  await waitFor(() => rosterAgrees(adapter, ['h2', 'k1', 'k2'], 3), { what: 'roster' });
  const room = H.rooms.h2;
  // Stop the host's sending for longer than silenceMs, but keep it listening.
  const paths = room._ep.paths.splice(0);
  const timers = [...room._timers];
  for (const rec of timers) (rec.i ? clearInterval : clearTimeout)(rec.t);
  await waitFor(() => H.state('k1').isHost && H.state('k2').hostId === H.state('k1').myId, { timeout: 8000, what: 'k1 host' });
  room._ep.paths.push(...paths);
  room._timers.clear();
  room._startTimers();
  room._sendRoster();
  await waitFor(() => !H.state('h2').isHost && H.state('h2').hostId === H.state('k1').myId, { timeout: 8000, what: 'h2 steps down' });
  await waitFor(() => rosterAgrees(adapter, ['h2', 'k1', 'k2'], 3), { timeout: 8000, what: 'one roster' });
  const sts = ['h2', 'k1', 'k2'].map((n) => H.state(n));
  if (sts.filter((s) => s.isHost).length !== 1) throw new Error('two hosts');
  H.leaveAll();
});

await R.check('a room is full at 8: the ninth gets a clear error', async () => {
  const st = await H.create('f0', { carrier: 'local', me: { name: 'F0' } });
  for (let i = 1; i < 8; i++) {
    const j = await H.join(`f${i}`, st.code, { carrier: 'local', me: { name: `F${i}` } });
    if (j.error) throw new Error(j.error);
  }
  const all = Array.from({ length: 8 }, (_, i) => `f${i}`);
  const sts = await waitFor(() => rosterAgrees(adapter, all, 8), { what: '8 players' });
  if (sts[0].roster.map((e) => e.slot).join() !== '0,1,2,3,4,5,6,7') throw new Error('slots');
  const j = await H.join('f8', st.code, { carrier: 'local', me: { name: 'F8' } });
  H.leaveAll();
  if (!j.error || !/full/i.test(j.error)) throw new Error(`ninth: ${JSON.stringify(j)}`);
  return j.error;
});

await R.check("joining a room nobody hosts fails clearly within a few seconds", async () => {
  const t0 = Date.now();
  const j = await H.join('lonely', 'ZZZZZ', { carrier: 'local', me: { name: 'L' }, tune: { joinTimeoutMs: 3000 } });
  if (!j.error || !/No host answered/.test(j.error)) throw new Error(JSON.stringify(j));
  return `${j.error} (${Date.now() - t0} ms)`;
});

await R.check('a fast kind starting with _ is refused (reserved for the kit)', async () => {
  const st = await H.create('r0', { carrier: 'local', me: { name: 'R' } });
  let threw = false;
  try {
    H.rooms.r0.sendFast('_p', 1);
  } catch {
    threw = true;
  }
  H.leaveAll();
  if (!threw) throw new Error('accepted');
  return st.code;
});

if (process.env.NET_BROKER) {
  // Internet carrier in Node: brokers only (no WebRTC in Node). PARAMS come from location, so set it first.
  console.log(`\ninternet carrier in Node via ${process.env.NET_BROKER} (brokers only):`);
  const H2 = makeHarness();
  const a2 = { ...adapter };
  for (const k of Object.keys(adapter)) a2[k] = (...args) => Promise.resolve(H2[k](...args));
  const RI = makeReport('node-internet: ');
  reports.push(RI);
  await runScenario(a2, RI, { carrier: 'internet' });
  H2.leaveAll();
}

// ---------- summary ----------
await sleep(500);
const all = reports.flatMap((r) => r.results);
const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} passed`);
for (const f of failed) console.log(`FAILED ${f.name}\n${f.detail}`);
process.exit(failed.length ? 1 : 0);
