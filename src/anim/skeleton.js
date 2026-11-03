// The fighter's 3D skeleton and the maths to pose it. Shared by the simulation (hit points, physics limb
// targets) and the view (rendering), so what you see is what hits.
//
// Local frame: x = the way the fighter faces, y = up, z = toward the camera. The "front" limbs (F) are on the
// near side (z > 0), the "back" limbs (B) on the far side. Facing left mirrors x only, so the near arm stays
// near. Limb poses are unit directions; D(pitch, yaw) builds one: pitch 0 = straight down, 90 = level,
// 180 = straight up; yaw 0 = forward, 90 = toward the camera, -90 = away, 180 = backward.

export const DEG = Math.PI / 180;
export const LEN = { torso: 0.44, head: 0.37, uarm: 0.3, larm: 0.3, thigh: 0.36, shin: 0.36, shoulder: 0.15, hip: 0.09 };

// Joint indices into a Float32Array(15 * 3).
export const J = { PELVIS: 0, CHEST: 1, HEAD: 2, SHO_F: 3, ELB_F: 4, HAND_F: 5, SHO_B: 6, ELB_B: 7, HAND_B: 8, HIP_F: 9, KNEE_F: 10, FOOT_F: 11, HIP_B: 12, KNEE_B: 13, FOOT_B: 14 };
export const NJ = 15;
// The ten drawn segments, in the physics PARTS order: [from joint, to joint] (head is a ball at HEAD).
export const SEGS = [
  [J.HEAD, J.HEAD], [J.PELVIS, J.CHEST], [J.SHO_B, J.ELB_B], [J.ELB_B, J.HAND_B], [J.SHO_F, J.ELB_F], [J.ELB_F, J.HAND_F],
  [J.HIP_B, J.KNEE_B], [J.KNEE_B, J.FOOT_B], [J.HIP_F, J.KNEE_F], [J.KNEE_F, J.FOOT_F],
];
export const LIMBS = ['uaF', 'laF', 'uaB', 'laB', 'thF', 'shF', 'thB', 'shB'];
export const SCALARS = ['lean', 'twist', 'spin', 'roll', 'dx', 'dy', 'tilt'];
export const DIRS = [...LIMBS, 'head'];

export function D(pitch, yaw = 0) {
  const p = pitch * DEG, y = yaw * DEG, s = Math.sin(p);
  return [s * Math.cos(y), -Math.cos(p), s * Math.sin(y)];
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Spherical interpolation between unit vectors (into out).
export function slerp(a, b, t, out = [0, 0, 0]) {
  let c = dot(a, b);
  if (c > 0.9995) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return norm(out); }
  if (c < -0.9995) {
    // Opposite: go round through the camera side so arcs read in depth.
    const m = norm([a[1] * 0 - a[2] * 1, a[2] * 0 - a[0] * 0, a[0] * 1 - a[1] * 0]);
    if (Math.hypot(m[0], m[1], m[2]) < 0.5) { m[0] = 0; m[1] = 0; m[2] = 1; }
    const mid = norm([m[0], m[1], m[2] || 1]);
    return t < 0.5 ? slerp(a, mid, t * 2, out) : slerp(mid, b, (t - 0.5) * 2, out);
  }
  c = Math.max(-1, Math.min(1, c));
  const th = Math.acos(c), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  out[0] = a[0] * wa + b[0] * wb; out[1] = a[1] * wa + b[1] * wb; out[2] = a[2] * wa + b[2] * wb;
  return out;
}

// Rotate v about unit axis k by angle a (Rodrigues), into out.
function rot(v, k, a, out) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

// Two-bone IK: from the root joint toward target (both local), with the bend toward pole. Returns [dir1, dir2].
export function ik(root, target, l1, l2, pole) {
  const d = [target[0] - root[0], target[1] - root[1], target[2] - root[2]];
  let dist = Math.hypot(d[0], d[1], d[2]) || 1e-6;
  const dn = [d[0] / dist, d[1] / dist, d[2] / dist];
  dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, dist));
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pd = dot(pole, dn);
  const bn = norm([pole[0] - dn[0] * pd, pole[1] - dn[1] * pd, pole[2] - dn[2] * pd]);
  const d1 = [dn[0] * cosA + bn[0] * sinA, dn[1] * cosA + bn[1] * sinA, dn[2] * cosA + bn[2] * sinA];
  const kx = root[0] + d1[0] * l1, ky = root[1] + d1[1] * l1, kz = root[2] + d1[2] * l1;
  const tx = root[0] + dn[0] * dist, ty = root[1] + dn[1] * dist, tz = root[2] + dn[2] * dist;
  return [d1, norm([tx - kx, ty - ky, tz - kz])];
}

// A neutral standing pose (local), every field filled.
export function basePose() {
  return {
    lean: 0, twist: 0, spin: 0, roll: 0, dx: 0, dy: 0, tilt: 0,
    head: [0, 1, 0],
    uaF: D(15, 15), laF: D(25, 10), uaB: D(15, -15), laB: D(25, -10),
    thF: D(4, 0), shF: D(0, 0), thB: D(-4, 0), shB: D(0, 0),
  };
}

export function copyPose(src, dst = basePose()) {
  for (const k of SCALARS) dst[k] = src[k] || 0;
  for (const k of DIRS) { const a = src[k] || dst[k]; dst[k][0] = a[0]; dst[k][1] = a[1]; dst[k][2] = a[2]; }
  return dst;
}

