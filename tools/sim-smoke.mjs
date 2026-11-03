// Headless smoke test of the simulation: node tools/sim-smoke.mjs [code]
import RAPIER from '@dimforge/rapier2d-compat';
import { buildLevel } from '../src/level/generate.js';
import { Sim } from '../src/sim/sim.js';
import { STEP } from '../src/core/consts.js';
await RAPIER.init();
const code = process.argv[2] || 'BXAH67KH';
const level = buildLevel(code);
const roster = [0,1,2,3].map(slot => ({ slot, name: 'F' + slot, ai: true }));
const sim = new Sim(RAPIER, level, roster, {});
const inputs = [];
const stat = (label) => {
  const s = sim.fighters.filter(Boolean).map(f => {
    const t = f.pos(), h = f.hip();
    return `#${f.slot} ${f.alive?'A':'D'} x${t.x.toFixed(1)} y${t.y.toFixed(2)} rot${f.torso.rotation().toFixed(2)} hipH? g${f.grounded?1:0} hp${f.hp.toFixed(0)} poise${f.poise.toFixed(2)}`;
  });
  console.log(label, '\n  ' + s.join('\n  '));
};
let t0 = performance.now();
for (let i = 0; i < 60 * 4; i++) sim.step(inputs);
stat('after 4s idle');
// walk right for 1s
for (const f of sim.fighters) if (f) inputs[f.slot] = { x: 1, y: 0, b: 0, jp: 0, ap: 0 };
const x0 = sim.fighters.map(f => f && f.pos().x);
for (let i = 0; i < 60; i++) sim.step(inputs);
stat('after 1s walking right');
console.log('dx', sim.fighters.filter(Boolean).map(f => (f.pos().x - x0[f.slot]).toFixed(2)).join(' '));
// jump
for (const f of sim.fighters) if (f) inputs[f.slot] = { x: 0, y: 0, b: 1, jp: 1, ap: 0 };
let maxY = sim.fighters.map(f => f && f.pos().y), y0 = maxY.slice();
for (let i = 0; i < 60; i++) { sim.step(inputs); sim.fighters.forEach(f => f && (maxY[f.slot] = Math.max(maxY[f.slot], f.pos().y))); }
console.log('jump height', sim.fighters.filter(Boolean).map(f => (maxY[f.slot]-y0[f.slot]).toFixed(2)).join(' '));
for (const f of sim.fighters) if (f) inputs[f.slot] = { x: 0, y: 0, b: 0, jp: 1, ap: 0 };
for (let i = 0; i < 90; i++) sim.step(inputs);
stat('after landing');
const ev = {}; for (const e of sim.drainEvents()) ev[e.t] = (ev[e.t]||0)+1;
console.log(ev, ((performance.now()-t0)/(sim.tick)).toFixed(2), 'ms/step');
