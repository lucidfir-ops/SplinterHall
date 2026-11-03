// Tune generator. A tune is a style, key, tempo, mode, three chord progressions, a 2-bar main riff (with two
// variations of its second bar), a 4-bar hook, a drum feel and a palette (which folk or orchestral voice
// features), all from the seed. A memory of the last 16 tunes in this browser makes a new match pick the
// least familiar of 12 candidates, as in Hoverline.

import { rngFrom, pick, chance, weighted, range, randInt } from './rng.js';
import { MODES, keyName, degSemis, melodyScale } from './theory.js';

export const STYLES = ['viking', 'battle', 'power'];

// ------------------------------------------------------------------------------------------- harmony
// Chord roots as scale degrees (0 = tonic). No ii in minor and no vii in major (their fifths are diminished).
const PROG = {
  aeolian: {
    verse: [[0, 0, 5, 6], [0, 5, 6, 0], [0, 6, 5, 6], [0, 5, 2, 6], [0, 3, 5, 6], [0, 3, 0, 6], [0, 5, 3, 6], [0, 2, 5, 6]],
    chorus: [[5, 6, 0, 0], [0, 5, 2, 6], [5, 2, 6, 0], [0, 6, 5, 6], [3, 5, 6, 0], [5, 6, 2, 0], [0, 5, 6, 6], [2, 6, 0, 5]],
    bridge: [[3, 3, 5, 6], [5, 5, 6, 6], [3, 4, 5, 6], [2, 2, 6, 6], [3, 5, 3, 6]],
  },
  harmonic: {
    verse: [[0, 0, 5, 4], [0, 5, 3, 4], [0, 3, 0, 4], [0, 5, 6, 4], [0, 3, 5, 4]],
    chorus: [[5, 3, 0, 4], [0, 5, 3, 4], [5, 6, 4, 4], [3, 4, 0, 0], [5, 2, 3, 4]],
    bridge: [[3, 3, 4, 4], [5, 5, 4, 4], [3, 5, 6, 4]],
  },
  dorian: {
    verse: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 3, 6, 0], [0, 0, 3, 3], [0, 6, 0, 3]],
    chorus: [[0, 6, 3, 0], [3, 0, 6, 0], [6, 3, 0, 0], [0, 3, 6, 6], [2, 3, 6, 0]],
    bridge: [[3, 3, 6, 6], [2, 3, 6, 6], [6, 6, 3, 3]],
  },
  major: {
    verse: [[0, 0, 4, 3], [0, 3, 4, 4], [0, 5, 3, 4], [0, 4, 5, 3], [0, 3, 0, 4]],
    chorus: [[0, 4, 5, 3], [5, 3, 0, 4], [3, 4, 0, 0], [0, 3, 5, 4], [3, 4, 5, 0]],
    bridge: [[5, 5, 3, 4], [3, 3, 4, 4], [5, 4, 3, 4], [1, 1, 4, 4]],
  },
};

