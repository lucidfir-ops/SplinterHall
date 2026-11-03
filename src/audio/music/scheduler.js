// The band: a lookahead scheduler (25 ms timer, 120 ms lookahead) that plans one bar at a time, from the
// ladder's rung and the tune, and starts every note sample-accurately. It can also be driven without real
// time (advance(t)) so an OfflineAudioContext can render a scripted match.

import { rngFrom } from './rng.js';
import { degSemis, rootScale, placeIn } from './theory.js';
import { Intensity, Ladder, LEVELS, phraseKind } from './arrange.js';
import { drumEvents, DrumPlayer } from './drums.js';
import { guitarBar, bassBar, leadBar, guitarHit, bassHit, guitarHold } from './guitar.js';
import { Orchestra } from './orchestra.js';

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

// Bus faders per rung, in dB. Calibrated from offline renders (tools/music/analyse.py prints per-bus RMS per
// rung): Prowl sits near -26 dB RMS at the output, Riff -21, Charge -19, Battle -17, Crescendo -16, with the
// drums about 1.5 dB under the rhythm guitars, the bass 4 dB under, the lead 3 dB under, the orchestra behind.
const RUNG_DB = [
  { drums: -11.8, gtr: -26, bass: -24.5, strings: -17, brass: -12, folk: -5, lead: -31.5, lead2: -33.5, perc: -14, clean: -20.4, drone: -11 },
  { drums: -8.1, gtr: -22.9, bass: -20.7, strings: -14, brass: -10, folk: -3, lead: -29.5, lead2: -31.5, perc: -10, clean: -20, drone: -9 },
  { drums: -9.5, gtr: -20.2, bass: -18.2, strings: -12.7, brass: -10.2, folk: -2.2, lead: -28.2, lead2: -30.2, perc: -8.7, clean: -19.2, drone: -8 },
  { drums: -8.1, gtr: -18.7, bass: -17, strings: -11.5, brass: -7.5, folk: -2, lead: -28.5, lead2: -30.5, perc: -7.6, clean: -19, drone: -8 },
  { drums: -5.6, gtr: -16.7, bass: -15.3, strings: -8.8, brass: -5.2, folk: -0.5, lead: -26.5, lead2: -28.5, perc: -7.8, clean: -18, drone: -7 },
];
const BUS_NODE = { drums: 'drums', gtr: 'gtrBus', bass: 'bass', strings: 'strings', brass: 'brass', folk: 'folk', lead: 'lead', lead2: 'lead2', perc: 'perc', clean: 'clean', drone: 'drone' };
const dbToGain = (d) => Math.pow(10, d / 20);

export class Band {
  constructor(ctx, bank, mix, voices, { simple = false } = {}) {
    this.ctx = ctx;
    this.bank = bank;
    this.mix = mix;
    this.voices = voices;
    this.simple = simple;
    this.drumPlayer = new DrumPlayer(this);
    this.orch = new Orchestra(this);
    this.intensity = new Intensity();
    this.ladder = new Ladder();
    this.tune = null;
    this.playing = false;
    this.mode = 'match';
    this.timer = null;
    this.queue = [];
    this.manual = false;
    this.lastLead = {};
    this.transpose = 0;
    this.bar = 0;
    this.barInfo = null;
    this.moment = null;
    this.pending = [];
    this.hum = Math.random; // timing humanisation: cosmetic, may differ per device (seeded per tune below)
    this.history = [];
    this.trim = {}; // per-bus dB offsets (tools and tests)
    this.barSide = { L: 0, R: 6 };
  }

  setTune(tune) {
    this.tune = tune;
    this.bpm = tune.bpm;
    this.stepDur = 60 / tune.bpm / tune.spb;
    this.beatDur = this.stepDur * tune.spb;
    this.barDur = this.stepDur * tune.barSteps;
    this.mix.setTempo(tune.bpm);
    this.rng = rngFrom('arr:' + tune.seed);
    this.hum = rngFrom('hum:' + tune.seed);
    this.transpose = 0;
    this.lastLead = {};
  }

