// Track player: the default music source. Plays the songs listed in assets/audio/tracks/tracks.json (songs
// pre-rendered from the live generator by tools/music/pregen.mjs, and Creative Commons tracks) as a shuffled
// playlist that follows the style setting. Two <audio> elements stream the files, each through a
// MediaElementAudioSourceNode and its own gain into one fader on the game's music bus, so the music volume
// setting applies and menus can sit lower than matches. A song hands over to the next one second before its end
// (the files carry their own fades); Next and style changes crossfade. Nothing here throws: a missing manifest
// means no music, a missing or broken file is skipped.
//
//   const p = new TrackPlayer({ onChange });      fetches the manifest at once (small)
//   p.attach(ctx, musicBus);                      inside the first tap or key (also unlocks the elements on iOS)
//   p.start();  p.setMode('menu' | 'match');  p.setStyle('any' | 'viking' | 'battle' | 'power');  p.next();  p.stop();
//   p.state() → { source: 'tracks', title, artist, style, playing, ... } or null;  p.credits() → [{ title, artist, credit, licence, source }]

const BASE = 'assets/audio/tracks/';
// Which manifest styles each style setting plays. Folk metal sits with viking.
const STYLE_SET = { viking: ['viking', 'folk'], battle: ['battle'], power: ['power'] };
const MENU_LEVEL = 0.5;   // menus play quieter, as the live band does
const HANDOVER = 1.0;     // seconds of a song's tail that overlap the next song's start
const SKIP_FADE = 1.2;    // crossfade on Next

