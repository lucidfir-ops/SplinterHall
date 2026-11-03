// Seeded random numbers. Everything that must match across devices (levels, item drops,
// tunes) comes from here; Math.random is only for cosmetics.

// sfc32: small, fast, good quality, 128-bit state.
export function sfc32(a, b, c, d) {
  return function rand() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// Hash any string or number into four 32-bit words (cyrb128).
export function hash128(str) {
  str = String(str);
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function makeRng(seed) {
  const r = sfc32(...hash128(seed));
  for (let i = 0; i < 12; i++) r(); // warm up
  const api = {
    next: r,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * r(),
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)), // inclusive
    chance: (p) => r() < p,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    weighted: (pairs) => {
      // pairs: [[value, weight], ...]
      let total = 0;
      for (const [, w] of pairs) total += w;
      let x = r() * total;
      for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    fork: (label) => makeRng(String(seed) + '/' + label),
  };
  return api;
}

// A cheap 32-bit integer hash for per-cell cosmetic variation (same on every device).
export function ihash(x, y = 0, z = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
