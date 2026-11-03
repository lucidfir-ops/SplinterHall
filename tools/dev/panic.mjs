import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { STEP } from '../../src/core/consts.js';
await RAPIER.init();
for (const code of ['H17HH0CP', 'H67RKA8P']) {
  for (let r = 0; r < 24; r++) {
    const level = buildLevel(code);
    const roster = [...Array(8)].map((_, slot) => ({ slot, ai: true }));
    const sim = new Sim(RAPIER, level, roster, { ragnarok: true, round: r });
    const bots = roster.map((x) => new Bot(sim, x.slot, 1, 'x' + r));
    let last = [];
    try {
      for (let i = 0; i < 60 * 200 && sim.phase !== 'end'; i++) { const inp = []; for (const b of bots) inp[b.slot] = b.update(STEP); sim.step(inp); last = sim.drainEvents().map(e => e.t); }
    } catch (e) { console.log(code, r, 'PANIC', e.stack.split('\n').filter(l => !l.includes('wasm:')).slice(0, 7).join('\n  '), '\n  last events', last.join(',')); break; }
  }
}
