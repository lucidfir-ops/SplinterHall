// Every input device is reduced to the same values: stick x, stick y, a buttons bitmask (1 = Jump held,
// 2 = Action held), press counters for Jump and Action, and for the latest Action press its kind (ATK) and
// direction (a byte, or NO_DIR to use the stick's aim).
//
// Touch: a stick wherever the left thumb lands (left / right run, up jumps and holds a jetpack, down crouches),
//   and one square on the right that reads gestures: tap = throw what's in hand (a jump with empty hands) ·
//   press and hold in the air = jetpack thrust · swipe = hit toward the swipe (up: uppercut, down: slam) ·
//   a big sideways sweep = haymaker · along the bottom band = kick (long: dropkick) · swipe and hold = keep using.
import { ATK, NO_DIR, dirToByte } from '../core/consts.js';

const DEAD = 0.18;
// Gesture thresholds, as a share of the square's size, and times in ms.
export const GESTURE = {
  move: 0.14,     // a press that travels less than this is a tap or a hold
  tapMs: 260,     // released sooner than this (and still) = tap = jump
  holdMs: 220,    // held still longer than this = hold
  stillMs: 130,   // a swipe whose finger stops this long commits as it stands (swipe and hold)
  longMs: 320,    // a swipe still travelling after this long commits anyway
  big: 0.5,       // a sideways sweep at least this long = haymaker
  band: 0.64,     // swipes in the square's lower part (from this height down) are kicks
};

