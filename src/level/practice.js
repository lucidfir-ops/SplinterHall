// The practice room (Learn and the move reel): a floor ending in a pit on the right, a tall wall on the left
// for wall jumps, a box to hop.
import { W, H, MAT, cellIndex, CELLS } from '../core/consts.js';

export const SPAWN = { x: 7, y: 3 };
export const DUMMY = { x: 24, y: 3 };
export const PIT_X = 33;

// The practice room: a floor ending in a pit on the right, a tall wall on the left for wall jumps, a box to hop.
export function practiceLevel(slot = 0, dummySlot = 7) {
  const g = new Uint8Array(CELLS);
  const set = (i, j, m) => { if (i >= 0 && i < W && j >= 0 && j < H) g[cellIndex(i, j)] = m; };
  for (let i = 0; i < PIT_X; i++) { set(i, 0, MAT.BEDROCK); set(i, 1, MAT.BEDROCK); set(i, 2, MAT.STONE); } // a floor practice can't break through
  for (let j = 0; j < H; j++) set(0, j, j === 0 ? MAT.BEDROCK : MAT.STONE);    // left wall, full height (wall jumps)
  for (let i = 14; i <= 16; i++) for (let j = 3; j <= 4; j++) set(i, j, MAT.STONE); // box (jump)
  for (let j = 3; j <= 4; j++) set(PIT_X - 1, j, MAT.GLASS);                      // a glass lip at the pit's edge
  return { base: 'PRACTICE', code: 'PRACTICE', setting: 'hall', archetype: 'practice', sym: false, attempt: 0, grid: g,
    spawns: Array.from({ length: 8 }, (_, k) => (k === slot ? SPAWN : DUMMY)), pads: [], props: [] };
}

