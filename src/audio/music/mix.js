// The mixing desk: one bus per part, two rhythm amps panned hard left and right, a lead amp with delay, the
// bass amp, one shared reverb, kick-to-bass ducking, glue compression and a limiter on the master.

import { Amp, BassAmp } from './amp.js';

function biquad(ctx, type, f, q = 0.707, g = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g;
  return b;
}

function gain(ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function panner(ctx, p) {
  if (ctx.createStereoPanner) {
    const s = ctx.createStereoPanner();
    s.pan.value = p;
    return s;
  }
  const s = ctx.createPanner();
  s.panningModel = 'equalpower';
  s.setPosition(p, 0, 1 - Math.abs(p));
  return s;
}

/** A plate-like reverb impulse response: decorrelated stereo noise, a short pre-delay, a damped decay. */
function reverbIR(ctx, seconds = 1.9, damp = 5200) {
  const sr = ctx.sampleRate;
  const N = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = 99991 + ch * 7717;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2147483648) - 1;
    const pre = Math.floor(sr * 0.018);
    let lp = 0;
    for (let i = pre; i < N; i++) {
      const t = (i - pre) / sr;
      // darker as it decays: one-pole low pass with falling cutoff
      const fc = damp * Math.exp(-t * 1.2) + 900;
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      lp = (1 - a) * rnd() + a * lp;
      const env = Math.exp((-6.9 * t) / seconds) * Math.min(1, t / 0.01);
      d[i] = lp * env;
    }
  }
  // normalise energy
  let e = 0;
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < N; i++) e += d[i] * d[i]; }
  const g = 0.9 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < N; i++) d[i] *= g; }
  return buf;
}

/** Soft-knee limiter: a fast compressor into a soft ceiling, so peaks stay under -1 dBFS. */
function limiterCurve(ceiling = 0.89, n = 4097) {
  const c = new Float32Array(n);
  const knee = ceiling * 0.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    let y = a;
    if (a > knee) y = knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/**
 * The automatic makeup gain a DynamicsCompressorNode applies (the Chromium/WebKit/Gecko kernel:
 * pow(1 / curve(0 dBFS), 0.6)). The engine cancels it so a compressor only ever turns loud parts down and
 * the quiet rungs stay quiet.
 */
export function compressorMakeup(threshold, knee, ratio) {
  const lin = (d) => Math.pow(10, d / 20), dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));
  const linT = lin(threshold);
  const kneeCurve = (x, k) => (x < linT ? x : linT + (1 - Math.exp(-k * (x - linT))) / k);
  const slopeAt = (x, k) => {
    if (x < linT) return 1;
    const x2 = x * 1.001;
    return (dB(kneeCurve(x2, k)) - dB(kneeCurve(x, k))) / (dB(x2) - dB(x));
  };
  const xk = lin(threshold + knee);
  let minK = 0.1, maxK = 10000, k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(xk, k) < 1 / ratio) maxK = k; else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const kneeT = lin(threshold + knee);
  const yKneeDb = dB(kneeCurve(kneeT, k));
  const sat = (x) => (x < kneeT ? kneeCurve(x, k) : lin(yKneeDb + (dB(x) - (threshold + knee)) / ratio));
  return Math.pow(1 / sat(1), 0.6);
}

function compressor(ctx, threshold, knee, ratio, attack, release) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = threshold; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = attack; c.release.value = release;
  const comp = gain(ctx, 1 / compressorMakeup(threshold, knee, ratio));
  c.connect(comp);
  return { input: c, output: comp, node: c };
}

