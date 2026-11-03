// Splinterhall rooms: the multiplayer session and lobby on top of the transport kit.
//
// Ported from Hoverline's createSession and lobby (mpConnect, mpSetReady, mpReconnect, mpBecameHost,
// mpPeerLeft). Why it exists: a link only says "someone is here" and carries messages. A game also needs one
// agreed list of who is in the room (the roster, with stable slots), one player whose word is final (the host),
// and one shared moment to start. Without those, two players can be connected and still never see each other.
//
//  - The creator is host. The host keeps the roster (join order, slot, name, colour, ready) and rebroadcasts it
//    every 3 s and whenever it changes; everyone else only ever adopts the host's roster.
//  - Slots 0..7 are given by the host in join order and never change while a player stays. A player who drops
//    out keeps their slot reserved for a minute, so a reconnect lands in the same slot.
//  - If the host leaves or goes silent for 12 s, the remaining player with the lowest slot becomes host. Every
//    device holds the same roster, so all agree. Each change of host raises the room's term; if two devices
//    ever both think they are host, the higher term wins, then the lower slot, and the other steps down.
//  - start(payload) is repeated (messages travel at most once per path, so one lost start would leave a
//    player stranded in the lobby) and deduplicated by match number; a player who missed every copy asks again
//    when the roster shows a match it isn't in yet.
//  - Ready: every player presses Ready; ready flags clear when the host goes back to the lobby. Pressing Ready
//    pings everyone who isn't ready ('nudge').
//
// Session messages ride in the envelope's y field, game messages in m (see endpoint.js).

import { NET, PARAMS, normaliseCode, roomCode, newId, monoNow, wallNow, shortText, CODE_RE } from './config.js';
import { createEndpoint } from './endpoint.js';
import { openLocal, openInternet, openRelay, relayAvailable, relayInfo } from './carriers.js';
import { openWifiHost, openWifiGuest } from './wifi.js';

export { normaliseCode, roomCode, relayAvailable, relayInfo };
export const MAX_PLAYERS = NET.maxPlayers;
export const CARRIERS = Object.freeze(['internet', 'wifi', 'relay', 'local']);

// Ids this page last used in each room: leaving and joining the same room again keeps the player's slot.
const lastIds = new Map();
let lastEpoch = 0;
const nextEpoch = () => (lastEpoch = Math.max(lastEpoch + 1, wallNow()));

const cleanColor = (c) =>
  typeof c === 'number' && Number.isFinite(c) ? c : typeof c === 'string' ? c.slice(0, 32) : null;
const cleanName = (n) => shortText(n, 24).trim() || 'Fighter';
const cleanMe = (me = {}) => ({ name: cleanName(me.name), color: cleanColor(me.color), ready: !!me.ready });

// A ?mp= parameter overrides the game's choice (tests).
async function pickCarrier(requested) {
  const forced = { local: 'local', internet: 'internet', net: 'internet', relay: 'relay', wifi: 'wifi' }[
    PARAMS.mp
  ];
  if (forced) return forced;
  if (CARRIERS.includes(requested)) return requested;
  // Not said: the Wi-Fi host pack when the page came from it, otherwise the internet.
  return (await relayAvailable()) ? 'relay' : 'internet';
}

class Room {
  constructor({ code, carrier, me, host, id, tune, on }) {
    this.code = code;
    this.carrier = carrier;
    this.myId = id;
    this._T = { ...NET, ...(tune || {}) };
    this._ls = new Map();
    for (const [event, fn] of Object.entries(on || {})) this.on(event, fn);
    this._me = cleanMe(me);
    this._isHost = !!host;
    this.hostId = host ? id : null;
    this._term = host ? 1 : 0;
    this._list = host ? [{ id, slot: 0, name: this._me.name, color: this._me.color, ready: this._me.ready }] : [];
    this._res = new Map(); // reserved slots: id -> { slot, until }
    this._info = {};
    this._infoText = '{}';
    this._phase = 'lobby';
    this._match = 0;
    this._lob = 0;
    this._field = [];
    this._startedMatch = 0;
    this._lastStart = null;
    this._state = 'connecting';
    this._rtt = null;
    this._timers = new Set();
    this._ep = null;
    this._link = null;
    this._rosterKey = '';
    this._statusKey = '';
    this._lastRosterIds = new Set(host ? [id] : []);
    this._askedStart = 0;
    this._joined = null;
    this._heyTimer = false;
  }

