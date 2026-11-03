// Music theory helpers: modes, scale degrees, chords and note names.

export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const MODE_LABEL = { aeolian: 'minor', dorian: 'dorian', harmonic: 'harmonic minor', major: 'major' };

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// conventional spelling of a tonic per mode family
const MINOR_NAME = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const MAJOR_NAME = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function keyName(pc, mode) {
  const n = (mode === 'major' ? MAJOR_NAME : MINOR_NAME)[((pc % 12) + 12) % 12];
  return `${n} ${MODE_LABEL[mode] || mode}`;
}

export function noteName(midi, flats = false) {
  const pc = ((midi % 12) + 12) % 12;
  return (flats ? FLAT : SHARP)[pc] + (Math.floor(midi / 12) - 1);
}

/** Semitones above the tonic for a scale degree (any integer; 7 = the octave). */
export function degSemis(scale, deg) {
  const o = Math.floor(deg / 7), i = ((deg % 7) + 7) % 7;
  return scale[i] + 12 * o;
}

/** The scale used for melody over a chord: harmonic minor tunes raise the 7th over V and vii. */
export function melodyScale(tune, chordDeg) {
  if (tune.mode === 'harmonic') {
    const d = ((chordDeg % 7) + 7) % 7;
    return d === 4 ? MODES.harmonic : MODES.aeolian;
  }
  return MODES[tune.mode];
}

/** Scale for chord roots: natural minor for every chord of a harmonic minor tune (the V is still on the 5th). */
export function rootScale(tune) {
  return tune.mode === 'harmonic' ? MODES.aeolian : MODES[tune.mode];
}

/** Triad of a chord on a scale degree as scale degrees (root, third, fifth). */
export const triadDegs = (rootDeg) => [rootDeg, rootDeg + 2, rootDeg + 4];

/** Triad semitones above the tonic, quality from the melody scale of that chord. */
export function triadSemis(tune, rootDeg) {
  const sc = melodyScale(tune, rootDeg);
  return triadDegs(rootDeg).map((d) => degSemis(sc, d));
}

/** Place a pitch class in [lo, lo+11]. */
export function placeIn(pc, lo) {
  return lo + ((((pc - lo) % 12) + 12) % 12);
}

/** Diatonic third above a melody degree. */
export const thirdAbove = (deg) => deg + 2;
