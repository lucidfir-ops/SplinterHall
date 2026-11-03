// The envelope layer every carrier shares: one player's end of a room link.
//
// Messages are small JSON objects wrapped in an envelope that names the sender. Carriers ("paths") only move
// envelopes; they never interpret them. A path is either immediate (WebRTC, BroadcastChannel) or batched (MQTT
// brokers, the Wi-Fi host pack's relay). The internet carrier sends every envelope over several paths at once
// (two brokers and the direct WebRTC channel), so this layer drops the copies and puts reliable messages back
// in order.
//
// Envelope fields:
//   f  sender's player id          e  sender's link epoch (grows with every reconnect of that player)
//   s  reliable sequence number    m  game message           y  session (lobby) message
//   k  fast message kind           n  fast counter (per kind) d  fast data
//   to addressee (others ignore it) t  control: '_hb' heartbeat, '_bye' goodbye
//
// Reliable messages (s) are delivered once and in order per sender. Fast messages (k) carry their own counter
// instead of a sequence number: a newer one replaces an older one, so a lost or replaced snapshot never holds
// anything up, and a copy or an older one arriving late by a slower path is dropped.
//
// Presence comes from the messages themselves: each player sends a heartbeat every two seconds (the direct
// path every half second), and a player not heard from on any path for silenceMs has left.

import { NET, monoNow } from './config.js';

// Queue for a batched path. Reliable envelopes wait in order; of the fast ones (and heartbeats) only the newest
// of each kind (and addressee) waits, so a slow broker never builds up a backlog of stale snapshots.
export class BatchQueue {
  constructor() {
    this.items = [];
  }
  push(env, text) {
    let key = null;
    if (env.k !== undefined) key = `k${env.k}>${env.to || ''}`;
    else if (env.t === '_hb') key = '_hb';
    if (key !== null) {
      const i = this.items.findIndex((item) => item.key === key);
      if (i >= 0) this.items.splice(i, 1);
    }
    this.items.push({ key, text });
  }
  get size() {
    return this.items.length;
  }
  // The oldest envelopes that fit in maxBytes (always at least one), as one JSON array; the rest stay queued
  // for the next turn, so a burst never breaks a broker's publish-rate cap.
  take(maxBytes = Infinity) {
    if (!this.items.length) return null;
    let n = 0;
    let bytes = 2;
    let fastOnly = true;
    while (n < this.items.length) {
      const item = this.items[n];
      if (n > 0 && bytes + item.text.length + 1 > maxBytes) break;
      bytes += item.text.length + 1;
      if (item.key === null) fastOnly = false;
      n++;
    }
    const batch = this.items.splice(0, n);
    return { text: `[${batch.map((item) => item.text).join(',')}]`, fastOnly, count: n };
  }
  clear() {
    this.items.length = 0;
  }
}

// A path that delivers a reliable message addressed to one player only to that player (the direct path, the
// Wi-Fi host's relay) sends the others a stub: just its place in the sender's sequence. Without it they would
// hold every later message from that sender until a broker's copy filled the gap (or gapMs passed), which
// would throw away the direct path's speed whenever the game sends to one player.
// A stub that reaches its own addressee (a path that didn't know yet who was who) is ignored, so the full copy
// on another path still counts.
export const stubText = (env) => JSON.stringify({ f: env.f, e: env.e, s: env.s, to: env.to, z: 1 });

