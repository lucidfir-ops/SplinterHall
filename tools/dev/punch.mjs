import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { MAT, W, H, CELLS } from '../../src/core/consts.js';
await RAPIER.init();
const level = buildLevel('BXAH67KH');
// flat floor arena
level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
level.props = []; level.pads = [];
level.spawns = [{ x: 18, y: 2 }, { x: 19.2, y: 2 }];
const sim = new Sim(RAPIER, level, [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
for (let i = 0; i < 160; i++) sim.step([]);
const f0 = sim.fighters[0], f1 = sim.fighters[1];
console.log('pos', f0.pos(), f1.pos(), 'phase', sim.phase);
for (const kind of [null, 'axe', 'sword', 'hammer']) {
  f0.item = kind ? { kind, ammo: Infinity, id: 999 } : null;
  let ap = 0; const hp0 = f1.hp;
  for (let i = 0; i < 120; i++) {
    if (i % 30 === 0) ap++;
    sim.step([{ x: (f1.pos().x - f0.pos().x) > 0.9 ? 0.5 : 0, y: 0, b: 0, jp: 0, ap }, { x: 0, y: 0, b: 0, jp: 0, ap: 0 }]);
    const ev = sim.drainEvents().filter(e => e.t === 'hurt' || e.t === 'swing');
    if (ev.length && i < 40) console.log(kind, i, ev.map(e => e.t + ':' + (e.k||'') + ':' + (e.a||'')).join(' '));
  }
  const h = f0.hand(); const t = f1.pos();
  console.log(kind, 'hp', hp0.toFixed(0), '->', f1.hp.toFixed(0), 'hand', h.x.toFixed(2), h.y.toFixed(2), 'dir', h.dx.toFixed(2), h.dy.toFixed(2), 'target', t.x.toFixed(2), t.y.toFixed(2), 'facing', f0.facing);
  f1.hp = 100;
}
