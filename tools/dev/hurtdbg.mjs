import { Fighter } from '../../src/sim/fighter.js';
const orig = Fighter.prototype.hurt;
let n = 0;
Fighter.prototype.hurt = function (...a) {
  try { return orig.apply(this, a); } catch (e) { if (n++ < 3) console.log('HURT THREW', e.message, JSON.stringify(a.slice(0, 5)), e.stack.split('\n').slice(1, 5).join(' | ')); throw e; }
};
await import('./duel.mjs');
