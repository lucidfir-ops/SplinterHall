// Splinterhall sound effects player.
//
// Short CC0 recordings (assets/audio/sfx/*.mp3, listed in sfx.json), played
// one-shot through Web Audio with per-play pitch and level variation, stereo
// pan by screen position and distance attenuation. No loops or beds.
//
//   const sfx = createSfx();
//   await sfx.init(ctx, { dest: sfxBus, base: 'assets/audio/sfx/' });
//   sfx.play('punch_heavy', { x: 0.4, dist: 0.2 });
//
// Works with AudioContext and OfflineAudioContext. While a file hasn't decoded
// (or failed to load) a tiny synthesized stand-in plays instead: a filtered
// noise burst or a sine thump, chosen by the effect's name.

const DEFAULTS = { pitchVar: 0.06, gainVarDb: 2, minGap: 0.05 };
const GLOBAL_MAX = 24;        // simultaneous effects in all
const BREAK_PREFIX = 'break_';
const BREAK_MAX = 6;          // terrain breaks at once
const DIST_FLOOR = 0.25;      // gain at dist = 1 (quieter with distance, never silent)
// Bus safety clipper: a WaveShaper that is exactly linear below CLIP_KNEE and
// bends smoothly (tanh, slope 1 at the knee) toward CLIP_CEIL above it. Single
// effects peak around -5 dBFS or lower, so it only acts when several loud ones
// pile up (an explosion over a collapse over a serpent). Deterministic, so it
// behaves the same in an AudioContext and an OfflineAudioContext.
const CLIP_KNEE = 0.6;        // -4.4 dBFS
const CLIP_CEIL = 0.944;      // -0.5 dBFS
const CLIP_RANGE = 4;         // the curve covers inputs up to +12 dBFS

// Fallback synth shapes per name: [pattern, kind, freq Hz, duration s, level].
// kind 'thump' = falling sine; 'noise' = band-passed noise burst; 'click' = very short noise.
const FALLBACK = [
  [/^explosion|^collapse|^serpent_rise|^round_/, 'thump', 55, 0.45, 0.5],
  [/^punch|^thud|^land|^death|^hammer|^crate|^bomb_bounce|^serpent_crunch/, 'thump', 90, 0.16, 0.45],
  [/^ui_/, 'click', 2500, 0.03, 0.3],
  [/^step|^debris/, 'click', 1800, 0.04, 0.2],
  [/^break_glass|^break_ice/, 'noise', 5000, 0.18, 0.3],
  [/^break_/, 'noise', 1200, 0.2, 0.4],
  [/^blunderbuss|^rocket_launch/, 'noise', 900, 0.22, 0.5],
  [/./, 'noise', 2200, 0.14, 0.3],
];

