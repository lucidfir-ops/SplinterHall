// Guitar amp model: HPF 90 Hz -> pre-gain -> asymmetric soft clip (4x oversampled) -> mid-scooped tone stack
// -> second clip stage -> 4x12-style cabinet (a generated impulse response through a ConvolverNode).
// Power chords are summed into the input, so root, fifth and octave distort together.

const curveCache = new Map();

/** Asymmetric soft clip: tanh with a bias that is removed afterwards, so even harmonics appear. */
function clipCurve(drive, bias, n = 2049) {
  const key = `${drive}|${bias}|${n}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const c = new Float32Array(n);
  const off = Math.tanh(bias * drive);
  const norm = Math.tanh((1 + bias) * drive) - off;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y = Math.tanh((x + bias) * drive) - off;
    // the negative side clips a little harder, like a single-ended triode stage
    if (y < 0) y *= 0.92;
    c[i] = y / norm;
  }
  c[(n - 1) >> 1] = 0; // silence in, silence out: lets the browser skip the amp while it is idle
  curveCache.set(key, c);
  return c;
}

const irCache = new Map();

/** Target magnitude of a 4x12 cabinet with a close mic: high pass around 75 Hz, a low resonant thump
 * (~110 Hz), a mild cone dip in the low mids, a presence bump (~2.3 kHz), a break-up notch near 4.3 kHz and a
 * steep roll-off above ~5.5 kHz. */
export function cabinetMag(f, variant = 0) {
  const hp = 1 / Math.sqrt(1 + Math.pow(78 / Math.max(f, 1), 4));
  const lp = 1 / Math.sqrt(1 + Math.pow(f / (5300 + variant * 200), 10));
  const thump = 1 + 0.85 * Math.exp(-Math.pow(Math.log2(f / (112 + variant * 8)) / 0.32, 2));
  const pres = 1 + 0.65 * Math.exp(-Math.pow(Math.log2(f / (2300 + variant * 180)) / 0.5, 2));
  const scoop = 1 - 0.3 * Math.exp(-Math.pow(Math.log2(f / 600) / 0.6, 2));
  const notch = 1 - 0.4 * Math.exp(-Math.pow(Math.log2(f / (4300 + variant * 150)) / 0.12, 2));
  return Math.max(1e-4, hp * lp * thump * pres * scoop * notch);
}

/** Minimum-phase impulse response (real cepstrum method) of cabinetMag, N samples. Pure function. */
export function cabinetCurve(sr, variant = 0, N = 2048) {
  const M = N * 4; // design on a finer grid, then truncate
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let k = 0; k <= M / 2; k++) {
    const m = Math.log(cabinetMag((k * sr) / M, variant));
    re[k] = m;
    if (k > 0 && k < M / 2) re[M - k] = m;
  }
  fft(re, im, true); // real cepstrum
  // fold to the causal part
  for (let i = 1; i < M / 2; i++) { re[i] *= 2; im[i] *= 2; }
  for (let i = M / 2 + 1; i < M; i++) { re[i] = 0; im[i] = 0; }
  fft(re, im, false);
  for (let k = 0; k < M; k++) {
    const e = Math.exp(re[k]);
    const c = Math.cos(im[k]), s2 = Math.sin(im[k]);
    re[k] = e * c; im[k] = e * s2;
  }
  fft(re, im, true);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = re[i];
  for (let i = Math.floor(N * 0.85); i < N; i++) out[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - N * 0.85) / (N * 0.15));
  // unity gain at 1 kHz-ish so swapping cabs doesn't change level much
  let e = 0;
  for (let i = 0; i < N; i++) e += out[i] * out[i];
  const g = 0.5 / Math.sqrt(e);
  for (let i = 0; i < N; i++) out[i] *= g;
  return out;
}

export function cabinetIR(ctx, variant = 0) {
  const key = `${ctx.sampleRate}|${variant}`;
  if (irCache.has(key)) return irCache.get(key);
  const out = cabinetCurve(ctx.sampleRate, variant, 2048);
  const buf = ctx.createBuffer(1, out.length, ctx.sampleRate);
  buf.getChannelData(0).set(out);
  irCache.set(key, buf);
  return buf;
}

/** In-place radix-2 complex FFT; inverse divides by N. */
export function fft(xr, xi, inverse) {
  const N = xr.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = xr[i]; xr[i] = xr[j]; xr[j] = t; t = xi[i]; xi[i] = xi[j]; xi[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const h = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h;
        const br = xr[b] * cr - xi[b] * ci, bi = xr[b] * ci + xi[b] * cr;
        xr[b] = xr[a] - br; xi[b] = xi[a] - bi;
        xr[a] += br; xi[a] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < N; i++) { xr[i] /= N; xi[i] /= N; }
}

function biquad(ctx, type, f, q = 0.707, g = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = g;
  return b;
}

/**
 * One amp channel. opts: gain (pre-gain, ~10-40 for rhythm), variant (cab/tone variation), lead (lighter),
 * tight (extra low cut before the clipper for chugs).
 * input: AudioNode to feed DI; output: AudioNode after the cabinet.
 */
export class Amp {
  constructor(ctx, opts = {}) {
    const lead = !!opts.lead;
    const v = opts.variant || 0;
    this.ctx = ctx;
    this.input = ctx.createGain();
    const hpf = biquad(ctx, 'highpass', 90 + v * 6, 0.71);
    const tight = biquad(ctx, 'peaking', 720 + v * 40, 0.8, lead ? 3 : 6); // pre-clip mid push: tight, articulate chugs
    const pre = ctx.createGain();
    pre.gain.value = opts.gain || (lead ? 9 : 26);
    const clip1 = ctx.createWaveShaper();
    clip1.curve = clipCurve(lead ? 2.2 : 2.8, 0.18 + v * 0.02);
    clip1.oversample = '4x';
    // tone stack: bass shelf, mid scoop, treble shelf
    const bassS = biquad(ctx, 'lowshelf', 160, 0.7, lead ? 1 : 2.5);
    const scoop = biquad(ctx, 'peaking', 520 + v * 30, 0.75, lead ? -3 : -5.5);
    const treb = biquad(ctx, 'highshelf', 2600, 0.7, lead ? 0 : 1.5);
    const inter = ctx.createGain();
    inter.gain.value = lead ? 1.6 : 2.4;
    const clip2 = ctx.createWaveShaper();
    clip2.curve = clipCurve(lead ? 1.4 : 1.8, 0.08 + v * 0.02);
    // the rhythm amps' second stage runs at 2x (low, dense chords mask its aliasing); the lead keeps 4x
    clip2.oversample = lead ? '4x' : '2x';
    // post-clip de-fizz before the cab (the clipper's aliasing residue and harsh top)
    const defizz = biquad(ctx, 'lowpass', lead ? 7000 : 6400, 0.6);
    const cab = ctx.createConvolver();
    cab.normalize = false;
    cab.buffer = cabinetIR(ctx, v);
    const post = ctx.createGain();
    post.gain.value = 1;
    // after the cab: a gentle low-mid cleanup so two amps don't stack mud at 250 Hz
    const mud = biquad(ctx, 'peaking', 260, 1.0, lead ? -1.5 : -3);
    const air = biquad(ctx, 'lowpass', lead ? 7500 : 6800, 0.5);
    this.input.connect(hpf).connect(tight).connect(pre).connect(clip1).connect(bassS).connect(scoop).connect(treb)
      .connect(inter).connect(clip2).connect(defizz).connect(cab).connect(mud).connect(air).connect(post);
    this.output = post;
    this.pre = pre;
    this.clip1 = clip1;
    this.clip2 = clip2;
  }

  connect(dest) { this.output.connect(dest); return dest; }
}

/** The bass amp: picked bass DI with light drive blended under the clean signal, a little grit. */
export class BassAmp {
  constructor(ctx) {
    this.input = ctx.createGain();
    const hp = biquad(ctx, 'highpass', 32, 0.7);
    const split = ctx.createGain();
    const clean = biquad(ctx, 'lowpass', 900, 0.7);
    const drvHP = biquad(ctx, 'highpass', 220, 0.7);
    const pre = ctx.createGain(); pre.gain.value = 4;
    const sh = ctx.createWaveShaper(); sh.curve = clipCurve(2.0, 0.12); sh.oversample = '2x';
    const drvLP = biquad(ctx, 'lowpass', 3200, 0.7);
    const drvG = ctx.createGain(); drvG.gain.value = 0.32;
    const sum = ctx.createGain();
    const low = biquad(ctx, 'peaking', 85, 1.0, 2);
    const mid = biquad(ctx, 'peaking', 700, 1.0, 2.5); // growl that cuts through guitars
    const sub = biquad(ctx, 'highpass', 38, 0.8);
    this.input.connect(hp).connect(split);
    split.connect(clean).connect(sum);
    split.connect(drvHP).connect(pre).connect(sh).connect(drvLP).connect(drvG).connect(sum);
    sum.connect(low).connect(mid).connect(sub);
    this.output = sub;
  }

  connect(dest) { this.output.connect(dest); return dest; }
}