export class Mixer {
  constructor(ctx, dest, { simple = false } = {}) {
    this.ctx = ctx;
    this.simple = simple;
    const master = (this.master = gain(ctx, 1));
    // glue: gentle bus compression (2:1 above -18 dB), its automatic makeup cancelled
    const glue = compressor(ctx, -18, 8, 2, 0.02, 0.25);
    this.makeup = gain(ctx, Math.pow(10, 4.2 / 20));
    // limiter: a fast compressor, then a soft ceiling at -1.1 dBFS for anything that still gets through
    const lim = compressor(ctx, -4, 2, 20, 0.001, 0.08);
    const ceil = ctx.createWaveShaper();
    ceil.curve = limiterCurve(0.88);
    this.volume = gain(ctx, 1);
    this.fader = gain(ctx, 1); // menu / match level
    master.connect(glue.input); glue.output.connect(this.makeup).connect(lim.input);
    lim.output.connect(ceil).connect(this.fader).connect(this.volume).connect(dest);
    this.glue = glue.node; this.lim = lim.node;

    // shared reverb
    this.verb = ctx.createConvolver();
    this.verb.buffer = reverbIR(ctx, 1.9);
    const verbHP = biquad(ctx, 'highpass', 220, 0.7);
    const verbLP = biquad(ctx, 'lowpass', 6000, 0.7);
    this.verbIn = gain(ctx, 1);
    this.verbIn.connect(verbHP).connect(this.verb).connect(verbLP).connect(gain(ctx, 0.9)).connect(master);

    const send = (node, amt) => { const s = gain(ctx, amt); node.connect(s).connect(this.verbIn); return s; };
    // sends taken before a bus fader follow that fader (so the wet/dry balance holds at every rung)
    this.linked = {};
    const link = (bus, sendNode, amt) => { (this.linked[bus] = this.linked[bus] || []).push([sendNode, amt]); };

    // ---- drums
    this.drums = gain(ctx, 1);
    const drumEQ = biquad(ctx, 'peaking', 380, 0.9, -2.5); // carve boxiness
    this.drums.connect(drumEQ).connect(master);
    this.kick = gain(ctx, 1);
    const kickEQ1 = biquad(ctx, 'peaking', 62, 1.1, 3); // weight
    const kickEQ2 = biquad(ctx, 'peaking', 320, 1.2, -5); // mud out
    const kickEQ3 = biquad(ctx, 'peaking', 3800, 1.0, 5); // beater click
    this.kick.connect(kickEQ1).connect(kickEQ2).connect(kickEQ3).connect(this.drums);
    this.snare = gain(ctx, 1);
    const snEQ1 = biquad(ctx, 'highpass', 90, 0.7);
    const snEQ2 = biquad(ctx, 'peaking', 210, 1.2, 2.5); // body
    const snEQ3 = biquad(ctx, 'peaking', 4500, 0.8, 4.5); // crack
    this.snare.connect(snEQ1).connect(snEQ2).connect(snEQ3).connect(this.drums);
    link('drums', send(snEQ3, 0.16), 0.16);
    this.toms = gain(ctx, 1);
    const tomEQ = biquad(ctx, 'peaking', 450, 1.0, -3);
    this.toms.connect(tomEQ);
    // toms spread across the stereo field
    this.tomPan = [-0.35, 0, 0.35].map((p) => { const pn = panner(ctx, p); pn.connect(this.drums); return pn; });
    this.tomIn = this.tomPan.map((pn) => { const g = gain(ctx, 1); g.connect(pn); return g; });
    tomEQ.connect(this.tomIn[1]);
    send(this.drums, 0.05);
    // cymbals: one EQ path per pan position (crash left, china/crash 2 right, ride centre-right)
    this.cymL = panner(ctx, -0.45); this.cymR = panner(ctx, 0.5); this.cymC = panner(ctx, 0.15);
    for (const p of [this.cymL, this.cymR, this.cymC]) p.connect(this.drums);
    const mkCymPath = (p) => {
      const g = gain(ctx, 1); const hp = biquad(ctx, 'highpass', 320, 0.7); const hs = biquad(ctx, 'highshelf', 11000, 0.7, -1.5);
      g.connect(hp).connect(hs).connect(p); return g;
    };
    this.cymIn = { L: mkCymPath(this.cymL), R: mkCymPath(this.cymR), C: mkCymPath(this.cymC) };
    link('drums', send(this.cymC, 0.06), 0.06);
    this.hats = gain(ctx, 1);
    const hatHP = biquad(ctx, 'highpass', 450, 0.7);
    const hatPan = panner(ctx, 0.3);
    this.hats.connect(hatHP).connect(hatPan).connect(this.drums);
    this.perc = gain(ctx, 1); // war drums, frame drum, timpani (centre, a little room)
    const percHP = biquad(ctx, 'highpass', 35, 0.7);
    this.perc.connect(percHP).connect(master);
    send(percHP, 0.14);

    // ---- guitars
    this.ampL = new Amp(ctx, { variant: 0, gain: 30 });
    this.ampR = new Amp(ctx, { variant: 1, gain: 28 });
    this.rhythmL = gain(ctx, 1);
    this.rhythmR = gain(ctx, 1);
    this.gtrBus = gain(ctx, 1);
    const gtrHP = biquad(ctx, 'highpass', 95, 0.7);
    const gtrLow = biquad(ctx, 'lowshelf', 160, 0.7, -4.5); // the bass and kick own the bottom octave
    this.gtrBus.connect(gtrHP).connect(gtrLow).connect(master);
    send(gtrLow, 0.035);
    this.panL = panner(ctx, -1);
    const panR = panner(ctx, 1);
    this.ampL.connect(this.rhythmL).connect(this.panL).connect(this.gtrBus);
    this.ampR.output.connect(this.rhythmR);
    this.rhythmR.connect(panR).connect(this.gtrBus);
    this.gtrInL = this.ampL.input;
    this.gtrInR = this.ampR.input;

    this.leadAmp = new Amp(ctx, { lead: true, variant: 2, gain: 11 });
    this.lead = gain(ctx, 1);
    const leadHP = biquad(ctx, 'highpass', 220, 0.7);
    const leadMid = biquad(ctx, 'peaking', 1600, 0.8, 2.5);
    this.leadAmp.connect(leadHP).connect(leadMid).connect(this.lead);
    const leadPan = panner(ctx, 0.1);
    this.lead.connect(leadPan).connect(master);
    // a dotted-eighth-ish delay, set from the tempo
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.3;
    const fb = gain(ctx, 0.28), dlLP = biquad(ctx, 'lowpass', 3200, 0.7), dlHP = biquad(ctx, 'highpass', 400, 0.7);
    const dlOut = gain(ctx, 0.22);
    const dlPan = panner(ctx, -0.35);
    this.lead.connect(this.delay);
    this.delay.connect(dlLP).connect(dlHP).connect(fb).connect(this.delay);
    dlHP.connect(dlOut).connect(dlPan).connect(master);
    send(this.lead, 0.22);
    this.leadIn = this.leadAmp.input;
    // the harmony lead: same amp chain, panned the other way
    this.lead2Amp = new Amp(ctx, { lead: true, variant: 3, gain: 10 });
    this.lead2 = gain(ctx, 0.8);
    {
      const hp2 = (this.lead2HP = biquad(ctx, 'highpass', 220, 0.7));
      this.lead2Amp.connect(hp2).connect(this.lead2);
      const p2 = panner(ctx, -0.3);
      this.lead2.connect(p2).connect(master);
      this.lead2.connect(this.delay);
      send(this.lead2, 0.22);
    }
    this.lead2In = this.lead2Amp.input;
    this.clean = gain(ctx, 1); // clean arpeggios for Prowl: no amp, a touch of chorus-free reverb
    const clHP = biquad(ctx, 'highpass', 110, 0.7), clLP = biquad(ctx, 'lowpass', 5200, 0.7);
    this.clean.connect(clHP).connect(clLP).connect(master);
    send(clLP, 0.28);
    clLP.connect(this.delay);

    // ---- bass with kick ducking
    this.bassAmp = new BassAmp(ctx);
    this.bassDuck = gain(ctx, 1);
    this.bass = gain(ctx, 1);
    this.bassAmp.connect(this.bassDuck).connect(this.bass).connect(master);
    this.bassIn = this.bassAmp.input;

    // ---- orchestra and folk
    this.strings = gain(ctx, 1);
    const stHP = biquad(ctx, 'highpass', 70, 0.7), stLP = biquad(ctx, 'lowpass', 7500, 0.7);
    const stMud = biquad(ctx, 'peaking', 300, 0.9, -3);
    this.strings.connect(stHP).connect(stMud).connect(stLP);
    this.strL = panner(ctx, -0.55); this.strR = panner(ctx, 0.55);
    stLP.connect(this.strL).connect(master); stLP.connect(this.strR).connect(master);
    this.strDelayR = ctx.createDelay(0.05); this.strDelayR.delayTime.value = 0.011; // width without chorus
    stLP.disconnect(this.strR); stLP.connect(this.strDelayR).connect(this.strR);
    send(stLP, 0.3);
    this.brass = gain(ctx, 1);
    const brHP = biquad(ctx, 'highpass', 60, 0.7), brLP = biquad(ctx, 'lowpass', 6500, 0.7);
    const brPan = panner(ctx, -0.15);
    this.brass.connect(brHP).connect(brLP).connect(brPan).connect(master);
    send(brLP, 0.26);
    this.folk = gain(ctx, 1);
    const fkHP = biquad(ctx, 'highpass', 180, 0.7), fkLP = biquad(ctx, 'lowpass', 8000, 0.7);
    const fkPan = panner(ctx, 0.2);
    this.folk.connect(fkHP).connect(fkLP).connect(fkPan).connect(master);
    send(fkLP, 0.24);
    this.drone = gain(ctx, 1);
    const drHP = biquad(ctx, 'highpass', 90, 0.7), drLP = biquad(ctx, 'lowpass', 4200, 0.7);
    this.drone.connect(drHP).connect(drLP).connect(master);
    send(drLP, 0.2);

    this.simple = false;
    for (const b of ['drums', 'gtrBus', 'bass', 'strings', 'brass', 'folk', 'lead', 'lead2', 'perc', 'clean', 'drone']) this[b].gain.value = 0.1;
    if (simple) this.setSimple(true);
  }

