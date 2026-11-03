// The gesture square's swipe classifier against a table of swipes (shares of the square; y grows downward).
//   node tools/dev/gestures-unit.mjs
import { classifySwipe } from '../../src/ui/input.js';
import { ATK } from '../../src/core/consts.js';
const N = { [ATK.NORMAL]: 'jab', [ATK.HEAVY]: 'haymaker', [ATK.KICK]: 'kick', [ATK.UPPER]: 'uppercut', [ATK.SLAM]: 'slam', [ATK.DROPKICK]: 'dropkick' };
const cases = [
  // x0, y0, dx, dy, expected kind, expected direction (deg, world: 0 right, 90 up)
  [0.5, 0.3, 0.25, 0, 'jab', 0],
  [0.5, 0.3, -0.25, 0, 'jab', 180],
  [0.5, 0.4, 0, -0.3, 'uppercut', 90],
  [0.5, 0.2, 0.05, 0.35, 'slam', -82],
  [0.5, 0.4, 0.22, -0.2, 'jab', 42],          // diagonal: a jab that way
  [0.5, 0.3, 0.2, 0.25, 'jab', -51],
  [0.85, 0.3, -0.7, 0.05, 'haymaker', -176],
  [0.15, 0.25, 0.65, -0.1, 'haymaker', 9],
  [0.8, 0.45, -0.55, -0.45, 'jab', 141],   // big but diagonal: a jab up and back
  [0.7, 0.8, -0.4, 0.02, 'kick', -177],
  [0.2, 0.75, 0.6, 0, 'dropkick', 0],       // a long sweep in the band is a dropkick
  [0.5, 0.6, 0.3, 0.2, 'kick', -34],        // starts just above the band, travels into it
  [0.5, 0.8, 0.05, -0.4, 'uppercut', 83],   // upward from the band: not a kick
];
let bad = 0;
for (const [x0, y0, dx, dy, kind, deg] of cases) {
  const c = classifySwipe(x0, y0, dx, dy);
  const d = Math.round(c.angle * 180 / Math.PI);
  const diff = Math.abs(((d - deg) % 360 + 540) % 360 - 180);
  const ok = N[c.kind] === kind && diff <= 2;
  if (!ok) bad++;
  console.log(ok ? 'ok  ' : 'FAIL', `from (${x0},${y0}) by (${dx},${dy})`.padEnd(32), N[c.kind].padEnd(9), d + '°', ok ? '' : `expected ${kind} ${deg}°`);
}
console.log(bad ? bad + ' failed' : 'all as expected');
process.exit(bad ? 1 : 0);
