// Learn: a practice room with a training dummy and a coach that walks through the controls one at a time.
// Each step names the move for the device in use (touch, keys or a pad) and ticks off when the game sees it done.
import { Match } from './match.js';
import { W, H, MAT, cellIndex, CELLS, FIGHTER_COLORS, FIGHTER_HP } from '../core/consts.js';
import { escapeHtml } from '../ui/hud.js';

import { practiceLevel, SPAWN, DUMMY, PIT_X } from '../level/practice.js';
export { practiceLevel };

// The steps. text: { touch, keys, pad }. done(t, ev): true when finished (ev: this frame's events).
const STEPS = [
  { title: 'Run', text: { touch: 'Drag left or right anywhere on the left half of the screen.', keys: 'Arrow keys or A / D.', pad: 'Left stick.' },
    start: (t) => { t.x0 = t.me().pos().x; }, done: (t) => Math.abs(t.me().pos().x - t.x0) > 4 },
  { title: 'Jump', text: { touch: 'Push the stick up. Push up again in the air for a somersault and a second jump.', keys: 'Space. Again in the air: a somersault and a second jump.', pad: 'A. Again in the air: a somersault and a second jump.' },
    done: (t, ev) => ev.some((e) => e.t === 'jump' && e.s === t.slot && e.d) },
  { title: 'Wall jump', text: { touch: 'Jump at the wall on the left, keep pushing into it, then push up to kick off it.', keys: 'Jump at the left wall, hold Left into it, and press Space to kick off.', pad: 'Jump at the left wall, push into it, and press A to kick off.' },
    done: (t, ev) => ev.some((e) => e.t === 'jump' && e.s === t.slot && e.w) },
  { title: 'Duck', text: { touch: 'Drag the stick down and hold it. Jabs go over you.', keys: 'Hold Down or S. Jabs go over you.', pad: 'Hold the stick down. Jabs go over you.' },
    tick: (t, dt) => { t.duckT = t.me().ducking ? (t.duckT || 0) + dt : 0; }, done: (t) => t.duckT > 0.6 },
  { title: 'Jab', text: { touch: 'Walk up to the dummy and swipe the square toward it. Three quick: jab, cross, hook.', keys: 'Walk up to the dummy, then X or J. Three quick: jab, cross, hook.', pad: 'Walk up to the dummy, then X. Three quick: jab, cross, hook.' },
    done: (t, ev) => t.hit(ev, 'punch') },
  { title: 'Uppercut', text: { touch: 'Swipe straight up on the square. It lifts them off their feet.', keys: 'Hold Up and press X.', pad: 'Hold the stick up and press X.' },
    done: (t, ev) => t.hit(ev, 'uppercut') },
  { title: 'Slam', text: { touch: 'Swipe straight down. In the air it\'s a stomp dive.', keys: 'Hold Down and press X. In the air it\'s a stomp dive.', pad: 'Hold the stick down and press X. In the air it\'s a stomp dive.' },
    done: (t, ev) => t.hit(ev, 'slam') || t.hit(ev, 'stomp') },
  { title: 'Haymaker', text: { touch: 'Sweep right across the whole square. Slow, but it sends them flying.', keys: 'V or L. Slow, but it sends them flying.', pad: 'Y. Slow, but it sends them flying.' },
    done: (t, ev) => t.hit(ev, 'haymaker') },
  { title: 'Kick', text: { touch: 'Swipe along the dashed band at the bottom. Swiped upward: a roundhouse. Crouching: a leg sweep. A long sweep: a dropkick.', keys: 'C or K. Crouching: a leg sweep. At a run or in the air: a flying kick.', pad: 'B. Crouching: a leg sweep. At a run or in the air: a flying kick.' },
    done: (t, ev) => t.hit(ev, 'kick') || t.hit(ev, 'dropkick') },
  { title: 'Pick up', text: { touch: 'Stand on the axe and pull the stick down. Swipe to swing it; a big sweep whirls it round you.', keys: 'Stand on the axe and press Down. X swings it, V whirls it round you.', pad: 'Stand on the axe and push the stick down. X swings it, Y whirls it round you.' },
    start: (t) => t.giveItem('axe'), done: (t, ev) => ev.some((e) => e.t === 'pick' && e.s === t.slot) },
  { title: 'Throw', text: { touch: 'Tap the square: the axe flies the way the stick points.', keys: 'E: it flies the way you aim with the arrows.', pad: 'RB: it flies the way the stick points.' },
    done: (t, ev) => ev.some((e) => e.t === 'throw' && e.s === t.slot) },
  { title: 'Finish', text: { touch: 'Knock the dummy into the pit on the right. Haymakers and dropkicks carry.', keys: 'Knock the dummy into the pit on the right.', pad: 'Knock the dummy into the pit on the right.' },
    start: (t) => { t.finishing = true; }, done: (t, ev) => ev.some((e) => e.t === 'death' && e.s === t.dummySlot) },
];

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.k = 0;
    this.wait = 0;
    this.respawnT = 0;
    this.dummyT = 0;
    this.finishing = false;
  }

  async start() {
    const app = this.app;
    app.menus.close();
    app.stopAttract();
    app.endMatch();
    app.hud = app.hudReal;
    const slot = app.settings.color || 0;
    this.slot = slot;
    this.dummySlot = slot === 7 ? 6 : 7;
    const roster = [
      { slot, name: app.settings.name || 'Player', ai: false, local: true },
      { slot: this.dummySlot, name: 'Dummy', ai: true },
    ];
    const m = new Match(app, roster, { level: practiceLevel(slot, this.dummySlot), playlist: { mode: 'fixed', codes: ['PRACTICE'] }, roundsToWin: 99, ragnarok: false, practice: true, dropRate: 'none' }, null);
    m.isTutorial = true;
    this.match = m;
    app.match = m;
    app.tutorial = this;
    app.audio.setTune('practice-hall', { fresh: true });
    app.audio.startMatch();
    await m.startRound('PRACTICE');
    m.bots = []; // the dummy stands still
    m.listen = (ev) => this.events.push(...ev);
    this.events = [];
    app.updateTouchVisibility();
    app.hudReal.root.classList.add('sh-practice');
    this.mountPanel();
    this.begin(0);
  }

  me() { return this.match.sim.fighters[this.slot]; }
  dummy() { return this.match.sim.fighters[this.dummySlot]; }
  hit(ev, kind) { return ev.some((e) => e.t === 'hurt' && e.s === this.dummySlot && e.by === this.slot && e.k === kind); }

  // An item at the player's feet, a little toward the dummy.
  giveItem(kind) {
    const sim = this.match.sim, p = this.me().pos();
    const x = Math.min(PIT_X - 4, Math.max(2.5, p.x + 1.4));
    sim.items.spawn(kind, x, 3.6, false);
  }

  mode() {
    const a = this.app;
    if (a.input.mode === 'pad') return 'pad';
    if (a.input.mode === 'touch' || a.touchOn) return 'touch';
    return 'keys';
  }

  mountPanel() {
    const d = document.createElement('div');
    d.className = 'sh-tut';
    d.innerHTML = '<div class="k"></div><div class="t"></div><div class="x"></div><div class="bar"></div><button class="skip" type="button">Skip</button>';
    d.querySelector('.skip').addEventListener('click', () => this.next());
    this.app.hudReal.root.appendChild(d);
    this.panel = d;
  }

  render() {
    const s = STEPS[this.k];
    if (!s || !this.panel) return;
    const mode = this.mode();
    this.shownMode = mode;
    const p = this.panel;
    p.querySelector('.k').textContent = `Learn · ${String(this.k + 1).padStart(2, '0')} / ${STEPS.length}`;
    p.querySelector('.t').textContent = s.title;
    p.querySelector('.x').innerHTML = escapeHtml(s.text[mode]);
    p.querySelector('.bar').innerHTML = STEPS.map((_, i) => `<i class="${i < this.k ? 'f' : i === this.k ? 'c' : ''}"></i>`).join('');
    p.classList.remove('ok');
  }

  begin(k) {
    this.k = k;
    this.wait = 0;
    const s = STEPS[k];
    if (!s) return this.finish();
    s.start?.(this);
    this.render();
  }

  next() {
    if (this.wait > 0) return;
    this.app.audio.sfx('ui_confirm', { vol: 0.8 });
    this.panel?.classList.add('ok');
    if (this.panel) this.panel.querySelector('.t').textContent = 'Done';
    this.wait = 0.9;
  }

  update(dt) {
    const m = this.match;
    if (this.app.match !== m) { this.stop(); return; }
    if (m.state !== 'round' || !m.sim) return;
    const sim = m.sim, ev = this.events;
    this.events = [];
    if (this.mode() !== this.shownMode && this.wait <= 0) this.render();
    // Keep the dummy standing and the player alive: respawn whoever falls; the dummy never drops to 0 by hits
    // until the last step.
    const me = this.me(), dm = this.dummy();
    if (dm && dm.alive && !this.finishing && dm.hp < FIGHTER_HP * 0.5) dm.hp = FIGHTER_HP;
    if (me && !me.alive) { this.respawnT += dt; if (this.respawnT > 1.2) { this.respawnT = 0; sim.respawn(this.slot, SPAWN.x, SPAWN.y); } }
    if (dm && !dm.alive) {
      this.dummyT += dt;
      if (this.dummyT > (this.finishing ? 2.2 : 1)) { this.dummyT = 0; sim.respawn(this.dummySlot, DUMMY.x, DUMMY.y); }
    }
    if (sim.phase !== 'fight') return;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.begin(this.k + 1);
      return;
    }
    const s = STEPS[this.k];
    if (!s) return;
    s.tick?.(this, dt);
    if (s.done(this, ev)) this.next();
  }

  finish() {
    const app = this.app;
    app.settings.tutorialDone = true;
    app.saveSettings();
    this.panel?.remove();
    this.panel = null;
    app.menus.open('tut-done', () => ({
      kicker: 'Learn', title: 'Ready',
      items: [
        { type: 'html', html: `<div class="sh-mono" style="color:var(--dim);line-height:1.6">That's every move. Items do the rest: pick up anything that lands, swipe to use it, and keep an eye on the floor, because it breaks.</div>` },
        { label: 'Fight the AI', n: '01', primary: true, onOk: () => { this.stop(); app.endMatch(); app.startVersus(); } },
        { label: 'Again', n: '02', onOk: () => { this.stop(); new Tutorial(app).start(); } },
        { label: 'Menu', n: '03', onOk: () => { this.stop(); app.leaveMatch(); } },
      ],
      onBack: () => false,
    }), false);
    app.updateTouchVisibility();
  }

  stop() {
    this.app.hudReal.root.classList.remove('sh-practice');
    this.panel?.remove();
    this.panel = null;
    if (this.app.tutorial === this) this.app.tutorial = null;
  }
}
