// The direct WebRTC path for the internet carrier (new in Splinterhall; Hoverline left it out).
//
// Trystero (MIT) finds the other players and sets up a WebRTC data channel to each. Its signalling runs over
// MQTT on the same public brokers as the room itself: a Trystero topic strategy driven by this kit's own MQTT
// client (mqtt.js), the same thing as Trystero's @trystero-p2p/mqtt strategy without the 300 KB mqtt.js
// library. The signalling connections are separate MQTT clients from the room's, so Trystero's offers and
// answers never count against the room's publish-rate cap (see NET.batchMs).
//
// Every envelope goes over this path as well as the brokers; the endpoint drops whichever copy comes second.
//  - Reliable messages and heartbeats go through Trystero's own channel (ordered, reliable).
//  - Fast messages (inputs, snapshots) go through a second channel on the same connection, unordered with no
//    retransmits, so one lost packet never holds up the next snapshot. Both ends open it with a fixed id
//    (negotiated), which needs no new offer and answer. Until it works they go through Trystero's channel.
//  - A heartbeat every half second on both channels shows each side that the path is up (isDirect).
//
// Trickle ICE is off: one offer and one answer per pair of players, each carrying all its candidates, so
// connecting eight players sends a few dozen signalling messages rather than a few hundred (public brokers cap
// publish rates). With STUN reachable that costs about 150 ms; where STUN is blocked the direct path comes up
// up to 15 s late, and the brokers carry the game meanwhile.

import { createTopicStrategy } from '@trystero-p2p/core';
import { APP_ID, NET, PARAMS, monoNow } from './config.js';
import { connectMqtt } from './mqtt.js';
import { stubText } from './endpoint.js';

const FAST_CHANNEL_ID = 100;
const fastChannels = new WeakMap(); // RTCPeerConnection -> its fast channel (a physical connection can outlive a room)

export const directAvailable = () =>
  typeof globalThis.RTCPeerConnection === 'function' && !!globalThis.crypto?.subtle;

// One MQTT connection for Trystero's signalling, reconnecting by itself. Topics stay subscribed and the last
// announcement is published again after a reconnect, as Trystero's own MQTT strategy does.
function signalRelay(url) {
  const handlers = new Map();
  const announcements = new Map();
  let client = null;
  let closed = false;
  let attempt = 0;
  let timer = null;
  let resolveReady;
  const ready = new Promise((resolve) => (resolveReady = resolve));
  const relay = {
    url,
    get open() {
      return !!client?.open;
    },
    subscribe(topic, fn) {
      handlers.set(topic, fn);
      if (client?.open) client.subscribe(topic);
    },
    unsubscribe(topic) {
      handlers.delete(topic);
      announcements.delete(topic);
      if (client?.open) client.unsubscribe(topic);
    },
    publish(topic, text, announce) {
      if (announce) announcements.set(topic, text);
      if (client?.open) client.publish(topic, text);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      client?.close();
      client = null;
    },
  };
  const connect = () => {
    if (closed) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => (n % 36).toString(36)).join('');
    connectMqtt(url, {
      clientId: `sh1s-${id}`,
      timeout: 10000,
      onMessage: (topic, text) => handlers.get(topic)?.(topic, text),
      onClose: () => {
        client = null;
        if (!closed) timer = setTimeout(connect, NET.reconnectMs[0]);
      },
    }).then(
      (c) => {
        if (closed) return c.close();
        client = c;
        attempt = 0;
        for (const topic of handlers.keys()) c.subscribe(topic);
        for (const [topic, text] of announcements) c.publish(topic, text);
        resolveReady(relay);
      },
      () => {
        timer = setTimeout(connect, NET.reconnectMs[Math.min(attempt++, NET.reconnectMs.length - 1)]);
      },
    );
  };
  connect();
  return { relay, ready };
}

// A Trystero joinRoom of its own for each path: its relays (MQTT sockets) belong to this path and close with it.
function makeJoinRoom(urls, relays) {
  return createTopicStrategy({
    init: () =>
      urls.map((url) => {
        const { relay, ready } = signalRelay(url);
        relays.push(relay);
        return ready;
      }),
    subscribeTopic: (relay, topic, onMessage) => {
      relay.subscribe(topic, (t, text) => void onMessage(t, text));
      return () => relay.unsubscribe(topic);
    },
    publishTopic: (relay, topic, msg, { kind }) => {
      relay.publish(topic, typeof msg === 'string' ? msg : JSON.stringify(msg), kind === 'announce');
    },
    unpublishTopic: () => {},
  });
}

