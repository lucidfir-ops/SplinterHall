import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { MAT, W, CELLS, STEP } from '../../src/core/consts.js';
await RAPIER.init();
const level = buildLevel('BXAH67KH');
level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
level.props = []; level.pads = []; level.spawns = [{ x: 14, y: 2 }, { x: 24, y: 2 }];
const kind = process.argv[2] || null;
const sim = new Sim(RAPIER, level, [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
for (const it of [...sim.items.world.values()]) sim.items.removeWorldItem(it);
if (kind) for (const f of sim.fighters) if (f) f.item = { kind, ammo: Infinity, id: 900 + f.slot };
const bots = [new Bot(sim, 0, 1, 'a'), new Bot(sim, 1, 1, 'b')];
const ev = {};
for (let i = 0; i < 60 * 30 && sim.phase !== 'end'; i++) {
  const inp = []; for (const b of bots) inp[b.slot] = b.update(STEP); sim.step(inp);
  for (const e of sim.drainEvents()) { const k = e.t + (e.k ? ':' + e.k : ''); ev[k] = (ev[k] || 0) + 1; }
  if (i % 120 === 0) console.log(i / 60, sim.fighters.filter(Boolean).map(f => f.pos().x.toFixed(1) + '/' + f.hp.toFixed(0) + '/p' + f.poise.toFixed(1)).join('  '), bots.map(b => b.mode).join(','));
}
console.log(ev, 'winner', sim.winner, 't', sim.roundTime.toFixed(1));
