// Seeded level generator. The same code builds the same level on every device, block for block.
import { W, H, CELLS, MAT, cellIndex, inGrid, PROPS } from '../core/consts.js';
import { makeRng } from '../core/rng.js';
import { parseCode, ByteReader, ByteWriter, makeCustomCode } from '../core/codes.js';

export const ARCHETYPES = ['islands', 'towers', 'pit', 'cavern', 'span'];

const ARCH_WEIGHTS = {
  bunker: [['towers', 3], ['pit', 3], ['span', 2], ['islands', 1], ['cavern', 1]],
  forge: [['islands', 4], ['span', 3], ['cavern', 2], ['towers', 1], ['pit', 1]],
  fjord: [['pit', 3], ['islands', 3], ['span', 2], ['cavern', 1], ['towers', 1]],
  hall: [['towers', 4], ['span', 2], ['pit', 2], ['cavern', 1], ['islands', 1]],
};

const PALETTE = {
  bunker: { mass: MAT.STONE, skin: MAT.STONE, bridge: MAT.IRON, beam: MAT.IRON, weak: MAT.GLASS, timber: MAT.WOOD },
  forge: { mass: MAT.STONE, skin: MAT.STONE, bridge: MAT.IRON, beam: MAT.IRON, weak: MAT.WOOD, timber: MAT.WOOD },
  fjord: { mass: MAT.STONE, skin: MAT.ICE, bridge: MAT.WOOD, beam: MAT.WOOD, weak: MAT.ICE, timber: MAT.WOOD },
  hall: { mass: MAT.STONE, skin: MAT.WOOD, bridge: MAT.WOOD, beam: MAT.IRON, weak: MAT.WOOD, timber: MAT.WOOD, base: MAT.STONE, upper: MAT.WOOD },
};

const PROP_WEIGHTS = {
  bunker: [['crate', 3], ['barrel', 3], ['boulder', 1], ['plank', 1], ['lantern', 1]],
  forge: [['barrel', 4], ['chain', 3], ['crate', 2], ['boulder', 1]],
  fjord: [['boulder', 3], ['crate', 2], ['plank', 2], ['barrel', 1], ['lantern', 1]],
  hall: [['barrel', 3], ['crate', 3], ['lantern', 3], ['chain', 1], ['plank', 1]],
};

// ---------------------------------------------------------------- grid helpers
class Grid {
  constructor() { this.m = new Uint8Array(CELLS); }
  get(i, j) { return inGrid(i, j) ? this.m[cellIndex(i, j)] : 0; }
  set(i, j, v) { if (inGrid(i, j)) this.m[cellIndex(i, j)] = v; }
  solid(i, j) { return this.get(i, j) !== 0; }
}

function makeStamp(g, sym) {
  const put = (i, j, v, force = true) => {
    if (!inGrid(i, j)) return;
    if (!force && g.get(i, j) === MAT.BEDROCK) return;
    g.set(i, j, v);
  };
  return {
    cell(i, j, v) { put(i, j, v); if (sym) put(W - 1 - i, j, v); },
    soft(i, j, v) { put(i, j, v, false); if (sym) put(W - 1 - i, j, v, false); },
    rect(i0, j0, w, h, v) {
      for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) this.cell(i, j, v);
    },
    clear(i0, j0, w, h) {
      for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) {
        if (g.get(i, j) !== MAT.BEDROCK) { put(i, j, 0); if (sym) put(W - 1 - i, j, 0); }
      }
    },
  };
}