  // ------------------------------------------------------------------ pitch helpers
  /** Chord root (scale degree) to semitones above the tonic. */
  rootOff(deg) { return degSemis(rootScale(this.tune), deg); }

  /** Riff event to semitones above the tonic, relative to the bar's chord. */
  riffSemis(chordDeg, e) {
    if (e.semi != null) return this.rootOff(chordDeg) + e.semi;
    return degSemis(rootScale(this.tune), chordDeg + (e.deg || 0));
  }

  /** Guitar MIDI for semitones above the tonic, folded into the low guitar range (B1..B2 for the root). */
  gtrMidi(semis) {
    let m = this.tune.gRoot + semis + this.transpose;
    while (m > this.tune.gRoot + 9) m -= 12;
    while (m < 35) m += 12;
    return m;
  }

  bassMidi(semis) {
    let m = this.gtrMidi(semis) - 12;
    while (m < 26) m += 12;
    return m;
  }

  /** The tonic each melodic voice plays the hook from. */
  leadTonic(voice) {
    const t = this.tune;
    if (voice === 'whistle') return t.lead0 + 12;
    if (voice === 'fiddle') return t.lead0 + (t.lead0 < 64 ? 12 : 0);
    if (voice === 'horn') return t.lead0 - 12;
    return t.lead0;
  }

  voice(voice, midi, when, dur, o) { this.orch.folkNote(voice, midi, when, dur, o); }

  // ------------------------------------------------------------------ scheduling
  /** Queue a callback at audio time `when`, run within the lookahead window. */
  at(when, fn) {
    if (when <= this.horizon) { fn(when); return; }
    this.queue.push({ when, fn });
  }

