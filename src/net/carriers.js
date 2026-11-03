// The carriers behind one room link. Each adds one or more paths to an endpoint (endpoint.js):
//  internet — two public MQTT brokers over secure WebSocket (batched), plus, where the network allows, a direct
//             WebRTC channel to each player (direct.js, immediate). Every message goes over all of them and the
//             endpoint drops the copies. The broker path works where WebRTC alone fails (no TURN server, NAT
//             without hairpinning, hidden mDNS addresses), as on October 25.
//  relay    — the Wi-Fi host pack's /mp/ endpoint (same Wi-Fi, no internet needed): server-sent events down,
//             posts up. Compatible with Hoverline's wifi-host.py run with GAME_RELAY_NAME=splinterhall.
//  local    — BroadcastChannel, tabs on one device (tests, ?mp=local).
//  wifi     — WebRTC data channels paired by QR codes, the host relays (wifi.js).
// A path is { push(env, text), beatMs, isDirect(playerId), close() }.

import { APP_ID, RELAY_NAME, NET, PARAMS, brokerUrls, monoNow } from './config.js';
import { connectMqtt } from './mqtt.js';
import { BatchQueue } from './endpoint.js';
import { createDirectPath, directAvailable } from './direct.js';

// ---------- local: BroadcastChannel ----------
export function openLocal(ep, code) {
  const channel = new BroadcastChannel(`${APP_ID}-${code}`);
  channel.onmessage = ({ data }) => {
    if (typeof data === 'string') ep.receiveText(data, 'local');
  };
  ep.addPath({
    name: 'local',
    beatMs: NET.heartbeatMs,
    // The text, not the object: every carrier then carries exactly the same JSON, so data that isn't JSON-safe
    // fails in the two-tab tests too, not only online.
    push: (_env, text) => channel.postMessage(text),
    isDirect: () => false,
    close: () => channel.close(),
  });
  return { carrier: 'local', opened: Promise.resolve(true), brokersOpen: () => 0, directOn: false, close() {} };
}

// ---------- internet: MQTT brokers (+ direct WebRTC) ----------
function brokerPath(ep, topic, { urls, onOpen, onAllFailed }) {
  const clients = new Set();
  const queue = new BatchQueue();
  let closed = false;
  let failures = 0;
  const timers = new Set();
  // Broker traffic is batched: at most one publish per broker every batchMs, carrying everything queued since.
  // Public brokers cap each client's publish rate (broker.emqx.io dropped a third of 15 messages a second on
  // October 25). Only the newest fast message of each kind waits in the queue. The gap is measured from the
  // last publish (a plain 125 ms interval timer fires early now and then, which made 9 in some seconds), and
  // after a quiet spell the next message goes out at once instead of waiting for a tick.
  let lastPublish = -Infinity;
  let timer = null;
  const sentAt = []; // the last 64 publish times (diagnostics: tests check the gap)
  const flush = () => {
    timer = null;
    if (closed || !queue.size) return;
    const open = [...clients].filter((c) => c.open);
    if (!open.length) {
      // Nothing open: keep the reliable backlog (bounded) for when a broker comes back.
      if (queue.size > 600) queue.items.splice(0, queue.size - 600);
      schedule(NET.batchMs);
      return;
    }
    const now = monoNow();
    if (now - lastPublish < NET.batchMs) return schedule(NET.batchMs - (now - lastPublish));
    lastPublish = now;
    sentAt.push(now);
    if (sentAt.length > 64) sentAt.shift();
    const batch = queue.take(NET.maxBatchBytes);
    for (const client of open)
      // A slow socket skips a batch of snapshots (the next one replaces it), never a reliable message.
      if (!(batch.fastOnly && client.backlog > NET.backlogBytes)) client.publish(topic, batch.text);
    if (queue.size) schedule(NET.batchMs);
  };
  const schedule = (ms) => {
    if (!timer && !closed) timer = setTimeout(flush, Math.max(0, ms));
  };
  // Messages queued in the same moment (a snapshot and its events) still share one publish.
  const kick = () => schedule(Math.max(0, NET.batchMs - (monoNow() - lastPublish)));
  // Each link has its own MQTT client id: a broker drops an older connection that reuses one.
  const clientBase = `sh1-${ep.id}-${ep.epoch.toString(36).slice(-6)}`;
  function join(url, index, attempt = 0) {
    if (closed) return;
    let client = null;
    connectMqtt(url, {
      clientId: `${clientBase}${index}`,
      // Public brokers sometimes take several seconds to accept.
      timeout: 10000,
      // The broker announces an unexpected drop to the room. It is marked as a will: with two brokers, one
      // dropping us doesn't mean we've gone, so the others only forget us if no other path hears from us soon.
      will: { topic, payload: JSON.stringify({ f: ep.id, e: ep.epoch, t: '_bye', w: 1 }) },
      onMessage: (_topic, text) => ep.receiveText(text, 'broker'),
      onClose: () => {
        if (closed) return;
        clients.delete(client);
        retry(url, index, 0);
      },
    }).then(
      (c) => {
        if (closed) return c.close();
        client = c;
        clients.add(c);
        c.subscribe(topic);
        c.publish(topic, ep.hbText);
        onOpen();
      },
      () => {
        failures++;
        if (failures >= urls.length && !clients.size) onAllFailed();
        retry(url, index, attempt + 1);
      },
    );
  }
  const retry = (url, index, attempt) => {
    const t = setTimeout(() => {
      timers.delete(t);
      join(url, index, attempt);
    }, NET.reconnectMs[Math.min(attempt, NET.reconnectMs.length - 1)]);
    timers.add(t);
  };
  urls.forEach((url, i) => join(url, i));
  return {
    name: 'broker',
    beatMs: NET.heartbeatMs,
    push(env, text) {
      queue.push(env, text);
      kick();
    },
    isDirect: () => false,
    get open() {
      return [...clients].filter((c) => c.open).length;
    },
    sentAt,
    close() {
      if (closed) return;
      // The goodbye (queued by the endpoint just before) goes out before the sockets close, ignoring the gap
      // this once.
      for (let b; (b = queue.take(NET.maxBatchBytes)); ) for (const c of clients) if (c.open) c.publish(topic, b.text);
      closed = true;
      clearTimeout(timer);
      for (const t of timers) clearTimeout(t);
      for (const c of clients) c.close();
      clients.clear();
      queue.clear();
    },
  };
}

