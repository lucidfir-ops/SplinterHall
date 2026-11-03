// Screens built from a small declarative spec. Every screen works with touch, a gamepad or keys;
// B / Escape is always Back, and focus remembers its place when a screen is rebuilt or revisited.
import { escapeHtml } from './hud.js';
import { FIGHTER_COLORS } from '../core/consts.js';

export class Menus {
  constructor(root, app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.className = 'sh-layer';
    root.appendChild(this.root);
    this.stack = [];
    this.mem = new Map();
    this.cur = null;
    this.focusables = [];
    this.fi = 0;
  }

  get isOpen() { return !!this.cur; }

  // Open a screen: id, build() → spec. push keeps the previous screen for Back.
  open(id, build, push = true) {
    if (this.cur && push) this.stack.push(this.cur);
    this.cur = { id, build };
    this.render(true);
    this.app.input.menuHandler = (a, e) => this.nav(a, e);
  }

  replace(id, build) { this.open(id, build, false); }

  back() {
    if (this.cur && this.cur.spec && this.cur.spec.onBack) { if (this.cur.spec.onBack() === false) return; }
    const prev = this.stack.pop();
    if (prev) { this.cur = prev; this.render(true); this.app.sfx?.play('ui_back'); }
  }

  close() {
    this.cur = null;
    this.stack = [];
    this.root.innerHTML = '';
    this.app.input.menuHandler = null;
  }

  refresh() { if (this.cur) this.render(false); }

