// How far each move reaches: the longest distance (between the two fighters' centres) at which it still lands
// on a standing target, and whether it lands on a crouching one at a close range.
//   node tools/dev/movereach.mjs [clip,clip]
import RAPIER from '@dimforge/rapier2d-compat';
import { Sim } from '../../src/sim/sim.js';
import { practiceLevel } from '../../src/level/practice.js';
import { CLIPS } from '../../src/anim/moves.js';
await RAPIER.init();
const ITEM = { axeChop: 'axe', axeBack: 'axe', axeWhirl: 'axe', axeFlip: 'axe', thrust: 'sword', slash: 'sword', lunge: 'sword', smash: 'hammer', hammerSpin: 'hammer', throw: 'axe' };
const AIR = new Set(['airpunch', 'axeFlip']);
function trial(clip, d, duck = false) {
  const sim = new Sim(RAPIER, practiceLevel(0, 1), [{ slot: 0, ai: false }, { slot: 1, ai: true }], { practice: true, dropRate: 'none' });
  while (sim.phase !== 'fight') sim.step([]);
  sim.respawn(0, 10, 3); sim.respawn(1, 10 + d, 3);
  const a = sim.fighters[0], b = sim.fighters[1];
  const din = duck ? { x: 0, y: -1, b: 0, jp: 0, ap: 0 } : undefined;
  for (let i = 0; i < 50; i++) sim.step([undefined, din]);
  // Put them exactly d apart, facing each other.
  const pa = a.pos(), pb = b.pos();
  b.teleport(pa.x + d, pb.y, 0, { x: 0, y: 0 });
  a.facing = 1; a.aim = 0; b.facing = -1; b.aim = Math.PI;
  if (ITEM[clip]) a.item = { kind: ITEM[clip], ammo: 9, id: 900 };
  if (AIR.has(clip)) { a.addVel(0, 6); a.noHover = 0.3; for (let i = 0; i < 8; i++) sim.step([undefined, din]); }
  sim.items.startMove(a, clip, CLIPS[clip].heavy ? 0.6 : 0);
  let dmg = 0;
  for (let i = 0; i < 90; i++) {
    sim.step([undefined, din]);
    for (const e of sim.drainEvents()) if (e.t === 'hurt' && e.s === 1 && e.k !== 'impact') dmg += e.a;
  }
  sim.destroy();
  return dmg;
}
const names = process.argv[2] ? process.argv[2].split(',') : Object.keys(CLIPS).filter((c) => CLIPS[c].hits.length);
console.log('move'.padEnd(12), 'reach'.padStart(6), ' dmg', ' vs crouch@0.9');
for (const c of names) {
  let lo = 0.8, hi = 4.5;
  if (!trial(c, lo)) { console.log(c.padEnd(12), '  miss even at', lo); continue; }
  for (let k = 0; k < 9; k++) { const m = (lo + hi) / 2; if (trial(c, m)) lo = m; else hi = m; }
  console.log(c.padEnd(12), lo.toFixed(2).padStart(6), String(Math.round(trial(c, Math.max(0.5, lo - 0.3)))).padStart(4), trial(c, 0.9, true) ? '  hits' : '  misses');
}