// The attack a finished swipe means. All values are shares of the square: x0, y0 start (0..1 from the
// top-left), dx, dy travel (screen directions). Returns { kind, angle } with angle in world terms (y up).
//   along the kick band: kick, or a dropkick for a long sweep · a long sideways sweep: haymaker ·
//   straight up: uppercut · straight down: slam (a stomp dive in the air) · anything else: a jab that way.
export function classifySwipe(x0, y0, dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const midY = y0 + dy / 2;
  let kind = ATK.NORMAL;
  if ((y0 >= GESTURE.band || midY >= GESTURE.band + 0.04) && ax >= ay * 0.9) kind = ax >= GESTURE.big ? ATK.DROPKICK : ATK.KICK;
  else if (ax >= GESTURE.big && ax >= ay * 1.3) kind = ATK.HEAVY;
  else if (ay >= ax * 1.4) kind = dy < 0 ? ATK.UPPER : ATK.SLAM;
  return { kind, angle: Math.atan2(-dy, dx) };
}
export const ATK_NAME = { [ATK.NORMAL]: 'jab', [ATK.HEAVY]: 'haymaker', [ATK.KICK]: 'kick', [ATK.UPPER]: 'uppercut', [ATK.SLAM]: 'slam', [ATK.DROPKICK]: 'dropkick', [ATK.THROW]: 'throw' };
// The stick counts as pushed up (a jump) past this, and as let go of below UP_OFF.
export const UP_ON = 0.55, UP_OFF = 0.35;

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();
    this.jp = 0; this.ap = 0; this.ak = ATK.NORMAL; this.ad = NO_DIR;
    this.touch = { x: 0, y: 0, hold: false, act: false, up: false };
    this.holding = false;     // the local fighter has something in hand (only changes what a tap's label says)
    this.padPrev = { a: false, x: false, y: false, b: false };
    this.mode = 'keys';
    this.deadZone = DEAD;
    this.menuHandler = null;  // called with 'up'|'down'|'left'|'right'|'ok'|'back'|'start' while menus are open
    this.touchEnabled = false;
    this.haptics = true;
    this.onGesture = null;    // (name): 'jump' | 'hold' | a move from ATK_NAME
    this.bindKeys();
  }

  press(kind, dir = NO_DIR) {
    this.ap = (this.ap + 1) & 255;
    this.ak = kind;
    this.ad = dir;
  }
  jump() { this.jp = (this.jp + 1) & 255; }

  bindKeys() {
    const nav = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', Enter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back' };
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.mode = 'keys';
      if (!this.keys.has(e.code)) {
        if (e.code === 'Space' || e.code === 'KeyZ') this.jump();
        if (e.code === 'KeyX' || e.code === 'KeyJ') this.press(ATK.NORMAL);
        if (e.code === 'KeyC' || e.code === 'KeyK') this.press(ATK.KICK);
        if (e.code === 'KeyV' || e.code === 'KeyL') this.press(ATK.HEAVY);
        if (e.code === 'KeyE' || e.code === 'KeyI') this.press(ATK.THROW);
        if (e.code === 'Tab' && !this.menuHandler) { this.onOverview?.(); e.preventDefault(); }
      }
      this.keys.add(e.code);
      if (this.menuHandler && nav[e.code] && !e.repeat) { if (this.menuHandler(nav[e.code], e) !== false) e.preventDefault(); }
      else if (this.menuHandler && nav[e.code] && e.repeat && ['up', 'down', 'left', 'right'].includes(nav[e.code])) { this.menuHandler(nav[e.code], e); e.preventDefault(); }
      if (!this.menuHandler && e.code === 'Escape' && this.onPause) this.onPause();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  // Touch controls: a stick that appears where the left thumb lands, and the gesture square on the right.
  mountTouch(layer) {
    this.touchEnabled = true;
    const T = this.touch;
    const pad = document.createElement('div');
    pad.className = 'sh-touchpad';
    pad.innerHTML = '<div class="sh-ring"></div><div class="sh-knob"></div>';
    const zone = document.createElement('div');
    zone.className = 'sh-stickzone';
    const sq = document.createElement('div');
    sq.className = 'sh-tbtn sh-tact';
    // The eye: a look at the whole arena for a moment.
    const eye = document.createElement('div');
    eye.className = 'sh-tbtn sh-tview';
    eye.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
    eye.addEventListener('pointerdown', (e) => { this.onOverview?.(); eye.classList.add('on'); setTimeout(() => eye.classList.remove('on'), 160); e.preventDefault(); e.stopPropagation(); });
    sq.innerHTML = '<div class="sh-thint"><b>TAP</b> THROW<br><b>SWIPE</b> HIT<br><b>↑</b> UPPERCUT <b>↓</b> SLAM<br><b>SWEEP</b> HAYMAKER</div>'
      + '<div class="sh-kickband"><span>KICK · <b>LONG</b> DROPKICK</span></div>'
      + '<svg class="sh-trail"><polyline points=""/></svg><div class="sh-gest"></div>';
    layer.append(zone, pad, sq, eye);
    this.touchEls = { pad, zone, act: sq, eye };
    let stickId = null, cx = 0, cy = 0;
    const R = () => Math.max(48, Math.min(90, innerHeight * 0.14)) * (this.padScale || 1);
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId; cx = e.clientX; cy = e.clientY;
      zone.setPointerCapture(e.pointerId);
      pad.style.left = cx + 'px'; pad.style.top = cy + 'px';
      pad.style.setProperty('--r', R() + 'px');
      pad.classList.add('on');
      this.mode = 'touch';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      const r = R();
      let dx = (e.clientX - cx) / r, dy = -(e.clientY - cy) / r;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      T.x = dx; T.y = dy;
      // Pushed up (not just leaning that way while running): a jump; held up keeps a jetpack going.
      const upNow = T.up ? dy > UP_OFF : dy > UP_ON && dy > Math.abs(dx) * 0.75;
      if (upNow && !T.up) this.jump();
      T.up = upNow;
      pad.classList.toggle('up', upNow);
      pad.querySelector('.sh-knob').style.transform = `translate(calc(-50% + ${dx * r}px), calc(-50% + ${-dy * r}px))`;
    });
    const end = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null; T.x = 0; T.y = 0; T.up = false;
      pad.classList.remove('on', 'up');
      pad.querySelector('.sh-knob').style.transform = 'translate(-50%, -50%)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    this.mountGestures(sq);
  }

  // The gesture square. One finger at a time; the gesture is decided by how far, how fast and where it moves.
  mountGestures(sq) {
    const T = this.touch;
    const trail = sq.querySelector('.sh-trail'), line = trail.querySelector('polyline'), label = sq.querySelector('.sh-gest');
    let g = null, flashT = 0;
    const buzz = (ms) => { if (this.haptics && navigator.vibrate) navigator.vibrate(ms); };
    const show = (name, pts) => {
      label.textContent = name;
      sq.classList.remove('flash'); void sq.offsetWidth; sq.classList.add('flash');
      if (pts) { line.setAttribute('points', pts.map((p) => p.join(',')).join(' ')); trail.classList.remove('fade'); void trail.getBoundingClientRect(); trail.classList.add('fade'); }
      clearTimeout(flashT);
      flashT = setTimeout(() => sq.classList.remove('flash'), 420);
    };
    const local = (e) => [e.clientX - g.rect.left, e.clientY - g.rect.top];
    const commit = () => {
      if (!g || g.done) return;
      g.done = true;
      const S = g.size, [x1, y1] = g.path[g.path.length - 1], [x0, y0] = g.path[0];
      const c = classifySwipe(x0 / g.rect.width, y0 / g.rect.height, (x1 - x0) / S, (y1 - y0) / S);
      this.press(c.kind, dirToByte(c.angle));
      T.act = true; // held while the finger stays down: charge, beam, reel, grab
      const name = ATK_NAME[c.kind];
      buzz(c.kind === ATK.HEAVY || c.kind === ATK.DROPKICK ? 22 : c.kind === ATK.NORMAL ? 9 : 14);
      show(name.toUpperCase(), g.path);
      this.onGesture?.(name);
    };
    // Times come from the events themselves (when the finger moved), not from when a busy frame got round to
    // them, so a quick tap on a slow device is still a tap.
    this.tickGesture = (now) => {
      if (!g) return;
      if (g.state === 'pending' && now - g.t0 > GESTURE.holdMs) {
        // Holding still never jumps by itself (a resting thumb would): it keeps a jump going, so a jetpack thrusts.
        g.state = 'hold'; T.hold = true;
        this.onGesture?.('hold');
      }
      if (g.state === 'swipe' && !g.done && (now - g.tm > GESTURE.stillMs || now - g.ts > GESTURE.longMs)) commit();
    };
    sq.addEventListener('pointerdown', (e) => {
      if (g) return;
      sq.setPointerCapture(e.pointerId);
      const rect = sq.getBoundingClientRect();
      g = { id: e.pointerId, rect, size: Math.min(rect.width, rect.height), t0: e.timeStamp, tm: e.timeStamp, state: 'pending', path: [], done: false };
      g.path.push(local(e));
      sq.classList.add('on');
      this.mode = 'touch';
      e.preventDefault();
    });
    sq.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const p = local(e);
      const last = g.path[g.path.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 2) g.tm = e.timeStamp;
      g.path.push(p);
      if (g.path.length > 40) g.path.splice(1, 1);
      const [x0, y0] = g.path[0];
      const dx = (p[0] - x0) / g.size, dy = (p[1] - y0) / g.size;
      if ((g.state === 'pending' || g.state === 'hold') && Math.hypot(dx, dy) > GESTURE.move) { g.state = 'swipe'; g.ts = e.timeStamp; T.hold = false; }
      // A long sideways sweep commits at once, so the haymaker isn't late.
      if (g.state === 'swipe' && !g.done && Math.abs(dx) >= GESTURE.big + 0.1) commit();
    });
    const up = (e) => {
      if (!g || e.pointerId !== g.id) return;
      // A short still press is a tap even if a slow frame already took it for a hold.
      if ((g.state === 'pending' || g.state === 'hold') && e.timeStamp - g.t0 < GESTURE.tapMs) {
        // A tap throws what's in hand (along the stick's aim); with empty hands the game takes it as a jump.
        this.press(ATK.THROW); buzz(7); show(this.holding ? 'THROW' : 'JUMP');
        this.onGesture?.(this.holding ? 'throw' : 'jump');
      } else if (g.state === 'swipe') commit();
      T.hold = false; T.act = false;
      g = null;
      sq.classList.remove('on');
    };
    sq.addEventListener('pointerup', up);
    sq.addEventListener('pointercancel', up);
  }

  showTouch(on) {
    if (!this.touchEls) return;
    for (const el of Object.values(this.touchEls)) el.style.display = on ? '' : 'none';
  }

  // Poll gamepads; also feeds menu navigation.
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null;
    for (const g of pads) if (g && g.connected) { p = g; break; }
    if (!p) return null;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const dl = b(14), dr = b(15), du = b(12), dd = b(13);
    let x = Math.abs(ax) > this.deadZone ? ax : 0, y = Math.abs(ay) > this.deadZone ? -ay : 0;
    if (dl) x = -1; if (dr) x = 1; if (du) y = 1; if (dd) y = -1;
    const A = b(0), B = b(1), X = b(2), Y = b(3), start = b(9), lb = b(4), rb = b(5), sel = b(8);
    const any = A || B || X || Y || start || Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
    if (any) this.mode = 'pad';
    const pv = this.padPrev;
    // In a fight: A jumps, X hits (or uses the item), B kicks, Y throws a haymaker.
    if (!this.menuHandler) {
      if (A && !pv.a) this.jump();
      if (X && !pv.x) this.press(ATK.NORMAL);
      if (B && !pv.b) this.press(ATK.KICK);
      if (Y && !pv.y) this.press(ATK.HEAVY);
      if (rb && !pv.rb) this.press(ATK.THROW);
      if (sel && !pv.sel) this.onOverview?.();
    }
    // Menu navigation with repeat.
    if (this.menuHandler) {
      const dir = y > 0.6 ? 'up' : y < -0.6 ? 'down' : x < -0.6 ? 'left' : x > 0.6 ? 'right' : null;
      const now = performance.now();
      if (dir && (dir !== pv.dir || now > pv.next)) { this.menuHandler(dir); pv.next = now + (dir !== pv.dir ? 380 : 140); }
      pv.dir = dir;
      if (A && !pv.a) this.menuHandler('ok');
      if (B && !pv.b) this.menuHandler('back');
      if (lb && !pv.lb) this.menuHandler('prev');
      if (rb && !pv.rb) this.menuHandler('next');
    }
    if (start && !pv.start) { if (this.menuHandler) this.menuHandler('start'); else if (this.onPause) this.onPause(); }
    pv.a = A; pv.x = X; pv.y = Y; pv.b = B; pv.start = start; pv.lb = lb; pv.rb = rb; pv.sel = sel;
    return { x, y, b: (A ? 1 : 0) | (X ? 2 : 0) };
  }

  // The fighter input for this frame.
  read() {
    this.tickGesture?.(performance.now());
    const pad = this.pollPad();
    let x = 0, y = 0, b = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y += 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y -= 1;
    if (x && y) { x *= 0.7071; y *= 0.7071; }
    if (k.has('Space') || k.has('KeyZ')) b |= 1;
    if (k.has('KeyX') || k.has('KeyJ')) b |= 2;
    if (pad) { if (pad.x || pad.y) { x = pad.x; y = pad.y; } b |= pad.b; }
    const T = this.touch;
    if (T.x || T.y) { x = T.x; y = T.y; }
    if (T.hold || T.up) b |= 1;
    if (T.act) b |= 2;
    return { x, y, b, jp: this.jp, ap: this.ap, ak: this.ak, ad: this.ad };
  }
}
