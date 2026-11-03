// AI fighters press the same stick and two buttons as a player.
import { AI_SKILLS, W, H, MAT, cellIndex, inGrid, KILL_Y, G, groups, ALL_FIGHTERS, ATK, NO_DIR, FIGHTER_HP } from '../core/consts.js';
import { makeRng } from '../core/rng.js';
import { Nav, cellX, cellY } from './nav.js';

const MELEE_REACH = { axe: 1.9, sword: 2.6, hammer: 2.0 };
const TEMPERAMENTS = ['aggressive', 'cautious', 'collector'];

export class Bot {
  constructor(sim, slot, skill = 1, seed = '') {
    this.sim = sim;
    this.slot = slot;
    this.skill = AI_SKILLS[Math.max(0, Math.min(2, skill))];
    this.rng = makeRng('bot/' + slot + '/' + seed);
    this.temper = this.rng.pick(TEMPERAMENTS);
    this.inp = { x: 0, y: 0, b: 0, jp: 0, ap: 0, ak: ATK.NORMAL, ad: NO_DIR };
    this.think = this.rng.float(0, 0.1);
    this.goal = null;
    this.target = null;
    this.hold = 0;
    this.aimErr = 0;
    this.react = 0;
    this.stuckT = 0;
    this.lastX = 0;
    this.downCool = 0;
    this.wantJump = false;
    this.mode = 'idle';
    this.path = null;
    this.wp = 0;
    // Routes that didn't work (a jump into an overhang, a drop that wasn't there): 'a>b' cell keys → expiry.
    this.badEdges = new Map();
    // Foes we couldn't get to lately: slot → expiry. Picked again only when nobody else is left.
    this.badFoes = new Map();
    this.wpKey = null; this.wpT = 0; this.wpJumps = 0;
    if (!sim.nav) sim.nav = new Nav(sim);
  }

  get f() { return this.sim.fighters[this.slot]; }

  solid(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    if (!inGrid(i, j)) return false;
    return this.sim.terrain.grid[cellIndex(i, j)] !== 0;
  }

  // Ground under a column (first solid cell top below y), or -Infinity.
  groundBelow(x, y, depth = 8) {
    for (let k = 0; k < depth; k++) if (this.solid(x, y - k - 0.5)) return Math.floor(y - k - 0.5) + 1;
    return -Infinity;
  }

  update(dt) {
    const f = this.f;
    const out = this.inp;
    if (!f || !f.alive || this.sim.phase === 'dropin') { out.x = 0; out.y = 0; out.b = 0; return out; }
    this.think -= dt;
    this.react -= dt;
    this.downCool -= dt;
    if (this.think <= 0) { this.decide(); this.think = this.skill.think + this.rng.float(0, 0.05); }
    this.drive(dt);
    return out;
  }

  enemies() {
    return this.sim.fighters.filter((o) => o && o !== this.f && o.alive);
  }

