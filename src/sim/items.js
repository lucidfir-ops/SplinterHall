// Items, projectiles, explosions, portals and the serpent.
import { ITEMS, ITEM_KINDS, G, groups, ALL_FIGHTERS, MAT, W, H, clamp, KILL_Y, ATK } from '../core/consts.js';
import { HEAD, TORSO, LARM_F, SHIN_F, limbAngle } from './fighter.js';
import { CLIPS } from '../anim/moves.js';
import { J, SEGS } from '../anim/skeleton.js';
import { Serpent } from './serpent.js';

const PICK_R = 1.35;
const MAX_WORLD_ITEMS = 8;
const THROW_V = 18;

// Item body sizes (half extents) when lying in the world.
const ITEM_SIZE = {
  axe: [0.42, 0.14], sword: [0.75, 0.08], hammer: [0.5, 0.17], blunderbuss: [0.5, 0.12], rocket: [0.6, 0.14],
  bombs: [0.22, 0.22], web: [0.38, 0.14], tractor: [0.4, 0.15], portal: [0.38, 0.15], horn: [0.4, 0.14], jetpack: [0.3, 0.32],
};
// The stomp dive's feet (moves live in src/anim/moves.js).
const STOMP = { r: 0.3, ext: 0.1, dmg: 16, knock: 'stomp', poise: 1, blocks: { def: 6 } };
const MELEE_ITEMS = new Set(['axe', 'sword', 'hammer']);
// Bodies are hit where they're drawn: the attack's capsule against each fighter's posed segments (radii a
// touch over the drawn thickness).
const SEG_R = [0.25, 0.13, 0.08, 0.08, 0.08, 0.08, 0.09, 0.09, 0.09, 0.09];
function ptSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy;
  let t = l > 1e-12 ? ((px - ax) * vx + (py - ay) * vy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}
function segDist(ax, ay, bx, by, cx, cy, dx, dy) {
  // Distance between segments AB and CD in 2D: 0 if they cross, else the nearest end to the other segment.
  const cr = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cr(cx, cy, dx, dy, ax, ay), d2 = cr(cx, cy, dx, dy, bx, by), d3 = cr(ax, ay, bx, by, cx, cy), d4 = cr(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSeg(ax, ay, cx, cy, dx, dy), ptSeg(bx, by, cx, cy, dx, dy), ptSeg(cx, cy, ax, ay, bx, by), ptSeg(dx, dy, ax, ay, bx, by));
}
const RUN_SPEED = 8.6;

// Pin a dynamic body in place (glue, blades stuck in walls) without changing its type.
function freeze(body, on) {
  body.setLinvel({ x: 0, y: 0 }, true);
  body.setAngvel(0, true);
  body.lockTranslations(on, true);
  body.lockRotations(on, true);
}

export class Items {
  constructor(sim, opts = {}) {
    this.sim = sim;
    this.world = new Map();      // id -> item lying / flying in the world
    this.proj = new Map();       // id -> projectile (rockets, web globs)
    this.bombs = new Map();      // id -> bomb
    this.portals = new Map();    // owner slot -> [orange, blue] each { x, y, nx, ny, cell } | null
    this.serpents = [];
    this.glued = [];             // bodies made fixed by web globs: { body, until }
    this.kinds = opts.kinds || ITEM_KINDS;
    this.dropEvery = opts.dropEvery || [6, 9];
    this.nextDrop = 4 + sim.rng.float(0, 2);
    if (this.dropEvery[0] > 1e6) this.nextDrop = Infinity; // drops off (practice)
  }

  // ------------------------------------------------------------ spawning
  spawnAtPads(level) {
    const n = Math.min(level.pads.length, this.sim.rng.int(2, 3));
    const pads = this.sim.rng.shuffle(level.pads.slice());
    for (let k = 0; k < n; k++) {
      const p = pads[k];
      const kind = p.lock ? ITEM_KINDS[p.lock - 1] : this.pickKind();
      this.spawn(kind, p.x, p.y + 0.4, false);
    }
  }

  pickKind() {
    const r = this.sim.rng;
    // The horn is rarer than the rest.
    const pool = this.kinds.flatMap((k) => (k === 'horn' ? [k] : [k, k, k]));
    return r.pick(pool);
  }

