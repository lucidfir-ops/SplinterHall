// Wi-Fi with no internet (carrier 'wifi'), from Hoverline's LAN (Prototype 31).
//
// Phones, tablets and computers on one Wi-Fi play each other directly over WebRTC data channels, with no server
// at all, so it works from itch.io, an offline file, anywhere. With no server the two ends swap their
// connection details by hand, once each way: the host shows a code (a QR code, or text), a player scans it and
// shows a reply code, the host scans that, and they are connected. The host relays everything (a star), so the
// host must stay in the room: if the host leaves, the room ends for everyone (the guests can't hear each other).
//
// A code carries the room, a tag naming the host's offer, the ICE username and password, the DTLS fingerprint
// and the device's local addresses; everything else in the session description is the same for every
// connection, so it is rebuilt from a template at the other end. No ICE servers: host candidates only.
//
// Lessons kept from Hoverline:
//  - With the camera allowed, the browser puts this device's real Wi-Fi address in the codes (otherwise a
//    private mDNS name that some networks can't look up), and the host needs the camera to scan replies
//    anyway, so the host asks for the camera before making its first code (wifi-ui.js does this).
//  - A few host codes stay valid at once, so a player who scanned an older one can still be added.
//
// New in Splinterhall: each connection has a second, unordered channel with no retransmits (negotiated, fixed
// id) for fast messages, so one lost Wi-Fi packet never holds up the next snapshot.

import { NET } from './config.js';
import { stubText } from './endpoint.js';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_PREFIX = 'SH';
const CODE_VERSION = 1;
const FAST_CHANNEL_ID = 100;
const FAST_OPTS = { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 };

export const wifiAvailable = () => typeof globalThis.RTCPeerConnection === 'function';

const b32 = (bytes) => {
  let o = '';
  let v = 0;
  let n = 0;
  for (const b of bytes) {
    v = ((v << 8) | b) & 0xffff;
    n += 8;
    while (n >= 5) {
      o += B32[(v >>> (n - 5)) & 31];
      n -= 5;
    }
  }
  if (n) o += B32[(v << (5 - n)) & 31];
  return o;
};

const unb32 = (t) => {
  const o = [];
  let v = 0;
  let n = 0;
  for (const c of t.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')) {
    const k = B32.indexOf(c);
    if (k < 0) continue;
    v = ((v << 5) | k) & 0xffff;
    n += 5;
    if (n >= 8) {
      o.push((v >>> (n - 8)) & 255);
      n -= 8;
    }
  }
  return o;
};

const uuidRe = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

// The parts of a session description that differ between connections.
export function fromSdp(sdp) {
  const g = (re) => (sdp.match(re) || [])[1] || '';
  const o = { uf: g(/a=ice-ufrag:(\S+)/), pw: g(/a=ice-pwd:(\S+)/), fp: g(/a=fingerprint:sha-256 (\S+)/i), cands: [] };
  for (const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gi)) {
    const a = m[1];
    const port = +m[2];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(a) || uuidRe.test(a)) if (!o.cands.some((c) => c.a === a)) o.cands.push({ a, port });
  }
  // Real addresses first: an mDNS name only when that is all there is.
  o.cands.sort((x, y) => (uuidRe.test(x.a) ? 1 : 0) - (uuidRe.test(y.a) ? 1 : 0));
  o.cands = o.cands.slice(0, 2);
  return o;
}

