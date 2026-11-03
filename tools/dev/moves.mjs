// Every bare-hand move on a flat floor against a standing (or ducking, or airborne) target: jab, the jab-cross-hook
// combo, haymaker, uppercut, slam, stomp dive, kicks (front, roundhouse, sweep, flying), dropkick, plus reach and
// ducking checks, and the throw (a tap with something in hand).
// Prints damage, knockback, lift and whether the target staggered.   node tools/dev/moves.mjs
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../../src/level/generate.js';
import { Sim } from '../../src/sim/sim.js';
import { MAT, W, CELLS, ATK, NO_DIR, dirToByte, FIGHTER_HP } from '../../src/core/consts.js';
await RAPIER.init();
const flat = (dist) => {
  const level = buildLevel('BXAH67KH');
  level.grid = new Uint8Array(CELLS); for (let i = 0; i < W; i++) { level.grid[i] = MAT.BEDROCK; level.grid[W + i] = MAT.STONE; }
  level.props = []; level.pads = [];
  level.spawns = [{ x: 18, y: 2 }, { x: 18 + dist, y: 2 }];
  return level;
};
const idle = { x: 0, y: 0, b: 0, jp: 0, ap: 0, ak: 0, ad: NO_DIR };
let fails = 0;
// presses: [[step, ak, dir(rad) | null, stickY]]; setup(sim, f0, f1) runs after settling.
function trial(name, presses, { dist = 1.1, duck = false, setup = null, steps = 80, walk = 0, expect = (r) => r.dmg > 0 } = {}) {
  const sim = new Sim(RAPIER, flat(dist), [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
  const tIn = duck ? { ...idle, y: -1 } : idle;
  for (let i = 0; i < 160; i++) sim.step([idle, tIn]);
  const f0 = sim.fighters[0], f1 = sim.fighters[1];
  setup?.(sim, f0, f1);
  const hp0 = f1.hp, x0 = f1.pos().x, y0 = f1.pos().y;
  let ap = 0, ak = 0, ad = NO_DIR, sy = 0, maxY = y0, stag = false, hits = [];
  for (let i = 0; i < steps; i++) {
    for (const [at, k, dir, y = 0] of presses) if (at === i) { ap++; ak = k; ad = dir == null ? NO_DIR : dirToByte(dir); sy = y; }
    sim.step([{ ...idle, x: walk && f1.pos().x - f0.pos().x > 0.95 ? walk : 0, y: sy, ap, ak, ad }, tIn]);
    for (const e of sim.drainEvents()) if (e.t === 'hurt' && e.s === 1) hits.push(e.k + ':' + e.a);
    if (f1.poise < 0.3) stag = true;
    maxY = Math.max(maxY, f1.pos().y);
  }
  const r = { dmg: hp0 - f1.hp, push: f1.pos().x - x0, lift: maxY - y0, stag, hits, f0, f1, sim };
  const ok = expect(r);
  if (!ok) fails++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name.padEnd(30), 'dmg', r.dmg.toFixed(1).padStart(5), 'push', r.push.toFixed(2).padStart(5), 'lift', r.lift.toFixed(2).padStart(5), stag ? 'staggered' : '         ', hits.join(' '));
  sim.destroy();
}
console.log('HP', FIGHTER_HP);
trial('jab (stick aim)', [[2, ATK.NORMAL, null]]);
trial('jab (swiped right)', [[2, ATK.NORMAL, 0]]);
trial('jab, cross, hook: each harder', [[2, ATK.NORMAL, 0], [18, ATK.NORMAL, 0], [34, ATK.NORMAL, 0]], { dist: 0.85, walk: 1, expect: (r) => r.hits.length === 3 && +r.hits[2].split(':')[1] > +r.hits[0].split(':')[1] * 1.5 });
trial('haymaker', [[2, ATK.HEAVY, 0]], { expect: (r) => r.dmg > 20 && r.push > 2 });
trial('haymaker from 1.3 m', [[2, ATK.HEAVY, 0]], { dist: 1.3 });
trial('uppercut (swipe up)', [[2, ATK.UPPER, Math.PI / 2]], { dist: 0.9, expect: (r) => r.dmg > 0 && r.lift > 0.8 });
trial('uppercut (stick up + X)', [[2, ATK.NORMAL, null, 1]], { dist: 0.9, expect: (r) => r.hits.some((h) => h.startsWith('uppercut')) });
trial('slam (swipe down)', [[2, ATK.SLAM, -Math.PI / 2]], { dist: 0.9, expect: (r) => r.dmg > 0 && r.stag });
trial('slam hits a ducking target', [[2, ATK.SLAM, -Math.PI / 2]], { dist: 0.9, duck: true });
trial('stomp dive from above', [[1, ATK.SLAM, -Math.PI / 2]], { dist: 0.4, setup: (sim, f0, f1) => { const t = f1.pos(); f0.teleport(t.x - 0.1, t.y + 3.2, 0, { x: 0, y: 0 }); } , expect: (r) => r.dmg > 0 });
trial('kick', [[2, ATK.KICK, 0]], { expect: (r) => r.dmg > 0 && r.stag });
trial('kick from 1.2 m', [[2, ATK.KICK, 0]], { dist: 1.2 });
trial('mashing: a press mid-swing still lands', [[2, ATK.NORMAL, 0], [9, ATK.NORMAL, 0]], { dist: 0.85, walk: 1, expect: (r) => r.hits.length === 2 });
trial('kick from 1.6 m (out of reach)', [[2, ATK.KICK, 0]], { dist: 1.6, expect: (r) => r.dmg === 0 });
trial('dropkick from 2.5 m', [[2, ATK.DROPKICK, 0]], { dist: 2.5, expect: (r) => r.dmg > 15 && r.push > 2 });
trial('jab swiped left (miss)', [[2, ATK.NORMAL, Math.PI]], { expect: (r) => r.dmg === 0 });
trial('jab at a ducking target', [[2, ATK.NORMAL, 0]], { duck: true, expect: (r) => r.dmg === 0 });
trial('haymaker comes over a ducker', [[2, ATK.HEAVY, 0]], { duck: true });
trial('kick at a ducking target', [[2, ATK.KICK, 0]], { duck: true });
trial('roundhouse (kick swiped up)', [[2, ATK.KICK, 0.7]], { dist: 1.3, expect: (r) => r.dmg > 14 });
trial('sweep (crouch + kick) trips', [[4, ATK.KICK, -0.5, -1]], { dist: 1.15, expect: (r) => r.dmg > 0 && r.stag });
trial('sweep hits behind too', [[4, ATK.KICK, -0.5, -1]], { dist: -1.15, expect: (r) => r.dmg > 0 });
trial('flying kick at a run', [[16, ATK.KICK, 0]], { dist: 3.4, walk: 1, expect: (r) => r.dmg > 10 });
// Throw: a tap (ATK.THROW) throws what's in hand along the aim; with empty hands it's a jump.
{
  const sim = new Sim(RAPIER, flat(6), [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
  for (let i = 0; i < 160; i++) sim.step([idle, idle]);
  const f0 = sim.fighters[0];
  f0.item = { kind: 'axe', ammo: Infinity, id: 999 };
  let thrown = null;
  for (let i = 0; i < 30; i++) {
    sim.step([{ ...idle, ap: i >= 2 ? 1 : 0, ak: ATK.THROW, ad: dirToByte(0.35) }, idle]);
    for (const e of sim.drainEvents()) if (e.t === 'throw') thrown = e;
  }
  const it = [...sim.items.world.values()][0];
  const v = it && it.body.linvel();
  const ok = thrown && !f0.item && v && v.x > 6;
  if (!ok) fails++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' throw: a tap, aimed 20° up'.padEnd(35), thrown ? 'thrown, flying at ' + (v ? `${v.x.toFixed(1)}, ${v.y.toFixed(1)}` : '?') : 'not thrown');
  sim.destroy();
}
{
  const sim = new Sim(RAPIER, flat(6), [{ slot: 0, ai: true }, { slot: 1, ai: true }], {});
  for (let i = 0; i < 160; i++) sim.step([idle, idle]);
  const y0 = sim.fighters[0].pos().y;
  let top = y0;
  for (let i = 0; i < 30; i++) { sim.step([{ ...idle, ap: i >= 2 ? 1 : 0, ak: ATK.THROW, ad: 255 }, idle]); top = Math.max(top, sim.fighters[0].pos().y); }
  const ok = top - y0 > 1.5;
  if (!ok) fails++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' a tap with empty hands jumps'.padEnd(35), 'rose', (top - y0).toFixed(2));
  sim.destroy();
}
console.log(fails ? fails + ' failed' : 'all as expected');
