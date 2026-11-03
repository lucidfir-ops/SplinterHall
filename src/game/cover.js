// ?cover=1 stages a dramatic moment for the itch.io cover image, freezes it and overlays the title.
import { Match } from './match.js';
import { FIGHTER_COLORS, STEP, GAME_NAME } from '../core/consts.js';

export async function coverShot(app, params) {
  const code = params.get('code') || 'JXAH67KH';
  const roster = Array.from({ length: 6 }, (_, slot) => ({ slot, name: FIGHTER_COLORS[slot].name, ai: true, skill: 2 }));
  app.hud = { roundStart() {}, update() {}, death() {}, picked() {}, fight() {}, ragnarok() {}, roundEnd() {}, show() {}, note() {} };
  const m = new Match(app, roster, { playlist: { mode: 'fixed', codes: [code] }, roundsToWin: 99, ragnarok: false });
  m.isAttract = true;
  app.match = m;
  await m.startRound(code);
  const sim = m.sim;
  if (params.get('cam')) { const [x, y, w] = params.get('cam').split(',').map(Number); app.view.fixedCam = { x, y, w }; }
  const kit = ['sword', 'hammer', 'rocket', 'axe', 'tractor', 'bombs'];
  sim.fighters.forEach((f, k) => { if (f) f.item = { kind: kit[k % kit.length], ammo: 9, id: 8000 + k }; });
  sim.fighters[2].back = { kind: 'jetpack', ammo: 4, id: 8100 };
  const at = +(params.get('t') || 4.2);
  const boomAt = at - +(params.get('dt') || 0.06);
  let boomed = false, serp = false, boomPt = null;
  m.update = (dt) => {
    if (m.frozen) return;
    const steps = 2;
    for (let s = 0; s < steps; s++) {
      const inp = [];
      for (const b of m.bots) inp[b.slot] = b.update(STEP);
      sim.step(inp);
      const ev = sim.drainEvents();
      app.view.pushFrame(sim.frame(), ev);
      m.tick = sim.tick;
      if (!serp && sim.time > at - 1.2) { serp = true; sim.items.blowHorn(sim.fighters[4]); }
      if (!boomed && sim.time > boomAt) {
        boomed = true;
        const t = sim.fighters[1].pos();
        boomPt = { x: t.x + 2, y: t.y - 0.5 };
        sim.items.explode(boomPt.x, boomPt.y, 3, 30, 3, { blocks: 120 });
        if (params.get('focus') === 'boom') app.view.fixedCam = { x: t.x + 2, y: t.y, w: 16 };
      }
      if (sim.time > at) {
        m.frozen = true;
        app.view.fx.shake = 0;
        app.view.freezeFx = true;
        for (const r of app.view.fx.rings) r.m.visible = false;
        // Frame the serpent, the blast and the fighters near them.
        if (!params.get('cam')) {
          const pts = [];
          for (const sp of sim.items.serpents) for (const seg of sp.segs) { const p = seg.body.translation(); if (p.y > -2) pts.push(p); }
          if (boomPt) pts.push(boomPt);
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          if (pts.length) {
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            const w = Math.max(20, Math.max(...xs) - Math.min(...xs) + 10, (Math.max(...ys) - Math.min(...ys) + 9) * 1.26);
            app.view.fixedCam = { x: cx, y: cy - w * 0.08, w };
          }
        }
        setTimeout(() => { window.__coverReady = true; }, 2500);
        break;
      }
    }
    m.renderTick = m.tick;
  };
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:4.5%;right:4.5%;bottom:6%;pointer-events:none;z-index:5';
  d.innerHTML = `<div style="font:400 15.6vw/.8 Anton,Impact,sans-serif;color:#E8E2D4;text-transform:uppercase;letter-spacing:-.005em;text-shadow:0.9vw 0.9vw 0 rgba(12,12,11,.9)">${GAME_NAME}</div>
    <div style="height:0.6vw;background:#E8E2D4;margin:2.2vw 0 1.6vw;box-shadow:0.6vw 0.6vw 0 rgba(12,12,11,.9)"></div>
    <div style="font:700 2.5vw/1 'JetBrains Mono',monospace;letter-spacing:.32em;color:#E8E2D4;text-transform:uppercase;text-shadow:0.3vw 0.3vw 0 #0C0C0B">Physics stick brawl · up to 8 fighters</div>`;
  document.body.appendChild(d);
}