  spawn(kind, x, y, crated, vel = null) {
    const R = this.sim.R;
    const id = this.sim.newId();
    const [hx, hy] = crated ? [0.42, 0.42] : ITEM_SIZE[kind];
    const body = this.sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y).setAngularDamping(0.8).setLinearDamping(0.1).setCcdEnabled(true));
    if (vel) body.setLinvel(vel, true);
    body.userData = { kind: 'item', id };
    const col = this.sim.world.createCollider(R.ColliderDesc.cuboid(hx, hy).setDensity(crated ? 0.8 : 1.5).setFriction(0.9)
      .setCollisionGroups(groups(G.ITEM, G.TERRAIN | G.PROP | G.ITEM | G.SERPENT)), body);
    this.sim.tag(col, { kind: 'item', id });
    const it = { id, kind, ammo: ITEMS[kind].ammo, body, col, crated, thrown: null, stuck: false, born: this.sim.time };
    this.world.set(id, it);
    this.sim.track(id, body);
    this.sim.emit({ t: 'item', id, k: kind, c: crated ? 1 : 0, x, y });
    return it;
  }

  dropRandom() {
    const sim = this.sim;
    if (this.world.size >= MAX_WORLD_ITEMS) return;
    // Fall above a spot someone can stand on.
    const spots = sim.level.spawns.concat(sim.level.pads);
    const s = sim.rng.pick(spots);
    const x = clamp(s.x + sim.rng.float(-3, 3), 1.5, W - 1.5);
    this.spawn(this.pickKind(), x, H + 2, true);
  }

  removeWorldItem(it, emit = true) {
    this.sim.untag(it.col);
    this.sim.removeBody(it.body);
    this.world.delete(it.id);
    if (emit) this.sim.emit({ t: 'gone', id: it.id });
  }

  // ------------------------------------------------------------ pickup / drop / throw
  tryPickup(f) {
    const feet = f.feet(), t = f.pos();
    let best = null, bd = PICK_R;
    for (const it of this.world.values()) {
      if (it.crated || (it.thrown && it.thrown.t > 0)) continue;
      const p = it.body.translation();
      const d = Math.min(Math.hypot(p.x - feet.x, p.y - feet.y), Math.hypot(p.x - t.x, p.y - t.y));
      if (d < bd) { bd = d; best = it; }
    }
    if (!best) return false;
    const def = ITEMS[best.kind];
    const slot = def.slot === 'back' ? 'back' : 'item';
    const old = f[slot];
    this.removeWorldItem(best, false);
    f[slot] = { kind: best.kind, ammo: best.ammo, id: best.id };
    this.sim.emit({ t: 'pick', s: f.slot, id: best.id, k: best.kind });
    if (old) this.dropHeld(f, slot, 0.5);
    return true;
  }

  dropHeld(f, slot = 'item', speed = 2) {
    const held = f[slot];
    if (!held) return;
    this.endBeam(f); this.endLine(f);
    f[slot] = null;
    if (held.ammo <= 0 && held.kind !== 'jetpack') return;
    const h = f.hand(), v = f.vel();
    const it = this.spawn(held.kind, h.x, h.y + 0.2, false, { x: v.x + f.facing * speed, y: v.y + speed });
    it.ammo = held.ammo;
  }

  throwHeld(f) {
    const held = f.item;
    if (!held) return false;
    this.endBeam(f); this.endLine(f);
    f.item = null;
    const h = f.hand(), v = f.vel(), a = f.aimDir();
    const it = this.spawn(held.kind, h.x + a.x * 0.4, h.y + a.y * 0.4, false, { x: v.x * 0.5 + a.x * THROW_V, y: v.y * 0.5 + a.y * THROW_V + 1.5 });
    it.ammo = held.ammo;
    it.body.setAngvel(held.kind === 'sword' ? -f.facing * 4 : -f.facing * 14, true);
    it.thrown = { by: f.slot, t: 0.12, hit: new Set() };
    // A flying item hits fighters (except the thrower for a moment).
    it.col.setCollisionGroups(groups(G.ITEM, G.TERRAIN | G.PROP | G.SERPENT | (ALL_FIGHTERS & ~f.bit)));
    this.sim.emit({ t: 'throw', s: f.slot, id: it.id, k: held.kind });
    f.cool = 0.25;
    return true;
  }

  tryGrab(f) {
    const sim = this.sim, R = sim.R;
    const h = f.physHand(); // the joint hangs off the physics forearm
    const found = [];
    sim.world.intersectionsWithShape({ x: h.x, y: h.y }, 0, new R.Ball(0.2), (col) => { found.push(col); return true; },
      undefined, groups(G.SENSOR, G.TERRAIN | G.PROP | (ALL_FIGHTERS & ~f.bit)));
    for (const col of found) {
      const body = sim.bodyOf(col);
      if (!body) continue;
      const bt = body.translation(), br = body.rotation();
      const c = Math.cos(-br), s = Math.sin(-br);
      const local = { x: c * (h.x - bt.x) - s * (h.y - bt.y), y: s * (h.x - bt.x) + c * (h.y - bt.y) };
      const jd = R.JointData.revolute({ x: 0, y: -0.2 }, local);
      const joint = sim.world.createImpulseJoint(jd, f.parts[LARM_F].body, body, true);
      f.grab = { joint, body, x: h.x, y: h.y };
      const info = sim.info(col);
      if (info?.kind === 'part') { info.f.poise = Math.min(info.f.poise, 0.3); info.f.lastHit = { by: f.slot, t: sim.time }; }
      sim.emit({ t: 'grab', s: f.slot, x: h.x, y: h.y });
      return;
    }
  }

  releaseGrab(f) {
    const g = f.grab;
    f.grab = null;
    if (g && g.joint && this.sim.jointAlive(g.joint)) this.sim.world.removeImpulseJoint(g.joint, true);
  }

  onDeath(f) {
    this.releaseGrab(f);
    this.endBeam(f); this.endLine(f);
    if (f.item) this.dropHeld(f, 'item', 3);
    if (f.back) this.dropHeld(f, 'back', 2);
    f.swing = null; f.dive = null;
  }

  // ------------------------------------------------------------ actions
  // atk: the kind of this press (an ATK value). up: the stick is held up.
  action(f, pressed, held, up, dt, atk = ATK.NORMAL) {
    if (f.cool > 0) f.cool -= dt;
    // Advance any move or dive in progress.
    if (f.swing) this.updateSwing(f, dt);
    if (f.dive) this.updateDive(f, dt);
    const it = f.item;
    const sw = f.swing;
    const free = (!sw || sw.t >= sw.def.cancel) && !f.dive && f.cool <= 0;
    // A press while still busy is kept for a moment and played the instant the fighter is free (mashing
    // never loses a hit).
    if (pressed && !free) { f.buffered = { atk, t: this.sim.time }; pressed = false; }
    else if (!pressed && free && f.buffered && this.sim.time - f.buffered.t < 0.25) { ({ atk } = f.buffered); pressed = true; }
    if (pressed) f.buffered = null;
    if (pressed && atk === ATK.THROW) { if (it) this.startMove(f, 'throw', 0); return; }
    // Kicks work with anything in hand.
    if (pressed && (atk === ATK.KICK || atk === ATK.DROPKICK)) { this.startMove(f, this.kickMove(f, atk), 0); return; }
    if (pressed && atk === ATK.SLAM && !f.grounded && (!it || MELEE_ITEMS.has(it.kind))) { f.swing = null; this.startDive(f); return; }
    if (!it) {
      if (pressed) this.startMove(f, this.handMove(f, atk), 0);
      // Hold Action with empty hands: grab a ledge or a body the fist touches; let go on release.
      f.holdT = held ? (f.holdT || 0) + dt : 0;
      if (held && !f.grab && f.holdT > 0.16 && !f.swing) this.tryGrab(f);
      if (!held && f.grab) this.releaseGrab(f);
      return;
    }
    if (f.grab) this.releaseGrab(f);
    const k = it.kind;
    if (MELEE_ITEMS.has(k)) {
      if (pressed) { const heavy = atk === ATK.HEAVY; this.startMove(f, this.weaponMove(f, k, heavy), heavy ? 0.6 : 0); f.charge = 0; }
      else if (held && !f.swing) { f.charge += dt; }
      else if (!held && f.charge > 0.25 && !f.swing) { this.startMove(f, this.weaponMove(f, k, true), Math.min(1, f.charge / 0.7)); f.charge = 0; }
      else if (!held) f.charge = 0;
      return;
    }
    switch (k) {
      case 'blunderbuss': if (pressed && f.cool <= 0 && it.ammo > 0) this.blast(f); break;
      case 'rocket': if (pressed && f.cool <= 0 && it.ammo > 0) this.fireRocket(f); break;
      case 'bombs':
        if (held && it.ammo > 0) f.charge += dt;
        if (!held && f.charge > 0) { this.throwBomb(f, Math.min(1, f.charge / 0.8)); f.charge = 0; }
        break;
      case 'web':
        if (held) f.charge += dt;
        if (f.charge > 0.2 && held && !f.line && it.ammo > 0 && !f.lineTried) { f.lineTried = true; this.startLine(f); }
        if (f.line) this.reelLine(f, dt);
        if (!held) {
          if (f.charge > 0 && f.charge <= 0.2 && it.ammo > 0 && f.cool <= 0) this.fireGlob(f);
          f.charge = 0; f.lineTried = false; this.endLine(f);
        }
        break;
      case 'tractor':
        if (held && it.ammo > 0) this.beamTick(f, dt);
        else this.endBeam(f, !held);
        break;
      case 'portal': if (pressed && f.cool <= 0) this.firePortal(f); break;
      case 'horn': if (pressed && f.cool <= 0 && it.ammo > 0) this.blowHorn(f); break;
    }
    if (f.item && f.item.ammo <= 0 && !f.line && !f.beam && f.item.kind !== 'portal') {
      this.sim.emit({ t: 'spent', s: f.slot, k: f.item.kind });
      f.item = null;
    }
  }

  // ------------------------------------------------------------ melee
  // Which move a press makes, by what's in hand, where you are and the swipe.
  handMove(f, atk) {
    if (atk === ATK.HEAVY) return 'haymaker';
    if (atk === ATK.UPPER) return 'uppercut';
    if (atk === ATK.SLAM) return 'slam';
    if (!f.grounded) return 'airpunch';
    // Jab, cross, hook: presses close together run the combo.
    const t = this.sim.time;
    const n = t - (f.jabT ?? -9) < 0.5 ? (f.jabN || 0) + 1 : 1;
    f.jabT = t; f.jabN = n >= 3 ? 0 : n;
    return n === 1 ? 'jab' : n === 2 ? 'cross' : 'hook';
  }

  kickMove(f, atk) {
    if (atk === ATK.DROPKICK) return 'dropkick';
    if (!f.grounded) return 'flykick';
    const up = Math.sin(f.aim);
    if (f.ducking || up < -0.4) return 'sweep';
    if (up > 0.4) return 'roundhouse';
    if (Math.abs(f.vel().x) > RUN_SPEED * 0.65) return 'flykick';
    return 'kick';
  }

  weaponMove(f, kind, heavy) {
    const t = this.sim.time;
    const alt = t - (f.wT ?? -9) < 0.7 ? !f.wAlt : false;
    f.wT = t; f.wAlt = alt;
    if (kind === 'axe') return heavy ? 'axeWhirl' : !f.grounded ? 'axeFlip' : alt ? 'axeBack' : 'axeChop';
    if (kind === 'sword') return heavy ? 'lunge' : alt && f.grounded ? 'slash' : 'thrust';
    return heavy ? 'hammerSpin' : 'smash';
  }

  startMove(f, clip, charge) {
    const def = CLIPS[clip];
    f.swing = { clip, def, kind: def.kind, t: 0, charge, hit: new Map(), cells: new Set(), prev: [], pi: 0, ei: 0, fell: false };
    f.charge = 0;
    if (def.kind !== 'recoil' && def.kind !== 'throw') this.sim.emit({ t: 'swing', s: f.slot, k: def.kind, m: clip, c: charge > 0 || def.heavy ? 1 : 0 });
  }

  updateSwing(f, dt) {
    const sw = f.swing, def = sw.def;
    sw.t += dt;
    // Pushes: the body thrown in behind the move.
    while (sw.pi < def.push.length && def.push[sw.pi].t <= sw.t) {
      const p = def.push[sw.pi++], g = f.grounded, pw = 1 + sw.charge * 0.5;
      let vx, vy;
      if (p.aim) { const a = f.aimDir(); vx = a.x * p.aim * pw; vy = a.y * p.aim * pw + (p.y || 0); }
      else { vx = f.facing * (p.x || 0) * pw; vy = (g ? p.y : (p.ya ?? p.y)) || 0; }
      if (p.set === 'exact') f.setVelAll(() => ({ x: vx, y: vy }));
      else if (p.set) f.setVelAll((v) => ({ x: vx, y: g ? vy : Math.max(v.y, vy) }));
      else f.addVel(vx, vy);
      if (p.leap) { f.noHover = 0.45; f.grounded = false; }
    }
    while (sw.ei < def.events.length && def.events[sw.ei].t <= sw.t) {
      const e = def.events[sw.ei++];
      if (e.ev === 'throw') this.throwHeld(f);
      if (e.ev === 'pound' && f.grounded && sw.charge > 0.4) this.groundPound(f, sw.charge);
    }
    if (def.fall && !sw.fell && sw.t >= def.fall) { sw.fell = true; f.poise = Math.min(f.poise, 0.22); f.safeLand = 0.8; } // flat on your back
    sw.phase = sw.t < def.firstHit ? 'wind' : sw.t <= def.lastHit ? 'act' : 'rec';
    if (sw.t >= def.dur) { f.swing = null; f.cool = 0.02; }
  }

  // Hits for this step, from the posed skeleton (called after the fighter's pose is worked out).
  meleeTick(f) {
    if (!f.alive) return;
    if (f.dive && !f.grounded) {
      const dv = f.dive;
      const seg = this.segOf(f, 'feet', STOMP.ext);
      this.testHits(f, dv, STOMP, seg, dv.prev, 'stomp', 'stomp');
      dv.prev = seg;
    }
    const sw = f.swing;
    if (!sw) return;
    const hits = sw.def.hits;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (sw.t < h.t0 || sw.t > h.t1 + 1e-6) { sw.prev[i] = null; continue; }
      const seg = this.segOf(f, h.seg, h.ext || 0, h.reach || 0);
      this.testHits(f, sw, h, seg, sw.prev[i], sw.def.kind, sw.clip);
      sw.prev[i] = seg;
    }
  }

  // A limb (or the weapon in hand) as a 2D segment, projected from the 3D pose.
  segOf(f, name, ext = 0, reach = 0) {
    const j = f.anim.joints;
    const P = (k) => [j[k * 3], j[k * 3 + 1], j[k * 3 + 2]];
    let a, b;
    switch (name) {
      case 'armF': a = P(J.ELB_F); b = P(J.HAND_F); break;
      case 'armB': a = P(J.ELB_B); b = P(J.HAND_B); break;
      case 'legF': a = P(J.KNEE_F); b = P(J.FOOT_F); break;
      case 'legB': a = P(J.KNEE_B); b = P(J.FOOT_B); break;
      case 'feet': {
        const k1 = P(J.KNEE_F), k2 = P(J.KNEE_B), f1 = P(J.FOOT_F), f2 = P(J.FOOT_B);
        a = [(k1[0] + k2[0]) / 2, (k1[1] + k2[1]) / 2]; b = [(f1[0] + f2[0]) / 2, (f1[1] + f2[1]) / 2];
        break;
      }
      default: { // weapon: from the hand along the forearm, its length seen from the side
        const e = P(J.ELB_F), h = P(J.HAND_F);
        const dx = h[0] - e[0], dy = h[1] - e[1], dz = h[2] - e[2], l = Math.hypot(dx, dy, dz) || 1;
        a = e; b = [h[0] + (dx / l) * reach, h[1] + (dy / l) * reach];
      }
    }
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) { dx = f.facing; dy = 0; } else { dx /= l; dy /= l; }
    return { ax: a[0], ay: a[1], bx: b[0] + dx * ext, by: b[1] + dy * ext, dx, dy };
  }

  testHits(f, sw, m, seg, pv, kind, move) {
    const sim = this.sim, R = sim.R;
    const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    const shape = new R.Capsule(Math.max(0.02, len / 2), m.r);
    const power = 1 + (sw.charge || 0) * 0.6;
    // Collect first: bodies can't be changed while the query is running. A fast swing also tests halfway
    // from where it was last step, so it can't skip over someone between steps.
    const found = [];
    // Fighters: against their drawn pose.
    const segs = pv ? [seg, { ax: (pv.ax + seg.ax) / 2, ay: (pv.ay + seg.ay) / 2, bx: (pv.bx + seg.bx) / 2, by: (pv.by + seg.by) / 2 }] : [seg];
    for (const o of sim.fighters) {
      if (!o || o === f || !o.anim.started) continue;
      const j = o.anim.out;
      let hit = false;
      for (let k = 0; k < 10 && !hit; k++) {
        const [ia, ib] = SEGS[k];
        for (const sg of segs) {
          if (segDist(sg.ax, sg.ay, sg.bx, sg.by, j[ia * 3], j[ia * 3 + 1], j[ib * 3], j[ib * 3 + 1]) < m.r + SEG_R[k]) { hit = true; break; }
        }
      }
      if (hit) found.push({ fighter: o });
    }
    const filter = groups(G.SENSOR, G.TERRAIN | G.PROP);
    const test = (sg, sh) => sim.world.intersectionsWithShape({ x: (sg.ax + sg.bx) / 2, y: (sg.ay + sg.by) / 2 }, limbAngle(sg.dx, sg.dy), sh, (col) => { if (!found.includes(col)) found.push(col); return true; }, undefined, filter);
    test(seg, shape);
    if (pv) {
      const mx = (pv.dx + seg.dx) / 2, my = (pv.dy + seg.dy) / 2, ml = Math.hypot(mx, my) || 1;
      const mid = { ax: (pv.ax + seg.ax) / 2, ay: (pv.ay + seg.ay) / 2, bx: (pv.bx + seg.bx) / 2, by: (pv.by + seg.by) / 2, dx: mx / ml, dy: my / ml };
      const ll = Math.hypot(mid.bx - mid.ax, mid.by - mid.ay);
      test(mid, new R.Capsule(Math.max(0.02, ll / 2), m.r));
    }
    const cx = (seg.ax + seg.bx) / 2, cy = (seg.ay + seg.by) / 2;
    const fp = f.pos();
    for (const col of found) {
      const info = col.fighter ? { kind: 'part', f: col.fighter } : sim.colAlive(col) ? sim.info(col) : null; // (a body removed by an earlier hit is skipped)
      if (!info) continue;
      if (info.kind === 'part' && info.f !== f) {
        const o = info.f;
        const last = sw.hit.get(o.slot);
        if (last !== undefined && !(m.every && sim.time - last >= m.every)) continue;
        sw.hit.set(o.slot, sim.time);
        const op = o.pos(), side = Math.sign(op.x - fp.x) || f.facing;
        if (!o.alive) { o.addVel(side * 6, 4); continue; }
        let kk;
        const K = m.knock;
        if (K === 'radial') kk = { x: side * 10 * power, y: 6 };
        else if (K === 'trip') kk = { x: side * 4, y: 7 };
        else if (K === 'slam') kk = { x: f.facing * 5, y: o.grounded ? 2 : -10 };
        else if (K === 'stomp') kk = { x: side * 6, y: -4 };
        else {
          kk = { x: f.facing * K[0] * power, y: K[1] * power };
          if (m.trip && o.grounded) kk = { x: kk.x * 0.7, y: Math.abs(kk.y) * 0.6 + 4 };
        }
        // Bare-hand moves hit harder for the speed behind them.
        const bare = !MELEE_ITEMS.has(kind);
        const v = f.vel();
        const dmg = m.dmg * power * (bare ? clamp(1 + Math.hypot(v.x, v.y) / 10, 1, 1.8) : 1);
        o.hurt(dmg, f.slot, kind, kk, m.poise ?? (kind === 'hammer' ? 1 : 0.35 + 0.3 * power));
        sim.emit({ t: 'clash', k: kind, m: move, x: cx, y: cy, s: f.slot });
      } else if (info.kind === 'block' && !sw.cells.has(info.cell)) {
        sw.cells.add(info.cell);
        const mat = sim.terrain.grid[info.cell];
        const bl = m.blocks || {};
        const dmg = (bl[mat] ?? bl.def ?? 0) * power;
        const body = col.parent();
        const kn = Array.isArray(m.knock) ? m.knock[0] : 10;
        if (body && body.isDynamic()) body.applyImpulse({ x: seg.dx * kn * 2 * power, y: seg.dy * kn * 2 * power }, true);
        if (dmg > 0) sim.terrain.damageCell(info.cell, dmg, f.slot);
        sim.emit({ t: 'clang', k: kind, m: mat, x: seg.bx, y: seg.by });
      } else if (info.kind === 'prop' && !sw.hit.has('p' + info.id)) {
        sw.hit.set('p' + info.id, sim.time);
        const body = col.parent();
        const kn = Array.isArray(m.knock) ? m.knock[0] : 10;
        if (body) body.applyImpulse({ x: seg.dx * kn * 3 * power, y: (seg.dy + 0.4) * kn * 3 * power }, true);
        this.sim.damageProp(info.id, m.dmg * power * 0.6, f.slot);
      }
    }
  }

  startDive(f) {
    f.dive = { t: 0, hit: new Map(), cells: new Set(), charge: 0, prev: null };
    f.setVelAll((v) => ({ x: v.x * 0.35, y: Math.min(v.y, -18) }));
    this.sim.emit({ t: 'swing', s: f.slot, k: 'stomp', c: 0 });
  }

  updateDive(f, dt) {
    const dv = f.dive;
    dv.t += dt;
    if (!f.alive || f.line || dv.t > 1.6) { f.dive = null; return; }
    if (!f.grounded) {
      f.setVelAll((v) => ({ x: v.x, y: Math.min(v.y, -18) }));
      return;
    }
    // Landed: a shove for everyone close, a crack in the floor.
    const p = f.feet();
    f.dive = null; f.safeLand = 0.3; f.cool = 0.25;
    this.explode(p.x, p.y - 0.15, 1.9, 5, f.slot, { fire: false, blocks: 14, push: 9, spare: f.slot, kind: 'stomp' });
  }

  groundPound(f, charge) {
    const p = f.feet();
    this.explode(p.x, p.y - 0.3, 2.4 + charge, 18 * charge, f.slot, { fire: false, blocks: 50 * charge, push: 16 });
  }

  // ------------------------------------------------------------ guns
  blast(f) {
    const sim = this.sim, R = sim.R;
    const h = f.hand(), a = f.aimDir();
    f.item.ammo--; f.cool = 0.55;
    this.startMove(f, 'recoil', 0);
    const base = Math.atan2(a.y, a.x);
    const hits = [];
    for (let k = 0; k < 7; k++) {
      const ang = base + (k - 3) * 0.06 + (sim.rng.next() - 0.5) * 0.04;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const ray = new R.Ray({ x: h.x, y: h.y }, dir);
      const hit = sim.world.castRay(ray, 11, true, undefined, groups(G.PROJ, G.TERRAIN | G.PROP | (ALL_FIGHTERS & ~f.bit) | G.ITEM));
      const len = hit ? hit.timeOfImpact : 11;
      hits.push([h.x + dir.x * len, h.y + dir.y * len]);
      if (!hit) continue;
      const info = sim.info(hit.collider);
      const fall = 1 - len / 14;
      const body = sim.bodyOf(hit.collider);
      if (body && body.isDynamic() && info?.kind !== 'part') body.applyImpulse({ x: dir.x * 3, y: dir.y * 3 }, true);
      if (info?.kind === 'part') info.f.hurt(10 * fall + 3, f.slot, 'shot', { x: dir.x * 5 * fall, y: dir.y * 5 * fall + 1 }, 0.25);
      else if (info?.kind === 'block' && sim.terrain.grid[info.cell]) {
        const m = sim.terrain.grid[info.cell];
        sim.terrain.damageCell(info.cell, m === MAT.GLASS ? 20 : m === MAT.ICE ? 6 : m === MAT.WOOD ? 4 : 0, f.slot);
      } else if (info?.kind === 'prop') sim.damageProp(info.id, 6, f.slot);
    }
    // Recoil: big enough to launch you in the air.
    const kick = f.grounded ? 5 : 10;
    f.addVel(-a.x * kick, -a.y * kick + (a.y < -0.5 ? 2 : 0));
    sim.emit({ t: 'shot', s: f.slot, x: h.x, y: h.y, a: base, hits });
  }

  fireRocket(f) {
    this.startMove(f, 'recoil', 0);
    const h = f.hand(), a = f.aimDir();
    f.item.ammo--; f.cool = 0.8;
    const id = this.sim.newId();
    const p = { id, kind: 'rocket', x: h.x + a.x * 0.6, y: h.y + a.y * 0.6, vx: a.x * 19, vy: a.y * 19, owner: f.slot, t: 0 };
    this.proj.set(id, p);
    f.addVel(-a.x * 2.5, -a.y * 2.5);
    this.sim.emit({ t: 'proj', id, k: 'rocket', s: f.slot, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
  }

  fireGlob(f) {
    const h = f.hand(), a = f.aimDir();
    f.item.ammo--; f.cool = 0.25;
    const id = this.sim.newId();
    const p = { id, kind: 'glob', x: h.x, y: h.y, vx: a.x * 30, vy: a.y * 30, owner: f.slot, t: 0 };
    this.proj.set(id, p);
    this.sim.emit({ t: 'proj', id, k: 'glob', s: f.slot, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
  }

  updateProjectiles(dt) {
    const sim = this.sim, R = sim.R;
    for (const p of [...this.proj.values()]) {
      p.t += dt;
      if (p.kind === 'rocket') {
        const sp = Math.hypot(p.vx, p.vy), boost = Math.min(30, sp + 14 * dt) / sp;
        p.vx *= boost; p.vy *= boost;
      } else p.vy -= 9 * dt;
      const sp = Math.hypot(p.vx, p.vy);
      const dir = { x: p.vx / sp, y: p.vy / sp };
      const owner = sim.fighters[p.owner];
      const mask = G.TERRAIN | G.PROP | G.ITEM | G.SERPENT | (ALL_FIGHTERS & ~(p.t < 0.15 && owner ? owner.bit : 0));
      const hit = sim.world.castRay(new R.Ray({ x: p.x, y: p.y }, dir), sp * dt, true, undefined, groups(G.PROJ, mask));
      const out = p.t > 4 || p.y < KILL_Y - 6 || p.x < -15 || p.x > W + 15 || p.y > H + 15;
      if (hit || out) {
        const hx = p.x + dir.x * (hit ? hit.timeOfImpact : 0), hy = p.y + dir.y * (hit ? hit.timeOfImpact : 0);
        this.proj.delete(p.id);
        sim.emit({ t: 'gone', id: p.id, x: hx, y: hy });
        if (out && !hit) continue;
        if (p.kind === 'rocket') this.explode(hx - dir.x * 0.1, hy - dir.y * 0.1, 2.4, 60, p.owner, { blocks: 85 });
        else this.globHit(p, hit, hx, hy, dir);
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  globHit(p, hit, x, y, dir) {
    const sim = this.sim, R = sim.R;
    const info = sim.info(hit.collider);
    sim.emit({ t: 'splat', x, y, s: p.owner });
    if (info?.kind === 'part') {
      const o = info.f;
      o.stuck = 1.6;
      o.hurt(4, p.owner, 'web', { x: dir.x * 2, y: dir.y * 2 }, 0.4);
      // Tie the fighter to the nearest terrain with a short strand.
      const t = o.pos();
      const proj = sim.world.projectPoint(t, true, undefined, groups(G.SENSOR, G.TERRAIN));
      if (proj && Math.hypot(proj.point.x - t.x, proj.point.y - t.y) < 3.5) {
        const fb = sim.terrain.fixedBody;
        const anchorBody = sim.bodyOf(proj.collider) || fb;
        const at = anchorBody.translation(), ar = anchorBody.rotation();
        const c0 = Math.cos(-ar), s0 = Math.sin(-ar);
        const local = { x: c0 * (proj.point.x - at.x) - s0 * (proj.point.y - at.y), y: s0 * (proj.point.x - at.x) + c0 * (proj.point.y - at.y) };
        const jd = R.JointData.rope(Math.max(0.6, Math.hypot(proj.point.x - t.x, proj.point.y - t.y)), { x: 0, y: 0 }, local);
        const j = sim.world.createImpulseJoint(jd, o.torso, anchorBody, true);
        sim.timed(1.6, () => { if (sim.jointAlive(j)) sim.world.removeImpulseJoint(j, true); });
        sim.emit({ t: 'webtie', s: o.slot, x: proj.point.x, y: proj.point.y, d: 1.6 });
      }
    } else {
      const body = sim.bodyOf(hit.collider);
      if (body && body.isDynamic() && info?.kind !== 'item') {
        freeze(body, true);
        this.glued.push({ body, until: sim.time + 8 });
        sim.emit({ t: 'glue', x, y, d: 8 });
      }
    }
  }

  startLine(f) {
    const sim = this.sim, R = sim.R;
    const h = f.hand(), a = f.aimDir();
    const hit = sim.world.castRay(new R.Ray({ x: h.x, y: h.y }, a), 16, true, undefined, groups(G.PROJ, G.TERRAIN | G.PROP));
    if (!hit) { sim.emit({ t: 'whiff', s: f.slot, k: 'web' }); return; }
    const hx = h.x + a.x * hit.timeOfImpact, hy = h.y + a.y * hit.timeOfImpact;
    const body = sim.bodyOf(hit.collider);
    if (!body) return;
    const bt = body.translation(), br = body.rotation();
    const c = Math.cos(-br), s = Math.sin(-br);
    const lx = c * (hx - bt.x) - s * (hy - bt.y), ly = s * (hx - bt.x) + c * (hy - bt.y);
    f.item.ammo--;
    f.line = { body, lx, ly, len: hit.timeOfImpact, joint: null, rebuild: 0 };
    this.makeLineJoint(f);
    sim.emit({ t: 'line', s: f.slot, on: 1 });
  }

  makeLineJoint(f) {
    const sim = this.sim, R = sim.R, L = f.line;
    if (L.joint && sim.jointAlive(L.joint)) sim.world.removeImpulseJoint(L.joint, true);
    const jd = R.JointData.rope(L.len, { x: 0, y: -0.2 }, { x: L.lx, y: L.ly });
    L.joint = sim.world.createImpulseJoint(jd, f.parts[LARM_F].body, L.body, true);
  }

  reelLine(f, dt) {
    const L = f.line;
    if (!L) return;
    if (!this.sim.bodyAlive(L.body)) { this.endLine(f); return; }
    const nl = Math.max(1.4, L.len - 7 * dt);
    if (nl !== L.len) {
      L.len = nl;
      L.rebuild -= dt;
      if (L.rebuild <= 0) { this.makeLineJoint(f); L.rebuild = 0.08; }
    }
    // A little swing help along the stick.
    if (!f.grounded) f.addVel(f.inp.x * 6 * dt, 0);
  }

  endLine(f) {
    if (!f.line) return;
    const sim = this.sim;
    if (f.line.joint && sim.jointAlive(f.line.joint)) sim.world.removeImpulseJoint(f.line.joint, true);
    f.line = null;
    sim.emit({ t: 'line', s: f.slot, on: 0 });
  }

  linePoint(f) {
    const L = f.line;
    if (!L) return null;
    const b = L.body, t = b.translation(), r = b.rotation();
    const c = Math.cos(r), s = Math.sin(r);
    return { x: t.x + c * L.lx - s * L.ly, y: t.y + s * L.lx + c * L.ly };
  }

  // ------------------------------------------------------------ tractor beam
  beamTick(f, dt) {
    const sim = this.sim, R = sim.R;
    const h = f.hand(), a = f.aimDir();
    f.item.ammo = Math.max(0, f.item.ammo - dt);
    if (!f.beam) { f.beam = { body: null, rip: 0, cell: -1, x: h.x, y: h.y }; sim.emit({ t: 'beam', s: f.slot, on: 1 }); }
    const B = f.beam;
    if (B.body && !sim.bodyAlive(B.body)) B.body = null;
    if (!B.body) {
      const hit = sim.world.castRay(new R.Ray({ x: h.x, y: h.y }, a), 13, true, undefined,
        groups(G.PROJ, G.TERRAIN | G.PROP | G.ITEM | (ALL_FIGHTERS & ~f.bit)));
      B.x = h.x + a.x * (hit ? hit.timeOfImpact : 13); B.y = h.y + a.y * (hit ? hit.timeOfImpact : 13);
      if (!hit) { B.rip = 0; return; }
      const body = sim.bodyOf(hit.collider);
      const info = sim.info(hit.collider);
      if (info?.kind === 'block' && sim.terrain.state[info.cell] === 1) {
        if (sim.terrain.grid[info.cell] === MAT.BEDROCK) return;
        // Rip a fixed block out of the terrain after a moment.
        if (B.cell !== info.cell) { B.cell = info.cell; B.rip = 0; }
        B.rip += dt;
        if (B.rip > 0.45) {
          const id = sim.terrain.detach([info.cell]);
          sim.terrain.dirty = true;
          B.body = sim.terrain.dyn.get(id).body;
          sim.emit({ t: 'rip', x: B.x, y: B.y });
        }
        return;
      }
      if (body && body.isDynamic()) B.body = info?.kind === 'part' ? info.f.torso : body;
      B.f = info?.kind === 'part' ? info.f : null;
      return;
    }
    // Hold the target at a point along the aim.
    const target = { x: h.x + a.x * 3.2, y: h.y + a.y * 3.2 };
    const p = B.body.translation();
    B.x = p.x; B.y = p.y;
    const m = B.f ? B.f.mass : B.body.mass();
    const k = clamp(9 / Math.max(1, m), 0.06, 1);
    const want = { x: (target.x - p.x) * 11, y: (target.y - p.y) * 11 + 2 };
    const apply = (b) => {
      const v = b.linvel();
      b.setLinvel({ x: v.x + (want.x - v.x) * 0.35 * k, y: v.y + (want.y - v.y) * 0.35 * k }, true);
    };
    if (B.f) { for (const part of B.f.parts) apply(part.body); B.f.poise = 0; }
    else { apply(B.body); B.body.setAngvel(B.body.angvel() * 0.95, true); }
    // Heavy things pull the holder instead.
    if (m > 12) f.addVel((p.x - h.x) * 0.02, (p.y - h.y) * 0.02);
  }

  endBeam(f, fling = false) {
    const B = f.beam;
    if (!B) return;
    if (fling && B.body && this.sim.bodyAlive(B.body)) {
      const a = f.aimDir();
      const m = B.f ? B.f.mass : B.body.mass();
      const sp = clamp(26 * Math.sqrt(4 / Math.max(1, m)), 8, 26);
      if (B.f) { B.f.setVelAll(() => ({ x: a.x * sp, y: a.y * sp + 2 })); B.f.lastHit = { by: f.slot, t: this.sim.time }; }
      else B.body.setLinvel({ x: a.x * sp, y: a.y * sp + 1 }, true);
      this.sim.emit({ t: 'fling', s: f.slot, x: B.x, y: B.y });
    }
    f.beam = null;
    this.sim.emit({ t: 'beam', s: f.slot, on: 0 });
  }

  // ------------------------------------------------------------ bombs
  throwBomb(f, charge) {
    const sim = this.sim, R = sim.R;
    const h = f.hand(), a = f.aimDir(), v = f.vel();
    f.item.ammo--;
    const id = sim.newId();
    const sp = 7 + 11 * charge;
    const body = sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(h.x + a.x * 0.3, h.y + a.y * 0.3)
      .setLinvel(v.x * 0.5 + a.x * sp, v.y * 0.5 + a.y * sp + 2).setCcdEnabled(true).setAngularDamping(0.3));
    body.setAngvel(-f.facing * 6, true);
    body.userData = { kind: 'bomb', id };
    const col = sim.world.createCollider(R.ColliderDesc.ball(0.22).setDensity(3).setRestitution(0.45).setFriction(0.6)
      .setCollisionGroups(groups(G.PROJ, G.TERRAIN | G.PROP | G.ITEM | G.SERPENT | ALL_FIGHTERS)), body);
    sim.tag(col, { kind: 'bomb', id });
    this.bombs.set(id, { id, body, col, fuse: 2.0, owner: f.slot, pv: { x: 0, y: 0 } });
    sim.track(id, body);
    sim.emit({ t: 'bomb', id, s: f.slot });
    f.cool = 0.35;
  }

  updateBombs(dt) {
    for (const b of [...this.bombs.values()]) {
      b.fuse -= dt;
      const v = b.body.linvel();
      if (Math.hypot(v.x - b.pv.x, v.y - b.pv.y) > 4) this.sim.emit({ t: 'bounce', id: b.id });
      b.pv = { x: v.x, y: v.y };
      const p = b.body.translation();
      if (b.fuse <= 0 || p.y < KILL_Y - 4) {
        this.sim.untag(b.col);
        this.sim.removeBody(b.body);
        this.bombs.delete(b.id);
        this.sim.emit({ t: 'gone', id: b.id });
        if (p.y >= KILL_Y - 4) this.explode(p.x, p.y, 3, 62, b.owner, { blocks: 95 });
      }
    }
  }

  // ------------------------------------------------------------ explosions
  explode(x, y, R, dmg, owner, opts = {}) {
    const sim = this.sim;
    const blocks = opts.blocks ?? dmg;
    const push = opts.push ?? 19;
    sim.emit({ t: opts.kind === 'stomp' ? 'stomp' : 'boom', x, y, r: R, s: owner, f: opts.fire === false ? 0 : 1 });
    // Blocks
    for (const [c, d] of sim.terrain.cellsNear(x, y, R)) {
      const fall = 1 - d / R;
      sim.terrain.damageCell(c, blocks * Math.pow(fall, 0.6) + 4, owner);
    }
    // Fighters
    for (const o of sim.fighters) {
      if (!o || o.slot === opts.spare) continue;
      let best = Infinity;
      for (const p of o.parts) { const t = p.body.translation(); best = Math.min(best, Math.hypot(t.x - x, t.y - y)); }
      if (best > R) continue;
      const fall = 1 - best / R;
      const t = o.pos();
      const dx = t.x - x, dy = t.y - y, dl = Math.hypot(dx, dy) || 1;
      const k = push * (0.35 + 0.65 * fall);
      const kx = (dx / dl) * k, ky = (dy / dl) * k + 3;
      if (o.alive) o.hurt(dmg * fall + 4, owner === o.slot ? -1 : owner, opts.kind || 'blast', { x: kx, y: ky }, 1);
      else o.addVel(kx, ky);
      if (owner !== o.slot) o.lastHit = { by: owner, t: sim.time };
    }
    // Loose bodies
    for (const [id, tb] of sim.tracked) {
      const b = tb.body;
      if (!b.isDynamic()) continue;
      const t = b.translation();
      const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy);
      if (d > R * 1.4 || d < 0.01) continue;
      const fall = 1 - d / (R * 1.4);
      const imp = push * 0.9 * fall * b.mass();
      b.applyImpulse({ x: (dx / d) * imp, y: (dy / d) * imp + imp * 0.2 }, true);
      b.applyTorqueImpulse((sim.rng.next() - 0.5) * imp * 0.4, true);
      if (tb.kind === 'blocks') {
        const dd = sim.terrain.dyn.get(id);
        if (dd && dd.cells.size > 1) sim.terrain.split(id);
      }
      if (tb.kind === 'prop') sim.damageProp(id, dmg * fall, owner);
    }
  }

  // ------------------------------------------------------------ portals
  firePortal(f) {
    const sim = this.sim, R = sim.R;
    const h = f.hand(), a = f.aimDir();
    f.cool = 0.35;
    const hit = sim.world.castRayAndGetNormal(new R.Ray({ x: h.x, y: h.y }, a), 30, true, undefined, groups(G.PROJ, G.TERRAIN));
    if (!hit) { sim.emit({ t: 'whiff', s: f.slot, k: 'portal' }); return; }
    const info = sim.info(hit.collider);
    if (!info || info.kind !== 'block' || sim.terrain.state[info.cell] !== 1) { sim.emit({ t: 'whiff', s: f.slot, k: 'portal' }); return; }
    const x = h.x + a.x * hit.timeOfImpact, y = h.y + a.y * hit.timeOfImpact;
    // Snap the normal to an axis.
    let nx = hit.normal.x, ny = hit.normal.y;
    if (Math.abs(nx) > Math.abs(ny)) { nx = Math.sign(nx); ny = 0; } else { nx = 0; ny = Math.sign(ny); }
    const ci = info.cell % W, cj = (info.cell / W) | 0;
    const px = nx ? ci + 0.5 + nx * 0.5 : clamp(x, ci + 0.1, ci + 0.9);
    const py = ny ? cj + 0.5 + ny * 0.5 : clamp(y, cj + 0.1, cj + 0.9);
    let pair = this.portals.get(f.slot);
    if (!pair) { pair = { list: [null, null], next: 0 }; this.portals.set(f.slot, pair); }
    const which = pair.next;
    pair.list[which] = { x: px, y: py, nx, ny, cell: info.cell };
    pair.next = 1 - which;
    sim.emit({ t: 'portal', s: f.slot, w: which, x: px, y: py, nx, ny });
  }

  closePortalsOn(c) {
    for (const [slot, pair] of this.portals) for (let w = 0; w < 2; w++) {
      if (pair.list[w] && pair.list[w].cell === c) { pair.list[w] = null; this.sim.emit({ t: 'portal', s: slot, w, off: 1 }); }
    }
  }

  updatePortals() {
    const sim = this.sim;
    const tryPass = (getPos, getVel, move, key) => {
      for (const [, pair] of this.portals) {
        const [A, B] = pair.list;
        if (!A || !B) continue;
        for (const [P, Q] of [[A, B], [B, A]]) {
          const p = getPos(), v = getVel();
          const rx = p.x - P.x, ry = p.y - P.y;
          const d = rx * P.nx + ry * P.ny;               // distance in front of the surface
          const tx = -P.ny, ty = P.nx;
          const t = rx * tx + ry * ty;                   // along the surface
          const vin = v.x * P.nx + v.y * P.ny;
          if (Math.abs(t) < 0.95 && d < 0.55 && d > -0.6 && vin < -0.3) {
            if ((sim.portalCool.get(key) || 0) > sim.time) return;
            // Rotation that maps -P.n onto Q.n.
            const rot = Math.atan2(Q.ny, Q.nx) - Math.atan2(-P.ny, -P.nx);
            const c = Math.cos(rot), s = Math.sin(rot);
            let vx = c * v.x - s * v.y, vy = s * v.x + c * v.y;
            const out = vx * Q.nx + vy * Q.ny;
            if (out < 5) { vx += Q.nx * (5 - out); vy += Q.ny * (5 - out); }
            const qtx = -Q.ny, qty = Q.nx;
            const nxp = Q.x + Q.nx * 0.9 - qtx * t * 0.6, nyp = Q.y + Q.ny * 0.9 - qty * t * 0.6;
            move(nxp, nyp, rot, { x: vx, y: vy });
            sim.portalCool.set(key, sim.time + 0.35);
            sim.emit({ t: 'warp', x: P.x, y: P.y, x2: Q.x, y2: Q.y });
            return;
          }
        }
      }
    };
    for (const f of sim.fighters) {
      if (!f) continue;
      tryPass(() => f.pos(), () => f.vel(), (x, y, rot, vel) => f.teleport(x, y + (Math.abs(rot) > 0.1 ? 0 : 0), rot, vel), 'f' + f.slot);
    }
    for (const [id, tb] of sim.tracked) {
      const b = tb.body;
      if (!b.isDynamic()) continue;
      tryPass(() => b.translation(), () => b.linvel(), (x, y, rot, vel) => {
        b.setTranslation({ x, y }, true); b.setRotation(b.rotation() + rot, true); b.setLinvel(vel, true);
      }, id);
    }
    for (const p of this.proj.values()) {
      tryPass(() => p, () => ({ x: p.vx, y: p.vy }), (x, y, rot, vel) => { p.x = x; p.y = y; p.vx = vel.x; p.vy = vel.y; sim.emit({ t: 'projwarp', id: p.id, x, y, vx: p.vx, vy: p.vy }); }, 'p' + p.id);
    }
  }

  // ------------------------------------------------------------ serpent
  blowHorn(f) {
    const sim = this.sim;
    f.item.ammo--; f.cool = 0.6;
    // Target the closest living enemy.
    const me = f.pos();
    let target = null, bd = Infinity;
    for (const o of sim.fighters) {
      if (!o || o === f || !o.alive) continue;
      const t = o.pos(), d = Math.hypot(t.x - me.x, t.y - me.y);
      if (d < bd) { bd = d; target = t; }
    }
    if (!target) target = { x: me.x + f.facing * 8, y: me.y };
    this.serpents.push(new Serpent(sim, f.slot, target, f.facing));
    sim.emit({ t: 'horn', s: f.slot, x: me.x, y: me.y });
  }

  // ------------------------------------------------------------ per step
  update(dt) {
    const sim = this.sim;
    if (sim.phase === 'fight') {
      this.nextDrop -= dt;
      if (this.nextDrop <= 0) { this.dropRandom(); this.nextDrop = sim.rng.float(this.dropEvery[0], this.dropEvery[1]); }
    }
    this.updateProjectiles(dt);
    this.updateBombs(dt);
    this.updatePortals();
    for (const s of this.serpents) s.update(dt);
    this.serpents = this.serpents.filter((s) => !s.done);
    for (const g of this.glued) if (sim.time > g.until && sim.bodyAlive(g.body)) freeze(g.body, false);
    this.glued = this.glued.filter((g) => sim.time <= g.until);
    for (const f of sim.fighters) if (f && f.beam && (!f.item || f.item.kind !== 'tractor')) this.endBeam(f);
    // World items: crates break on landing, thrown items hit fighters, blades stick.
    for (const it of [...this.world.values()]) {
      const b = it.body, p = b.translation(), v = b.linvel();
      if (p.y < KILL_Y - 8) { this.removeWorldItem(it); continue; }
      if (it.crated && sim.time - it.born > 0.3 && Math.abs(v.y) < 0.6 && p.y < H) {
        // Break the crate open.
        it.crated = false;
        sim.untag(it.col);
        sim.world.removeCollider(it.col, true);
        const [hx, hy] = ITEM_SIZE[it.kind];
        it.col = sim.world.createCollider(sim.R.ColliderDesc.cuboid(hx, hy).setDensity(1.5).setFriction(0.9)
          .setCollisionGroups(groups(G.ITEM, G.TERRAIN | G.PROP | G.ITEM | G.SERPENT)), b);
        sim.tag(it.col, { kind: 'item', id: it.id });
        b.setLinvel({ x: 0, y: 3 }, true);
        sim.emit({ t: 'uncrate', id: it.id, x: p.x, y: p.y });
      }
      if (it.thrown) {
        it.thrown.t -= dt;
        const sp = Math.hypot(v.x, v.y);
        if (sp < 3.5) { this.endThrow(it); continue; }
        const touching = [];
        sim.world.contactPairsWith(it.col, (other) => touching.push(other));
        for (const other of touching) {
          if (!it.thrown) break;
          if (!sim.colAlive(other)) continue;
          const info = sim.info(other);
          if (!info) continue;
          if (info.kind === 'part' && !it.thrown.hit.has(info.f.slot) && info.f.slot !== (it.thrown.t > 0 ? it.thrown.by : -9)) {
            it.thrown.hit.add(info.f.slot);
            const blade = it.kind === 'axe' || it.kind === 'sword';
            const dmg = (blade ? 30 : 12 + b.mass() * 2) * clamp(sp / THROW_V, 0.4, 1.3);
            info.f.hurt(dmg, it.thrown.by, 'throw', { x: v.x * 0.3, y: v.y * 0.3 + 2 }, 0.6);
            sim.emit({ t: 'clash', k: 'throw', x: p.x, y: p.y, s: it.thrown.by });
          } else if (info.kind === 'block' && (it.kind === 'axe' || it.kind === 'sword') && sp > 9 && !it.stuck) {
            // Blades bite into what they hit.
            it.stuck = true;
            const ang = Math.atan2(v.y, v.x);
            b.setRotation(it.kind === 'sword' ? ang : ang + Math.PI / 2, false);
            freeze(b, true);
            sim.emit({ t: 'stick', id: it.id, x: p.x, y: p.y, m: sim.terrain.grid[info.cell] });
            it.stuckCell = info.cell;
          }
        }
      }
    }
  }

  endThrow(it) {
    if (!it.thrown) return;
    it.thrown = null;
    it.col.setCollisionGroups(groups(G.ITEM, G.TERRAIN | G.PROP | G.ITEM | G.SERPENT));
  }

  onCellGone(c) {
    this.closePortalsOn(c);
    // A hand holding the terrain lets go when the block it held breaks.
    const ci = c % W, cj = (c / W) | 0;
    for (const f of this.sim.fighters) {
      const g = f && f.grab;
      if (g && g.body === this.sim.terrain.fixedBody && Math.abs(g.x - (ci + 0.5)) < 0.75 && Math.abs(g.y - (cj + 0.5)) < 0.75) this.releaseGrab(f);
    }
    for (const it of this.world.values()) if (it.stuck && it.stuckCell === c) {
      it.stuck = false; freeze(it.body, false); this.endThrow(it);
    }
  }
}
