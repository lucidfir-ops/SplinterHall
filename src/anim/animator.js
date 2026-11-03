// Drives one fighter's 3D pose each step: procedural locomotion (stance, run, crouch, jumps and flips, walls,
// dives) with keyframed move clips laid over it, then solves the joints in the world.
//
// The simulation reads the joints for hit volumes and for the targets the physics limbs chase; the view draws
// the same joints. When a fighter is knocked loose (poise gone, or dead) the pose hands over to the physics
// ragdoll, and on getting up it eases back from wherever the ragdoll left the body.
import { D, DEG, LEN, J, NJ, basePose, copyPose, blendPose, legIK, armIK, solve, frame, worldDir, SCALARS, LIMBS } from './skeleton.js';
import { CLIPS, dir } from './moves.js';

const RUN = 8.6;
const FOOT_R = 0.065;
const RATE = 20;          // how fast locomotion poses settle (1/s)
const FLIP = 0.4;         // double-jump somersault (s)
const TURN = 0.13;        // turning round (s)
const LAND = 0.16;        // landing squash (s)
const DIRS = ['head', ...LIMBS];
const BASE = basePose();
const TAU = Math.PI * 2;

const smooth = (u) => u * u * (3 - 2 * u);
function ease(u, e) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (e) {
    case 'in': return u * u;
    case 'out': return 1 - (1 - u) * (1 - u);
    case 'lin': return u;
    default: return smooth(u);
  }
}
const val = (v, c) => (typeof v === 'function' ? v(c) : v);
const wrap180 = (a) => { a %= 360; if (a > 180) a -= 360; if (a <= -180) a += 360; return a; };
// dir() written straight into a pose's vector (no garbage in the per-step paths).
const sd = (dst, th, side = 0) => { const t = th * DEG, q = side * DEG, c = Math.cos(q); dst[0] = Math.sin(t) * c; dst[1] = -Math.cos(t) * c; dst[2] = Math.sin(q); };
const set3 = (dst, s) => { const l = Math.hypot(s[0], s[1], s[2]) || 1; dst[0] = s[0] / l; dst[1] = s[1] / l; dst[2] = s[2] / l; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A point in the chest's frame (x forward, y along the spine) to the pelvis frame the IK works in.
function chestPt(P, x, y, z) {
  const fr = frame(P), l = P.lean * DEG, c = Math.cos(l), s = Math.sin(l);
  return [fr.chest[0] + x * c + y * s, fr.chest[1] - x * s + y * c, fr.chest[2] + z];
}

// Physics part half-lengths (PARTS order) and the depth each joint is drawn at when the ragdoll has the body.
const HH = [0, 0.22, 0.15, 0.15, 0.15, 0.15, 0.18, 0.18, 0.18, 0.18];

export class Animator {
  constructor(facing = 1) {
    this.pose = basePose();     // the settled pose (no flip / turn extras)
    this.final = basePose();    // with extras: what is solved
    this.loco = basePose();
    this.entry = basePose();
    this.kA = basePose(); this.kB = basePose();
    this.joints = new Float32Array(NJ * 3); // the animated pose, world
    this.flat = new Float32Array(NJ * 3);   // the same without spins and flips (targets for the physics limbs)
    this.phys = new Float32Array(NJ * 3);   // the ragdoll's joints
    this.out = new Float32Array(NJ * 3);    // what is drawn
    this.up = [0, 1, 0];                    // the held item's "up" (blade side), world
    this.clipName = null; this.clipT = 0; this.clipUp = null;
    this.run = 0; this.flipT = -1; this.landT = 0; this.turnT = 0; this.flinch = 0;
    this.lastFacing = facing; this.time = 0; this.rag = 0;
    this.started = false;
  }

  // c: { dt, facing, rootX, rootY (the physics pelvis), ground (floor distance below the pelvis, or null),
  //      grounded, ducking, wall, jet, dive (time or -1), vx, vy, th (aim as a limb angle), item, charge,
  //      grab, lineTh, swing ({ clip, t } or null), flip, land, hurt, ragdoll, parts (physics bodies) }
  update(c) {
    const dt = c.dt;
    this.time += dt;
    if (c.facing !== this.lastFacing) {
      if (this.rag < 0.5 && this.started) this.turnT = TURN;
      this.lastFacing = c.facing;
    }
    if (c.flip) this.flipT = 0;
    else if (this.flipT >= 0) {
      this.flipT += dt;
      if (this.flipT >= FLIP) this.flipT = -1;
      else if (c.grounded) {
        // Landed mid-somersault: hand what's left of the turn to the settling pose, which rights itself quickly.
        this.pose.roll = wrap180(this.pose.roll + 360 * ease(this.flipT / FLIP, 'io'));
        this.flipT = -1;
      }
    }
    if (c.land) this.landT = LAND;
    else if (this.landT > 0) this.landT = Math.max(0, this.landT - dt);
    if (this.turnT > 0) this.turnT = Math.max(0, this.turnT - dt);
    if (c.hurt) this.flinch = 0.22;
    else if (this.flinch > 0) this.flinch = Math.max(0, this.flinch - dt);

    this.locomotion(c, this.loco);
    const sw = c.swing, clip = sw && CLIPS[sw.clip];
    if (clip) {
      if (this.clipName !== sw.clip || sw.t < this.clipT) {
        copyPose(this.pose, this.entry);
        this.clipName = sw.clip;
        this.turnT = 0;
      }
      this.clipT = sw.t;
      this.evalClip(clip, sw.t, c, this.loco, this.pose);
    } else {
      if (this.clipName) {
        this.clipName = null; this.clipUp = null;
        this.pose.spin = wrap180(this.pose.spin); this.pose.roll = wrap180(this.pose.roll);
      }
      if (!this.started) copyPose(this.loco, this.pose);
      else blendPose(this.pose, this.loco, 1 - Math.exp(-RATE * dt), this.pose);
    }
    this.started = true;

    // Extras on top: the somersault, turning round, a flinch when hit.
    const F = copyPose(this.pose, this.final);
    if (this.flipT >= 0) F.roll += 360 * ease(this.flipT / FLIP, 'io');
    if (this.turnT > 0) F.spin += -180 * (1 - smooth(1 - this.turnT / TURN));
    if (this.flinch > 0) {
      const w = (this.flinch / 0.22) * 0.65;
      F.lean += (-16 - F.lean) * w * 0.7;
      const h = [-0.35, 1, 0];
      set3(F.head, lerp3(F.head, h, w));
    }

    this.solveAll(c.rootX, c.rootY, c.facing);
    this.weaponUp(F, c.facing);

    // The ragdoll takes over when the body goes loose, and hands back on recovery.
    this.physJoints(c.parts, c.facing);
    const wT = c.ragdoll ? 1 : 0;
    this.rag += (wT - this.rag) * (1 - Math.exp(-(wT > this.rag ? 16 : 7) * dt));
    if (this.rag > 0.6) this.poseFromPhys(c.facing);
    this.mix();
  }

  solveAll(x, y, facing) {
    const F = this.final;
    solve(F, x, y, facing, this.joints);
    const s = F.spin, r = F.roll, tl = F.tilt;
    F.spin = 0; F.roll = 0; F.tilt = 0;
    solve(F, x, y, facing, this.flat);
    F.spin = s; F.roll = r; F.tilt = tl;
  }

  mix() {
    const w = this.rag, o = this.out, a = this.joints, b = this.phys;
    if (w < 0.002) o.set(a);
    else for (let k = 0; k < o.length; k++) o[k] = a[k] + (b[k] - a[k]) * w;
  }

  // Re-place the same pose at a new root (after the physics step moved the body).
  place(x, y, facing, parts) {
    if (!this.started) return;
    this.solveAll(x, y, facing);
    this.physJoints(parts, facing);
    this.mix();
  }

  // ------------------------------------------------------------------ clips
  keyPose(key, c, base, out) {
    copyPose(base, out);
    for (const s of SCALARS) if (key[s] !== undefined) out[s] = val(key[s], c);
    for (const d of DIRS) if (key[d] !== undefined) set3(out[d], val(key[d], c));
    if (key.hF) armIK(out, 'F', val(key.hF, c));
    if (key.hB) armIK(out, 'B', val(key.hB, c));
    if ((key.fF || key.fB) && c.ground != null) {
      const fy = -c.ground - out.dy + FOOT_R;
      const res = (p) => { const v = val(p, c); return v ? [v[0], v[1] === 'g' ? fy : v[1], v[2]] : null; };
      legIK(out, key.fF ? res(key.fF) : null, key.fB ? res(key.fB) : null);
    }
    return out;
  }

  evalClip(clip, t, c, base, out) {
    const keys = clip.keys;
    let i = 0;
    while (i < keys.length && keys[i].t <= t) i++;
    if (i >= keys.length) {
      const k = keys[keys.length - 1];
      this.keyPose(k, c, base, out);
      this.clipUp = k.up || null;
      return;
    }
    const kb = keys[i];
    const A = i === 0 ? this.entry : this.keyPose(keys[i - 1], c, base, this.kA);
    const t0 = i === 0 ? 0 : keys[i - 1].t;
    const B = this.keyPose(kb, c, base, this.kB);
    const u = kb.t > t0 ? (t - t0) / (kb.t - t0) : 1;
    blendPose(A, B, ease(u, kb.ease), out);
    this.clipUp = kb.up || null;
  }

  // ------------------------------------------------------------------ locomotion
  locomotion(c, P) {
    copyPose(BASE, P);
    const f = c.facing;
    const vx = c.vx * f;                         // forward speed
    const sp = Math.min(1, Math.abs(vx) / RUN);
    const t = this.time;
    const g = c.ground;                          // floor distance below the pelvis (null in the air)
    let arms = 'guard';                          // how the free arms are held
    const squash = this.landT > 0 ? 0.14 * (this.landT / LAND) : 0;
    const footY = () => -g - P.dy + FOOT_R;

    if (c.dive >= 0) {
      const tuck = c.dive < 0.07;
      legIK(P, tuck ? [0.2, -0.3, 0.1] : [0.06, -0.74, 0.1], tuck ? [0.1, -0.35, -0.1] : [-0.06, -0.72, -0.1]);
      sd(P.uaF, 165, 35); sd(P.laF, 175, 25); sd(P.uaB, 165, -35); sd(P.laB, 175, -25);
      arms = 'set';
    } else if (c.grounded && g != null && c.ducking) {
      // Crouch: chest over the knees, a shuffle when moving.
      P.lean = 60 + 5 * sp; P.twist = 10; P.dy = -0.1 - squash * 0.3;
      set3(P.head, [1.4, 1, 0]);
      if (sp > 0.05) this.run += Math.abs(vx) * c.dt * 9;
      const sh = sp > 0.05 ? Math.sin(this.run) * 0.1 : 0, lf = sp > 0.05 ? Math.max(0, Math.cos(this.run)) * 0.06 : 0;
      const y = footY();
      legIK(P, [0.27 + sh, y + lf, 0.14], [-0.13 - sh, y + Math.max(0, -Math.cos(this.run)) * 0.06 * (sp > 0.05), -0.14]);
      arms = 'low';
    } else if (c.grounded && g != null && sp > 0.12) {
      // Run: feet planted and pushed back along the floor, then swung through high; arms pump against them.
      const S = 0.12 + 0.34 * sp, lift = 0.1 + 0.2 * sp, sf = 0.5 - 0.14 * sp;
      this.run = (this.run + (Math.PI * Math.abs(vx) * sf * c.dt) / S) % TAU;
      const ph = this.run;
      P.lean = 5 + 14 * sp; P.twist = 6;
      P.dy = -0.06 - 0.035 * sp + 0.03 * sp * Math.cos(2 * ph) - squash;
      set3(P.head, [0.12 + 0.15 * sp, 1, 0]);
      const y = footY();
      const foot = (phase, z) => {
        const u = (((phase / TAU) % 1) + 1) % 1;
        if (u < sf) return [0.05 + S - 2 * S * (u / sf), y, z];
        const s = (u - sf) / (1 - sf);
        return [0.05 - S + 2 * S * smooth(s), y + lift * Math.sin(Math.PI * s) + lift * 0.6 * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s), z];
      };
      legIK(P, foot(ph, 0.1), foot(ph + Math.PI, -0.1));
      this.pumpA = -48 * (0.4 + 0.6 * sp) * Math.cos(ph);
      arms = 'pump';
    } else if (c.grounded && g != null) {
      // Fighting stance: near foot forward, weight low, a slow breath.
      P.lean = 7; P.twist = 14;
      P.dy = -0.09 + 0.012 * Math.sin(t * 2.4) - squash;
      set3(P.head, [0.1, 1, 0]);
      const y = footY();
      legIK(P, [0.2, y, 0.11], [-0.2, y, -0.11]);
    } else if (c.wall) {
      // On a wall: feet against it, the near hand on it above, leaning out.
      const ws = c.wall * f;
      P.lean = -6 * ws;
      legIK(P, [0.3 * ws, -0.3, 0.12], [0.26 * ws, -0.62, -0.12]);
      armIK(P, 'F', chestPt(P, 0.27 * ws, 0.24, 0.16), [-ws, -0.6, 0.5]);
      sd(P.uaB, -95 * ws, -35); sd(P.laB, -120 * ws, -30);
      arms = 'set';
    } else if (c.jet) {
      P.lean = 10;
      legIK(P, [0.08, -0.7, 0.1], [-0.1, -0.66, -0.1]);
      arms = 'air';
    } else if (this.flipT >= 0) {
      // Double jump: tucked tight for the somersault.
      legIK(P, [0.26, -0.28, 0.12], [0.18, -0.32, -0.12]);
      sd(P.uaF, 70, 25); sd(P.laF, 105, 10); sd(P.uaB, 70, -25); sd(P.laB, 105, -10);
      set3(P.head, [0.3, 1, 0]);
      arms = 'tuck';
    } else {
      // Rising: knees up, arms thrown up. Falling: legs reaching for the floor, arms out wide for balance.
      const v = Math.max(0, Math.min(1, (c.vy + 2) / 10));
      P.lean = 4 + 10 * sp;
      legIK(P, lerp3([0.15, -0.66, 0.12], [0.22, -0.42, 0.11], v), lerp3([-0.16, -0.6, -0.12], [-0.02, -0.5, -0.11], v));
      this.airV = v;
      arms = 'air';
    }

    // Arms: what's in hand decides the near arm; the far arm follows the body unless the item needs both.
    const it = c.item;
    const near = (ua, la) => { set3(P.uaF, ua); set3(P.laF, la); };
    const far = (ua, la) => { set3(P.uaB, ua); set3(P.laB, la); };
    const freeArms = () => {
      if (arms === 'guard' || arms === 'low') {
        const lo = arms === 'low' ? -0.06 : 0;
        armIK(P, 'F', chestPt(P, 0.3, 0.1 + lo, 0.17), [-0.2, -1, 0.5]);
        armIK(P, 'B', chestPt(P, 0.2, 0.14 + lo, -0.02), [-0.2, -1, -0.3]);
      } else if (arms === 'pump') {
        const a = this.pumpA;
        near(dir(a, 16), dir(a + 95, 8)); far(dir(-a, -16), dir(-a + 95, -8));
      } else if (arms === 'air') {
        const v = this.airV ?? 0;
        near(lerp3(dir(100, 60), dir(140, 25), v), lerp3(dir(118, 50), dir(165, 15), v));
        far(lerp3(dir(95, -60), dir(110, -35), v), lerp3(dir(112, -50), dir(140, -25), v));
      }
    };
    if (arms === 'set') return;
    freeArms();
    if (arms === 'tuck' && !it) return;
    const th = c.th;
    if (c.grab) { near(dir(th, -4), dir(th, -4)); return; }
    if (c.lineTh != null) { near(dir(c.lineTh, -4), dir(c.lineTh, -4)); return; }
    if (!it) return;
    const bob = arms === 'pump' ? Math.sin(this.run * 2) * 6 : Math.sin(t * 2.4) * 2;
    const charging = c.charge > 0.12;
    switch (it) {
      case 'axe':
        if (charging) near(D(160, 175), D(150, 178));
        else near(dir(35 + bob, 35), dir(148 + bob, 12));
        break;
      case 'hammer':
        if (charging) { near(dir(-160, 10), dir(-130, 5)); far(dir(-150, -5), dir(-125, 10)); }
        else { near(dir(60 + bob, 30), dir(-160 + bob, 10)); if (arms === 'guard' || arms === 'low') far(dir(55, 0), dir(-170, 20)); }
        break;
      case 'sword':
        if (charging) near(dir(-35, 20), dir(th, 6));
        else { near(dir(th * 0.5 + 32 + bob * 0.5, 20), dir(th + bob * 0.3, 2)); if (arms !== 'pump') far(dir(-110, -25), dir(-160, -20)); }
        break;
      case 'bombs':
        if (charging) near(dir(150, -140), dir(165, -170));
        else near(dir(20, 25), dir(75, 10));
        break;
      case 'blunderbuss': case 'rocket': {
        near(dir(th, -6), dir(th, -6));
        // The far hand holds the barrel, out along the near forearm.
        const fr = frame(P), sh = fr.shoF;
        const tgt = [sh[0] + P.uaF[0] * 0.3 + P.laF[0] * 0.2, sh[1] + P.uaF[1] * 0.3 + P.laF[1] * 0.2, sh[2] + P.uaF[2] * 0.3 + P.laF[2] * 0.2 - 0.04];
        armIK(P, 'B', tgt, [0, -1, -0.4]);
        break;
      }
      case 'jetpack': break;
      default:
        near(dir(th, -4), dir(th, -4));
    }
  }

  // ------------------------------------------------------------------ outputs
  weaponUp(F, facing) {
    // The held item's blade side: a clip can set it (flat swings); otherwise square to the forearm in the
    // side view.
    const la = F.laF;
    let u = this.clipUp;
    if (!u) {
      u = [-la[1], la[0], 0];
      if (Math.hypot(u[0], u[1]) < 0.2) u = [0, 1, 0];
    }
    const w = worldDir(F, u, facing, [0, 0, 0]);
    this.up[0] = w[0]; this.up[1] = w[1]; this.up[2] = w[2];
  }

  // The ragdoll's joints from the physics parts.
  physJoints(parts, facing) {
    const o = this.phys;
    const top = (k) => { const p = parts[k], s = Math.sin(p[2]), c = Math.cos(p[2]); return [p[0] - s * HH[k], p[1] + c * HH[k]]; };
    const bot = (k) => { const p = parts[k], s = Math.sin(p[2]), c = Math.cos(p[2]); return [p[0] + s * HH[k], p[1] - c * HH[k]]; };
    const put = (j, v, z) => { o[j * 3] = v[0]; o[j * 3 + 1] = v[1]; o[j * 3 + 2] = z; };
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    put(J.PELVIS, bot(1), 0); put(J.CHEST, top(1), 0); put(J.HEAD, [parts[0][0], parts[0][1]], 0);
    put(J.SHO_B, top(2), -LEN.shoulder); put(J.ELB_B, mid(bot(2), top(3)), -0.17); put(J.HAND_B, bot(3), -0.17);
    put(J.SHO_F, top(4), LEN.shoulder); put(J.ELB_F, mid(bot(4), top(5)), 0.17); put(J.HAND_F, bot(5), 0.17);
    put(J.HIP_B, top(6), -LEN.hip); put(J.KNEE_B, mid(bot(6), top(7)), -0.1); put(J.FOOT_B, bot(7), -0.1);
    put(J.HIP_F, top(8), LEN.hip); put(J.KNEE_F, mid(bot(8), top(9)), 0.1); put(J.FOOT_F, bot(9), 0.1);
  }

  // While the ragdoll has the body, keep the pose matched to it, so getting up starts from where it lies.
  poseFromPhys(facing) {
    const o = this.phys, P = this.pose;
    const d = (a, b) => [(o[b * 3] - o[a * 3]) * facing, o[b * 3 + 1] - o[a * 3 + 1], o[b * 3 + 2] - o[a * 3 + 2]];
    const sp = d(J.PELVIS, J.CHEST);
    P.lean = Math.atan2(sp[0], sp[1]) / DEG;
    P.twist = 0; P.spin = 0; P.roll = 0; P.tilt = 0; P.dx = 0; P.dy = 0;
    set3(P.head, d(J.CHEST, J.HEAD));
    set3(P.uaF, d(J.SHO_F, J.ELB_F)); set3(P.laF, d(J.ELB_F, J.HAND_F));
    set3(P.uaB, d(J.SHO_B, J.ELB_B)); set3(P.laB, d(J.ELB_B, J.HAND_B));
    set3(P.thF, d(J.HIP_F, J.KNEE_F)); set3(P.shF, d(J.KNEE_F, J.FOOT_F));
    set3(P.thB, d(J.HIP_B, J.KNEE_B)); set3(P.shB, d(J.KNEE_B, J.FOOT_B));
    this.flipT = -1; this.turnT = 0;
  }
}
