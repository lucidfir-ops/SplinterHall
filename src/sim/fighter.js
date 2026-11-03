// Active ragdoll fighters: 10 bodies held in a pose by velocity PD control, a hover spring at the
// hips for standing, and one stick + two buttons of input.
import { G, groups, ALL_FIGHTERS, MAT, clamp, W, H, SIDE_MARGIN, FIGHTER_HP, NO_DIR, byteToDir, ATK } from '../core/consts.js';
import { Animator } from '../anim/animator.js';
import { J } from '../anim/skeleton.js';

// Part layout (metres). Limbs are capsules along their local y axis; joints sit at segment ends.
export const PARTS = [
  { name: 'head', shape: 'ball', r: 0.24, density: 0.9 },
  { name: 'torso', shape: 'capsule', hh: 0.22, r: 0.13, density: 1.3 },
  { name: 'uarmB', shape: 'capsule', hh: 0.15, r: 0.06, density: 0.9 },
  { name: 'larmB', shape: 'capsule', hh: 0.15, r: 0.055, density: 0.9 },
  { name: 'uarmF', shape: 'capsule', hh: 0.15, r: 0.06, density: 0.9 },
  { name: 'larmF', shape: 'capsule', hh: 0.15, r: 0.055, density: 0.9 },
  { name: 'thighB', shape: 'capsule', hh: 0.18, r: 0.075, density: 1.1 },
  { name: 'shinB', shape: 'capsule', hh: 0.18, r: 0.065, density: 1.1 },
  { name: 'thighF', shape: 'capsule', hh: 0.18, r: 0.075, density: 1.1 },
  { name: 'shinF', shape: 'capsule', hh: 0.18, r: 0.065, density: 1.1 },
];
export const HEAD = 0, TORSO = 1, UARM_B = 2, LARM_B = 3, UARM_F = 4, LARM_F = 5, THIGH_B = 6, SHIN_B = 7, THIGH_F = 8, SHIN_F = 9;

// Rest-pose centres relative to the feet (x, y), all parts upright.
const REST = [
  [0, 1.595], [0, 1.005], [-0.02, 1.095], [-0.02, 0.795], [0.02, 1.095], [0.02, 0.795],
  [-0.06, 0.605], [-0.06, 0.245], [0.06, 0.605], [0.06, 0.245],
];
// Joints: [parentPart, childPart, anchorOnParent, anchorOnChild, lo, hi]
const JOINTS = [
  [TORSO, HEAD, [0, 0.33], [0, -0.26], -0.7, 0.7],
  [TORSO, UARM_B, [0, 0.24], [0, 0.15], null, null],
  [UARM_B, LARM_B, [0, -0.15], [0, 0.15], -2.6, 2.6],
  [TORSO, UARM_F, [0, 0.24], [0, 0.15], null, null],
  [UARM_F, LARM_F, [0, -0.15], [0, 0.15], -2.6, 2.6],
  [TORSO, THIGH_B, [0, -0.22], [0, 0.18], -2.2, 2.2],
  [THIGH_B, SHIN_B, [0, -0.18], [0, 0.18], -2.5, 2.5],
  [TORSO, THIGH_F, [0, -0.22], [0, 0.18], -2.2, 2.2],
  [THIGH_F, SHIN_F, [0, -0.18], [0, 0.18], -2.5, 2.5],
];

const RUN_SPEED = 8.6;
const JUMP_V = 14;          // about 4 m: two body heights
const DJUMP_V = 11.5;
const FALL_G = 16;          // extra pull while falling, so jumps snap down instead of floating
const GROUND_GAIN = 20;     // how hard the legs chase the stick on the ground
const AIR_GAIN = 9;         // and in the air (strong air control)
const WALL_SLIDE = -2.5;    // pushing into a wall in the air slows the fall to this
const WALL_JUMP = { x: 8.5, y: 12.5 };
const HIP_H = 0.8;          // hip height held by the hover spring
const DUCK_H = 0.3;         // hip height while ducking (low enough for a straight jab to pass over)
const DUCK_SPEED = 0.35;    // share of run speed while ducking
const AIM_LOCK = 0.35;      // seconds a swiped attack direction overrides the stick
const RAY_LEN = 1.2;
const MAX_HP = FIGHTER_HP;

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// World angle that points a limb (which extends along its local -y) in direction (dx, dy).
export const limbAngle = (dx, dy) => Math.atan2(dx, -dy);

