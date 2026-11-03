// The move reel's scenes (shared by ?reel=1 in the game and tools/dev/poses.mjs).
import { ATK, NO_DIR, dirToByte, FIGHTER_HP } from '../core/consts.js';

export const R = Math.PI / 180;
export const ME = 0, DUMMY = 3, DUMMY2 = 5;

// Each scene: what to show, a short line on how, the kit, where the dummy stands, and a script of inputs by
// step (60 a second). press(at, atk, dirDeg) presses Action; hold ranges hold the stick.
export const SCENES = [
  { id: 'intro', name: 'Splinterhall · moves', how: 'Prototype 4 · every animation, against a training dummy', dummy: 2.2, len: 60, script: () => ({}) },
  { id: 'run', follow: true, name: 'Run · jump · double jump', how: 'Stick: left / right run · up jumps · up again in the air: a somersault', dummy: null, len: 120, at: 7.6,
    script: (s) => ({ x: s < 78 ? 1 : 0, jump: s === 22 || s === 42 }) },
  { id: 'wall', follow: true, name: 'Wall slide · wall jump', how: 'Push into a wall in the air to cling · push up to kick off it', dummy: null, len: 150, at: 4, wall: true,
    script: (s) => ({ x: s < 40 ? -1 : s < 75 ? -1 : s < 100 ? 1 : 0, jump: s === 8 || s === 70 }) },
  { id: 'crouch', follow: true, name: 'Crouch', how: 'Stick down: crouch, crouch-walk · jabs go over you', dummy: null, len: 90,
    script: (s) => ({ y: s > 10 && s < 80 ? -1 : 0, x: s > 30 && s < 60 ? 0.6 : 0 }) },
  { id: 'jab', name: 'Jab · cross · hook', how: 'Swipe toward them, three times', dummy: 1.25, len: 80,
    script: (s) => ({ press: s === 6 || s === 21 || s === 38 ? [ATK.NORMAL, 0] : null }) },
  { id: 'haymaker', name: 'Haymaker', how: 'Sweep right across the square', dummy: 1.75, len: 70, script: (s) => ({ press: s === 6 ? [ATK.HEAVY, 0] : null }) },
  { id: 'uppercut', name: 'Uppercut', how: 'Swipe up', dummy: 1.0, len: 70, script: (s) => ({ press: s === 6 ? [ATK.UPPER, 90] : null }) },
  { id: 'slam', name: 'Slam', how: 'Swipe down', dummy: 1.2, len: 70, script: (s) => ({ press: s === 6 ? [ATK.SLAM, -90] : null }) },
  { id: 'airpunch', name: 'Superman punch', how: 'In the air: swipe toward them', dummy: 2.3, len: 75,
    script: (s) => ({ jump: s === 4, press: s === 8 ? [ATK.NORMAL, -20] : null }) },
  { id: 'stomp', name: 'Stomp dive', how: 'In the air: swipe down', dummy: 1.6, len: 80,
    script: (s) => ({ jump: s === 4, x: s > 4 && s < 20 ? 0.8 : 0, press: s === 24 ? [ATK.SLAM, -90] : null }) },
  { id: 'kick', name: 'Front kick', how: 'Swipe along the kick band', dummy: 1.35, len: 70, script: (s) => ({ press: s === 6 ? [ATK.KICK, 0] : null }) },
  { id: 'roundhouse', name: 'Roundhouse', how: 'Kick band, swiped upward', dummy: 1.3, len: 75, script: (s) => ({ press: s === 6 ? [ATK.KICK, 40] : null }) },
  { id: 'sweep', name: 'Leg sweep', how: 'Crouch and kick: takes the feet from both sides', dummy: 1.1, dummy2: -1.1, len: 80,
    script: (s) => ({ y: s > 2 && s < 12 ? -1 : 0, press: s === 8 ? [ATK.KICK, -30] : null }) },
  { id: 'flykick', name: 'Flying kick', how: 'Kick at a run, or in the air', dummy: 3.2, len: 80, at: -4,
    script: (s) => ({ x: s < 24 ? 1 : 0, press: s === 20 ? [ATK.KICK, 0] : null }) },
  { id: 'dropkick', name: 'Dropkick', how: 'A long sweep along the kick band', dummy: 2.6, len: 95, script: (s) => ({ press: s === 6 ? [ATK.DROPKICK, 0] : null }) },
  { id: 'throw', name: 'Throw', how: 'Holding something: tap the square', dummy: 3.6, len: 70, item: 'axe',
    script: (s) => ({ press: s === 10 ? [ATK.THROW, 0] : null }) },
  { id: 'axe', name: 'Axe: chop · backhand', how: 'Swipe, swipe', dummy: 1.6, len: 80, item: 'axe',
    script: (s) => ({ press: s === 8 || s === 25 ? [ATK.NORMAL, 0] : null }) },
  { id: 'axeWhirl', name: 'Axe whirl', how: 'Big sweep, or hold and let go', dummy: 1.6, dummy2: -1.6, len: 85, item: 'axe',
    script: (s) => ({ press: s === 6 ? [ATK.HEAVY, 0] : null }) },
  { id: 'axeFlip', name: 'Axe somersault', how: 'In the air: swipe', dummy: 1.7, len: 80, item: 'axe',
    script: (s) => ({ jump: s === 4, press: s === 6 ? [ATK.NORMAL, 0] : null }) },
  { id: 'sword', name: 'Sword: thrust high · mid · low', how: 'Swipe the way you want the point to go', dummy: 2.0, len: 95, item: 'sword',
    script: (s) => ({ press: s === 6 ? [ATK.NORMAL, 30] : s === 30 ? [ATK.NORMAL, 0] : s === 54 ? [ATK.NORMAL, -25] : null }) },
  { id: 'slash', name: 'Sword: slash', how: 'Swipe twice', dummy: 1.7, len: 70, item: 'sword',
    script: (s) => ({ press: s === 6 || s === 24 ? [ATK.NORMAL, 0] : null }) },
  { id: 'lunge', name: 'Sword: lunge', how: 'Big sweep, or hold and let go', dummy: 3.2, len: 80, item: 'sword',
    script: (s) => ({ press: s === 6 ? [ATK.HEAVY, 0] : null }) },
  { id: 'smash', name: 'Hammer smash', how: 'Swipe', dummy: 1.8, len: 80, item: 'hammer', script: (s) => ({ press: s === 6 ? [ATK.NORMAL, 0] : null }) },
  { id: 'hammerSpin', name: 'Hammer spin', how: 'Big sweep, or hold and let go', dummy: 1.9, dummy2: -1.9, len: 95, item: 'hammer',
    script: (s) => ({ press: s === 6 ? [ATK.HEAVY, 0] : null }) },
];