function dbToGain(d) { return Math.pow(10, d / 20); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function clipCurve() {
  const n = 4096, curve = new Float32Array(n), span = CLIP_CEIL - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE, a = Math.abs(x);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + span * Math.tanh((a - CLIP_KNEE) / span);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export function createSfx() {
  let ctx = null;
  let out = null;          // master gain for effects (setVolume)
  let limiter = null;      // { pre, shaper } when the bus clipper is on (kept for debugging)
  let base = 'assets/audio/sfx/';
  let manifest = {};       // name -> entry
  let manifestLoaded = false; // before sfx.json arrives, unknown names are expected (synth stand-in, no warning)
  const buffers = {};      // file -> AudioBuffer
  const lastPlay = {};     // name -> ctx time
  const warned = {};       // unknown names already reported
  const active = [];       // { name, src, end, gain }
  let noiseBuf = null;
  let volume = 1;
  let groupMax = { [BREAK_PREFIX]: BREAK_MAX };

  function now() { return ctx ? ctx.currentTime : 0; }

  function prune(t) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= t) active.splice(i, 1);
  }

  function count(pred) { let n = 0; for (const v of active) if (pred(v)) n++; return n; }

  // Stop the oldest voice matching pred (quick 15 ms fade) to make room.
  function steal(pred, t) {
    let oldest = -1;
    for (let i = 0; i < active.length; i++) {
      if (pred(active[i]) && (oldest < 0 || active[i].start < active[oldest].start)) oldest = i;
    }
    if (oldest < 0) return false;
    const v = active[oldest];
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + 0.015);
      v.src.stop(t + 0.02);
    } catch (e) { /* already stopped */ }
    active.splice(oldest, 1);
    return true;
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
    return noiseBuf;
  }

  // A tiny synthesized stand-in. Returns { src, gain, end }.
  function fallback(name, t, rate, dest) {
    const f = FALLBACK.find(r => r[0].test(name));
    const [, kind, freq, dur, level] = f;
    const g = ctx.createGain();
    g.connect(dest);
    let src;
    if (kind === 'thump') {
      src = ctx.createOscillator();
      src.type = 'sine';
      src.frequency.setValueAtTime(freq * 2 * rate, t);
      src.frequency.exponentialRampToValueAtTime(freq * rate, t + Math.min(0.08, dur * 0.5));
      src.connect(g);
    } else {
      src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * rate;
      bp.Q.value = kind === 'click' ? 1.2 : 0.8;
      src.connect(bp);
      bp.connect(g);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.start(t);
    src.stop(t + dur + 0.02);
    return { src, gain: g, end: t + dur + 0.02 };
  }

  async function loadFile(file) {
    if (buffers[file]) return true;
    try {
      const res = await fetch(base + file);
      if (!res.ok) throw new Error(res.status + ' ' + file);
      const data = await res.arrayBuffer();
      // callback form as well, for older Safari
      buffers[file] = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    /**
     * @param {BaseAudioContext} audioCtx AudioContext or OfflineAudioContext
     * @param {{dest?: AudioNode, base?: string, manifest?: object, limiter?: boolean}} opts
     *   dest: where effects go (default ctx.destination); base: folder URL with
     *   sfx.json and the mp3s; manifest: a pre-loaded sfx.json object (skips its
     *   fetch); limiter: false to skip the effects-bus safety clipper (default on).
     * @returns {Promise<{loaded: number, failed: string[]}>} never rejects
     */
    async init(audioCtx, opts = {}) {
      ctx = audioCtx;
      if (opts.base != null) base = opts.base.endsWith('/') || opts.base === '' ? opts.base : opts.base + '/';
      out = ctx.createGain();
      out.gain.value = volume;
      const dest = opts.dest || ctx.destination;
      if (opts.limiter !== false && ctx.createWaveShaper) {
        // scale into the curve's [-1, 1] domain, shape, and the curve's own values
        // restore the level (curve[x] is defined in absolute units)
        const pre = ctx.createGain();
        pre.gain.value = 1 / CLIP_RANGE;
        const shaper = ctx.createWaveShaper();
        shaper.curve = clipCurve();
        shaper.oversample = '2x';
        out.connect(pre);
        pre.connect(shaper);
        shaper.connect(dest);
        limiter = { pre, shaper };
      } else {
        out.connect(dest);
      }
      let doc = opts.manifest || null;
      if (!doc) {
        try {
          const res = await fetch(base + 'sfx.json');
          doc = await res.json();
        } catch (e) {
          doc = { effects: {} };
        }
      }
      manifest = doc.effects || {};
      manifestLoaded = true;
      if (doc.groups) {
        for (const g of Object.values(doc.groups)) if (g.match && g.maxVoices) groupMax[g.match] = g.maxVoices;
      }
      const files = [...new Set(Object.values(manifest).flatMap(e => e.files || []))];
      const results = await Promise.all(files.map(f => loadFile(f).then(ok => [f, ok])));
      const failed = results.filter(r => !r[1]).map(r => r[0]);
      return { loaded: files.length - failed.length, failed };
    },

    /**
     * Play an effect once.
     * @param {string} name effect name from sfx.json
     * @param {{x?: number, dist?: number, vol?: number, pitch?: number, when?: number, vary?: boolean}} o
     *   x: pan -1 (left) .. 1 (right); dist: 0 (camera centre) .. 1 (edge/far, quieter);
     *   vol: extra linear gain; pitch: extra playback-rate factor;
     *   when: optional ctx time to start (default now; for offline rendering);
     *   vary: false turns off the random pitch/level variation (tests, previews).
     */
    play(name, { x = 0, dist = 0, vol = 1, pitch = 1, when, vary = true } = {}) {
      if (!ctx || !out) return;
      const e = manifest[name];
      if (!e && manifestLoaded && !warned[name]) { warned[name] = true; console.warn('sfx: unknown effect "' + name + '" (synth stand-in)'); }
      const t = Math.max(when != null ? when : now(), now());
      // rate limit per name
      const gap = e && e.minGap != null ? e.minGap : DEFAULTS.minGap;
      if (lastPlay[name] != null && t - lastPlay[name] < gap - 1e-6) return;
      prune(t);
      // per-name and group caps (break_* share one cap), then the global cap
      const nameCap = e && e.maxVoices;
      if (nameCap && count(v => v.name === name) >= nameCap && !steal(v => v.name === name, t)) return;
      for (const pre in groupMax) {
        if (name.startsWith(pre) && count(v => v.name.startsWith(pre)) >= groupMax[pre]) {
          if (!steal(v => v.name.startsWith(pre), t)) return;
        }
      }
      if (active.length >= GLOBAL_MAX && !steal(() => true, t)) return;
      lastPlay[name] = t;

      const pv = !vary ? 0 : e && e.pitchVar != null ? e.pitchVar : DEFAULTS.pitchVar;
      const gv = !vary ? 0 : e && e.gainVarDb != null ? e.gainVarDb : DEFAULTS.gainVarDb;
      const rate = clamp(pitch, 0.25, 4) * (1 + (Math.random() * 2 - 1) * pv);
      const d = clamp(dist, 0, 1);
      // distance: linear fade from 1 at the camera centre to DIST_FLOOR at dist = 1
      const level = (e ? e.gain : 0.5) * clamp(vol, 0, 4) * dbToGain((Math.random() * 2 - 1) * gv) *
        (1 - (1 - DIST_FLOOR) * d);

      // pan: StereoPannerNode (every target browser has it; without it the effect plays centred)
      const pan = clamp(x, -1, 1) * 0.85;
      let dest = out;
      let panNode = null;
      if (ctx.createStereoPanner) {
        panNode = ctx.createStereoPanner();
        panNode.pan.value = pan;
        panNode.connect(out);
        dest = panNode;
      }
      // distance also dulls the top end a little
      let lpNode = null;
      if (d > 0.05) {
        lpNode = ctx.createBiquadFilter();
        lpNode.type = 'lowpass';
        lpNode.frequency.value = 18000 - 12000 * d;
        lpNode.connect(dest);
        dest = lpNode;
      }

      const files = e && e.files ? e.files.filter(f => buffers[f]) : [];
      let voice;
      if (files.length) {
        const buf = buffers[files[Math.floor(Math.random() * files.length)]];
        const g = ctx.createGain();
        g.gain.value = level;
        g.connect(dest);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        src.connect(g);
        src.start(t);
        voice = { src, gain: g, end: t + buf.duration / rate };
      } else {
        const g = ctx.createGain();
        g.gain.value = level;
        g.connect(dest);
        voice = fallback(name, t, rate, g);
        voice.gain = g;
      }
      voice.name = name;
      voice.start = t;
      active.push(voice);
      voice.src.onended = () => {
        const i = active.indexOf(voice);
        if (i >= 0) active.splice(i, 1);
        try { voice.gain.disconnect(); if (lpNode) lpNode.disconnect(); if (panNode) panNode.disconnect(); } catch (err) { /* ok */ }
      };
    },

    /** Effects volume, linear 0..1 (applied smoothly). */
    setVolume(v) {
      volume = clamp(Number(v) || 0, 0, 1);
      if (!out || !ctx) return;
      // short linear ramp: no zipper noise, and 0 really is silent
      const t = ctx.currentTime, g = out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(volume, t + 0.03);
    },

    /** Names of every effect in sfx.json (after init). */
    names() { return Object.keys(manifest); },

    /** True once every file of this name has decoded. */
    ready(name) { const e = manifest[name]; return !!(e && e.files.every(f => buffers[f])); },

    /** Number of voices sounding now (for tests and the debug overlay). */
    active() { prune(now()); return active.length; },
  };
}
