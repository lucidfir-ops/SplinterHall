// Multiplayer screens and message routing on top of the room layer (Hoverline's transport).
import { createRoom, joinRoom, mountWifiPairing } from '../net/hookup.js';
import { FIGHTER_COLORS, MAX_FIGHTERS } from '../core/consts.js';
import { escapeHtml } from '../ui/hud.js';
import { resetPacking } from '../net/protocol.js';
import { Bot } from '../ai/bot.js';

export class Net {
  constructor(app) {
    this.app = app;
    this.room = null;
    this.carrier = 'internet';
    this.joinText = '';
  }

  get available() { return !!createRoom; }

  screen() {
    const app = this.app;
    if (this.room) return this.lobby();
    app.menus.open('mp', () => ({
      kicker: 'Multiplayer', title: 'Rooms',
      items: [
        { label: 'Create room', n: '01', disabled: !this.available, onOk: () => this.create() },
        { label: 'Join by code', n: '02', disabled: !this.available, onOk: () => this.joinScreen() },
        { label: 'Wi-Fi, no internet', n: '03', disabled: !this.available || !mountWifiPairing, onOk: () => this.wifiScreen() },
        { type: 'html', html: `<div class="sh-mono" style="color:var(--dim)">Up to 8 fighters, each on their own device. Same Wi-Fi plays tightest; over the internet the fight can lag a little. ${this.available ? '' : '<br>Multiplayer is not in this build.'}</div>` },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => app.menus.back() },
      ],
    }));
  }

  joinScreen() {
    const app = this.app;
    app.menus.open('mp-join', () => ({
      kicker: 'Multiplayer', title: 'Join',
      items: [
        { type: 'input', label: 'Room code', value: this.joinText, maxlength: 8, placeholder: 'ABCDE', onInput: (v) => { this.joinText = v; }, onEnter: (v) => this.join(v) },
        { label: 'Join', primary: true, onOk: () => this.join(this.joinText) },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => app.menus.back() },
      ],
    }));
  }

  wifiScreen() {
    const app = this.app;
    app.menus.open('mp-wifi', () => ({
      kicker: 'Wi-Fi, no internet', title: 'Pair',
      items: [
        { label: 'Host here', n: '01', onOk: () => this.create('wifi') },
        { label: 'Join a host', n: '02', onOk: () => this.wifiPair('guest', null) },
        { type: 'html', html: '<div class="sh-mono" style="color:var(--dim)">Phones pair by swapping QR codes once each way. The host relays the fight, no internet needed.</div>' },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => app.menus.back() },
      ],
    }));
  }

  wifiPair(role, room) {
    const app = this.app;
    // The pairing panel covers the screen (it needs the room on a landscape phone) and is mounted once, so a
    // menu refresh never throws away a code in progress; each render just re-attaches it.
    const holder = document.createElement('div');
    holder.className = 'sh-pairhold';
    let pairing = null;
    app.menus.open('mp-pair', () => ({
      kicker: 'Wi-Fi, no internet', title: role === 'host' ? 'Add a fighter' : 'Join',
      items: [{ type: 'spacer' }, { label: 'Back', small: true, onOk: () => app.menus.back() }],
      // Back while the panel is up goes through the panel's own Back (it cancels a half-made link), which
      // calls onCancel / onDone below, and those come back here with pairing cleared.
      onBack: () => { if (pairing) { pairing.back(); return false; } holder.remove(); return true; },
      after: (scr) => {
        scr.appendChild(holder);
        if (pairing) return;
        pairing = mountWifiPairing(holder, {
          role, room, me: this.me(),
          onDone: (r) => {
            pairing = null;
            app.menus.back();
            if (role === 'guest' && r) { this.attach(r); this.lobby(); } // a host comes back to its lobby
          },
          onCancel: () => { pairing = null; app.menus.back(); },
        });
      },
    }));
  }

  me() { return { name: this.app.settings.name || 'Player', color: this.app.settings.color }; }

  async create(carrier) {
    try {
      this.app.note('Opening a room…', 1.5);
      const room = await createRoom({ carrier, me: this.me() });
      this.attach(room);
      if (room.isHost) room.setInfo({ opts: this.app.matchOpts });
      this.lobby();
    } catch (e) { this.app.note(String(e.message || e), 3); }
  }

  async join(code) {
    try {
      this.app.note('Joining…', 1.5);
      const room = await joinRoom(code, { me: this.me() }); // carrier: the Wi-Fi host pack's relay when served from it, else the internet
      this.attach(room);
      this.lobby();
    } catch (e) { this.app.note(String(e.message || e), 3); }
  }

  attach(room) {
    this.room = room;
    room.on('roster', () => {
      if (this.app.menus.cur?.id === 'lobby') this.app.menus.refresh();
      this.peersChanged();
      // The host starts the moment the last player is ready, whoever pressed Ready last.
      if (room.isHost && room.phase === 'lobby' && !(this.app.match && this.app.match.net)) this.tryStart();
    });
    room.on('info', () => { if (this.app.menus.cur?.id === 'lobby') this.app.menus.refresh(); });
    room.on('start', (p) => this.onStart(p));
    room.on('message', (m, from) => this.onMessage(m, from));
    room.on('fast', (kind, data, from) => this.onFast(kind, data, from));
    room.on('host', (isHost) => this.onHost(isHost));
    room.on('peerLeft', (id) => this.onPeerLeft(id));
    room.on('lobby', () => this.onLobby());
    room.on('nudge', () => this.app.audio.sfx('ui_ready', { vol: 0.9 }));
    room.on('error', (t) => this.app.note(t, 3));
    room.on('closed', () => {
      const inMatch = this.app.match && this.app.match.net;
      this.room = null;
      if (inMatch) { this.app.endMatch(); this.app.startAttract().then(() => { this.app.titleScreen(); this.screen(); }); }
      else if (/^(lobby|mp)/.test(this.app.menus.cur?.id || '')) this.screen();
    });
  }

  // The host went back to the lobby (Rematch, or a new host after a drop): everyone follows.
  onLobby() {
    const m = this.app.match;
    if (m && m.net) this.toLobby();
    else if (this.app.menus.cur?.id === 'lobby') this.app.menus.refresh();
  }

  // The lobby: room code, 8 slabs, Ready, the host's options.
  lobby() {
    const app = this.app, room = this.room;
    if (!room) return this.screen();
    app.setAccent('bunker');
    const o = app.matchOpts;
    app.menus.open('lobby', () => {
      const roster = room.roster;
      const me = roster.find((r) => r.id === room.myId);
      const ready = !!(me && me.ready);
      const host = room.isHost;
      const info = room.info?.opts || o;
      const humans = roster.length;
      const bots = Math.min(info.bots ?? 0, MAX_FIGHTERS - humans);
      const slabs = [];
      for (let k = 0; k < MAX_FIGHTERS; k++) {
        const r = roster[k];
        if (r) {
          const col = FIGHTER_COLORS[r.color ?? k] || FIGHTER_COLORS[k];
          slabs.push(`<div class="sh-slot${r.ready ? ' ready' : ''}"><div class="bar" style="background:${col.hex}"></div><div class="nm" style="color:${r.ready ? '' : col.hex}">${escapeHtml(r.name)}</div><div class="st">${r.host ? 'HOST · ' : ''}${r.ready ? 'READY' : 'WAITING'}${r.direct === false && r.id !== room.myId ? ' · LAG' : ''}</div></div>`);
        } else if (k < humans + bots) slabs.push('<div class="sh-slot"><div class="nm" style="color:var(--dim)">AI</div><div class="st">FILLS IN</div></div>');
        else slabs.push('<div class="sh-slot" style="opacity:.35"><div class="st">OPEN</div></div>');
      }
      const q = room.quality ? room.quality() : {};
      return {
        kicker: 'Room · ' + (room.carrier === 'relay' ? 'Wi-Fi host' : room.carrier === 'wifi' ? 'Wi-Fi' : q.quality === 'direct' ? 'direct' : q.quality === 'local' ? 'this device' : 'via brokers'), title: room.code || 'Wi-Fi', wide: true,
        items: [
          { type: 'html', html: `<div class="sh-roster">${slabs.join('')}</div>` },
          { type: 'row', items: [
            { label: ready ? 'Not ready' : 'Ready', primary: !ready, onOk: () => { room.setMe({ ready: !ready }); setTimeout(() => this.tryStart(), 50); } },
            ...(host ? [{ label: 'Start now', small: true, disabled: roster.length < 1, onOk: () => this.tryStart(true) }] : []),
            ...(room.carrier === 'wifi' && host ? [{ label: 'Add phone', small: true, onOk: () => this.wifiPair('host', room) }] : []),
            { label: 'Options', small: true, onOk: () => app.optionsScreen() },
            { label: 'Leave', small: true, onOk: () => { this.leave(); app.menus.back(); } },
          ] },
          ...(host ? app.matchOptionItems(o, () => room.setInfo({ opts: o })) : [{ type: 'html', html: `<div class="sh-mono" style="color:var(--dim)">The host sets the match: first to ${info.roundsToWin} · AI ${bots} · items ${info.items}.</div>` }]),
          ...(host ? [{ label: 'Levels', small: true, value: app.playlistLabel(), onOk: () => app.levelsScreen() }] : []),
        ],
        onBack: () => { this.leave(); return true; },
      };
    });
  }

  // The host starts when everyone is ready (or on Start now).
  tryStart(force = false) {
    const room = this.room;
    if (!room || !room.isHost || room.phase !== 'lobby') return;
    const roster = room.roster;
    if (!force && (!roster.length || !roster.every((r) => r.ready))) return;
    const o = this.app.matchOpts;
    // Colours: everyone keeps theirs if free, else the next free one. AI fills the rest.
    const used = new Set();
    const fighters = [];
    for (const r of roster) {
      let c = r.color ?? 0;
      while (used.has(c)) c = (c + 1) % MAX_FIGHTERS;
      used.add(c);
      fighters.push({ slot: c, name: r.name, ai: false, peer: r.id });
    }
    const bots = Math.min(o.bots, MAX_FIGHTERS - fighters.length);
    for (let k = 0, c = 0; k < bots; k++) {
      while (used.has(c)) c++;
      used.add(c);
      fighters.push({ slot: c, name: FIGHTER_COLORS[c].name, ai: true, skill: o.aiSkill });
    }
    const seed = Math.random().toString(36).slice(2, 10);
    room.start({ fighters, opts: { ...o, seed }, seed });
  }

  async onStart(p) {
    const app = this.app, room = this.room;
    resetPacking();
    const roster = p.fighters.map((f) => ({ ...f, local: f.peer === room.myId }));
    this.slotOf = new Map(p.fighters.filter((f) => f.peer).map((f) => [f.peer, f.slot]));
    await app.beginMatch(roster, { ...p.opts, seed: p.seed }, { room, host: room.isHost });
    if (!room.isHost) app.hudReal.show(true);
  }

  onMessage(m, from) {
    const match = this.app.match;
    if (!match || !match.net) return;
    if (m.t === 'round' && !match.isHost) match.clientRound(m);
    else if (m.t === 'ev' && !match.isHost) match.onEvents(m.e);
  }

  onFast(kind, data, from) {
    const match = this.app.match;
    if (!match || !match.net) return;
    if (kind === 'snap' && !match.isHost) match.onSnap(data);
    else if (kind === 'in' && match.isHost && this.slotOf) {
      const slot = this.slotOf.get(from);
      if (slot !== undefined) match.setRemoteInput(slot, data);
    }
  }

  onHost(isHost) {
    const app = this.app;
    if (isHost && app.match && app.match.net && !app.match.isHost) {
      app.note('The host left · you host now · back to the lobby', 3);
      // Sends everyone (and this device, through 'lobby') back to the lobby.
      if (!this.room.backToLobby()) this.toLobby();
    } else if (app.menus.cur?.id === 'lobby') app.menus.refresh();
  }

  onPeerLeft(id) {
    const match = this.app.match;
    if (!match || !match.isHost || !match.sim || !this.slotOf) return;
    const slot = this.slotOf.get(id);
    if (slot === undefined) return;
    // An AI takes over the fighter of someone who left.
    match.remoteInputs.delete(slot);
    match.bots.push(new Bot(match.sim, slot, 1, 'left'));
    const r = match.roster.find((q) => q.slot === slot);
    if (r) { r.ai = true; r.peer = null; }
    this.slotOf.delete(id);
    this.app.note((r?.name || 'A fighter') + ' left · AI takes over', 2.5);
  }

  peersChanged() {}

  rematch() {
    if (!this.room) return;
    // The host's backToLobby emits 'lobby' here too, which runs toLobby.
    if (!this.room.isHost || !this.room.backToLobby()) this.toLobby();
  }

  toLobby() {
    const app = this.app;
    app.endMatch();
    if (this.room) this.room.setMe({ ready: false });
    app.menus.close();
    app.startAttract().then(() => { app.titleScreen(); this.lobby(); });
  }

  reconnect() { if (this.room && this.room.reconnect) this.room.reconnect(); }

  leave() {
    if (this.room) { try { this.room.leave(); } catch { /* gone */ } }
    this.room = null;
  }
}
