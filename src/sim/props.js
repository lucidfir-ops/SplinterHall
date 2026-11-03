// Prop shapes shared by the simulation and the view, so both build the same bodies in the same order.
// Each prop is a list of parts; ids are handed out in level order, part by part.

export const PROP_DEF = {
  crate: { hp: 25, parts: [{ shape: 'box', hx: 0.45, hy: 0.45, density: 1.1, dy: 0.45 }] },
  barrel: { hp: 18, explosive: true, parts: [{ shape: 'box', hx: 0.34, hy: 0.46, density: 1.2, dy: 0.46 }] },
  boulder: { hp: Infinity, parts: [{ shape: 'ball', r: 0.62, density: 4, dy: 0.62 }] },
  plank: { hp: 20, parts: [{ shape: 'box', hx: 1.4, hy: 0.09, density: 1.2, dy: 0.09 }] },
  // Hanging props: y is the ceiling cell row; links hang from its underside.
  chain: { hp: Infinity, hanging: true, links: 6, link: { shape: 'capsule', hh: 0.16, r: 0.06, density: 6 } },
  lantern: { hp: 10, hanging: true, links: 3, link: { shape: 'capsule', hh: 0.13, r: 0.04, density: 4 },
    end: { shape: 'box', hx: 0.2, hy: 0.28, density: 1.5 } },
};

// Expand a level prop into concrete parts with world positions (rest pose).
export function propParts(p) {
  const def = PROP_DEF[p.kind] || PROP_DEF.crate;
  const out = [];
  if (def.hanging) {
    const topY = p.y; // underside of the ceiling cell
    let y = topY;
    for (let k = 0; k < def.links; k++) {
      const L = def.link;
      const len = L.hh * 2 + L.r * 2;
      out.push({ ...L, x: p.x, y: y - len / 2, link: k, len });
      y -= len;
    }
    if (def.end) out.push({ ...def.end, x: p.x, y: y - def.end.hy, end: true });
    return out;
  }
  for (const part of def.parts) out.push({ ...part, x: p.x, y: p.y + part.dy });
  return out;
}