// ------------------------------------------------------------------------------------------- riffs
// One char per step: P power chord on the root, M power chord on the next move degree, x palm-muted chug on
// the current root, n single note from the line, T tremolo-picked note from the line, - hold, . rest.
const R44 = {
  gallop: {
    a: ['P-xxx-xxx-xxx-xx', 'P-xxx-xxP-xxx-xx'],
    b: ['P-xxx-xxM-xxM-xx', 'P-xxx-xxM-xxx-xx', 'P-xxM-xxx-xxM-xx'],
    v: ['P-xxx-xxM-M-M-M-', 'P-xxx-xxM-xxM-M-', 'P-xxM-xxM-xxM-xx'],
  },
  pedal: {
    a: ['P-xxx-xxP-xxx-xx', 'P--xP--xP-x-xxxx', 'P-x-xxP-x-xxP-xx', 'Pxx-Pxx-P-xxP-x-'],
    b: ['P-xxx-xxn-n-n-n-', 'P--xP--xM---M---', 'P-x-xxP-x-xxn-nn'],
    v: ['P-xxx-xxM-xxM-xx', 'P--xP--xn-n-M---', 'P-x-xxM-x-xxM-xx'],
  },
  chords: {
    a: ['P-----x-M-----x-', 'P---x-x-M---x-x-', 'P-----xxM-------'],
    b: ['P-----x-M---M---', 'P---x-x-M-M-M---', 'P-----xxM---M-x-'],
    v: ['P---M---M---M---', 'P-----x-M-x-M-x-', 'P---x-x-M-M-M-M-'],
  },
  tremolo: {
    a: ['T---T---T---T---', 'T-------T---T---', 'T---T---T-------'],
    b: ['T---T---T-------', 'T-------T-------', 'T---T---T---T---'],
    v: ['T-T-T-T-T---T---', 'T---T---T-T-T-T-', 'T---T---T---T-T-'],
  },
  thrash: {
    a: ['x.x.xxx.P-x.P-x.', 'x.xxx.xxx.xxP-P-', 'P-x.x.x.P-x.x.x.'],
    b: ['x.x.xxx.M-x.M-x.', 'x.xxx.xxM-M-M-M-', 'P-x.x.x.n.n.n.n.'],
    v: ['x.x.xxx.M-M-M-x.', 'P-x.x.x.M-x.M-x.', 'x.xxx.xxM-x.M-M-'],
  },
  stomp: {
    a: ['P--xP--xP-x-x-x-', 'P---x-x-P---x-x-', 'P--x--x-P--x--x-'],
    b: ['P--xP--xM---M---', 'P---x-x-M---x-x-', 'P--x--x-M--xM-x-'],
    v: ['P--xP--xM-M-M---', 'P--xM--xM---x-x-', 'P---x-x-M-x-M-x-'],
  },
};
const R128 = {
  stomp: {
    a: ['P--x-xP--x-x', 'P-----x-xP--', 'P--P--x-xP--'],
    b: ['P--x-xM--M--', 'P-----x-xM--', 'P--x-xM-----'],
    v: ['P--x-xM-xM-x', 'P--M--M--M--', 'P--x-xM--M-x'],
  },
  gallop: {
    a: ['P-xx-xx-xx-x', 'P-xx-xP-xx-x'],
    b: ['P-xx-xM-xM-x', 'P-xx-xM-xx-x'],
    v: ['P-xM-xM-xM-x', 'P-xx-xM--M--'],
  },
  tremolo: {
    a: ['T--T--T--T--', 'T-----T--T--', 'T--T--T-----'],
    b: ['T--T--T-----', 'T-----T-----', 'T--T--T--T--'],
    v: ['T-TT-TT--T--', 'T--T--T-TT-T', 'T--T--TT-T--'],
  },
  chords: {
    a: ['P-----x-xM--', 'P--x-xM-----'],
    b: ['P-----x-xM-M', 'P--x-xM--M--'],
    v: ['P--M--M--M--', 'P-----M--M-x'],
  },
};

const RIFF_TYPES = {
  power: [['gallop', 0.36], ['pedal', 0.24], ['chords', 0.22], ['tremolo', 0.18]],
  battle: [['thrash', 0.28], ['gallop', 0.2], ['pedal', 0.2], ['tremolo', 0.22], ['chords', 0.1]],
  viking: [['stomp', 0.36], ['tremolo', 0.34], ['chords', 0.2], ['gallop', 0.1]],
};

// Move degrees (relative to the riff's chord root) for M chords, per mode family
const MOVES = {
  minor: [[-2, -1, -2, -1], [-1, -2, -3, -1], [2, 3, 4, 3], [3, 4, 3, -1], [-2, -1, 2, 3], [4, 3, 2, -1], [-2, -3, -2, -1], [3, 2, -1, -2]],
  major: [[3, 4, 3, 4], [4, 3, 4, 5], [3, 4, 5, 3], [5, 3, 4, 4], [-2, -3, -2, 4], [4, 5, 3, 4]],
};
// single-note lines for n: chromatic (semitones) in minor, diatonic degrees otherwise
const NLINES = {
  minor: [[12, 10, 7, 5], [7, 6, 5, 3], [3, 5, 6, 7], [0, 1, 0, 1], [12, 10, 8, 7], [5, 6, 7, 10], [7, 5, 3, 1]],
  diatonic: [[7, 6, 4, 3], [2, 3, 4, 5], [4, 5, 6, 7], [7, 5, 4, 2], [5, 4, 2, 1]],
};

