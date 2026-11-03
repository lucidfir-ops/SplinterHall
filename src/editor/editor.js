// The level editor: starts from a seed and stores edits on top of it as a custom level code.
import * as THREE from 'three';
import { W, H, CELLS, MAT, MAT_NAMES, PROPS, SETTINGS, SETTING_TITLE, ITEM_KINDS, ITEMS, FIGHTER_COLORS, cellIndex, inGrid } from '../core/consts.js';
import { randomCode, parseCode } from '../core/codes.js';
import { buildLevel, generateBase, checkLevel, encodeEdits, ARCHETYPES } from '../level/generate.js';
import { levelStore } from './store.js';
import { escapeHtml } from '../ui/hud.js';
import { Match } from '../game/match.js';
import { icon } from '../ui/icons.js';

const TOOLS = ['paint', 'erase', 'bedrock', 'prop', 'spawn', 'pad'];
const TOOL_NAME = { paint: 'Paint', erase: 'Erase', bedrock: 'Bedrock', prop: 'Prop', spawn: 'Spawn', pad: 'Item pad' };
const PAINT_MATS = [MAT.STONE, MAT.WOOD, MAT.IRON, MAT.ICE, MAT.GLASS];

export class Editor {
  constructor(app) {
    this.app = app;
    this.view = app.view;
    this.active = false;
    this.testing = false;
    this.tool = 'paint';
    this.mat = MAT.STONE;
    this.propKind = 'crate';
    this.padLock = 0;
    this.brush = 1;
    this.mirror = false;
    this.cursor = { i: 10, j: 10 };
    this.undo = [];
    this.redo = [];
    this.name = '';
    this.marks = new THREE.Group();
    this.grid = null;
  }

  async open(code) {
    this.active = true;
    const c = code ? parseCode(code) : null;
    const start = c && c.valid ? c.code : randomCode(SETTINGS[Math.floor(Math.random() * 4)]);
    await this.load(start);
    this.mountUI();
    this.app.input.menuHandler = (a, e) => this.key(a, e);
    this.bindPointer();
    this.bindKeys();
  }

  async load(code) {
    const level = buildLevel(code);
    this.level = { ...level, grid: new Uint8Array(level.grid), spawns: level.spawns.map((s) => ({ ...s })), pads: level.pads.map((p) => ({ ...p })), props: level.props.map((p) => ({ ...p })) };
    this.base = parseCode(code).base;
    this.setting = level.setting;
    this.app.setAccent(this.setting);
    await this.redrawAll();
    this.check();
  }

  async redrawAll() {
    const v = this.view;
    await v.setLevel({ ...this.level, code: this.base });
    v.cur = null;
    if (!this.cursorMesh) {
      const g = new THREE.BoxGeometry(1.04, 1.04, 2.3);
      const edges = new THREE.EdgesGeometry(g);
      this.cursorMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
      this.cursorFill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    }
    v.scene.add(this.cursorMesh, this.cursorFill, this.marks);
    if (!this.gridMesh) {
      const pts = [];
      for (let i = 0; i <= W; i++) pts.push(i, 0, -1.05, i, H, -1.05);
      for (let j = 0; j <= H; j++) pts.push(0, j, -1.05, W, j, -1.05);
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.gridMesh = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
    }
    v.scene.add(this.gridMesh);
    this.drawMarks();
  }

