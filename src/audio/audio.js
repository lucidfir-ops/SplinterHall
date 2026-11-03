// One AudioContext with master, music and effects buses. Unlocked by the first tap or key.
// The music comes from one of two sources (settings.musicSource):
//   'tracks' (default): the track player (tracks.js) streams the songs in assets/audio/tracks/ through the music bus;
//            the game's reactive calls (event, tension, roundStart, ...) go to a no-op stand-in.
//   'live':  the live generator (music/), loaded only when chosen: its code runs and its 3.8 MB of samples are
//            fetched only then, and dropping back to tracks stops it and lets it go.
import { createSfx, loadMusic } from './hookup.js';
import { TrackPlayer } from './tracks.js';

// What match.js and friends call on the music: harmless while the tracks play.
const NO_MUSIC = Object.freeze({
  event() {}, tension() {}, roundStart() {}, roundEnd() {}, finalKill() {}, matchEnd() {}, start() {}, stop() {},
  setTune() { return null; }, next() { return null; }, setVolume() {}, setSimple() {}, state() { return null; }, tune() { return null; },
  ready() { return Promise.resolve(); }, warnings() { return []; },
});

export class Audio {
  constructor(app) {
    this.app = app;
    this.ctx = null;
    this.music = null;       // the live generator, once loaded
    this.fx = null;
    this.ready = false;
    this.pendingTune = null;
    this.pendingFresh = false;
    this.mode = null;
    this.source = app.settings.musicSource === 'live' ? 'live' : 'tracks';
    this.liveSerial = 0;
    this.liveOut = null;
    this.liveLoading = null;
    this.tracks = new TrackPlayer({ onChange: () => this.changed() });
    this.tracks.setStyle(app.settings.style);
    // The app unlocks on pointerdown and keydown. For touch, pointerdown isn't a user activation (pointerup,
    // touchend and click are), so iOS and Android may refuse the first play(): these retry inside a real one.
    try {
      const again = () => { if (this.ctx) this.unlock(); };
      for (const ev of ['pointerup', 'touchend', 'click']) addEventListener(ev, again, { capture: true, passive: true });
    } catch { /* no window */ }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      this.tracks.kick();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { console.warn('no audio', e); return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(c.destination);
    this.applyVolumes();
    // inside the gesture: the track player starts its first song now (and unlocks its elements for iOS)
    this.tracks.setMode(this.mode === 'match' ? 'match' : 'menu');
    if (this.source === 'tracks') this.tracks.start();
    this.tracks.attach(c, this.musicBus);
    this.init();
  }

  async init() {
    try {
      if (createSfx) { this.fx = createSfx(); this.fx.init(this.ctx, { dest: this.sfxBus, base: 'assets/audio/sfx/' }).catch((e) => console.warn('sfx', e)); }
    } catch (e) { console.warn('sfx init failed', e); this.fx = null; }
    if (this.source === 'live') await this.startLive();
    this.ready = true;
    this.changed();
  }

  /** Load the live generator once (code, then samples). Resolves to it, or null if Tracks was chosen meanwhile. */
  ensureLive() {
    if (this.music) return Promise.resolve(this.music);
    if (!this.liveLoading) {
      const simple = this.app.settings.simpleMusic;
      this.liveLoading = (async () => {
        const { createMusic } = await loadMusic();
        const out = this.ctx.createGain();
        out.connect(this.musicBus);
        const m = createMusic();
        try { await m.init(this.ctx, { dest: out, base: 'assets/audio/music/', simple }); }
        catch (e) { this.dropLive(m, out); throw e; }
        return { m, out };
      })().then(({ m, out }) => {
        this.liveLoading = null;
        if (this.source !== 'live') { this.dropLive(m, out); return null; }   // given up while it loaded
        this.music = m;
        this.liveOut = out;
        return m;
      }, (e) => { this.liveLoading = null; console.warn('music init failed', e); return null; });
    }
    return this.liveLoading;
  }

  /** Start the live generator (loading it first if need be); the tracks fade out. */
  async startLive() {
    const serial = ++this.liveSerial;
    if (!this.ctx) return;
    this.tracks.stop();
    const m = await this.ensureLive();
    if (!m || serial !== this.liveSerial || this.source !== 'live') return;
    try {
      const s = this.app.settings, t = this.ctx.currentTime;
      this.liveOut.gain.cancelScheduledValues(t);
      this.liveOut.gain.setValueAtTime(1, t);
      m.setTune(this.pendingTune || Math.random().toString(36).slice(2), { style: s.style, fresh: this.pendingTune ? !!this.pendingFresh : true });
      m.start(this.mode || 'menu');
      if (this.mode === 'match') m.roundStart();
    } catch (e) { console.warn('music start failed', e); }
    this.changed();
  }

  /** Stop the live generator and let it go (its samples are freed; choosing it again reloads them). */
  stopLive() {
    this.liveSerial++;
    if (this.music) { this.dropLive(this.music, this.liveOut); this.music = null; this.liveOut = null; }
  }

  dropLive(m, out) {
    try { m.stop(); } catch { /* ignore */ }
    if (!out) return;
    try {
      const t = this.ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.4);
      setTimeout(() => { try { out.disconnect(); } catch { /* ignore */ } }, 600);
    } catch { /* ignore */ }
  }

