// QR codes (error correction level M, versions 1-20), after Project Nayuki's QR Code generator (MIT), as in
// Hoverline. Text made only of QR's alphanumeric characters (0-9, A-Z, space and $%*+-./:) uses alphanumeric
// mode, 5.5 bits a character instead of 8: the Wi-Fi pairing codes and level codes are base 32, so their QR
// codes come out two or three versions smaller, which phone cameras read faster and from further away.
//
// qrMatrix(text) gives a square array of rows of booleans (true = dark), without the quiet zone.
// drawQr(canvas, text, options) draws it as crisp square modules with a quiet zone.

const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
export const QR_MAX_VERSION = 20;

const mul = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};

const divisor = (n) => {
  const r = new Array(n).fill(0);
  r[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < n) r[j] ^= r[j + 1];
    }
    root = mul(root, 2);
  }
  return r;
};

const remainder = (data, div) => {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
};

const rawModules = (v) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};

const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];

const alignPos = (v) => {
  if (v === 1) return [];
  const na = Math.floor(v / 7) + 2;
  const size = v * 4 + 17;
  const step = Math.floor((v * 8 + na * 3 + 5) / (na * 4 - 4)) * 2;
  const r = [6];
  for (let p = size - 7; r.length < na; p -= step) r.splice(1, 0, p);
  return r;
};

// The data segment: mode, character count and payload bits for a version.
function segment(text, v) {
  const alnum = [...text].every((c) => ALNUM.includes(c));
  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  if (alnum) {
    put(2, 4);
    put(text.length, v < 10 ? 9 : 11);
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i]);
      if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11);
      else put(a, 6);
    }
  } else {
    const bytes = [...new TextEncoder().encode(text)];
    put(4, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
  }
  return bits;
}

export function qrMatrix(text, forceMask) {
  text = String(text);
  let v = 1;
  let bits;
  for (; v <= QR_MAX_VERSION; v++) {
    bits = segment(text, v);
    if (bits.length <= dataCodewords(v) * 8) break;
  }
  if (v > QR_MAX_VERSION) throw new Error('too long for a QR code');
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    data.push(b);
  }

  // Error correction blocks, interleaved.
  const nb = BLOCKS[v];
  const el = ECC[v];
  const raw = Math.floor(rawModules(v) / 8);
  const nShort = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = divisor(el);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1));
    k += d.length;
    const e = remainder(d, div);
    if (i < nShort) d.push(0);
    blocks.push(d.concat(e));
  }
  const cw = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - el || j >= nShort) cw.push(b[i]);
    });

  // The modules: function patterns first.
  const size = v * 4 + 17;
  const M = [];
  const F = [];
  for (let y = 0; y < size; y++) {
    M.push(new Array(size).fill(false));
    F.push(new Array(size).fill(false));
  }
  const set = (x, y, d) => {
    M[y][x] = d;
    F[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  const ap = alignPos(v);
  const na = ap.length;
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const format = (mask) => {
    const d = (0 << 3) | mask; // level M is 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const g = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i));
    set(8, 7, g(6));
    set(8, 8, g(7));
    set(7, 8, g(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, d);
      set(c, a, d);
    }
  }

  // The data, in the zigzag.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!F[y][x] && i < cw.length * 8) {
          M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  // The mask with the lowest penalty (runs, blocks and balance).
  const inv = (m, x, y) =>
    [
      (x + y) % 2,
      y % 2,
      x % 3,
      (x + y) % 3,
      (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
      ((x * y) % 2) + ((x * y) % 3),
      (((x * y) % 2) + ((x * y) % 3)) % 2,
      (((x + y) % 2) + ((x * y) % 3)) % 2,
    ][m] === 0;
  const apply = (m) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!F[y][x] && inv(m, x, y)) M[y][x] = !M[y][x];
  };
  const penalty = () => {
    let p = 0;
    let dark = 0;
    for (let a = 0; a < 2; a++)
      for (let y = 0; y < size; y++) {
        let run = 1;
        for (let x = 1; x <= size; x++) {
          const same = x < size && (a ? M[x][y] : M[y][x]) === (a ? M[x - 1][y] : M[y][x - 1]);
          if (same) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
      }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = M[y][x];
        if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3;
      }
    for (const row of M) for (const c of row) if (c) dark++;
    return p + 10 * Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
  };
  let best = forceMask;
  let bestPenalty = Infinity;
  if (best == null)
    for (let m = 0; m < 8; m++) {
      apply(m);
      format(m);
      const pp = penalty();
      if (pp < bestPenalty) {
        bestPenalty = pp;
        best = m;
      }
      apply(m);
    }
  apply(best);
  format(best);
  return M;
}

// Draws text as a QR code on a canvas: square modules on whole device pixels (no smoothing), a quiet zone of
// `quiet` modules all round. Dark modules in `dark`, the rest in `light` (dark on light: every phone camera
// reads that; light-on-dark codes fail on some). cssSize is the width it will be shown at, in CSS pixels.
// Returns the matrix size in modules.
export function drawQr(canvas, text, { dark = '#0C0C0B', light = '#E8E2D4', quiet = 4, cssSize = 300 } = {}) {
  const M = qrMatrix(text);
  const n = M.length + quiet * 2;
  const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
  const k = Math.max(2, Math.floor((cssSize * dpr) / n));
  canvas.width = canvas.height = n * k;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = light;
  g.fillRect(0, 0, n * k, n * k);
  g.fillStyle = dark;
  M.forEach((row, y) =>
    row.forEach((d, x) => {
      if (d) g.fillRect((x + quiet) * k, (y + quiet) * k, k, k);
    }),
  );
  canvas.style.width = `${(n * k) / dpr}px`;
  canvas.style.height = `${(n * k) / dpr}px`;
  canvas.style.imageRendering = 'pixelated';
  return M.length;
}
