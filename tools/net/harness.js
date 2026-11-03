// Test harness for the room layer: drives named rooms and records their events, the same way in Node (local
// and internet carriers) and in a browser page (bundled by test-browser.mjs; never part of a game build).
// Everything it returns is plain JSON, so a Playwright test can call it through page.evaluate.

import { createRoom, joinRoom } from '../../src/net/room.js';

const now = () => (globalThis.performance ? performance.timeOrigin + performance.now() : Date.now());

export function makeHarness() {
  const rooms = {};
  const logs = {};
  // Per-path arrival times of timestamped messages (see tap()).
  const lat = {};

  const listen = (name) => {
    const log = (logs[name] = []);
    const push = (type, ...args) => log.push({ type, at: now(), args: JSON.parse(JSON.stringify(args ?? null)) });
    return {
      roster: (r) => push('roster', r),
      info: (i) => push('info', i),
      message: (m, from) => {
        if (m && typeof m === 'object' && m.t === 'lat' && m.t0) ((lat[name] ??= {})['deliver:reliable'] ??= []).push(now() - m.t0);
        push('message', m, from);
      },
      fast: (k, d, from) => {
        if (d && typeof d === 'object' && d.t0) {
          const l = (lat[name] ??= {});
          (l[`deliver:${k}`] ??= []).push(now() - d.t0);
        }
        push('fast', k, d && typeof d === 'object' && d.big ? { ...d, big: d.big.length } : d, from);
      },
      host: (h) => push('host', h),
      status: (s) => push('status', s),
      start: (p, meta) => push('start', p, meta),
      lobby: (x) => push('lobby', x),
      nudge: (from) => push('nudge', from),
      peerLeft: (id) => push('peerLeft', id),
      error: (t) => push('error', t),
      closed: () => push('closed'),
    };
  };

  const state = (name) => {
    const r = rooms[name];
    if (!r) return null;
    return {
      code: r.code,
      myId: r.myId,
      isHost: r.isHost,
      hostId: r.hostId,
      roster: r.roster,
      info: r.info,
      phase: r.phase,
      match: r.match,
      state: r.state,
      carrier: r.carrier,
      quality: r.quality(),
      rtt: r.rtt,
      stats: r._ep ? { ...r._ep.stats, recv: { ...r._ep.stats.recv } } : null,
    };
  };

  return {
    rooms,
    async create(name, opts = {}) {
      rooms[name] = await createRoom({ ...opts, on: listen(name) });
      return state(name);
    },
    async join(name, code, opts = {}) {
      const on = listen(name);
      try {
        rooms[name] = await joinRoom(code, { ...opts, on });
        return state(name);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
    state,
    states: (names) => names.map(state),
    events(name, type) {
      return (logs[name] || []).filter((e) => !type || e.type === type);
    },
    clear(name) {
      if (logs[name]) logs[name].length = 0;
    },
    call(name, method, args = []) {
      const r = rooms[name];
      const out = r[method](...args);
      return out && typeof out.then === 'function' ? out.then(() => true) : (out ?? null);
    },
    // Silences a room without a goodbye (as if the device froze or lost its network).
    freeze(name) {
      const r = rooms[name];
      for (const rec of r._timers) (rec.i ? clearInterval : clearTimeout)(rec.t);
      r._timers.clear();
      r._ep.close({ bye: false });
      r._link?.close();
      r._state = 'closed';
    },
    // Records, for every copy of a timestamped message that reaches this room, which path brought it and how
    // long it took (before duplicates are dropped). Sender and receiver share one clock (one machine).
    tap(name) {
      const r = rooms[name];
      r._ep.tap = (env, via) => {
        const t0 = env.d?.t0 ?? env.m?.t0;
        if (!t0) return;
        const kind = env.k !== undefined ? `fast:${env.k}` : 'reliable';
        ((lat[name] ??= {})[`${via}:${kind}`] ??= []).push(now() - t0);
      };
      return true;
    },
    // The direct path's fast channels: how many are open, how many fast messages came through them.
    fastChannels(name) {
      const path = rooms[name]._ep.paths.find((p) => p.name === 'direct');
      return path ? { open: path.fastOpen, received: path.fastReceived, peers: path.peers } : null;
    },
    // The smallest gap between this room's own broker publishes (ms), from the broker path's diagnostics.
    publishGaps(name) {
      const path = rooms[name]._ep.paths.find((p) => p.name === 'broker');
      const t = path?.sentAt || [];
      let min = Infinity;
      for (let i = 1; i < t.length; i++) min = Math.min(min, t[i] - t[i - 1]);
      return { n: t.length, min: Number.isFinite(min) ? +min.toFixed(1) : null };
    },
    latency(name) {
      const out = {};
      for (const [key, list] of Object.entries(lat[name] || {})) {
        const s = [...list].sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        out[key] = { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
      }
      return out;
    },
    resetLatency(name) {
      delete lat[name];
      return true;
    },
    // Sends n reliable messages at once ({t:'seq', i}); every toEvery-th one goes only to `to`.
    spam(name, n, { to, toEvery = 0 } = {}) {
      const r = rooms[name];
      for (let i = 1; i <= n; i++) {
        if (toEvery && to && i % toEvery === 0) r.send({ t: 'seq', i, to: true }, to);
        else r.send({ t: 'seq', i });
      }
      return true;
    },
    // Sends n timestamped messages at a rate (per second): kind null = reliable, else fast of that kind.
    burst(name, { kind = null, n = 30, rate = 30, to, size = 0 } = {}) {
      const r = rooms[name];
      const big = size ? 'A'.repeat(size) : undefined;
      return new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          i++;
          const d = { t0: now(), i, ...(big ? { big } : {}) };
          if (kind) r.sendFast(kind, d, to);
          else r.send({ t: 'lat', ...d }, to);
          if (i >= n) return resolve(true);
          setTimeout(tick, 1000 / rate);
        };
        tick();
      });
    },
    leaveAll() {
      for (const r of Object.values(rooms)) if (!r.closed) r.leave();
      return true;
    },
  };
}