// out = a blended toward b by t (directions slerped, scalars lerped).
export function blendPose(a, b, t, out = basePose()) {
  for (const k of SCALARS) out[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  for (const k of DIRS) slerp(a[k], b[k], t, out[k]);
  return out;
}

// Where the hips and shoulders sit for a pose (local, before spin/roll/mirror): used by IK and solve().
export function frame(pose) {
  const l = pose.lean * DEG;
  const spine = [Math.sin(l), Math.cos(l), 0];
  const chest = [spine[0] * LEN.torso, spine[1] * LEN.torso, 0];
  const lat = rot([0, 0, 1], spine, pose.twist * DEG, [0, 0, 0]);
  const latH = rot([0, 0, 1], [0, 1, 0], pose.twist * DEG * 0.3, [0, 0, 0]);
  const sb = 0.02;
  return {
    spine, chest,
    shoF: [chest[0] + lat[0] * LEN.shoulder - spine[0] * sb, chest[1] + lat[1] * LEN.shoulder - spine[1] * sb, chest[2] + lat[2] * LEN.shoulder],
    shoB: [chest[0] - lat[0] * LEN.shoulder - spine[0] * sb, chest[1] - lat[1] * LEN.shoulder - spine[1] * sb, chest[2] - lat[2] * LEN.shoulder],
    hipF: [latH[0] * LEN.hip, latH[1] * LEN.hip, latH[2] * LEN.hip],
    hipB: [-latH[0] * LEN.hip, -latH[1] * LEN.hip, -latH[2] * LEN.hip],
  };
}

// Point the legs (and optionally the back arm) at local targets with IK; writes the limb directions into pose.
export function legIK(pose, footF, footB) {
  const fr = frame(pose);
  const KNEE = [1, 0.15, 0];
  if (footF) { const [a, b] = ik(fr.hipF, footF, LEN.thigh, LEN.shin, KNEE); pose.thF = a; pose.shF = b; }
  if (footB) { const [a, b] = ik(fr.hipB, footB, LEN.thigh, LEN.shin, KNEE); pose.thB = a; pose.shB = b; }
  return pose;
}
export function armIK(pose, side, target, pole = [-0.4, -1, 0]) {
  const fr = frame(pose);
  const [a, b] = ik(side === 'F' ? fr.shoF : fr.shoB, target, LEN.uarm, LEN.larm, norm(pole.slice()));
  if (side === 'F') { pose.uaF = a; pose.laF = b; } else { pose.uaB = a; pose.laB = b; }
  return pose;
}

const _p = [0, 0, 0];
// Joint positions in the world: root = the pelvis's world position, facing ±1. out: Float32Array(NJ * 3).
export function solve(pose, rootX, rootY, facing, out) {
  const fr = frame(pose);
  const set = (j, v) => { out[j * 3] = v[0]; out[j * 3 + 1] = v[1]; out[j * 3 + 2] = v[2]; };
  const add = (j, from, dir, len) => { out[j * 3] = out[from * 3] + dir[0] * len; out[j * 3 + 1] = out[from * 3 + 1] + dir[1] * len; out[j * 3 + 2] = out[from * 3 + 2] + dir[2] * len; };
  set(J.PELVIS, [0, 0, 0]);
  set(J.CHEST, fr.chest);
  add(J.HEAD, J.CHEST, pose.head, LEN.head);
  set(J.SHO_F, fr.shoF); add(J.ELB_F, J.SHO_F, pose.uaF, LEN.uarm); add(J.HAND_F, J.ELB_F, pose.laF, LEN.larm);
  set(J.SHO_B, fr.shoB); add(J.ELB_B, J.SHO_B, pose.uaB, LEN.uarm); add(J.HAND_B, J.ELB_B, pose.laB, LEN.larm);
  set(J.HIP_F, fr.hipF); add(J.KNEE_F, J.HIP_F, pose.thF, LEN.thigh); add(J.FOOT_F, J.KNEE_F, pose.shF, LEN.shin);
  set(J.HIP_B, fr.hipB); add(J.KNEE_B, J.HIP_B, pose.thB, LEN.thigh); add(J.FOOT_B, J.KNEE_B, pose.shB, LEN.shin);
  // Whole-body spin about the vertical (through the pelvis), then roll (flips) about the body's middle.
  const sp = pose.spin * DEG, rl = -pose.roll * DEG, tl = pose.tilt * DEG;
  const cy = 0.35;
  for (let j = 0; j < NJ; j++) {
    let x = out[j * 3], y = out[j * 3 + 1], z = out[j * 3 + 2];
    if (sp) { const c = Math.cos(sp), s = Math.sin(sp); const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
    if (tl) { const c = Math.cos(tl), s = Math.sin(tl); const ny = y * c - z * s; z = y * s + z * c; y = ny; }
    if (rl) { const c = Math.cos(rl), s = Math.sin(rl); const yy = y - cy; const nx = x * c - yy * s; y = x * s + yy * c + cy; x = nx; }
    out[j * 3] = rootX + facing * (x + pose.dx);
    out[j * 3 + 1] = rootY + y + pose.dy;
    out[j * 3 + 2] = z;
  }
  return out;
}

// The direction of a limb in the world after spin/roll/mirror (for weapons held in that hand).
export function worldDir(pose, dir, facing, out = _p) {
  let x = dir[0], y = dir[1], z = dir[2];
  const sp = pose.spin * DEG, rl = -pose.roll * DEG, tl = pose.tilt * DEG;
  if (sp) { const c = Math.cos(sp), s = Math.sin(sp); const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
  if (tl) { const c = Math.cos(tl), s = Math.sin(tl); const ny = y * c - z * s; z = y * s + z * c; y = ny; }
  if (rl) { const c = Math.cos(rl), s = Math.sin(rl); const nx = x * c - y * s; y = x * s + y * c; x = nx; }
  out[0] = x * facing; out[1] = y; out[2] = z;
  return out;
}
