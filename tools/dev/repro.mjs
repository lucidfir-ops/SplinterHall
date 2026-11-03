// Replay one AI round: node tools/dev/repro.mjs CODE ROUND
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { STEP } from '../../src/core/consts.js';
await RAPIER.init();
const [code, rr] = process.argv.slice(2);
for (const r of rr.split(',').map(Number)) {
  const level = buildLevel(code);
  const roster = [...Array(8)].map((_, slot) => ({ slot, name: 'B' + slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { ragnarok: true, round: r });
  const bots = roster.map((x) => new Bot(sim, x.slot, 1, 'x' + r));
  globalThis.__sim = sim;
  try {
    for (let i = 0; i < 60 * 200 && sim.phase !== 'end'; i++) {
      const inp = [];
      for (const b of bots) inp[b.slot] = b.update(STEP * sim.timeScale);
      sim.step(inp);
      sim.drainEvents();
    }
    console.log(r, 'ok', sim.roundTime.toFixed(1));
  } catch (e) { console.log(r, 'ERR at t', sim.time.toFixed(2), e.message); }
  try { sim.destroy(); } catch {}
}
