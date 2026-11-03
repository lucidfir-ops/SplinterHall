// The fight HUD: cues, not words. Text only appears between rounds.
import { FIGHTER_COLORS, ITEMS, FIGHTER_HP } from '../core/consts.js';
import { icon } from './icons.js';

const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };

export class Hud {
  constructor(root, app) {
    this.app = app;
    this.root = el('sh-hud sh-hidden');
    root.appendChild(this.root);
    this.scores = el('sh-scores');
    this.held = el('sh-held');
    this.feed = el('sh-feed');
    this.stamp = el('sh-stamp sh-hidden');
    this.edge = el('sh-edge');
    this.results = el('sh-results sh-hidden');
    this.lag = el('sh-lag sh-hidden', 'LAG · BROKER PATH');
    this.turn = el('sh-note sh-hidden', 'TURN YOUR PHONE SIDEWAYS');
    this.turn.style.top = '40%';
    this.fps = el('sh-fps sh-hidden');
    this.pause = document.createElement('button');
    this.pause.className = 'sh-pausebtn';
    this.pause.setAttribute('aria-label', 'Pause');
    this.pause.innerHTML = '<i></i>';
    this.pause.addEventListener('click', () => app.pause());
    this.root.append(this.edge, this.scores, this.held, this.feed, this.stamp, this.results, this.lag, this.fps, this.pause, this.turn);
    this.slots = new Map();
    this.lastHeld = '';
    this.frames = 0; this.fpsT = 0;
  }

  show(on) { this.root.classList.toggle('sh-hidden', !on); }

  roundStart(round, code, scores, roster) {
    this.show(true);
    this.results.classList.add('sh-hidden');
    this.edge.className = 'sh-edge';
    this.roster = roster;
    this.toWin = this.app.match ? this.app.match.opts.roundsToWin : 5;
    this.scores.innerHTML = '';
    this.slots.clear();
    for (const r of roster) {
      const d = el('sh-score');
      d.style.color = FIGHTER_COLORS[r.slot].hex;
      d.innerHTML = `<span class="chip" style="background:${FIGHTER_COLORS[r.slot].hex}"></span>` + Array.from({ length: this.toWin }, (_, k) => `<i class="${k < scores[r.slot] ? 'f' : ''}"></i>`).join('');
      if (r.local) d.classList.add('me');
      this.scores.appendChild(d);
      this.slots.set(r.slot, d);
    }
    this.feed.innerHTML = '';
    this.stampText(String(round).padStart(2, '0'), 'ROUND · ' + code.split('.')[0], 2.0);
  }

  stampText(big, sub, secs) {
    this.stamp.innerHTML = `<div class="big">${big}</div><div class="sub">${sub}</div>`;
    this.stamp.classList.remove('sh-hidden');
    clearTimeout(this.stampT);
    this.stampT = setTimeout(() => this.stamp.classList.add('sh-hidden'), secs * 1000);
  }

  fight() { this.stamp.classList.add('sh-hidden'); }
  ragnarok() { this.edge.classList.add('warn'); this.stampText('RAGNARÖK', 'THE DEPTHS RISE', 1.6); }

  picked() {}

  death(e, roster) {
    const d = el('sh-kill');
    const by = e.by >= 0 && e.by !== e.s ? `<i style="background:${FIGHTER_COLORS[e.by].hex}"></i>${icon('arrow', '#E8E2D4', 4)}` : icon('skull', '#E8E2D4', 3);
    d.innerHTML = `${by}<i style="background:${FIGHTER_COLORS[e.s].hex}"></i>`;
    this.feed.prepend(d);
    setTimeout(() => d.remove(), 3500);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
  }

