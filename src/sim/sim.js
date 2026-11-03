// The authoritative simulation. Only the host runs it; every device draws from its frames and events.
import { STEP, GRAVITY, KILL_Y, G, groups, MAT, W, H } from '../core/consts.js';
import { makeRng } from '../core/rng.js';
import { Terrain } from './terrain.js';
import { Fighter } from './fighter.js';
import { Items } from './items.js';
import { PROP_DEF, propParts } from './props.js';

const RAGNAROK_AT = 90;      // seconds into a round
const RAGNAROK_RATE = 1 / 3; // metres per second the kill line climbs
const DROPIN = 2.2;

export class Sim {
  // R: the initialised Rapier module. level: built level. roster: [{ slot, name, ai, skill }].
  constructor(R, level, roster, opts = {}) {
    this.R = R;
    this.level = level;
    this.opts = opts;
    this.rng = makeRng(level.code + '/round/' + (opts.round || 0) + '/' + (opts.matchSeed || ''));
    this.world = new R.World({ x: 0, y: GRAVITY });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 6;
    this.time = 0;
    this.roundTime = 0;
    this.tick = 0;
    this.timeScale = 1;
    this.stopSteps = 0;      // hit-stop: a few steps of near-freeze when a big hit lands
    this.phase = 'dropin';
    this.killY = KILL_Y;
    this.ragnarok = !!opts.ragnarok;
    this.events = [];
    this.timers = [];
    this.tags = new Map();         // collider handle -> info
    this.tracked = new Map();      // id -> { body, kind }
    this.portalCool = new Map();
    this._id = 1;
    this.props = new Map();        // id -> { kind, body, hp, parts }
    this.winner = -1;
    this.finalAt = -1;
    this.terrain = new Terrain(this, level);
    this.buildProps();
    this.items = new Items(this, { kinds: opts.kinds, dropEvery: opts.dropEvery });
    this.fighters = new Array(8).fill(null);
    const spawns = level.spawns.slice();
    for (const r of roster) {
      const sp = spawns[r.slot % spawns.length] || { x: 6 + r.slot * 5, y: H };
      const f = new Fighter(this, r.slot, sp.x, sp.y + 2.5, { name: r.name, ai: r.ai });
      this.fighters[r.slot] = f;
    }
    this.items.spawnAtPads(level);
  }