  /** Options → Music → Source: 'tracks' or 'live'. */
  setSource(src) {
    const v = src === 'live' ? 'live' : 'tracks';
    if (v === this.source) return;
    this.source = v;
    if (!this.ctx) return;   // the first tap starts the chosen one
    if (v === 'live') this.startLive();
    else { this.stopLive(); this.tracks.setStyle(this.app.settings.style); this.tracks.setMode(this.mode === 'match' ? 'match' : 'menu'); this.tracks.start(); }
    this.changed();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.app.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.tracks.setDirectVolume(s.music * s.master);
  }

  /** The music the game reacts to: the live generator, or a stand-in that ignores everything. */
  musicApi() { return this.source === 'live' && this.music ? this.music : NO_MUSIC; }

  state() {
    try {
      if (this.source === 'tracks') return this.tracks.state();
      return this.music ? { source: 'live', ...this.music.state() } : null;
    } catch { return null; }
  }

  /** Credit lines for the Credits page (the manifest's tracks that need one). */
  trackCredits() { try { return this.tracks.credits(); } catch { return []; } }

  setTune(seed, { fresh = false } = {}) {
    this.pendingTune = String(seed);
    this.pendingFresh = fresh;
    if (this.source === 'live' && this.music) this.music.setTune(this.pendingTune, { style: this.app.settings.style, fresh });
  }
  menuMusic() {
    this.mode = 'menu';
    this.tracks.setMode('menu');
    if (this.source === 'live' && this.music) this.music.start('menu');
  }
  startMatch() {
    this.mode = 'match';
    this.tracks.setMode('match');
    if (this.source === 'live' && this.music) this.music.start('match');
  }
  /** The player's Next: the next track, or a new tune from the live band. Returns its title. */
  next() {
    const style = this.app.settings.style;
    if (this.source === 'tracks') {
      this.tracks.setStyle(style);
      const t = this.tracks.next();
      return t ? t.title : null;
    }
    if (!this.music) return null;
    const name = this.music.next({ style });
    if (this.mode !== 'match') this.music.start('menu');
    return name;
  }
  /** The style setting changed (Options): the tracks move on if the current song no longer fits. */
  styleChanged() {
    this.tracks.setStyle(this.app.settings.style);
    if (this.source === 'tracks' && !this.tracks.fits()) this.tracks.next();
  }
  setSimple(v) { if (this.music && this.music.setSimple) this.music.setSimple(v); }

  // Effects. name, { x: pan -1..1, dist 0..1, vol, pitch }
  sfx(name, o = {}) { if (this.fx) { try { this.fx.play(name, o); } catch { /* ignore */ } } }
  play(name, o) { this.sfx(name, o); }

  /** Something the music player shows changed: refresh the screens that show it. */
  changed() {
    const id = this.app.menus && this.app.menus.cur && this.app.menus.cur.id;
    if (id === 'title' || id === 'opt-music' || id === 'credits') { try { this.app.menus.refresh(); } catch { /* ignore */ } }
  }

  tick() {}
}
