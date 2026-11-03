// A match: rounds of last fighter standing. The host runs the simulation; everyone draws frames.
import { STEP, SETTINGS, ITEM_SETS, MAX_FIGHTERS } from '../core/consts.js';
import { randomCode } from '../core/codes.js';
import { makeRng } from '../core/rng.js';
import { buildLevel } from '../level/generate.js';
import { Sim } from '../sim/sim.js';
import { Bot } from '../ai/bot.js';
import { packFrame, unpackFrame } from '../net/protocol.js';

export const DEFAULT_OPTIONS = {
  roundsToWin: 5,
  items: 'all',
  dropRate: 'normal',      // few | normal | lots
  aiSkill: 1,
  ragnarok: true,
  playlist: { mode: 'random', settings: SETTINGS.slice(), codes: [] },
};

const DROP = { few: [10, 14], normal: [6, 9], lots: [3, 5], none: [1e9, 1e9] };

export class Match {
  // roster: [{ slot, name, ai, skill, local, peer }], opts: match options, net: { room, host } or null
  constructor(app, roster, opts = {}, net = null) {
    this.app = app;
    this.R = app.R;
    this.view = app.view;
    this.roster = roster;
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.net = net;
    this.isHost = !net || net.host;
    this.seed = opts.seed || Math.random().toString(36).slice(2, 10);
    this.rng = makeRng('match/' + this.seed);
    this.scores = new Array(MAX_FIGHTERS).fill(0);
    this.kills = new Array(MAX_FIGHTERS).fill(0);
    this.round = 0;
    this.state = 'loading';
    this.sim = null;
    this.bots = [];
    this.acc = 0;
    this.tick = 0;
    this.renderTick = 0;
    this.localSlot = roster.find((r) => r.local)?.slot ?? -1;
    this.remoteInputs = new Map();
    this.codes = [];
    this.paused = false;
    this.tensionT = 0;
    this.sendT = 0;
    this.eventsOut = [];
    this.lastSnap = performance.now();
    this.snapRate = 20;
  }

  nextCode() {
    const p = this.opts.playlist;
    if (p.mode === 'fixed' && p.codes.length) return p.codes[0];
    if (p.mode === 'list' && p.codes.length) return p.codes[this.round % p.codes.length];
    const settings = p.settings && p.settings.length ? p.settings : SETTINGS;
    return randomCode(settings[Math.floor(this.rng.next() * settings.length)], this.rng.next);
  }

  async startRound(code) {
    this.state = 'loading';
    this.round++;
    code = code || this.nextCode();
    this.code = code;
    const level = this.opts.level ? { ...this.opts.level, grid: this.opts.level.grid.slice() } : buildLevel(code);
    this.level = level;
    if (this.sim) this.sim.destroy();
    this.sim = null;
    if (this.isHost) {
      this.sim = new Sim(this.R, level, this.roster, {
        round: this.round, matchSeed: this.seed, ragnarok: this.opts.ragnarok,
        kinds: ITEM_SETS[this.opts.items] || ITEM_SETS.all, dropEvery: DROP[this.opts.dropRate] || DROP.normal,
        slowmo: this.app.settings.slowmo !== false, practice: !!this.opts.practice,
      });
      this.bots = this.roster.filter((r) => r.ai).map((r) => new Bot(this.sim, r.slot, r.skill ?? this.opts.aiSkill, this.seed + this.round));
    }
    await this.view.setLevel(level);
    this.view.localSlot = this.localSlot;
    this.acc = 0;
    this.tick = 0;
    this.renderTick = 0;
    this.state = 'round';
    if (this.isHost) {
      this.view.pushFrame(this.sim.frame(), this.sim.drainEvents());
      if (this.net) this.net.room.send({ t: 'round', code, round: this.round, scores: this.scores });
    }
    this.app.hud.roundStart(this.round, code, this.scores, this.roster);
    if (this.music) this.music.roundStart();
  }

  // Client: a new round from the host.
  async clientRound(msg) {
    this.round = msg.round - 1;
    if (msg.scores) this.scores = msg.scores;
    this.serverTick = 0;
    await this.startRound(msg.code);
  }

  localInput() {
    if (this.sim) { const me = this.sim.fighters[this.localSlot]; this.app.input.holding = !!(me && me.item); }
    else { const fr = this.view.frames[this.view.frames.length - 1]; const me = fr && fr.fighters.find((f) => f.slot === this.localSlot); this.app.input.holding = !!(me && me.item); }
    return this.app.input.read();
  }

  // The music only follows real matches, not the menu's background brawl.
  get music() { return this.isAttract ? null : this.app.music; }

  update(dt) {
    if (this.state !== 'round' || this.paused && !this.net) return;
    if (this.isHost) this.hostUpdate(dt);
    else this.clientUpdate(dt);
  }

  hostUpdate(dt) {
    const sim = this.sim;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    const localIn = this.localSlot >= 0 ? this.localInput() : null;
    if (this.net && localIn) this.lastLocalIn = localIn;
    while (this.acc >= STEP && steps < 4) {
      this.acc -= STEP;
      steps++;
      const inputs = [];
      if (localIn && this.localSlot >= 0) inputs[this.localSlot] = localIn;
      for (const [slot, inp] of this.remoteInputs) inputs[slot] = inp;
      for (const b of this.bots) inputs[b.slot] = b.update(STEP * sim.timeScale);
      sim.step(inputs);
      this.tick = sim.tick;
      const events = sim.drainEvents();
      const frame = sim.frame();
      this.view.pushFrame(frame, events);
      this.react(events);
      if (this.net) this.eventsOut.push(...events.map((e) => ({ ...e, _k: sim.tick })));
      if (sim.phase === 'end') { this.endRound(sim.winner); return; }
    }
    // Snapshots to the room.
    if (this.net) {
      const now = performance.now();
      if (now - this.lastSnap >= 1000 / this.snapRate) {
        this.lastSnap = now;
        const frame = sim.frame();
        this.net.room.sendFast('snap', packFrame(frame));
        if (this.eventsOut.length) { this.net.room.send({ t: 'ev', e: this.eventsOut }); this.eventsOut = []; }
      }
    }
    this.renderTick = this.tick - 1 + this.acc / STEP;
    this.tensionUpdate(dt);
  }

