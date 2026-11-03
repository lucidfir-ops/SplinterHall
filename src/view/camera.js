// The player camera: close on your own fighter (one player per device), leading the way you're going and
// widening a little to take in someone close enough to fight. The whole arena only when asked for (a short
// overview), through the drop-in, and when you're out of the round. Fighters off the edge of a close view get
// a marker on that edge.
import * as THREE from 'three';
import { FIGHTER_COLORS } from '../core/consts.js';

export const FOLLOW_W = 15;   // metres across when following
const FOLLOW_MAX = 20;         // widened this far to keep a close opponent in view
const NEAR = 9;                // an opponent this close (m) is kept in view

export class PlayerCam {
  constructor() {
    this.overview = 0;     // seconds of whole-arena view left (set when the player asks for it)
    this.vx = 0; this.px = null;
    this.on = true;        // follow mode (settings can switch it off for the whole-arena camera)
  }

  // Ask for (or end) a look at the whole arena.
  toggleOverview(sec = 2.6) { this.overview = this.overview > 0.2 ? 0 : sec; }

  // The camera target while following, or null to use the whole-fight framing.
  target(view, f, dt) {
    if (this.overview > 0) this.overview -= dt;
    if (!this.on || !f || view.localSlot == null || view.localSlot < 0 || this.overview > 0) { this.px = null; return null; }
    if (f.phase === 'dropin' || f.phase === 'end') { this.px = null; return null; }
    const me = f.fighters.find((x) => x.slot === view.localSlot);
    if (!me || !me.alive) { this.px = null; return null; }
    const x = me.parts[3], y = me.parts[4];
    // Lead: where you're heading (velocity from frame to frame), a little toward where you face.
    if (this.px !== null && dt > 0) this.vx += ((x - this.px) / dt - this.vx) * Math.min(1, dt * 4);
    this.px = x;
    const lead = Math.max(-2.6, Math.min(2.6, this.vx * 0.28)) + me.facing * 0.6;
    let tx = x + lead, tw = FOLLOW_W, ty = y + 0.9;
    // Keep the nearest opponent in shot if they're close.
    let best = null, bd = NEAR;
    for (const o of f.fighters) {
      if (o === me || !o.alive) continue;
      const d = Math.hypot(o.parts[3] - x, (o.parts[4] - y) * 1.3);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      const ox = best.parts[3], oy = best.parts[4];
      const lo = Math.min(x, ox), hi = Math.max(x, ox);
      tw = Math.min(FOLLOW_MAX, Math.max(FOLLOW_W, hi - lo + 7));
      tx = Math.max(lo - 1, Math.min(hi + 1, (lo + hi) / 2 + lead * 0.5));
      ty = (y + oy) / 2 + 0.9;
    }
    return { tx, ty, tw, k: 6.5 };
  }
}

// Chevrons on the screen edge pointing at fighters outside the view.
export class EdgeMarkers {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'sh-edges';
    this.el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;overflow:hidden';
    parent.appendChild(this.el);
    this.marks = new Map();
    this.v = new THREE.Vector3();
  }

  update(f, camera, show, localSlot) {
    const seen = new Set();
    if (show && f) {
      const w = innerWidth, h = innerHeight, m = 22;
      for (const o of f.fighters) {
        if (!o.alive || o.slot === localSlot) continue;
        this.v.set(o.parts[3], o.parts[4], 0).project(camera);
        const inside = Math.abs(this.v.x) < 1 && Math.abs(this.v.y) < 1 && this.v.z < 1;
        if (inside) continue;
        let sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
        const cx = w / 2, cy = h / 2, dx = sx - cx, dy = sy - cy;
        // Pin to the screen edge along the line from the centre.
        const s = Math.min((cx - m) / Math.max(1e-3, Math.abs(dx)), (cy - m) / Math.max(1e-3, Math.abs(dy)));
        sx = cx + dx * s; sy = cy + dy * s;
        let d = this.marks.get(o.slot);
        if (!d) {
          d = document.createElement('div');
          d.style.cssText = `position:absolute;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:16px solid ${FIGHTER_COLORS[o.slot].hex};filter:drop-shadow(2px 2px 0 rgba(12,12,11,.9));`;
          this.el.appendChild(d);
          this.marks.set(o.slot, d);
        }
        d.style.display = '';
        d.style.transform = `translate(${sx - 9}px, ${sy - 8}px) rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
        seen.add(o.slot);
      }
    }
    for (const [slot, d] of this.marks) if (!seen.has(slot)) d.style.display = 'none';
  }

  dispose() { this.el.remove(); }
}
