// Snapshots packed as binary (base64 in the room's JSON messages). Positions are 1/256 m,
// angles 1/10000 of pi. Only bodies that moved are sent, with a full refresh every second.
import { ITEM_KINDS, ITEM_INDEX } from '../core/consts.js';
import { toB64, fromB64 } from '../core/codes.js';

const PHASES = ['dropin', 'fight', 'final', 'end'];
const SWINGS = [null, 'punch', 'axe', 'sword', 'hammer', 'kick', 'haymaker', 'uppercut', 'slam', 'dropkick', 'throw', 'recoil'];
// The drawn skeleton: 15 joints relative to the torso, a byte per coordinate (1/48 m), and the held item's up.
const NJ = 15, JS = 48;
const qj = (v) => Math.max(-127, Math.min(127, Math.round(v * JS)));
const P = 256, A = 10000 / Math.PI;
const q = (v) => Math.max(-32767, Math.min(32767, Math.round(v * P)));
const qa = (v) => Math.max(-32767, Math.min(32767, Math.round(v * A)));

const last = new Map();
let packets = 0;

export function resetPacking() { last.clear(); packets = 0; }

export function packFrame(f) {
  packets++;
  const full = packets % 20 === 1;
  const bodies = [];
  for (let k = 0; k < f.bodies.length; k += 4) {
    const id = f.bodies[k], x = f.bodies[k + 1], y = f.bodies[k + 2], a = f.bodies[k + 3];
    const l = last.get(id);
    if (!full && l && Math.abs(l[0] - x) < 0.004 && Math.abs(l[1] - y) < 0.004 && Math.abs(l[2] - a) < 0.002) continue;
    last.set(id, [x, y, a]);
    bodies.push(id, x, y, a);
  }
  const nf = f.fighters.length, nb = bodies.length / 4, np = f.proj.length / 4;
  const size = 4 + 1 + 4 + 1 + nf * (1 + 2 + 1 + 1 + 1 + 2 + 1 + 2 + 1 + 1 + 1 + 8 + 60 + NJ * 3 + 4) + 2 + nb * 8 + 1 + np * 8;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint32(o, f.tick); o += 4;
  v.setUint8(o, Math.max(0, PHASES.indexOf(f.phase))); o += 1;
  v.setFloat32(o, f.killY); o += 4;
  v.setUint8(o, nf); o += 1;
  for (const F of f.fighters) {
    v.setUint8(o, F.slot); o += 1;
    const flags = (F.alive ? 1 : 0) | (F.jet ? 2 : 0) | (F.stuck ? 4 : 0) | (F.flash ? 8 : 0) | (F.facing > 0 ? 16 : 0) | (F.line ? 32 : 0) | (F.beam ? 64 : 0);
    v.setUint16(o, flags); o += 2;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round(F.hp)))); o += 1;
    v.setUint8(o, F.item ? ITEM_INDEX[F.item] : 0); o += 1;
    v.setUint8(o, F.back ? ITEM_INDEX[F.back] : 0); o += 1;
    v.setUint16(o, Math.min(65535, Math.round((isFinite(F.ammo) ? F.ammo : 6553) * 10))); o += 2;
    v.setUint8(o, Math.min(255, Math.round(F.fuel * 40))); o += 1;
    v.setInt16(o, qa(F.aim)); o += 2;
    v.setUint8(o, Math.min(255, Math.round(F.charge * 100))); o += 1;
    v.setUint8(o, Math.max(0, SWINGS.indexOf(F.swing))); o += 1;
    v.setUint8(o, Math.min(255, F.kills | 0)); o += 1;
    const L = F.line || [0, 0], B = F.beam || [0, 0];
    v.setInt16(o, q(L[0])); v.setInt16(o + 2, q(L[1])); v.setInt16(o + 4, q(B[0])); v.setInt16(o + 6, q(B[1])); o += 8;
    for (let k = 0; k < 10; k++) {
      v.setInt16(o, q(F.parts[k * 3])); v.setInt16(o + 2, q(F.parts[k * 3 + 1])); v.setInt16(o + 4, qa(F.parts[k * 3 + 2])); o += 6;
    }
    const tx = F.parts[3], ty = F.parts[4], J = F.joints;
    for (let k = 0; k < NJ; k++) {
      v.setInt8(o, J ? qj(J[k * 3] - tx) : 0); v.setInt8(o + 1, J ? qj(J[k * 3 + 1] - ty) : 0); v.setInt8(o + 2, J ? qj(J[k * 3 + 2]) : 0); o += 3;
    }
    const U = F.wup || [0, 1, 0];
    for (let k = 0; k < 3; k++) { v.setInt8(o, Math.max(-127, Math.min(127, Math.round(U[k] * 127)))); o += 1; }
    v.setUint8(o, F.strike || 0); o += 1;
  }
  v.setUint16(o, nb); o += 2;
  for (let k = 0; k < bodies.length; k += 4) {
    v.setUint16(o, bodies[k]); v.setInt16(o + 2, q(bodies[k + 1])); v.setInt16(o + 4, q(bodies[k + 2])); v.setInt16(o + 6, qa(bodies[k + 3])); o += 8;
  }
  v.setUint8(o, np); o += 1;
  for (let k = 0; k < f.proj.length; k += 4) {
    v.setUint16(o, f.proj[k]); v.setInt16(o + 2, q(f.proj[k + 1])); v.setInt16(o + 4, q(f.proj[k + 2])); v.setInt16(o + 6, qa(f.proj[k + 3])); o += 8;
  }
  return toB64(new Uint8Array(buf, 0, o));
}

