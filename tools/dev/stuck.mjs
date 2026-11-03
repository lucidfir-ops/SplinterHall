// Finds AI fighters that stay put for 5 s while they have somewhere to be, and says what they were doing:
// jumping into a ceiling, swinging at nothing, waiting at a drop, or walking into a wall.
//   node tools/dev/stuck.mjs [rounds] [fighters]
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP, cellIndex, inGrid } from '../../src/core/consts.js';
import { cellX, cellY } from '../../src/ai/nav.js';
await RAPIER.init();
const rounds = +process.argv[2] || 24, nF = +process.argv[3] || 4;
const cases = [], kinds = {};
let longest = 0, longestAt = '';
let roundsDone = 0, totalTime = 0;
for (let r = 0; r < rounds; r++) {
  const code = randomCode(SETTINGS[r % 4]);
  const level = buildLevel(code);
  const roster = [...Array(nF)].map((_, slot) => ({ slot, name: 'B' + slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { ragnarok: true, round: r });
  const bots = roster.map((x) => new Bot(sim, x.slot, 2, 'x' + r));
  const track = bots.map(() => ({ x: 0, y: 0, t: 0, jumps: 0, acts: 0, reported: false }));
  const solid = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return inGrid(i, j) && sim.terrain.grid[cellIndex(i, j)] !== 0; };
  for (let i = 0; i < 60 * 150 && sim.phase !== 'end'; i++) {
    const inp = [];
    for (const b of bots) inp[b.slot] = b.update(STEP * sim.timeScale);
    sim.step(inp);
    for (const e of sim.drainEvents()) {
      if (e.t === 'jump' && track[e.s]) track[e.s].jumps++;
      if (e.t === 'swing' && track[e.s]) track[e.s].acts++;
    }
    if (sim.phase !== 'fight') continue;
    for (const b of bots) {
      const f = b.f, T = track[b.slot];
      if (!f || !f.alive || !b.goal) { T.t = 0; continue; }
      const p = f.pos();
      if (Math.hypot(p.x - T.x, p.y - T.y) > 0.8) { T.x = p.x; T.y = p.y; T.t = 0; T.jumps = 0; T.acts = 0; T.reported = false; continue; }
      T.t += STEP;
      const gdd = Math.hypot(b.goal.x - p.x, b.goal.y - p.y);
      if (gdd > 2.2 && T.t > longest) { longest = T.t; longestAt = `${code} r${r} #${b.slot} at ${p.x.toFixed(1)},${p.y.toFixed(1)} mode ${b.mode}`; }
      const gd = Math.hypot(b.goal.x - p.x, b.goal.y - p.y);
      if (T.t > 5 && !T.reported && gd > 2.2) {
        T.reported = true;
        const feet = f.feet();
        const wp = b.path && b.wp < b.path.length ? b.path[b.wp] : null;
        const wdy = wp != null ? cellY(wp) - feet.y : null, wdx = wp != null ? cellX(wp) - p.x : null;
        const ceiling = solid(p.x, feet.y + 2.3) || solid(p.x, feet.y + 2.9) || solid(p.x + f.facing * 0.6, feet.y + 2.5);
        const wall = solid(p.x + f.facing * 0.8, feet.y + 0.5) || solid(p.x + f.facing * 0.8, feet.y + 1.4);
        let kind = 'other';
        if (T.acts >= 3 && gd > 3) kind = 'swinging at nothing';
        else if (T.jumps >= 3 && ceiling) kind = 'jumping into a ceiling';
        else if (T.jumps >= 3) kind = 'jumping, no headway';
        else if (!wp) kind = 'no route';
        else if (Math.abs(b.inp.x) < 0.2) kind = 'standing still';
        else if (wall) kind = 'walking into a wall';
        kinds[kind] = (kinds[kind] || 0) + 1;
        cases.push(`${code} r${r} #${b.slot} ${kind.padEnd(22)} at ${p.x.toFixed(1)},${p.y.toFixed(1)} mode ${b.mode} goal d ${gd.toFixed(1)} wp ${wp == null ? '-' : `${wdx.toFixed(1)},${wdy.toFixed(1)}`} jumps ${T.jumps} swings ${T.acts} item ${f.item ? f.item.kind : '-'}`);
      }
    }
  }
  roundsDone++; totalTime += sim.roundTime;
  sim.destroy();
}
console.log(cases.join('\n'));
console.log('longest time stuck (goal out of reach):', longest.toFixed(1) + 's', longestAt);
console.log('rounds', roundsDone, 'avg round', (totalTime / roundsDone).toFixed(1) + 's', 'stuck cases', cases.length, kinds);