export function toSdp(o, setup) {
  return [
    'v=0',
    `o=- ${1e9 + Math.floor(Math.random() * 1e9)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...o.cands.map((c, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i * 256} ${c.a} ${c.port} typ host generation 0`),
    `a=ice-ufrag:${o.uf}`,
    `a=ice-pwd:${o.pw}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${o.fp}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}

// A code: SH, then base 32 of [version, kind (0 host, 1 reply), room (5 letters), tag (2 bytes), ufrag,
// password, fingerprint (32 bytes), addresses (4 bytes, or an mDNS name's 16, and a port)]. Base 32 keeps it to
// QR's alphanumeric characters, so its QR code is small.
export function pack(o) {
  const B = [CODE_VERSION, o.kind];
  const str = (t) => {
    const e = [...new TextEncoder().encode(t)];
    B.push(e.length, ...e);
  };
  for (const c of o.code.padEnd(5, '?').slice(0, 5)) B.push(c.charCodeAt(0));
  B.push((o.tag >> 8) & 255, o.tag & 255);
  str(o.uf);
  str(o.pw);
  const fp = o.fp.split(':').map((h) => parseInt(h, 16));
  if (fp.length !== 32 || fp.some((x) => !(x >= 0))) throw new Error('This browser gave an unusual connection fingerprint.');
  B.push(...fp);
  B.push(o.cands.length);
  for (const c of o.cands) {
    const u = uuidRe.exec(c.a);
    if (u) {
      B.push(16);
      const hx = u.slice(1).join('');
      for (let i = 0; i < 32; i += 2) B.push(parseInt(hx.substr(i, 2), 16));
    } else B.push(4, ...c.a.split('.').map(Number));
    B.push((c.port >> 8) & 255, c.port & 255);
  }
  return CODE_PREFIX + b32(B);
}

export function unpack(text) {
  const t = String(text || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (!t.startsWith(CODE_PREFIX)) return null;
  const B = unb32(t.slice(CODE_PREFIX.length));
  let i = 0;
  const rd = () => {
    if (i >= B.length) throw new Error('short');
    return B[i++];
  };
  try {
    if (rd() !== CODE_VERSION) return null;
    const o = { kind: rd(), code: '', cands: [] };
    for (let k = 0; k < 5; k++) o.code += String.fromCharCode(rd());
    o.code = o.code.replace(/\?/g, '');
    o.tag = (rd() << 8) | rd();
    const str = () => {
      const n = rd();
      const e = [];
      for (let k = 0; k < n; k++) e.push(rd());
      return new TextDecoder().decode(new Uint8Array(e));
    };
    o.uf = str();
    o.pw = str();
    const fp = [];
    for (let k = 0; k < 32; k++) fp.push(rd().toString(16).toUpperCase().padStart(2, '0'));
    o.fp = fp.join(':');
    const nc = rd();
    for (let k = 0; k < nc; k++) {
      const ty = rd();
      let a;
      if (ty === 16) {
        let h = '';
        for (let q = 0; q < 16; q++) h += rd().toString(16).padStart(2, '0');
        a = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
      } else {
        const q = [];
        for (let z = 0; z < 4; z++) q.push(rd());
        a = q.join('.');
      }
      o.cands.push({ a, port: (rd() << 8) | rd() });
    }
    return o;
  } catch {
    return null;
  }
}

// Spaces every five characters, for reading out or typing.
export const spaced = (code) => String(code || '').replace(/(.{5})/g, '$1 ').trim();

const gather = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });

const safeSend = (ch, text) => {
  if (ch && ch.readyState === 'open') {
    try {
      ch.send(text);
      return true;
    } catch {
      /* Closing. */
    }
  }
  return false;
};

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Close a connection, letting what is queued (a goodbye) go out first: a channel's close() sends what it has,
// but closing the peer connection at once would drop it.
function closeSoon(c) {
  try {
    c.ch?.close();
    c.fast?.close();
  } catch {
    /* Already closing. */
  }
  setTimeout(() => {
    try {
      c.pc.close();
    } catch {
      /* Already closed. */
    }
  }, 300);
}

// ---------- host ----------
// The host's link: every guest's envelopes go to the host's endpoint and on to the other guests; the host's own
// go to every guest. A message addressed to one player goes to that player only, with a stub (its sequence
// number) to the rest. Passing the previous link (a reconnect) keeps every guest's connection.
export function openWifiHost(ep, code, prev = null) {
  const H = prev?.host || {
    code,
    guests: new Map(), // player id -> conn
    conns: new Set(), // every open connection, including ones whose player isn't known yet
    pending: new Map(), // tag -> { pc }
    listeners: new Set(),
    ep: null,
  };
  H.ep = ep;
  const changed = (what, id) => {
    for (const fn of [...H.listeners]) {
      try {
        fn(what, id);
      } catch (error) {
        console.error(error);
      }
    }
  };

  function forward(env, text, fromConn) {
    for (const c of H.conns) {
      if (c === fromConn) continue;
      if (env.to && env.to !== c.player) {
        if (env.s !== undefined) safeSend(c.ch, stubText(env));
        continue;
      }
      if (env.k !== undefined) {
        if (!safeSend(c.fast, text)) safeSend(c.ch, text);
      } else safeSend(c.ch, text);
    }
  }

  function wire(c) {
    const onText = (text) => {
      const ep = H.ep;
      if (!ep || ep.closed || typeof text !== 'string') return;
      const env = parse(text);
      if (!env || typeof env.f !== 'string') return;
      if (!c.player) {
        c.player = env.f;
        const old = H.guests.get(c.player);
        if (old && old !== c) dropConn(old, false);
        H.guests.set(c.player, c);
        changed('joined', c.player);
      }
      if (env.f !== c.player) return; // a guest speaks only for itself
      ep.receive(env, 'wifi');
      if (env.to === ep.id) return; // for the host only
      forward(env, text, c);
    };
    c.ch.onmessage = (e) => onText(e.data);
    c.fast.onmessage = (e) => onText(e.data);
    c.ch.onclose = () => dropConn(c, true);
    c.pc.addEventListener('connectionstatechange', () => {
      if (c.pc.connectionState === 'failed' || c.pc.connectionState === 'closed') dropConn(c, true);
    });
  }

  function dropConn(c, tell) {
    if (!H.conns.has(c)) return;
    H.conns.delete(c);
    closeSoon(c);
    if (!c.player || H.guests.get(c.player) !== c) return;
    H.guests.delete(c.player);
    const ep = H.ep;
    if (tell && ep && !ep.closed) {
      // Tell the other guests at once, in the departed guest's name (they can't hear it themselves).
      const bye = { f: c.player, e: ep.peerEpoch(c.player), t: '_bye' };
      forward(bye, JSON.stringify(bye), null);
      ep.forget(c.player);
    }
    changed('left', c.player);
  }

  // A fresh code for the next player (a few stay valid at once).
  async function offer() {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const ch = pc.createDataChannel('sh', { ordered: true });
    const fast = pc.createDataChannel('shf', FAST_OPTS);
    const tag = crypto.getRandomValues(new Uint16Array(1))[0];
    const c = { pc, ch, fast, player: null, tag };
    ch.onopen = () => {
      H.pending.delete(tag);
      H.conns.add(c);
      wire(c);
      // Say who we are at once, so the guest's join needn't wait for a heartbeat.
      if (H.ep && !H.ep.closed) safeSend(ch, H.ep.hbText);
      changed('open', null);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gather(pc);
    const o = fromSdp(pc.localDescription.sdp);
    if (!o.cands.length) {
      pc.close();
      throw new Error('This device has no Wi-Fi address to offer. Check Wi-Fi is on.');
    }
    H.pending.set(tag, { pc, c });
    for (const [k, p] of H.pending)
      if (H.pending.size > 4 && k !== tag) {
        try {
          p.pc.close();
        } catch {
          /* Gone. */
        }
        H.pending.delete(k);
      }
    return pack({ ...o, kind: 0, code: H.code, tag });
  }

  // The reply a player shows after scanning a code.
  async function accept(text) {
    const o = unpack(text);
    if (!o) throw new Error("That isn't a Splinterhall Wi-Fi code.");
    if (o.kind !== 1) throw new Error("That is a host code: scan the reply on the player's screen instead.");
    if (o.code !== H.code) throw new Error(`That reply is for room ${o.code}.`);
    const p = H.pending.get(o.tag);
    if (!p) throw new Error('That reply is for an old code. Ask the player to scan the code on screen now.');
    if (p.pc.signalingState !== 'have-local-offer') throw new Error('That reply was already used.');
    await p.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(o, 'active') });
  }

  ep.addPath({
    name: 'wifi',
    beatMs: NET.heartbeatMs,
    push: (env, text) => forward(env, text, null),
    isDirect: () => false,
    close() {},
  });

  const link = {
    carrier: 'wifi',
    role: 'host',
    host: H,
    opened: Promise.resolve(true),
    directOn: false,
    brokersOpen: () => 0,
    offer,
    accept,
    get guests() {
      return H.guests.size;
    },
    onChange(fn) {
      H.listeners.add(fn);
      return () => H.listeners.delete(fn);
    },
    close() {
      for (const c of [...H.conns]) dropConn(c, false);
      for (const p of H.pending.values()) {
        try {
          p.pc.close();
        } catch {
          /* Gone. */
        }
      }
      H.pending.clear();
      H.listeners.clear();
      H.ep = null;
    },
  };
  return link;
}

// ---------- guest ----------
// The connection made by answering a host's code, waiting for joinRoom(code, { carrier: 'wifi' }).
let pendingGuest = null;

// Answer a host's code (scanned or typed). Resolves with { reply, code, open }: show reply to the host; open
// resolves once the link to the host is up, then join the room with joinRoom(code, { carrier: 'wifi' }).
export async function wifiAnswer(text) {
  const o = unpack(text);
  if (!o) throw new Error("That isn't a Splinterhall Wi-Fi code.");
  if (o.kind !== 0) throw new Error("That is a reply code: scan the code on the host's screen.");
  if (pendingGuest && !pendingGuest.claimed) wifiCancel();
  const pc = new RTCPeerConnection({ iceServers: [] });
  const fast = pc.createDataChannel('shf', FAST_OPTS);
  const g = { pc, ch: null, fast, code: o.code, claimed: false };
  g.open = new Promise((resolve, reject) => {
    pc.ondatachannel = (e) => {
      if (e.channel.label !== 'sh') return;
      g.ch = e.channel;
      g.ch.onopen = () => resolve(g.code);
      // Messages that arrive before the room is joined (the host's first heartbeat) are kept for it.
      g.early = [];
      g.ch.onmessage = (ev) => g.early.push(ev.data);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed')
        reject(new Error('The connection to the host failed. Check both are on the same Wi-Fi, then scan again.'));
    };
  });
  g.open.catch(() => {});
  await pc.setRemoteDescription({ type: 'offer', sdp: toSdp(o, 'actpass') });
  await pc.setLocalDescription(await pc.createAnswer());
  await gather(pc);
  const mine = fromSdp(pc.localDescription.sdp);
  if (!mine.cands.length) {
    pc.close();
    throw new Error('This device has no Wi-Fi address to offer. Check Wi-Fi is on.');
  }
  pendingGuest = g;
  return { reply: pack({ ...mine, kind: 1, code: o.code, tag: o.tag }), code: o.code, open: g.open };
}

// Drop a half-made pairing (the guest pressed Cancel).
export function wifiCancel() {
  const g = pendingGuest;
  pendingGuest = null;
  if (g && !g.claimed) {
    try {
      g.pc.close();
    } catch {
      /* Gone. */
    }
  }
}

export function openWifiGuest(ep, code, { onClosed, prev = null } = {}) {
  const g = prev?.guest || (pendingGuest && pendingGuest.code === code ? pendingGuest : null);
  if (!g || !g.ch || g.ch.readyState !== 'open')
    return { error: 'Not connected to a Wi-Fi host. Scan the host’s code first.' };
  g.claimed = true;
  if (pendingGuest === g) pendingGuest = null;
  let closed = false;
  const onText = (e) => {
    if (!closed && typeof e.data === 'string') ep.receiveText(e.data, 'wifi');
  };
  g.ch.onmessage = onText;
  g.fast.onmessage = onText;
  g.ch.onclose = () => {
    if (!closed) onClosed?.('The Wi-Fi link to the host closed. The room ends when the host leaves.');
  };
  for (const text of g.early || []) ep.receiveText(text, 'wifi');
  g.early = [];
  ep.addPath({
    name: 'wifi',
    beatMs: NET.heartbeatMs,
    push(env, text) {
      if (closed) return;
      if (env.k !== undefined && safeSend(g.fast, text)) return;
      safeSend(g.ch, text);
    },
    isDirect: () => false,
    close() {
      // The endpoint is going (leave, or a reconnect): the connection itself stays until the link closes.
      closed = true;
    },
  });
  return {
    carrier: 'wifi',
    role: 'guest',
    guest: g,
    opened: Promise.resolve(true),
    directOn: false,
    brokersOpen: () => 0,
    close() {
      closed = true;
      closeSoon(g);
    },
  };
}
