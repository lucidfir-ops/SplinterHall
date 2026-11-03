// Drums: per-bar patterns for every rung (beats, half-time, double kick, blast beats, war drums), fills and
// builds, and the player that turns hits into voices with velocity layers, round robins and choke groups.

import { chance, pick } from './rng.js';

const TOP = new Set(['hat', 'hat_open', 'hat_pedal', 'ride', 'ride_bell', 'crash', 'crash_big', 'china', 'splash']);

/** Velocity (0..1) to gain: about 22 dB from the softest to the hardest hit. */
export const velGain = (v) => Math.pow(10, ((Math.max(0.05, Math.min(1.15, v)) - 1) * 22) / 20);

function grid(S) {
  return S === 16
    ? { beats: [0, 4, 8, 12], eighths: [0, 2, 4, 6, 8, 10, 12, 14], back: [4, 12], half: 8, last: 12, lastHalf: 8 }
    : { beats: [0, 3, 6, 9], eighths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], back: [3, 9], half: 6, last: 9, lastHalf: 6 };
}

/** Tom fill from step `from` to the end of the bar (16ths in 4/4, 8ths in 12/8). */
function tomFill(ev, S, from, r, vStart = 0.78, vEnd = 1) {
  const n = S - from;
  const toms = ['tom_hi', 'tom_mid', 'tom_lo'];
  const shape = pick(r, ['down', 'down', 'pairs', 'snare-down']);
  for (let i = 0; i < n; i++) {
    const t = from + i;
    const v = vStart + ((vEnd - vStart) * i) / Math.max(1, n - 1);
    let p;
    if (shape === 'pairs') p = toms[Math.min(2, Math.floor((i / n) * 3))];
    else if (shape === 'snare-down') p = i < n / 3 ? 'snare' : toms[Math.min(2, Math.floor(((i - n / 3) / (n * 0.67)) * 3))];
    else p = toms[Math.min(2, Math.floor((i / n) * 3))];
    ev.push({ t, p, v });
  }
  // kick under the fill's beats
  for (let t = from; t < S; t += S === 16 ? 4 : 3) ev.push({ t, p: 'kick', v: 0.85 });
}

function snareFill(ev, S, from, vStart = 0.55, vEnd = 0.95) {
  const n = S - from;
  for (let i = 0; i < n; i++) ev.push({ t: from + i, p: 'snare', v: vStart + ((vEnd - vStart) * i) / Math.max(1, n - 1) });
}

/** Remove the beat's events from step `from` on, keeping crashes that ring from before. */
function clearFrom(ev, from) {
  return ev.filter((e) => e.t < from);
}

/**
 * Drum events for one bar. c: { S, level, style, feel, top, riff (rhythm events: {t, k}), phraseBar, phraseIdx,
 * section, fill ('phrase'|'big'|'drop'|null), build ('toms'|'roll'|null), land, peak, r, menu }
 */
