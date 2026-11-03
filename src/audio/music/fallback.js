// Synthesized substitutes for any part whose samples failed to load. They are plain on purpose: the band keeps
// playing, in time and in tune, until the real recordings arrive (or for good on a broken connection).

const TAU = Math.PI * 2;

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function buffer(ctx, data, sr) {
  const b = ctx.createBuffer(1, data.length, sr);
  b.copyToChannel ? b.copyToChannel(data, 0) : b.getChannelData(0).set(data);
  return b;
}

function onePoleHP(x, sr, f) {
  const a = Math.exp(-TAU * f / sr);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) { const y = a * (py + x[i] - px); px = x[i]; py = y; x[i] = y; }
}

function onePoleLP(x, sr, f) {
  const a = Math.exp(-TAU * f / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; }
}

function normalise(x, target = 0.6) {
  let pk = 0, ss = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= target / pk;
  const n = Math.min(x.length, 4096);
  for (let i = 0; i < n; i++) ss += x[i] * x[i];
  return Math.sqrt(ss / Math.max(1, n));
}

function drumBuffer(ctx, part, sr) {
  const rnd = lcg(part.length * 7919 + part.charCodeAt(0));
  const len = { crash: 2.2, crash_big: 2.6, china: 1.6, ride: 1.6, ride_bell: 1.2, hat_open: 0.9, swell: 2.2,
    war_drum: 1.2, kick_boom: 0.6, splash: 0.7 }[part] || 0.5;
  const N = Math.floor(sr * len), x = new Float32Array(N);
  if (part.startsWith('kick') || part === 'war_drum' || part === 'frame_drum' || part === 'war_tom' || part.startsWith('tom')) {
    const f0 = { kick: 150, kick_boom: 120, war_drum: 90, frame_drum: 160, war_tom: 120, tom_hi: 220, tom_mid: 170, tom_lo: 120 }[part] || 150;
    const f1 = { kick: 46, kick_boom: 40, war_drum: 52, frame_drum: 90, war_tom: 75, tom_hi: 150, tom_mid: 115, tom_lo: 82 }[part] || 50;
    const dec = { kick: 0.28, kick_boom: 0.45, war_drum: 0.7, frame_drum: 0.3, war_tom: 0.4 }[part] || 0.35;
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / 0.03);
      ph += TAU * f / sr;
      x[i] = Math.sin(ph) * Math.exp(-t / dec) + (t < 0.004 ? rnd() * 0.5 * (1 - t / 0.004) : 0);
    }
  } else if (part.startsWith('snare') || part === 'sticks') {
    const click = part === 'sticks';
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      x[i] = click ? rnd() * Math.exp(-t / 0.006) : rnd() * Math.exp(-t / 0.14) * 0.8 + Math.sin(TAU * 190 * t) * Math.exp(-t / 0.06);
    }
    onePoleHP(x, sr, click ? 1800 : 300);
  } else {
    // cymbals and hats: high-passed noise
    const dec = { hat: 0.05, hat_pedal: 0.03, hat_open: 0.4, ride: 0.9, ride_bell: 0.6, splash: 0.35, swell: 9 }[part] || 0.9;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const e = part === 'swell' ? Math.pow(t / len, 2.5) * (1 - Math.max(0, (t - len * 0.9) / (len * 0.1))) : Math.exp(-t / dec);
      x[i] = rnd() * e;
    }
    onePoleHP(x, sr, part.startsWith('hat') ? 6500 : 3500);
    onePoleHP(x, sr, part.startsWith('hat') ? 6500 : 3500);
  }
  const fade = Math.min(N, Math.floor(sr * 0.02));
  for (let i = 0; i < fade; i++) x[N - 1 - i] *= i / fade;
  const r = normalise(x);
  return { buf: buffer(ctx, x, sr), gain: 0.25 / Math.max(r, 1e-4) };
}