  /** Simple mode: one rhythm amp (centred), no harmony amp. The unused amps are disconnected so they cost nothing. */
  setSimple(on) {
    on = !!on;
    if (on === this.simple) return;
    this.simple = on;
    const t = this.ctx.currentTime;
    if (this.panL.pan) this.panL.pan.setTargetAtTime(on ? 0 : -1, t, 0.02);
    if (on) {
      try { this.ampR.output.disconnect(); } catch (e) { /* not connected */ }
      try { this.lead2Amp.output.disconnect(); } catch (e) { /* not connected */ }
    } else {
      this.ampR.output.connect(this.rhythmR);
      this.lead2Amp.output.connect(this.lead2HP);
    }
  }

  /** Kick sidechain: duck the bass by `depth` dB at t, recover over ~90 ms (lighter under fast double kick). */
  duckBass(t, depth = 3.5) {
    const g = this.bassDuck.gain;
    if (this.lastDuck != null && t - this.lastDuck < 0.16 && t >= this.lastDuck) depth *= 0.4;
    this.lastDuck = t;
    const lo = Math.pow(10, -depth / 20);
    g.setTargetAtTime(lo, t, 0.003);
    g.setTargetAtTime(1, t + 0.03, 0.045);
  }

  setTempo(bpm) {
    this.delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, this.ctx.currentTime, 0.05);
  }

  /** Set a bus level (linear) at t with a short ramp. */
  level(bus, v, t, tc = 0.06) {
    const n = this[bus];
    if (!n) return;
    const tt = Math.max(t, this.clock ? this.clock() : this.ctx.currentTime);
    n.gain.setTargetAtTime(v, tt, tc);
    for (const [sn, amt] of (bus === 'drums' && this.linked.drums) || []) sn.gain.setTargetAtTime(v * amt, tt, tc);
  }

  /** Music volume 0..1 (1 = the calibrated level: peaks under -1 dBFS, Crescendo near -16 dB RMS). */
  setVolume(v) {
    const g = Math.max(0, Math.min(1, v));
    this.volume.gain.setTargetAtTime(g * g * 0.7 + g * 0.3, this.clock ? this.clock() : this.ctx.currentTime, 0.05);
  }

  setFader(v, t, tc = 0.4) {
    this.fader.gain.setTargetAtTime(v, Math.max(t, this.ctx.currentTime), tc);
  }
}
