import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { makeRng } from '../../src/core/rng.js';
const seeded = makeRng('hunt');
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP } from '../../src/core/consts.js';
await RAPIER.init();
const times = [];
const N = +(process.argv[2] || 32);
for (let r = 0; r < N; r++) {
  const level = buildLevel(randomCode(SETTINGS[r % 4], seeded.next));
  const sim = new Sim(RAPIER, level, [{ slot: 0 }, { slot: 1, ai: true }], { round: r, ragnarok: false });
  const bot = new Bot(sim, 1, 2, 'h' + r);
  let i = 0;
  for (; i < 60 * 120 && sim.phase !== 'end'; i++) { const inp = []; inp[1] = bot.update(STEP); sim.step(inp); sim.drainEvents(); }
  times.push(sim.phase === 'end' ? sim.roundTime : 999);
}
times.sort((a, b) => a - b);
console.log('kill time s:', times.map((t) => t.toFixed(0)).join(' '));