function tremLine(r, n) {
  const out = [0];
  let d = 0;
  for (let i = 1; i < n; i++) {
    const half = i === Math.floor(n / 2);
    if (half) { d = pick(r, [0, 0, -3, 2, -1]); out.push(d); continue; }
    let step = pick(r, [-1, 1, -1, 1, 0, -2, 2, -1]);
    if (d + step > 4 || d + step < -3) step = -step;
    d += step;
    out.push(d);
  }
  if (out[n - 1] > 2) out[n - 1] = 2;
  return out;
}

/** Parse a pattern bar into events. ctx carries the move and line cursors across the riff. */
function parseBar(str, ctx) {
  const ev = [];
  let cur = 0;
  for (let s = 0; s < str.length; s++) {
    const c = str[s];
    if (c === '-' || c === '.') continue;
    let d = 1;
    while (s + d < str.length && str[s + d] === '-') d++;
    const e = { s, d, k: c, deg: 0 };
    if (c === 'P') { cur = 0; e.k = 'P'; }
    else if (c === 'M') { cur = ctx.moves[ctx.mi++ % ctx.moves.length]; e.k = 'P'; e.deg = cur; e.move = true; }
    else if (c === 'x') { e.deg = cur; }
    else if (c === 'n') {
      const v = ctx.nline[ctx.ni++ % ctx.nline.length];
      if (ctx.nChromatic) { e.semi = v; e.deg = 0; } else e.deg = v;
    } else if (c === 'T') { cur = ctx.tline[ctx.ti++ % ctx.tline.length]; e.deg = cur; }
    ev.push(e);
  }
  return ev;
}

function makeRiff(r, tune) {
  const lib = tune.barSteps === 12 ? R128 : R44;
  let type = weighted(r, RIFF_TYPES[tune.style]);
  if (!lib[type]) type = tune.barSteps === 12 ? pick(r, ['stomp', 'tremolo', 'chords']) : 'gallop';
  const P = lib[type];
  const family = tune.mode === 'major' ? 'major' : 'minor';
  const moves = pick(r, MOVES[family]);
  const nChromatic = family === 'minor' && tune.mode !== 'dorian' && tune.style !== 'power' ? chance(r, 0.7) : false;
  const nline = pick(r, nChromatic ? NLINES.minor : NLINES.diatonic);
  const tline = tremLine(r, 8);
  const ai = Math.floor(r() * P.a.length), bi = Math.floor(r() * P.b.length);
  const mk = () => ({ moves, mi: 0, nline, ni: 0, nChromatic, tline, ti: 0 });
  const c1 = mk();
  const bar0 = parseBar(P.a[ai], c1);
  const bar1 = parseBar(P.b[bi], c1);
  const v1 = parseBar(P.v[0 % P.v.length], { ...mk(), mi: 1, ti: 4 });
  const v2 = parseBar(P.v[(1 + Math.floor(r() * (P.v.length - 1))) % P.v.length], { ...mk(), mi: 2, ti: 2 });
  // chorus figure: the riff's first bar on each chorus chord, moves folded onto the root
  const chorus = parseBar(P.a[ai].replace(/M/g, 'P').replace(/n/g, 'x'), { ...mk(), tline: [0] });
  return {
    type, bars: [bar0, bar1], vars: [v1, v2], chorus, src: [P.a[ai], P.b[bi]], moves, nline, tline,
    sig: `${type}:${P.a[ai]}|${P.b[bi]}:${moves.join(',')}`,
  };
}

// ------------------------------------------------------------------------------------------- hook
const HOOK_R = {
  16: {
    roomy: [[8, 4, 4], [4, 4, 8], [6, 2, 8], [4, 4, 4, 4], [12, 4], [6, 2, 4, 4], [4, 8, 4]],
    busy: [[2, 2, 2, 2, 4, 4], [4, 2, 2, 4, 4], [3, 3, 2, 4, 4], [2, 2, 4, 2, 2, 4], [4, 4, 2, 2, 2, 2], [6, 2, 2, 2, 4]],
    second: [[8, 8], [4, 4, 8], [12, 4], [6, 2, 8], [16]],
    last: [[16], [8, 8], [4, 12], [12, 4]],
  },
  12: {
    roomy: [[6, 3, 3], [3, 3, 6], [9, 3], [3, 3, 3, 3], [6, 6], [3, 6, 3]],
    busy: [[2, 1, 3, 3, 3], [3, 2, 1, 3, 3], [1, 1, 1, 3, 3, 3], [3, 3, 2, 1, 3], [2, 1, 2, 1, 3, 3]],
    second: [[6, 6], [3, 3, 6], [9, 3], [12]],
    last: [[12], [6, 6], [3, 9]],
  },
};