export class Fighter {
  constructor(sim, slot, x, fy, opts = {}) {
    this.sim = sim;
    this.slot = slot;
    this.name = opts.name || 'Fighter';
    this.isAI = !!opts.ai;
    this.bit = G.FIGHTER0 << slot;
    this.alive = true;
    this.hp = MAX_HP;
    this.poise = 1;
    this.facing = x < 24 ? 1 : -1;
    this.aim = this.facing > 0 ? 0 : Math.PI;   // math angle of aim
    this.aimTarget = this.aim;
    this.grounded = false;
    this.groundT = 0;           // time since last grounded
    this.jumps = 1;
    this.noHover = 0;
    this.phase = 0;
    this.stuck = 0;
    this.item = null;           // { kind, ammo, id }
    this.back = null;           // { kind: 'jetpack', ammo(fuel), id }
    this.jetting = false;
    this.cool = 0;              // item cooldown
    this.swing = null;          // melee/punch state
    this.charge = 0;            // seconds Action has been held for a charged attack
    this.lastJp = 0; this.lastAp = 0; this.wasDown = false;
    this.aimLock = 0; this.aimLockA = 0; // a swiped attack points this way for a moment
    this.ducking = false; this.duckT = 0; this.wasDownHeld = false;
    this.wallDir = 0;            // -1 / 1 while clinging to a wall in the air
    this.lastHit = { by: -1, t: -99 };
    this.groundMat = 0;
    this.kills = 0;
    this.line = null;           // web line { joint, body, ax, ay, len }
    this.beam = null;           // tractor beam state
    this.flash = 0;
    this.inp = { x: 0, y: 0, b: 0, jp: 0, ap: 0, ak: 0, ad: NO_DIR };
    this.anim = new Animator(this.facing);
    this.groundD = null;        // floor distance below the hips (null when there's none in reach)
    this.flipEv = false; this.landEv = false; this.hurtEv = false;
    this.partBuf = Array.from({ length: 10 }, () => [0, 0, 0]);
    this.lastT = new Array(10).fill(0);
    this.parts = [];
    this.joints = [];
    this.pre = [];
    this.build(x, fy);
    this.mass = this.parts.reduce((s, p) => s + p.body.mass(), 0);
  }

  build(x, fy) {
    const R = this.sim.R, world = this.sim.world;
    const filter = 0xffff & ~this.bit & ~G.ITEM;
    PARTS.forEach((def, k) => {
      const [ox, oy] = REST[k];
      const bd = R.RigidBodyDesc.dynamic().setTranslation(x + ox, fy + oy).setLinearDamping(0.1).setAngularDamping(0.5);
      if (k === TORSO || k === HEAD) bd.setCcdEnabled(true);
      const body = world.createRigidBody(bd);
      const cd = def.shape === 'ball' ? R.ColliderDesc.ball(def.r) : R.ColliderDesc.capsule(def.hh, def.r);
      cd.setDensity(def.density).setFriction(k === SHIN_B || k === SHIN_F ? 1.2 : 0.5).setRestitution(0.05)
        .setCollisionGroups(groups(this.bit, filter));
      const col = world.createCollider(cd, body);
      this.sim.tag(col, { kind: 'part', f: this, part: k });
      body.userData = { kind: 'part', f: this, part: k };
      this.parts.push({ body, col, def });
      this.pre.push({ x: 0, y: 0 });
    });
    for (const [a, b, aa, ab, lo, hi] of JOINTS) {
      const jd = R.JointData.revolute({ x: aa[0], y: aa[1] }, { x: ab[0], y: ab[1] });
      const j = world.createImpulseJoint(jd, this.parts[a].body, this.parts[b].body, true);
      if (lo !== null && j.setLimits) j.setLimits(lo, hi);
      this.joints.push(j);
    }
  }

