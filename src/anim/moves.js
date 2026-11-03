// The move library: keyframed clips for every attack. A clip's keys are partial poses (any field not given
// comes from the locomotion underneath, so a jab while running keeps the legs running); fields can be functions
// of the move's context c (c.th is the aim as a limb angle: 90 = level forward, 180 = straight up).
//
// Hits are capsules on the posed skeleton during a window: seg names a limb (armF/armB/legF/legB, feet = both
// feet, weapon = from the near hand along the forearm for `reach`). Hit points come from the same 3D pose that
// is drawn, projected onto the play plane, so what you see is what lands.
//
// Pose directions: dir(th, side) is th degrees from straight down in the side view (forward positive, 90 level,
// 180 up, negative behind), tipped `side` degrees toward the camera. D(pitch, yaw) is a full sphere direction
// (yaw 0 forward, 90 toward the camera, -90 away, 180 behind) for arcs that sweep through depth.
import { D, DEG } from './skeleton.js';
import { MAT } from '../core/consts.js';

export const dir = (th, side = 0) => {
  const t = th * DEG, s = side * DEG;
  return [Math.sin(t) * Math.cos(s), -Math.cos(t) * Math.cos(s), Math.sin(s)];
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const A = (off = 0, side = 0) => (c) => dir(c.th + off, side);              // along the aim
const K = (off = 0, side = 0, lo = 62, hi = 118) => (c) => dir(clamp(c.th, lo, hi) + off, side); // a kick line

// Guard hands (used at the ends of clips so they settle back toward the stance).
const GUARD = { uaF: dir(40, 32), laF: dir(158, 8), uaB: dir(35, -12), laB: dir(162, 4) };

const BL = {
  punch: { [MAT.GLASS]: 12, def: 0 },
  heavy: { [MAT.GLASS]: 40, [MAT.WOOD]: 10, def: 3 },
  slam: { [MAT.GLASS]: 40, [MAT.WOOD]: 22, [MAT.ICE]: 30, def: 14 },
  kick: { [MAT.GLASS]: 20, def: 2 },
  axe: { [MAT.WOOD]: 30, [MAT.ICE]: 20, [MAT.GLASS]: 40, def: 6 },
  sword: { [MAT.GLASS]: 40, [MAT.ICE]: 12, def: 0 },
  hammer: { def: 34, [MAT.IRON]: 22 },
};

// knock: [x, y] in the attacker's frame (x away from them), or 'radial' (away from the attacker's centre),
// 'trip' (feet swept: up and a little away), 'slam' (spikes fliers, crumples standers).
export const CLIPS = {
  // ------------------------------------------------------------------ bare hands
  // Jab: the near fist snaps straight out along the aim, shoulder turned in behind it.
  jab: {
    kind: 'punch', dur: 0.2, upper: true, move: 0.75, cancel: 0.13,
    keys: [
      { t: 0.03, twist: 0, lean: 6, uaF: dir(30, 30), laF: dir(150, 10) },
      { t: 0.075, ease: 'out', twist: 40, lean: 14, dx: 0.05, uaF: A(0, -6), laF: A(0, -6), uaB: dir(30, -10), laB: dir(165, 8), head: [0.15, 1, 0] },
      { t: 0.13 },
      { t: 0.2, twist: 15, lean: 8, dx: 0, uaF: dir(48, 30), laF: dir(150, 6) },
    ],
    hits: [{ t0: 0.06, t1: 0.13, seg: 'armF', ext: 0.07, r: 0.11, dmg: 8, knock: [8, 3], poise: 0.5, blocks: BL.punch }],
    push: [{ t: 0.04, x: 1.8 }],
  },
  // Cross: the far fist, hips and shoulders turned right through.
  cross: {
    kind: 'punch', dur: 0.26, upper: true, move: 0.6, cancel: 0.17,
    keys: [
      { t: 0.035, twist: 22, lean: 6, uaB: dir(25, -10), laB: dir(150, -5) },
      { t: 0.09, ease: 'out', twist: -48, lean: 18, dx: 0.08, uaB: A(0, 10), laB: A(0, 12), uaF: dir(40, 30), laF: dir(165, 0), head: [0.2, 1, 0] },
      { t: 0.16 },
      { t: 0.26, twist: 5, lean: 8, dx: 0, uaB: dir(40, -20), laB: dir(150, -10) },
    ],
    hits: [{ t0: 0.055, t1: 0.16, seg: 'armB', ext: 0.08, r: 0.14, dmg: 10, knock: [10, 3], poise: 0.55, blocks: BL.punch }],
    push: [{ t: 0.05, x: 2.6 }],
  },
  // Hook: the near arm comes round from the side, through depth, into the jaw. Ends the combo.
  hook: {
    kind: 'punch', dur: 0.36, upper: true, move: 0.4,
    keys: [
      { t: 0.06, twist: -38, lean: 4, uaF: D(95, 112), laF: D(90, 25) },
      { t: 0.15, ease: 'out', twist: 55, lean: 16, dx: 0.06, uaF: D(98, 28), laF: D(95, -38), uaB: dir(30, -20), laB: dir(165, -5) },
      { t: 0.22, twist: 65, uaF: D(98, 0), laF: D(95, -70) },
      { t: 0.36, twist: 18, lean: 8, dx: 0, ...GUARD },
    ],
    hits: [{ t0: 0.08, t1: 0.2, seg: 'armF', ext: 0.1, r: 0.17, dmg: 15, knock: [11, 7], poise: 0.9, blocks: BL.punch }],
    push: [{ t: 0.07, x: 3 }],
  },
  // Superman punch: in the air, the body lays out behind a fist thrown along the aim.
  airpunch: {
    kind: 'punch', dur: 0.36, move: 1, cancel: 0.3,
    keys: [
      { t: 0.05, lean: 4, uaF: dir(30, 30), laF: dir(140, 10), thF: dir(-15), shF: dir(-45), thB: dir(25), shB: dir(-20) },
      { t: 0.11, ease: 'out', lean: (c) => clamp(c.th - 40, 20, 70), twist: 30, uaF: A(0, -5), laF: A(0, -5), uaB: dir(-75, -25), laB: dir(-60, -15), thF: dir(-28), shF: dir(-55), thB: dir(-12), shB: dir(-28), head: [0.3, 1, 0] },
      { t: 0.27 },
      { t: 0.36, lean: 10, twist: 10, ...GUARD },
    ],
    hits: [{ t0: 0.07, t1: 0.28, seg: 'armF', ext: 0.08, r: 0.15, dmg: 11, knock: [10, 4], poise: 0.6, blocks: BL.punch }],
    push: [{ t: 0.06, aim: 8, set: 'exact' }],
  },
  // Haymaker: the far fist cocks up behind the head and comes over the top with the whole body behind it.
  haymaker: {
    kind: 'haymaker', dur: 0.5, move: 0.25,
    keys: [
      { t: 0.14, twist: 35, lean: -12, dy: 0.02, uaB: D(150, -150), laB: D(155, -175), uaF: dir(80, 40), laF: dir(110, 30), head: [-0.1, 1, 0], fF: [0.3, 'g', 0.12], fB: [-0.3, 'g', -0.12] },
      { t: 0.22, ease: 'out', twist: -55, lean: 32, dx: 0.12, dy: -0.06, uaB: A(-8, 12), laB: A(-12, 10), uaF: dir(20, 30), laF: dir(60, 20), head: [0.3, 1, 0], fF: [0.45, 'g', 0.12], fB: [-0.32, 'g', -0.12] },
      { t: 0.32, lean: 36 },
      { t: 0.5, twist: 0, lean: 10, dx: 0, dy: 0, ...GUARD },
    ],
    hits: [{ t0: 0.16, t1: 0.3, seg: 'armB', ext: 0.12, r: 0.21, dmg: 24, knock: [14, 6], poise: 1, blocks: BL.heavy }],
    push: [{ t: 0.15, x: 4.5, y: 0.6 }],
  },
  // Uppercut: dip, then the near fist drives straight up the middle with the legs behind it.
  uppercut: {
    kind: 'uppercut', dur: 0.4, move: 0.2,
    keys: [
      { t: 0.07, twist: -20, lean: 25, dy: -0.12, uaF: dir(15, 25), laF: dir(70, 10), fF: [0.25, 'g', 0.12], fB: [-0.22, 'g', -0.12] },
      { t: 0.16, ease: 'out', twist: 40, lean: -6, dx: 0.1, dy: 0.06, uaF: dir(145, 0), laF: dir(165, -5), uaB: dir(30, -20), laB: dir(120, -10), head: [-0.15, 1, 0] },
      { t: 0.24 },
      { t: 0.4, twist: 10, lean: 6, dx: 0, dy: 0, ...GUARD },
    ],
    hits: [{ t0: 0.08, t1: 0.2, seg: 'armF', ext: 0.1, r: 0.2, dmg: 15, knock: [4, 15], poise: 0.85, blocks: BL.heavy }],
    push: [{ t: 0.07, x: 2.6, y: 4, ya: 6 }],
  },
  // Slam: both fists overhead, then down together into whatever is in front and below. Digs.
  slam: {
    kind: 'slam', dur: 0.44, move: 0.1,
    keys: [
      { t: 0.12, lean: -12, dy: 0.04, uaF: dir(170, 15), laF: dir(178, 5), uaB: dir(170, -15), laB: dir(178, -5), head: [-0.1, 1, 0] },
      { t: 0.21, ease: 'in', lean: 48, dy: -0.18, uaF: dir(72, 6), laF: dir(48, -12), uaB: dir(72, -6), laB: dir(48, 12), head: [0.4, 1, 0], fF: [0.3, 'g', 0.13], fB: [-0.25, 'g', -0.13] },
      { t: 0.3 },
      { t: 0.44, lean: 10, dy: 0, ...GUARD },
    ],
    hits: [{ t0: 0.15, t1: 0.27, seg: 'armF', ext: 0.12, r: 0.25, dmg: 16, knock: 'slam', poise: 1, blocks: BL.slam }],
  },
  // Front kick: the knee chambers, then the near leg drives out straight along the kick line.
  kick: {
    kind: 'kick', dur: 0.4, move: 0.15, cancel: 0.3,
    keys: [
      { t: 0.07, lean: -8, twist: -10, thF: dir(100), shF: dir(-15), fB: [-0.12, 'g', -0.1], ...GUARD },
      { t: 0.13, ease: 'out', lean: -26, twist: -18, dx: 0.12, thF: K(-6), shF: K(-6), fB: [-0.3, 'g', -0.1], uaF: dir(60, 40), laF: dir(150, 20), uaB: dir(70, -40), laB: dir(140, -20) },
      { t: 0.22 },
      { t: 0.3, lean: -10, thF: dir(100), shF: dir(-10) },
      { t: 0.4, lean: 4, twist: 0, dx: 0 },
    ],
    hits: [{ t0: 0.08, t1: 0.22, seg: 'legF', ext: 0.12, r: 0.18, dmg: 11, knock: [13, 4], trip: true, poise: 0.75, blocks: BL.kick }],
    push: [{ t: 0.08, x: 2.2 }],
  },
  // Roundhouse: aimed high. The hips turn over and the near leg whips round from the side, through depth.
  roundhouse: {
    kind: 'kick', dur: 0.46, move: 0.1,
    keys: [
      { t: 0.09, spin: -30, lean: -6, thF: D(100, 100), shF: D(50, 165), fB: [-0.05, 'g', -0.05], uaF: dir(80, 50), laF: dir(130, 40), uaB: dir(60, -40), laB: dir(130, -30) },
      { t: 0.16, ease: 'out', spin: 10, lean: -30, tilt: -12, dx: 0.1, thF: D(112, 4), shF: D(112, 0), uaF: dir(40, 60), laF: dir(100, 50), uaB: dir(-50, -40), laB: dir(-30, -30), head: [-0.2, 1, 0] },
      { t: 0.24, spin: 30, thF: D(110, -38), shF: D(108, -48) },
      { t: 0.46, spin: 0, lean: 4, tilt: 0, dx: 0, thF: dir(10), shF: dir(0), ...GUARD },
    ],
    hits: [{ t0: 0.1, t1: 0.23, seg: 'legF', ext: 0.12, r: 0.2, dmg: 16, knock: [11, 9], poise: 0.9, blocks: BL.kick }],
    push: [{ t: 0.1, x: 2.2 }],
  },
  // Leg sweep: down low, the near leg out flat along the floor, and a full turn: it takes the feet from
  // anyone close, in front or behind.
  sweep: {
    kind: 'kick', dur: 0.5, move: 0, crouch: true,
    keys: [
      { t: 0.07, dy: -0.06, dx: 0.08, lean: 12, thF: dir(84), shF: dir(88), fB: [-0.08, 'g', -0.12], uaF: dir(-20, 30), laF: dir(-10, 20), uaB: dir(-25, -30), laB: dir(-10, -20), head: [0.2, 1, 0] },
      { t: 0.4, ease: 'out', spin: -360 },
      { t: 0.5 },
    ],
    hits: [{ t0: 0.08, t1: 0.4, seg: 'legF', ext: 0.16, r: 0.2, dmg: 9, knock: 'trip', poise: 1, blocks: BL.kick }],
  },
  // Flying kick: off the ground at a run (or any kick in the air): the near leg out, the other tucked.
  flykick: {
    kind: 'kick', dur: 0.5, move: 0.6,
    keys: [
      { t: 0.06, lean: -10, thF: dir(110), shF: dir(10), thB: dir(70), shB: dir(-20), uaF: dir(100, 50), laF: dir(130, 40), uaB: dir(-60, -30), laB: dir(-30, -20) },
      { t: 0.12, ease: 'out', lean: -30, tilt: -10, thF: K(-5, 0, 70, 110), shF: K(-5, 0, 70, 110), thB: dir(62), shB: dir(-60), uaF: dir(80, 50), laF: dir(110, 40), uaB: dir(-80, -40), laB: dir(-60, -30), head: [-0.1, 1, 0] },
      { t: 0.4 },
      { t: 0.5, lean: 0, tilt: 0 },
    ],
    hits: [{ t0: 0.07, t1: 0.38, seg: 'legF', ext: 0.1, r: 0.2, dmg: 14, knock: [14, 5], poise: 0.9, blocks: BL.kick }],
    push: [{ t: 0.06, x: 7, y: 5, ya: 2, leap: true }],
  },
  // Dropkick: both feet first, laid out flat behind them. Huge, and you land on your back.
  dropkick: {
    kind: 'dropkick', dur: 0.7, move: 0.3, fall: 0.42,
    keys: [
      { t: 0.06, lean: -20, thF: dir(115, 5), shF: dir(15), thB: dir(115, -5), shB: dir(15), uaF: dir(120, 40), laF: dir(150, 30), uaB: dir(120, -40), laB: dir(150, -30) },
      { t: 0.14, ease: 'out', lean: -78, thF: dir(92, 6), shF: dir(92, 4), thB: dir(92, -6), shB: dir(92, -4), uaF: dir(-150, 40), laF: dir(-160, 30), uaB: dir(-150, -40), laB: dir(-160, -30), head: [-0.3, 1, 0] },
      { t: 0.4 },
      { t: 0.7, lean: -60 },
    ],
    hits: [{ t0: 0.07, t1: 0.42, seg: 'feet', ext: 0.12, r: 0.3, dmg: 20, knock: [20, 7], poise: 1, blocks: BL.heavy }],
    push: [{ t: 0.06, x: 13, y: 5, ya: 2.5, set: true, leap: true }],
  },
  // Throw: the arm goes back over the shoulder and whips through; the item leaves the hand at the top of it.
  throw: {
    kind: 'throw', dur: 0.34, upper: true, move: 0.6, events: [{ t: 0.14, ev: 'throw' }],
    keys: [
      { t: 0.1, twist: 35, lean: -12, uaF: D(150, -140), laF: D(165, -170), uaB: dir(90, -40), laB: dir(100, -30) },
      { t: 0.16, ease: 'out', twist: -35, lean: 18, uaF: A(8, -5), laF: A(4, -5), uaB: dir(-40, -20), laB: dir(-20, -10) },
      { t: 0.34, twist: 0, lean: 6 },
    ],
  },
  // A gun's kick.
  recoil: {
    kind: 'recoil', dur: 0.18, upper: true, move: 1,
    keys: [
      { t: 0.03, ease: 'out', lean: -10, uaF: A(22, -4), laF: A(30, -4) },
      { t: 0.18, lean: 0, uaF: A(0, -4), laF: A(0, -4) },
    ],
  },

  // ------------------------------------------------------------------ axe
  // Chop: up behind the head and down through the front in one big vertical arc.
  axeChop: {
    kind: 'axe', dur: 0.38, move: 0.3, cancel: 0.27,
    keys: [
      { t: 0.08, twist: 25, lean: -12, uaF: D(160, 175), laF: D(150, 178), uaB: dir(90, -30), laB: dir(120, -20) },
      { t: 0.12, ease: 'in', twist: 5, lean: 4, uaF: dir(172, 8), laF: dir(176, 4) },
      { t: 0.17, ease: 'out', twist: -25, lean: 26, dy: -0.06, uaF: A(-15, 10), laF: A(-25, 5), uaB: dir(30, -30), laB: dir(100, -20), fF: [0.35, 'g', 0.12], fB: [-0.28, 'g', -0.12] },
      { t: 0.24 },
      { t: 0.38, lean: 6, twist: 10, dy: 0 },
    ],
    hits: [{ t0: 0.09, t1: 0.24, seg: 'weapon', reach: 0.95, r: 0.16, dmg: 26, knock: [9, 4], blocks: BL.axe }],
    push: [{ t: 0.09, x: 2.5 }],
  },
  // Backhand: flat across the front, from behind the far shoulder round toward the camera.
  axeBack: {
    kind: 'axe', dur: 0.38, move: 0.3, cancel: 0.27,
    keys: [
      { t: 0.07, twist: -45, lean: 5, uaF: D(95, -110), laF: D(95, -120), uaB: dir(60, -50), laB: dir(120, -40), up: [0, 0, 1] },
      { t: 0.17, ease: 'out', twist: 45, lean: 14, uaF: D(95, 40), laF: D(92, 55) },
      { t: 0.24, twist: 55, uaF: D(95, 80), laF: D(92, 95) },
      { t: 0.38, twist: 10, lean: 6 },
    ],
    hits: [{ t0: 0.09, t1: 0.2, seg: 'weapon', reach: 0.95, r: 0.16, dmg: 22, knock: [10, 5], blocks: BL.axe }],
    push: [{ t: 0.08, x: 3 }],
  },
  // Whirl: arm out, two full turns: the axe goes all the way round you, front and back.
  axeWhirl: {
    kind: 'axe', dur: 0.75, move: 0.55, heavy: true,
    keys: [
      { t: 0.08, dy: -0.08, lean: 10, tilt: 16, twist: -30, uaF: D(98, 28), laF: D(96, 22), uaB: dir(30, -20), laB: dir(150, 30), head: [0.15, 1, 0], fF: [0.3, 'g', 0.15], fB: [-0.3, 'g', -0.15], up: [0, 0, -1] },
      { t: 0.62, ease: 'io', spin: -720 },
      { t: 0.75, dy: 0, twist: 0, tilt: 0, lean: 6 },
    ],
    hits: [{ t0: 0.1, t1: 0.62, seg: 'weapon', reach: 0.95, r: 0.17, dmg: 16, knock: 'radial', every: 0.22, blocks: BL.axe }],
  },
  // In the air: a somersault with the axe overhead, so it cuts a full circle round you.
  axeFlip: {
    kind: 'axe', dur: 0.45, move: 1,
    keys: [
      { t: 0.05, lean: 0, uaF: dir(175, 10), laF: dir(178, 5), uaB: dir(160, -20), laB: dir(170, -10), thF: dir(80), shF: dir(-10), thB: dir(70), shB: dir(-20) },
      { t: 0.42, ease: 'io', roll: 360 },
      { t: 0.45 },
    ],
    hits: [{ t0: 0.06, t1: 0.42, seg: 'weapon', reach: 0.95, r: 0.17, dmg: 20, knock: [9, 3], blocks: BL.axe }],
    push: [{ t: 0.05, x: 3.5, y: 5, set: 'exact' }],
  },

  // ------------------------------------------------------------------ sword
  // Thrust: the arm and blade drive straight out along the aim (high, middle or low), a step in behind it.
  thrust: {
    kind: 'sword', dur: 0.3, move: 0.4, cancel: 0.2,
    keys: [
      { t: 0.05, lean: 4, twist: -15, uaF: dir(25, 25), laF: A(0, 10), fF: [0.25, 'g', 0.12], fB: [-0.25, 'g', -0.12] },
      { t: 0.1, ease: 'out', lean: 16, twist: 35, dx: 0.1, uaF: A(0, -4), laF: A(0, -4), uaB: dir(-110, -30), laB: dir(-150, -20), fF: [0.5, 'g', 0.12], fB: [-0.3, 'g', -0.12] },
      { t: 0.18 },
      { t: 0.3, lean: 6, twist: 10, dx: 0 },
    ],
    hits: [{ t0: 0.06, t1: 0.18, seg: 'weapon', reach: 1.55, r: 0.12, dmg: 24, knock: [10, 3], blocks: BL.sword }],
    push: [{ t: 0.06, x: 3 }],
  },
  // Slash: a flat cut across the front, through depth.
  slash: {
    kind: 'sword', dur: 0.34, move: 0.35, cancel: 0.24,
    keys: [
      { t: 0.06, twist: -45, lean: 5, uaF: D(100, -115), laF: D(98, -125), uaB: dir(80, -50), laB: dir(120, -40), up: [0, 0, 1] },
      { t: 0.14, ease: 'out', twist: 50, lean: 14, uaF: D(100, 45), laF: D(96, 60) },
      { t: 0.2, twist: 60, uaF: D(100, 85), laF: D(96, 100) },
      { t: 0.34, twist: 10, lean: 6 },
    ],
    hits: [{ t0: 0.07, t1: 0.17, seg: 'weapon', reach: 1.55, r: 0.13, dmg: 22, knock: [10, 5], blocks: BL.sword }],
    push: [{ t: 0.07, x: 2.5 }],
  },
  // Lunge: low and long, the whole body thrown in behind the point.
  lunge: {
    kind: 'sword', dur: 0.5, move: 0.1, heavy: true,
    keys: [
      { t: 0.1, dy: -0.12, lean: 10, twist: -20, uaF: dir(30, 25), laF: A(0, 8), fF: [0.3, 'g', 0.12], fB: [-0.35, 'g', -0.12] },
      { t: 0.16, ease: 'out', dy: -0.2, lean: 30, twist: 40, dx: 0.15, uaF: A(0, -4), laF: A(0, -4), uaB: dir(-95, -20), laB: dir(-95, -10), fF: [0.65, 'g', 0.12], fB: [-0.5, 'g', -0.12] },
      { t: 0.38 },
      { t: 0.5, dy: 0, lean: 8, twist: 10, dx: 0 },
    ],
    hits: [{ t0: 0.11, t1: 0.38, seg: 'weapon', reach: 1.55, r: 0.13, dmg: 34, knock: [12, 4], blocks: BL.sword }],
    push: [{ t: 0.1, aim: 9, y: 2 }],
  },

  // ------------------------------------------------------------------ hammer
  // Smash: two hands, from far behind, over the top and into the floor.
  smash: {
    kind: 'hammer', dur: 0.62, move: 0.1, events: [{ t: 0.3, ev: 'pound' }],
    keys: [
      { t: 0.18, lean: -18, twist: 25, dy: 0.03, uaF: D(150, 178), laF: D(130, 179), uaB: D(140, 172), laB: D(122, 176), head: [-0.15, 1, 0], fF: [0.3, 'g', 0.13], fB: [-0.3, 'g', -0.13] },
      { t: 0.24, ease: 'in', lean: 10, twist: 5, dy: 0, uaF: dir(170, 8), laF: dir(178, 4), uaB: dir(170, -4), laB: dir(178, 8) },
      { t: 0.29, ease: 'out', lean: 42, twist: -15, dy: -0.18, uaF: dir(65, 10), laF: dir(50, 5), uaB: dir(66, -4), laB: dir(55, 14), head: [0.4, 1, 0], fF: [0.42, 'g', 0.13] },
      { t: 0.4 },
      { t: 0.62, lean: 8, twist: 10, dy: 0 },
    ],
    hits: [{ t0: 0.2, t1: 0.36, seg: 'weapon', reach: 1.15, r: 0.26, dmg: 30, knock: [17, 3], blocks: BL.hammer }],
  },
  // Spin: the hammer thrower's turn, twice round, heavy and wide.
  hammerSpin: {
    kind: 'hammer', dur: 0.9, move: 0.35, heavy: true,
    keys: [
      { t: 0.12, dy: -0.1, lean: -8, tilt: 20, uaF: D(100, 20), laF: D(98, 12), uaB: D(100, 8), laB: D(98, 14), fF: [0.3, 'g', 0.16], fB: [-0.3, 'g', -0.16], up: [0, 0, -1] },
      { t: 0.78, ease: 'io', spin: -720 },
      { t: 0.9, dy: 0, tilt: 0, lean: 0 },
    ],
    hits: [{ t0: 0.16, t1: 0.78, seg: 'weapon', reach: 1.15, r: 0.26, dmg: 22, knock: 'radial', every: 0.3, blocks: BL.hammer }],
  },
};

// Fill each key forward from the one before (a key only states what changes), and note every field a clip
// touches.
const FIELDS = ['lean', 'twist', 'spin', 'roll', 'dx', 'dy', 'tilt', 'head', 'uaF', 'laF', 'uaB', 'laB', 'thF', 'shF', 'thB', 'shB', 'hF', 'hB', 'fF', 'fB', 'up'];
for (const [name, c] of Object.entries(CLIPS)) {
  c.name = name;
  let prev = {};
  for (const k of c.keys) {
    for (const f of FIELDS) if (k[f] === undefined && prev[f] !== undefined) k[f] = prev[f];
    prev = k;
  }
  c.cancel = c.cancel ?? c.dur;
  c.move = c.move ?? 1;
  c.hits = c.hits || [];
  c.push = c.push || [];
  c.events = c.events || [];
  c.lastHit = c.hits.reduce((m, h) => Math.max(m, h.t1), 0);
  c.firstHit = c.hits.reduce((m, h) => Math.min(m, h.t0), c.dur);
}
export { FIELDS };