export function openInternet(ep, code, { onError, direct = PARAMS.direct } = {}) {
  const topic = `${APP_ID}/${code}`;
  const urls = brokerUrls();
  let resolveOpen;
  const opened = new Promise((resolve) => (resolveOpen = resolve));
  const unreachable = 'The internet relays could not be reached. Check this device is online, then Reconnect.';
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    onError?.(unreachable);
  };
  const brokers = brokerPath(ep, topic, {
    urls,
    onOpen: () => resolveOpen(true),
    onAllFailed: () => {},
  });
  ep.addPath(brokers);
  let directPath = null;
  if (direct && directAvailable()) {
    try {
      directPath = createDirectPath(ep, code, urls);
      ep.addPath(directPath);
    } catch (error) {
      console.warn('net: no direct path', error);
    }
  }
  // Nothing reachable after a while: say so (the room keeps trying in the background).
  const warning = setTimeout(() => {
    if (!brokers.open && !ep.peerIds().length) warn();
  }, NET.openTimeoutMs);
  return {
    carrier: 'internet',
    opened,
    directOn: !!directPath,
    brokersOpen: () => brokers.open,
    close() {
      clearTimeout(warning);
      resolveOpen(false);
    },
  };
}

// ---------- relay: the Wi-Fi host pack ----------
// Wi-Fi addresses the local server reported, for the host to read out.
export const relayInfo = { lan: [] };

export async function relayAvailable(fetcher = globalThis.fetch, timeout = 900) {
  // The Wi-Fi server is plain http; an https page (itch.io) cannot use it.
  if (!fetcher || globalThis.location?.protocol !== 'http:') return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  try {
    const response = await fetcher('./mp/ping', { signal: abort.signal, cache: 'no-store' });
    const data = response.ok ? await response.json() : {};
    relayInfo.lan = Array.isArray(data.lan) ? data.lan.map(String) : [];
    return data.relay === RELAY_NAME;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function openRelay(ep, code, { onError, base = './mp' } = {}) {
  const url = `${base}/${code}`;
  const queue = new BatchQueue();
  let open = false;
  let closed = false;
  let inFlight = false;
  let resolveOpen;
  const opened = new Promise((resolve) => (resolveOpen = resolve));
  const source = new EventSource(`${url}/events?id=${ep.id}`);
  source.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.t === '_hello') {
      open = true;
      resolveOpen(true);
      flush();
    } else if (data.t === '_leave') {
      // The server noticed a closed tab within a second: no need to wait for the silence.
      if (typeof data.id === 'string') ep.forget(data.id);
    } else if (data.t === '_m') {
      const m = data.m;
      if (Array.isArray(m)) for (const env of m) ep.receive(env, 'relay');
      else ep.receive(m, 'relay');
    }
  };
  source.onerror = () => {
    // EventSource reconnects by itself; only say something when it never got in.
    if (!open && !closed) onError?.('The Wi-Fi host is unavailable or the room is full.');
    open = false;
  };
  // Ordered delivery: one post at a time, each carrying everything queued since the last one (only the newest
  // fast message of each kind), so a slow post never builds a backlog.
  function flush() {
    if (closed || inFlight || !open || !queue.size) return;
    const batch = queue.take(NET.maxBatchBytes);
    inFlight = true;
    fetch(`${url}/send?id=${ep.id}`, {
      method: 'POST',
      body: batch.text,
      headers: { 'Content-Type': 'application/json' },
      keepalive: batch.text.length < 60000,
    })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (queue.size) setTimeout(flush, 0);
      });
  }
  const timer = setInterval(flush, 33);
  ep.addPath({
    name: 'relay',
    beatMs: NET.heartbeatMs,
    push(env, text) {
      queue.push(env, text);
      if (!inFlight) flush();
    },
    isDirect: () => false,
    close() {
      // The goodbye goes out even while another post is on its way (keepalive lets it outlive the page).
      const last = open && queue.take(NET.maxBatchBytes);
      if (last)
        fetch(`${url}/send?id=${ep.id}`, {
          method: 'POST',
          body: last.text,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
      closed = true;
      clearInterval(timer);
      // Closing the stream at once would make the relay announce the departure before the goodbye lands; it
      // says the same thing, so either order is fine, but give the post a moment.
      setTimeout(() => source.close(), 200);
    },
  });
  return {
    carrier: 'relay',
    opened,
    directOn: false,
    brokersOpen: () => (open ? 1 : 0),
    close() {
      resolveOpen(false);
    },
  };
}

export { directAvailable };
