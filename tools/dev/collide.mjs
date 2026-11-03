import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { MAT, W, CELLS } from '../../src/core/consts.js';
await RAPIER.init();
const level = buildLevel('BXAH67KH');
level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
level.props = []; level.pads = []; level.spawns = [{ x: 18, y: 2 }, { x: 19.2, y: 2 }];
const sim = new Sim(RAPIER, level, [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
const I = { x: 0, y: 0, b: 0, jp: 0, ap: 0 };
for (let i = 0; i < 160; i++) sim.step([I, I]);
const f0 = sim.fighters[0], f1 = sim.fighters[1];
console.log('groups f0 torso', (f0.parts[1].col.collisionGroups() >>> 0).toString(16), 'f1', (f1.parts[1].col.collisionGroups() >>> 0).toString(16));
for (let i = 0; i < 90; i++) {
  sim.step([{ x: 1, y: 0, b: 0, jp: 0, ap: 0 }, I]);
  if (i % 10 === 0) {
    let pairs = 0; sim.world.contactPairsWith(f0.parts[1].col, (c) => { const inf = sim.info(c); if (inf && inf.kind === 'part') pairs++; });
    console.log(i, 'f0', f0.pos().x.toFixed(2), 'f1', f1.pos().x.toFixed(2), 'contacts w/ parts', pairs);
  }
}