let silent = null;
/** A 50 ms silent WAV, played by each element once inside the first gesture so iOS lets it play later. */
function silentWav() {
  if (silent) return silent;
  const n = 400, b = new Uint8Array(44 + n);
  const dv = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
  b.fill(128, 44);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  silent = 'data:audio/wav;base64,' + btoa(s);
  return silent;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class TrackPlayer {
  constructor({ base = BASE, onChange = null } = {}) {
    this.base = base;
    this.onChange = onChange;
    this.tracks = [];
    this.bad = new Set();
    this.ready = false;
    this.ctx = null;
    this.out = null;
    this.decks = [];
    this.active = null;    // the deck playing the current song
    this.current = null;   // its manifest entry
    this.style = 'any';
    this.mode = 'menu';
    this.queue = [];
    this.history = [];
    this.wanted = false;   // tracks are the music source
    this.timer = null;
    this.hidden = false;
    this.blocked = null;   // a deck whose play() the browser refused until the next gesture
    this.directVolume = 0.5;
    this.loading = this.load();
  }

  async load() {
    try {
      const r = await fetch(this.base + 'tracks.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // forgive trailing commas, so adding a track is one pasted line
      const j = JSON.parse((await r.text()).replace(/,(\s*[\]}])/g, '$1'));
      const list = Array.isArray(j) ? j : j && j.tracks;
      this.tracks = (Array.isArray(list) ? list : [])
        .filter((t) => t && typeof t.file === 'string' && t.file.trim())
        .map((t) => ({ ...t, file: t.file.trim(), style: String(t.style || 'any').toLowerCase(),
          title: String(t.title || t.file.replace(/\.[a-z0-9]+$/i, '')), artist: String(t.artist || '') }));
    } catch (e) {
      console.warn('music tracks: no manifest', e && e.message);
      this.tracks = [];
    }
    this.ready = true;
    if (this.wanted && this.ctx && !this.current) this.playNext(0.6);
    this.changed();
  }

  /** Connect to the audio graph. Call inside a user gesture: it also unlocks both elements for iOS. */
  attach(ctx, dest) {
    if (this.ctx || !ctx) return;
    this.ctx = ctx;
    try {
      this.out = ctx.createGain();
      this.out.gain.value = this.mode === 'match' ? 1 : MENU_LEVEL;
      this.out.connect(dest);
    } catch (e) { this.out = null; }
    for (let i = 0; i < 2; i++) this.decks.push(this.makeDeck());
    try { document.addEventListener('visibilitychange', () => this.onVisibility()); } catch { /* no document */ }
    this.hidden = typeof document !== 'undefined' && document.hidden;
    if (this.wanted) this.start();
    this.prime();
  }

  makeDeck() {
    const d = { el: null, gain: null, track: null, serial: 0, ending: false, primed: false, fadeIn: 0 };
    try {
      const el = new window.Audio();
      el.preload = 'auto';
      d.el = el;
      if (this.out) {
        try {
          const src = this.ctx.createMediaElementSource(el);
          d.gain = this.ctx.createGain();
          d.gain.gain.value = 0;
          src.connect(d.gain).connect(this.out);
        } catch (e) { d.gain = null; }
      }
      if (!d.gain) el.volume = 0;   // no Web Audio route: the element plays on its own, at directVolume
      el.addEventListener('playing', () => this.onPlaying(d));
      el.addEventListener('ended', () => this.onEnded(d));
      el.addEventListener('error', () => this.onError(d));
    } catch (e) { d.el = null; }
    return d;
  }

  /**
   * Play a moment of silence on each idle element inside a gesture, so later play() calls are allowed (iOS asks
   * this of every element). An element that has played a song is unlocked already. Refused: tried again next gesture.
   */
  prime() {
    for (const d of this.decks) {
      if (!d.el || d.primed || d.track) continue;
      d.primed = 'pending';
      try {
        d.el.src = silentWav();
        const p = d.el.play();
        if (p && p.then) p.then(() => { d.primed = true; if (!d.track) d.el.pause(); }, () => { if (d.primed === 'pending') d.primed = false; });
        else d.primed = true;
      } catch { d.primed = false; }
    }
  }

  /** From a user gesture: retry anything the browser refused to play, and unlock elements not yet unlocked. */
  kick() {
    if (this.blocked) {
      const d = this.blocked;
      this.blocked = null;
      if (d === this.active && this.wanted && d.el && d.track) this.safePlay(d);
    }
    if (this.decks.some((d) => d.el && !d.primed && !d.track)) this.prime();
  }

  // ------------------------------------------------------------------ control
  start() {
    this.wanted = true;
    if (!this.ctx) return;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 250);
    const d = this.active;
    if (d && d.track && d.el && !d.el.ended) {
      // back from the live generator: carry on where it was
      d.serial++;
      this.ramp(d, 1, 0.8);
      if (!this.hidden) this.safePlay(d);
      this.changed();
      return;
    }
    if (this.ready) this.playNext(0.6);
  }

  stop(fade = 0.5) {
    this.wanted = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const d of this.decks) {
      if (!d.el || !d.track) continue;
      const serial = ++d.serial;
      this.ramp(d, 0, fade);
      setTimeout(() => { if (d.serial === serial && !this.wanted) try { d.el.pause(); } catch { /* ignore */ } }, fade * 1000 + 120);
    }
    // the song that was handing over is let go; the current one keeps its place for start()
    for (const d of this.decks) if (d !== this.active && d.track) this.release(d, fade);
    this.changed();
  }

  setMode(mode) {
    this.mode = mode === 'match' ? 'match' : 'menu';
    if (!this.out) return;
    try { this.out.gain.setTargetAtTime(this.mode === 'match' ? 1 : MENU_LEVEL, this.ctx.currentTime, 0.25); } catch { /* ignore */ }
    this.applyDirect();
  }

  setStyle(style) {
    const s = STYLE_SET[style] ? style : 'any';
    if (s === this.style) return;
    this.style = s;
    this.queue = [];
  }

  /** Does the current song fit the style setting? */
  fits(t = this.current) {
    const set = STYLE_SET[this.style];
    return !t || !set || set.includes(t.style) || !this.pool(true).length;
  }

  /** Skip to the next song (crossfade). Returns its entry, or null. */
  next() {
    if (!this.wanted) return null;
    return this.playNext(0.4, SKIP_FADE);
  }

  /** For a deck without a Web Audio route: the element's own volume. */
  setDirectVolume(v) { this.directVolume = v; this.applyDirect(); }
  applyDirect() {
    for (const d of this.decks) if (d.el && !d.gain) {
      try { d.el.volume = d === this.active ? Math.max(0, Math.min(1, this.directVolume * (this.mode === 'match' ? 1 : MENU_LEVEL))) : 0; } catch { /* iOS: read-only */ }
    }
  }

  // ------------------------------------------------------------------ playlist
  pool(strict = false) {
    const ok = this.tracks.filter((t) => !this.bad.has(t.file));
    const set = STYLE_SET[this.style];
    const want = set ? ok.filter((t) => set.includes(t.style)) : ok;
    return strict || want.length ? want : ok;
  }

  pick() {
    const pool = this.pool();
    if (!pool.length) return null;
    this.queue = this.queue.filter((t) => pool.includes(t));
    if (!this.queue.length) {
      // a fresh shuffle, with the last few songs played moved to its end
      const recent = this.history.slice(-Math.min(3, pool.length - 1));
      const q = shuffle(pool.slice());
      this.queue = [...q.filter((t) => !recent.includes(t)), ...q.filter((t) => recent.includes(t))];
    }
    if (this.queue.length > 1 && this.queue[0] === this.current) this.queue.push(this.queue.shift());
    return this.queue.shift();
  }

  url(t) { return this.base + t.file.split('/').map(encodeURIComponent).join('/'); }

  /**
   * Start the next song on the idle deck. fadeIn: seconds to bring it up once it plays; fadeOut: how long the
   * old song takes to go (null: it plays out its own tail).
   */
  playNext(fadeIn = 0.25, fadeOut = null, tries = 0) {
    if (!this.ctx || !this.wanted || !this.decks.length) return null;
    const t = this.pick();
    if (!t) { if (this.active) this.release(this.active, 0.5); this.active = null; this.current = null; this.changed(); return null; }
    const old = this.active;
    const d = this.decks.find((x) => x !== old && x.el) || old;
    if (!d || !d.el) return null;
    if (old && old !== d) {
      const left = old.el && isFinite(old.el.duration) ? old.el.duration - old.el.currentTime : 0;
      this.release(old, fadeOut != null ? fadeOut : Math.max(0.3, Math.min(3, left + 0.1)));
    }
    d.serial++;
    d.track = t;
    d.ending = false;
    d.fadeIn = fadeIn;
    d.tries = tries;
    this.ramp(d, 0, 0.01);
    this.active = d;
    this.current = t;
    this.history.push(t);
    if (this.history.length > 8) this.history.shift();
    try {
      d.el.src = this.url(t);
      if (!this.hidden) this.safePlay(d);
    } catch (e) { this.onError(d); return this.current; }
    this.applyDirect();
    this.changed();
    return t;
  }

  safePlay(d) {
    const serial = d.serial;
    try {
      const p = d.el.play();
      if (p && p.catch) p.catch((e) => {
        if (d.serial !== serial) return;                    // superseded (a new song or a stop)
        if (e && e.name === 'NotAllowedError') { this.blocked = d; return; }   // wait for the next gesture
        if (e && e.name === 'AbortError') return;
        this.onError(d);
      });
    } catch (e) { this.onError(d); }
  }

  /** Let a deck go: fade it out, then stop and empty it. */
  release(d, fade) {
    const serial = ++d.serial;
    const track = d.track;
    this.ramp(d, 0, fade);
    setTimeout(() => {
      if (d.serial !== serial || d.track !== track || d === this.active) return;
      d.track = null;
      try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); } catch { /* ignore */ }
    }, fade * 1000 + 150);
  }

  ramp(d, v, secs) {
    if (!d.gain) return;
    try {
      const g = d.gain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v, t + Math.max(0.01, secs));
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ events
  onPlaying(d) {
    if (d.track) d.primed = true;
    if (d !== this.active || !this.wanted) return;
    if (d.fadeIn != null) { this.ramp(d, 1, d.fadeIn || 0.01); d.fadeIn = null; }
  }

  onEnded(d) {
    if (d === this.active && this.wanted) this.playNext(0.05, 0.05);
  }

  onError(d) {
    if (!d.track || !d.el || !d.el.getAttribute('src') || d.el.getAttribute('src').startsWith('data:')) return;
    const t = d.track;
    if (!this.bad.has(t.file)) console.warn('music track failed to load:', t.file);
    this.bad.add(t.file);
    d.track = null;
    d.serial++;
    // empty the element (a failed one can stay "playing" with nothing to play)
    try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); } catch { /* ignore */ }
    if (d === this.active) {
      this.active = null;
      this.current = null;
      if (this.wanted && (d.tries || 0) < 8) this.playNext(0.4, null, (d.tries || 0) + 1);
      else this.changed();
    }
  }

  tick() {
    const d = this.active;
    if (!d || !d.el || !this.wanted || this.hidden || d.ending || d.el.paused) return;
    const dur = d.el.duration;
    if (isFinite(dur) && dur > HANDOVER * 3 && d.el.currentTime >= dur - HANDOVER) {
      d.ending = true;
      this.playNext(0.25, null);
    }
  }

  onVisibility() {
    this.hidden = document.hidden;
    for (const d of this.decks) {
      if (!d.el || !d.track) continue;
      try {
        if (this.hidden) d.el.pause();
        else if (this.wanted && d === this.active) this.safePlay(d);
      } catch { /* ignore */ }
    }
  }

  changed() { try { if (this.onChange) this.onChange(); } catch { /* ignore */ } }

  // ------------------------------------------------------------------ for the UI
  state() {
    if (!this.ctx) return null;
    const t = this.current, el = this.active && this.active.el;
    return {
      source: 'tracks', title: t ? t.title : null, artist: t ? t.artist : '', style: t ? t.style : null, file: t ? t.file : null,
      playing: !!(el && t && !el.paused), time: el ? el.currentTime : 0, duration: el && isFinite(el.duration) ? el.duration : 0,
      count: this.pool().length, ready: this.ready,
    };
  }

  /** Credit lines of the tracks that need one (everything not made by the game itself). */
  credits() {
    return this.tracks.filter((t) => t.credit && !String(t.id || '').startsWith('gen-'))
      .map((t) => ({ title: t.title, artist: t.artist, credit: t.credit, licence: t.licence || '', source: t.source || '' }));
  }
}