export function drumEvents(c) {
  const { S, level, style, r } = c;
  const G = grid(S);
  let ev = [];
  const add = (t, p, v) => ev.push({ t, p, v });

  if (c.build) return buildDrums(c, G);

  const riffHits = (c.riff || []).filter((e) => e.k === 'P' || e.k === 'x').map((e) => e.t);
  const riffAccents = (c.riff || []).filter((e) => e.k === 'P').map((e) => e.t);

  if (level === 0) {
    if (style === 'viking') {
      add(0, 'war_drum', 0.82);
      if (c.phraseBar % 2 === 1) add(G.half, 'war_drum', 0.58);
      if (c.phraseBar === 3) { add(S - (S === 16 ? 4 : 3), 'war_tom', 0.5); add(S - (S === 16 ? 2 : 1), 'war_tom', 0.62); }
    } else {
      add(0, 'kick', 0.82);
      add(G.half, 'kick', 0.62);
      if (c.phraseBar === 3) { add(S - (S === 16 ? 4 : 3), 'tom_lo', 0.5); add(S - (S === 16 ? 2 : 1), 'tom_lo', 0.62); }
    }
  } else if (level === 1) {
    // half-time: kick on 1 and with the riff's first accents, snare on 3
    add(0, 'kick', 0.95);
    for (const t of riffAccents) if (t > 0 && t !== G.half && t < S - 1) add(t, 'kick', t < G.half ? 0.8 : 0.72);
    add(G.half, 'snare', 0.92);
    if (c.top === 'ride') for (const t of G.beats) add(t, 'ride', t === 0 ? 0.68 : 0.55);
    else for (const t of G.eighths) add(t, 'hat', G.beats.includes(t) ? 0.62 : 0.42);
    if (c.phraseBar === 3 && c.phraseIdx % 2 === 1 && !c.menu) {
      ev = clearFrom(ev, G.last);
      snareFill(ev, S, G.last, 0.5, 0.85);
    }
  } else if (level === 2) {
    const feel = c.feel;
    if (feel === 'lock' && riffHits.length) {
      for (const t of riffHits) add(t, 'kick', G.beats.includes(t) ? 0.9 : 0.8);
    } else if (feel === 'skank' && S === 16) {
      for (const t of G.beats) add(t, 'kick', 0.9);
      for (const t of [2, 6, 10, 14]) add(t, 'snare', t === 6 || t === 14 ? 0.95 : 0.85);
    } else if (feel === 'stomp') {
      for (const t of S === 16 ? [0, 3, 8, 11] : [0, 2, 6, 8]) add(t, 'kick', t === 0 ? 0.95 : 0.85);
      if (c.phraseBar % 2 === 1) add(S - (S === 16 ? 2 : 1), 'tom_lo', 0.75);
    } else {
      for (const t of S === 16 ? [0, 7, 8, 10] : [0, 5, 6]) add(t, 'kick', t === 0 || t === G.half ? 0.92 : 0.8);
    }
    if (!(feel === 'skank' && S === 16)) for (const t of G.back) add(t, 'snare', 0.95);
    if (c.top === 'ride' || feel === 'skank') {
      for (const t of G.beats) add(t, 'ride', 0.62);
      if (feel !== 'skank') add(0, 'ride_bell', 0.5);
    } else {
      for (const t of G.eighths) add(t, 'hat', G.beats.includes(t) ? 0.66 : 0.46);
      if (c.phraseBar === 1 && S === 16) { ev = ev.filter((e) => !(e.p === 'hat' && e.t === 14)); add(14, 'hat_open', 0.6); }
    }
    if (c.phraseBar === 0) add(0, 'crash', 0.88);
  } else if (level === 3) {
    if (style === 'viking' && S === 16) for (const t of G.eighths) add(t, 'kick', G.beats.includes(t) ? 0.85 : 0.74);
    else for (let t = 0; t < S; t++) add(t, 'kick', G.beats.includes(t) ? 0.82 : t % 2 ? 0.68 : 0.74);
    for (const t of G.back) add(t, 'snare', 1);
    if (c.phraseBar === 0 || c.phraseBar === 2) add(0, 'crash', 0.9);
    else add(0, 'china', 0.78);
    for (const t of G.beats) if (t) add(t, c.top === 'ride' ? 'ride' : 'hat_open', c.top === 'ride' ? 0.66 : 0.5);
    if (c.top !== 'ride') ev = ev.filter((e) => e.p !== 'hat_open' || e.t !== G.last || c.phraseBar !== 3);
  } else {
    // Crescendo: the style's peak device
    const bridge = c.section === 'bridge';
    if (bridge) {
      // a huge half-time against the double kick
      for (let t = 0; t < S; t++) add(t, 'kick', G.beats.includes(t) ? 0.85 : 0.7);
      add(G.half, 'snare', 1);
      for (const t of G.beats) add(t, t === 0 ? 'crash' : 'china', t === 0 ? 0.95 : 0.7);
    } else if (style === 'battle' && c.phraseBar < 3 && S === 16) {
      // bomb blast: 16th double kick under 8th-note snares, crash and ride on the beats
      for (let t = 0; t < S; t++) add(t, 'kick', t % 4 === 0 ? 0.8 : 0.68);
      for (const t of G.eighths) add(t, 'snare', G.back.includes(t) ? 0.98 : 0.8);
      add(0, 'crash', 0.95);
      for (const t of G.beats) if (t) add(t, 'ride', 0.7);
      add(G.half, 'china', 0.75);
    } else if (style === 'viking') {
      for (const t of G.beats) add(t, 'war_drum', t === 0 ? 1 : 0.84);
      for (const t of S === 16 ? [2, 6, 10, 14] : [2, 5, 8, 11]) add(t, 'war_tom', 0.72);
      for (const t of G.eighths) add(t, 'kick', G.beats.includes(t) ? 0.82 : 0.7);
      for (const t of G.back) add(t, 'snare', 1);
      add(0, 'crash', 0.95);
      add(G.half, 'crash', 0.82);
    } else {
      // power: double kick, crashes on every beat, alternating sides
      for (let t = 0; t < S; t++) add(t, 'kick', G.beats.includes(t) ? 0.82 : t % 2 ? 0.68 : 0.74);
      for (const t of G.back) add(t, 'snare', 1);
      G.beats.forEach((t, i) => add(t, i % 2 ? 'crash2' : 'crash', t === 0 ? 0.95 : 0.78));
      if (c.phraseBar % 2 === 1) add(S === 16 ? 14 : 10, 'china', 0.7);
    }
  }

  // fills
  if (c.fill && level >= 1) {
    const from = c.fill === 'big' || c.fill === 'drop' ? G.lastHalf : G.last;
    ev = clearFrom(ev, from);
    if (c.fill === 'phrase' && level <= 2 && chance(r, 0.5)) snareFill(ev, S, from, 0.55, 0.92);
    else tomFill(ev, S, from, r, level >= 3 ? 0.82 : 0.72, 1);
  }
  if (c.land) {
    ev = ev.filter((e) => !(e.t === 0 && (e.p === 'crash' || e.p === 'china' || e.p === 'crash2')));
    add(0, level >= 4 ? 'crash_big' : 'crash', 1);
    if (level >= 3) add(0, 'china', 0.7);
    if (!ev.some((e) => e.t === 0 && e.p === 'kick')) add(0, 'kick', 1);
  }
  return ev;
}