  // ------------------------------------------------------------ bookkeeping
  newId() { return this._id++; }
  tag(col, info) { this.tags.set(col.handle, info); }
  untag(col) { if (col) this.tags.delete(col.handle); }
  info(col) { return this.tags.get(col.handle); }
  track(id, body, kind) { this.tracked.set(id, { body, kind: kind || (body.userData && body.userData.kind) || 'body' }); }
  removeBody(body) {
    if (!body) return;
    const ud = body.userData;
    if (ud && ud.id) this.tracked.delete(ud.id);
    if (this.bodyAlive(body)) this.world.removeRigidBody(body);
  }
  // Rapier reuses a removed body's slot, and looking up a stale handle returns the new occupant, so a body
  // (or collider) is only still alive if the lookup gives back the very same object.
  bodyAlive(body) { return !!body && this.world.getRigidBody(body.handle) === body; }
  colAlive(col) { return !!col && this.world.getCollider(col.handle) === col; }
  jointAlive(j) { return !!j && this.world.getImpulseJoint(j.handle) === j; }
  emit(ev) { this.events.push(ev); }
  // The live body behind a collider, or null if either was removed (e.g. a block that just broke).
  bodyOf(col) {
    if (!this.colAlive(col)) return null;
    const b = col.parent();
    return this.bodyAlive(b) ? b : null;
  }
  timed(delay, fn) { this.timers.push({ at: this.time + delay, fn }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  buildProps() {
    const R = this.R;
    for (const p of this.level.props) {
      const def = PROP_DEF[p.kind];
      if (!def) continue;
      const parts = propParts(p);
      const bodies = [];
      let prev = null;
      for (const part of parts) {
        const id = this.newId();
        const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(part.x, part.y).setAngularDamping(0.4).setLinearDamping(0.05));
        let cd;
        if (part.shape === 'ball') cd = R.ColliderDesc.ball(part.r);
        else if (part.shape === 'capsule') cd = R.ColliderDesc.capsule(part.hh, part.r);
        else cd = R.ColliderDesc.cuboid(part.hx, part.hy);
        cd.setDensity(part.density).setFriction(0.7).setRestitution(0.1)
          .setCollisionGroups(groups(G.PROP, 0xffff));
        const col = this.world.createCollider(cd, body);
        this.tag(col, { kind: 'prop', id });
        body.userData = { kind: 'prop', id };
        this.track(id, body, 'prop');
        if (def.hanging) {
          if (!prev) {
            // Hang from the ceiling block.
            const jd = R.JointData.revolute({ x: part.x, y: p.y }, { x: 0, y: part.len / 2 || part.hy });
            this.world.createImpulseJoint(jd, this.terrain.fixedBody, body, true);
          } else {
            const aPrev = prev.part.len ? -prev.part.len / 2 : -prev.part.hy;
            const aMe = part.len ? part.len / 2 : part.hy;
            const jd = R.JointData.revolute({ x: 0, y: aPrev }, { x: 0, y: aMe });
            this.world.createImpulseJoint(jd, prev.body, body, true);
          }
        }
        const rec = { id, kind: p.kind, body, col, part, hp: part.end || !def.hanging ? def.hp : Infinity, explosive: !!def.explosive };
        this.props.set(id, rec);
        bodies.push(rec);
        prev = rec;
      }
      // Anchor cell of hanging props: if that cell breaks the chain falls.
      if (def.hanging) bodies[0].anchorCell = Math.floor(p.y) * W + Math.floor(p.x);
    }
  }

  damageProp(id, amount, by = -1) {
    const p = this.props.get(id);
    if (!p || p.hp === Infinity) return;
    p.hp -= amount;
    if (p.hp > 0) return;
    const t = p.body.translation();
    this.untag(p.col);
    this.removeBody(p.body);
    this.props.delete(id);
    this.emit({ t: 'propBreak', id, k: p.kind, x: t.x, y: t.y });
    if (p.explosive) this.timed(0.05, () => this.items.explode(t.x, t.y, 3, 60, by, { blocks: 80 }));
  }

  onCellGone(c) {
    this.items.onCellGone(c);
    // A hanging prop whose ceiling block breaks drops: remove its top joint by turning the anchor off.
    for (const p of this.props.values()) if (p.anchorCell === c) {
      const drop = [];
      this.world.forEachImpulseJoint?.((j) => {
        if (j.body1().handle === this.terrain.fixedBody.handle && j.body2().handle === p.body.handle) drop.push(j);
      });
      for (const j of drop) this.world.removeImpulseJoint(j, true);
      p.anchorCell = -1;
    }
  }

  onDeath(f, by) {
    if (by >= 0 && by !== f.slot && this.fighters[by]) this.fighters[by].kills++;
    if (this.opts.practice) return; // the tutorial respawns people instead of ending the round
    const alive = this.fighters.filter((x) => x && x.alive);
    if (alive.length <= 1 && this.phase === 'fight') {
      this.phase = 'final';
      this.finalAt = this.time;
      this.winner = alive.length === 1 ? alive[0].slot : -1;
      this.timeScale = this.opts.slowmo === false ? 1 : 0.25;
      this.emit({ t: 'final', w: this.winner, by, x: f.pos().x, y: f.pos().y });
    }
  }

  alive() { return this.fighters.filter((f) => f && f.alive); }

  // A big hit lands: the world all but stops for a moment, so it reads.
  hitStop(steps) {
    if (this.opts.hitstop === false || this.time - (this.lastStop ?? -9) < 0.35) return;
    this.lastStop = this.time;
    this.stopSteps = Math.max(this.stopSteps, steps);
  }

  // A fresh fighter in a slot (practice): the old body goes, a new one drops in at (x, y).
  respawn(slot, x, y) {
    const old = this.fighters[slot];
    if (old) { if (old.alive) this.items.onDeath(old); old.remove(); }
    const f = new Fighter(this, slot, x, y + 1.5, { name: old ? old.name : 'Fighter', ai: old ? old.isAI : true });
    this.fighters[slot] = f;
    this.emit({ t: 'respawn', s: slot, x, y });
    return f;
  }

  // ------------------------------------------------------------ step
  // inputs: array by slot of { x, y, b, jp, ap } (missing = idle)
  step(inputs) {
    let dt = STEP * this.timeScale;
    if (this.stopSteps > 0) { this.stopSteps--; dt *= 0.1; }
    this.world.timestep = dt;
    this.tick++;
    this.time += dt;
    if (this.phase === 'dropin') {
      if (this.time >= DROPIN) { this.phase = 'fight'; this.emit({ t: 'fight' }); }
    } else if (this.phase === 'fight') {
      this.roundTime += dt;
      if (this.ragnarok && this.roundTime > RAGNAROK_AT) {
        if (this.killY === KILL_Y) this.emit({ t: 'ragnarok' });
        // Climbs steadily, then (past the usual standing heights) faster until it covers the arena, so a round
        // always ends: whoever stands highest falls last.
        const rate = this.killY < H - 6 ? RAGNAROK_RATE : RAGNAROK_RATE * 3;
        this.killY = Math.min(H + 2, this.killY + rate * dt);
      }
      // Safety: a round can never stall forever.
      if (this.roundTime > 240) { for (const f of this.alive()) f.die(-1, 'time'); }
    } else if (this.phase === 'final') {
      // 1.2 s of real time in slow motion, then the round is over.
      if (this.time - this.finalAt > 1.2 * (this.opts.slowmo === false ? 1 : 0.25)) {
        this.timeScale = 1;
        this.phase = 'end';
        this.emit({ t: 'roundEnd', w: this.winner });
      }
    }
    for (const f of this.fighters) {
      if (!f) continue;
      f.control(inputs[f.slot] || IDLE, dt);
    }
    this.items.update(dt);
    // Velocities are recorded after our own pushes, so only real impacts count as damage.
    for (const f of this.fighters) if (f) f.record();
    this.world.step();
    for (const f of this.fighters) if (f) f.afterStep();
    this.terrain.update(dt);
    this.terrain.settle();
    // Kill line for props and items is handled where they live; timers here.
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    // Props falling away.
    for (const p of [...this.props.values()]) {
      const t = p.body.translation();
      if (t.y < this.killY - 12) { this.untag(p.col); this.removeBody(p.body); this.props.delete(p.id); this.emit({ t: 'gone', id: p.id }); }
      else if (p.explosive && t.y < this.killY + 0.2) this.damageProp(p.id, 999, -1);
    }
  }

  // ------------------------------------------------------------ frames for the view
  frame() {
    const fighters = [];
    for (const f of this.fighters) {
      if (!f) continue;
      const parts = new Float32Array(30);
      f.parts.forEach((p, k) => {
        const t = p.body.translation();
        parts[k * 3] = t.x; parts[k * 3 + 1] = t.y; parts[k * 3 + 2] = p.body.rotation();
      });
      const lp = this.items.linePoint(f);
      fighters.push({
        slot: f.slot, alive: f.alive, hp: Math.max(0, f.hp), facing: f.facing, aim: f.aim,
        item: f.item ? f.item.kind : null, ammo: f.item ? f.item.ammo : 0,
        back: f.back ? f.back.kind : null, fuel: f.back ? f.back.ammo : 0,
        jet: f.jetting, stuck: f.stuck > 0, charge: f.charge, swing: f.swing ? f.swing.kind : null, flash: f.flash > 0,
        line: lp ? [lp.x, lp.y] : null, beam: f.beam ? [f.beam.x, f.beam.y] : null, kills: f.kills,
        parts, joints: Float32Array.from(f.anim.out), wup: f.anim.up.slice(), move: f.swing ? f.swing.clip : null, strike: strikeOf(f),
      });
    }
    const bodies = [];
    for (const [id, tb] of this.tracked) {
      const b = tb.body;
      const t = b.translation();
      bodies.push(id, t.x, t.y, b.rotation());
    }
    const proj = [];
    for (const p of this.items.proj.values()) proj.push(p.id, p.x, p.y, Math.atan2(p.vy, p.vx));
    return { tick: this.tick, time: this.time, phase: this.phase, killY: this.killY, fighters, bodies, proj };
  }

  destroy() {
    try { this.world.free(); } catch { /* already freed */ }
  }
}

const IDLE = { x: 0, y: 0, b: 0, jp: 0, ap: 0 };

// The limb (or weapon) whose hit window is open, for the swing trail: 0 none, 1 armF, 2 armB, 3 legF, 4 legB,
// 5 feet, 6 axe, 7 sword, 8 hammer.
export const STRIKES = [null, 'armF', 'armB', 'legF', 'legB', 'feet', 'axe', 'sword', 'hammer'];
function strikeOf(f) {
  if (f.dive && !f.grounded) return 5;
  const sw = f.swing;
  if (!sw) return 0;
  for (const h of sw.def.hits) {
    if (sw.t >= h.t0 - 0.03 && sw.t <= h.t1 + 0.02) return h.seg === 'weapon' ? STRIKES.indexOf(f.item ? f.item.kind : '') : STRIKES.indexOf(h.seg);
  }
  return 0;
}
