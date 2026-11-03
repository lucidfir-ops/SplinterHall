// Rhythm guitars, lead guitar and bass. The rhythm parts send DI samples into two amps panned hard left and
// right, each with its own timing offset and sample choice (real double-tracking); power chords are root,
// fifth and octave summed into the amp; chugs come from the palm-muted samples. The lead plays the hook on
// its own lighter amp, with slides, vibrato and a harmony in thirds at the peak.

import { degSemis, melodyScale } from './theory.js';

const MS = 0.001;

/** Play DI notes into one rhythm amp. notes: midi[]; k: 'P' | 'x' | 'n' | 'T' | 'hold'. */
function playDI(band, side, notes, when, dur, k, vel, o = {}) {
  const m = band.mix;
  const dest = side === 'L' ? m.gtrInL : m.gtrInR;
  if (!dest) return;
  const muted = k === 'x';
  const part = muted ? 'gtr_mute' : 'gtr_clean';
  // each side prefers a different source sample, so the two tracks really differ
  const prefer = side === 'L' ? 'below' : 'above';
  const n = notes.length;
  const g = (muted ? 0.9 : 0.72) * vel / Math.sqrt(n);
  let first = null;
  notes.forEach((midi, i) => {
    const s = band.bank.note(part, midi, prefer);
    if (!s) return;
    // strum: the root first, the fifth and octave a hair later (downstroke)
    const st = o.strum !== false && !muted ? i * 0.0018 : 0;
    const v = band.voices.play(s.f, s.rate, when + st, {
      dest, gain: g, dur: dur - st, release: muted ? 0.012 : o.release || 0.025,
      loop: !muted, choke: first ? null : 'g' + side, chokeFade: o.chokeFade || 0.012, prio: 3,
    });
    if (!first) first = v; else band.voices.join(v, 'g' + side);
  });
}

/** Both rhythm guitars, with independent timing. */
function rhythm(band, notes, when, dur, k, vel, o = {}) {
  const h = band.hum;
  const sideOff = band.barSide; // ms, this bar's L/R spread (4-9 ms apart)
  const jL = (h() - 0.5) * 1.6 * MS, jR = (h() - 0.5) * 1.6 * MS;
  const tL = when + (sideOff.L * MS) + jL, tR = when + (sideOff.R * MS) + jR;
  const vL = vel * (0.94 + h() * 0.08), vR = vel * (0.94 + h() * 0.08);
  playDI(band, 'L', notes, tL, dur, k, vL, o);
  if (!band.simple) playDI(band, 'R', notes, tR, dur, k, vR, o);
}

function powerChord(root) { return [root, root + 7, root + 12]; }

/** Rhythm guitars for one bar. */
export function guitarBar(band, bc) {
  const t = band.tune;
  const sd = band.stepDur;
  const at = (s) => bc.t0 + s * sd;
  const S = t.barSteps;
  if (bc.build) return buildGuitars(band, bc);

  if (bc.section === 'prowl') {
    if (t.palette.prowl === 'clean') return cleanArp(band, bc);
    // muted chugs on the root, on the riff's beat positions, quiet; no amp change
    const root = band.gtrMidi(band.rootOff(bc.chord));
    const beat = S === 16 ? 4 : 3;
    const evs = bc.riffBar.filter((e) => e.s % beat === 0 || e.s % (beat / 2) === 0);
    for (const e of evs) {
      const n = t.chugFifth ? [root, root + 7] : [root];
      band.at(at(e.s), (w) => rhythm(band, n, w, Math.min(e.d, 2) * sd * 0.92, 'x', 0.58 + (e.s === 0 ? 0.12 : 0)));
    }
    return;
  }

  if (bc.section === 'bridge') {
    // open chords, held: half a bar each, a muted push into the next
    const half = S / 2;
    for (const [s, c] of [[0, bc.chord], [half, bc.chords[(bc.barInPhrase * 2 + 1) % 4] ?? bc.chord]]) {
      const r = band.gtrMidi(band.rootOff(c));
      band.at(at(s), (w) => rhythm(band, powerChord(r), w, (half - 1) * sd, 'P', 1));
      band.at(at(s + half - 1), (w) => rhythm(band, [r], w, sd * 0.8, 'x', 0.75));
    }
    return;
  }

  const evs = bc.riffBar;
  const trem = t.barSteps === 12 ? 2 : band.bpm < 125 ? 1.5 : 1;
  for (const e of evs) {
    const semis = band.riffSemis(bc.chord, e);
    const root = band.gtrMidi(semis);
    const acc = e.s === 0 ? 1 : e.move ? 0.97 : 0.9;
    if (e.k === 'P') {
      band.at(at(e.s), (w) => rhythm(band, powerChord(root), w, e.d * sd - 0.004, 'P', acc));
    } else if (e.k === 'x') {
      const n = t.chugFifth ? [root, root + 7] : [root];
      band.at(at(e.s), (w) => rhythm(band, n, w, Math.min(e.d, 1.6) * sd, 'x', e.s % (S === 16 ? 4 : 3) === 0 ? 0.92 : 0.82));
    } else if (e.k === 'n') {
      band.at(at(e.s), (w) => rhythm(band, [root], w, e.d * sd - 0.004, 'n', 0.9));
    } else if (e.k === 'T') {
      const n = Math.max(1, Math.round(e.d * trem));
      const step = (e.d * sd) / n;
      const notes = t.tremVoicing === 'pc' ? [root, root + 7] : [root, root + 12];
      for (let i = 0; i < n; i++) {
        const v = (i % 2 ? 0.8 : 0.95) * (i === 0 ? 1.04 : 1);
        band.at(at(e.s) + i * step, (w) => rhythm(band, notes, w, step * 0.97, 'T', v, { strum: false, chokeFade: 0.006 }));
      }
    }
  }
}

