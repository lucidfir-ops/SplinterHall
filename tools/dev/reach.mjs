// Reach of each bare-hand move (torso to torso) and whether a ducking target slips a jab: node tools/dev/reach.mjs
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { MAT, W, CELLS, ATK, NO_DIR, dirToByte } from '../../src/core/consts.js';
await RAPIER.init();
const idle = { x: 0, y: 0, b: 0, jp: 0, ap: 0, ak: 0, ad: NO_DIR };
function hit(atk, dist, duck) {
  const level = buildLevel('BXAH67KH');
  level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
  level.props = []; level.pads = []; level.spawns = [{ x: 18, y: 2 }, { x: 18 + dist, y: 2 }];
  const sim = new Sim(RAPIER, level, [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
  for (let i = 0; i < 160; i++) sim.step([idle, duck ? { ...idle, y: -1 } : idle]);
  const f1 = sim.fighters[1]; const hp = f1.hp; let head = 9, hy = 0;
  for (let i = 0; i < 50; i++) { sim.step([{ ...idle, ap: 1, ak: atk, ad: dirToByte(0) }, duck ? { ...idle, y: -1 } : idle]); head = Math.min(head, f1.parts[0].body.translation().y); hy = Math.max(hy, sim.fighters[0].hand().y); }
  const r = hp - f1.hp; sim.destroy(); return [r, head, hy];
}
for (const [n, a] of [['jab', ATK.NORMAL], ['haymaker', ATK.HEAVY], ['kick', ATK.KICK]]) {
  let max = 0; for (let d = 0.8; d <= 1.8; d += 0.05) if (hit(a, d)[0] > 0) max = d;
  console.log(n, 'reach (torso to torso)', max.toFixed(2));
}
console.log('duck: [dmg, target head min y, attacker hand max y]', hit(ATK.NORMAL, 1.1, true).map((v) => +v.toFixed(2)), 'standing', hit(ATK.NORMAL, 1.1, false).map((v) => +v.toFixed(2)));