function chordTones(c) { return [c, c + 2, c + 4].map((d) => ((d % 7) + 7) % 7); }

function nearestTone(deg, tones, lo = -2, hi = 9, bias = 0) {
  let best = deg, bd = 1e9;
  for (let x = lo; x <= hi; x++) {
    if (!tones.includes(((x % 7) + 7) % 7)) continue;
    const dd = Math.abs(x - deg) - (Math.sign(x - deg) === Math.sign(bias) && bias ? 0.4 : 0);
    if (dd < bd) { bd = dd; best = x; }
  }
  return best;
}

function makeHook(r, tune) {
  const S = tune.barSteps;
  const R = HOOK_R[S];
  const busy = tune.hookBusy;
  const r1 = pick(r, busy ? R.busy : R.roomy);
  const r2 = pick(r, R.second);
  const r4 = pick(r, R.last);
  const rhythms = [r1, r2, r1, r4];
  const strong = S === 16 ? [0, 8] : [0, 6];
  const chords = tune.prog.chorus;
  const notes = [];
  let deg = nearestTone(pick(r, [2, 4, 4, 2, 0, 7]), chordTones(chords[0]), 0, 7);
  const contour = [1, 0, 1, -1]; // rise, hold/peak, rise, fall home
  const repeatBar3 = chance(r, 0.55);
  for (let b = 0; b < 4; b++) {
    const tones = chordTones(chords[b]);
    let s = 0;
    if (b === 2 && repeatBar3) {
      // bar 3 repeats bar 1, nudged onto the new chord's tones on strong beats
      const first = notes.filter((n) => n.bar === 0);
      for (const n of first) {
        let d2 = n.deg;
        if (strong.includes(n.s) && !tones.includes(((d2 % 7) + 7) % 7)) d2 = nearestTone(d2, tones);
        notes.push({ bar: 2, s: n.s, d: n.d, deg: d2 });
      }
      deg = notes[notes.length - 1].deg;
      continue;
    }
    const rh = rhythms[b];
    for (let i = 0; i < rh.length; i++) {
      const isLast = b === 3 && i === rh.length - 1;
      if (!(b === 0 && i === 0)) {
        if (isLast) {
          // come home: tonic if the last chord holds it, else the nearest chord tone
          deg = tones.includes(0) ? nearestTone(deg, [0], -2, 7) : nearestTone(deg, tones, -2, 7, -1);
        } else if (strong.includes(s)) {
          // a chord tone that moves (a held note only now and then), leaning the bar's contour direction
          const cands = [];
          for (let x = deg - 4; x <= deg + 4; x++) {
            if (x < -2 || x > 9 || !tones.includes(((x % 7) + 7) % 7)) continue;
            const dir = Math.sign(x - deg);
            let w = x === deg ? 0.35 : 1.2 / Math.abs(x - deg);
            if (contour[b] && dir === contour[b]) w *= 2.2;
            cands.push([x, w]);
          }
          deg = cands.length ? weighted(r, cands) : nearestTone(deg, tones, -2, 9);
        } else {
          let st = weighted(r, [[contour[b] || pick(r, [-1, 1]), 0.45], [-(contour[b] || 1), 0.2], [0, 0.17], [2 * (contour[b] || 1), 0.1], [-2, 0.08]]);
          if (deg + st > 9 || deg + st < -2) st = -st;
          deg += st;
        }
      }
      notes.push({ bar: b, s, d: rh[i], deg });
      s += rh[i];
    }
  }
  return notes;
}