function buildDrums(c, G) {
  const { S, r } = c;
  const ev = [];
  const add = (t, p, v) => ev.push({ t, p, v });
  for (const t of G.beats) add(t, 'kick', 0.85);
  if (c.build === 'roll') {
    ev.push({ t: 0, p: 'roll', d: S, v0: 0.3, v1: 1 });
    for (let t = G.last; t < S; t++) add(t, 'snare', 0.85 + (0.15 * (t - G.last)) / (S - G.last));
  } else {
    const n = G.lastHalf;
    for (let t = 0; t < n; t += S === 16 ? 2 : 1) add(t, 'snare', 0.5 + (0.3 * t) / n);
    tomFill(ev, S, G.lastHalf, r, 0.82, 1);
  }
  ev.push({ t: 0, p: 'swell', land: S });
  return ev;
}

// ------------------------------------------------------------------------------------------------ player
const ROUTE = {
  kick: 'kick', kick_boom: 'kick', snare: 'snare', sticks: 'snare', tom_hi: 'tom0', tom_mid: 'tom1', tom_lo: 'tom2',
  hat: 'hats', hat_open: 'hats', hat_pedal: 'hats', ride: 'cymC', ride_bell: 'cymC', crash: 'cymL', crash2: 'cymR',
  crash_big: 'cymC', china: 'cymR', splash: 'cymL', swell: 'cymC', war_drum: 'perc', war_tom: 'perc', frame_drum: 'perc',
};
// level of each piece relative to the drum bus (the mix sets the bus)
const LEVEL = {
  kick: 1.0, kick_boom: 0.8, snare: 1.5, sticks: 0.45, tom_hi: 0.95, tom_mid: 0.98, tom_lo: 1.0, hat: 0.7, hat_open: 0.58,
  hat_pedal: 0.5, ride: 0.7, ride_bell: 0.58, crash: 0.66, crash2: 0.62, crash_big: 0.75, china: 0.45, splash: 0.45, swell: 0.55,
  war_drum: 0.95, war_tom: 0.8, frame_drum: 0.6, roll: 0.8,
};
const CHOKE = {
  kick: ['kick', 0.03], kick_boom: ['kickb', 0.05], snare: ['sn', 0.05], tom_hi: ['t0', 0.06], tom_mid: ['t1', 0.06],
  tom_lo: ['t2', 0.06], hat: ['hh', 0.01], hat_open: ['hh', 0.01], hat_pedal: ['hh', 0.01], ride: ['ride', 0.25],
  crash: ['crL', 0.35], crash2: ['crR', 0.35], china: ['ch', 0.3], war_drum: ['wd', 0.12], war_tom: ['wt', 0.08],
  frame_drum: ['fd', 0.08],
};
const PRIO = { kick: 5, snare: 5, crash: 3, crash2: 3, crash_big: 4, war_drum: 4, hat: 2, ride: 2, sticks: 4 };