function cleanArp(band, bc) {
  const t = band.tune;
  const sd = band.stepDur;
  const S = t.barSteps;
  const root = band.gtrMidi(band.rootOff(bc.chord)) + 12;
  const sc = melodyScale(t, bc.chord);
  const third = degSemis(sc, bc.chord + 2) - degSemis(sc, bc.chord);
  const pat = S === 16 ? [0, 7, 12, third + 12, 12, 7, 0, 7] : [0, 7, 12, third + 12, 12, 7];
  const every = S === 16 ? 2 : 2;
  pat.forEach((iv, i) => {
    const s = i * every;
    const midi = root + iv + band.transpose;
    band.at(bc.t0 + s * sd, (w) => {
      const n = band.bank.note('gtr_clean', midi, 'near');
      if (!n) return;
      band.voices.play(n.f, n.rate, w, { dest: band.mix.clean, gain: i === 0 ? 0.62 : 0.48, dur: sd * every * 3, release: 0.25, loop: true, prio: 2 });
    });
  });
}

function buildGuitars(band, bc) {
  const sd = band.stepDur;
  const S = band.tune.barSteps;
  const root = band.gtrMidi(band.rootOff(bc.buildChord));
  const at = (s) => bc.t0 + s * sd;
  band.at(at(0), (w) => rhythm(band, powerChord(root), w, (S / 2) * sd - 0.004, 'P', 1));
  const sub = S === 16 ? 1 : 1;
  for (let s = S / 2; s < S; s += sub) {
    const v = 0.72 + (0.28 * (s - S / 2)) / (S / 2);
    band.at(at(s), (w) => rhythm(band, band.tune.chugFifth ? [root, root + 7] : [root], w, sd * 0.9, 'x', v));
  }
}

/** The big hit: a low power chord on both amps, ringing. */
export function guitarHit(band, when, chordRoot = 0, dur = 2.6) {
  const r = band.gtrMidi(band.rootOff(chordRoot));
  rhythm(band, powerChord(r), when, dur, 'P', 1.05, { release: 0.6 });
}

/** A held chord (cadences, the match end), optionally tremolo picked. */
export function guitarHold(band, when, chordRoot, dur, tremolo = false) {
  const r = band.gtrMidi(band.rootOff(chordRoot));
  if (!tremolo) return rhythm(band, powerChord(r), when, dur, 'P', 1, { release: 0.5 });
  const step = band.stepDur / (band.tune.barSteps === 12 ? 2 : 1);
  const n = Math.floor(dur / step);
  for (let i = 0; i < n; i++) {
    band.at(when + i * step, (w) => rhythm(band, [r, r + 7], w, step * 0.97, 'T', (i % 2 ? 0.8 : 0.95) * (0.75 + 0.25 * i / n), { strum: false, chokeFade: 0.006 }));
  }
}

// ------------------------------------------------------------------------------------------- bass
function bassNote(band, midi, when, dur, vel, o = {}) {
  const s = band.bank.note('bass', midi, 'near');
  if (!s) return;
  band.voices.play(s.f, s.rate, when + 0.0015, {
    dest: band.mix.bassIn, gain: 0.95 * vel, dur, release: o.release || 0.03, loop: true, choke: 'bass', chokeFade: 0.012, prio: 4,
  });
}

