// Shared constants for the simulation, the view and the UI.

export const GAME_NAME = 'Splinterhall';
export const PROTOTYPE = 4;

// Fighter health (snapshots carry it in one byte, so keep it at or under 255).
export const FIGHTER_HP = 250;
// Attack kinds carried with each Action press: a jab or item use, a haymaker (or a heavy weapon swing), a kick.
// UPPER: an uppercut; SLAM: a hammer-fist on the ground, a stomp dive in the air; DROPKICK: both feet, flying.
export const ATK = { NORMAL: 0, HEAVY: 1, KICK: 2, UPPER: 3, SLAM: 4, DROPKICK: 5, THROW: 6 };
// Attack direction byte: 0..254 is an angle, NO_DIR means 'use the stick's aim'.
export const NO_DIR = 255;
export const dirToByte = (a) => Math.round(((a + Math.PI) / (2 * Math.PI)) * 254) % 255;
export const byteToDir = (b) => (b / 254) * 2 * Math.PI - Math.PI;

// Arena: a grid of 1 m cells, x across, y up. Physics lives on the z = 0 plane.
export const W = 40;
export const H = 24;
export const CELLS = W * H;
export const KILL_Y = -2.5;          // below this a fighter dies (the liquid / abyss)
export const LIQUID_Y = -0.6;        // visual surface of lava / sea at the start of a round
export const SIDE_MARGIN = 12;       // leave the arena sideways or upward by this much and die
export const STEP = 1 / 60;          // fixed simulation step
export const GRAVITY = -24;

// Block materials. id 0 = empty.
export const MAT = { EMPTY: 0, BEDROCK: 1, STONE: 2, WOOD: 3, IRON: 4, ICE: 5, GLASS: 6 };
export const MAT_NAMES = ['empty', 'bedrock', 'stone', 'wood', 'iron', 'ice', 'glass'];
export const MAT_DEF = [
  null,
  { name: 'bedrock', hp: Infinity, density: 6, friction: 0.9, restitution: 0.05, sound: 'stone' },
  { name: 'stone', hp: 60, density: 4, friction: 0.85, restitution: 0.05, sound: 'stone' },
  { name: 'wood', hp: 25, density: 1.4, friction: 0.8, restitution: 0.1, sound: 'wood' },
  { name: 'iron', hp: 140, density: 7, friction: 0.7, restitution: 0.08, sound: 'iron' },
  { name: 'ice', hp: 20, density: 2.4, friction: 0.04, restitution: 0.05, sound: 'ice' },
  { name: 'glass', hp: 8, density: 2, friction: 0.5, restitution: 0.1, sound: 'glass' },
];

// Settings (one per level, never mixed). The letter is the first character of a level code.
export const SETTINGS = ['bunker', 'forge', 'fjord', 'hall'];
export const SETTING_LETTER = { bunker: 'B', forge: 'F', fjord: 'J', hall: 'H' };
export const LETTER_SETTING = { B: 'bunker', F: 'forge', J: 'fjord', H: 'hall' };
export const SETTING_TITLE = { bunker: 'Bunker', forge: 'Forge', fjord: 'Fjord', hall: 'Hall' };
export const SETTING_ACCENT = { bunker: '#F2C230', forge: '#FF5A1F', fjord: '#5FD8F0', hall: '#D8262E' };

// Fighter colours, chosen to stay apart for colour-blind players.
export const FIGHTER_COLORS = [
  { name: 'Bone', hex: '#EFE6D2' },
  { name: 'Ember', hex: '#FF6A1A' },
  { name: 'Glacier', hex: '#3FC8F2' },
  { name: 'Venom', hex: '#8BE33A' },
  { name: 'Gold', hex: '#FFC21A' },
  { name: 'Blood', hex: '#E5243B' },
  { name: 'Violet', hex: '#A45CFF' },
  { name: 'Teal', hex: '#1FD1A5' },
];
export const MAX_FIGHTERS = 8;

// Items. hand: held in the hand; back: worn (jetpack).
export const ITEMS = {
  axe: { name: 'Bearded axe', slot: 'hand', ammo: Infinity, melee: true },
  sword: { name: 'Greatsword', slot: 'hand', ammo: Infinity, melee: true },
  hammer: { name: 'War hammer', slot: 'hand', ammo: Infinity, melee: true },
  blunderbuss: { name: 'Blunderbuss', slot: 'hand', ammo: 4 },
  rocket: { name: 'Rocket launcher', slot: 'hand', ammo: 3 },
  bombs: { name: 'Bombs', slot: 'hand', ammo: 3 },
  web: { name: 'Web gun', slot: 'hand', ammo: 8 },
  tractor: { name: 'Tractor beam', slot: 'hand', ammo: 6 },   // seconds of beam
  portal: { name: 'Portal gun', slot: 'hand', ammo: Infinity },
  horn: { name: 'Serpent horn', slot: 'hand', ammo: 1 },
  jetpack: { name: 'Jetpack', slot: 'back', ammo: 4 },        // seconds of fuel
};
export const ITEM_KINDS = Object.keys(ITEMS);
export const ITEM_INDEX = Object.fromEntries(ITEM_KINDS.map((k, i) => [k, i + 1])); // 0 = none
export const ITEM_SETS = {
  all: ITEM_KINDS,
  melee: ['axe', 'sword', 'hammer', 'bombs', 'jetpack'],
  nosummons: ITEM_KINDS.filter((k) => k !== 'horn'),
};

// Prop kinds placed by levels and the editor.
export const PROPS = ['crate', 'barrel', 'boulder', 'plank', 'chain', 'lantern'];

// Collision groups (Rapier: membership in the high 16 bits, filter in the low 16).
export const G = {
  TERRAIN: 1 << 0,
  PROP: 1 << 1,
  ITEM: 1 << 2,
  PROJ: 1 << 3,
  FIGHTER0: 1 << 4, // fighters 0..7 use bits 4..11
  SERPENT: 1 << 12,
  SENSOR: 1 << 13,
};
export const ALL_FIGHTERS = 0xff << 4;
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const AI_SKILLS = [
  { name: 'Thrall', react: 0.35, aimErr: 14, think: 0.16 },
  { name: 'Warrior', react: 0.2, aimErr: 7, think: 0.1 },
  { name: 'Berserker', react: 0.09, aimErr: 2, think: 0.07 },
];

export const cellIndex = (i, j) => j * W + i;
export const cellI = (c) => c % W;
export const cellJ = (c) => (c / W) | 0;
export const inGrid = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