// ------------------------------------------------------------------------------------------- titles
const WORDS = {
  viking: {
    a: ['Ashes', 'Oaths', 'Ravens', 'Wolves', 'Sons', 'Fires', 'Graves', 'Songs', 'Hammers', 'Shields', 'Ghosts', 'Bones', 'Winds'],
    y: ['Longship', 'Northern Sea', 'Fjord', 'Mead Hall', 'Jarl', 'Shieldwall', 'Frozen Shore', 'Old Gods', 'Ice King', 'Skalds',
      'Wolf Moon', 'Burning Keel', 'Grey Mountains', 'Last Winter', 'Storm Coast'],
    t: ['{A} of the {Y}', '{A} of the {Y}', 'Under the {Y}', 'The {Y} Calls', 'Ride to the {Y}', 'Beyond the {Y}', 'Return of the {Y}'],
  },
  battle: {
    a: ['Banners', 'Steel', 'Ashes', 'Thunder', 'Crowns', 'Hammers', 'Swords', 'Blood', 'Fire', 'Spears', 'Drums', 'Walls', 'Embers'],
    y: ['Siege', 'Last Legion', 'Broken Gate', 'Burning Keep', 'Vanguard', 'Black Rampart', 'Ninth Hour', 'Shattered Crown',
      'Warlord', 'Red Field', 'Iron March', 'Fallen King', 'Siegebreaker', 'Iron Hills'],
    t: ['{A} of the {Y}', '{A} of the {Y}', 'March of the {Y}', 'Into the {Y}', 'The {Y} Stands', 'Hold the {Y}', '{Y} Unbroken'],
  },
  power: {
    a: ['Wings', 'Light', 'Fires', 'Stars', 'Glory', 'Thunder', 'Hearts', 'Dawn', 'Embers', 'Swords', 'Riders', 'Tears'],
    y: ['Dragon', 'Starfire', 'Eternal Kingdom', 'Morning Sky', 'Phoenix', 'Seven Seas', 'Golden Age', 'Silver Moon', 'Highlands',
      'Tempest', 'Distant Shores', 'Crystal Spire', 'Northern Star'],
    t: ['{A} of the {Y}', '{A} of the {Y}', 'Ride the {Y}', '{Y} Ascending', 'Beyond the {Y}', 'Heart of the {Y}', 'Legend of the {Y}'],
  },
};

function makeTitle(r, style) {
  const W = WORDS[style];
  return pick(r, W.t).replace('{A}', pick(r, W.a)).replace('{Y}', pick(r, W.y));
}

// ------------------------------------------------------------------------------------------- tune
const KEY_W = [[4, 3], [2, 2.5], [0, 1.5], [6, 1.5], [9, 1.5], [11, 1.2], [7, 1], [1, 1], [3, 1], [5, 0.8], [8, 0.6], [10, 0.6]];