// ---------------------------------------------------------------- archetypes
// Each draws solid shapes with palette materials. `half` is the width to fill when mirrored.
function buildIslands(g, r, P, sym) {
  const S = makeStamp(g, sym);
  const span = sym ? W / 2 : W;
  let surface = r.int(3, 5);
  let tier = 0;
  while (surface < H - 3) {
    let x = r.int(0, 3) + (tier % 2 ? r.int(1, 3) : 0);
    let placed = 0;
    while (x < span - 3) {
      const w = r.int(4, 9);
      const t = r.int(1, 3);
      const wEff = Math.min(w, span - x - (sym ? 0 : 1));
      if (wEff >= 3 && (r.chance(0.78) || placed === 0)) {
        // Taper downward: a floating rock.
        for (let k = 0; k < t + 1; k++) {
          const j = surface - 1 - k;
          if (j < 0) break;
          const inset = k === 0 ? 0 : Math.min(k + r.int(0, 1), Math.floor(wEff / 2) - 1);
          const mat = k === 0 ? P.skin : P.mass;
          for (let i = x + inset; i < x + wEff - inset; i++) S.cell(i, j, mat);
        }
        // Rune anchor at the bottom middle.
        const mid = x + Math.floor(wEff / 2);
        const bj = Math.max(0, surface - 1 - Math.min(t, 2));
        S.cell(mid, bj, MAT.BEDROCK);
        if (wEff >= 7) S.cell(mid - 1, bj, MAT.BEDROCK);
        // Occasional weak feature: a timber lip or a glass/ice crown.
        if (r.chance(0.3)) S.rect(x + wEff, surface - 1, r.int(1, 2), 1, P.timber);
        placed++;
      }
      x += wEff + r.int(2, 5);
    }
    surface += r.int(3, 4);
    tier++;
  }
}

function buildTowers(g, r, P, sym) {
  const S = makeStamp(g, sym);
  const span = sym ? W / 2 : W;
  const count = sym ? r.int(2, 3) : r.int(3, 5);
  const xs = [];
  const step = span / count;
  for (let k = 0; k < count; k++) xs.push(Math.floor(step * k + r.float(1, step - 4)));
  const towers = [];
  for (const x of xs) {
    const w = r.int(2, 4);
    const base = r.int(2, 6);
    const tall = r.int(10, H - 4);
    S.rect(x, 0, w, base, MAT.BEDROCK);
    S.rect(x, base, w, tall - base, P.base || P.mass);
    // Upper part in the main material for the hall (timber on stone).
    if (P.upper) S.rect(x, base + 3, w, tall - base - 3, P.upper);
    // Cap platform.
    const capW = w + r.int(2, 4);
    const cx = x - Math.floor((capW - w) / 2);
    S.rect(cx, tall, capW, 1, P.skin);
    // Side ledges for climbing.
    for (let j = base + 3; j < tall - 1; j += r.int(3, 4)) {
      if (r.chance(0.6)) S.rect(x - r.int(1, 2), j, 1 + r.int(0, 1), 1, P.beam);
      if (r.chance(0.6)) S.rect(x + w, j, 1 + r.int(0, 1), 1, P.beam);
    }
    // Weak window in the bunker / hall towers.
    if (r.chance(0.5) && tall - base > 6) {
      const wj = r.int(base + 2, tall - 3);
      S.rect(x + (w > 2 ? 1 : 0), wj, Math.max(1, w - 2), 2, P.weak);
    }
    towers.push({ x, w, base, tall });
  }
  // Bridges between neighbours.
  for (let k = 0; k < towers.length - 1; k++) {
    const a = towers[k], b = towers[k + 1];
    const lo = Math.max(a.base + 2, b.base + 2);
    const hi = Math.min(a.tall, b.tall) - 1;
    if (hi <= lo) continue;
    const nb = r.int(1, 2);
    for (let n = 0; n < nb; n++) {
      const j = r.int(lo, hi);
      S.rect(a.x + a.w, j, b.x - (a.x + a.w), 1, P.bridge);
    }
  }
  // Mirror seam bridge for symmetric levels.
  if (sym && towers.length) {
    const t = towers[towers.length - 1];
    const j = r.int(t.base + 2, Math.max(t.base + 3, t.tall - 2));
    S.rect(t.x + t.w, j, W / 2 - (t.x + t.w), 1, P.bridge);
  }
  // A low walkway near the bottom.
  if (r.chance(0.6)) {
    const j = r.int(2, 4);
    const x0 = r.int(2, 8);
    S.rect(x0, j, span - x0 - (sym ? 0 : 2), 1, P.bridge);
  }
  // Floating slabs high up.
  for (let n = 0; n < r.int(1, 2); n++) {
    const x = r.int(2, span - 7), j = r.int(H - 7, H - 3), w = r.int(3, 6);
    S.rect(x, j, w, 1, P.skin);
    S.cell(x + Math.floor(w / 2), j, MAT.BEDROCK);
  }
}