function pitchedBuffer(ctx, part, midi, sr) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const plucked = part === 'gtr_clean' || part === 'gtr_mute' || part === 'bass';
  const perc = part === 'timpani' || part.endsWith('_stac') || part === 'str_spic';
  const len = part === 'gtr_mute' ? 0.4 : perc ? 0.9 : plucked ? 2.0 : 2.4;
  const N = Math.floor(sr * len), x = new Float32Array(N);
  const rnd = lcg(midi * 31 + part.length);
  let loop = null;
  if (plucked) {
    // Karplus-Strong
    const P = Math.max(2, Math.round(sr / f)), line = new Float32Array(P);
    for (let i = 0; i < P; i++) line[i] = rnd();
    const damp = part === 'gtr_mute' ? 0.45 : 0.5, keep = part === 'gtr_mute' ? 0.985 : 0.998;
    let idx = 0;
    for (let i = 0; i < N; i++) {
      const a = line[idx], b = line[(idx + 1) % P];
      const y = (a * (1 - damp) + b * damp) * keep;
      line[idx] = y; x[i] = a; idx = (idx + 1) % P;
    }
  } else if (part === 'timpani') {
    for (let i = 0; i < N; i++) { const t = i / sr; x[i] = (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.5 * t)) * Math.exp(-t / 0.5); }
  } else {
    // sustained: a band-limited saw-like tone with a soft attack, loopable over whole periods
    const harm = part === 'whistle' ? 3 : part === 'fiddle' ? 14 : 10;
    const att = perc ? 0.01 : 0.12;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      let s = 0;
      for (let h = 1; h <= harm && h * f < sr / 2.2; h++) s += Math.sin(TAU * f * h * t) / h;
      const e = Math.min(1, t / att) * (perc ? Math.exp(-t / 0.18) : 1);
      x[i] = s * e;
    }
    if (part === 'whistle') for (let i = 0; i < N; i++) x[i] += rnd() * 0.04;
    onePoleLP(x, sr, part === 'fiddle' ? 5000 : 3000);
    if (!perc) {
      const per = sr / f, k = Math.max(1, Math.round((0.5 * sr) / per));
      const s0 = Math.round(Math.ceil((0.8 * sr) / per) * per);
      loop = [s0 / sr, Math.round(s0 + k * per) / sr];
    }
  }
  const fade = Math.min(N, Math.floor(sr * 0.03));
  for (let i = 0; i < fade; i++) x[N - 1 - i] *= i / fade;
  const r = normalise(x);
  return { buf: buffer(ctx, x, sr), gain: 0.25 / Math.max(r, 1e-4), loop };
}

const DEFAULT_RANGES = {
  gtr_clean: [36, 87], gtr_mute: [36, 72], bass: [24, 57], str_sus: [36, 79], str_spic: [40, 76], horn_sus: [43, 60],
  horn_stac: [46, 74], tbn_stac: [41, 65], tuba_stac: [34, 50], tpt_stac: [60, 74], fiddle: [55, 84], whistle: [68, 88],
  bagpipe: [45, 54], timpani: [41, 55], timpani_roll: [48, 48],
};

/** Build synthesized bank entries for a part (same shape as loaded entries). */
export function synthPart(ctx, part, kind, metaFiles = []) {
  const sr = ctx.sampleRate;
  if (kind === 'pitched') {
    let notes = [...new Set(metaFiles.map((f) => f.midi).filter((m) => m != null))];
    if (!notes.length) {
      const [lo, hi] = DEFAULT_RANGES[part] || [48, 72];
      for (let m = lo; m <= hi; m += 6) notes.push(m);
    } else {
      notes = notes.filter((m, i) => i % 2 === 0); // half as dense is plenty for a stand-in
    }
    return notes.map((m) => {
      const s = pitchedBuffer(ctx, part, m, sr);
      return { name: `${part}_${m}_synth`, part, midi: m, vel: 1, rr: 0, gain: s.gain, buf: s.buf, off: 0, on: 0,
        loopS: s.loop, synth: true };
    });
  }
  const s = drumBuffer(ctx, part, sr);
  const e = { name: `${part}_synth`, part, midi: null, vel: 1, rr: 0, gain: s.gain, buf: s.buf, off: 0, on: 0, synth: true };
  if (kind === 'loop') e.loopS = [0.1, s.buf.duration - 0.1];
  if (kind === 'swell') e.peak = s.buf.duration * 0.9;
  return [e];
}
