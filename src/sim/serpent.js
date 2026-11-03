// The serpent: a chain of carved stone segments that bursts from below, arcs over its target,
// chews through the terrain and dives back down. Kinematic: it pushes everything aside.
import { G, groups, KILL_Y, W, MAT, clamp } from '../core/consts.js';

const SEGMENTS = 18;
const SPACING = 0.78;
const DURATION = 2.6; // seconds for the head to travel the arc

export class Serpent {
  constructor(sim, owner, target, facing) {
    this.sim = sim;
    this.owner = owner;
    this.id = sim.newId();
    const R = sim.R;
    const tx = clamp(target.x, 4, W - 4);
    const ty = Math.max(target.y + 3.5, 5);
    const side = target.x > 24 ? -1 : 1;
    const x0 = clamp(tx + side * -9 * (facing ? 1 : 1), -4, W + 4);
    const x1 = clamp(2 * tx - x0, -4, W + 4);
    this.p0 = { x: x0, y: KILL_Y - 5 };
    this.p2 = { x: x1, y: KILL_Y - 5 };
    // Control point so the curve passes through the peak at its middle.
    this.p1 = { x: 2 * tx - (x0 + x1) / 2, y: 2 * ty - this.p0.y };
    this.t = 0;
    this.trail = [];      // head positions, newest first
    this.hit = new Set();
    this.done = false;
    this.segs = [];
    for (let k = 0; k < SEGMENTS; k++) {
      const body = sim.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.p0.x, this.p0.y - k));
      const r = k === 0 ? 0.85 : 0.7 - (k / SEGMENTS) * 0.35;
      const col = sim.world.createCollider(R.ColliderDesc.ball(r).setCollisionGroups(groups(G.SERPENT, 0xffff & ~G.TERRAIN)), body);
      sim.tag(col, { kind: 'serpent', id: this.id, k });
      const id = sim.newId();
      body.userData = { kind: 'serpent', id };
      this.segs.push({ body, col, id, r });
      sim.track(id, body, 'serpent');
    }
    sim.emit({ t: 'serpent', id: this.id, s: owner, ids: this.segs.map((s) => s.id), x: this.p0.x, y: this.p0.y });
  }

  at(u) {
    const a = 1 - u;
    return {
      x: a * a * this.p0.x + 2 * a * u * this.p1.x + u * u * this.p2.x,
      y: a * a * this.p0.y + 2 * a * u * this.p1.y + u * u * this.p2.y,
    };
  }

  update(dt) {
    const sim = this.sim;
    this.t += dt;
    // Ease: fast out of the ground, a hang at the top, fast dive.
    const raw = Math.min(1.25, this.t / DURATION);
    const u = raw <= 1 ? raw - Math.sin(raw * Math.PI * 2) * 0.06 : raw;
    const head = u <= 1 ? this.at(u) : (() => {
      const p = this.at(1), q = this.at(0.98);
      const k = (u - 1) * 40;
      return { x: p.x + (p.x - q.x) * k, y: p.y + (p.y - q.y) * k };
    })();
    this.trail.unshift(head);
    if (this.trail.length > 600) this.trail.length = 600;
    // Place segments along the trail at fixed arc spacing.
    let si = 0, acc = 0;
    let prev = this.trail[0];
    for (let k = 0; k < this.segs.length; k++) {
      const want = k * SPACING;
      while (si < this.trail.length - 1 && acc + Math.hypot(this.trail[si + 1].x - prev.x, this.trail[si + 1].y - prev.y) < want) {
        acc += Math.hypot(this.trail[si + 1].x - prev.x, this.trail[si + 1].y - prev.y);
        prev = this.trail[++si];
      }
      const p = this.trail[Math.min(si, this.trail.length - 1)];
      const q = this.trail[Math.min(si + 2, this.trail.length - 1)];
      const ang = Math.atan2(p.y - q.y, p.x - q.x);
      const b = this.segs[k].body;
      b.setNextKinematicTranslation({ x: p.x, y: k === 0 ? head.y : p.y });
      b.setNextKinematicRotation(isFinite(ang) ? ang : 0);
    }
    // Chew blocks around the head and the first segments.
    for (let k = 0; k < 3; k++) {
      const t = this.segs[k].body.translation();
      for (const [c] of sim.terrain.cellsNear(t.x, t.y, this.segs[k].r + 0.55)) {
        if (sim.terrain.grid[c] !== MAT.BEDROCK) sim.terrain.destroyCell(c, this.owner);
      }
    }
    // Strike fighters near the head.
    const h = this.segs[0].body.translation();
    for (const f of sim.fighters) {
      if (!f || f.slot === this.owner || this.hit.has(f.slot)) continue;
      const t = f.pos();
      if (Math.hypot(t.x - h.x, t.y - h.y) < 1.7) {
        this.hit.add(f.slot);
        const dx = t.x - h.x;
        if (f.alive) f.hurt(45, this.owner, 'serpent', { x: Math.sign(dx || 1) * 9, y: 16 }, 1);
        else f.addVel(Math.sign(dx || 1) * 9, 16);
      }
    }
    if (raw >= 1.25) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    for (const s of this.segs) { this.sim.untag(s.col); this.sim.removeBody(s.body); this.sim.emit({ t: 'gone', id: s.id }); }
    this.sim.emit({ t: 'serpentEnd', id: this.id });
  }
}