  decide() {
    const f = this.f, sim = this.sim;
    const me = f.pos();
    this.banned = this.banned || new Map();
    for (const m of [this.banned, this.badEdges, this.badFoes]) for (const [k, t] of m) if (t < sim.time) m.delete(k);
    // Keep a goal for a moment before switching, unless it's gone.
    if (this.goalT > sim.time && this.goal && (!this.goal.ref || this.goal.ref())) { this.refreshGoal(); return; }
    const all = this.enemies();
    const reachable = all.filter((o) => !this.badFoes.has(o.slot));
    const foes = reachable.length ? reachable : all;
    // Target: closest, or weakest for the aggressive.
    let best = null, bd = Infinity;
    for (const o of foes) {
      const t = o.pos();
      let d = Math.hypot(t.x - me.x, (t.y - me.y) * 1.4);
      if (this.temper === 'aggressive') d -= (1 - o.hp / FIGHTER_HP) * 8;
      if (o.lastHit && o.lastHit.by === this.slot) d -= 2;
      if (d < bd) { bd = d; best = o; }
    }
    this.target = best;
    // Items: unarmed (or collector) goes for the nearest one in reach.
    let item = null, id = Infinity;
    const wantItem = !f.item || (this.temper === 'collector' && !f.back);
    if (wantItem) for (const it of sim.items.world.values()) {
      if (it.crated || it.thrown || this.banned.has(it.id)) continue;
      const p = it.body.translation();
      if (p.y < KILL_Y + 1) continue;
      const d = Math.hypot(p.x - me.x, (p.y - me.y) * 1.3);
      if (d < id && d < (f.item ? 9 : 22)) { id = d; item = p; item.id = it.id; }
    }
    if (item && (!best || id < bd * 1.3 || !f.item)) {
      const iid = item.id;
      this.goal = { x: item.x, y: item.y, item: true, id: iid, ref: () => sim.items.world.has(iid) };
      this.mode = 'item';
    } else if (best && reachable.length) { const o = best; const t = o.pos(); this.goal = { x: t.x, y: t.y, foe: o, ref: () => o.alive }; this.mode = 'fight'; }
    else if (best || !this.goal) this.wander();
    else this.goal = null;
    this.goalT = sim.time + 0.7;
    this.progress = { t: sim.time, d: Infinity };
    // Cautious bots back off when hurt and their foe is armed.
    if (this.temper === 'cautious' && best && f.hp < FIGHTER_HP * 0.4 && best.item) {
      const t = best.pos();
      this.goal = { x: me.x + Math.sign(me.x - t.x || 1) * 6, y: me.y };
      this.mode = 'flee';
    }
    this.aimErr = (this.rng.next() - 0.5) * this.skill.aimErr * (Math.PI / 180) * 2;
    this.refreshGoal();
  }

  // Nobody reachable: head somewhere a few hops away (somewhere new each time), and look again soon.
  wander() {
    const f = this.f, sim = this.sim, feet = f.feet();
    const cells = sim.nav.around(sim.nav.cellAt(feet.x, feet.y), 50);
    this.goal = null;
    if (cells.length > 3) {
      const c = cells[Math.min(cells.length - 1, 3 + Math.floor(this.rng.next() * (cells.length - 3)))];
      this.goal = { x: cellX(c), y: cellY(c) + 1, wander: true };
    }
    this.mode = 'wander';
  }

  // Update the goal's position and route; give up on goals we make no progress toward.
  refreshGoal() {
    const f = this.f, sim = this.sim;
    if (this.goal && this.goal.foe) { const t = this.goal.foe.pos(); this.goal.x = t.x; this.goal.y = t.y; }
    if (this.goal && this.goal.item) { const it = sim.items.world.get(this.goal.id); if (it) { const p = it.body.translation(); this.goal.x = p.x; this.goal.y = p.y; } }
    const me = f.pos();
    if (this.goal && this.progress) {
      const d = Math.hypot(this.goal.x - me.x, this.goal.y - me.y);
      if (d < this.progress.d - 0.8) this.progress = { t: sim.time, d };
      else if (sim.time - this.progress.t > 2.5 && d > 2) {
        if (this.goal.item) this.banned.set(this.goal.id, sim.time + 6);
        if (this.goal.foe) this.badFoes.set(this.goal.foe.slot, sim.time + 5);
        this.goalT = 0;
        this.progress = { t: sim.time, d: Infinity };
      }
    }
    // Last resort: hardly moved in 4 s with the goal still out of reach → give it up and go somewhere else.
    if (!this.anchor || Math.hypot(me.x - this.anchor.x, me.y - this.anchor.y) > 0.8) this.anchor = { x: me.x, y: me.y, t: sim.time };
    else if (sim.time - this.anchor.t > 4 && this.goal && Math.hypot(this.goal.x - me.x, this.goal.y - me.y) > 2.2) {
      if (this.goal.item) this.banned.set(this.goal.id, sim.time + 8);
      if (this.goal.foe) this.badFoes.set(this.goal.foe.slot, sim.time + 6);
      this.badEdges.clear();
      this.wander();
      this.goalT = sim.time + 2.5;
      this.anchor.t = sim.time;
    }
    // Route over the level toward the goal.
    this.path = null;
    if (this.goal) {
      const nav = sim.nav;
      nav.update();
      const feet = f.feet();
      const gy = this.goal.item ? this.goal.y - 0.2 : this.goal.y - 1.0;
      const from = nav.cellAt(feet.x, feet.y), to = nav.cellAt(this.goal.x, gy);
      const p = nav.path(from, to, this.badEdges);
      if (p && p.length > 1) { this.path = p; this.wp = 1; }
      // Standing somewhere with no way there at all: try someone (or something, or somewhere) else.
      else if (!p && from >= 0 && to >= 0 && f.grounded && !this.goal.wander) {
        if (this.goal.foe) this.badFoes.set(this.goal.foe.slot, sim.time + 4);
        if (this.goal.item) this.banned.set(this.goal.id, sim.time + 6);
        if (this.mode === 'flee') this.wander(); else this.goalT = 0;
      }
    }
  }

