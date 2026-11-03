// Sample bank: loads assets/audio/music/bank.json, fetches and decodes the files a few at a time, aligns each
// buffer's attack (MP3 decoders add a little delay), and picks the right file for a note or a hit.
// A part that fails to load gets a simple synthesized substitute so the band always plays.

import { synthPart } from './fallback.js';

const GROUP_ORDER = ['core', 'folk', 'orch'];

function decode(ctx, ab) {
  return new Promise((res, rej) => {
    try {
      const p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    } catch (e) { rej(e); }
  });
}

/** Onset (seconds) of the first sample above -20 dB of the buffer's peak. */
function measureOnset(buf) {
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > pk) pk = a; }
  const thr = pk * 0.1;
  for (let i = 0; i < d.length; i++) if (d[i] > thr || d[i] < -thr) return i / buf.sampleRate;
  return 0;
}

export class Bank {
  constructor(ctx) {
    this.ctx = ctx;
    this.meta = null;
    this.parts = new Map(); // part -> { kind, group, files: [entry], synth: bool }
    this.loadedGroups = new Set();
    this.rr = new Map();
    this.warnings = [];
    this.seconds = 0;
  }

  async loadMeta(base) {
    try {
      const r = await fetch(base + 'bank.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.meta = await r.json();
    } catch (e) {
      this.warn(`music: bank.json failed to load (${e.message}); using synthesized instruments`);
      this.meta = { parts: FALLBACK_PARTS, files: [] };
    }
    for (const [p, info] of Object.entries(this.meta.parts)) {
      if (!this.parts.has(p)) this.parts.set(p, { kind: info.kind, group: info.group, files: [], synth: false });
    }
  }

  warn(msg) {
    this.warnings.push(msg);
    try { console.warn(msg); } catch (e) { /* no console */ }
  }

  /** Load every file of the given groups. Resolves when all were tried; never rejects. */
  async loadGroups(base, groups, { concurrency = 4, onProgress } = {}) {
    if (!this.meta) await this.loadMeta(base);
    const want = groups.filter((g) => !this.loadedGroups.has(g));
    if (!want.length) return;
    want.forEach((g) => this.loadedGroups.add(g));
    const order = (f) => GROUP_ORDER.indexOf(this.meta.parts[f.part]?.group);
    const todo = this.meta.files.filter((f) => want.includes(this.meta.parts[f.part]?.group))
      .sort((a, b) => order(a) - order(b));
    let done = 0, next = 0;
    const failedParts = new Set();
    const staged = new Map(); // part -> entries; a part goes live only when all its files have been tried
    const worker = async () => {
      while (next < todo.length) {
        const f = todo[next++];
        try {
          const r = await fetch(base + f.file);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = await decode(this.ctx, await r.arrayBuffer());
          const dOn = measureOnset(buf);
          let off = dOn - (f.on || 0);
          if (!(off >= 0 && off < 0.08)) off = 0;
          const e = { ...f, buf, off };
          if (f.loop) e.loopS = [f.loop[0] + off, f.loop[1] + off];
          if (!staged.has(f.part)) staged.set(f.part, []);
          staged.get(f.part).push(e);
          this.seconds += buf.duration;
        } catch (err) {
          const msg = `music: ${f.file} failed (${err && err.message ? err.message : err})`;
          // every failure is kept in warnings(); the console gets the first one per part
          if (failedParts.has(f.part)) this.warnings.push(msg); else this.warn(msg);
          failedParts.add(f.part);
        }
        done++;
        if (onProgress) { try { onProgress(done / todo.length); } catch (e) { /* ignore */ } }
        // let the main thread breathe between decodes
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    for (const [p, part] of this.parts) {
      if (!want.includes(part.group)) continue;
      part.files = staged.get(p) || [];
      part.files.sort((a, b) => (a.midi || 0) - (b.midi || 0) || a.vel - b.vel || a.rr - b.rr);
      if (!part.files.length) {
        this.warn(`music: part "${p}" has no samples${failedParts.has(p) ? ' (load failed)' : ''}; using a synthesized substitute`);
        part.files = synthPart(this.ctx, p, part.kind, this.meta.files.filter((f) => f.part === p));
        part.synth = true;
      }
    }
  }

  has(part) {
    const p = this.parts.get(part);
    return !!(p && p.files.length);
  }

  /** A pitched sample for `midi`. prefer: 'near' | 'below' (resample up) | 'above' (resample down). */
  note(part, midi, prefer = 'near', vel = 1) {
    const p = this.parts.get(part);
    if (!p || !p.files.length) return null;
    let fs = p.files;
    const layers = [...new Set(fs.map((f) => f.vel))];
    if (layers.length > 1) {
      const want = vel >= 0.55 ? Math.max(...layers) : Math.min(...layers);
      const sub = fs.filter((f) => f.vel === want);
      if (sub.length) fs = sub;
    }
    let best = null, bd = 1e9;
    for (const f of fs) {
      const d = midi - f.midi; // semitones to resample up
      let cost = Math.abs(d);
      if (prefer === 'below' && d < 0) cost += 2.5;
      if (prefer === 'above' && d > 0) cost += 2.5;
      if (d > 0) cost += 0.15; // resampling down keeps the formants a little more natural
      if (cost < bd || (cost === bd && f.rr !== best.rr && this.flip(part))) { bd = cost; best = f; }
    }
    if (!best) return null;
    // round robins at the same pitch
    const same = fs.filter((f) => f.midi === best.midi);
    if (same.length > 1) best = same[this.nextRR(part + best.midi, same.length)];
    return { f: best, rate: Math.pow(2, (midi - best.midi) / 12) };
  }

  /** A drum hit: velocity layer by vel, round robin within the layer. */
  hit(part, vel = 1, layersOK = true) {
    const p = this.parts.get(part);
    if (!p || !p.files.length) return null;
    const layers = [...new Set(p.files.map((f) => f.vel))].sort((a, b) => a - b);
    let L = layers[layers.length - 1];
    if (layersOK && layers.length === 2) L = vel >= 0.62 ? layers[1] : layers[0];
    else if (layersOK && layers.length >= 3) L = vel >= 0.78 ? layers[2] : vel >= 0.5 ? layers[1] : layers[0];
    const fs = p.files.filter((f) => f.vel === L);
    const f = fs.length > 1 ? fs[this.nextRR(part + L, fs.length)] : fs[0];
    return { f, rate: 1 };
  }

  nextRR(key, n) {
    const i = ((this.rr.get(key) || 0) + 1) % n;
    this.rr.set(key, i);
    return i;
  }

  flip(key) {
    const i = ((this.rr.get('~' + key) || 0) + 1) % 2;
    this.rr.set('~' + key, i);
    return i === 1;
  }
}

// If bank.json itself is missing, these parts are synthesized.
const FALLBACK_PARTS = {
  kick: { kind: 'drum', group: 'core' }, kick_boom: { kind: 'drum', group: 'core' }, snare: { kind: 'drum', group: 'core' },
  snare_roll: { kind: 'loop', group: 'core' }, sticks: { kind: 'drum', group: 'core' }, tom_hi: { kind: 'drum', group: 'core' },
  tom_mid: { kind: 'drum', group: 'core' }, tom_lo: { kind: 'drum', group: 'core' }, hat: { kind: 'drum', group: 'core' },
  hat_open: { kind: 'drum', group: 'core' }, hat_pedal: { kind: 'drum', group: 'core' }, ride: { kind: 'drum', group: 'core' },
  ride_bell: { kind: 'drum', group: 'core' }, crash: { kind: 'drum', group: 'core' }, crash_big: { kind: 'drum', group: 'core' },
  china: { kind: 'drum', group: 'core' }, splash: { kind: 'drum', group: 'core' }, swell: { kind: 'swell', group: 'core' },
  war_drum: { kind: 'drum', group: 'core' }, war_tom: { kind: 'drum', group: 'core' }, frame_drum: { kind: 'drum', group: 'core' },
  gtr_clean: { kind: 'pitched', group: 'core' }, gtr_mute: { kind: 'pitched', group: 'core' }, bass: { kind: 'pitched', group: 'core' },
  timpani: { kind: 'pitched', group: 'orch' }, timpani_roll: { kind: 'pitched', group: 'orch' }, str_sus: { kind: 'pitched', group: 'orch' },
  str_spic: { kind: 'pitched', group: 'orch' }, horn_sus: { kind: 'pitched', group: 'orch' }, horn_stac: { kind: 'pitched', group: 'orch' },
  tbn_stac: { kind: 'pitched', group: 'orch' }, tuba_stac: { kind: 'pitched', group: 'orch' }, tpt_stac: { kind: 'pitched', group: 'orch' },
  fiddle: { kind: 'pitched', group: 'folk' }, whistle: { kind: 'pitched', group: 'folk' }, bagpipe: { kind: 'pitched', group: 'folk' },
};