export function createDirectPath(ep, code, urls) {
  const relays = [];
  const joinRoom = makeJoinRoom(urls, relays);
  const config = {
    appId: APP_ID,
    trickleIce: false,
    maxReceiveBytes: 4 * 1024 * 1024,
    relayConfig: { manualReconnection: true, warnOnRelayFailure: false },
    // ?ice=none: host candidates only, for tests on one machine with no route to a STUN server.
    ...(PARAMS.iceNone ? { rtcConfig: { iceServers: [] } } : {}),
  };
  const room = joinRoom(config, code, {
    onJoinError: (details) => console.warn('net: direct path', details?.error || details),
  });
  const action = room.makeAction('e');
  const tpeers = new Map(); // Trystero peer id -> { pc, fast, player, last, lastFast }
  const heard = new Map(); // player id -> time last heard on this path
  let closed = false;

  const sendAction = (text, target) => action.send(text, target ? { target } : undefined).catch(() => {});

  function attachFast(tid, tp) {
    const pc = tp.pc;
    if (!pc || pc.connectionState === 'closed') return;
    let ch = fastChannels.get(pc);
    if (!ch || ch.readyState === 'closed' || ch.readyState === 'closing') {
      try {
        ch = pc.createDataChannel('shf', {
          negotiated: true,
          id: FAST_CHANNEL_ID,
          ordered: false,
          maxRetransmits: 0,
        });
        fastChannels.set(pc, ch);
      } catch (error) {
        console.warn('net: no fast channel', error);
        return;
      }
    }
    ch.binaryType = 'arraybuffer';
    ch.onmessage = (event) => {
      if (closed || typeof event.data !== 'string') return;
      tp.lastFast = monoNow();
      path.fastReceived++;
      receive(tid, event.data);
    };
    tp.fast = ch;
  }

  function receive(tid, text) {
    const tp = tpeers.get(tid);
    if (tp) tp.last = monoNow();
    // Note who is at the other end, from the envelopes themselves.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const first = Array.isArray(data) ? data[0] : data;
    if (first && typeof first.f === 'string') {
      if (tp) tp.player = first.f;
      heard.set(first.f, monoNow());
    }
    if (Array.isArray(data)) for (const env of data) ep.receive(env, 'direct');
    else ep.receive(data, 'direct');
  }

  action.onMessage = (data, context) => {
    if (closed || typeof data !== 'string') return;
    receive(context.peerId, data);
  };
  room.onPeerJoin = (tid) => {
    if (closed) return;
    const pc = room.getPeers()[tid] || null;
    const tp = { pc, fast: null, player: null, last: monoNow(), lastFast: 0 };
    tpeers.set(tid, tp);
    attachFast(tid, tp);
    // Say who we are straight away, on both channels.
    const hb = ep.hbText;
    sendAction(hb, tid);
    if (tp.fast?.readyState === 'open') tp.fast.send(hb);
  };
  room.onPeerLeave = (tid) => {
    const tp = tpeers.get(tid);
    tpeers.delete(tid);
    if (tp?.player) heard.delete(tp.player);
  };

  const toTargets = (to) => {
    if (!to) return [...tpeers.keys()];
    for (const [tid, tp] of tpeers) if (tp.player === to) return [tid];
    return [];
  };

  const path = {
    name: 'direct',
    beatMs: NET.directBeatMs,
    push(env, text) {
      if (closed || !tpeers.size) return;
      const targets = toTargets(env.to);
      if (env.k !== undefined) {
        // Fast: the unordered channel where it is open, else Trystero's.
        for (const tid of targets) {
          const tp = tpeers.get(tid);
          const ch = tp?.fast;
          if (ch && ch.readyState === 'open' && ch.bufferedAmount < 256 * 1024) {
            try {
              ch.send(text);
              continue;
            } catch {
              /* Fall back below. */
            }
          }
          sendAction(text, tid);
        }
        return;
      }
      if (env.to && env.s !== undefined) {
        // Addressed and reliable: the message to its player, a stub (its sequence number) to the rest.
        let stub = null;
        for (const tid of tpeers.keys()) {
          if (targets.includes(tid)) sendAction(text, tid);
          else sendAction((stub ??= stubText(env)), tid);
        }
      } else if (env.to) for (const tid of targets) sendAction(text, tid);
      else sendAction(text);
      if (env.t === '_hb')
        for (const tid of targets) {
          const ch = tpeers.get(tid)?.fast;
          if (ch && ch.readyState === 'open') {
            try {
              ch.send(text);
            } catch {
              /* Next beat. */
            }
          }
        }
    },
    isDirect(player) {
      const t = heard.get(player);
      return t !== undefined && monoNow() - t < NET.directFreshMs;
    },
    get peers() {
      return tpeers.size;
    },
    // Diagnostics: connections whose unordered fast channel is open, and fast messages received on one.
    get fastOpen() {
      let n = 0;
      for (const tp of tpeers.values()) if (tp.fast?.readyState === 'open') n++;
      return n;
    },
    fastReceived: 0,
    close() {
      if (closed) return;
      closed = true;
      for (const tp of tpeers.values()) if (tp.fast) tp.fast.onmessage = null;
      tpeers.clear();
      heard.clear();
      room
        .leave()
        .catch(() => {})
        .finally(() => {
          for (const relay of relays) relay.close();
        });
    },
  };
  return path;
}