  get torso() { return this.parts[TORSO].body; }
  pos() { return this.torso.translation(); }
  vel() { return this.torso.linvel(); }

  // World point at a part's local offset.
  local(k, lx, ly) {
    const b = this.parts[k].body, t = b.translation(), a = b.rotation();
    const c = Math.cos(a), s = Math.sin(a);
    return { x: t.x + c * lx - s * ly, y: t.y + s * lx + c * ly };
  }
  hip() { return this.local(TORSO, 0, -0.22); }
  feet() { const h = this.hip(); return { x: h.x, y: h.y - 0.75 }; }
  // The hand of the aiming arm and the direction the forearm points.
  // From the animated pose (what's drawn); the physics forearm's end before the first pose exists.
  hand() {
    const j = this.anim.joints;
    if (!this.anim.started) return this.physHand();
    const hx = j[J.HAND_F * 3], hy = j[J.HAND_F * 3 + 1];
    let dx = hx - j[J.ELB_F * 3], dy = hy - j[J.ELB_F * 3 + 1];
    const l = Math.hypot(dx, dy);
    if (l < 0.08) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); } else { dx /= l; dy /= l; }
    return { x: hx, y: hy, dx, dy, a: limbAngle(dx, dy) };
  }
  physHand() {
    const b = this.parts[LARM_F].body, a = b.rotation();
    const p = this.local(LARM_F, 0, -0.2);
    return { x: p.x, y: p.y, dx: Math.sin(a), dy: -Math.cos(a), a };
  }
  aimDir() { return { x: Math.cos(this.aim), y: Math.sin(this.aim) }; }
  // The front shin's end (physics).
  foot() {
    const b = this.parts[SHIN_F].body, a = b.rotation();
    const p = this.local(SHIN_F, 0, -0.2);
    return { x: p.x, y: p.y, dx: Math.sin(a), dy: -Math.cos(a), a };
  }
  addVel(vx, vy) {
    for (const p of this.parts) { const v = p.body.linvel(); p.body.setLinvel({ x: v.x + vx, y: v.y + vy }, true); }
  }
  setVelAll(fn) {
    for (const p of this.parts) { const v = p.body.linvel(); p.body.setLinvel(fn(v), true); }
  }

  // ------------------------------------------------------------------ control
  control(inp, dt) {
    this.inp = inp;
    if (this.flash > 0) this.flash -= dt;
    if (!this.alive) { this.animate(dt); return; }
    const sim = this.sim;
    const fight = sim.phase === 'fight' || sim.phase === 'final';
    const torso = this.torso;
    const tpos = torso.translation();
    const tv = torso.linvel();
    let sx = fight ? inp.x : 0, sy = fight ? inp.y : 0;
    if (this.stuck > 0) { this.stuck -= dt; sx = 0; }
    const mag = Math.hypot(sx, sy);

    // Embedded in a block (a big hit can drive a head or torso into one): after a moment, pop out.
    const hd = this.parts[HEAD].body.translation();
    if (sim.terrain.solidAt(tpos.x, tpos.y) || sim.terrain.solidAt(hd.x, hd.y)) {
      this.embedT = (this.embedT || 0) + dt;
      if (this.embedT > 0.25) { this.embedT = 0; this.popOut(); }
    } else this.embedT = 0;

    // Poise recovers toward 1.
    this.poise = Math.min(1, this.poise + dt * (this.poise < 0.3 ? 1.1 : 2.2));
    const P = this.poise;

    // Action press (read early: a swiped attack carries its own direction).
    const actPressed = fight && inp.ap !== this.lastAp;
    this.lastAp = inp.ap;
    let atk = actPressed ? (inp.ak | 0) : 0;
    // A tap on the square is a throw with something in hand, and a jump without.
    let tapJump = false;
    if (actPressed && atk === ATK.THROW && !this.item) { tapJump = true; atk = 0; }
    // Keys, pads and bots have no swipe: the stick picks the move (up: uppercut, down: slam) for bare hands.
    if (actPressed && (inp.ad == null || inp.ad === NO_DIR) && atk === ATK.NORMAL && !this.item) {
      if (sy > 0.55) atk = ATK.UPPER; else if (sy < -0.55) atk = ATK.SLAM;
    }
    if (actPressed && !tapJump && inp.ad != null && inp.ad !== NO_DIR) {
      this.aimLock = AIM_LOCK; this.aimLockA = byteToDir(inp.ad);
      this.aim = this.aimLockA;
    }
    if (this.aimLock > 0) this.aimLock -= dt;

    // Facing and aim.
    const busy = !!this.swing;
    if (Math.abs(sx) > 0.25 && !busy) this.facing = Math.sign(sx);
    if (this.aimLock > 0) this.aimTarget = this.aimLockA;
    else if (mag > 0.3) this.aimTarget = Math.atan2(sy, sx);
    else this.aimTarget = this.facing > 0 ? 0 : Math.PI;
    this.aim += wrap(this.aimTarget - this.aim) * Math.min(1, dt / 0.06);
    this.aim = wrap(this.aim);
    if ((mag > 0.3 || this.aimLock > 0) && Math.abs(Math.cos(this.aim)) > 0.2 && !busy) this.facing = Math.sign(Math.cos(this.aim));

    // Ground check: two rays from the hips.
    const hip = this.hip();
    const qg = groups(this.bit, G.TERRAIN | G.PROP);
    let d = Infinity, hitCol = null;
    for (const off of [-0.24, 0, 0.24]) {
      // A ray that starts inside a block (hips pressed to a wall) or hits a wall's side isn't ground: counting
      // it let fighters stand on the face of a wall.
      const ox = hip.x + off;
      if (sim.terrain.solidAt(ox, hip.y)) continue;
      const h = sim.world.castRayAndGetNormal(new sim.R.Ray({ x: ox, y: hip.y }, { x: 0, y: -1 }), RAY_LEN, true, undefined, qg);
      if (h && h.normal.y > 0.3 && h.timeOfImpact < d) { d = h.timeOfImpact; hitCol = h.collider; }
    }
    const wasGrounded = this.grounded;
    this.grounded = d < RAY_LEN && this.noHover <= 0 && P > 0.25;
    this.groundD = d < RAY_LEN ? d : null;
    if (this.grounded) { this.groundT = 0; this.jumps = 1; }
    else this.groundT += dt;
    this.groundMat = 0;
    if (this.grounded && hitCol) {
      const info = sim.info(hitCol);
      if (info && info.kind === 'block') this.groundMat = sim.terrain.grid[info.cell];
    }
    if (this.noHover > 0) this.noHover -= dt;
    if (!wasGrounded && this.grounded && tv.y < -6) sim.emit({ t: 'land', s: this.slot, x: hip.x, y: hip.y - d, v: -tv.y });
    if (!wasGrounded && this.grounded && tv.y < -3) this.landEv = true;

    // Ducking: the stick held down (or flicked down, for a moment) on the ground.
    const downHeld = fight && sy < -0.5 && this.stuck <= 0;
    if (downHeld && !this.wasDownHeld) this.duckT = 0.3;
    this.wasDownHeld = downHeld;
    if (this.duckT > 0) this.duckT -= dt;
    // A low roof (a one-block tunnel) crouches you automatically: standing up into it pinned fighters by friction.
    let lowRoof = false;
    if (d < RAY_LEN) {
      const up = sim.world.castRay(new sim.R.Ray({ x: hip.x, y: hip.y }, { x: 0, y: 1 }), 1.2, true, undefined, qg);
      lowRoof = !!up && up.timeOfImpact < 1.15;
    }
    this.lowRoof = lowRoof;
    this.ducking = (this.grounded || lowRoof) && (downHeld || this.duckT > 0 || lowRoof || !!(this.swing && this.swing.def.crouch));

    // Hover spring holds the hips up.
    if (this.grounded) {
      const hipT = this.ducking ? DUCK_H : HIP_H;
      const acc = clamp((hipT - d) * 170 - tv.y * 15 + 24, 0, 90) * (0.35 + 0.65 * P);
      const v = torso.linvel();
      torso.setLinvel({ x: v.x, y: v.y + acc * dt * (this.mass / torso.mass()) * 0.92 }, true);
    }

    // Walls: pushing into one in the air clings to it (a slow slide); a jump kicks off it and gives the
    // double jump back, so walls can be climbed by bouncing between them.
    this.wallDir = 0;
    if (!this.grounded && fight && Math.abs(sx) > 0.4 && P > 0.4 && this.stuck <= 0) {
      const d0 = Math.sign(sx);
      for (const oy of [0.15, -0.35]) {
        if (sim.terrain.solidAt(tpos.x, tpos.y + oy)) continue; // starts inside a block: not a wall beside you
        const h = sim.world.castRay(new sim.R.Ray({ x: tpos.x, y: tpos.y + oy }, { x: d0, y: 0 }), 0.6, true, undefined, qg);
        if (h) { this.wallDir = d0; break; }
      }
      if (this.wallDir && tv.y < WALL_SLIDE) this.setVelAll((v) => ({ x: v.x, y: Math.max(v.y, WALL_SLIDE) }));
    }

    // Running.
    const ice = this.groundMat === MAT.ICE;
    // In a move with the stick let go, the body keeps the move's own momentum (a step in, a lunge) for a while.
    const gain = this.grounded ? (ice ? 1.6 : this.swing && Math.abs(sx) < 0.05 ? 3 : GROUND_GAIN) : AIR_GAIN;
    const target = sx * RUN_SPEED * (this.ducking ? DUCK_SPEED : 1) * (this.swing ? this.swing.def.move : 1);
    let dvx = clamp((target - tv.x) * gain * dt, -3, 3) * (0.25 + 0.75 * P);
    if (this.wallDir && Math.sign(dvx) === this.wallDir) dvx = 0; // pressing into a wall in the air would pin you by friction
    if (Math.abs(sx) > 0.05 || this.grounded) this.addVel(dvx, 0);

    // Jump, double jump, jetpack.
    const jumpPressed = fight && (inp.jp !== this.lastJp || tapJump);
    this.lastJp = inp.jp;
    // Feet resting on something also count for a jump (a ledge corner the hip rays miss).
    let footing = false;
    if (jumpPressed && this.groundT >= 0.12 && Math.abs(tv.y) < 1.2) {
      for (const k of [SHIN_B, SHIN_F]) sim.world.contactPairsWith(this.parts[k].col, (c) => { const inf = sim.info(c); if (inf && (inf.kind === 'block' || inf.kind === 'prop')) footing = true; });
    }
    if (jumpPressed && this.stuck <= 0) {
      if (this.wallDir && this.groundT >= 0.12) {
        const wd = this.wallDir;
        this.setVelAll((v) => ({ x: -wd * WALL_JUMP.x, y: WALL_JUMP.y }));
        this.jumps = 1; this.facing = -wd; this.noHover = 0.2; this.wallDir = 0;
        sim.emit({ t: 'jump', s: this.slot, x: hip.x, y: hip.y, w: 1 });
      } else if (this.groundT < 0.12 || footing) {
        this.setVelAll((v) => ({ x: v.x, y: Math.max(v.y, 0) * 0.2 + JUMP_V }));
        this.noHover = 0.2; this.grounded = false; this.groundT = 1;
        sim.emit({ t: 'jump', s: this.slot, x: hip.x, y: hip.y });
      } else if (this.jumps > 0) {
        this.jumps--;
        this.setVelAll((v) => ({ x: v.x, y: Math.max(v.y, 0) * 0.3 + DJUMP_V }));
        this.noHover = 0.2;
        this.flipEv = true;
        sim.emit({ t: 'jump', s: this.slot, x: hip.x, y: hip.y, d: 1 });
      }
    }
    const jumpHeld = fight && (inp.b & 1);
    const jet = !!this.back && this.back.kind === 'jetpack' && !this.grounded && jumpHeld && this.back.ammo > 0 && this.groundT > 0.18 && this.stuck <= 0;
    if (jet) {
      let jx = 0, jy = 1;
      if (mag > 0.3) { jx = sx / mag; jy = sy / mag; }
      const a = 36 * dt;
      this.setVelAll((v) => {
        let nx = v.x + jx * a, ny = v.y + jy * a + (jy > 0 ? 0 : 0);
        const sp = Math.hypot(nx, ny);
        if (sp > 15) { nx *= 15 / sp; ny *= 15 / sp; }
        return { x: nx, y: ny };
      });
      this.back.ammo = Math.max(0, this.back.ammo - dt);
    } else if (this.back && this.back.kind === 'jetpack' && this.grounded) {
      this.back.ammo = Math.min(4, this.back.ammo + dt * 0.6);
    }
    if (jet !== this.jetting) { this.jetting = jet; sim.emit({ t: 'jet', s: this.slot, on: jet ? 1 : 0 }); }

    // Wedged while trying to move with nothing in the way (a foot sunk into the seam between two blocks, a body
    // caught in a gap): a little hop that way frees it.
    if (Math.abs(sx) > 0.4 && Math.abs(tv.x) < 0.3 && Math.abs(tv.y) < 1 && this.stuck <= 0 && P > 0.5 && !this.wallDir) {
      this.wedgeT = (this.wedgeT || 0) + dt;
      if (this.wedgeT > 0.45) {
        this.wedgeT = 0;
        const s0 = Math.sign(sx);
        const blocked = sim.world.castRay(new sim.R.Ray({ x: tpos.x, y: tpos.y }, { x: s0, y: 0 }), 0.6, true, undefined, qg);
        if (!blocked) { this.addVel(s0 * 2.5, this.grounded ? 3.5 : 1.5); this.noHover = 0.1; }
      }
    } else this.wedgeT = 0;

    // Heavier on the way down; faster still with the stick down.
    if (!this.grounded && !jet && !this.line && tv.y < 0 && !this.wallDir) this.addVel(0, -FALL_G * dt);
    if (!this.grounded && sy < -0.6 && !jet) this.addVel(0, -30 * dt);

    // Down: pick up (edge-triggered).
    const down = fight && sy < -0.55 && Math.abs(sx) < 0.75;
    if (down && !this.wasDown) sim.items.tryPickup(this);
    this.wasDown = down;

    // Action.
    const actHeld = fight && !!(inp.b & 2);
    if (this.safeLand > 0) this.safeLand -= dt;
    if (this.stuck <= 0) sim.items.action(this, actPressed && !tapJump, actHeld, sy > 0.55, dt, atk);

    // Pose this step, then the hits it lands, then the physics limbs chase it.
    this.animate(dt);
    sim.items.meleeTick(this);
    this.drive(dt);
  }

  // The animation context for this step.
  animCtx(dt) {
    const tv = this.torso.linvel(), hip = this.hip();
    for (let k = 0; k < 10; k++) {
      const b = this.parts[k].body, t = b.translation(), q = this.partBuf[k];
      q[0] = t.x; q[1] = t.y; q[2] = b.rotation();
    }
    const f = this.facing;
    const lx = Math.cos(this.aim) * f, ly = Math.sin(this.aim);
    let lineTh = null;
    if (this.line || this.beam) {
      const p = this.line ? this.sim.items.linePoint(this) : this.beam, h = this.anim.joints;
      if (p) { const dx = (p.x - h[J.SHO_F * 3]) * f, dy = p.y - h[J.SHO_F * 3 + 1]; lineTh = Math.atan2(dx, -dy) / (Math.PI / 180); }
    }
    const c = this._ctx || (this._ctx = {});
    c.dt = dt; c.facing = f; c.rootX = hip.x; c.rootY = hip.y;
    c.ground = this.grounded || this.ducking ? this.groundD : null;
    c.grounded = this.grounded; c.ducking = this.ducking; c.wall = this.wallDir; c.jet = this.jetting;
    c.dive = this.dive ? this.dive.t : -1;
    c.vx = tv.x; c.vy = tv.y;
    c.th = Math.atan2(lx, -ly) / (Math.PI / 180);
    c.item = this.item ? this.item.kind : null;
    c.charge = this.charge;
    c.grab = !!this.grab; c.lineTh = lineTh;
    c.swing = this.swing ? { clip: this.swing.clip, t: this.swing.t } : null;
    c.flip = this.flipEv; c.land = this.landEv; c.hurt = this.hurtEv;
    c.ragdoll = !this.alive || this.poise < 0.3;
    c.parts = this.partBuf;
    this.flipEv = this.landEv = this.hurtEv = false;
    return c;
  }

  animate(dt) { this.anim.update(this.animCtx(dt)); }

  // After the physics step: put the pose where the body now is (the frame shows it there).
  placeAnim() {
    const hip = this.hip();
    for (let k = 0; k < 10; k++) {
      const b = this.parts[k].body, t = b.translation(), q = this.partBuf[k];
      q[0] = t.x; q[1] = t.y; q[2] = b.rotation();
    }
    this.anim.place(hip.x, hip.y, this.facing, this.partBuf);
  }

  // The physics limbs chase the animated pose (flattened: spins and flips stay in the drawing), so the body
  // that gets hit and bumps into things is where the drawn one is.
  drive(dt) {
    const P = this.poise;
    if (P < 0.05) return;
    const j = this.anim.flat, T = this.lastT;
    const seg = (k, a, b, len) => {
      const dx = j[b * 3] - j[a * 3], dy = j[b * 3 + 1] - j[a * 3 + 1];
      if (Math.hypot(dx, dy) > len * 0.35) T[k] = limbAngle(dx, dy);
    };
    seg(HEAD, J.HEAD, J.CHEST, 0.37); seg(TORSO, J.CHEST, J.PELVIS, 0.44);
    seg(UARM_B, J.SHO_B, J.ELB_B, 0.3); seg(LARM_B, J.ELB_B, J.HAND_B, 0.3);
    seg(UARM_F, J.SHO_F, J.ELB_F, 0.3); seg(LARM_F, J.ELB_F, J.HAND_F, 0.3);
    seg(THIGH_B, J.HIP_B, J.KNEE_B, 0.36); seg(SHIN_B, J.KNEE_B, J.FOOT_B, 0.36);
    seg(THIGH_F, J.HIP_F, J.KNEE_F, 0.36); seg(SHIN_F, J.KNEE_F, J.FOOT_F, 0.36);
    // Airborne limbs are held loosely so they flail with the body (the torso stays firm for landings).
    const loose = this.grounded || this.swing || this.dive ? 1 : 0.4;
    const kp = 420, kd = 26;
    for (let k = 0; k < 10; k++) {
      const b = this.parts[k].body;
      const err = wrap(T[k] - b.rotation());
      const w = b.angvel();
      const gainP = (k === TORSO ? kp * 1.4 : k === HEAD ? kp * 0.6 : kp * loose) * P;
      const dw = (gainP * err - kd * w * P) * dt;
      b.setAngvel(w + clamp(dw, -14, 14), true);
    }
  }

  // Record velocities after control so impacts can be measured after the physics step.
  record() {
    for (let k = 0; k < 2; k++) { const v = this.parts[k].body.linvel(); this.pre[k].x = v.x; this.pre[k].y = v.y; }
  }

  afterStep() {
    this.placeAnim();
    if (!this.alive) return;
    const sim = this.sim;
    let worst = 0, landing = false;
    for (let k = 0; k < 2; k++) {
      const v = this.parts[k].body.linvel(), p = this.pre[k];
      const dvx = v.x - p.x, dvy = v.y - p.y;
      const dv = Math.hypot(dvx, dvy);
      if (dv > worst) { worst = dv; landing = p.y < -4 && dvy > 0 && Math.abs(dvx) < dvy * 0.6; }
    }
    // Landing on your feet never hurts (only a truly huge drop does); being hit or slammed does.
    // Bounced off walls and floors by big hits: it hurts only past a fair speed (Stick Fight-style knockback
    // throws people around a lot).
    const limit = this.safeLand > 0 || this.dive ? 60 : landing ? 28 : 18;
    if (worst > 7 && !landing) this.poise = Math.max(0, this.poise - (worst - 6) * 0.1);
    if (worst > limit) this.hurt((worst - limit) * 1.8, this.lastHit.t > sim.time - 3 ? this.lastHit.by : -1, 'impact');
    // Kill line and bounds.
    const t = this.torso.translation();
    if (t.y < sim.killY) this.die(this.lastHit.t > sim.time - 6 ? this.lastHit.by : -1, 'fall');
    else if (t.x < -SIDE_MARGIN || t.x > W + SIDE_MARGIN || t.y > H + SIDE_MARGIN) this.die(this.lastHit.t > sim.time - 6 ? this.lastHit.by : -1, 'out');
  }

  hurt(amount, by = -1, kind = 'hit', knock = null, poiseHit = 0) {
    if (!this.alive || amount <= 0) return;
    if (by >= 0 && by !== this.slot) this.lastHit = { by, t: this.sim.time };
    this.hp -= amount;
    this.flash = 0.06;
    this.poise = Math.max(0, this.poise - poiseHit);
    if (kind !== 'impact') { this.hurtEv = true; if (amount >= 14) this.sim.hitStop(amount >= 26 ? 6 : 4); }
    if (this.swing && poiseHit >= 0.5 && this.swing.t < this.swing.def.firstHit) this.swing = null;
    if (knock) { const m = this.grounded ? 1 : 1.25; this.addVel(knock.x * m, knock.y * m); }
    const t = this.torso.translation();
    this.sim.emit({ t: 'hurt', s: this.slot, by, a: Math.round(amount), x: t.x, y: t.y, k: kind });
    if (this.hp <= 0) this.die(by >= 0 ? by : this.lastHit.t > this.sim.time - 4 ? this.lastHit.by : -1, kind);
  }

  die(by, cause) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = Math.min(this.hp, 0);
    this.poise = 0;
    this.sim.items.onDeath(this);
    const t = this.torso.translation();
    this.sim.emit({ t: 'death', s: this.slot, by, c: cause, x: t.x, y: t.y });
    this.sim.onDeath(this, by);
  }

  // Move the whole body rigidly (portals): rotate by `rot` around the torso, then place the torso at (x, y).
  teleport(x, y, rot, vel) {
    const t = this.torso.translation();
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const p of this.parts) {
      const b = p.body, q = b.translation();
      const rx = q.x - t.x, ry = q.y - t.y;
      b.setTranslation({ x: x + c * rx - s * ry, y: y + s * rx + c * ry }, true);
      b.setRotation(b.rotation() + rot, true);
      const v = b.linvel();
      b.setLinvel(vel ? { x: vel.x, y: vel.y } : { x: c * v.x - s * v.y, y: s * v.x + c * v.y }, true);
    }
  }

  // Move to the nearest spot with two open cells (room for the body), still.
  popOut() {
    const t = this.torso.translation(), T = this.sim.terrain;
    const i0 = Math.floor(t.x), j0 = Math.floor(t.y);
    for (let r = 0; r <= 6; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || i >= W || j < 1 || j >= H - 1) continue;
        if (T.solidAt(i + 0.5, j + 0.5) || T.solidAt(i + 0.5, j + 1.5) || T.solidAt(i + 0.5, j - 0.5) && T.solidAt(i + 0.5, j + 1.5)) continue;
        const d = Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y);
        if (d < bd) { bd = d; best = { x: i + 0.5, y: j + 0.6 }; }
      }
      if (best) { this.teleport(best.x, best.y, 0, { x: 0, y: 0 }); return; }
    }
  }

  remove() {
    for (const j of this.joints) this.sim.world.removeImpulseJoint(j, false);
    for (const p of this.parts) { this.sim.untag(p.col); this.sim.world.removeRigidBody(p.body); }
    this.parts = [];
    this.joints = [];
  }
}
