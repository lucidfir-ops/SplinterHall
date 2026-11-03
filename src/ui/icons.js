// Item icons drawn from straight segments with mitred joins (no curves, no circles).
const P = {
  fist: 'M14 22 L14 12 L30 12 L34 16 L34 24 L18 24 Z M18 12 L18 9 M22 12 L22 9 M26 12 L26 9 M30 12 L30 10',
  axe: 'M6 26 L36 8 M30 6 L40 2 L44 12 L38 18 L34 12 Z',
  sword: 'M4 28 L10 22 M7 19 L13 25 M10 22 L42 4 L44 6 L13 25',
  hammer: 'M6 28 L30 10 M26 4 L40 4 L40 18 L26 18 Z',
  blunderbuss: 'M4 22 L14 18 L18 22 L10 28 Z M14 18 L36 12 L44 6 L44 18 L36 16 L18 22',
  rocket: 'M4 16 L36 16 L44 12 L44 20 L36 16 M4 12 L32 12 L32 20 L4 20 Z M14 20 L14 26',
  bombs: 'M14 12 L26 12 L32 18 L32 26 L26 30 L14 30 L8 26 L8 18 Z M20 12 L22 6 L28 4 M28 4 L30 2',
  web: 'M4 16 L44 16 M24 2 L24 30 M10 4 L38 28 M10 28 L38 4 M14 16 L24 8 L34 16 L24 24 Z',
  tractor: 'M4 22 L16 22 L16 10 L4 10 Z M16 16 L24 16 M28 8 L28 24 M34 6 L34 26 M40 4 L40 28',
  portal: 'M10 4 L22 4 L22 28 L10 28 Z M26 4 L38 4 L38 28 L26 28 Z M14 10 L18 10 M30 10 L34 10',
  horn: 'M4 18 L10 22 L28 22 L42 6 L44 14 L30 28 L10 28 L4 24 Z',
  jetpack: 'M10 4 L20 4 L20 24 L10 24 Z M26 4 L36 4 L36 24 L26 24 Z M12 24 L15 30 L18 24 M28 24 L31 30 L34 24 M20 10 L26 10',
  skull: 'M12 4 L36 4 L40 10 L40 20 L32 24 L32 30 L16 30 L16 24 L8 20 L8 10 Z M16 14 L22 14 L22 18 L16 18 Z M26 14 L32 14 L32 18 L26 18 Z',
  arrow: 'M6 16 L38 16 M30 8 L38 16 L30 24',
};

export function icon(name, color = 'currentColor', width = 3) {
  const d = P[name] || P.fist;
  return `<svg viewBox="0 0 48 32" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true"><path d="${d}"/></svg>`;
}
