// Splinterhall live music engine: an instrumental viking / battle / power metal band generated in the browser
// from recorded samples, pushed up a five-rung ladder (Prowl, Riff, Charge, Battle, Crescendo) by the fight.
//
//   const music = createMusic();
//   await music.init(ctx, { dest, base: 'assets/audio/music/', simple: false });
//   music.setTune(seed, { style: 'any' });  music.start('match');  music.roundStart();
//   music.event('hit');  music.tension({ alive, closePairs, ragnarok });
//   music.finalKill();  music.roundEnd(true);  music.matchEnd();  music.state();
//
// The tune comes from the seed alone (everyone in a room hears the same one); music.next() and a
// { room: false } setTune pick the least familiar of 12 candidates against this browser's last 16 tunes.
// init() resolves once the core band (drums, guitars, bass) has loaded; folk and orchestra arrive in the
// background and ready() resolves when every sample has been tried. Offline rendering: see render().
//
// Modules: bank.js (loading, sample choice), fallback.js (synth stand-ins), amp.js (amp and cabinet),
// mix.js (buses, reverb, ducking, glue, limiter), voices.js (voice pool), tune.js (generator, memory),
// arrange.js (intensity and ladder), drums.js, guitar.js (rhythm, lead, bass), orchestra.js (orchestra, folk),
// scheduler.js (the band: lookahead scheduler, bar planner, moments), rng.js, theory.js.

import { Bank } from './bank.js';
import { Mixer } from './mix.js';
import { Voices } from './voices.js';
import { Band } from './scheduler.js';
import { pickTune, generateTune, memory, STYLES } from './tune.js';
import { LEVELS } from './arrange.js';

export { LEVELS, STYLES, generateTune, memory };