export function bassBar(band, bc) {
  const t = band.tune;
  const sd = band.stepDur;
  const S = t.barSteps;
  const at = (s) => bc.t0 + s * sd;
  const beat = S === 16 ? 4 : 3;
  if (bc.build) {
    const r = band.bassMidi(band.rootOff(bc.buildChord));
    band.at(at(0), (w) => bassNote(band, r, w, (S / 2) * sd, 1));
    for (let s = S / 2; s < S; s += 2) band.at(at(s), (w) => bassNote(band, r, w, sd * 1.8, 0.75 + (0.25 * (s - S / 2)) / (S / 2)));
    return;
  }
  if (bc.section === 'prowl') {
    const r = band.bassMidi(band.rootOff(bc.chord));
    band.at(at(0), (w) => bassNote(band, r, w, beat * 2 * sd, 0.7, { release: 0.2 }));
    if (bc.barInPhrase % 2 === 1) band.at(at(S - beat), (w) => bassNote(band, r, w, beat * sd * 0.9, 0.55));
    return;
  }
  if (bc.section === 'bridge') {
    const half = S / 2;
    for (const [s, c] of [[0, bc.chord], [half, bc.chords[(bc.barInPhrase * 2 + 1) % 4] ?? bc.chord]]) {
      const r = band.bassMidi(band.rootOff(c));
      band.at(at(s), (w) => bassNote(band, r, w, half * sd - 0.01, 1, { release: 0.08 }));
    }
    return;
  }
  const type = t.riff.type;
  const eighths = bc.level >= 3 && (type === 'tremolo' || type === 'chords' || type === 'stomp');
  if (type === 'tremolo' || eighths) {
    // eighth notes on the riff's chord roots, accents on the beats
    const evs = bc.riffBar;
    const sub = S === 16 ? 2 : 1;
    for (let s = 0; s < S; s += sub) {
      let e = evs[0];
      for (const x of evs) if (x.s <= s) e = x;
      const r = band.bassMidi(band.riffSemis(bc.chord, { ...e, k: 'P' }));
      band.at(at(s), (w) => bassNote(band, r, w, sub * sd * 0.92, s % beat === 0 ? 1 : 0.82));
    }
  } else {
    for (const e of bc.riffBar) {
      const r = band.bassMidi(band.riffSemis(bc.chord, e));
      const dur = e.k === 'x' ? Math.min(e.d, 1.5) * sd : e.d * sd - 0.006;
      band.at(at(e.s), (w) => bassNote(band, r, w, dur, e.k === 'P' ? 1 : 0.85));
    }
  }
  if (bc.land) {
    const r = band.bassMidi(band.rootOff(bc.chord));
    band.at(at(0), (w) => bassNote(band, r, w, beat * sd, 1.15));
  }
}

export function bassHit(band, when, chordRoot = 0, dur = 2.6) {
  bassNote(band, band.bassMidi(band.rootOff(chordRoot)), when, dur, 1.15, { release: 0.6 });
}

// ------------------------------------------------------------------------------------------- lead
export function leadNote(band, midi, when, dur, o = {}) {
  const dest = o.harmony ? band.mix.lead2In : band.mix.leadIn;
  const s = band.bank.note('gtr_clean', midi, 'near');
  if (!s) return;
  const long = dur > band.stepDur * 2.5;
  band.voices.play(s.f, s.rate, when, {
    dest, gain: (o.gain || 0.85), dur, release: long ? 0.09 : 0.04, loop: true, choke: o.harmony ? 'lead2' : 'lead',
    chokeFade: 0.02, prio: 4,
    vib: long ? { depth: o.harmony ? 16 : 22, rate: 5.6, delay: Math.min(0.28, dur * 0.35) } : null,
    slide: o.slide ? { semis: o.slide, time: 0.06 } : null,
  });
}

/** The hook as lead-guitar notes for one bar. which: 'lead' or 'harmony'. */
export function hookNotes(band, bc, bar) {
  const t = band.tune;
  const out = [];
  for (const n of t.hook) {
    if (n.bar !== bar) continue;
    const sc = melodyScale(t, bc.chord);
    out.push({ s: n.s, d: n.d, deg: n.deg, semi: degSemis(sc, n.deg), sc });
  }
  return out;
}

/**
 * The hook for one bar. voice: 'lead' (lead guitar) or a folk voice ('fiddle', 'whistle') or 'horn'.
 * harmony: true adds the lead guitar's harmony a diatonic third above (the peak device for the lead).
 */
export function leadBar(band, bc, voice = 'lead', harmony = false) {
  const sd = band.stepDur;
  const notes = hookNotes(band, bc, bc.barInPhrase);
  const base = band.leadTonic(voice) + band.transpose;
  let prev = band.lastLead[voice];
  for (const n of notes) {
    const midi = base + n.semi;
    const dur = n.d * sd - 0.01;
    const when = bc.t0 + n.s * sd;
    let slide = 0;
    if (prev != null && Math.abs(midi - prev) >= 3 && Math.abs(midi - prev) <= 7 && band.hum() < 0.35) slide = prev - midi;
    else if (n.s === 0 && bc.barInPhrase === 0 && band.hum() < 0.5) slide = -2;
    if (voice === 'lead') band.at(when, (w) => leadNote(band, midi, w, dur, { slide }));
    else band.at(when, (w) => band.voice(voice, midi, w, dur, { slide: Math.abs(slide) <= 2 ? slide : 0 }));
    if (harmony) {
      const hmidi = band.leadTonic('lead') + band.transpose + degSemis(n.sc, n.deg + 2);
      band.at(when + 0.007, (w) => leadNote(band, hmidi, w, dur, { harmony: true, gain: 0.68, slide: Math.abs(slide) <= 2 ? slide : 0 }));
    }
    prev = midi;
  }
  band.lastLead[voice] = prev;
}
