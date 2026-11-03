import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP } from '../../src/core/consts.js';
import { Fighter } from '../../src/sim/fighter.js';
await RAPIER.init();
const hits = {};
const wrap = (name) => {
  const orig = Fighter.prototype[name];
  Fighter.prototype[name] = function (...a) {
    const v0 = this.torso.linvel();
    const r = orig.apply(this, a);
    const v1 = this.torso.linvel();
    const d = Math.hypot(v1.x - v0.x, v1.y - v0.y);
    if (d > 6) { const k = name + (this.swing ? ':' + this.swing.kind : '') + (this.grounded ? ':g' : ':air'); hits[k] = (hits[k] || 0) + 1; if (hits[k] < 3) console.log(name, 'jump', d.toFixed(1), JSON.stringify(v0), JSON.stringify(v1), 'poise', this.poise.toFixed(2)); }
    return r;
  };
};
for (const n of ['control', 'hurt', 'addVel', 'setVelAll', 'pose']) wrap(n);
for (let r = 0; r < 3; r++) {
  const level = buildLevel(randomCode(SETTINGS[r % 4]));
  const roster = [...Array(8)].map((_, slot) => ({ slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { round: r });
  const bots = roster.map((x) => new Bot(sim, x.slot, 1, 'x' + r));
  for (let i = 0; i < 60 * 40 && sim.phase !== 'end'; i++) { const inp = []; for (const b of bots) inp[b.slot] = b.update(STEP); sim.step(inp); sim.drainEvents(); }
}
console.log(hits);
