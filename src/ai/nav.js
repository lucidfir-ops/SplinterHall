// Navigation for AI fighters: the level's standable cells and the jumps and drops between them,
// rebuilt (at most once a second) as the terrain breaks.
//
// This is the AI's own map. The level generator's reachMap stays as it is, because level codes must keep
// building the same levels; here the jumps match how high fighters really jump now, and the headroom test is
// strict (rise in the start column, then cross at the target's height), so bots stop planning jumps into
// overhangs.
import { W, H, CELLS, cellIndex, inGrid } from '../core/consts.js';
import { standable } from '../level/generate.js';

export const NAV_MAX_UP = 4; // cells: a jump and a double jump

export function navMap(grid) {
  const st = [];
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) if (standable(grid, i, j)) st.push(cellIndex(i, j));
  const isSt = new Uint8Array(CELLS);
  for (const c of st) isSt[c] = 1;
  const solid = (a, b) => inGrid(a, b) && grid[cellIndex(a, b)] !== 0;
  const nb = (c) => {
    const i = c % W, j = (c / W) | 0, out = [];
    for (let dy = -H; dy <= NAV_MAX_UP; dy++) {
      const maxDx = dy >= 4 ? 2 : dy === 3 ? 3 : dy === 2 ? 4 : dy >= 0 ? 5 : 6;
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        if (dx === 0) continue; // straight up or down: there's a floor or a ceiling in the way
        const ni = i + dx, nj = j + dy;
        if (!inGrid(ni, nj) || !isSt[cellIndex(ni, nj)]) continue;
        const s = Math.sign(dx);
        let ok = true;
        if (dy > 0) {
          // Rise in the start column to the target height, with room for the body…
          for (let y = j; y <= nj + 1 && ok; y++) if (solid(i, y)) ok = false;
          // …then cross over at that height.
          for (let x = i + s; x !== ni + s && ok; x += s) if (solid(x, nj) || solid(x, nj + 1)) ok = false;
        } else if (dy === 0) {
          // Walk or hop across at the same height.
          for (let x = i + s; x !== ni + s && ok; x += s) if (solid(x, j) || solid(x, j + 1)) ok = false;
        } else {
          // Step off at the start height to above the target column, then fall straight down it.
          for (let x = i + s; x !== ni + s && ok; x += s) if (solid(x, j) || solid(x, j + 1)) ok = false;
          for (let y = j; y > nj && ok; y--) if (solid(ni, y)) ok = false;
        }
        if (ok) out.push(cellIndex(ni, nj));
      }
    }
    return out;
  };
  const adj = new Map();
  for (const c of st) adj.set(c, nb(c));
  return { st, adj };
}

export class Nav {
  constructor(sim) {
    this.sim = sim;
    this.builtAt = -99;
    this.brokenSeen = -1;
    this.adj = new Map();
    this.cache = new Map();
    this.rebuild();
  }

  rebuild() {
    // Only fixed blocks count: loose and falling blocks have left their cells.
    const t = this.sim.terrain;
    const g = new Uint8Array(t.grid.length);
    for (let c = 0; c < g.length; c++) if (t.state[c] === 1) g[c] = t.grid[c];
    const { adj } = navMap(g);
    this.adj = adj;
    this.grid = g;
    this.builtAt = this.sim.time;
    this.cache.clear();
  }

  update() {
    const broken = this.sim.terrain.brokenCount || 0;
    if (broken !== this.brokenSeen && this.sim.time - this.builtAt > 1) { this.brokenSeen = broken; this.rebuild(); }
  }

  // The standable cell nearest a world point (feet position), within a small radius.
  cellAt(x, y) {
    const i0 = Math.floor(x), j0 = Math.floor(y + 0.1);
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, j = j0 + dj;
      if (!inGrid(i, j) || !this.adj.has(cellIndex(i, j))) continue;
      const d = Math.abs(di) + Math.abs(dj) * 1.5 + (dj > 0 ? 2 : 0);
      if (d < bd) { bd = d; best = cellIndex(i, j); }
    }
    return best;
  }

  // Shortest path (by hops) from cell a to cell b, avoiding banned edges ('a>b' keys). Returns cells or null.
  path(a, b, banned = null) {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    const useCache = !banned || banned.size === 0;
    const key = a * 4096 + b;
    if (useCache && this.cache.has(key)) return this.cache.get(key);
    const prev = new Map([[a, -1]]);
    const q = [a];
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      if (c === b) break;
      for (const n of this.adj.get(c) || []) {
        if (prev.has(n) || (banned && banned.has(c + '>' + n))) continue;
        prev.set(n, c); q.push(n);
      }
      if (q.length > 4000) break;
    }
    let out = null;
    if (prev.has(b)) {
      out = [];
      for (let c = b; c !== -1; c = prev.get(c)) out.push(c);
      out.reverse();
    }
    if (useCache) {
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, out);
    }
    return out;
  }

  // Cells reachable from a, nearest first by hops (for wandering when the goal can't be reached).
  around(a, max = 60) {
    if (a < 0) return [];
    const seen = new Set([a]), q = [a];
    for (let k = 0; k < q.length && q.length < max; k++) for (const n of this.adj.get(q[k]) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    return q;
  }
}

export const cellX = (c) => (c % W) + 0.5;
export const cellY = (c) => ((c / W) | 0);