export function generateTune(seed, style = 'any') {
  const r = rngFrom('tune:' + seed);
  if (!STYLES.includes(style)) style = pick(r, STYLES);
  else r();
  const t = { seed: String(seed), style };
  t.key = weighted(r, KEY_W);
  if (style === 'power') t.mode = weighted(r, [['major', 0.45], ['harmonic', 0.35], ['aeolian', 0.2]]);
  else if (style === 'battle') t.mode = 'aeolian';
  else t.mode = weighted(r, [['aeolian', 0.6], ['dorian', 0.4]]);
  t.keyLabel = keyName(t.key, t.mode);
  t.barSteps = style === 'viking' && chance(r, 0.4) ? 12 : 16;
  t.spb = t.barSteps === 12 ? 3 : 4;
  t.meter = t.barSteps === 12 ? '12/8' : '4/4';
  t.bpm = Math.round(style === 'power' ? range(r, 160, 190) : style === 'battle' ? range(r, 140, 165)
    : t.barSteps === 12 ? range(r, 100, 126) : range(r, 100, 140));
  // the guitars' tonic sits low (B1 to A#2); the lead's around C4 to B4
  t.gRoot = 35 + ((t.key - 35 % 12 + 24) % 12);
  if (t.gRoot < 35) t.gRoot += 12;
  t.lead0 = 60 + ((t.key - 0 + 12) % 12);
  if (t.lead0 > 68) t.lead0 -= 12;
  if (t.lead0 < 60) t.lead0 += 12;
  const P = PROG[t.mode];
  t.prog = { verse: pick(r, P.verse), chorus: pick(r, P.chorus), bridge: pick(r, P.bridge) };
  t.chugFifth = chance(r, 0.55);
  t.tremVoicing = chance(r, 0.6) ? 'pc' : 'oct';
  t.riff = makeRiff(r, t);
  t.hookBusy = chance(r, 0.4);
  t.hook = makeHook(r, t);
  // drums
  const charge = style === 'power' ? weighted(r, [['lock', 0.6], ['beat', 0.4]])
    : style === 'battle' ? weighted(r, [['skank', 0.5], ['lock', 0.5]]) : weighted(r, [['stomp', 0.6], ['lock', 0.4]]);
  t.drums = {
    charge: t.barSteps === 12 && charge === 'skank' ? 'stomp' : charge,
    top: chance(r, style === 'battle' ? 0.55 : 0.35) ? 'ride' : 'hat',
    fill: pick(r, ['toms', 'toms', 'snare']),
    build: pick(r, ['toms', 'roll']),
  };
  // palette: which one folk or orchestral voice features
  const pal = {};
  if (style === 'viking') pal.hook = weighted(r, [['fiddle', 0.45], ['whistle', 0.3], ['lead', 0.25]]);
  else if (style === 'battle') pal.hook = weighted(r, [['lead', 0.8], ['horn', 0.2]]);
  else pal.hook = 'lead';
  pal.orch = style === 'battle' ? pick(r, ['brass', 'strings']) : style === 'power' ? weighted(r, [['strings', 0.7], ['brass', 0.3]]) : 'strings';
  pal.prowl = chance(r, style === 'power' ? 0.55 : 0.4) ? 'clean' : 'chug';
  pal.drone = style === 'viking' && chance(r, 0.35);
  pal.hornCalls = style === 'viking';
  t.palette = pal;
  t.introRiff = chance(r, 0.3);
  t.title = makeTitle(r, style);
  t.name = `${t.title} · ${t.keyLabel}`;
  t.sig = {
    st: style, k: t.key, rt: t.riff.type, rf: t.riff.sig, hk: t.hook.map((n) => n.deg + ':' + n.d).join(','),
    vp: t.prog.verse.join(''), cp: t.prog.chorus.join(''), hv: pal.hook, pw: pal.prowl, ti: t.title,
  };
  return t;
}

// ------------------------------------------------------------------------------------------- memory
const MEM_KEY = 'splinterhall.music.history';

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export const memory = {
  get() {
    try {
      const s = storage();
      const a = JSON.parse((s && s.getItem(MEM_KEY)) || '[]');
      return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : [];
    } catch (e) { return []; }
  },
  add(tune) {
    try {
      const s = storage();
      if (!s) return;
      const a = this.get();
      if (a[0] && JSON.stringify(a[0]) === JSON.stringify(tune.sig)) return;
      a.unshift(tune.sig);
      s.setItem(MEM_KEY, JSON.stringify(a.slice(0, 16)));
    } catch (e) { /* storage blocked */ }
  },
  clear() { try { const s = storage(); if (s) s.removeItem(MEM_KEY); } catch (e) { /* ignore */ } },
};

export function familiarity(tune, history) {
  const f = tune.sig;
  let p = 0;
  history.forEach((h, i) => {
    const w = Math.pow(0.82, i);
    if (h.hk === f.hk) p += 4 * w;
    if (h.rf === f.rf) p += 3 * w;
    if (h.ti === f.ti) p += 2 * w;
    if (h.rt === f.rt) p += 1.2 * w;
    if (h.vp === f.vp) p += 1.2 * w;
    if (h.cp === f.cp) p += 1.2 * w;
    if (h.hv === f.hv) p += 1 * w;
    if (h.k === f.k) p += 0.5 * w;
    if (h.st === f.st) p += 0.4 * w;
    if (h.pw === f.pw) p += 0.3 * w;
  });
  return p;
}

/**
 * Pick the tune for a seed. With room = true the seed alone decides (everyone in a room hears the same tune);
 * otherwise the least familiar of 12 candidates from the seed, judged against this browser's last 16 tunes.
 */
export function pickTune(seed, { style = 'any', room = false, remember = true } = {}) {
  let best;
  if (room) best = generateTune(seed + '#0', style);
  else {
    const H = memory.get();
    let bp = 1e9;
    for (let i = 0; i < 12; i++) {
      const t = generateTune(seed + '#' + i, style);
      const p = familiarity(t, H) + i * 0.001;
      if (p < bp) { bp = p; best = t; }
    }
  }
  if (remember) memory.add(best);
  return best;
}

export { randInt };