// Put a scene's fighters in place: the player at x0 (+ scene.at), dummies at the given offsets.
export function stage(sim, sc, k, x0 = 10) {
  const bx = sc.wall ? 2.5 : x0 + (sc.at || 0);
  sim.respawn(ME, bx, 3);
  const me = sim.fighters[ME];
  me.facing = sc.wall ? -1 : 1; me.aim = me.facing > 0 ? 0 : Math.PI;
  if (sc.item) me.item = { kind: sc.item, ammo: 99, id: 9000 + k };
  for (const [slot, off] of [[DUMMY, sc.dummy], [DUMMY2, sc.dummy2]]) {
    if (off == null) sim.respawn(slot, 60 + slot, 30); // out of the arena: gone
    else { const d = sim.respawn(slot, x0 + off, 3); d.facing = off > 0 ? -1 : 1; d.hp = FIGHTER_HP; }
  }
  for (let i = 0; i < 40; i++) sim.step([]);
  sim.drainEvents();
}

// The player's input for step s of a scene (counters carried in st: { ap, jp, ak, ad }).
export function sceneInput(sim, sc, s, st) {
  const out = sc.script(s);
  if (out.jump) st.jp++;
  if (out.press) {
    st.ap++; st.ak = out.press[0];
    const left = sim.fighters[ME].facing < 0;
    st.ad = out.press[1] == null ? NO_DIR : dirToByte(left ? Math.PI - out.press[1] * R : out.press[1] * R);
  }
  return { x: out.x || 0, y: out.y || 0, b: out.hold ? 1 : 0, jp: st.jp, ap: st.ap, ak: st.ak, ad: st.ad };
}
