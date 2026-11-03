// Destructible block terrain: fixed blocks anchored to bedrock, falling slabs, loose blocks.
import { W, H, CELLS, MAT, MAT_DEF, G, groups, cellIndex, inGrid, KILL_Y } from '../core/consts.js';

const HALF = 0.5;
const MAX_LOOSE = 220;

export class Terrain {
  constructor(sim, level) {
    this.sim = sim;
    const R = sim.R;
    this.grid = new Uint8Array(level.grid);   // material per cell (0 = gone)
    this.hp = new Float32Array(CELLS);
    this.state = new Uint8Array(CELLS);       // 0 empty, 1 fixed, 2 dynamic
    this.coll = new Array(CELLS).fill(null);  // collider per cell
    this.bodyOf = new Int32Array(CELLS).fill(-1);
    this.dyn = new Map();                     // id -> { body, cells:Set, born }
    this.dirty = false;                       // fixed cells removed this step → re-anchor
    this.broken = [];                         // cells broken this step
    this.fixedBody = sim.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (let c = 0; c < CELLS; c++) {
      const m = this.grid[c];
      if (!m) continue;
      this.hp[c] = MAT_DEF[m].hp;
      this.state[c] = 1;
      this.coll[c] = this.makeCollider(c, this.fixedBody, (c % W) + HALF, ((c / W) | 0) + HALF);
    }
  }

  makeCollider(c, body, ox, oy) {
    const R = this.sim.R, m = MAT_DEF[this.grid[c]];
    const d = R.ColliderDesc.cuboid(HALF, HALF)
      .setTranslation(ox, oy)
      .setFriction(m.friction)
      .setRestitution(m.restitution)
      .setDensity(m.density)
      .setCollisionGroups(groups(G.TERRAIN, 0xffff));
    const col = this.sim.world.createCollider(d, body);
    this.sim.tag(col, { kind: 'block', cell: c });
    return col;
  }

  solid(i, j) { return inGrid(i, j) && this.grid[cellIndex(i, j)] !== 0; }
  fixedAt(i, j) { return inGrid(i, j) && this.state[cellIndex(i, j)] === 1; }
  matAt(x, y) { const i = Math.floor(x), j = Math.floor(y); return inGrid(i, j) ? this.grid[cellIndex(i, j)] : 0; }

  // World position of a cell's centre (dynamic cells follow their body).
  cellPos(c) {
    if (this.state[c] === 2) {
      const d = this.dyn.get(this.bodyOf[c]);
      const col = this.coll[c];
      if (d && col) { const t = col.translation(); return { x: t.x, y: t.y }; }
    }
    return { x: (c % W) + HALF, y: ((c / W) | 0) + HALF };
  }

  damageCell(c, amount, cause = null) {
    const m = this.grid[c];
    if (!m || m === MAT.BEDROCK || amount <= 0) return false;
    this.hp[c] -= amount;
    if (this.hp[c] <= 0) { this.destroyCell(c, cause); return true; }
    this.sim.emit({ t: 'crack', c, f: Math.max(0, this.hp[c] / MAT_DEF[m].hp) });
    return false;
  }

  destroyCell(c, cause = null, quiet = false) {
    const m = this.grid[c];
    if (!m) return;
    const pos = this.cellPos(c);
    const col = this.coll[c];
    if (col) { this.sim.untag(col); this.sim.world.removeCollider(col, true); }
    this.coll[c] = null;
    this.grid[c] = 0;
    if (this.state[c] === 1) this.dirty = true;
    if (this.state[c] === 2) {
      const id = this.bodyOf[c];
      const d = this.dyn.get(id);
      if (d) {
        d.cells.delete(c);
        if (!d.cells.size) this.removeDyn(id, true);
        else if (d.cells.size > 1) this.dirtyBodies.add(id);
      }
    }
    this.state[c] = 0;
    this.bodyOf[c] = -1;
    this.broken.push(c);
    this.brokenCount = (this.brokenCount || 0) + 1;
    if (!quiet) this.sim.emit({ t: 'break', c, m, x: pos.x, y: pos.y, by: cause });
    this.sim.onCellGone(c);
  }

  get dirtyBodies() { return this._db || (this._db = new Set()); }

