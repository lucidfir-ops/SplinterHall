import { buildLevel, encodeEdits, ARCHETYPES, generateBase } from '../../src/level/generate.js';
import { randomCode, parseCode } from '../../src/core/codes.js';
import { SETTINGS, MAT, CELLS } from '../../src/core/consts.js';
let bad = 0, lens = [];
for (let k = 0; k < 200; k++) {
  const code = randomCode(SETTINGS[k % 4]);
  const L = buildLevel(code);
  const c0 = encodeEdits(code, L.setting, L);
  if (c0 !== code) { bad++; if (bad < 4) console.log('unedited', code, c0.length); }
  // make some edits, round trip
  const n = 5 + (k % 40);
  for (let e = 0; e < n; e++) L.grid[(k * 97 + e * 131) % CELLS] = e % 3 ? MAT.WOOD : 0;
  L.props.push({ kind: 'barrel', x: 10.5, y: 12 });
  const c1 = encodeEdits(code, L.setting, L);
  const L2 = buildLevel(c1);
  let diff = 0; for (let c = 0; c < CELLS; c++) if (L2.grid[c] !== L.grid[c]) diff++;
  if (diff || L2.props.length !== L.props.length) { bad++; if (bad < 8) console.log('roundtrip', code, diff, L2.props.length, L.props.length); }
  lens.push(c1.length);
  // archetype override round trip
  const arch = ARCHETYPES[(ARCHETYPES.indexOf(L.archetype) + 1) % 5];
  const A = generateBase(code, L.setting, arch);
  const c2 = encodeEdits(code, L.setting, A);
  const A2 = buildLevel(c2);
  if (A2.archetype !== arch) { bad++; if (bad < 12) console.log('arch', code, A2.archetype, arch); }
}
lens.sort((a, b) => a - b);
console.log('bad', bad, 'custom code length median', lens[100], 'max', lens[199]);
