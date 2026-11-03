// Movement numbers on a flat floor: run speed, jump and double-jump height (feet), time in the air, and a
// wall jump off a tall wall.   node tools/dev/jumps.mjs
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { MAT, W, CELLS, NO_DIR, cellIndex } from '../../src/core/consts.js';
await RAPIER.init();
const idle = { x: 0, y: 0, b: 0, jp: 0, ap: 0, ak: 0, ad: NO_DIR };
function world(wall) {
  const level = buildLevel('BXAH67KH');
  level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
  if (wall) for (let j = 2; j < 18; j++) level.grid[cellIndex(24, j)] = MAT.STONE;
  level.props = []; level.pads = []; level.spawns = [{ x: 12, y: 2 }, { x: 36, y: 2 }];
  const sim = new Sim(RAPIER, level, [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
  for (let i = 0; i < 160; i++) sim.step([idle, idle]);
  return sim;
}
// Jump (and double jump at the top).
for (const dbl of [false, true]) {
  const sim = world(false), f = sim.fighters[0];
  const y0 = f.feet().y; let top = y0, air = 0, jp = 0, dj = false;
  for (let i = 0; i < 180; i++) {
    if (i === 1) jp = 1;
    if (dbl && !dj && i > 5 && f.vel().y < 0.5) { jp = 2; dj = true; }
    sim.step([{ ...idle, jp }, idle]);
    top = Math.max(top, f.feet().y);
    if (!f.grounded) air += 1 / 60; else if (i > 10) break;
  }
  console.log(dbl ? 'double jump' : 'jump       ', 'feet rise', (top - y0).toFixed(2), 'm, in the air', air.toFixed(2), 's');
  sim.destroy();
}
// Run speed.
{
  const sim = world(false), f = sim.fighters[0];
  let t = 0; for (let i = 0; i < 60; i++) { sim.step([{ ...idle, x: 1 }, idle]); if (t === 0 && f.vel().x > 8.6 * 0.9) t = (i + 1) / 60; }
  console.log('run        ', 'speed', f.vel().x.toFixed(1), 'm/s, 90% of it after', t.toFixed(2), 's');
  sim.destroy();
}
// Wall jump: run at the wall, jump, push into it, jump again off it.
{
  const sim = world(true), f = sim.fighters[0];
  let jp = 0, wallJumps = 0, top = 0, clung = 0;
  let jumped = false;
  for (let i = 0; i < 300; i++) {
    const p = f.pos();
    const x = 1; // always pushing toward the wall (after a kick-off this steers straight back to it)
    if (!jumped && f.grounded && p.x > 21.5) { jp++; jumped = true; }
    if (f.wallDir) { clung++; if (clung > 4) { jp++; clung = 0; } }
    sim.step([{ ...idle, x, jp }, idle]);
    for (const e of sim.drainEvents()) if (e.t === 'jump' && e.w) wallJumps++;
    top = Math.max(top, f.feet().y);
  }
  console.log('wall jumps ', wallJumps, 'climbed to', (top - 2).toFixed(1), 'm up a 16 m wall');
  sim.destroy();
}