  update(frame, localSlot) {
    for (const f of frame.fighters) {
      const d = this.slots.get(f.slot);
      if (d) d.classList.toggle('dead', !f.alive);
    }
    const me = frame.fighters.find((f) => f.slot === localSlot);
    let key = '';
    if (me) key = [me.item, Math.ceil(me.ammo), me.back, Math.round(me.fuel * 10), Math.round(me.hp / 5), me.alive].join('|');
    if (key !== this.lastHeld) {
      this.lastHeld = key;
      if (!me) { this.held.classList.add('sh-hidden'); }
      else {
        this.held.classList.remove('sh-hidden');
        const kind = me.item || 'fist';
        const def = ITEMS[me.item];
        let ammo = '';
        if (def && isFinite(def.ammo)) {
          const max = def.ammo, cur = me.ammo;
          const n = me.item === 'tractor' ? 6 : max;
          const filled = me.item === 'tractor' ? Math.ceil(cur) : cur;
          ammo = '<div class="sh-ammo">' + Array.from({ length: n }, (_, k) => `<i class="${k < filled ? '' : 'e'}"></i>`).join('') + '</div>';
        }
        const fuel = me.back ? `<div class="sh-col" style="gap:2px">${icon('jetpack', '#66c8ff', 3).replace('<svg', '<svg style="width:28px;height:18px"')}<div class="sh-fuel"><b style="width:${Math.round(me.fuel / 4 * 100)}%"></b></div></div>` : '';
        const hp = `<div class="sh-hp"><b style="width:${Math.max(0, Math.round(me.hp / FIGHTER_HP * 100))}%;background:${FIGHTER_COLORS[localSlot].hex}"></b></div>`;
        this.held.innerHTML = `${icon(kind, '#E8E2D4', 3)}<div class="sh-col" style="gap:6px">${hp}${ammo}</div>${fuel}`;
      }
    }
    // FPS counter
    if (this.app.settings.fps) {
      this.frames++;
      const now = performance.now();
      if (now - this.fpsT > 500) { this.fps.textContent = Math.round(this.frames * 1000 / (now - this.fpsT || 1)) + ' FPS'; this.frames = 0; this.fpsT = now; window.__fps = this.fps.textContent; }
      this.fps.classList.remove('sh-hidden');
    } else this.fps.classList.add('sh-hidden');
    this.turn.classList.toggle('sh-hidden', !(innerWidth < innerHeight * 0.85 && innerWidth < 700));
    const m = this.app.match;
    const lag = m && m.net && !m.isHost && m.net.room.quality && m.net.room.quality().quality === 'brokers';
    this.lag.classList.toggle('sh-hidden', !lag);
  }

  roundEnd(winner, scores, roster, final, code) {
    this.edge.classList.remove('warn');
    if (winner >= 0) {
      this.edge.style.setProperty('--edge', FIGHTER_COLORS[winner].hex);
      this.edge.classList.add('flood');
    }
    for (const r of roster) {
      const d = this.slots.get(r.slot);
      if (d) d.innerHTML = `<span class="chip" style="background:${FIGHTER_COLORS[r.slot].hex}"></span>` + Array.from({ length: this.toWin }, (_, k) => `<i class="${k < scores[r.slot] ? 'f' : ''}"></i>`).join('');
    }
    const name = winner >= 0 ? (roster.find((r) => r.slot === winner)?.name || FIGHTER_COLORS[winner].name) : 'NO ONE';
    this.stampText(winner >= 0 ? name.toUpperCase() : 'DRAW', final ? 'TAKES THE MATCH' : 'TAKES THE ROUND', 2.8);
    this.results.innerHTML = '';
    roster.forEach((r, k) => {
      const d = el('sh-res' + (r.slot === winner ? ' win' : ''));
      d.style.animationDelay = k * 40 + 'ms';
      d.innerHTML = `<div class="bar" style="background:${FIGHTER_COLORS[r.slot].hex}"></div><div class="nm">${escapeHtml(r.name)}</div><div class="pts">${Array.from({ length: this.toWin }, (_, q) => `<i class="${q < scores[r.slot] ? 'f' : ''}"></i>`).join('')}</div>`;
      this.results.appendChild(d);
    });
    this.results.classList.remove('sh-hidden');
  }

  note(text, secs = 2.4) {
    const n = el('sh-note', escapeHtml(text));
    this.root.parentElement.appendChild(n);
    setTimeout(() => n.remove(), secs * 1000);
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