export class DrumPlayer {
  constructor(band) { this.band = band; }

  dest(p) {
    const m = this.band.mix;
    switch (ROUTE[p]) {
      case 'kick': return m.kick;
      case 'snare': return m.snare;
      case 'tom0': return m.tomIn[0];
      case 'tom1': return m.tomIn[1];
      case 'tom2': return m.tomIn[2];
      case 'hats': return m.hats;
      case 'cymL': return m.cymIn.L;
      case 'cymR': return m.cymIn.R;
      case 'cymC': return m.cymIn.C;
      case 'perc': return m.perc;
      default: return m.drums;
    }
  }

  play(ev, t) {
    const b = this.band;
    const p = ev.p;
    if (p === 'roll') return this.roll(ev, t);
    if (p === 'swell') return this.swell(ev, t);
    const part = p === 'crash2' ? 'crash' : p;
    const simple = b.simple;
    const h = b.bank.hit(part, ev.v, !simple);
    if (!h) return;
    // crash2 is the other cymbal: the second round robin of the crash part
    let f = h.f;
    if (part === 'crash') {
      const fs = b.bank.parts.get('crash').files;
      if (fs.length > 1) f = fs[p === 'crash2' ? 1 : 0];
    }
    const [choke, cf] = CHOKE[p] || [];
    // a real drummer never hits twice the same: about +-0.5 dB and +-0.8% pitch per hit (cosmetic, per device)
    const hv = b.hum() - 0.5, hp = b.hum() - 0.5;
    const g = (LEVEL[p] || 0.5) * velGain(ev.v) * (ev.g || 1) * (1 + hv * 0.12);
    const rate = h.rate * (ev.rate || 1) * (1 + hp * 0.016);
    b.voices.play(f, rate, t, { dest: this.dest(p), gain: g, choke, chokeFade: cf, prio: PRIO[p] || 3 });
    if (p === 'kick' || p === 'kick_boom' || p === 'war_drum') b.mix.duckBass(t, p === 'kick' ? 3.5 : 2.5);
  }

  roll(ev, t) {
    const b = this.band;
    const h = b.bank.hit('snare_roll', 1);
    if (!h) { // no roll sample: fall back to fast snares
      const n = Math.round(ev.d * 2);
      for (let i = 0; i < n; i++) this.play({ p: 'snare', v: ev.v0 + ((ev.v1 - ev.v0) * i) / n }, t + (i * b.stepDur) / 2);
      return;
    }
    const dur = ev.d * b.stepDur;
    const g = LEVEL.roll;
    b.voices.play(h.f, 1, t, {
      dest: b.mix.snare, gain: g * velGain(ev.v0), loop: true, dur, release: 0.02, prio: 4, fadeIn: 0.02,
      ramp: [{ t: t + dur * 0.98, v: velGain(ev.v1) / velGain(ev.v0) }],
    });
  }

  swell(ev, t) {
    const b = this.band;
    const part = b.bank.parts.get('swell');
    if (!part || !part.files.length) return;
    const land = t + ev.land * b.stepDur;
    // the longest swell that fits; start inside the sample so its peak lands on the downbeat
    const fs = part.files.slice().sort((a, c) => (a.peak || 1) - (c.peak || 1));
    const f = fs.find((x) => (x.peak || 1) >= land - t) || fs[fs.length - 1];
    const peak = (f.peak || f.buf.duration * 0.6) + (f.off || 0);
    const start = land - peak;
    const offset = Math.max(0, t - start);
    b.voices.play(f, 1, Math.max(t, start), { dest: this.dest('swell'), gain: LEVEL.swell, offset, align: false, prio: 3 });
  }
}

export { TOP };
