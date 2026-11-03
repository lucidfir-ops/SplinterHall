import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { STEP } from '../../src/core/consts.js';
await RAPIER.init();
const code = process.argv[2] || 'H1710JNF', r = +(process.argv[3] || 0);
const level = buildLevel(code);
const sim = new Sim(RAPIER, level, [{ slot: 0 }, { slot: 1, ai: true }], { round: r, ragnarok: false });
const bot = new Bot(sim, 1, 2, 'h' + r);
for (let i = 0; i < 60 * 24; i++) {
  const inp = []; inp[1] = bot.update(STEP); sim.step(inp);
  const ev = sim.drainEvents();
  if (i > 60 * 18 && i % 20 === 0) {
    const f = sim.fighters[1], o = sim.fighters[0];
    console.log((i / 60).toFixed(1), 'bot', f.pos().x.toFixed(2), f.pos().y.toFixed(2), 'tgt', o.pos().x.toFixed(2), o.pos().y.toFixed(2), 'react', bot.react.toFixed(2), 'swing', f.swing?.kind, 'cool', f.cool.toFixed(2), 'item', f.item?.kind, 'in', JSON.stringify(bot.inp), ev.map(e => e.t).join(','));
  }
}