function buildPit(g, r, P, sym) {
  const S = makeStamp(g, true); // pits are always built symmetric, then perturbed
  const a = r.int(7, 11);
  const hl = r.int(10, 15);
  const floor = r.int(3, 6);
  // Side masses with stepped inner edges.
  for (let i = 0; i < a; i++) {
    const top = hl + Math.round(Math.sin(i * 0.7 + r.float(0, 6)) * 1.2);
    S.rect(i, 0, 1, top, P.mass);
  }
  let x = a, j = hl - 1;
  while (j > floor + 1 && x < W / 2 - 3) {
    const w = r.int(1, 3);
    S.rect(x, 0, w, j, P.mass);
    x += w;
    j -= r.int(1, 3);
  }
  // Pit floor.
  S.rect(x, 0, W / 2 - x, floor, P.mass);
  if (r.chance(0.5)) S.clear(W / 2 - r.int(1, 2), 0, 4, floor); // a hole into the depths
  // Bedrock anchors along the bottom.
  for (let i = 1; i < W / 2; i += r.int(4, 7)) S.cell(i, 0, MAT.BEDROCK);
  S.cell(1, 1, MAT.BEDROCK);
  // Overhang from the top of each mass.
  const ow = r.int(3, 6);
  S.rect(a - 1, hl + 1, ow, 1, P.beam);
  // Tunnel into the mass.
  if (r.chance(0.7)) {
    const tj = r.int(floor + 2, hl - 4);
    S.clear(Math.max(2, a - r.int(4, 7)), tj, 8, 3);
  }
  // Skin on top surfaces.
  skinTops(g, P);
  // Floating platform over the middle.
  const pj = r.int(hl - 1, Math.min(H - 3, hl + 5));
  const pw = r.int(2, 4);
  S.rect(W / 2 - pw, pj, pw, 1, P.skin);
  S.cell(W / 2 - 1, pj, MAT.BEDROCK);
  // Glass or ice windows in the masses.
  if (r.chance(0.6)) S.rect(r.int(2, a - 3), r.int(floor + 2, hl - 3), 2, 2, P.weak);
}

function buildCavern(g, r, P, sym) {
  const S = makeStamp(g, sym);
  const span = sym ? W / 2 : W;
  const base = r.int(7, 10);
  const ph = r.float(0, 10);
  for (let i = 0; i < span; i++) {
    const top = base + Math.round(Math.sin(i * 0.31 + ph) * 2 + Math.sin(i * 0.11 + ph * 2) * 2);
    S.rect(i, 0, 1, Math.max(3, top), P.mass);
  }
  // Worm tunnels from the surface downward and sideways.
  const worms = r.int(2, 3);
  for (let n = 0; n < worms; n++) {
    let wx = r.float(3, span - 3), wy = base + 2, ang = -Math.PI / 2 + r.float(-0.8, 0.8);
    const len = r.int(18, 34);
    for (let s = 0; s < len; s++) {
      const rad = 1.6;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (di * di + dj * dj <= rad * rad + 0.5) {
          const ci = Math.round(wx + di), cj = Math.round(wy + dj);
          if (cj >= 1 && g.get(ci, cj) !== MAT.BEDROCK) S.clear(ci, cj, 1, 1);
        }
      }
      wx += Math.cos(ang); wy += Math.sin(ang) * 0.7;
      ang += r.float(-0.5, 0.5);
      if (wy < 3) ang = Math.abs(ang);
      if (wx < 2 || wx > span - 1) ang = Math.PI - ang;
    }
  }
  // Bedrock at the bottom row in places.
  for (let i = 0; i < span; i += r.int(3, 5)) S.cell(i, 0, MAT.BEDROCK);
  skinTops(g, P);
  // Platforms above.
  for (let n = 0; n < r.int(2, 4); n++) {
    const x = r.int(1, span - 6), j = r.int(base + 4, H - 4), w = r.int(3, 7);
    S.rect(x, j, w, 1, P.skin);
    S.cell(x + Math.floor(w / 2), j, MAT.BEDROCK);
  }
}

