// Print levels as ASCII and run the level checks: node tools/levels-ascii.mjs [count|code...]
import { buildLevel, checkLevel, levelHash } from '../src/level/generate.js';
import { randomCode } from '../src/core/codes.js';
import { W, H, cellIndex, SETTINGS } from '../src/core/consts.js';
const CH = ['.', '#', 'o', '=', 'H', '~', '|'];
const args = process.argv.slice(2);
let codes = args.filter(a => /[A-Z]/i.test(a));
const n = +args.find(a => /^\d+$/.test(a)) || 0;
if (!codes.length && !n) codes = SETTINGS.map(s => randomCode(s));
const show = codes.length > 0;
if (n) codes = Array.from({ length: n }, (_, k) => randomCode(SETTINGS[k % 4]));
let fails = 0, attempts = {}, arch = {}, t0 = Date.now(), mismatch = 0;
for (const code of codes) {
  const L = buildLevel(code);
  const L2 = buildLevel(code);
  if (levelHash(L) !== levelHash(L2)) mismatch++;
  const chk = checkLevel(L);
  if (!chk.ok) fails++;
  attempts[L.attempt] = (attempts[L.attempt] || 0) + 1;
  arch[L.setting + ':' + L.archetype] = (arch[L.setting + ':' + L.archetype] || 0) + 1;
  if (show) {
    console.log(`\n${code} ${L.setting} ${L.archetype} sym=${L.sym} attempt=${L.attempt} ok=${chk.ok} ${chk.reason || ''} open=${chk.openFrac.toFixed(2)} reach=${(chk.reachFrac||0).toFixed(2)} spawns=${L.spawns.length}`);
    const rows = [];
    for (let j = H - 1; j >= 0; j--) {
      let s = '';
      for (let i = 0; i < W; i++) {
        let ch = CH[L.grid[cellIndex(i, j)]];
        if (L.spawns.some(p => Math.floor(p.x) === i && Math.floor(p.y) === j)) ch = 'S';
        else if (L.pads.some(p => Math.floor(p.x) === i && Math.floor(p.y) === j)) ch = 'P';
        else if (L.props.some(p => Math.floor(p.x) === i && Math.floor(p.y) === j)) ch = 'p';
        s += ch;
      }
      rows.push(s);
    }
    console.log(rows.join('\n'));
  }
}
console.log(`\n${codes.length} levels, ${fails} failed checks, ${mismatch} non-deterministic, attempts`, attempts, `${((Date.now()-t0)/codes.length).toFixed(1)} ms/level`);
console.log(arch);