export function unpackFrame(b64) {
  try {
    const u = fromB64(b64);
    const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let o = 0;
    const tick = v.getUint32(o); o += 4;
    const phase = PHASES[v.getUint8(o)]; o += 1;
    const killY = v.getFloat32(o); o += 4;
    const nf = v.getUint8(o); o += 1;
    const fighters = [];
    for (let n = 0; n < nf; n++) {
      const F = {};
      F.slot = v.getUint8(o); o += 1;
      const flags = v.getUint16(o); o += 2;
      F.alive = !!(flags & 1); F.jet = !!(flags & 2); F.stuck = !!(flags & 4); F.flash = !!(flags & 8); F.facing = flags & 16 ? 1 : -1;
      F.hp = v.getUint8(o); o += 1;
      const it = v.getUint8(o); o += 1; F.item = it ? ITEM_KINDS[it - 1] : null;
      const bk = v.getUint8(o); o += 1; F.back = bk ? ITEM_KINDS[bk - 1] : null;
      const am = v.getUint16(o) / 10; o += 2; F.ammo = am >= 6553 ? Infinity : am;
      F.fuel = v.getUint8(o) / 40; o += 1;
      F.aim = v.getInt16(o) / A; o += 2;
      F.charge = v.getUint8(o) / 100; o += 1;
      F.swing = SWINGS[v.getUint8(o)] || null; o += 1;
      F.kills = v.getUint8(o); o += 1;
      const lx = v.getInt16(o) / P, ly = v.getInt16(o + 2) / P, bx = v.getInt16(o + 4) / P, by = v.getInt16(o + 6) / P; o += 8;
      F.line = flags & 32 ? [lx, ly] : null; F.beam = flags & 64 ? [bx, by] : null;
      F.parts = new Float32Array(30);
      for (let k = 0; k < 10; k++) {
        F.parts[k * 3] = v.getInt16(o) / P; F.parts[k * 3 + 1] = v.getInt16(o + 2) / P; F.parts[k * 3 + 2] = v.getInt16(o + 4) / A; o += 6;
      }
      F.joints = new Float32Array(NJ * 3);
      for (let k = 0; k < NJ; k++) {
        F.joints[k * 3] = F.parts[3] + v.getInt8(o) / JS; F.joints[k * 3 + 1] = F.parts[4] + v.getInt8(o + 1) / JS; F.joints[k * 3 + 2] = v.getInt8(o + 2) / JS; o += 3;
      }
      F.wup = [v.getInt8(o) / 127, v.getInt8(o + 1) / 127, v.getInt8(o + 2) / 127]; o += 3;
      F.strike = v.getUint8(o); o += 1;
      fighters.push(F);
    }
    const nb = v.getUint16(o); o += 2;
    const bodies = [];
    for (let n = 0; n < nb; n++) { bodies.push(v.getUint16(o), v.getInt16(o + 2) / P, v.getInt16(o + 4) / P, v.getInt16(o + 6) / A); o += 8; }
    const np = v.getUint8(o); o += 1;
    const proj = [];
    for (let n = 0; n < np; n++) { proj.push(v.getUint16(o), v.getInt16(o + 2) / P, v.getInt16(o + 4) / P, v.getInt16(o + 6) / A); o += 8; }
    return { tick, phase, killY, fighters, bodies, proj };
  } catch {
    return null;
  }
}