function buildSpan(g, r, P, sym) {
  const S = makeStamp(g, sym);
  const span = sym ? W / 2 : W;
  const d = r.int(6, 10);
  const th = r.int(1, 2);
  S.rect(2, d - th, span - 2, th, P.bridge === MAT.IRON ? P.mass : P.bridge);
  S.rect(2, d, span - 2, 1, P.skin);
  if (r.chance(0.35)) S.clear(span - 2, d - th, sym ? 2 : 3, th + 1); // gap in the middle
  // Piers with arches.
  const piers = sym ? r.int(1, 2) : r.int(2, 4);
  const pxs = [];
  for (let k = 0; k < piers; k++) pxs.push(Math.floor(3 + (k + 0.5) * (span - 6) / piers + r.float(-2, 2)));
  for (const px of pxs) {
    const pw = r.int(2, 3);
    S.rect(px, 0, pw, d - th - 2, MAT.BEDROCK);
    S.rect(px - 1, d - th - 2, pw + 2, 2, P.mass);
  }
  // Upper buildings: hollow huts and towers on the deck.
  const huts = r.int(1, 2);
  for (let n = 0; n < huts; n++) {
    const hx = r.int(3, span - 8), hw = r.int(4, 6), hh = r.int(3, 5);
    S.rect(hx, d + 1, 1, hh, P.timber);
    S.rect(hx + hw - 1, d + 1, 1, hh, P.timber);
    S.rect(hx - 1, d + 1 + hh, hw + 2, 1, P.beam);
    if (r.chance(0.5)) S.rect(hx + 1, d + 1 + hh + 1, hw - 2, 1, P.weak);
  }
  // High perches.
  for (let n = 0; n < r.int(2, 3); n++) {
    const x = r.int(1, span - 5), j = r.int(d + 5, H - 3), w = r.int(3, 5);
    S.rect(x, j, w, 1, P.skin);
    S.cell(x + Math.floor(w / 2), j, MAT.BEDROCK);
  }
  // Ledges under the deck.
  if (r.chance(0.6)) S.rect(r.int(3, span - 7), d - th - r.int(3, 4), r.int(3, 5), 1, P.beam);
}

function skinTops(g, P) {
  if (P.skin === P.mass) return;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = g.get(i, j);
    if (v === P.mass && !g.solid(i, j + 1)) g.set(i, j, P.skin);
  }
}

// ---------------------------------------------------------------- analysis
// Standable = empty cell with solid below and two empty cells above it.
export function standable(grid, i, j) {
  const s = (a, b) => inGrid(a, b) && grid[cellIndex(a, b)] !== 0;
  return inGrid(i, j) && !s(i, j) && s(i, j - 1) && !s(i, j + 1) && (j + 2 >= H || !s(i, j + 2));
}

// Reachability over standable cells (walk, jump up to 3, drop anywhere).
export function reachMap(grid) {
  const st = [];
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) if (standable(grid, i, j)) st.push(cellIndex(i, j));
  const isSt = new Uint8Array(CELLS);
  for (const c of st) isSt[c] = 1;
  const solid = (a, b) => inGrid(a, b) && grid[cellIndex(a, b)] !== 0;
  // Neighbours: any standable cell within dx<=4, dy in [-inf..3], with a clear line approximately.
  const nb = (c) => {
    const i = c % W, j = (c / W) | 0, out = [];
    for (let dy = -H; dy <= 3; dy++) {
      const maxDx = dy >= 3 ? 2 : dy >= 2 ? 3 : dy >= 0 ? 4 : 5;
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const ni = i + dx, nj = j + dy;
        if (!inGrid(ni, nj) || !isSt[cellIndex(ni, nj)] || (dx === 0 && dy === 0)) continue;
        // Crude clearance test: the cells straight up from the start (for jumps) and the path line.
        let ok = true;
        const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
        const peak = Math.max(j, nj) + (dy >= 0 ? 1 : 0);
        for (let s = 1; s < steps && ok; s++) {
          const t = s / steps;
          const px = Math.round(i + dx * t);
          const py = Math.round(dy > 0 ? j + (peak - j) * Math.min(1, t * 2) : j + dy * t * t);
          if (solid(px, py) || solid(px, py + 1)) ok = false;
        }
        if (dy < 0 && dx !== 0) {
          // Dropping: need to step off the edge, then fall in the column of the target.
          ok = true;
          const ex = i + Math.sign(dx);
          if (solid(ex, j) || solid(ex, j + 1)) ok = false;
          for (let y = j; y > nj && ok; y--) if (solid(ni, y)) ok = false;
        }
        if (ok) out.push(cellIndex(ni, nj));
      }
    }
    return out;
  };
  const adj = new Map();
  for (const c of st) adj.set(c, nb(c));
  // Strongly connected parts are expensive; use mutual reachability from the most connected start.
  const reach = (start, forward) => {
    const seen = new Set([start]);
    const q = [start];
    // reverse edges if needed
    let radj = null;
    if (!forward) {
      radj = new Map();
      for (const [a, list] of adj) for (const b of list) { if (!radj.has(b)) radj.set(b, []); radj.get(b).push(a); }
    }
    while (q.length) {
      const c = q.pop();
      for (const n of (forward ? adj.get(c) : radj.get(c) || [])) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return seen;
  };
  return { st, adj, reach };
}

