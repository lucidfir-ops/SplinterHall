export { createSfx } from './sfx.js';
// The live generator loads only when Options → Music → Source is Live generator.
export const loadMusic = () => import('./music/index.js');
