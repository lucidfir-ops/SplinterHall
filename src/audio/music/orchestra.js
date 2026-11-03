// Orchestra and folk voices. Strings: a low pad in Prowl, a sustained pad or a spiccato ostinato in the
// fight, crescendos into builds. Brass: stabs on the riff's accents (battle), held chords at the peak (power),
// horn calls into builds (viking). Timpani hits and rolls. Folk: the featured voice plays the hook; a bagpipe
// drone only briefly as colour. A new voice takes over a part rather than stacking on top of it.

import { degSemis, melodyScale, placeIn } from './theory.js';

/** Chord tones of a chord (semitones above the tonic, unplaced). */
function triad(tune, deg) {
  const sc = melodyScale(tune, deg);
  return [degSemis(sc, deg), degSemis(sc, deg + 2), degSemis(sc, deg + 4)];
}

/** Voice a chord as MIDI notes in [lo, hi] with smooth voice leading from `prev`. */
function voiceChord(tune, deg, lo, n, prev) {
  const pcs = triad(tune, deg).map((x) => (((x + tune.key) % 12) + 12) % 12);
  const notes = [];
  let p = placeIn(pcs[0], lo);
  notes.push(p);
  let i = 1;
  while (notes.length < n) {
    const pc = pcs[i % 3];
    let q = placeIn(pc, notes[notes.length - 1] + 1);
    notes.push(q);
    i++;
  }
  if (prev && prev.length === n) {
    // move each voice to the nearest octave of its target that stays ordered
    const out = notes.map((m, k) => {
      let best = m, bd = 99;
      for (const o of [-12, 0, 12]) { const c = m + o; if (c >= lo - 2 && Math.abs(c - prev[k]) < bd) { bd = Math.abs(c - prev[k]); best = c; } }
      return best;
    }).sort((a, b) => a - b);
    return out;
  }
  return notes;
}

export class Orchestra {
  constructor(band) {
    this.band = band;
    this.prevPad = null;
  }

  sus(part, midi, when, dur, gain, o = {}) {
    const b = this.band;
    const s = b.bank.note(part, midi, 'near');
    if (!s) return null;
    const dest = part.startsWith('str') ? b.mix.strings : part === 'fiddle' || part === 'whistle' ? b.mix.folk
      : part === 'bagpipe' ? b.mix.drone : b.mix.brass;
    return b.voices.play(s.f, s.rate, when, {
      dest, gain, dur, release: o.release || 0.35, loop: true, attack: o.attack != null ? o.attack : 0.12, prio: o.prio || 2,
      ramp: o.ramp, choke: o.choke, chokeFade: 0.08, vib: o.vib, slide: o.slide,
    });
  }

  short(part, midi, when, gain, o = {}) {
    const b = this.band;
    const s = b.bank.note(part, midi, 'near');
    if (!s) return null;
    const dest = part.startsWith('str') ? b.mix.strings : b.mix.brass;
    return b.voices.play(s.f, s.rate, when, { dest, gain, dur: o.dur, release: o.release || 0.08, prio: 2 });
  }

  /** Strings pad for the bar (or the bar's chord pair). */
  pad(bc, level, { crescendo = false, low = false } = {}) {
    const b = this.band, t = b.tune;
    const dur = b.barDur * (bc.padBars || 1) + 0.15;
    const lo = low ? 40 + ((t.key + 120 - 40) % 12) : 52;
    const n = low ? 2 : 3;
    const chord = voiceChord(t, bc.chord, lo, n, this.prevPad && this.prevPad.length === n ? this.prevPad : null).map((m) => m + b.transpose);
    this.prevPad = chord.map((m) => m - b.transpose);
    const g = (low ? 0.3 : level >= 3 ? 0.36 : 0.3) / Math.sqrt(n);
    const ramp = crescendo ? [{ t: bc.t0 + dur * 0.92, v: 2.6 }] : null;
    const bass = placeIn(((triad(t, bc.chord)[0] + t.key) % 12 + 12) % 12, 36) + b.transpose;
    b.at(bc.t0, (w) => {
      for (const m of chord) this.sus('str_sus', m, w, dur, g, { attack: crescendo ? 0.05 : low ? 0.6 : 0.18, ramp, release: 0.5 });
      if (!low && level >= 3) this.sus('str_sus', bass, w, dur, 0.22, { attack: 0.12, release: 0.5 });
    });
  }

  /** Spiccato ostinato on eighths: root and fifth (low) alternating with the third (high). */
  ostinato(bc, level) {
    const b = this.band, t = b.tune;
    const S = t.barSteps, sub = 2;
    const tr = triad(t, bc.chord);
    const low = placeIn(((tr[0] + t.key) % 12 + 12) % 12, 43) + b.transpose;
    const fig = S === 16 ? [0, 12, 7, 12, 0, 12, 7, 12] : [0, 12, 7, 0, 12, 7];
    const third = tr[1] - tr[0];
    const pat = fig.map((x, i) => (i % 4 === 3 && level >= 4 ? low + 12 + third : low + x));
    pat.forEach((m, i) => {
      const s = S === 16 ? i * sub : i * 2;
      const v = (i % (S === 16 ? 4 : 3) === 0 ? 0.42 : 0.32) * (level >= 4 ? 1.1 : 1);
      b.at(bc.t0 + s * b.stepDur, (w) => this.short('str_spic', m, w, v));
    });
  }