// The biggest set of standable cells that can all reach each other (sampled starts).
function mainSet(st, reach) {
  let best = new Set();
  const samples = st.length > 28 ? st.filter((_, k) => k % Math.ceil(st.length / 28) === 0) : st;
  for (const s of samples) {
    if (best.has(s)) continue;
    const f = reach(s, true), b = reach(s, false);
    const m = new Set([...f].filter((c) => b.has(c)));
    if (m.size > best.size) best = m;
  }
  return best;
}

// Add stepping slabs until the standable regions can reach each other.
function connect(g, r, P, sym) {
  const tried = new Set();
  const free = (i, j) => inGrid(i, j) && !g.solid(i, j);
  // An edge cell can be approached from beside / below: the side cell and the one under it are open.
  const edgeSide = (c) => {
    const i = c % W, j = (c / W) | 0;
    if (free(i - 1, j) && free(i - 1, j - 1)) return -1;
    if (free(i + 1, j) && free(i + 1, j - 1)) return 1;
    return 0;
  };
  for (let pass = 0; pass < 24; pass++) {
    const { st, reach } = reachMap(g.m);
    if (st.length < 2) return;
    const main = mainSet(st, reach);
    const rest = st.filter((c) => !main.has(c) && !tried.has(c));
    if (!rest.length) return;
    const restSet = new Set(rest);
    const seen = new Set();
    let biggest = null;
    for (const c of rest) {
      if (seen.has(c)) continue;
      const q = [c], reg = [];
      seen.add(c);
      while (q.length) {
        const k = q.pop();
        reg.push(k);
        const i = k % W, j = (k / W) | 0;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i + 1, j + 1], [i - 1, j + 1], [i + 1, j - 1], [i - 1, j - 1]]) {
          if (!inGrid(a, b)) continue;
          const n = cellIndex(a, b);
          if (restSet.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      if (!biggest || reg.length > biggest.length) biggest = reg;
    }
    if (biggest.length < 2) { for (const c of biggest) tried.add(c); continue; }
    // Candidate pairs: prefer the upper cell on an open edge so steps can reach its side.
    const pairs = [];
    for (const a of biggest) for (const b of main) {
      const ai = a % W, aj = (a / W) | 0, bi = b % W, bj = (b / W) | 0;
      const upper = aj >= bj ? a : b;
      const side = edgeSide(upper);
      const d = Math.abs(ai - bi) + Math.abs(aj - bj) * 1.3 + (side ? 0 : 6);
      pairs.push([d, a, b, side]);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    let ok = false;
    for (const [, a, b] of pairs.slice(0, 6)) {
      const aj = (a / W) | 0, bj = (b / W) | 0;
      const lo = aj <= bj ? a : b, hi = lo === a ? b : a;
      const side = edgeSide(hi) || (((lo % W) < (hi % W)) ? -1 : 1);
      if (buildSteps(g, lo % W, (lo / W) | 0, hi % W, (hi / W) | 0, side, P, sym)) { ok = true; break; }
    }
    if (!ok) for (const c of biggest) tried.add(c);
  }
}

function buildSteps(g, x0, y0, x1, y1, side, P, sym) {
  const free = (i, j) => inGrid(i, j) && !g.solid(i, j);
  const slabOK = (i, j) => // slab top surface at row j (solid at j-1), 2 wide, 2 cells of headroom
    j >= 1 && j < H - 1 && free(i, j - 1) && free(i + 1, j - 1) && free(i, j) && free(i + 1, j) && free(i, j + 1) && free(i + 1, j + 1);
  const plan = [];
  let cx = x0, cy = y0;
  const tx = x1 + side * 2; // approach the upper platform from its open side
  for (let guard = 0; guard < 10; guard++) {
    const dy = y1 - cy;
    if (dy <= 3 && Math.abs(x1 - cx) <= 3) break;
    const ny = dy > 3 ? cy + 3 : cy + Math.max(0, dy);
    const dir = Math.sign(tx - cx);
    const step = Math.max(-3, Math.min(3, tx - cx));
    let found = false;
    for (const shift of [0, dir, -dir, 2 * dir, -2 * dir, 3 * dir]) {
      const nx = cx + step + shift - (step < 0 ? 1 : 0);
      if (slabOK(nx, ny) && !plan.some((p) => Math.abs(p[0] - nx) < 3 && Math.abs(p[1] - ny) < 2)) {
        plan.push([nx, ny]);
        cx = nx + (tx < nx ? 0 : 1); cy = ny; found = true; break;
      }
    }
    if (!found) return false;
  }
  if (!plan.length) return false;
  const S = makeStamp(g, sym);
  for (const [nx, ny] of plan) {
    if (sym && (nx + 1 >= W / 2 - 1 && nx <= W / 2)) { g.set(nx, ny - 1, P.timber); g.set(nx + 1, ny - 1, P.timber); }
    else S.rect(nx, ny - 1, 2, 1, P.timber);
  }
  return true;
}

export function checkLevel(level) {
  const { grid } = level;
  const problems = [];
  let open = 0;
  for (let c = 0; c < CELLS; c++) if (!grid[c]) open++;
  const openFrac = open / CELLS;
  const { st, reach } = reachMap(grid);
  if (st.length < 20) return { ok: false, reason: 'too little ground', main: new Set(), openFrac, problems };
  const main = mainSet(st, reach);
  const frac = main.size / st.length;
  for (const c of st) if (!main.has(c)) problems.push(c);
  let ok = openFrac >= 0.35 && frac >= 0.6 && main.size >= 30;
  let reason = ok ? '' : openFrac < 0.35 ? 'not enough open space' : 'parts of the level cannot be reached';
  // Spawns must be inside the main part.
  for (const s of level.spawns || []) {
    const c = cellIndex(Math.floor(s.x), Math.floor(s.y + 0.01));
    if (!main.has(c)) { ok = false; reason = 'a spawn cannot reach the others'; problems.push(c); }
  }
  return { ok, reason, main, openFrac, reachFrac: frac, problems };
}

// Farthest-point sampling of spots.
function spreadPick(cands, n, r, avoid = []) {
  const out = [];
  const pts = cands.slice();
  if (!pts.length) return out;
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  let first = pts[Math.floor(r.next() * pts.length)];
  if (avoid.length) {
    first = pts.reduce((bestP, p) => {
      const d = Math.min(...avoid.map((a) => dist2(a, p)));
      return d > bestP.d ? { p, d } : bestP;
    }, { p: pts[0], d: -1 }).p;
  }
  out.push(first);
  while (out.length < n && out.length < pts.length) {
    let bestP = null, bestD = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const q of out) d = Math.min(d, dist2(p, q));
      for (const q of avoid) d = Math.min(d, dist2(p, q) * 1.5);
      d += r.next() * 0.5;
      if (d > bestD) { bestD = d; bestP = p; }
    }
    if (!bestP || bestD < 1) break;
    out.push(bestP);
  }
  return out;
}

