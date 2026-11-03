import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP, W } from '../../src/core/consts.js';
import { cellX, cellY } from '../../src/ai/nav.js';
await RAPIER.init();
let shown = 0;
for (let r = 0; r < 24 && shown < 2; r++) {
  const code = randomCode(SETTINGS[r % 4]);
  const level = buildLevel(code);
  const sim = new Sim(RAPIER, level, [{ slot: 0 }, { slot: 1, ai: true }], { round: r, ragnarok: false });
  const bot = new Bot(sim, 1, 2, 'h' + r);
  const log = [];
  let i = 0;
  for (; i < 60 * 60 && sim.phase !== 'end'; i++) {
    const inp = []; inp[1] = bot.update(STEP); sim.step(inp); sim.drainEvents();
    if (i % 120 === 0) { const f = sim.fighters[1], p = f.feet(); const P = bot.path; log.push(`t${(i/60)|0} feet ${p.x.toFixed(1)},${p.y.toFixed(1)} g${f.grounded?1:0} mode ${bot.mode} path ${P ? P.length : '-'} wp ${bot.wp} next ${P && bot.wp < P.length ? cellX(P[bot.wp]) + ',' + cellY(P[bot.wp]) : '-'} in ${bot.inp.x.toFixed(1)},${bot.inp.y.toFixed(1)},b${bot.inp.b}`); }
  }
  if (sim.phase !== 'end') { shown++; const t = sim.fighters[0].feet(); console.log(code, level.archetype, 'target feet', t.x.toFixed(1), t.y.toFixed(1)); console.log(log.slice(0, 16).join('\n')); }
}
