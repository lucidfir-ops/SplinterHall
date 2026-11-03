// 8 AI fighters per round on random levels: round length, how fighters die, stuck bots.
//   node tools/sim-bots.mjs [rounds]
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../src/level/generate.js';
import { randomCode } from '../src/core/codes.js';
import { Sim } from '../src/sim/sim.js';
import { Bot } from '../src/ai/bot.js';
import { SETTINGS, STEP } from '../src/core/consts.js';
await RAPIER.init();
const rounds = +process.argv[2] || 20;
const causes = {}, killers = {}, lengths = [], stuck = []; let errors = 0, draws = 0, timeouts = 0;
const t0 = Date.now();
for (let r = 0; r < rounds; r++) {
  const code = randomCode(SETTINGS[r % 4]);
  const level = buildLevel(code);
  const roster = [...Array(8)].map((_, slot) => ({ slot, name: 'B' + slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { ragnarok: true, round: r });
  const bots = roster.map((x) => new Bot(sim, x.slot, 1, 'x' + r));
  const still = new Array(8).fill(0), lastPos = [];
  try {
    for (let i = 0; i < 60 * 200 && sim.phase !== 'end'; i++) {
      const inp = [];
      for (const b of bots) inp[b.slot] = b.update(STEP * sim.timeScale);
      sim.step(inp);
      for (const e of sim.drainEvents()) {
        if (e.t === 'death') { causes[e.c] = (causes[e.c] || 0) + 1; }
        if (e.t === 'hurt' && e.a > 0) killers[e.k] = (killers[e.k] || 0) + e.a;
      }
      if (i % 60 === 0) for (const f of sim.fighters) if (f && f.alive) {
        const p = f.pos(), l = lastPos[f.slot];
        if (l && Math.hypot(p.x - l.x, p.y - l.y) < 0.3) still[f.slot]++; else still[f.slot] = 0;
        lastPos[f.slot] = { x: p.x, y: p.y };
        if (still[f.slot] === 10) stuck.push(code + '#' + f.slot + ' at ' + p.x.toFixed(1) + ',' + p.y.toFixed(1));
      }
    }
  } catch (e) { errors++; console.log('ERR', code, e.stack.split('\n').filter(l => !l.includes('wasm:')).slice(0, 8).join(' | ')); }
  if (sim.phase !== 'end') timeouts++;
  if (sim.winner < 0) draws++;
  lengths.push(sim.roundTime);
  sim.destroy();
}
lengths.sort((a, b) => a - b);
console.log('rounds', rounds, 'errors', errors, 'unfinished', timeouts, 'draws', draws);
console.log('round length s: median', lengths[lengths.length >> 1].toFixed(0), 'max', lengths[lengths.length - 1].toFixed(0));
console.log('deaths by cause', causes);
console.log('damage by kind', killers);
console.log('stuck 10s+', stuck.length, stuck.slice(0, 6));
console.log(((Date.now() - t0) / 1000).toFixed(0), 's');