  // ---------- events ----------
  on(event, fn) {
    if (!this._ls.has(event)) this._ls.set(event, new Set());
    this._ls.get(event).add(fn);
    return this;
  }
  off(event, fn) {
    this._ls.get(event)?.delete(fn);
    return this;
  }
  _emit(event, ...args) {
    for (const fn of [...(this._ls.get(event) || [])]) {
      try {
        fn(...args);
      } catch (error) {
        console.error(`room '${event}' listener`, error);
      }
    }
  }

  // ---------- public state ----------
  get isHost() {
    return this._isHost;
  }
  get roster() {
    return [...this._list]
      .sort((a, b) => a.slot - b.slot)
      .map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        ready: !!e.ready,
        host: e.id === this.hostId,
        slot: e.slot,
        direct: this._directFor(e.id),
      }));
  }
  get info() {
    return this._info;
  }
  get me() {
    return { ...this._me };
  }
  get mySlot() {
    return this._list.find((e) => e.id === this.myId)?.slot ?? null;
  }
  // 'lobby' or 'match'; match counts the matches started in this room.
  get phase() {
    return this._phase;
  }
  get match() {
    return this._match;
  }
  get allReady() {
    return this._list.length > 0 && this._list.every((e) => e.ready);
  }
  // Round trip to the host in ms over the fastest path (null on the host, or before the first answer).
  get rtt() {
    return this._rtt;
  }
  get state() {
    return this._state;
  }
  get closed() {
    return this._state === 'closed';
  }

  quality() {
    const others = this._list.filter((e) => e.id !== this.myId);
    let quality = 'local';
    if (this.carrier === 'internet') {
      // A guest: its own link to the host (the one that carries its inputs and snapshots). The host: direct
      // only while every other player's link is.
      if (this._isHost)
        quality = others.length && others.every((e) => this._ep?.isDirect(e.id)) ? 'direct' : 'brokers';
      else quality = this.hostId && this._ep?.isDirect(this.hostId) ? 'direct' : 'brokers';
    }
    return {
      carrier: this.carrier,
      quality,
      directPeers: this._ep ? this._ep.directCount() : 0,
      brokersOpen: this._link ? this._link.brokersOpen() : 0,
      rtt: this._rtt,
    };
  }

  // True when that player's messages don't depend on the brokers. On the internet carrier: the direct WebRTC
  // path to them is up. On Wi-Fi (WebRTC to the host), the Wi-Fi host pack and local tabs there is no slower
  // path to fall back to, so it is true for everyone present.
  _directFor(id) {
    if (!this._ep) return false;
    if (this.carrier !== 'internet') return id === this.myId || this._ep.has(id);
    if (id !== this.myId) return this._ep.isDirect(id);
    // Your own entry: whether your link to the host is direct (on the host: to every other player).
    if (this._isHost) {
      const others = this._list.filter((e) => e.id !== this.myId);
      return others.length > 0 && others.every((e) => this._ep.isDirect(e.id));
    }
    return !!this.hostId && this._ep.isDirect(this.hostId);
  }

  // ---------- sending ----------
  send(msg, toId) {
    if (this._ep && !this.closed) this._ep.send(msg, toId || undefined);
  }
  sendFast(kind, data, toId) {
    kind = String(kind);
    if (!kind || kind.startsWith('_')) throw new Error("sendFast: kinds starting with '_' are the kit's own");
    if (this._ep && !this.closed) this._ep.sendFast(kind, data, toId || undefined);
  }
  _sys(y, to) {
    if (this._ep && !this.closed) this._ep.sendSys(y, to);
  }

  setMe(fields = {}) {
    const was = this._me.ready;
    if ('name' in fields) this._me.name = cleanName(fields.name);
    if ('color' in fields) this._me.color = cleanColor(fields.color);
    if ('ready' in fields) this._me.ready = !!fields.ready;
    if (this._isHost) {
      const e = this._list.find((x) => x.id === this.myId);
      if (e) Object.assign(e, { name: this._me.name, color: this._me.color, ready: this._me.ready });
      this._sendRoster();
      this._rosterChanged();
    } else this._sendHi();
    // Pressing Ready pings everyone who isn't ready yet.
    if (this._me.ready && !was) this._sys({ t: 'rdy' });
  }

  setInfo(obj) {
    if (!this._isHost) return false;
    const text = JSON.stringify(obj ?? {});
    this._info = JSON.parse(text);
    if (text !== this._infoText) {
      this._infoText = text;
      this._emit('info', this._info);
    }
    this._sendRoster();
    return true;
  }

  start(payload) {
    if (!this._isHost || this.closed) return false;
    const match = this._match + 1;
    const field = this._list.map((e) => e.id);
    const data = payload === undefined ? null : JSON.parse(JSON.stringify(payload));
    this._match = match;
    this._startedMatch = match;
    this._phase = 'match';
    this._field = field;
    this._lastStart = { match, payload: data, field };
    const msg = { t: 'start', match, field, payload: data };
    this._sys(msg);
    for (const ms of this._T.repeatMs)
      this._later(() => {
        if (this._isHost && this._phase === 'match' && this._match === match) this._sys(msg);
      }, ms);
    this._sendRoster();
    this._emit('start', data, { match, field: [...field] });
    return true;
  }

  backToLobby() {
    if (!this._isHost || this.closed) return false;
    const lob = this._lob + 1;
    this._lob = lob;
    this._phase = 'lobby';
    this._me.ready = false;
    for (const e of this._list) e.ready = false;
    const msg = { t: 'lobby', lob, match: this._match };
    this._sys(msg);
    for (const ms of this._T.repeatMs)
      this._later(() => {
        if (this._isHost && this._lob === lob) this._sys(msg);
      }, ms);
    this._sendRoster();
    this._emit('lobby', { match: this._match });
    this._rosterChanged();
    return true;
  }

  // The Wi-Fi host's pairing link ({ offer(), accept(text), guests, onChange(fn) }) for wifi-ui.js; null otherwise.
  get wifi() {
    return this.carrier === 'wifi' && this._link?.role === 'host' ? this._link : null;
  }

  // ---------- links ----------
  async _open({ seed, prev } = {}) {
    const epoch = nextEpoch();
    const ep = createEndpoint({
      id: this.myId,
      epoch,
      tune: this._T,
      handlers: {
        onPeer: (from) => this._onPeer(from),
        onLeave: (from) => this._onLeave(from),
        onMessage: (env, from) => this._onEnvelope(env, from),
        onFast: (kind, data, from) => this._onFast(kind, data, from),
      },
    });
    if (seed) ep.seed(seed);
    this._ep = ep;
    const onError = (text) => {
      if (this._ep === ep) this._emit('error', text);
    };
    let link;
    if (this.carrier === 'local') link = openLocal(ep, this.code);
    else if (this.carrier === 'relay') link = openRelay(ep, this.code, { onError });
    else if (this.carrier === 'wifi')
      // A reconnect keeps the Wi-Fi connections (there is no server to find each other again through).
      link =
        prev?.role === 'host' || (!prev && this._isHost)
          ? openWifiHost(ep, this.code, prev)
          : openWifiGuest(ep, this.code, {
              prev,
              onClosed: (text) => {
                if (this._ep !== ep || this.closed) return;
                this._emit('error', text);
                this._close(false);
              },
            });
    else link = openInternet(ep, this.code, { onError });
    this._link = link;
    if (link.error) throw new Error(link.error);
    return link;
  }

  _startTimers() {
    this._every(() => {
      if (this._isHost) this._sendRoster();
    }, this._T.rosterMs);
    this._every(() => {
      if (!this._isHost && this._state === 'connecting') this._sendHi();
    }, this._T.helloMs);
    this._every(() => {
      if (!this._isHost && this.hostId && this._ep) this._ep.sendFast('_p', wallNow(), this.hostId);
    }, this._T.pingMs);
    this._every(() => this._poll(), 500);
  }

  _every(fn, ms) {
    const t = setInterval(() => {
      if (!this.closed) fn();
    }, ms);
    this._timers.add({ t, i: true });
  }
  _later(fn, ms) {
    const rec = { i: false };
    rec.t = setTimeout(() => {
      this._timers.delete(rec);
      if (!this.closed) fn();
    }, ms);
    this._timers.add(rec);
  }

  // Close this link and open a new one into the same room, with the same player id (so the same slot).
  // A guest stays a guest. A host stays host if nobody took over meanwhile; if the others already chose a new
  // host (this device was silent for 12 s), the newer host's term wins and this device rejoins as a guest.
  async reconnect() {
    if (this.closed) return false;
    const old = this._ep;
    const seed = old ? old.peerIds().map((id) => [id, old.peerEpoch(id)]) : [];
    const prev = this.carrier === 'wifi' ? this._link : null;
    if (prev?.role === 'guest' && prev.guest?.ch?.readyState !== 'open') {
      this._emit('error', 'The Wi-Fi link to the host closed. Leave, then scan the host’s code again.');
      return false;
    }
    old?.close({ bye: false });
    if (!prev) this._link?.close();
    try {
      await this._open({ seed, prev });
    } catch (error) {
      this._emit('error', String(error.message || error));
      return false;
    }
    if (this._isHost) this._sendRoster();
    else this._sendHi();
    this._poll();
    return true;
  }

  leave() {
    this._close(true);
  }

  _close(bye) {
    if (this.closed) return;
    this._state = 'closed';
    lastIds.set(this.code, this.myId);
    for (const rec of this._timers) (rec.i ? clearInterval : clearTimeout)(rec.t);
    this._timers.clear();
    try {
      this._ep?.close({ bye });
      this._link?.close();
    } catch (error) {
      console.error('room close', error);
    }
    this._joined?.reject(new Error('Left the room.'));
    this._emit('closed');
  }

  // ---------- roster ----------
  _present(id) {
    return id === this.myId || !!this._ep?.has(id);
  }

  _freeSlot() {
    const now = monoNow();
    for (const [id, r] of this._res) if (r.until < now) this._res.delete(id);
    const used = new Set(this._list.map((e) => e.slot));
    const held = new Set([...this._res.values()].map((r) => r.slot));
    for (let s = 0; s < this._T.maxPlayers; s++) if (!used.has(s) && !held.has(s)) return s;
    // Every free slot is held for someone who dropped out: give away the oldest hold.
    let oldest = null;
    for (const [id, r] of this._res) if (!used.has(r.slot) && (!oldest || r.until < oldest[1].until)) oldest = [id, r];
    if (oldest) {
      this._res.delete(oldest[0]);
      return oldest[1].slot;
    }
    return -1;
  }

  _reserve(id, slot) {
    if (slot == null || slot < 0) return;
    this._res.set(id, { slot, until: monoNow() + 60000 });
  }

  _sendRoster() {
    if (!this._isHost || !this._ep) return;
    // Anyone not heard from is out (the endpoint decides who is here).
    const gone = this._list.filter((e) => !this._present(e.id));
    if (gone.length) {
      for (const e of gone) this._reserve(e.id, e.slot);
      this._list = this._list.filter((e) => this._present(e.id));
      this._rosterChanged();
    }
    const now = monoNow();
    const res = [];
    for (const [id, r] of this._res) if (r.until > now) res.push([id, r.slot, Math.round(r.until - now)]);
    this._sys({
      t: 'roster',
      term: this._term,
      list: this._list.map((e) => [e.id, e.slot, e.name, e.color, e.ready ? 1 : 0]),
      res,
      info: this._info,
      phase: this._phase,
      match: this._match,
      lob: this._lob,
      field: this._phase === 'match' ? this._field : [],
      max: this._T.maxPlayers,
    });
  }

  _sendHi() {
    if (this._isHost || !this._ep) return;
    this._sys({
      t: 'hi',
      name: this._me.name,
      color: this._me.color,
      ready: this._me.ready ? 1 : 0,
      lob: this._lob,
    });
  }

  // Emits 'roster' when anything a game would draw changed, and 'peerLeft' for each player who dropped off.
  _rosterChanged() {
    const now = new Set(this._list.map((e) => e.id));
    for (const id of this._lastRosterIds) if (!now.has(id) && id !== this.myId) this._emit('peerLeft', id);
    this._lastRosterIds = now;
    const roster = this.roster;
    const key = JSON.stringify(roster.map((e) => [e.id, e.slot, e.name, e.color, e.ready, e.host, e.direct]));
    if (key !== this._rosterKey) {
      this._rosterKey = key;
      this._emit('roster', roster);
    }
  }

  _poll() {
    if (this.closed) return;
    this._rosterChanged();
    const q = this.quality();
    const key = `${q.carrier}|${q.quality}|${q.directPeers}|${q.brokersOpen}`;
    if (key !== this._statusKey) {
      this._statusKey = key;
      this._emit('status', q);
    }
  }

  _beats(termA, slotA, idA, termB, slotB, idB) {
    if (termA !== termB) return termA > termB;
    if ((slotA ?? 99) !== (slotB ?? 99)) return (slotA ?? 99) < (slotB ?? 99);
    return idA < idB;
  }

  _becomeHost(goneId) {
    const wasHost = this._isHost;
    this._isHost = true;
    this.hostId = this.myId;
    // The departed host's slot is held like anyone else's.
    const gone = this._list.find((e) => e.id === goneId);
    if (gone) this._reserve(gone.id, gone.slot);
    if (!this._list.some((e) => e.id === this.myId))
      this._list.push({ id: this.myId, slot: this._freeSlot(), ...this._me });
    this._list = this._list.filter((e) => this._present(e.id));
    for (const e of this._list) if (e.id === this.myId) Object.assign(e, { ready: this._me.ready });
    if (this._state === 'connecting') this._state = 'in';
    this._sendRoster();
    if (!wasHost) this._emit('host', true);
    this._rosterChanged();
  }

  // The host left: everyone picks the present player with the lowest slot in the last roster.
  _elect(goneId) {
    if (this._state !== 'in') return;
    const candidates = this._list
      .filter((e) => e.id !== goneId && this._present(e.id))
      .sort((a, b) => a.slot - b.slot);
    this._term += 1;
    const next = candidates[0];
    if (!next || next.id === this.myId) {
      this._becomeHost(goneId);
      return;
    }
    this.hostId = next.id;
    this._list = this._list.filter((e) => e.id !== goneId);
    this._emit('host', false);
    this._rosterChanged();
    this._sendHi();
  }

  // ---------- receiving ----------
  _onPeer(from) {
    if (this._isHost) this._sendRoster();
    else if (this._state === 'connecting' || from === this.hostId) this._sendHi();
    else this._hey();
  }

  // A receiver holds the first reliable message it gets from a sender for firstContactMs (400 ms), so a slower
  // path can fill in anything earlier (endpoint.js). When a new player appears, everyone says something
  // reliable at once (the host its roster, a guest a 'hey'), so that hold is spent in the lobby, not on the
  // first message of a match. Several arrivals together share one 'hey'.
  _hey() {
    if (this._heyTimer || this._state !== 'in') return;
    this._heyTimer = true;
    this._later(() => {
      this._heyTimer = false;
      this._sys({ t: 'hey' });
    }, 150);
  }

  _onLeave(from) {
    if (this.closed) return;
    if (this._isHost) {
      const e = this._list.find((x) => x.id === from);
      if (e) {
        this._reserve(e.id, e.slot);
        this._list = this._list.filter((x) => x.id !== from);
        this._sendRoster();
        this._rosterChanged();
      }
    } else if (from === this.hostId) this._elect(from);
  }

  _onFast(kind, data, from) {
    if (kind === '_p') {
      // Ping from a guest: answer with its own time.
      if (this._isHost) this._ep.sendFast('_q', data, from);
      return;
    }
    if (kind === '_q') {
      if (from === this.hostId && typeof data === 'number') this._rtt = Math.max(0, wallNow() - data);
      return;
    }
    this._emit('fast', kind, data, from);
  }

  _onEnvelope(env, from) {
    if (env.y !== undefined) return this._onSys(env.y, from);
    if (env.m !== undefined) this._emit('message', env.m, from);
  }

  _onSys(y, from) {
    if (!y || typeof y !== 'object' || typeof y.t !== 'string') return;
    switch (y.t) {
      case 'hi':
        return this._onHi(y, from);
      case 'roster':
        return this._onRoster(y, from);
      case 'full':
        if (this._state === 'connecting') {
          this._state = 'full';
          this._fail(`That room is full (${this._T.maxPlayers} players).`);
        }
        return;
      case 'start':
        if (from !== this.hostId || !(y.match > this._startedMatch)) return;
        this._startedMatch = y.match;
        this._match = y.match;
        this._phase = 'match';
        this._field = Array.isArray(y.field) ? y.field : [];
        if (this._field.includes(this.myId)) this._emit('start', y.payload, { match: y.match, field: [...this._field] });
        return;
      case 'need':
        // A player missed every copy of the start: send it to them again.
        if (this._isHost && this._lastStart && this._phase === 'match' && this._lastStart.field.includes(from))
          this._sys({ t: 'start', ...this._lastStart }, from);
        return;
      case 'lobby':
        if (from === this.hostId) this._toLobby(y.lob);
        return;
      case 'rdy':
        if (!this._me.ready && this._state === 'in') this._emit('nudge', from);
        return;
    }
  }

  _toLobby(lob) {
    if (!(lob > this._lob)) return;
    this._lob = lob;
    this._phase = 'lobby';
    const was = this._me.ready;
    this._me.ready = false;
    if (this._state !== 'in') return;
    this._emit('lobby', { match: this._match });
    if (was) this._sendHi();
  }

  _onHi(y, from) {
    if (!this._isHost) return;
    let e = this._list.find((x) => x.id === from);
    // A ready flag from before the last return to the lobby doesn't count.
    const ready = !!y.ready && y.lob === this._lob;
    if (!e) {
      if (this._list.length >= this._T.maxPlayers) {
        this._sys({ t: 'full' }, from);
        return;
      }
      const held = this._res.get(from);
      const slot = held && !this._list.some((x) => x.slot === held.slot) ? held.slot : this._freeSlot();
      this._res.delete(from);
      if (slot < 0) {
        this._sys({ t: 'full' }, from);
        return;
      }
      e = { id: from, slot, name: cleanName(y.name), color: cleanColor(y.color), ready };
      this._list.push(e);
    } else {
      e.name = cleanName(y.name);
      e.color = cleanColor(y.color);
      e.ready = ready;
    }
    this._sendRoster();
    this._rosterChanged();
  }

  _onRoster(y, from) {
    const list = Array.isArray(y.list) ? y.list : [];
    const term = Number(y.term) || 0;
    const theirSlot = list.find((r) => r[0] === from)?.[1];
    let steppedDown = false;
    if (this._isHost) {
      if (from === this.myId) return;
      const mySlot = this.mySlot;
      // Two hosts (this device was silent long enough for the others to choose a new one, or two devices
      // disagreed about who was present): the newer term wins, then the lower slot. The other steps down.
      if (!this._beats(term, theirSlot, from, this._term, mySlot, this.myId)) {
        this._sendRoster();
        return;
      }
      this._isHost = false;
      steppedDown = true;
    } else if (this.hostId && from !== this.hostId) {
      const hostSlot = this._list.find((e) => e.id === this.hostId)?.slot;
      const better = this._beats(term, theirSlot, from, this._term, hostSlot, this.hostId);
      if (!better && this._present(this.hostId)) return;
      if (term < this._term) return; // an old host's roster, still in flight
    } else if (this.hostId && term < this._term) return;
    const hostChanged = this.hostId !== from;
    this.hostId = from;
    this._term = term;
    this._list = list
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
      .map((r) => ({ id: r[0], slot: r[1] | 0, name: cleanName(r[2]), color: cleanColor(r[3]), ready: !!r[4] }));
    // Held slots travel with the roster, so a new host still keeps them.
    this._res = new Map();
    const now = monoNow();
    for (const r of Array.isArray(y.res) ? y.res : []) this._res.set(r[0], { slot: r[1], until: now + (r[2] || 0) });
    const infoText = JSON.stringify(y.info ?? {});
    const infoChanged = infoText !== this._infoText;
    this._infoText = infoText;
    this._info = JSON.parse(infoText);
    const joining = this._state === 'connecting';
    const inList = this._list.some((e) => e.id === this.myId);
    if (joining) {
      // Adopt the room as it is without replaying its history as events.
      this._lob = y.lob | 0;
      this._match = y.match | 0;
      this._phase = y.phase === 'match' ? 'match' : 'lobby';
      this._field = Array.isArray(y.field) ? y.field : [];
      if (!inList) {
        this._sendHi();
        return;
      }
      if (!this._startedMatch) this._startedMatch = this._field.includes(this.myId) ? 0 : this._match;
      this._state = 'in';
      this._lastRosterIds = new Set(this._list.map((e) => e.id));
      this._rosterKey = '';
      this._joined?.resolve(this);
      this._joined = null;
    } else {
      if (y.lob > this._lob) this._toLobby(y.lob);
      this._match = Math.max(this._match, y.match | 0);
      if (y.phase === 'lobby' && this._phase === 'match' && !(y.lob > this._lob)) this._phase = 'lobby';
      if (!inList) this._sendHi(); // the host dropped this device (it was silent): ask back in
    }
    // A match this device should be in but never got the start of: ask the host for it.
    if (y.phase === 'match' && y.match > this._startedMatch && Array.isArray(y.field) && y.field.includes(this.myId)) {
      if (monoNow() - this._askedStart > 900) {
        this._askedStart = monoNow();
        this._sys({ t: 'need', match: y.match }, from);
      }
    }
    if ((hostChanged || steppedDown) && !joining) this._emit('host', false);
    if (infoChanged && !joining) this._emit('info', this._info);
    this._rosterChanged();
  }

  // A join that can't complete: the 'error' event (for listeners passed in `on`), and joinRoom rejects with the
  // same text.
  _fail(text) {
    this._emit('error', text);
    if (this._joined) {
      this._joined.reject(new Error(text));
      this._joined = null;
    }
    this._close(false);
  }
}