function placeSpots(level, r, main) {
  const g = level.grid;
  const solid = (a, b) => inGrid(a, b) && g[cellIndex(a, b)] !== 0;
  const cands = [];
  for (const c of main) {
    const i = c % W, j = (c / W) | 0;
    const roomy = !solid(i, j + 2) && (standable(g, i - 1, j) || standable(g, i + 1, j));
    if (!roomy) continue;
    const ice = g[cellIndex(i, j - 1)] === MAT.ICE;
    cands.push({ x: i + 0.5, y: j, ice });
  }
  const spawnC = cands.filter((p) => !p.ice && p.x > 1.5 && p.x < W - 1.5);
  level.spawns = spreadPick(spawnC.length >= 8 ? spawnC : cands, 8, r).map((p) => ({ x: p.x, y: p.y }));
  level.pads = spreadPick(cands, r.int(3, 4), r, level.spawns).map((p) => ({ x: p.x, y: p.y, lock: 0 }));
  // Props: on spare ground, plus hanging ones under ceilings.
  const taken = [...level.spawns, ...level.pads];
  const free = cands.filter((p) => taken.every((t) => Math.abs(t.x - p.x) + Math.abs(t.y - p.y) > 2.5));
  const nProps = r.int(3, 7);
  const kinds = PROP_WEIGHTS[level.setting];
  level.props = [];
  for (const p of spreadPick(free, nProps, r, taken)) {
    let kind = r.weighted(kinds);
    if (kind === 'chain' || kind === 'lantern') {
      // Find a ceiling above this column within reach.
      const i = Math.floor(p.x);
      let cj = -1;
      for (let j = p.y + 3; j < H; j++) if (solid(i, j)) { cj = j; break; }
      if (cj < 0) kind = 'crate';
      else { level.props.push({ kind, x: p.x, y: cj }); continue; }
    }
    level.props.push({ kind, x: p.x, y: p.y });
  }
}