  drive(dt) {
    const f = this.f, out = this.inp, sim = this.sim;
    const me = f.pos();
    const feet = f.feet();
    let sx = 0, sy = 0, jump = false, act = false, actHold = false;
    // (waypoint jumps are decided below, before the goal logic)
    let g = this.goal;
    // Follow the route: the next waypoint stands in for the goal until we're on the goal's platform.
    if (g && this.path && this.wp < this.path.length) {
      let c = this.path[this.wp];
      if (Math.abs(cellX(c) - me.x) < 0.5 && Math.abs(cellY(c) - feet.y) < 0.8 && f.grounded) {
        this.wp++;
        c = this.path[Math.min(this.wp, this.path.length - 1)];
      }
      // A waypoint that takes too long (or too many jumps) is a route that doesn't work: avoid it and replan.
      const key = this.wp < this.path.length ? this.path[this.wp - 1] + '>' + c : null;
      if (key !== this.wpKey) { this.wpKey = key; this.wpT = 0; this.wpJumps = 0; }
      this.wpT += dt;
      const lim = 1.6 + Math.abs(cellY(c) - feet.y) * 0.4 + Math.abs(cellX(c) - me.x) * 0.15;
      if (key && (this.wpT > lim || this.wpJumps > 5)) {
        this.badEdges.set(key, sim.time + 15);
        this.wpKey = null; this.path = null; this.goalT = 0; this.think = 0;
      }
      if (this.path && this.wp < this.path.length) {
        const wx = cellX(c), wy = cellY(c);
        g = { x: wx, y: wy + 1.0, item: g.item, way: true };
        const dyw = wy - feet.y;
        if (dyw > 0.6 && f.grounded && Math.abs(wx - me.x) < (dyw >= 2 ? 1.8 : 3.2)) jump = true;
        // Double jump near the top of the first one if the ledge is still above the feet.
        if (dyw > 0.3 && !f.grounded && f.vel().y < 2.5 && f.jumps > 0 && feet.y < wy + 0.1) jump = true;
        this.climb = dyw > 0.3;
      }
    }
    if (g) {
      const dx = g.x - me.x, dy = g.y - me.y;
      const dir = Math.sign(dx);
      const close = Math.abs(dx) < (g.way ? 0.25 : this.mode === 'item' ? 0.5 : 1.0);
      if (!close) sx = dir * (Math.abs(dx) > 3 || (g.way && (this.climb || !f.grounded || Math.abs(dx) > 0.8)) ? 1 : 0.6);
      // Obstacles: a wall ahead at foot or body height → jump.
      const ahead = me.x + dir * 0.9;
      if (f.grounded && !close && (this.solid(ahead, feet.y + 0.5) || this.solid(ahead, feet.y + 1.4))) jump = true;
      // Goal above → jump when roughly under or near it.
      if (dy > 1.6 && Math.abs(dx) < 4.5 && f.grounded) jump = true;
      if (dy > 1.0 && !f.grounded && f.vel().y < 1 && f.jumps > 0) jump = true;
      // A gap ahead: jump across if there's ground beyond, stop if the drop is fatal.
      if (f.grounded && !close) {
        const gAhead = this.groundBelow(me.x + dir * 1.2, feet.y + 0.3, 30);
        if (gAhead === -Infinity) {
          // Look for somewhere to land: across the gap, or lower down toward the goal.
          let far = -Infinity;
          for (let k = 2; k <= 6 && far === -Infinity; k++) far = this.groundBelow(me.x + dir * k, feet.y + 2.5, dy < -1 ? 14 : 6);
          if (far !== -Infinity && far > feet.y - 0.5) jump = true;
          else if (far !== -Infinity) { if (Math.abs(dx) > 2) jump = this.rng.chance(0.3); }
          else if (dy > -1 || this.groundBelow(g.x, g.y + 0.5, 3) === -Infinity) sx = 0; // don't walk into the abyss
        }
      }
      // Airborne over nothing: steer toward the nearest ground column.
      if (!f.grounded && me.y < 4 && this.groundBelow(me.x, me.y, 12) === -Infinity) {
        let bestX = null;
        for (let k = 1; k < 12; k++) for (const s of [-1, 1]) if (bestX === null && this.groundBelow(me.x + s * k, me.y + 2, 10) !== -Infinity) bestX = me.x + s * k;
        if (bestX !== null) sx = Math.sign(bestX - me.x);
        if (f.jumps > 0 && f.vel().y < 0) jump = true;
        if (f.back && f.back.kind === 'jetpack') { jump = true; sy = 0.6; }
      }
      // Pick up items when on them.
      if (this.mode === 'item' && Math.abs(dx) < 1 && Math.abs(dy) < 1.4 && this.downCool <= 0) { sy = -1; sx = 0; this.downCool = 0.5; }
    }
    // Stuck detection: not moving while trying → jump.
    if (Math.abs(sx) > 0.3) {
      if (Math.abs(me.x - this.lastX) < 0.02) this.stuckT += dt; else this.stuckT = 0;
      if (this.stuckT > 0.5) { jump = true; this.stuckT = 0; }
    }
    // Never jump into a ceiling: step out from under it first (toward the goal if that side is open).
    if (jump && (f.grounded || f.lowRoof || f.jumps > 0)) {
      const roof = (x) => this.solid(x, feet.y + 1.2) || this.solid(x, feet.y + 2.2) || this.solid(x, feet.y + 2.9);
      if (roof(me.x) || f.lowRoof) {
        jump = false;
        const want = g ? Math.sign(g.x - me.x) || 1 : f.facing;
        for (const s of [want, -want]) {
          let k = 1;
          while (k <= 5 && roof(me.x + s * k) && !this.solid(me.x + s * k, feet.y + 0.5)) k++;
          if (k <= 5 && !this.solid(me.x + s * k, feet.y + 0.5)) { sx = s; break; }
        }
      }
    }
    this.lastX = me.x;
    // Combat.
    out.ak = ATK.NORMAL;
    const T = this.target && this.target.alive ? this.target : null;
    let aimX = sx, aimY = sy;
    if (T && this.react <= 0) {
      const t = T.pos();
      const dx = t.x - me.x, dy = t.y - me.y, d = Math.hypot(dx, dy);
      const it = f.item ? f.item.kind : null;
      let ang = Math.atan2(dy, dx) + this.aimErr;
      const aim = (a) => { aimX = Math.cos(a); aimY = Math.sin(a); };
      if (!it) {
        if (d < 1.35) {
          aim(ang); act = true;
          // Mostly jabs (aiming up or down makes them uppercuts and slams); a kick for a ducker (or now and
          // then), a haymaker on someone already reeling.
          out.ak = T.ducking || this.rng.chance(0.12) ? ATK.KICK : (T.poise < 0.5 && this.rng.chance(0.5)) || this.rng.chance(0.08) ? ATK.HEAVY : ATK.NORMAL;
          // Kicks: a sweep for a ducker, now and then a roundhouse.
          if (out.ak === ATK.KICK) ang = T.ducking ? -0.9 * Math.sign(Math.cos(ang) || 1) + (Math.cos(ang) < 0 ? Math.PI : 0) : this.rng.chance(0.3) ? (Math.cos(ang) < 0 ? Math.PI - 0.7 : 0.7) : ang;
          aim(ang);
        } else if (d < 4 && Math.abs(dy) < 0.8 && f.grounded && this.rng.chance(0.012)) {
          aim(ang); act = true; out.ak = ATK.DROPKICK;
        }
      }
      else if (MELEE_REACH[it]) {
        if (d < MELEE_REACH[it]) {
          aim(ang); act = true;
          // The big ones (axe whirl, sword lunge, hammer spin) now and then, more when crowded.
          const near = this.sim.fighters.filter((o) => o && o.alive && o !== f && Math.hypot(o.pos().x - me.x, o.pos().y - me.y) < 2.2).length;
          if (this.rng.chance(near > 1 ? 0.35 : 0.12)) out.ak = ATK.HEAVY;
        }
        else if (it === 'hammer' && d < 3 && this.rng.chance(0.02)) actHold = true;
      } else if (it === 'blunderbuss') { if (d < 8 && this.los(me, t)) { aim(ang); act = true; } }
      else if (it === 'rocket') { if (d > 3 && d < 22 && this.los(me, t)) { aim(ang); act = true; } }
      else if (it === 'bombs') {
        if (d < 12) { aim(Math.atan2(dy + d * 0.45, dx)); this.hold += dt; actHold = this.hold < 0.25 + d * 0.04; if (!actHold) this.hold = this.hold > 1.2 ? 0 : this.hold; }
      } else if (it === 'web') { if (d < 12 && this.los(me, t)) { aim(ang); act = true; } }
      else if (it === 'tractor') {
        if (f.beam && f.beam.body) { aim(ang); actHold = this.rng.next() > 0.03; }
        else if (d < 11) { aim(ang); actHold = true; }
      } else if (it === 'portal') { if (this.rng.chance(0.03)) { aim(this.rng.float(-Math.PI, Math.PI)); act = true; } }
      else if (it === 'horn') { if (d < 16) { aim(ang); act = true; } }
      // Bare-handed, aiming steeply up or down makes an uppercut or a slam (a stomp in the air): only sometimes.
      if (act && !it && Math.abs(aimY) > 0.55 && !this.rng.chance(aimY > 0 ? 0.5 : 0.2)) aimY = Math.sign(aimY) * 0.5;
      // Keep aiming while moving: the stick both moves and aims, so blend.
      if (act || actHold) { sx = Math.abs(aimX) > 0.3 ? aimX * (Math.abs(sx) > 0 ? 1 : 0.35) : sx; sy = aimY; }
      if (act || actHold) this.react = this.skill.react * this.rng.float(0.6, 1.4);
    }
    // Throw a melee weapon now and then: a tap lobs it toward the target.
    if (T && f.item && MELEE_REACH[f.item.kind] && this.rng.chance(0.002)) { const t = T.pos(); sx = Math.sign(t.x - me.x) || 1; sy = 0.25; act = true; out.ak = ATK.THROW; }
    out.x = Math.max(-1, Math.min(1, sx));
    out.y = Math.max(-1, Math.min(1, sy));
    if (jump) { out.jp = (out.jp + 1) & 255; if (this.wpKey) this.wpJumps++; }
    if (act) out.ap = (out.ap + 1) & 255;
    const jet = f.back && f.back.kind === 'jetpack' && !f.grounded && g && g.y > me.y + 1;
    out.b = (jump || jet ? 1 : 0) | (actHold || act ? 2 : 0);
  }

  los(a, b) {
    const sim = this.sim, R = sim.R;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 0.1) return true;
    const hit = sim.world.castRay(new R.Ray({ x: a.x, y: a.y }, { x: dx / d, y: dy / d }), d - 0.6, true, undefined, groups(G.SENSOR, G.TERRAIN));
    return !hit;
  }
}
