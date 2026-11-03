// Fast pose check without WebGL: runs the move reel's scenes in Node and draws contact sheets of the skeletons
// (side view as the camera sees it, and a top view underneath to show depth) with tools/dev/posesheet.py.
//   node tools/dev/poses.mjs <outdir> [only=a,b] [every=3]
import RAPIER from '@dimforge/rapier2d-compat';
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { Sim } from '../../src/sim/sim.js';
import { practiceLevel } from '../../src/level/practice.js';
import { SCENES, ME, DUMMY, DUMMY2, stage, sceneInput } from '../../src/game/reel-scenes.js';
import { FIGHTER_HP } from '../../src/core/consts.js';
await RAPIER.init();
const out = path.resolve(process.argv[2] || 'poses-out');
const arg = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
const every = +(arg.every || 3);
const only = arg.only ? arg.only.split(',') : null;
fs.mkdirSync(out, { recursive: true });
const sim = new Sim(RAPIER, practiceLevel(ME, DUMMY), [{ slot: ME, ai: false }, { slot: DUMMY, ai: true }, { slot: DUMMY2, ai: true }], { practice: true, dropRate: 'none' });
while (sim.phase !== 'fight') sim.step([]);
const data = [];
SCENES.forEach((sc, k) => {
  if (only && !only.includes(sc.id)) return;
  stage(sim, sc, k);
  const st = { ap: 0, jp: 0, ak: 0, ad: 255 };
  const frames = [];
  const ev = [];
  for (let s = 0; s < sc.len; s++) {
    const inp = []; inp[ME] = sceneInput(sim, sc, s, st);
    sim.step(inp);
    for (const e of sim.drainEvents()) if (e.t === 'hurt' || e.t === 'swing') ev.push([s, e.t, e.k, e.s, Math.round(e.a || 0)]);
    for (const slot of [DUMMY, DUMMY2]) { const d = sim.fighters[slot]; if (d && d.alive && d.hp < FIGHTER_HP * 0.4) d.hp = FIGHTER_HP; }
    if (s % every === 0) {
      const fr = sim.frame();
      frames.push({ s, f: fr.fighters.filter((x) => x.parts[4] > -5 && x.parts[3] < 45).map((x) => ({ slot: x.slot, j: Array.from(x.joints, (v) => +v.toFixed(3)), item: x.item, up: x.wup, move: x.move, rag: sim.fighters[x.slot].anim.rag })) });
    }
  }
  data.push({ id: sc.id, name: sc.name, frames, ev });
  console.log(sc.id.padEnd(12), ev.filter((e) => e[1] === 'hurt').map((e) => `${e[0]}:${e[2]}:${e[4]}`).join(' '));
});
fs.writeFileSync(path.join(out, 'poses.json'), JSON.stringify(data));
execFileSync('python3', [path.resolve('tools/dev/posesheet.py'), path.join(out, 'poses.json'), out], { stdio: 'inherit' });
