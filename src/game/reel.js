// ?reel=1 — the move showcase: every animation, one at a time in the practice room against a dummy, with its
// name and how to do it. Steps only when told to (window.__reel.frame()), so it can be captured frame by frame.
//   ?reel=1&only=axeWhirl,sweep   just those scenes
import { Match } from './match.js';
import { practiceLevel } from '../level/practice.js';
import { FIGHTER_HP } from '../core/consts.js';
import { SCENES, ME, DUMMY, DUMMY2, stage, sceneInput } from './reel-scenes.js';

export async function reel(app, params) {
  const only = params.get('only') ? params.get('only').split(',') : null;
  const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  const roster = [
    { slot: ME, name: 'You', ai: false, local: true },
    { slot: DUMMY, name: 'Dummy', ai: true },
    { slot: DUMMY2, name: 'Dummy', ai: true },
  ];
  app.hud = { roundStart() {}, update() {}, death() {}, picked() {}, fight() {}, ragnarok() {}, roundEnd() {}, show() {}, note() {} };
  const m = new Match(app, roster, { level: practiceLevel(ME, DUMMY), playlist: { mode: 'fixed', codes: ['PRACTICE'] }, roundsToWin: 99, ragnarok: false, practice: true, dropRate: 'none' }, null);
  m.isAttract = true;
  app.match = m;
  await m.startRound('PRACTICE');
  m.bots = [];
  const sim = m.sim;
  // Skip the drop-in.
  while (sim.phase !== 'fight') { sim.step([]); sim.drainEvents(); }

  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;left:4%;top:6%;pointer-events:none;z-index:5;font-family:Anton,Impact,sans-serif;color:#E8E2D4;text-transform:uppercase;text-shadow:0.25vw 0.25vw 0 rgba(12,12,11,.9)';
  document.body.appendChild(card);
  const showCard = (sc, k) => {
    card.innerHTML = `<div style="font:700 1.4vw/1 'JetBrains Mono',monospace;letter-spacing:.3em;opacity:.75">${String(k + 1).padStart(2, '0')} / ${scenes.length}</div>
      <div style="font-size:5.2vw;line-height:.95;margin-top:.6vw">${sc.name}</div>
      <div style="font:700 1.5vw/1.3 'JetBrains Mono',monospace;letter-spacing:.08em;margin-top:.8vw;text-transform:none;opacity:.9">${sc.how}</div>`;
  };

  let k = -1, s = 0, sc = null, st = null;
  const begin = () => {
    k++; s = 0; sc = scenes[k]; st = { ap: 0, jp: 0, ak: 0, ad: 255 };
    if (!sc) return false;
    stage(sim, sc, k);
    showCard(sc, k);
    const me2 = sim.fighters[ME];
    // Frame the player and the dummy (or follow the player, for the movement scenes).
    const px = me2.pos().x, dx = sc.dummy != null ? 10 + sc.dummy : null;
    const cx = sc.follow ? Math.max(4.4, px + 1.5) : dx != null && Math.abs(dx - px) > 2.5 ? (px + dx) / 2 : px + 0.6;
    app.view.fixedCam = { x: cx, y: 3.4, w: sc.follow ? 12 : 9.5 };
    const C = app.view.cam; // cut, don't pan
    C.x = C.tx = app.view.fixedCam.x; C.y = C.ty = app.view.fixedCam.y; C.w = C.tw = app.view.fixedCam.w; C.vx = C.vy = C.vw = 0;
    return true;
  };
  begin();
  app.view.frames.length = 0;

  const stepOnce = () => {
    const inp = [];
    inp[ME] = sceneInput(sim, sc, s, st);
    sim.step(inp);
    if (sc.follow) {
      // Track the player smoothly (the camera itself is cut, so this is the only motion).
      const p = sim.fighters[ME].pos(), F = app.view.fixedCam, C = app.view.cam;
      F.x += (Math.max(4.4, p.x + (sc.wall ? 1.5 : 1.2)) - F.x) * 0.08; F.y += (Math.max(3.4, p.y + 0.6) - F.y) * 0.08;
      C.x = C.tx = F.x; C.y = C.ty = F.y; C.vx = C.vy = 0;
    }
    app.view.pushFrame(sim.frame(), sim.drainEvents());
    m.tick = sim.tick;
    s++;
    // Keep the dummies standing in for the next hit.
    for (const slot of [DUMMY, DUMMY2]) { const d = sim.fighters[slot]; if (d && d.alive && d.hp < FIGHTER_HP * 0.4) d.hp = FIGHTER_HP; }
    if (s >= sc.len) return begin();
    return true;
  };

  m.update = () => {};
  m.renderTick = m.tick;
  // Draw only when the capture asks (one render per captured frame, at the reel's own frame time).
  const draw = m.draw.bind(m);
  let pending = false, drawn = 0, frameDt = 1 / 30;
  m.draw = () => { if (!pending) return; pending = false; draw(frameDt); drawn++; };
  // The capture script calls frame(n): n sim steps, then the next render shows them.
  window.__reel = {
    scenes: scenes.map((x) => x.id),
    drawn: () => drawn,
    frame(n = 2) {
      let more = true;
      for (let i = 0; i < n && more; i++) more = stepOnce();
      m.renderTick = m.tick;
      frameDt = n / 60; pending = true;
      return more ? { scene: sc.id, s } : null;
    },
  };
  window.__reelReady = true;
}
