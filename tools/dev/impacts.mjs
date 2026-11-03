import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { randomCode } from '../../src/core/codes.js';
import { Sim } from '../../src/sim/sim.js';
import { Bot } from '../../src/ai/bot.js';
import { SETTINGS, STEP } from '../../src/core/consts.js';
import { Fighter } from '../../src/sim/fighter.js';
await RAPIER.init();
const log = [];
const orig = Fighter.prototype.hurt;
Fighter.prototype.hurt = function (a, by, kind, knock, ph) {
  if (kind === 'impact') {
    const v = this.torso.linvel();
    let near = 99; for (const o of this.sim.fighters) if (o && o !== this) { const p = o.pos(), q = this.pos(); near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y)); }
    log.push({ a: a.toFixed(0), pre: this.pre[1].x.toFixed(1) + ',' + this.pre[1].y.toFixed(1), v: v.x.toFixed(1) + ',' + v.y.toFixed(1), g: this.grounded, near: near.toFixed(1), poise: this.poise.toFixed(2), sw: this.swing?.kind || '', it: this.item?.kind || '' });
  }
  return orig.call(this, a, by, kind, knock, ph);
};
for (let r = 0; r < 4; r++) {
  const level = buildLevel(randomCode(SETTINGS[r % 4]));
  const roster = [...Array(8)].map((_, slot) => ({ slot, ai: true }));
  const sim = new Sim(RAPIER, level, roster, { round: r });
  const bots = roster.map((x) => new Bot(sim, x.slot, 1, 'x' + r));
  for (let i = 0; i < 60 * 60 && sim.phase !== 'end'; i++) { const inp = []; for (const b of bots) inp[b.slot] = b.update(STEP); sim.step(inp); sim.drainEvents(); }
}
console.log(log.length, 'impact hurts'); console.table(log.slice(0, 25));