export function createMusic() {
  let ctx = null, bank = null, mix = null, voices = null, band = null;
  let base = 'assets/audio/music/';
  let simple = false;
  let volume = 1;
  let styleWanted = 'any';
  let seed = 'splinterhall';
  let menuSerial = 0;
  let loading = null;
  const offline = { on: false, now: 0 };

  const now = () => (offline.on ? offline.now : ctx.currentTime);

  function ensureTune() {
    if (!band.tune) band.setTune(pickTune(seed, { style: styleWanted, room: true, remember: false }));
  }

  const api = {
    /** ctx: the game's AudioContext (or an OfflineAudioContext); dest: node to connect to. */
    async init(context, opts = {}) {
      ctx = context;
      base = opts.base != null ? opts.base : base;
      if (base && !base.endsWith('/')) base += '/';
      simple = !!opts.simple;
      bank = new Bank(ctx);
      mix = new Mixer(ctx, opts.dest || ctx.destination, { simple });
      voices = new Voices(ctx, opts.voices || 48);
      voices.clock = now;
      mix.clock = now;
      band = new Band(ctx, bank, mix, voices, { simple });
      band.manual = !!opts.manual;
      mix.setVolume(volume);
      await bank.loadMeta(base);
      // init resolves once the core band (drums, guitars, bass) is in; folk and orchestra keep loading in the
      // background (unless Simple) and join the arrangement when they arrive. ready() resolves when all is in.
      const conc = opts.concurrency || 4;
      const core = bank.loadGroups(base, ['core'], { concurrency: conc, onProgress: opts.onProgress });
      loading = simple ? core : core.then(() => bank.loadGroups(base, ['folk', 'orch'], { concurrency: Math.max(2, conc - 1) }));
      await core;
      ensureTune();
      return api;
    },

    /**
     * Pick the tune from a seed. opts.style: 'any' | 'viking' | 'battle' | 'power'.
     * By default the seed alone decides, so every device in a room hears the same tune. A match with no other
     * devices can pass { room: false } (or fresh: true) to pick the least familiar of 12 candidates from the seed,
     * judged against this browser's last 16 tunes. Every tune set is remembered. Returns the tune's name.
     */
    setTune(s, opts = {}) {
      seed = String(s);
      if (opts.style) styleWanted = opts.style;
      const room = opts.room != null ? !!opts.room : !opts.fresh;
      const tune = pickTune(seed, { style: styleWanted, room, remember: opts.remember !== false });
      const wasPlaying = band && band.playing;
      if (band) band.setTune(tune);
      if (wasPlaying && band.mode === 'menu') band.start('menu', now() + 0.1);
      return tune.name;
    },

    /** Start playing. 'menu': the tune's Prowl and Riff at lower volume. 'match': waits for roundStart(). */
    start(mode = 'match') {
      if (!band) return;
      ensureTune();
      band.mode = mode;
      mix.setFader(mode === 'menu' ? 0.5 : 1, now(), 0.3);
      if (mode === 'menu') band.start('menu', now() + 0.08);
      else { band.stop(); band.mode = 'match'; }
    },

    roundStart() {
      if (!band) return;
      ensureTune();
      mix.setFader(1, now(), 0.2);
      band.roundStart(now());
      if (offline.on) band.advance(now());
    },

    event(kind, weight = 1) {
      if (!band) return;
      band.intensity.event(kind, weight, now());
    },

    tension(t) {
      if (!band) return;
      band.intensity.tension(t || {}, now());
    },

    finalKill() { if (band) { band.finalKill(now()); if (offline.on) band.advance(now()); } },
    roundEnd(won = true) { if (band) { band.roundEnd(!!won, now()); if (offline.on) band.advance(now()); } },
    matchEnd() { if (band) { band.matchEnd(now()); if (offline.on) band.advance(now()); } },

    stop() { if (band) band.stop(); },

    setVolume(v) { volume = Math.max(0, Math.min(1, +v || 0)); if (mix) mix.setVolume(volume); },

    setSimple(on) {
      simple = !!on;
      if (!band) return;
      band.simple = simple;
      mix.setSimple(simple);
      if (!simple) loading = Promise.all([loading, bank.loadGroups(base, ['folk', 'orch'], { concurrency: 3 })]);
    },

    /** Menu player: move to a new tune (least familiar of 12), keep playing if the menu music was on. */
    next(opts = {}) {
      if (opts.style) styleWanted = opts.style;
      menuSerial++;
      const s = `${seed}/menu${menuSerial}/${Math.floor(Math.random() * 1e9)}`;
      const tune = pickTune(s, { style: styleWanted, room: false, remember: true });
      const was = band.playing && band.mode === 'menu';
      band.setTune(tune);
      if (was) { voices.cutAll(now() + 0.02, 0.3); band.start('menu', now() + 0.4); }
      return tune.name;
    },

    state() {
      if (!band || !band.tune) return { level: 0, levelName: LEVELS[0], intensity: 0, bpm: 0, style: null, key: null, title: null, bar: 0, beat: 0, playing: false };
      const s = band.state(now());
      return { ...s, name: band.tune.name, voices: voices.activeAt(now()), peakVoices: voices.peak };
    },

    /** The current tune description (for tests and the music player). */
    tune() { return band && band.tune; },

    /** Loading: a promise that resolves once every requested sample group has been tried. */
    ready() { return loading || Promise.resolve(); },

    /** Warnings from loading (failed files, synthesized stand-ins). */
    warnings() { return bank ? bank.warnings.slice() : []; },

    /** For tools and tests only: the engine's parts. */
    _internals() { return { ctx, bank, mix, voices, band }; },

    /** Seconds of decoded audio held. */
    decodedSeconds() { return bank ? bank.seconds : 0; },

    /**
     * Offline rendering: drive the engine without real time. Call after init(offlineCtx, { manual: true }).
     * script: [[time, fn(music)], ...] run at those times; returns a promise of the rendered AudioBuffer.
     * The scheduler is advanced in 20 ms steps by suspending the offline context.
     */
    async render(seconds, script = [], { step = 0.02, onBar } = {}) {
      if (!ctx || typeof ctx.startRendering !== 'function') throw new Error('render() needs an OfflineAudioContext');
      offline.on = true;
      band.manual = true;
      if (onBar) band.onBar = onBar;
      const items = script.slice().sort((a, b) => a[0] - b[0]);
      let k = 0;
      const total = ctx.length / ctx.sampleRate;
      const steps = Math.floor((Math.min(seconds, total) - 1e-6) / step);
      for (let i = 1; i <= steps; i++) {
        const t = i * step;
        ctx.suspend(t).then(() => {
          offline.now = t;
          while (k < items.length && items[k][0] <= t + 1e-9) { try { items[k][1](api); } catch (e) { console.error(e); } k++; }
          band.advance(t);
          ctx.resume();
        });
      }
      offline.now = 0;
      while (k < items.length && items[k][0] <= 0) { items[k][1](api); k++; }
      band.advance(0);
      return ctx.startRendering();
    },
  };
  return api;
}

export default createMusic;