// ---------- creating and joining ----------

// options: carrier ('internet' | 'wifi' | 'relay' | 'local'; omitted: the Wi-Fi host pack when the page came
// from it, else internet), me ({ name, color, ready }), on ({ event: fn } listeners attached before anything
// happens). Tests may also pass code, id and tune (timings, see NET in config.js).
export async function createRoom({ carrier, me, on, code, id, tune } = {}) {
  carrier = await pickCarrier(carrier);
  code = normaliseCode(code) || roomCode();
  const room = new Room({ code, carrier, me, host: true, id: id || newId(), tune, on });
  const link = await room._open();
  room._state = 'in';
  room._startTimers();
  // Nothing reachable yet: open anyway after a moment, so the lobby shows the room code (it keeps trying).
  await Promise.race([link.opened, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (!room.closed) {
    room._sendRoster();
    room._poll();
  }
  return room;
}

// Resolves once the host has given this device a slot. Rejects with a clear message when the room doesn't
// answer within a few seconds, is full, or the carrier can't be reached.
export async function joinRoom(code, { carrier, me, on, id, tune } = {}) {
  code = normaliseCode(code);
  if (!CODE_RE.test(code) && !/^[A-Z0-9]{4,8}$/.test(code))
    throw new Error('Room codes have 5 letters and numbers.');
  carrier = await pickCarrier(carrier);
  const room = new Room({ code, carrier, me, host: false, id: id || lastIds.get(code) || newId(), tune, on });
  const joined = new Promise((resolve, reject) => (room._joined = { resolve, reject }));
  joined.catch(() => {});
  let link;
  try {
    link = await room._open();
  } catch (error) {
    room._close(false);
    throw error;
  }
  room._startTimers();
  room._sendHi();
  const T = room._T;
  // The carrier must open within openTimeoutMs, then a host must answer within joinTimeoutMs.
  const openTimer = setTimeout(() => {
    if (room._state === 'connecting')
      room._fail(
        carrier === 'internet'
          ? 'The internet relays could not be reached. Check this device is online, then try again.'
          : 'The connection could not be opened.',
      );
  }, T.openTimeoutMs);
  link.opened.then((ok) => {
    clearTimeout(openTimer);
    if (!ok || room._state !== 'connecting') return;
    room._sendHi();
    setTimeout(() => {
      if (room._state === 'connecting')
        room._fail(`No host answered for room ${code}. Check the code, or create a room.`);
    }, T.joinTimeoutMs);
  });
  try {
    return await joined;
  } finally {
    clearTimeout(openTimer);
  }
}
