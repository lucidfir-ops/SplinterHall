// Splinterhall multiplayer kit: names, timings and small helpers shared by every module in src/net/.
// Ported from Hoverline's HLNet (itself from browser-multiplayer-kit, Urchin Skipper, Oct 2026).

// CHANGE BOTH per game: rooms of different games must never meet (broker topics, BroadcastChannel names,
// Trystero's signalling topics and the Wi-Fi host pack's /mp/ping answer all derive from these).
export const APP_ID = 'splinterhall-v1';
export const RELAY_NAME = 'splinterhall';

const search = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search || '');
  } catch {
    return new URLSearchParams();
  }
})();

// Test hooks, only ever through URL parameters (DESIGN: "Test hooks only through URL parameters"):
//  ?broker=ws://host:port/mqtt  every player uses this one broker instead of the public ones (automated tests)
//  ?mp=local                    BroadcastChannel between tabs on one device, whatever the game asked for
//  ?direct=0                    no WebRTC direct path on the internet carrier (to measure the brokers alone)
//  ?ice=none                    direct path with no STUN servers (host candidates only: tests on one machine)
export const PARAMS = Object.freeze({
  broker: search.get('broker'),
  mp: search.get('mp'),
  direct: search.get('direct') !== '0',
  iceNone: search.get('ice') === 'none',
});

// Public brokers that accept anonymous WebSocket clients. All are joined and a message is sent through each that
// is open, so any one of them is enough. Both answered from a Steam Deck on October 25; each was briefly
// unreachable at some point that evening, which is why there are two.
export const DEFAULT_BROKERS = Object.freeze([
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
]);
export const brokerUrls = () => (PARAMS.broker ? [PARAMS.broker] : [...DEFAULT_BROKERS]);

export const NET = Object.freeze({
  maxPlayers: 8,
  heartbeatMs: 2000,
  // A player not heard from on any path for this long has left.
  silenceMs: 12000,
  // After a broker's last-will goodbye, a player not heard on any other path for this long has left.
  willMs: 3000,
  // A fast-only batch is skipped (the next one replaces it) while a broker socket is this far behind.
  backlogBytes: 64 * 1024,
  reconnectMs: [1000, 3000, 8000, 15000],
  // Hold a new sender's first messages this long so a slower path can fill in anything earlier; then wait at
  // most gapMs for a missing message.
  firstContactMs: 400,
  gapMs: 1500,
  // At most this many broker publishes per second per player (1000 / batchMs). Public brokers cap each
  // client's publish rate: broker.emqx.io dropped a third of 15 messages a second on October 25.
  batchMs: 125,
  // The direct path sends its own small heartbeat this often, and counts as up while heard within freshMs.
  directBeatMs: 500,
  directFreshMs: 1500,
  // One broker publish (and one relay POST) stays under this; bigger queues go out in several.
  maxBatchBytes: 48 * 1024,
  // Session: the host re-sends the roster this often; a joining player says hello this often until it is in.
  rosterMs: 3000,
  helloMs: 1000,
  // A join with no answering host fails after this long once the carrier is open...
  joinTimeoutMs: 6000,
  // ...and after this long when the carrier itself never opens (no broker reachable).
  openTimeoutMs: 12000,
  // Start and back-to-lobby messages are sent again after these delays: messages travel at most once per
  // path, so one lost message would leave a player stranded.
  repeatMs: [500, 1500, 3500],
  pingMs: 2000,
});

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

export function roomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

export const normaliseCode = (text) =>
  String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

// Player ids: 8 lowercase base-36 characters, which the Wi-Fi host pack's relay accepts (^[a-z0-9]{6,24}$).
export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => (n % 36).toString(36)).join('');

export const wallNow = () => Date.now();
export const monoNow = () => (globalThis.performance ? performance.now() : Date.now());

// A JSON value made safe to store and send: strings are trimmed to a length, anything else dropped.
export const shortText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