// handlers: onPeer(id), onLeave(id), onMessage(envelope, fromId), onFast(kind, data, fromId)
export function createEndpoint({ id, epoch, firstContactMs, tune, handlers = {} }) {
  const T = { ...NET, ...(tune || {}) };
  const holdMs = firstContactMs ?? T.firstContactMs;
  const peers = new Map(); // player id -> { last, epoch, line, fast }
  const tombs = new Map(); // player id -> { e, until }: a goodbye was heard; older copies are ghosts
  const paths = [];
  const fastCount = new Map();
  const stats = { sent: 0, recv: {}, dupes: 0, stale: 0, skipped: 0 };
  let seq = 0;
  let closed = false;

  const hb = { f: id, e: epoch, t: '_hb' };
  const hbText = JSON.stringify(hb);

  const newLine = () => ({ last: null, held: new Map(), timer: null });
  const newPeer = (e) => ({ last: monoNow(), epoch: e, line: newLine(), fast: new Map() });
  const resetLines = (p) => {
    clearTimeout(p.line.timer);
    p.line = newLine();
    p.fast = new Map();
  };

  function transmit(env, only = null) {
    if (closed) return;
    const text = JSON.stringify(env);
    stats.sent++;
    for (const path of only || paths) {
      try {
        path.push(env, text);
      } catch (error) {
        console.error('net: path send failed', error);
      }
    }
  }

  const beatAll = () => {
    for (const path of paths) {
      path.beatAt = monoNow();
      try {
        path.push(hb, hbText);
      } catch {
        /* A path that cannot send yet. */
      }
    }
  };

  function forget(from) {
    const p = peers.get(from);
    if (!p) return;
    clearTimeout(p.line.timer);
    peers.delete(from);
    handlers.onLeave?.(from);
  }

  function release(from, p) {
    const line = p.line;
    if (line.last === null) {
      if (holdMs > 0) {
        // First contact: hold briefly so a slower path can fill in anything earlier.
        line.timer ??= setTimeout(() => {
          line.timer = null;
          if (closed || peers.get(from) !== p || p.line !== line || !line.held.size) return;
          line.last = Math.min(...line.held.keys()) - 1;
          release(from, p);
        }, holdMs);
        return;
      }
      line.last = Math.min(...line.held.keys()) - 1;
    }
    while (line.held.has(line.last + 1)) {
      const env = line.held.get(++line.last);
      line.held.delete(line.last);
      // Addressed messages still take their place in the sender's sequence on every device, so nobody waits
      // for a gap that was only meant for someone else.
      if (!env.to || env.to === id) handlers.onMessage?.(env, from);
      if (closed || peers.get(from) !== p || p.line !== line) return;
    }
    if (!line.held.size) {
      clearTimeout(line.timer);
      line.timer = null;
    } else
      // One timer per gap: later arrivals must not keep pushing it back. A gap that never fills (a broker
      // dropped it and no other path had it) is skipped.
      line.timer ??= setTimeout(() => {
        line.timer = null;
        if (closed || peers.get(from) !== p || p.line !== line || !line.held.size) return;
        stats.skipped++;
        line.last = Math.min(...line.held.keys()) - 1;
        release(from, p);
      }, T.gapMs);
  }

  function receive(env, via = 'net') {
    if (closed || !env || typeof env !== 'object') return;
    const from = env.f;
    if (typeof from !== 'string' || !from || from.length > 32 || from === id) return;
    const e = typeof env.e === 'number' ? env.e : 0;
    const tomb = tombs.get(from);
    if (tomb && e <= tomb.e) {
      stats.stale++;
      return;
    }
    let p = peers.get(from);
    if (p && e < p.epoch) {
      // A copy from before that player's last reconnect.
      stats.stale++;
      return;
    }
    stats.recv[via] = (stats.recv[via] || 0) + 1;
    // Every copy that arrives, before duplicates are dropped: the tests time each path with it.
    if (ep.tap) ep.tap(env, via);
    if (env.t === '_bye') {
      if (env.w) {
        // A broker's last will: that one broker lost the player, which with two brokers and a direct path
        // doesn't mean they have gone. They are forgotten only if no other path hears them within willMs.
        if (p && e === p.epoch) p.last = Math.min(p.last, monoNow() - T.silenceMs + T.willMs);
        return;
      }
      // A real goodbye. Copies that arrive later by a slower path must not bring the player back.
      tombs.set(from, { e, until: monoNow() + 60000 });
      forget(from);
      return;
    }
    let fresh = false;
    if (!p) {
      peers.set(from, (p = newPeer(e)));
      fresh = true;
    } else if (e > p.epoch) {
      // The same player on a new link: its sequence and counters start again, and it counts as new for
      // onPeer (it needs a roster, and a first reliable message from everyone, again).
      resetLines(p);
      p.epoch = e;
      fresh = true;
    }
    p.last = monoNow();
    if (fresh) {
      handlers.onPeer?.(from);
      if (closed || peers.get(from) !== p) return;
      // Answer at once so the newcomer need not wait for the next heartbeat.
      beatAll();
    }
    if (env.k !== undefined) {
      if (env.to && env.to !== id) return;
      const kind = String(env.k);
      const n = Number(env.n);
      if (!(n > (p.fast.get(kind) ?? 0))) {
        stats.dupes++;
        return;
      }
      p.fast.set(kind, n);
      handlers.onFast?.(kind, env.d, from);
      return;
    }
    if (typeof env.s !== 'number') return; // a heartbeat: presence only
    // A stub ({f, e, s, to, z}, no body) takes its place in the sequence like any message for someone else,
    // except at its own addressee, who waits for the full copy.
    if (env.z && env.to === id) return;
    const line = p.line;
    if ((line.last !== null && env.s <= line.last) || line.held.has(env.s)) {
      stats.dupes++;
      return;
    }
    line.held.set(env.s, env);
    release(from, p);
  }

  function receiveText(text, via) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return; // Not one of ours.
    }
    // A batch, or a single envelope (a direct message, or the broker's last-will goodbye).
    if (Array.isArray(data)) for (const env of data) receive(env, via);
    else receive(data, via);
  }

  let lastTick = monoNow();
  const ticker = setInterval(() => {
    const now = monoNow();
    const stalled = now - lastTick > Math.max(6000, T.heartbeatMs * 3);
    lastTick = now;
    if (stalled) {
      // This device was frozen (a long load, or the app in the background): the silence was ours, so everyone
      // gets a fresh grace period instead of being dropped all at once.
      for (const p of peers.values()) p.last = now;
    } else {
      for (const [from, p] of peers) if (now - p.last > T.silenceMs) forget(from);
    }
    for (const path of paths) {
      if (!path.beatMs || now - (path.beatAt || 0) < path.beatMs) continue;
      path.beatAt = now;
      try {
        path.push(hb, hbText);
      } catch {
        /* Next time. */
      }
    }
    for (const [from, tomb] of tombs) if (now > tomb.until) tombs.delete(from);
  }, 250);

  const ep = {
    id,
    epoch,
    stats,
    hbText,
    tap: null,
    // Carry presence over from an earlier link of this player (a reconnect): those players count as here,
    // with the epochs already seen, until silenceMs passes without hearing them.
    seed(list) {
      for (const [from, e] of list) if (from !== id && !peers.has(from)) peers.set(from, newPeer(e));
    },
    addPath(path) {
      if (closed) {
        path.close?.();
        return;
      }
      paths.push(path);
      path.beatAt = monoNow();
      try {
        path.push(hb, hbText);
      } catch {
        /* Not open yet. */
      }
    },
    beatNow: beatAll,
    receive,
    receiveText,
    // Reliable, ordered: a game message (m) or a session message (y).
    send(m, to) {
      transmit(to ? { f: id, e: epoch, s: ++seq, to, m } : { f: id, e: epoch, s: ++seq, m });
    },
    sendSys(y, to) {
      transmit(to ? { f: id, e: epoch, s: ++seq, to, y } : { f: id, e: epoch, s: ++seq, y });
    },
    sendFast(k, d, to) {
      const n = (fastCount.get(k) || 0) + 1;
      fastCount.set(k, n);
      transmit(to ? { f: id, e: epoch, k, n, to, d } : { f: id, e: epoch, k, n, d });
    },
    has: (from) => peers.has(from),
    peerIds: () => [...peers.keys()],
    peerEpoch: (from) => peers.get(from)?.epoch ?? 0,
    forget,
    isDirect(from) {
      if (!peers.has(from)) return false;
      return paths.some((path) => path.isDirect?.(from));
    },
    directCount() {
      let n = 0;
      for (const from of peers.keys()) if (ep.isDirect(from)) n++;
      return n;
    },
    paths,
    close({ bye = true } = {}) {
      if (closed) return;
      if (bye) transmit({ f: id, e: epoch, t: '_bye' });
      closed = true;
      clearInterval(ticker);
      for (const p of peers.values()) clearTimeout(p.line.timer);
      peers.clear();
      for (const path of paths) {
        try {
          path.close?.();
        } catch {
          /* Closing anyway. */
        }
      }
    },
    get closed() {
      return closed;
    },
  };
  return ep;
}