  clientUpdate(dt) {
    // Inputs up to the host.
    const inp = this.localInput();
    const mag = Math.hypot(inp.x, inp.y);
    if (mag > 0.3) this.view.localAim = Math.atan2(inp.y, inp.x);
    else if (Math.abs(inp.x) > 0.05) this.view.localAim = inp.x > 0 ? 0 : Math.PI;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      const room = this.net.room;
      if (room.hostId) room.sendFast('in', [Math.round(inp.x * 127), Math.round(inp.y * 127), inp.b, inp.jp, inp.ap, inp.ak | 0, inp.ad ?? 255], room.hostId);
      this.sendT = 1 / 30;
    }
    // Render behind the newest snapshot.
    if (this.serverTick) {
      this.serverTick += dt * 60;
      const delay = this.net.room.quality().quality === 'brokers' ? 15 : 6;
      this.renderTick = Math.max(this.renderTick, this.serverTick - delay);
    }
    this.tensionUpdate(dt);
  }

  // Client: a snapshot arrived.
  onSnap(data) {
    if (this.state !== 'round') return;
    const frame = unpackFrame(data);
    if (!frame) return;
    if (!this.serverTick || Math.abs(frame.tick - this.serverTick) > 30) this.serverTick = frame.tick;
    else this.serverTick += (frame.tick - this.serverTick) * 0.1;
    this.view.pushFrame(frame, []);
  }

  onEvents(list) {
    for (const e of list) {
      const k = e._k;
      e._tick = k;
      this.view.pending.push(e);
    }
    this.react(list);
    for (const e of list) if (e.t === 'roundEnd') this.endRound(e.w);
  }

  // Game events → music and HUD.
  react(events) {
    this.listen?.(events);
    const m = this.music;
    for (const e of events) {
      switch (e.t) {
        case 'hurt': if (m) m.event(e.a >= 25 ? 'heavy' : 'hit'); break;
        case 'boom': if (m) m.event('blast'); break;
        case 'death': if (m) m.event('kill'); if (e.by >= 0 && e.by !== e.s) this.kills[e.by]++; this.app.hud.death(e, this.roster); break;
        case 'serpent': if (m) m.event('summon'); break;
        case 'break': if (m) m.event('break', 0.5); break;
        case 'pick': if (m) m.event('pickup'); if (e.s === this.localSlot) this.app.hud.picked(e.k); break;
        case 'final': if (m) m.finalKill(); break;
        case 'fight': this.app.hud.fight(); if (!this.isAttract) this.app.audio.sfx('round_start', { vol: 0.8 }); break;
        case 'ragnarok': this.app.hud.ragnarok(); break;
      }
    }
  }

  tensionUpdate(dt) {
    this.tensionT -= dt;
    if (this.tensionT > 0 || !this.music) return;
    this.tensionT = 0.1;
    const f = this.view.cur;
    if (!f) return;
    const alive = f.fighters.filter((x) => x.alive);
    let close = 0;
    for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) {
      if (Math.hypot(alive[a].parts[3] - alive[b].parts[3], alive[a].parts[4] - alive[b].parts[4]) < 6) close++;
    }
    this.music.tension({ alive: alive.length, closePairs: close, ragnarok: f.killY > -2.4 });
  }

  draw(dt) {
    if (this.state === 'loading') return;
    this.view.draw(this.renderTick, dt);
    if (this.view.cur) this.app.hud.update(this.view.cur, this.localSlot);
  }

  async endRound(winner) {
    if (this.state !== 'round') return;
    this.state = 'between';
    if (winner >= 0) this.scores[winner]++;
    const champion = this.scores.findIndex((s) => s >= this.opts.roundsToWin);
    if (this.music) this.music.roundEnd(winner === this.localSlot);
    if (!this.isAttract) this.app.audio.sfx('round_win', { vol: 0.9 });
    // Let the last frames play out while the round result shows.
    const t0 = performance.now();
    const settle = () => new Promise((res) => {
      const tick = () => {
        if (performance.now() - t0 > 3000) return res();
        if (this.isHost && this.sim) {
          // Keep the world moving under the results.
          this.acc += 1 / 60;
          while (this.acc >= STEP) { this.acc -= STEP; this.sim.step([]); this.tick = this.sim.tick; this.view.pushFrame(this.sim.frame(), this.sim.drainEvents()); }
          this.renderTick = this.tick;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    this.app.hud.roundEnd(winner, this.scores, this.roster, champion >= 0, this.code);
    await settle();
    if (this.state !== 'between') return;
    if (champion >= 0) {
      this.state = 'over';
      if (this.music) this.music.matchEnd();
      this.app.matchOver(this, champion);
      return;
    }
    if (this.isHost) await this.startRound();
  }

  setRemoteInput(slot, arr) {
    this.remoteInputs.set(slot, { x: arr[0] / 127, y: arr[1] / 127, b: arr[2], jp: arr[3], ap: arr[4], ak: arr[5] | 0, ad: arr[6] ?? 255 });
  }

  destroy() {
    this.view.localAim = null;
    this.state = 'gone';
    if (this.sim) this.sim.destroy();
    this.sim = null;
  }
}
