// Voice pool: every sample note is one AudioBufferSourceNode into one GainNode (its envelope). Voices are
// started sample-accurately, choked by group (a re-struck drum or a re-picked string), capped in number
// (stealing the least important, oldest voice) and can all be cut at once for the final-kill hit.

const VIB_CURVES = new Map();

function vibCurve(depthCents, n = 64) {
  const key = depthCents + '|' + n;
  if (VIB_CURVES.has(key)) return VIB_CURVES.get(key);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.pow(2, (depthCents * Math.sin((i / (n - 1)) * Math.PI * 2)) / 1200);
  VIB_CURVES.set(key, c);
  return c;
}

export class Voices {
  constructor(ctx, cap = 48) {
    this.ctx = ctx;
    this.cap = cap;
    this.list = [];
    this.chokes = new Map();
    this.stolen = 0;
    this.peak = 0;
    this.clock = () => ctx.currentTime;
  }

  /**
   * entry: bank entry {buf, gain, off, on, loopS}; rate: playback rate.
   * o: { dest, gain, dur, release, attack, loop, choke, chokeFade, prio, offset, vib:{depth,rate,delay},
   *      slide:{semis,time}, align (default true: the attack lands on `when`), fadeIn }
   */
  play(entry, rate, when, o = {}) {
    if (!entry || !entry.buf || !o.dest) return null;
    const ctx = this.ctx;
    const now = this.clock();
    const align = o.align !== false;
    const preroll = align ? Math.min(entry.on || 0, 0.004) / rate : 0;
    let start = when - preroll;
    let offset = (entry.off || 0) + (o.offset || 0);
    if (start < now) { offset += (now - start) * rate; start = now; }
    const bufDur = entry.buf.duration;
    if (offset >= bufDur - 0.005) return null;
    const loop = !!(o.loop && entry.loopS && entry.loopS[1] > entry.loopS[0] + 0.05);
    const natural = (bufDur - offset) / rate;
    const release = o.release != null ? o.release : 0.03;
    let end = o.dur != null ? when + o.dur : start + natural;
    if (!loop && end > start + natural) end = start + natural;
    const stopAt = Math.min(loop ? end + release * 4 + 0.02 : start + natural, end + release * 4 + 0.02);

    this.prune(now);
    this.makeRoom(start, o.prio || 1);

    const src = ctx.createBufferSource();
    src.buffer = entry.buf;
    src.playbackRate.value = rate;
    if (loop) { src.loop = true; src.loopStart = entry.loopS[0]; src.loopEnd = entry.loopS[1]; }
    const g = ctx.createGain();
    const level = (o.gain != null ? o.gain : 1) * (entry.gain || 1);
    g.gain.value = 0;
    if (o.attack && o.attack > 0.003) {
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(level, start + o.attack);
    } else if (o.fadeIn) {
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(level, start + o.fadeIn);
    } else {
      g.gain.setValueAtTime(level, start);
    }
    if (o.ramp) { // [{t, v}] extra gain automation (relative to level)
      for (const p of o.ramp) g.gain.linearRampToValueAtTime(level * p.v, p.t);
    }
    if (o.dur != null && end < start + natural + 1e-3) {
      g.gain.setTargetAtTime(0, Math.max(start + 0.002, end), Math.max(0.002, release / 3));
    }
    // pitch: slide in from below/above, then vibrato on long notes
    if (o.slide) {
      const r0 = rate * Math.pow(2, o.slide.semis / 12);
      src.playbackRate.setValueAtTime(r0, start);
      src.playbackRate.exponentialRampToValueAtTime(rate, start + (o.slide.time || 0.06));
    }
    if (o.vib && o.dur && o.dur > (o.vib.delay || 0.15) + 0.2) {
      const t0 = start + (o.vib.delay || 0.15) + (o.slide ? o.slide.time || 0.06 : 0);
      const per = 1 / (o.vib.rate || 5.5);
      const cycles = Math.max(1, Math.floor((end - t0) / per));
      const curve = vibCurve(o.vib.depth || 20).map((v) => v * rate);
      src.playbackRate.setValueAtTime(rate, t0);
      // ramp the depth in over the first cycle by using a shallower curve first
      const soft = vibCurve((o.vib.depth || 20) * 0.45).map((v) => v * rate);
      src.playbackRate.setValueCurveAtTime(soft, t0, per);
      if (cycles > 1) src.playbackRate.setValueCurveAtTime(curve, t0 + per + 1e-4, per * (cycles - 1) - 2e-4);
    }
    src.connect(g);
    g.connect(o.dest);
    src.start(start, offset);
    src.stop(stopAt);
    const v = { src, g, start, end: Math.max(end, start) + release * 2, stopAt, prio: o.prio || 1, choke: o.choke, level };
    src.onended = () => { v.done = true; try { g.disconnect(); } catch (e) { /* already */ } };
    if (o.choke) {
      const prev = this.chokes.get(o.choke);
      if (prev) for (const pv of prev) if (pv.start < start) this.release(pv, start, o.chokeFade || 0.008);
      this.chokes.set(o.choke, [v]);
    }
    this.list.push(v);
    const n = this.activeAt(start);
    if (n > this.peak) this.peak = n;
    return v;
  }