  removeDyn(id, emit = true) {
    const d = this.dyn.get(id);
    if (!d) return;
    for (const c of d.cells) {
      const col = this.coll[c];
      if (col) this.sim.untag(col);
      this.coll[c] = null; this.grid[c] = 0; this.state[c] = 0; this.bodyOf[c] = -1;
    }
    this.sim.removeBody(d.body);
    this.dyn.delete(id);
    if (emit) this.sim.emit({ t: 'gone', id });
  }

  // Make a set of cells (currently fixed) into one falling dynamic body.
  detach(cells) {
    const R = this.sim.R;
    let cx = 0, cy = 0;
    for (const c of cells) { cx += (c % W) + HALF; cy += ((c / W) | 0) + HALF; }
    cx /= cells.length; cy /= cells.length;
    const body = this.sim.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(cx, cy).setLinearDamping(0.05).setAngularDamping(0.3).setCcdEnabled(cells.length < 4));
    const id = this.sim.newId();
    body.userData = { kind: 'blocks', id };
    for (const c of cells) {
      const col = this.coll[c];
      if (col) { this.sim.untag(col); this.sim.world.removeCollider(col, false); }
      this.coll[c] = this.makeCollider(c, body, (c % W) + HALF - cx, ((c / W) | 0) + HALF - cy);
      this.state[c] = 2;
      this.bodyOf[c] = id;
    }
    this.dyn.set(id, { body, cells: new Set(cells), born: this.sim.time, pv: { x: 0, y: 0 }, ox: cx, oy: cy });
    this.sim.track(id, body);
    this.brokenCount = (this.brokenCount || 0) + 1;
    this.sim.emit({ t: 'detach', id, cells: [...cells], x: cx, y: cy });
    return id;
  }

  // Break a compound body into single-cell bodies (each keeps its motion).
  split(id) {
    const R = this.sim.R;
    const d = this.dyn.get(id);
    if (!d || d.cells.size < 2) return;
    const lv = d.body.linvel(), av = d.body.angvel(), rot = d.body.rotation();
    const parts = [];
    const cells = [...d.cells];
    const poses = cells.map((c) => { const t = this.coll[c].translation(); return { c, x: t.x, y: t.y }; });
    this.removeDynKeepCells(id);
    for (const p of poses) {
      const body = this.sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y).setRotation(rot)
        .setLinvel(lv.x + (this.sim.rng.float() - 0.5) * 0.5, lv.y).setAngvel(av).setAngularDamping(0.2));
      const nid = this.sim.newId();
      body.userData = { kind: 'blocks', id: nid };
      this.coll[p.c] = this.makeCollider(p.c, body, 0, 0);
      this.state[p.c] = 2;
      this.bodyOf[p.c] = nid;
      this.dyn.set(nid, { body, cells: new Set([p.c]), born: this.sim.time, pv: { x: lv.x, y: lv.y }, ox: p.x, oy: p.y });
      this.sim.track(nid, body);
      parts.push([p.c, nid, p.x, p.y, rot]);
    }
    this.sim.emit({ t: 'split', id, parts });
  }

  removeDynKeepCells(id) {
    const d = this.dyn.get(id);
    if (!d) return;
    for (const c of d.cells) { const col = this.coll[c]; if (col) this.sim.untag(col); this.coll[c] = null; }
    this.sim.removeBody(d.body);
    this.dyn.delete(id);
  }

  // Re-split a compound whose cells are no longer connected.
  fixConnectivity(id) {
    const d = this.dyn.get(id);
    if (!d || d.cells.size < 2) return;
    // Cells in a compound keep their grid neighbourhood (they move rigidly), so use grid indices.
    const left = new Set(d.cells), comps = [];
    while (left.size) {
      const start = left.values().next().value;
      const comp = [start]; left.delete(start);
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k], i = c % W, j = (c / W) | 0;
        for (const n of [c + 1, c - 1, c + W, c - W]) {
          if (!left.has(n)) continue;
          const ni = n % W;
          if (Math.abs(ni - i) > 1) continue;
          left.delete(n); comp.push(n);
        }
      }
      comps.push(comp);
    }
    if (comps.length > 1) this.split(id);
  }

  // After fixed blocks are removed: flood fill from bedrock; unconnected groups fall.
  settle() {
    if (this.dirtyBodies.size) {
      for (const id of this.dirtyBodies) this.fixConnectivity(id);
      this.dirtyBodies.clear();
    }
    if (!this.dirty) return;
    this.dirty = false;
    const seen = new Uint8Array(CELLS);
    const q = [];
    for (let c = 0; c < CELLS; c++) if (this.state[c] === 1 && this.grid[c] === MAT.BEDROCK) { seen[c] = 1; q.push(c); }
    for (let k = 0; k < q.length; k++) {
      const c = q[k], i = c % W;
      for (const n of [c + 1, c - 1, c + W, c - W]) {
        if (n < 0 || n >= CELLS || seen[n] || this.state[n] !== 1) continue;
        if (Math.abs((n % W) - i) > 1) continue;
        seen[n] = 1; q.push(n);
      }
    }
    // Group the unanchored fixed cells into connected components.
    const done = new Uint8Array(CELLS);
    for (let c = 0; c < CELLS; c++) {
      if (this.state[c] !== 1 || seen[c] || done[c]) continue;
      const comp = [c]; done[c] = 1;
      for (let k = 0; k < comp.length; k++) {
        const a = comp[k], i = a % W;
        for (const n of [a + 1, a - 1, a + W, a - W]) {
          if (n < 0 || n >= CELLS || done[n] || seen[n] || this.state[n] !== 1) continue;
          if (Math.abs((n % W) - i) > 1) continue;
          done[n] = 1; comp.push(n);
        }
      }
      this.detach(comp);
    }
  }

  // Impacts, falling out of the world, and the loose-block budget.
  update(dt) {
    const sim = this.sim;
    let loose = 0;
    for (const [id, d] of [...this.dyn]) {
      const b = d.body;
      const t = b.translation();
      if (t.y < KILL_Y - 14 || t.x < -30 || t.x > W + 30) { this.removeDyn(id); continue; }
      const v = b.linvel();
      const dv = Math.hypot(v.x - d.pv.x, v.y - d.pv.y);
      d.pv = { x: v.x, y: v.y };
      if (d.cells.size > 1) {
        // A slab that slams into something breaks apart.
        if (dv > 7 && sim.time - d.born > 0.15) {
          for (const c of d.cells) if (this.sim.rng.chance(0.25)) this.hp[c] -= (dv - 6) * 6;
          this.split(id);
          sim.emit({ t: 'slam', x: t.x, y: t.y, n: d.cells.size, s: dv });
          for (const c of [...d.cells]) if (this.hp[c] <= 0 && this.grid[c]) this.destroyCell(c, null);
        }
      } else {
        loose++;
        if (dv > 11 && sim.time - d.born > 0.1) {
          const c = d.cells.values().next().value;
          this.damageCell(c, (dv - 10) * 4);
        }
      }
    }
    // Keep the number of loose blocks within budget: oldest crumble first.
    if (loose > MAX_LOOSE) {
      const singles = [...this.dyn].filter(([, d]) => d.cells.size === 1).sort((a, b) => a[1].born - b[1].born);
      for (let k = 0; k < loose - MAX_LOOSE; k++) {
        const c = singles[k][1].cells.values().next().value;
        this.destroyCell(c, null);
      }
    }
  }

  // Cell under a world point (fixed or dynamic).
  cellAtPoint(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    if (inGrid(i, j) && this.state[cellIndex(i, j)] === 1) return cellIndex(i, j);
    return -1;
  }

  // All cells (fixed or dynamic) whose centre is within r of (x, y).
  // Is the world point inside a fixed block?
  solidAt(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    return i >= 0 && i < W && j >= 0 && j < H && this.state[j * W + i] === 1;
  }

  cellsNear(x, y, r) {
    const out = [];
    const i0 = Math.floor(x - r - 1), i1 = Math.ceil(x + r + 1), j0 = Math.floor(y - r - 1), j1 = Math.ceil(y + r + 1);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
        const c = cellIndex(i, j);
        if (this.state[c] !== 1) continue;
        const d = Math.hypot(i + HALF - x, j + HALF - y);
        if (d <= r) out.push([c, d]);
      }
    for (const [, dd] of this.dyn) for (const c of dd.cells) {
      const p = this.cellPos(c);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= r) out.push([c, d]);
    }
    return out;
  }
}