// ---------------------------------------------------------------- main entry
export function generateBase(base, setting, archOverride = null) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = makeRng(base + (attempt ? '#' + attempt : ''));
    const picked = r.weighted(ARCH_WEIGHTS[setting]); // always drawn, so an override keeps the same stream
    const archetype = archOverride || picked;
    const P = PALETTE[setting];
    const sym = archetype === 'pit' ? true : r.chance(0.7);
    const g = new Grid();
    const build = { islands: buildIslands, towers: buildTowers, pit: buildPit, cavern: buildCavern, span: buildSpan }[archetype];
    build(g, r.fork('shape'), P, sym);
    // Perturb mirrored levels a little so they don't feel copy-pasted.
    if (sym) perturb(g, r.fork('perturb'), P);
    // Stepping slabs so every region can be reached, then anchors for anything floating.
    connect(g, r.fork('connect'), P, sym);
    anchorOrphans(g);
    const level = { base, code: base, setting, archetype, sym, attempt, grid: g.m, spawns: [], pads: [], props: [] };
    const chk = checkLevel(level);
    if (!chk.ok && attempt < 7) continue;
    placeSpots(level, r.fork('spots'), chk.main);
    if (level.spawns.length < 4 && attempt < 7) continue;
    return level;
  }
  throw new Error('level generation failed');
}

function perturb(g, r, P) {
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
    const v = g.get(i, j);
    const edge = v && (!g.solid(i, j + 1) || !g.solid(i - 1, j) || !g.solid(i + 1, j));
    if (!edge || v === MAT.BEDROCK) continue;
    if (r.chance(0.06)) g.set(i, j, 0);
    else if (r.chance(0.04) && !g.solid(i, j + 1) && !g.solid(i, j + 2) && !g.solid(i, j + 3)) g.set(i, j + 1, v);
  }
}