  /** Add a voice to a choke group without choking (power-chord partners). */
  join(v, key) {
    if (!v) return;
    const a = this.chokes.get(key);
    if (a) a.push(v); else this.chokes.set(key, [v]);
    v.choke = key;
  }

  /** Release a voice at time t with a short fade. */
  release(v, t, fade = 0.01) {
    if (!v || v.done || v.releasedAt <= t) return;
    const tt = Math.max(t, v.start);
    try {
      v.g.gain.cancelScheduledValues(tt);
      if (tt > v.start) v.g.gain.setValueAtTime(v.level, tt);
      v.g.gain.setTargetAtTime(0, tt, Math.max(0.001, fade / 3));
      const st = tt + fade * 3 + 0.005;
      if (st < v.stopAt) { v.src.stop(st); v.stopAt = st; }
    } catch (e) { /* node already stopped */ }
    v.releasedAt = tt;
    v.end = Math.min(v.end, tt + fade * 2);
  }

  /** Choke a group at time t. */
  chokeAt(key, t, fade = 0.01) {
    const a = this.chokes.get(key);
    if (a) for (const v of a) this.release(v, t, fade);
  }

  /** Cut every voice (sounding or scheduled) at time t. */
  cutAll(t, fade = 0.012) {
    for (const v of this.list) {
      if (v.done) continue;
      if (v.start >= t) {
        try { v.g.gain.cancelScheduledValues(0); v.g.gain.value = 0; v.src.stop(v.start + 0.001); } catch (e) { /* ignore */ }
        v.end = v.start; v.releasedAt = v.start;
      } else {
        // a voice that is sounding: hold its level then fade
        try {
          v.g.gain.cancelScheduledValues(t);
          v.g.gain.setTargetAtTime(0, t, fade / 3);
          v.src.stop(t + fade * 4);
        } catch (e) { /* ignore */ }
        v.end = t + fade; v.releasedAt = t;
      }
    }
    this.chokes.clear();
  }

  activeAt(t) {
    let n = 0;
    for (const v of this.list) if (!v.done && v.start <= t + 0.001 && v.end > t) n++;
    return n;
  }

  makeRoom(t, prio) {
    let n = this.activeAt(t);
    while (n >= this.cap) {
      let victim = null;
      for (const v of this.list) {
        if (v.done || v.releasedAt <= t || !(v.start <= t && v.end > t)) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
      }
      if (!victim || victim.prio > prio + 1) break;
      this.release(victim, t, 0.012);
      this.stolen++;
      n--;
    }
  }

  prune(now) {
    if (this.list.length < 96) return;
    this.list = this.list.filter((v) => !v.done && v.end > now - 0.05);
    for (const [k, a] of this.chokes) {
      const b = a.filter((v) => !v.done && v.end > now - 0.05);
      if (b.length) this.chokes.set(k, b); else this.chokes.delete(k);
    }
  }
}
