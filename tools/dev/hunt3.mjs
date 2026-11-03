import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { makeRng } from '../../src/core/rng.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP, W, H, cellIndex } from '../../src/core/consts.js';
await RAPIER.init();
const seeded = makeRng('hunt');
let shown = 0;
for (let r = 0; r < 32 && shown < 3; r++) {
  const code = randomCode(SETTINGS[r % 4], seeded.next);
  const level = buildLevel(code);
  const sim = new Sim(RAPIER, level, [{ slot: 0 }, { slot: 1, ai: true }], { round: r, ragnarok: false });
  const bot = new Bot(sim, 1, 2, 'h' + r);
  const trail = [];
  for (let i = 0; i < 60 * 120 && sim.phase !== 'end'; i++) { const inp = []; inp[1] = bot.update(STEP); sim.step(inp); sim.drainEvents(); if (i % 30 === 0) { const p = sim.fighters[1].feet(); trail.push([Math.floor(p.x), Math.floor(p.y + 0.05)]); } }
  if (sim.phase === 'end') continue;
  shown++;
  const t = sim.fighters[0].feet(), b = sim.fighters[1].feet();
  console.log('\n' + code, level.archetype, 'target', t.x.toFixed(1), t.y.toFixed(1), 'bot', b.x.toFixed(1), b.y.toFixed(1), 'mode', bot.mode, 'path', bot.path && bot.path.length);
  const visits = new Map(); for (const [i, j] of trail) visits.set(i + ',' + j, (visits.get(i + ',' + j) || 0) + 1);
  for (let j = H - 1; j >= 0; j--) {
    let s = '';
    for (let i = 0; i < W; i++) {
      let ch = sim.terrain.grid[cellIndex(i, j)] ? (sim.terrain.state[cellIndex(i, j)] === 1 ? '#' : '+') : '.';
      if (Math.floor(t.x) === i && Math.floor(t.y + 0.05) === j) ch = 'T';
      else if (Math.floor(b.x) === i && Math.floor(b.y + 0.05) === j) ch = 'B';
      else if (visits.has(i + ',' + j) && ch === '.') ch = 'o';
      s += ch;
    }
    console.log(String(j).padStart(2), s);
  }
}