  render(restore) {
    const spec = this.cur.build();
    this.cur.spec = spec;
    const scr = document.createElement('div');
    scr.className = 'sh-screen';
    const bar = document.createElement('div');
    bar.className = 'sh-bar' + (spec.wide ? ' wide' : '');
    if (spec.kicker) bar.insertAdjacentHTML('beforeend', `<div class="sh-kicker">${escapeHtml(spec.kicker)}</div>`);
    if (spec.title) bar.insertAdjacentHTML('beforeend', `<div class="sh-h1">${escapeHtml(spec.title)}</div><div class="sh-rule"></div>`);
    const fl = [];
    const addItem = (it, parent, rowId = null) => {
      const n = fl.length;
      switch (it.type || 'btn') {
        case 'btn': {
          const wrap = document.createElement('div');
          wrap.className = 'sh-shadow';
          const b = document.createElement('button');
          b.className = 'sh-btn' + (it.primary ? ' sh-primary' : '') + (it.small ? ' small' : '') + (it.tiny ? ' tiny' : '') + (it.on ? ' on' : '');
          if (it.disabled) b.disabled = true;
          b.innerHTML = (it.n ? `<span class="n">${escapeHtml(it.n)}</span>` : '') + `<span>${escapeHtml(it.label)}</span>` + (it.value !== undefined ? `<span class="v">${escapeHtml(it.value)}</span>` : '');
          b.addEventListener('click', () => { this.setFocus(n); this.activate(fl[n]); });
          wrap.appendChild(b);
          parent.appendChild(wrap);
          fl.push({ el: b, it, row: rowId });
          break;
        }
        case 'set': case 'meter': case 'toggle': {
          const d = document.createElement('div');
          d.className = 'sh-set';
          d.tabIndex = -1;
          d.innerHTML = `<span class="k">${escapeHtml(it.label)}</span><span class="val"></span>`;
          d.addEventListener('click', (e) => {
            this.setFocus(n);
            const r = d.getBoundingClientRect();
            const leftHalf = e.clientX < r.left + r.width * 0.6 && it.type !== 'toggle';
            this.adjust(fl[n], leftHalf && (it.type === 'meter') ? -1 : 1);
          });
          parent.appendChild(d);
          const entry = { el: d, it, row: rowId };
          fl.push(entry);
          this.paintSet(entry);
          break;
        }
        case 'input': {
          const inp = document.createElement('input');
          inp.className = 'sh-input';
          inp.value = it.value || '';
          inp.maxLength = it.maxlength || 40;
          inp.placeholder = it.placeholder || '';
          inp.autocomplete = 'off'; inp.spellcheck = false;
          if (it.upper === false) inp.style.textTransform = 'none';
          inp.addEventListener('input', () => it.onInput && it.onInput(inp.value));
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { it.onEnter && it.onEnter(inp.value); e.preventDefault(); } if (e.key === 'Escape') inp.blur(); });
          inp.addEventListener('focus', () => this.setFocus(n, true));
          if (it.label) parent.insertAdjacentHTML('beforeend', `<div class="sh-label">${escapeHtml(it.label)}</div>`);
          parent.appendChild(inp);
          fl.push({ el: inp, it, row: rowId });
          break;
        }
        case 'swatches': {
          const g = document.createElement('div');
          g.className = 'sh-swatches';
          FIGHTER_COLORS.forEach((c, k) => {
            const s = document.createElement('button');
            s.className = 'sh-swatch' + (it.get() === k ? ' on' : '');
            s.style.background = c.hex;
            s.setAttribute('aria-label', c.name);
            const idx = fl.length;
            s.addEventListener('click', () => { this.setFocus(idx); it.set(k); this.refresh(); });
            g.appendChild(s);
            fl.push({ el: s, it: { type: 'swatch', onOk: () => { it.set(k); this.refresh(); } }, row: 'sw' });
          });
          parent.appendChild(g);
          break;
        }
        case 'row': {
          const r = document.createElement('div');
          r.className = 'sh-row';
          const rid = 'r' + n + Math.random();
          for (const sub of it.items) addItem(sub, r, rid);
          parent.appendChild(r);
          break;
        }
        case 'html': parent.insertAdjacentHTML('beforeend', it.html); break;
        case 'el': parent.appendChild(it.el); break;
        case 'rule': parent.insertAdjacentHTML('beforeend', '<div class="sh-rule"></div>'); break;
        case 'label': parent.insertAdjacentHTML('beforeend', `<div class="sh-label">${escapeHtml(it.label)}</div>`); break;
        case 'spacer': parent.insertAdjacentHTML('beforeend', '<div class="sh-spacer"></div>'); break;
      }
    };
    const menu = document.createElement('div');
    menu.className = 'sh-menu';
    for (const it of spec.items) addItem(it, menu);
    bar.appendChild(menu);
    if (spec.footer) for (const it of spec.footer) addItem(it, bar);
    scr.appendChild(bar);
    if (spec.side) { const side = document.createElement('div'); side.style.position = 'relative'; side.appendChild(spec.side); scr.appendChild(side); }
    this.root.innerHTML = '';
    this.root.appendChild(scr);
    if (spec.after) spec.after(scr);
    this.focusables = fl;
    let idx = restore ? (this.mem.get(this.cur.id) ?? (spec.focus ?? 0)) : this.fi;
    if (idx >= fl.length) idx = Math.max(0, fl.length - 1);
    if (fl[idx] && (fl[idx].it.disabled)) idx = fl.findIndex((f) => !f.it.disabled);
    this.setFocus(Math.max(0, idx), false, true);
  }

  paintSet(entry) {
    const it = entry.it;
    const v = it.get();
    const out = entry.el.querySelector('.val');
    if (it.type === 'meter') {
      const steps = Math.round((it.max - it.min) / it.step);
      const k = Math.round((v - it.min) / it.step);
      const shown = Math.min(10, steps);
      const fill = Math.round((k / steps) * shown);
      out.innerHTML = `<span class="sh-meter">${Array.from({ length: shown }, (_, q) => `<i class="${q < fill ? 'f' : ''}"></i>`).join('')}</span><span>${escapeHtml(it.fmt ? it.fmt(v) : v)}</span>`;
    } else if (it.type === 'toggle') out.innerHTML = `<span class="sh-tick">${v ? '×' : '&nbsp;'}</span>`;
    else {
      const o = it.options.find((q) => q.value === v) || it.options[0];
      out.textContent = o ? o.label : String(v);
    }
  }

  setFocus(i, fromDom = false, silent = false) {
    const fl = this.focusables;
    if (!fl.length) return;
    i = Math.max(0, Math.min(fl.length - 1, i));
    if (fl[this.fi]) fl[this.fi].el.classList.remove('focus');
    this.fi = i;
    const f = fl[i];
    f.el.classList.add('focus');
    if (!fromDom && f.it.type !== 'input' && document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (this.app.input.mode !== 'touch') f.el.scrollIntoView?.({ block: 'nearest' });
    if (this.cur) this.mem.set(this.cur.id, i);
    if (!silent) this.app.sfx?.play('ui_focus', { vol: 0.5 });
  }

  activate(f) {
    if (!f || f.it.disabled) return;
    const it = f.it;
    if (it.type === 'set' || it.type === 'toggle' || it.type === 'meter') { this.adjust(f, 1); return; }
    if (it.type === 'input') { f.el.focus(); return; }
    this.app.sfx?.play(it.primary ? 'ui_confirm' : 'ui_confirm', { vol: it.primary ? 1 : 0.7 });
    it.onOk && it.onOk();
  }

  adjust(f, dir) {
    const it = f.it;
    if (it.type === 'toggle') it.set(!it.get());
    else if (it.type === 'meter') it.set(Math.max(it.min, Math.min(it.max, +(it.get() + dir * it.step).toFixed(4))));
    else if (it.type === 'set') {
      const opts = it.options;
      let k = opts.findIndex((o) => o.value === it.get());
      k = (k + dir + opts.length) % opts.length;
      it.set(opts[k].value);
    }
    this.paintSet(f);
    this.app.sfx?.play('ui_focus', { vol: 0.7, pitch: 1.2 });
    if (it.refresh) this.refresh();
  }

  nav(a, e) {
    const fl = this.focusables;
    if (a === 'back') {
      if (document.activeElement && document.activeElement.tagName === 'INPUT' && e && e.code === 'Backspace') return false;
      this.back(); return true;
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && e && ['left', 'right', 'ok'].includes(a) && e.code !== 'Enter' && e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return false;
    if (!fl.length) return true;
    const cur = fl[this.fi];
    if (a === 'up' || a === 'down') {
      const d = a === 'up' ? -1 : 1;
      let i = this.fi + d;
      while (i >= 0 && i < fl.length && cur.row && fl[i].row === cur.row) i += d;
      if (i >= 0 && i < fl.length && fl[i].row) {
        // Land on the first member of a row when coming from above.
        if (d > 0) { /* already first */ } else { const r = fl[i].row; while (i - 1 >= 0 && fl[i - 1].row === r) i--; }
      }
      while (i >= 0 && i < fl.length && fl[i].it.disabled) i += d;
      if (i >= 0 && i < fl.length) this.setFocus(i);
      return true;
    }
    if (a === 'left' || a === 'right') {
      const d = a === 'left' ? -1 : 1;
      if (cur.it.type === 'set' || cur.it.type === 'meter') { this.adjust(cur, d); return true; }
      if (cur.row) { const i = this.fi + d; if (fl[i] && fl[i].row === cur.row && !fl[i].it.disabled) this.setFocus(i); }
      return true;
    }
    if (a === 'ok') { this.activate(cur); return true; }
    if (a === 'start') { const p = fl.find((f) => f.it.primary); if (p) this.activate(p); return true; }
    return true;
  }
}
