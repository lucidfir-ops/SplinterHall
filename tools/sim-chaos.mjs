// Every fighter gets an item and uses it at the nearest enemy, over many random levels.
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../src/level/generate.js';
import { randomCode } from '../src/core/codes.js';
import { Sim } from '../src/sim/sim.js';
import { ITEM_KINDS, ITEMS, SETTINGS } from '../src/core/consts.js';
await RAPIER.init();
const rounds = +process.argv[2] || 12;
let evAll = {}, maxStep = 0, total = 0, steps = 0, errs = 0;
for (let r = 0; r < rounds; r++) {
  const code = randomCode(SETTINGS[r % 4]);
  const level = buildLevel(code);
  const roster = [...Array(8)].map((_, slot) => ({ slot, name: 'F' + slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { ragnarok: true });
  const inp = [];
  let jp = 0, ap = 0;
  sim.fighters.forEach((f, k) => { const kind = ITEM_KINDS[(k + r) % ITEM_KINDS.length]; const slot = ITEMS[kind].slot === 'back' ? 'back' : 'item'; f[slot] = { kind, ammo: ITEMS[kind].ammo, id: 9000 + k }; });
  try {
    for (let i = 0; i < 60 * 40 && sim.phase !== 'end'; i++) {
      for (const f of sim.fighters) {
        if (!f || !f.alive) continue;
        let tgt = null, bd = 1e9; const me = f.pos();
        for (const o of sim.fighters) if (o && o !== f && o.alive) { const t = o.pos(); const d = Math.hypot(t.x-me.x, t.y-me.y); if (d < bd) { bd = d; tgt = t; } }
        if (!tgt) continue;
        const dx = tgt.x - me.x, dy = tgt.y - me.y, l = Math.hypot(dx, dy) || 1;
        const phase = (i + f.slot * 17) % 90;
        const hold = phase < 40;
        if (phase === 0) ap++;
        if (phase === 45 && Math.random() < 0.5) jp++;
        if (!f.item && phase === 60) inp[f.slot] = { x: 0, y: -1, b: 0, jp, ap }; // try pick up
        else inp[f.slot] = { x: dx / l * (bd > 4 ? 1 : 0.4), y: dy / l, b: (hold ? 2 : 0) | (phase > 45 && phase < 60 ? 1 : 0), jp: jp + f.slot, ap: ap + f.slot };
      }
      const t0 = performance.now();
      sim.step(inp);
      const dt = performance.now() - t0; maxStep = Math.max(maxStep, dt); total += dt; steps++;
      if (dt > 8) console.log("slow step", dt.toFixed(1), "tick", sim.tick, sim.events.map(e=>e.t).join(","));
      for (const e of sim.drainEvents()) evAll[e.t] = (evAll[e.t] || 0) + 1;
    }
  } catch (e) { errs++; console.log('ERROR in', code, e.stack); }
  console.log(code, level.archetype, 'phase', sim.phase, 'time', sim.roundTime.toFixed(1), 'alive', sim.alive().length, 'winner', sim.winner, 'dyn bodies', sim.tracked.size);
  sim.destroy();
}
console.log(evAll);
console.log('avg step', (total/steps).toFixed(2), 'ms, max', maxStep.toFixed(1), 'ms, errors', errs);