// Make sure every solid group touches bedrock; otherwise mark its lowest middle cell as bedrock.
function anchorOrphans(g) {
  const seen = new Uint8Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    if (!g.m[c] || seen[c]) continue;
    const q = [c], comp = [];
    seen[c] = 1;
    let anchored = false;
    while (q.length) {
      const k = q.pop();
      comp.push(k);
      if (g.m[k] === MAT.BEDROCK) anchored = true;
      const i = k % W, j = (k / W) | 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (!inGrid(a, b)) continue;
        const n = cellIndex(a, b);
        if (g.m[n] && !seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    if (!anchored) {
      comp.sort((a, b) => ((a / W) | 0) - ((b / W) | 0) || (a % W) - (b % W));
      const lowJ = (comp[0] / W) | 0;
      const low = comp.filter((k) => ((k / W) | 0) === lowJ);
      g.m[low[Math.floor(low.length / 2)]] = MAT.BEDROCK;
    }
  }
}

// ---------------------------------------------------------------- custom levels
// Edits are stored as the difference from the generated base level.
export function buildLevel(codeText) {
  const p = parseCode(codeText);
  if (!p.valid) throw new Error('bad level code');
  let arch = null;
  if (p.edits) {
    try { arch = readArch(p.edits); } catch { /* ignore */ }
  }
  const level = generateBase(p.base, p.setting, arch);
  if (p.edits) applyEdits(level, p.edits);
  level.code = p.code;
  return level;
}

function readArch(bytes) {
  const rd = new ByteReader(bytes);
  if (rd.byte() !== 1) return null;
  const a = rd.byte();
  return a ? ARCHETYPES[a - 1] : null;
}

export function encodeEdits(base, setting, level) {
  const archIdx = ARCHETYPES.indexOf(level.archetype) + 1;
  // Compare against exactly what the code alone builds (retries can change its archetype).
  const natural = generateBase(base, setting);
  const overridden = level.archetype !== natural.archetype;
  const ref = overridden ? generateBase(base, setting, level.archetype) : natural;
  const wr = new ByteWriter();
  wr.byte(1); // version
  wr.byte(overridden ? archIdx : 0);
  // Cells
  const changed = [];
  for (let c = 0; c < CELLS; c++) if (ref.grid[c] !== level.grid[c]) changed.push(c);
  wr.varint(changed.length);
  let prev = 0;
  for (const c of changed) { wr.varint(c - prev); wr.byte(level.grid[c]); prev = c; }
  // Spots: only written when different.
  const same = (a, b, f) => a.length === b.length && a.every((x, k) => f(x, b[k]));
  const eqPt = (a, b) => Math.round(a.x * 2) === Math.round(b.x * 2) && Math.round(a.y * 2) === Math.round(b.y * 2);
  let flags = 0;
  if (!same(level.spawns, ref.spawns, eqPt)) flags |= 1;
  if (!same(level.pads, ref.pads, (a, b) => eqPt(a, b) && (a.lock | 0) === (b.lock | 0))) flags |= 2;
  if (!same(level.props, ref.props, (a, b) => eqPt(a, b) && a.kind === b.kind)) flags |= 4;
  wr.byte(flags);
  if (flags & 1) { wr.varint(level.spawns.length); for (const s of level.spawns) { wr.varint(Math.round(s.x * 2)); wr.varint(Math.round(s.y * 2)); } }
  if (flags & 2) { wr.varint(level.pads.length); for (const s of level.pads) { wr.varint(Math.round(s.x * 2)); wr.varint(Math.round(s.y * 2)); wr.byte(s.lock | 0); } }
  if (flags & 4) { wr.varint(level.props.length); for (const s of level.props) { wr.byte(PROPS.indexOf(s.kind)); wr.varint(Math.round(s.x * 2)); wr.varint(Math.round(s.y * 2)); } }
  const bytes = wr.bytes();
  const trivial = changed.length === 0 && flags === 0 && bytes[1] === 0;
  return makeCustomCode(base, trivial ? null : bytes);
}

function applyEdits(level, bytes) {
  const rd = new ByteReader(bytes);
  if (rd.byte() !== 1) throw new Error('unknown edit version');
  rd.byte(); // archetype (already applied)
  const n = rd.varint();
  let c = 0;
  for (let k = 0; k < n; k++) { c += rd.varint(); level.grid[c] = rd.byte(); }
  if (rd.done) return;
  const flags = rd.byte();
  if (flags & 1) { const m = rd.varint(); level.spawns = []; for (let k = 0; k < m; k++) level.spawns.push({ x: rd.varint() / 2, y: rd.varint() / 2 }); }
  if (flags & 2) { const m = rd.varint(); level.pads = []; for (let k = 0; k < m; k++) level.pads.push({ x: rd.varint() / 2, y: rd.varint() / 2, lock: rd.byte() }); }
  if (flags & 4) { const m = rd.varint(); level.props = []; for (let k = 0; k < m; k++) { const kind = PROPS[rd.byte()] || 'crate'; level.props.push({ kind, x: rd.varint() / 2, y: rd.varint() / 2 }); } }
}

// A cheap fingerprint of a level (for tests and multiplayer checks).
export function levelHash(level) {
  let h = 2166136261;
  for (let c = 0; c < CELLS; c++) { h ^= level.grid[c]; h = Math.imul(h, 16777619); }
  for (const s of level.spawns) { h ^= Math.round(s.x * 2) * 131 + Math.round(s.y * 2); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