  start(mode, when) {
    this.mode = mode;
    this.playing = true;
    const t = when != null ? when : this.ctx.currentTime + 0.08;
    this.nextBar = t;
    this.bar = 0;
    this.phraseBar = 0;
    this.phraseIdx = 0;
    this.horizon = t;
    this.ladder.reset(0);
    this.intensity.reset();
    this.moment = null;
    this.pending = [];
    this.history = [];
    this.prevLevel = null;
    if (mode === 'menu') this.menuBars = 0;
    if (!this.manual && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.queue = [];
    this.voices.cutAll(this.ctx.currentTime + 0.01, 0.05);
  }

  tick() {
    if (!this.playing) return;
    this.advance(this.ctx.currentTime);
  }

  /** Plan everything up to now + lookahead. Usable for offline rendering with any `now`. */
  advance(now) {
    this.horizon = now + LOOKAHEAD;
    // run queued note callbacks
    if (this.queue.length) {
      const due = [], keep = [];
      for (const q of this.queue) (q.when <= this.horizon ? due : keep).push(q);
      this.queue = keep;
      due.sort((a, b) => a.when - b.when);
      for (const q of due) q.fn(q.when);
    }
    if (!this.playing) return;
    while (this.nextBar <= this.horizon && this.playing) this.planBar();
  }

  // ------------------------------------------------------------------ the bar planner
  planBar() {
    const t0 = this.nextBar;
    const t = this.tune;
    this.intensity.update(t0);
    // moments that take over the bar line
    if (this.pending.length) {
      const m = this.pending.shift();
      const used = m(t0);
      if (used) { this.nextBar = t0 + used; return; }
    }
    if (!this.playing) return;
    const v = this.mode === 'menu' ? this.menuIntensity() : this.intensity.value;
    let st = this.ladder.next(v);
    if (this.mode === 'menu') st = { ...st, level: Math.min(1, st.level), build: false, land: false };
    const level = st.level;
    // phrase bookkeeping: 4-bar phrases; a rung change restarts the phrase
    if (this.prevLevel != null && level !== this.prevLevel && !st.build) { this.phraseBar = 0; this.phraseIdx++; }
    const kind = phraseKind(level, this.phraseIdx, t.style, this.mode === 'menu');
    const chords = kind === 'chorus' ? t.prog.chorus : kind === 'bridge' ? t.prog.bridge : t.prog.verse;
    // key change up a tone for power metal's Crescendo choruses
    const wantUp = t.style === 'power' && level >= 4 && kind === 'chorus';
    if (this.phraseBar === 0) this.transpose = wantUp ? 2 : level >= 4 && t.style === 'power' ? this.transpose : 0;
    if (level < 4) this.transpose = 0;
    const chord = chords[this.phraseBar % 4];
    const riffBarIdx = this.phraseBar % 2;
    let riffBar;
    if (kind === 'chorus') riffBar = t.riff.chorus;
    else if (riffBarIdx === 0) riffBar = t.riff.bars[0];
    else if (level >= 2 && this.phraseBar === 3) riffBar = t.riff.vars[this.phraseIdx % 2];
    else riffBar = t.riff.bars[1];
    const fill = st.fill || (this.phraseBar === 3 && level >= 1 ? (this.phraseIdx % 2 === 1 || level >= 3 ? 'phrase' : null) : null);
    const bc = {
      t0, level, section: level === 0 ? 'prowl' : kind, chord, chords, barInPhrase: this.phraseBar, phraseIdx: this.phraseIdx,
      riffBar: riffBar.map((e) => e), build: st.build, buildTo: st.buildTo, land: st.land, fill,
      buildChord: this.buildChord(),
    };
    this.barSide = { L: 0, R: 4 + this.hum() * 5 };
    if (this.hum() < 0.5) this.barSide = { L: this.barSide.R, R: 0 };
    this.applyMix(level, t0);
    this.playBar(bc);
    this.barInfo = { level, kind: bc.section, bar: this.bar, t0, build: st.build, land: st.land, chord, transpose: this.transpose };
    this.history.push(this.barInfo);
    if (this.history.length > 6) this.history.shift();
    this.prevLevel = st.build ? this.prevLevel : level;
    if (!st.build) { this.phraseBar = (this.phraseBar + 1) % 4; if (this.phraseBar === 0) this.phraseIdx++; }
    this.bar++;
    this.nextBar = t0 + this.barDur;
    if (this.onBar) this.onBar(this.barInfo);
  }

  /** The chord a build sits on: V in major and harmonic minor, bVII in natural minor and dorian. */
  buildChord() {
    const m = this.tune.mode;
    return m === 'major' || m === 'harmonic' ? 4 : 6;
  }

  menuIntensity() {
    // the menu plays Prowl, then Riff, alternating every 8 bars
    this.menuBars = (this.menuBars || 0) + 1;
    return Math.floor((this.menuBars - 1) / 8) % 2 === 0 ? 0.05 : 0.25;
  }

  /** Set every bus fader for a rung at t (a short glide so a change on the bar line doesn't click). */
  applyMix(level, t0, tc = 0.03) {
    const m = RUNG_DB[Math.max(0, Math.min(4, level))];
    for (const k of Object.keys(BUS_NODE)) this.mix.level(BUS_NODE[k], dbToGain(m[k] + (this.trim[k] || 0)), t0 - 0.005, tc);
  }

  playBar(bc) {
    const t = this.tune;
    const level = bc.level;
    const S = t.barSteps;
    const r = this.rng;
    // drums
    const evs = drumEvents({
      S, level: bc.build ? Math.max(2, level) : level, style: t.style, feel: t.drums.charge, top: t.drums.top,
      riff: bc.riffBar.map((e) => ({ t: e.s, k: e.k })), phraseBar: bc.barInPhrase, phraseIdx: bc.phraseIdx,
      section: bc.section, fill: bc.fill, build: bc.build ? t.drums.build : null, land: bc.land, r, menu: this.mode === 'menu',
    });
    evs.sort((a, b) => a.t - b.t);
    for (const e of evs) {
      if (this.simple && (e.p === 'hat_open' || e.p === 'china' || e.p === 'ride_bell') && level < 3) continue;
      const when = bc.t0 + e.t * this.stepDur;
      const tt = when + (e.p === 'kick' || e.p === 'snare' ? 0 : (this.hum() - 0.5) * 0.003);
      this.at(tt, (w) => this.drumPlayer.play(e, w));
    }
    // guitars and bass
    guitarBar(this, bc);
    bassBar(this, bc);
    // lead / featured voice: the hook from Battle up, in the chorus
    const pal = t.palette;
    if (bc.section === 'chorus' && level >= 3 && !bc.build) {
      const hv = pal.hook === 'horn' && (this.simple || !this.bank.has('horn_sus')) ? 'lead'
        : (pal.hook === 'fiddle' || pal.hook === 'whistle') && !this.bank.has(pal.hook) ? 'lead' : pal.hook;
      const harm = level >= 4 && hv === 'lead' && !this.simple;
      leadBar(this, bc, hv, harm);
    }
    // orchestra
    if (!this.simple) this.orchestra(bc);
    // viking: horn call into a build, a brief drone under Prowl's first phrase
    if (bc.build && pal.hornCalls && !this.simple && this.bank.has('horn_sus')) this.orch.hornCall(bc.t0, bc.buildChord);
    if (pal.drone && level === 0 && bc.barInPhrase === 0 && bc.phraseIdx === 0 && this.mode === 'match' && !this.simple) {
      this.orch.drone(bc.t0, this.barDur * 4);
    }
    if (bc.land && level >= 3 && !this.simple) this.orch.timp(t.key + this.rootOff(bc.chord) + this.transpose, bc.t0, 1);
  }

  orchestra(bc) {
    const t = this.tune, o = this.orch, level = bc.level, pal = t.palette;
    if (bc.build) {
      o.pad({ ...bc, chord: bc.buildChord }, 3, { crescendo: true });
      o.timpRoll(t.key + this.rootOff(bc.buildChord), bc.t0 + this.barDur * 0.5, this.barDur * 0.5, 0.25, 1);
      return;
    }
    if (level === 0) {
      if (bc.barInPhrase % 2 === 0) o.pad({ ...bc, padBars: 2 }, 0, { low: true });
      return;
    }
    if (level === 1) return; // the Riff rung is the band alone
    const strings = pal.orch === 'strings' || level >= 3;
    const brass = pal.orch === 'brass' || level >= 4 || (t.style === 'battle' && level >= 3);
    if (bc.section === 'bridge') {
      if (bc.barInPhrase % 2 === 0) o.pad({ ...bc, padBars: 2 }, level);
      if (bc.barInPhrase === 0) o.brassHold(bc, this.barDur * 2, 0.24);
      return;
    }
    if (strings) {
      if (t.style === 'battle' || (t.style === 'power' && level >= 3 && bc.section === 'verse')) o.ostinato(bc, level);
      else o.pad(bc, level);
    }
    if (brass) {
      if (t.style === 'power' && level >= 4 && bc.section === 'chorus' && bc.barInPhrase % 2 === 0) o.brassHold({ ...bc }, this.barDur * 2, 0.22);
      else if (t.style !== 'viking' || level >= 4) o.stabs(bc, level);
    }
    if (t.style === 'battle' && level >= 3 && bc.barInPhrase === 3) {
      o.timpRoll(t.key + this.rootOff(bc.chord), bc.t0 + this.barDur * 0.5, this.barDur * 0.5, 0.3, 0.9);
    }
    if (level >= 3 && bc.barInPhrase === 0) o.timp(t.key + this.rootOff(bc.chord) + this.transpose, bc.t0, 0.9);
  }

  // ------------------------------------------------------------------ moments
  /** Bar position of `now` (for state()). */
  position(now) {
    let b = null;
    for (const h of this.history) if (h.t0 <= now + 1e-4) b = h;
    if (!b) b = this.history[0] || this.barInfo;
    if (!b) return { bar: 0, beat: 0, info: null };
    const into = Math.max(0, now - b.t0);
    const beat = Math.floor(into / this.beatDur);
    return { bar: b.bar, beat: Math.min(beat, this.tune.barSteps / this.tune.spb - 1), info: b };
  }

  /** Round start: four stick clicks, then Prowl or Riff on the next bar line. */
  roundStart(now) {
    this.intensity.reset();
    this.ladder.reset(0);
    this.moment = null;
    this.pending = [];
    // stop what's planned beyond now, count in from a fresh bar
    this.voices.cutAll(now + 0.02, 0.12);
    this.queue = [];
    this.phraseBar = 0; this.phraseIdx = 0; this.prevLevel = null; this.history = [];
    this.transpose = 0;
    const t0 = now + 0.1;
    const bd = this.beatDur;
    this.applyMix(this.tune.introRiff ? 1 : 0, t0, 0.01);
    for (let i = 0; i < 4; i++) this.at(t0 + i * bd, (w) => this.drumPlayer.play({ p: 'sticks', v: i === 3 ? 1 : 0.85 }, w));
    this.nextBar = t0 + 4 * bd;
    // start on Riff if the tune opens with its riff
    if (this.tune.introRiff) { this.intensity.value = 0.2; this.ladder.reset(1); }
    this.playing = true;
    this.mode = 'match';
    if (!this.manual && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Final kill: the band stops dead on the blow with one huge hit that rings through the slow motion. */
  finalKill(now) {
    const t = now + 0.03;
    this.voices.cutAll(t, 0.01);
    this.queue = [];
    this.applyMix(4, t, 0.005);
    const tu = this.tune;
    const root = tu.key + this.transpose;
    this.drumPlayer.play({ p: 'kick', v: 1.1 }, t);
    this.drumPlayer.play({ p: 'kick_boom', v: 1 }, t);
    this.drumPlayer.play({ p: 'crash_big', v: 1.1 }, t);
    this.drumPlayer.play({ p: 'crash', v: 1 }, t + 0.004);
    this.drumPlayer.play({ p: 'china', v: 0.85 }, t + 0.002);
    if (tu.style === 'viking' || this.simple) this.drumPlayer.play({ p: 'war_drum', v: 1.1 }, t);
    guitarHit(this, t, 0, 2.4);
    bassHit(this, t, 0, 2.2);
    if (!this.simple) {
      this.orch.timp(root, t, 1.1);
      this.orch.short('tbn_stac', placeIn(root % 12, 41), t, 0.4);
      this.orch.short('tuba_stac', placeIn(root % 12, 34), t, 0.4);
      this.orch.short('horn_stac', placeIn(root % 12, 53), t, 0.38);
    }
    this.playing = false;
    this.moment = { kind: 'finalKill', until: t + 1.6 };
  }

  /** Round end: a 2-bar cadence (V to i, or bVI bVII i), then silence until the next round starts. */
  roundEnd(won, now) {
    const t0 = Math.max(now + 0.05, this.moment && this.moment.until ? this.moment.until - 0.3 : now + 0.05);
    const tu = this.tune;
    this.voices.cutAll(t0, 0.18);
    this.queue = [];
    this.transpose = 0;
    const bar = this.barDur;
    const minor = tu.mode !== 'major';
    const chords = won ? (minor ? [5, 6] : [3, 4]) : (minor ? [3, 4] : [5, 4]);
    this.applyMix(3, t0, 0.01);
    const half = bar / 2;
    // bar 1: two chords, half a bar each, on toms and crash; bar 2: the tonic held
    chords.forEach((c, i) => {
      const w = t0 + i * half;
      this.at(w, (x) => {
        guitarHold(this, x, c, half - 0.02);
        bassHit(this, x, c, half - 0.02);
        this.drumPlayer.play({ p: 'kick', v: 1 }, x);
        this.drumPlayer.play({ p: i ? 'crash2' : 'crash', v: 0.9 }, x);
        if (!this.simple) this.orch.timp(tu.key + this.rootOff(c), x, 0.85);
      });
      for (let k = 1; k < 4; k++) this.at(w + (k * half) / 4, (x) => this.drumPlayer.play({ p: k === 3 ? 'tom_lo' : 'tom_mid', v: 0.7 + k * 0.08 }, x));
    });
    this.at(t0 + bar, (x) => {
      guitarHold(this, x, 0, bar * 1.2);
      bassHit(this, x, 0, bar * 1.2);
      this.drumPlayer.play({ p: 'kick', v: 1.05 }, x);
      this.drumPlayer.play({ p: 'crash_big', v: 1 }, x);
      if (!this.simple) {
        this.orch.timp(tu.key, x, 1);
        this.orch.pad({ t0: x, chord: 0, padBars: 1.2 }, 3);
      }
    });
    this.playing = false;
    this.moment = { kind: 'roundEnd', until: t0 + bar * 2.4 };
  }

  /** Match end: a held final chord over a drum roll and a last hit. */
  matchEnd(now) {
    const tu = this.tune;
    const t0 = Math.max(now + 0.05, this.moment && this.moment.until ? Math.min(this.moment.until, now + 1.5) : now + 0.05);
    this.voices.cutAll(t0, 0.2);
    this.queue = [];
    this.transpose = 0;
    const hold = this.barDur * 2;
    this.applyMix(3, t0, 0.01);
    this.at(t0 + hold - 0.01, (x) => this.applyMix(4, x, 0.005));
    this.at(t0, (x) => {
      guitarHold(this, x, 0, hold, true);
      bassHit(this, x, 0, hold);
      this.drumPlayer.play({ p: 'crash', v: 0.95 }, x);
      this.drumPlayer.play({ p: 'kick', v: 1 }, x);
      this.drumPlayer.roll({ d: (hold / this.stepDur) * 0.95, v0: 0.35, v1: 1 }, x);
      if (!this.simple) {
        this.orch.pad({ t0: x, chord: 0, padBars: 2.1 }, 3, { crescendo: true });
        this.orch.timpRoll(tu.key, x, hold * 0.97, 0.3, 1);
      }
    });
    this.at(t0 + hold, (x) => {
      this.voices.cutAll(x, 0.01);
      this.drumPlayer.play({ p: 'kick', v: 1.1 }, x);
      this.drumPlayer.play({ p: 'kick_boom', v: 1 }, x);
      this.drumPlayer.play({ p: 'crash_big', v: 1.1 }, x);
      this.drumPlayer.play({ p: 'china', v: 0.85 }, x);
      guitarHit(this, x, 0, 3.2);
      bassHit(this, x, 0, 3);
      if (!this.simple) { this.orch.timp(tu.key, x, 1.1); this.orch.short('tuba_stac', placeIn(tu.key, 34), x, 0.4); }
    });
    this.playing = false;
    this.moment = { kind: 'matchEnd', until: t0 + hold + 3.5 };
  }

  state(now) {
    const p = this.position(now);
    const level = p.info ? p.info.level : 0;
    return {
      level, levelName: LEVELS[level], intensity: +this.intensity.update(now).toFixed(3), bpm: this.bpm,
      style: this.tune && this.tune.style, key: this.tune && this.tune.keyLabel, title: this.tune && this.tune.title,
      bar: p.bar, beat: p.beat, playing: this.playing || !!(this.moment && this.moment.until > now), mode: this.mode,
      section: this.moment && this.moment.until > now ? this.moment.kind : p.info ? p.info.kind : null,
      transpose: this.transpose,
    };
  }
}