  drawMarks() {
    const g = this.marks;
    while (g.children.length) g.remove(g.children[0]);
    const L = this.level;
    L.spawns.forEach((s, k) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: FIGHTER_COLORS[k % 8].hex, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 }));
      m.position.set(s.x, s.y + 0.9, 0.4);
      g.add(m);
    });
    L.pads.forEach((p) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.2), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffa030, emissiveIntensity: 2 }));
      m.position.set(p.x, p.y + 0.06, 0);
      g.add(m);
    });
    L.props.forEach((p) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x9fd8ff, emissiveIntensity: 1.5, wireframe: true }));
      m.position.set(p.x, p.kind === 'chain' || p.kind === 'lantern' ? p.y - 0.5 : p.y + 0.4, 0.5);
      g.add(m);
    });
    if (this.problems) for (const c of this.problems) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.2), new THREE.MeshBasicMaterial({ color: 0xd8262e, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.set((c % W) + 0.5, ((c / W) | 0) + 0.5, 1.2);
      g.add(m);
    }
  }

  // ------------------------------------------------------------ editing
  snapshot() {
    const L = this.level;
    return { grid: new Uint8Array(L.grid), spawns: L.spawns.map((s) => ({ ...s })), pads: L.pads.map((p) => ({ ...p })), props: L.props.map((p) => ({ ...p })) };
  }
  pushUndo() { this.undo.push(this.snapshot()); if (this.undo.length > 100) this.undo.shift(); this.redo = []; }
  restore(s) {
    const L = this.level;
    for (let c = 0; c < CELLS; c++) if (L.grid[c] !== s.grid[c]) this.setCell(c, s.grid[c], false);
    L.spawns = s.spawns; L.pads = s.pads; L.props = s.props;
    this.drawMarks(); this.check();
  }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); this.restore(this.undo.pop()); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); this.restore(this.redo.pop()); }

  setCell(c, m, mark = true) {
    const L = this.level;
    if (L.grid[c] === m) return;
    if (L.grid[c]) this.view.blocks.removeCell(c);
    L.grid[c] = m;
    if (m) this.view.blocks.addCell(c, m);
    if (mark) this.dirty = true;
  }

  cellsAt(i, j) {
    const out = [];
    const r = this.brush - 1;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = i + di, b = j + dj;
      if (inGrid(a, b)) out.push([a, b]);
      if (this.mirror && inGrid(W - 1 - a, b)) out.push([W - 1 - a, b]);
    }
    return out;
  }

  apply(i, j, erase = false, stroke = false) {
    if (!inGrid(i, j)) return;
    if (!stroke) this.pushUndo();
    const L = this.level;
    const tool = erase ? 'erase' : this.tool;
    const pts = (x, y) => this.mirror ? [[x, y], [W - x, y]] : [[x, y]];
    switch (tool) {
      case 'paint': for (const [a, b] of this.cellsAt(i, j)) this.setCell(cellIndex(a, b), this.mat); break;
      case 'erase': for (const [a, b] of this.cellsAt(i, j)) this.setCell(cellIndex(a, b), 0);
        // Also clear spots in this cell.
        L.props = L.props.filter((p) => !(Math.floor(p.x) === i && Math.floor(p.y + 0.01) === j));
        L.pads = L.pads.filter((p) => !(Math.floor(p.x) === i && Math.floor(p.y + 0.01) === j));
        break;
      case 'bedrock': for (const [a, b] of this.cellsAt(i, j)) this.setCell(cellIndex(a, b), MAT.BEDROCK); break;
      case 'prop': if (!stroke) for (const [x, y] of pts(i + 0.5, j)) {
        if (this.propKind === 'chain' || this.propKind === 'lantern') {
          // Hang from the nearest ceiling above.
          let cj = -1;
          for (let q = j + 1; q < H; q++) if (L.grid[cellIndex(Math.floor(x), q)]) { cj = q; break; }
          if (cj >= 0) L.props.push({ kind: this.propKind, x, y: cj });
        } else L.props.push({ kind: this.propKind, x, y });
      } break;
      case 'spawn': if (!stroke) {
        // Move the nearest spawn here (there are always 8).
        let best = 0, bd = Infinity;
        L.spawns.forEach((s, k) => { const d = Math.hypot(s.x - (i + 0.5), s.y - j); if (d < bd) { bd = d; best = k; } });
        if (L.spawns.length < 8) L.spawns.push({ x: i + 0.5, y: j });
        else L.spawns[best] = { x: i + 0.5, y: j };
      } break;
      case 'pad': if (!stroke) {
        const k = L.pads.findIndex((p) => Math.floor(p.x) === i && Math.floor(p.y + 0.01) === j);
        if (k >= 0) L.pads.splice(k, 1);
        else if (L.pads.length < 6) L.pads.push({ x: i + 0.5, y: j, lock: this.padLock });
        else this.app.note('At most 6 item pads');
      } break;
    }
    this.drawMarks();
    this.checkSoon();
  }

  checkSoon() { clearTimeout(this.ct); this.ct = setTimeout(() => this.check(), 120); }

  check() {
    const chk = checkLevel(this.level);
    this.ok = chk.ok;
    this.problems = chk.ok ? null : chk.problems.slice(0, 200);
    this.code = encodeEdits(this.base, this.setting, this.level);
    this.drawMarks();
    this.paintStatus(chk);
  }

  // ------------------------------------------------------------ UI
  mountUI() {
    const root = document.createElement('div');
    root.className = 'sh-ed';
    this.ui = root;
    this.app.uiRoot.appendChild(root);
    this.renderUI();
  }

  renderUI() {
    const root = this.ui;
    if (!root) return;
    const btn = (label, on, act, extra = '') => `<div class="sh-shadow"><button class="sh-btn tiny${on ? ' on focus' : ''}" data-act="${act}" ${extra}>${label}</button></div>`;
    let tools = TOOLS.map((t, k) => btn(`${k + 1} ${TOOL_NAME[t]}`, this.tool === t, 'tool:' + t)).join('');
    let opts = '';
    if (this.tool === 'paint') opts = '<div class="sh-label">Material</div>' + PAINT_MATS.map((m) => btn(MAT_NAMES[m].toUpperCase(), this.mat === m, 'mat:' + m)).join('');
    if (this.tool === 'prop') opts = '<div class="sh-label">Prop</div>' + PROPS.map((p) => btn(p.toUpperCase(), this.propKind === p, 'prop:' + p)).join('');
    if (this.tool === 'pad') opts = '<div class="sh-label">Locked to</div>' + [btn('ANY', this.padLock === 0, 'lock:0'), ...ITEM_KINDS.map((k, i) => btn(ITEMS[k].name.toUpperCase(), this.padLock === i + 1, 'lock:' + (i + 1)))].join('');
    const brush = '<div class="sh-label">Brush</div><div class="sh-row">' + [1, 2, 3].map((b) => btn(String(b), this.brush === b, 'brush:' + b)).join('') + '</div>';
    root.innerHTML = `
      <div class="sh-edtools">
        <div class="sh-label">Editor · ${escapeHtml(SETTING_TITLE[this.setting])}</div>
        ${tools}${opts}${brush}
        ${btn('MIRROR ' + (this.mirror ? 'ON' : 'OFF'), this.mirror, 'mirror')}
        <div class="sh-row">${btn('UNDO', false, 'undo')}${btn('REDO', false, 'redo')}</div>
        <div class="sh-rule"></div>
        ${btn('TEST', false, 'test')}${btn('SAVE', false, 'save')}${btn('LOAD', false, 'load')}${btn('EXIT', false, 'exit')}
      </div>
      <div class="sh-edtop">
        ${SETTINGS.map((s) => btn(SETTING_TITLE[s].toUpperCase(), this.setting === s, 'setting:' + s)).join('')}
        ${btn('NEW SEED', false, 'seed')}
        ${btn(this.level.archetype.toUpperCase(), false, 'arch')}
        <div class="sh-edcode" data-act="copy" title="Copy">${escapeHtml(this.code || this.base)}</div>
        ${btn('COPY', false, 'copy')}${btn('ENTER CODE', false, 'enter')}${btn('PLAY IN A MATCH', false, 'use')}
      </div>
      <div class="sh-edstatus"></div>`;
    root.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); this.act(el.dataset.act); }));
    this.paintStatus();
  }

  paintStatus(chk) {
    if (chk) this.lastChk = chk;
    const s = this.ui && this.ui.querySelector('.sh-edstatus');
    if (!s) return;
    chk = this.lastChk;
    const cells = this.level.grid.reduce((n, m) => n + (m ? 1 : 0), 0);
    s.className = 'sh-edstatus' + (this.ok === false ? ' bad' : '');
    s.textContent = this.ok === false ? `CHECK FAILS · ${chk?.reason || ''} · red cells can't be reached` : `${cells} BLOCKS · ${this.level.spawns.length} SPAWNS · ${this.level.pads.length} PADS · ${this.level.props.length} PROPS · ${Math.round((chk?.openFrac || 0) * 100)}% OPEN · CODE ${String(this.code || '').length} CHARS`;
    const code = this.ui.querySelector('.sh-edcode');
    if (code) code.textContent = this.code || this.base;
  }

  async act(a) {
    const [k, v] = a.split(':');
    switch (k) {
      case 'tool': this.tool = v; break;
      case 'mat': this.mat = +v; break;
      case 'prop': this.propKind = v; break;
      case 'lock': this.padLock = +v; break;
      case 'brush': this.brush = +v; break;
      case 'mirror': this.mirror = !this.mirror; break;
      case 'undo': this.doUndo(); break;
      case 'redo': this.doRedo(); break;
      case 'setting': { const code = randomCode(v); this.undo = []; await this.load(code); break; }
      case 'seed': { this.undo = []; await this.load(randomCode(this.setting)); break; }
      case 'arch': {
        const next = ARCHETYPES[(ARCHETYPES.indexOf(this.level.archetype) + 1) % ARCHETYPES.length];
        const L = generateBase(this.base, this.setting, next);
        this.level = { ...L, grid: new Uint8Array(L.grid) };
        await this.redrawAll(); this.check(); break;
      }
      case 'copy': try { await navigator.clipboard.writeText(this.code); this.app.note('Code copied'); } catch { this.app.note('Copy blocked · select the code text'); } break;
      case 'enter': this.textDialog('Level code', '', 2000, async (t) => {
        const c = parseCode(t);
        if (c.valid) { this.undo = []; await this.load(c.code); this.renderUI(); } else this.app.note('That code is not valid');
      }); return;
      case 'use': {
        if (!this.ok) { this.app.note('Fix the red cells first'); break; }
        const p = this.app.matchOpts.playlist; p.mode = 'fixed'; p.codes = [this.code]; this.app.saveMatchOpts();
        this.app.note('This level is now the match playlist');
        break;
      }
      case 'save': this.saveDialog(); return;
      case 'load': this.loadDialog(); return;
      case 'test': this.test(); return;
      case 'exit': this.app.closeEditor(); return;
    }
    this.renderUI();
  }

  saveDialog() {
    if (!this.ok) { this.app.note('The level must pass the check to save'); return; }
    this.textDialog('Name this level', this.name || (SETTING_TITLE[this.setting] + ' ' + this.base.slice(1, 5)), 24, (name) => {
      if (!name.trim()) return;
      this.name = name.trim().slice(0, 24);
      levelStore.put({ name: this.name, code: this.code, setting: this.setting, date: Date.now() });
      this.app.note('Saved · ' + this.name);
    });
  }

  // A one-field screen in the game's own UI (native prompts can be blocked in an itch.io frame).
  textDialog(title, value, max, done) {
    const app = this.app;
    let text = value;
    const finish = (ok) => { app.menus.close(); this.app.input.menuHandler = (a, e) => this.key(a, e); if (ok) done(text); };
    app.menus.open('ed-text', () => ({
      kicker: 'Editor', title,
      items: [
        { type: 'input', value, maxlength: max, upper: false, onInput: (v) => { text = v; }, onEnter: () => finish(true) },
        { type: 'row', items: [{ label: 'Cancel', small: true, onOk: () => finish(false) }, { label: 'OK', primary: true, onOk: () => finish(true) }] },
      ],
      onBack: () => { finish(false); return false; },
      after: (scr) => { const i = scr.querySelector('input'); if (i) setTimeout(() => i.focus(), 30); },
    }));
  }

  loadDialog() {
    const list = levelStore.list();
    const app = this.app;
    app.menus.open('ed-load', () => ({
      kicker: 'Editor', title: 'Load',
      items: [
        ...(list.length ? list.map((L) => ({ type: 'row', items: [
          { label: L.name, small: true, onOk: async () => { app.menus.close(); this.name = L.name; this.undo = []; await this.load(L.code); this.renderUI(); this.app.input.menuHandler = (a, e) => this.key(a, e); } },
          { label: 'Copy', tiny: true, onOk: async () => { try { await navigator.clipboard.writeText(L.code); app.note('Code copied'); } catch { app.note('Copy blocked'); } } },
          { label: 'Delete', tiny: true, onOk: () => { levelStore.remove(L.name); app.menus.refresh(); } },
        ] })) : [{ type: 'html', html: '<div class="sh-mono" style="color:var(--dim)">No saved levels yet.</div>' }]),
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => { app.menus.close(); this.app.input.menuHandler = (a, e) => this.key(a, e); } },
      ],
      onBack: () => { app.menus.close(); this.app.input.menuHandler = (a, e) => this.key(a, e); return false; },
    }));
  }

  // Play the level at once with 3 AI; Back returns to the editor.
  async test() {
    if (!this.ok) { this.app.note('Fix the red cells first'); return; }
    this.testing = true;
    this.active = false;
    this.ui.style.display = 'none';
    this.app.input.menuHandler = null;
    for (const o of [this.cursorMesh, this.cursorFill, this.marks, this.gridMesh]) this.view.scene.remove(o);
    const me = this.app.settings.color;
    const roster = [{ slot: me, name: this.app.settings.name, local: true, ai: false }];
    [...Array(8).keys()].filter((k) => k !== me).slice(0, 3).forEach((s) => roster.push({ slot: s, name: FIGHTER_COLORS[s].name, ai: true, skill: 1 }));
    this.app.hud = this.app.hudReal;
    this.app.match = new Match(this.app, roster, { playlist: { mode: 'fixed', codes: [this.code] }, roundsToWin: 99, ragnarok: false });
    this.app.audio.startMatch();
    await this.app.match.startRound(this.code);
    this.app.updateTouchVisibility();
    // Pause returns to the editor while testing.
    this.app.pauseOverride = () => this.endTest();
  }

  async endTest() {
    this.app.pauseOverride = null;
    this.app.endMatch();
    this.testing = false;
    this.active = true;
    this.ui.style.display = '';
    this.app.audio.menuMusic();
    await this.redrawAll();
    this.app.input.menuHandler = (a, e) => this.key(a, e);
    this.app.updateTouchVisibility();
  }

  // ------------------------------------------------------------ input
  bindPointer() {
    const canvas = this.app.canvas;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const cellAt = (e) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.view.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return { i: Math.floor(hit.x), j: Math.floor(hit.y) };
    };
    let down = false, erase = false, last = '';
    this.onDown = (e) => {
      if (!this.active || e.target !== canvas) return;
      const c = cellAt(e);
      if (!c) return;
      down = true; erase = e.button === 2;
      this.cursor = c;
      this.apply(c.i, c.j, erase, false);
      last = c.i + ',' + c.j;
      canvas.setPointerCapture?.(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.active) return;
      const c = cellAt(e);
      if (!c) return;
      this.cursor = c;
      const key = c.i + ',' + c.j;
      if (down && key !== last && ['paint', 'erase', 'bedrock'].includes(erase ? 'erase' : this.tool)) { this.apply(c.i, c.j, erase, true); last = key; }
    };
    this.onUp = () => { down = false; };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    canvas.addEventListener('contextmenu', this.noMenu = (e) => e.preventDefault());
  }

  bindKeys() {
    this.onKey = (e) => {
      if (!this.active || (e.target && e.target.tagName === 'INPUT')) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.shiftKey ? this.doRedo() : this.doUndo(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { this.doRedo(); e.preventDefault(); }
      else if (/^Digit[1-6]$/.test(e.code)) { this.tool = TOOLS[+e.code.slice(5) - 1]; this.renderUI(); }
      else if (e.code === 'KeyX' || e.code === 'KeyJ') this.apply(this.cursor.i, this.cursor.j, false, false);
      else if (e.code === 'KeyZ' && !e.ctrlKey) this.apply(this.cursor.i, this.cursor.j, true, false);
      else if (e.code === 'KeyM') { this.mirror = !this.mirror; this.renderUI(); }
      else if (e.code === 'KeyT') this.test();
    };
    addEventListener('keydown', this.onKey);
  }

  key(a) {
    if (!this.active) return true;
    const c = this.cursor;
    if (a === 'up') c.j = Math.min(H - 1, c.j + 1);
    else if (a === 'down') c.j = Math.max(0, c.j - 1);
    else if (a === 'left') c.i = Math.max(0, c.i - 1);
    else if (a === 'right') c.i = Math.min(W - 1, c.i + 1);
    else if (a === 'ok') this.apply(c.i, c.j, true, false); // pad A = erase (Jump)
    else if (a === 'back') { this.app.closeEditor(); }
    else if (a === 'prev' || a === 'next') { const k = TOOLS.indexOf(this.tool); this.tool = TOOLS[(k + (a === 'next' ? 1 : TOOLS.length - 1)) % TOOLS.length]; this.renderUI(); }
    else if (a === 'start') this.test();
    return true;
  }

  frame(dt) {
    const v = this.view;
    // Pad Action paints (X), read from the input's press counter.
    const inp = this.app.input.read();
    if (this.lastAp !== undefined && inp.ap !== this.lastAp) this.apply(this.cursor.i, this.cursor.j, false, false);
    this.lastAp = inp.ap;
    if (this.cursorMesh) {
      this.cursorMesh.position.set(this.cursor.i + 0.5, this.cursor.j + 0.5, 0);
      this.cursorFill.position.copy(this.cursorMesh.position);
    }
    // Whole arena in view.
    v.focus = null;
    v.menuDrift = false;
    v.updateCamera(null, dt);
    v.fx.update(dt);
    v.env.update(dt, v.fx, v.camera);
    if (v.composer) v.composer.render(dt); else v.renderer.render(v.scene, v.camera);
  }

  close() {
    this.active = false;
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('contextmenu', this.noMenu);
    removeEventListener('keydown', this.onKey);
    for (const o of [this.cursorMesh, this.cursorFill, this.marks, this.gridMesh]) if (o) this.view.scene.remove(o);
    if (this.ui) this.ui.remove();
    this.app.input.menuHandler = null;
  }
}
