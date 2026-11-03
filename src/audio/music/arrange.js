// Intensity and the ladder. The game feeds events in; the engine keeps one number from 0 to 1 that decays
// toward a floor (raised by the round's tension) with a 6 s time constant. The ladder turns it into one of
// five rungs, changing only on bar lines: up one rung at once, up more than one through a one-bar build,
// down only after 4 bars at the rung and then one rung per 2 bars, each drop through a fill.

export const LEVELS = ['Prowl', 'Riff', 'Charge', 'Battle', 'Crescendo'];
export const THRESHOLDS = [0.15, 0.4, 0.65, 0.85];
const HYST = 0.03;

export const EVENT_WEIGHTS = { hit: 0.04, heavy: 0.08, blast: 0.12, kill: 0.25, summon: 0.3, break: 0.01, pickup: 0.02 };

export function levelFor(v) {
  let l = 0;
  while (l < 4 && v >= THRESHOLDS[l]) l++;
  return l;
}

export class Intensity {
  constructor() { this.reset(); }

  reset() {
    this.value = 0;
    this.floor = 0;
    this.t = null;
    this.breakBudget = 0.1;
    this.tensionState = { alive: 8, closePairs: 0, ragnarok: false };
  }

  /** Advance the decay to time t (seconds, any clock). */
  update(t) {
    if (this.t == null) { this.t = t; return this.value; }
    const dt = Math.max(0, t - this.t);
    this.t = t;
    if (this.value > this.floor) this.value = this.floor + (this.value - this.floor) * Math.exp(-dt / 6);
    if (this.value < this.floor) this.value = this.floor;
    this.breakBudget = Math.min(0.1, this.breakBudget + dt * 0.1);
    return this.value;
  }

  event(kind, weight = 1, t) {
    if (t != null) this.update(t);
    const base = EVENT_WEIGHTS[kind];
    if (base == null) return this.value;
    let add = base * (weight == null ? 1 : Math.max(0, weight));
    if (kind === 'break') { add = Math.min(add, this.breakBudget); this.breakBudget -= add; }
    this.value = Math.min(1, this.value + add);
    return this.value;
  }

  tension({ alive = 8, closePairs = 0, ragnarok = false } = {}, t) {
    if (t != null) this.update(t);
    this.tensionState = { alive, closePairs, ragnarok };
    let f = Math.min(0.3, Math.max(0, closePairs) * 0.06);
    if (alive <= 3) f = Math.max(f, 0.45);
    if (alive <= 2) f = Math.max(f, 0.65);
    if (ragnarok) f = Math.max(f, 0.8);
    this.floor = f;
    if (this.value < f) this.value = f;
    return this.value;
  }
}

/**
 * The rung state machine, advanced once per bar with the current intensity.
 * Returns { level, build, buildTo, land, fill, from } for the bar about to start:
 *   build: this bar is a one-bar build toward buildTo; land: this bar lands a climb (crash and bass hit);
 *   fill: 'drop' when the next bar drops a rung.
 */
export class Ladder {
  constructor(level = 0) { this.reset(level); }

  reset(level = 0) {
    this.level = level;
    this.barsAt = 0;
    this.pendingDrop = false;
    this.buildTo = -1;
    this.lastMove = 'none';
  }

  target(v) {
    let t = levelFor(v);
    // hysteresis on the way down
    if (t < this.level && v >= THRESHOLDS[this.level - 1] - HYST) t = this.level;
    return t;
  }

  next(v) {
    const from = this.level;
    const out = { level: this.level, build: false, buildTo: -1, land: false, fill: null, from };
    const target = this.target(v);
    if (this.buildTo >= 0) {
      // the build lands here, on the higher of what it aimed for and where the fight is now
      this.level = Math.max(this.buildTo, Math.min(4, target));
      this.buildTo = -1;
      this.barsAt = 1;
      this.lastMove = 'up';
      this.pendingDrop = false;
      return { ...out, level: this.level, land: true };
    }
    if (this.pendingDrop) {
      this.pendingDrop = false;
      if (target < this.level) {
        this.level -= 1;
        this.barsAt = 0;
        this.lastMove = 'down';
      }
    }
    if (target > this.level) {
      if (target - this.level >= 2) {
        this.buildTo = target;
        this.barsAt += 1;
        return { ...out, level: this.level, build: true, buildTo: target };
      }
      this.level = target;
      this.barsAt = 1;
      this.lastMove = 'up';
      return { ...out, level: this.level, land: true };
    }
    this.barsAt += 1;
    if (target < this.level) {
      const need = this.lastMove === 'down' ? 2 : 4;
      if (this.barsAt >= need) {
        this.pendingDrop = true;
        return { ...out, level: this.level, fill: 'drop' };
      }
    }
    return { ...out, level: this.level };
  }
}

/** Which kind of phrase a rung plays, cycling through a few so a long stay doesn't stand still. */
export function phraseKind(level, phraseIdx, style, menu) {
  if (menu) return level === 0 ? 'prowl' : 'verse';
  switch (level) {
    case 0: return 'prowl';
    case 1: return 'verse';
    case 2: return 'verse';
    case 3: return ['chorus', 'chorus', 'verse'][phraseIdx % 3];
    default: return style === 'viking' ? ['chorus', 'chorus', 'chorus', 'bridge'][phraseIdx % 4] : ['chorus', 'chorus', 'bridge'][phraseIdx % 3];
  }
}