  /** Brass stabs on the riff's accents (P chords), two-note voicing (horns and trombones), tuba on the root. */
  stabs(bc, level) {
    const b = this.band, t = b.tune;
    const accents = bc.riffBar.filter((e) => e.k === 'P' && (e.s === 0 || e.move));
    const take = level >= 4 ? accents : accents.slice(0, 2);
    for (const e of take) {
      const semis = b.riffSemis(bc.chord, e);
      const tr = triad(t, bc.chord + (e.deg || 0));
      const root = placeIn(((semis + t.key) % 12 + 12) % 12, 46) + b.transpose;
      const fifth = root + 7;
      const third = placeIn(((tr[1] + t.key) % 12 + 12) % 12, root + 1);
      const when = bc.t0 + e.s * b.stepDur;
      const dur = Math.min(e.d, 3) * b.stepDur;
      const v = e.s === 0 ? 0.36 : 0.3;
      b.at(when, (w) => {
        this.short('horn_stac', root + 12, w, v);
        this.short('horn_stac', third + 12, w, v * 0.85);
        this.short('tbn_stac', root, w, v * 0.9);
        this.short('tbn_stac', fifth, w, v * 0.75);
        if (level >= 3) this.short('tuba_stac', root - 12, w, v * 0.85);
        if (level >= 4 && e.s === 0) this.short('tpt_stac', root + 24, w, v * 0.6);
      });
      void dur;
    }
  }

  /** Held brass chord (power-metal peak, cadences). */
  brassHold(bc, dur, gain = 0.26) {
    const b = this.band, t = b.tune;
    const chord = voiceChord(t, bc.chord, 50, 3, null).map((m) => m + b.transpose);
    b.at(bc.t0, (w) => {
      for (const m of chord) this.sus('horn_sus', m, w, dur, gain / Math.sqrt(3), { attack: 0.08, release: 0.4 });
    });
  }

  /** Horn call: a rising fifth and octave on the tonic, played into a build (viking). */
  hornCall(when, chordRoot = 0) {
    const b = this.band, t = b.tune;
    const r = placeIn(((degSemis(melodyScale(t, chordRoot), chordRoot) + t.key) % 12 + 12) % 12, 46) + b.transpose;
    const bd = b.beatDur;
    const fig = [[r, 0, 1.4], [r + 7, 1.5, 1.4], [r + 12, 3, 3.2]];
    for (const [m, s, d] of fig) {
      b.at(when + s * bd, (w) => {
        this.sus('horn_sus', m, w, d * bd, 0.34, { attack: 0.06, release: 0.3, prio: 3 });
        this.sus('horn_sus', m - 12, w, d * bd, 0.2, { attack: 0.06, release: 0.3, prio: 3 });
      });
    }
  }

  timp(midiPc, when, vel = 1) {
    const b = this.band;
    const m = placeIn(((midiPc % 12) + 12) % 12, 41);
    const s = b.bank.note('timpani', m, 'near', vel);
    if (!s) return;
    b.voices.play(s.f, s.rate, when, { dest: b.mix.perc, gain: 0.85 * Math.pow(vel, 1.4), prio: 4, choke: 'timp', chokeFade: 0.15 });
    b.mix.duckBass(when, 2);
  }

  timpRoll(midiPc, when, dur, v0 = 0.3, v1 = 1) {
    const b = this.band;
    const s = b.bank.note('timpani_roll', placeIn(((midiPc % 12) + 12) % 12, 41), 'near');
    if (!s) {
      const n = Math.floor(dur / 0.06);
      for (let i = 0; i < n; i++) this.timp(midiPc, when + i * 0.06, v0 + ((v1 - v0) * i) / n);
      return;
    }
    b.voices.play(s.f, s.rate, when, {
      dest: b.mix.perc, gain: 0.7 * v0, dur, loop: true, release: 0.05, fadeIn: 0.05, prio: 3,
      ramp: [{ t: when + dur * 0.97, v: v1 / v0 }],
    });
  }

  /** The featured folk voice playing a note of the hook. */
  folkNote(voice, midi, when, dur, o = {}) {
    const part = voice === 'horn' ? 'horn_sus' : voice;
    const long = dur > this.band.stepDur * 2.5;
    const g = voice === 'whistle' ? 0.42 : voice === 'horn' ? 0.36 : 0.4;
    this.sus(part, midi, when, dur, g, {
      attack: voice === 'fiddle' ? 0.04 : 0.03, release: voice === 'fiddle' ? 0.12 : 0.08, prio: 4, choke: 'folk',
      vib: long && voice !== 'whistle' ? { depth: 14, rate: 5.2, delay: 0.2 } : null, slide: o.slide ? { semis: o.slide, time: 0.07 } : null,
    });
  }

  /** A brief bagpipe drone on the tonic and fifth (viking intros only). */
  drone(when, dur) {
    const b = this.band, t = b.tune;
    const r = placeIn(t.key, 45);
    b.at(when, (w) => {
      this.sus('bagpipe', r, w, dur, 0.2, { attack: 0.5, release: 1.2, choke: 'drone' });
      this.sus('bagpipe', r + 7 > 54 ? r - 5 : r + 7, w, dur, 0.15, { attack: 0.6, release: 1.2 });
    });
  }
}
