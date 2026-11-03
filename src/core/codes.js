// Level codes: 8 characters of Crockford base32. First character = setting, then a 35-bit seed.
// A custom level adds '.' and its edits (deflated, base32).
import { deflateSync, inflateSync } from 'fflate';
import { LETTER_SETTING, SETTING_LETTER, SETTINGS } from './consts.js';

export const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B32_INDEX = Object.fromEntries([...B32].map((c, i) => [c, i]));

export function cleanCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z.]/g, '');
}

export function randomCode(setting, rand = Math.random) {
  const letter = SETTING_LETTER[setting] || SETTING_LETTER[SETTINGS[Math.floor(rand() * 4)]];
  let s = letter;
  for (let i = 0; i < 7; i++) s += B32[Math.floor(rand() * 32)];
  return s;
}

// Parse a code into { base, setting, edits (Uint8Array|null), valid }.
export function parseCode(text) {
  const c = cleanCode(text);
  const [base, extra] = c.split('.', 2);
  if (!base || base.length !== 8) return { valid: false };
  const setting = LETTER_SETTING[base[0]];
  if (!setting) return { valid: false };
  for (const ch of base.slice(1)) if (!(ch in B32_INDEX)) return { valid: false };
  let edits = null;
  if (extra) {
    try {
      edits = inflateSync(b32decode(extra));
    } catch {
      return { valid: false };
    }
  }
  return { valid: true, base, setting, edits, code: extra ? base + '.' + extra : base };
}

export function makeCustomCode(base, editBytes) {
  if (!editBytes || !editBytes.length) return base;
  return base + '.' + b32encode(deflateSync(editBytes, { level: 9 }));
}

export function b32encode(bytes) {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function b32decode(text) {
  const out = [];
  let bits = 0, value = 0;
  for (const ch of text) {
    const v = B32_INDEX[ch];
    if (v === undefined) throw new Error('bad code');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// Small byte writer / reader with unsigned varints, for the edit list.
export class ByteWriter {
  constructor() { this.a = []; }
  byte(v) { this.a.push(v & 255); }
  varint(v) {
    v = Math.max(0, Math.floor(v));
    while (v >= 128) { this.a.push((v & 127) | 128); v = Math.floor(v / 128); }
    this.a.push(v);
  }
  bytes() { return new Uint8Array(this.a); }
}
export class ByteReader {
  constructor(u8) { this.u = u8; this.p = 0; }
  get done() { return this.p >= this.u.length; }
  byte() { if (this.p >= this.u.length) throw new Error('eof'); return this.u[this.p++]; }
  varint() {
    let v = 0, mul = 1, b;
    do { b = this.byte(); v += (b & 127) * mul; mul *= 128; } while (b & 128);
    return v;
  }
}

// Base64 helpers for snapshots (browser and Node).
export function toB64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
