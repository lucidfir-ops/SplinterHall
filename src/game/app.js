// The app: owns the view, input, audio, UI and screens, and runs the frame loop.
import { View, QUALITY } from '../view/view.js';
import { Input } from '../ui/input.js';
import { Hud, escapeHtml } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { CSS } from '../ui/style.js';
import { Match, DEFAULT_OPTIONS } from './match.js';
import { Tutorial } from './tutorial.js';
import { SETTINGS, SETTING_TITLE, SETTING_ACCENT, FIGHTER_COLORS, AI_SKILLS, GAME_NAME, PROTOTYPE, MAX_FIGHTERS } from '../core/consts.js';
import { randomCode, parseCode, cleanCode } from '../core/codes.js';
import { Audio } from '../audio/audio.js';
import { Net } from './net.js';
import { Editor } from '../editor/editor.js';
import { levelStore } from '../editor/store.js';
import { coverShot } from './cover.js';
import { reel } from './reel.js';

const params = new URLSearchParams(location.search);
const NULL_HUD = { roundStart() {}, update() {}, death() {}, picked() {}, fight() {}, ragnarok() {}, roundEnd() {}, show() {}, note() {} };

export class App {
  constructor(R, canvas, uiRoot) {
    this.R = R;
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = this.loadSettings();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.input = new Input(uiRoot);
    this.input.onPause = () => this.pause();
    this.input.onOverview = () => this.view.playerCam.toggleOverview();
    this.view = new View(canvas, { quality: params.get('quality') || this.settings.quality, resolution: this.settings.resolution,
      onSound: (n, o) => this.audio.sfx(n, o) });
    this.applyViewSettings();
    this.audio = new Audio(this);
    this.matchOpts = this.loadMatchOpts();
    this.touchLayer = document.createElement('div');
    this.touchLayer.className = 'sh-layer' + (this.settings.touchSide === 'left' ? ' sh-left' : '');
    uiRoot.appendChild(this.touchLayer);
    this.hudReal = new Hud(uiRoot, this);
    this.hud = this.hudReal;
    this.menus = new Menus(uiRoot, this);
    this.match = null;
    this.attract = null;
    this.editor = null;
    this.net = new Net(this);
    this.last = performance.now();
    this.testHook = params.has('test');
    this.paused = false;
    this.mountTouch();
    addEventListener('resize', () => { this.view.resize(); });
    // Any user gesture unlocks audio.
    const unlock = () => { this.audio.unlock(); };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && this.settings.touch === 'auto' && !this.touchOn) { this.touchOn = true; this.updateTouchVisibility(); } }, true);
  }

  get sfx() { return this.audio; }
  get music() { return this.audio.musicApi(); }

  // ------------------------------------------------------------ settings
  loadSettings() {
    const d = { v: 2, quality: 'clean', resolution: 1, music: 0.5, sfx: 0.9, master: 1, shake: 1, flashes: true, slowmo: true, style: 'any', simpleMusic: false, musicSource: 'tracks',
      name: 'Player', color: 0, fps: false, touch: 'auto', touchSide: 'right', padSize: 1, btnSize: 1, haptics: true, deadZone: 0.18, firstRun: true, tutorialDone: false, camera: 'follow' };
    try {
      const saved = JSON.parse(localStorage.getItem('splinterhall.settings') || '{}');
      // Prototype 2 lowered the music: a save still on the old default takes the new one.
      if (!saved.v && saved.music === 0.8) saved.music = d.music;
      return { ...d, ...saved, v: d.v };
    } catch { return d; }
  }
  saveSettings() { try { localStorage.setItem('splinterhall.settings', JSON.stringify(this.settings)); } catch { /* storage off */ } }
  loadMatchOpts() {
    const d = { ...DEFAULT_OPTIONS, bots: 3, playlist: { ...DEFAULT_OPTIONS.playlist } };
    try { const s = JSON.parse(localStorage.getItem('splinterhall.match') || '{}'); return { ...d, ...s, playlist: { ...d.playlist, ...(s.playlist || {}) } }; } catch { return d; }
  }
  saveMatchOpts() { try { localStorage.setItem('splinterhall.match', JSON.stringify(this.matchOpts)); } catch { /* storage off */ } }
  applyViewSettings() {
    this.view.shakeScale = this.settings.shake;
    this.view.flashes = this.settings.flashes;
    this.view.playerCam.on = this.settings.camera !== 'arena';
    if (this.input) { this.input.deadZone = this.settings.deadZone; this.input.haptics = this.settings.haptics; this.input.padScale = this.settings.padSize; }
    document.documentElement.style.setProperty('--bs', this.settings.btnSize);
  }

  mountTouch() {
    this.input.mountTouch(this.touchLayer);
    this.touchOn = this.settings.touch === 'on' || (this.settings.touch === 'auto' && matchMedia('(pointer: coarse)').matches);
    this.updateTouchVisibility();
  }
  updateTouchVisibility() {
    const inFight = !!(this.match && this.match.state !== 'over' && !this.menus.isOpen) || !!(this.editor && this.editor.testing);
    const showTouch = this.touchOn && this.settings.touch !== 'off' && inFight;
    this.input.showTouch(showTouch);
    this.uiRoot.classList.toggle('sh-touch-on', showTouch);
    this.touchLayer.className = 'sh-layer' + (this.settings.touchSide === 'left' ? ' sh-left' : '');
  }

  setAccent(setting) {
    document.documentElement.style.setProperty('--accent', SETTING_ACCENT[setting] || '#F2C230');
  }

  // ------------------------------------------------------------ start
  async start() {
    this.loop();
    if (params.has('cover')) return coverShot(this, params);
    if (params.has('reel')) return reel(this, params);
    if (params.has('bot') || params.has('dev')) return this.devStart();
    await this.startAttract();
    this.titleScreen();
    if (params.has('editor')) this.openEditor();
  }

  async devStart() {
    const n = +(params.get('fighters') || 6);
    const human = !params.has('bot');
    const roster = Array.from({ length: n }, (_, slot) => ({ slot, name: FIGHTER_COLORS[slot].name, ai: !(human && slot === 0), local: human && slot === 0, skill: 1 }));
    const code = params.get('code') || randomCode(params.get('setting') || SETTINGS[Math.floor(Math.random() * 4)]);
    this.match = new Match(this, roster, { playlist: { mode: 'fixed', codes: [code] }, roundsToWin: +(params.get('rounds') || 99) });
    this.audio.setTune(this.match.seed);
    await this.match.startRound(code);
    this.updateTouchVisibility();
  }

  // A live AI brawl behind the menus.
  async startAttract() {
    if (this.attract) return;
    const setting = SETTINGS[Math.floor(Math.random() * 4)];
    this.setAccent(setting);
    const roster = Array.from({ length: 6 }, (_, slot) => ({ slot, name: FIGHTER_COLORS[slot].name, ai: true, skill: 2 }));
    this.attract = new Match(this, roster, { playlist: { mode: 'random', settings: [setting], codes: [] }, roundsToWin: 999, ragnarok: false }, null);
    this.attract.isAttract = true;
    this.attract.hudless = true;
    this.hud = NULL_HUD;
    this.view.menuDrift = true;
    await this.attract.startRound();
    this.audio.menuMusic();
  }

  stopAttract() {
    if (!this.attract) return;
    this.attract.destroy();
    this.attract = null;
    this.view.menuDrift = false;
  }

  // ------------------------------------------------------------ screens
  titleScreen() {
    this.menus.close();
    this.hudReal.show(false);
    this.updateTouchVisibility();
    this.menus.open('title', () => ({
      items: [
        { label: 'Fight', n: '01', onOk: () => this.fightScreen() },
        { label: 'Learn', n: '02', value: this.settings.tutorialDone ? '' : 'START HERE', onOk: () => new Tutorial(this).start() },
        { label: 'Editor', n: '03', onOk: () => this.openEditor() },
        { label: 'Options', n: '04', onOk: () => this.optionsScreen() },
        { type: 'spacer' },
        ...this.playerItems(),
      ],
      side: this.titleStamp(),
      onBack: () => false,
    }), false);
    if (this.settings.firstRun) { this.settings.firstRun = false; this.saveSettings(); }
  }

  titleStamp() {
    const d = document.createElement('div');
    d.className = 'sh-titlestamp';
    d.innerHTML = `<div class="t">${GAME_NAME}</div><div class="r"></div><div class="s">Prototype ${PROTOTYPE} · up to 8 fighters · instrumental metal</div>`;
    return d;
  }

  playerItems() {
    const st = this.audio.state();
    let now = 'MUSIC LOADING';
    if (st && st.source === 'tracks') {
      if (st.title) now = `<b>${escapeHtml(st.title)}</b><br>${escapeHtml([st.artist, st.style === 'folk' ? 'folk metal' : st.style].filter(Boolean).join(' · ').toUpperCase())}`;
      else if (st.ready && !st.count) now = 'NO TRACKS FOUND';
    } else if (st) now = `<b>${escapeHtml(st.title || '—')}</b><br>${escapeHtml((st.style || '').toUpperCase())} · ${st.bpm || ''} BPM · ${escapeHtml(st.key || '')}`;
    return [
      { type: 'html', html: `<div class="sh-player"><div class="sh-label">Music</div><div class="now">${now}</div></div>` },
      { type: 'row', items: [
        ...['viking', 'battle', 'power'].map((s) => ({ label: s, tiny: true, on: this.settings.style === s, onOk: () => { this.settings.style = this.settings.style === s ? 'any' : s; this.saveSettings(); this.audio.next(); setTimeout(() => this.menus.refresh(), 60); } })),
        { label: 'Next', tiny: true, onOk: () => { this.audio.next(); setTimeout(() => this.menus.refresh(), 60); } },
      ] },
    ];
  }

  fightScreen() {
    this.menus.open('fight', () => ({
      kicker: 'Fight', title: 'Brawl',
      items: [
        { label: 'Versus AI', n: '01', onOk: () => this.versusScreen() },
        { label: 'Multiplayer', n: '02', onOk: () => this.multiplayerScreen() },
        { label: 'Fighter', n: '03', value: this.settings.name.toUpperCase(), onOk: () => this.fighterScreen() },
        { label: 'Levels', n: '04', value: this.playlistLabel(), onOk: () => this.levelsScreen() },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  playlistLabel() {
    const p = this.matchOpts.playlist;
    if (p.mode === 'fixed') return p.codes[0] ? p.codes[0].split('.')[0] : 'CODE';
    if (p.mode === 'list') return p.codes.length + ' SAVED';
    return p.settings.length === 4 ? 'RANDOM' : p.settings.map((s) => SETTING_TITLE[s][0]).join('');
  }

  matchOptionItems(o, onChange = () => {}) {
    const set = (k) => (v) => { o[k] = v; this.saveMatchOpts(); onChange(); };
    return [
      { type: 'meter', label: 'AI fighters', min: 0, max: MAX_FIGHTERS - 1, step: 1, get: () => o.bots, set: set('bots'), fmt: (v) => v },
      { type: 'set', label: 'AI skill', get: () => o.aiSkill, set: set('aiSkill'), options: AI_SKILLS.map((s, k) => ({ label: s.name, value: k })) },
      { type: 'set', label: 'Rounds to win', get: () => o.roundsToWin, set: set('roundsToWin'), options: [3, 5, 7, 10].map((v) => ({ label: String(v), value: v })) },
      { type: 'set', label: 'Items', get: () => o.items, set: set('items'), options: [{ label: 'All', value: 'all' }, { label: 'Melee only', value: 'melee' }, { label: 'No summons', value: 'nosummons' }] },
      { type: 'set', label: 'Item drops', get: () => o.dropRate, set: set('dropRate'), options: [{ label: 'Few', value: 'few' }, { label: 'Normal', value: 'normal' }, { label: 'Lots', value: 'lots' }] },
      { type: 'toggle', label: 'Ragnarök after 90 s', get: () => o.ragnarok, set: set('ragnarok') },
    ];
  }

  versusScreen() {
    const o = this.matchOpts;
    this.menus.open('versus', () => ({
      kicker: 'Versus AI', title: 'Match',
      items: [
        ...this.matchOptionItems(o),
        { label: 'Levels', small: true, value: this.playlistLabel(), onOk: () => this.levelsScreen() },
        { type: 'spacer' },
        { type: 'row', items: [{ label: 'Back', small: true, onOk: () => this.menus.back() }, { label: 'Start', primary: true, onOk: () => this.startVersus() }] },
      ],
      focus: 7,
    }));
  }

  fighterScreen() {
    const s = this.settings;
    this.menus.open('fighter', () => ({
      kicker: 'Fighter', title: s.name || 'Player',
      items: [
        { type: 'input', label: 'Name', value: s.name, maxlength: 12, onInput: (v) => { s.name = v.trim().slice(0, 12) || 'Player'; this.saveSettings(); } },
        { type: 'label', label: 'Colour' },
        { type: 'swatches', get: () => s.color, set: (k) => { s.color = k; this.saveSettings(); } },
        { type: 'html', html: `<div class="sh-mono" style="color:var(--dim)">${escapeHtml(FIGHTER_COLORS[s.color].name)} · in a room, a taken colour moves to the next free one.</div>` },
        { type: 'spacer' },
        { label: 'Done', small: true, onOk: () => { this.menus.back(); } },
      ],
    }));
  }

  levelsScreen() {
    const p = this.matchOpts.playlist;
    let codeText = p.codes[0] || '';
    const saved = levelStore.list();
    this.menus.open('levels', () => ({
      kicker: 'Levels', title: 'Playlist',
      items: [
        { type: 'set', label: 'Mode', get: () => p.mode, set: (v) => { p.mode = v; this.saveMatchOpts(); }, refresh: true,
          options: [{ label: 'Random', value: 'random' }, { label: 'One code', value: 'fixed' }, { label: 'Saved list', value: 'list' }] },
        ...(p.mode === 'random' ? SETTINGS.map((st) => ({ type: 'toggle', label: SETTING_TITLE[st], get: () => p.settings.includes(st),
          set: (v) => { if (v) p.settings.push(st); else if (p.settings.length > 1) p.settings.splice(p.settings.indexOf(st), 1); this.saveMatchOpts(); } })) : []),
        ...(p.mode === 'fixed' ? [
          { type: 'input', label: 'Level code', value: codeText, maxlength: 2000, onInput: (v) => { codeText = v; }, onEnter: (v) => setCode(v) },
          { label: 'Use this code', small: true, onOk: () => setCode(codeText) },
          { label: 'Paste', tiny: true, onOk: async () => { try { codeText = await navigator.clipboard.readText(); setCode(codeText); } catch { this.note('Clipboard is blocked here'); } } },
        ] : []),
        ...(p.mode === 'list' ? (saved.length ? saved.map((L) => ({ type: 'toggle', label: L.name, get: () => p.codes.includes(L.code), set: (v) => {
          if (v) p.codes.push(L.code); else p.codes.splice(p.codes.indexOf(L.code), 1); this.saveMatchOpts(); } })) : [{ type: 'html', html: '<div class="sh-mono" style="color:var(--dim)">No saved levels yet. Make one in the Editor.</div>' }]) : []),
        { type: 'spacer' },
        { label: 'Done', small: true, onOk: () => this.menus.back() },
      ],
    }));
    const setCode = (v) => {
      const c = parseCode(v);
      if (!c.valid) { this.note('That code is not valid'); return; }
      p.codes = [c.code]; p.mode = 'fixed'; this.saveMatchOpts(); this.note('Level ' + c.base + ' set'); this.menus.refresh();
    };
  }

  optionsScreen() {
    this.menus.open('options', () => ({
      kicker: 'Options', title: 'Options',
      items: [
        { label: 'Music', n: '01', onOk: () => this.optMusic() },
        { label: 'Sound', n: '02', onOk: () => this.optSound() },
        { label: 'Graphics', n: '03', value: QUALITY[this.settings.quality].name.toUpperCase(), onOk: () => this.optGraphics() },
        { label: 'Controls', n: '04', onOk: () => this.optControls() },
        { label: 'Accessibility', n: '05', onOk: () => this.optAccess() },
        { label: 'Credits', n: '06', onOk: () => this.creditsScreen() },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  setting(key, after) { return (v) => { this.settings[key] = v; this.saveSettings(); if (after) after(v); }; }

  optMusic() {
    const s = this.settings;
    this.menus.open('opt-music', () => ({
      kicker: 'Options', title: 'Music',
      items: [
        { type: 'meter', label: 'Music volume', min: 0, max: 1, step: 0.1, get: () => s.music, set: this.setting('music', () => this.audio.applyVolumes()), fmt: (v) => Math.round(v * 100) },
        { type: 'set', label: 'Source', get: () => s.musicSource, set: this.setting('musicSource', (v) => this.audio.setSource(v)), refresh: true,
          options: [{ label: 'Tracks', value: 'tracks' }, { label: 'Live generator', value: 'live' }] },
        { type: 'set', label: 'Style', get: () => s.style, set: this.setting('style', () => this.audio.styleChanged()), options: [{ label: 'Any', value: 'any' }, { label: 'Viking', value: 'viking' }, { label: 'Battle', value: 'battle' }, { label: 'Power', value: 'power' }] },
        ...(s.musicSource === 'live' ? [{ type: 'toggle', label: 'Simple music (low-end)', get: () => s.simpleMusic, set: this.setting('simpleMusic', (v) => this.audio.setSimple(v)) }] : []),
        { type: 'html', html: `<div class="sh-mono" style="color:var(--dim)">${s.musicSource === 'live'
          ? 'Live generator: the band plays live and follows the fight. Loads about 4 MB of samples and works the CPU harder.'
          : 'Tracks: recorded songs, light on phones and batteries. Viking includes the folk metal.'}</div>` },
        ...this.playerItems(),
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  optSound() {
    const s = this.settings;
    this.menus.open('opt-sound', () => ({
      kicker: 'Options', title: 'Sound',
      items: [
        { type: 'meter', label: 'Master', min: 0, max: 1, step: 0.1, get: () => s.master, set: this.setting('master', () => this.audio.applyVolumes()), fmt: (v) => Math.round(v * 100) },
        { type: 'meter', label: 'Effects', min: 0, max: 1, step: 0.1, get: () => s.sfx, set: this.setting('sfx', () => this.audio.applyVolumes()), fmt: (v) => Math.round(v * 100) },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  optGraphics() {
    const s = this.settings;
    this.menus.open('opt-gfx', () => ({
      kicker: 'Options', title: 'Graphics',
      items: [
        // A look or resolution picked here is kept: the automatic frame-rate check stops.
        { type: 'set', label: 'Look', get: () => s.quality, set: this.setting('quality', (v) => { s.perfChecked = true; s.perfLowered = false; this.saveSettings(); this.view.setQuality(v, s.resolution); }),
          options: [{ label: 'Lite', value: 'lite' }, { label: 'Clean', value: 'clean' }, { label: 'Everything', value: 'everything' }] },
        { type: 'meter', label: 'Resolution', min: 0.25, max: 1, step: 0.05, get: () => s.resolution, set: this.setting('resolution', (v) => { s.perfChecked = true; s.perfLowered = false; this.saveSettings(); this.view.resScale = v; this.view.resize(); }), fmt: (v) => Math.round(v * 100) + '%' },
        { type: 'toggle', label: 'FPS counter', get: () => s.fps, set: this.setting('fps') },
        { type: 'html', html: '<div class="sh-mono" style="color:var(--dim)">Lite: older phones and tablets. Clean: phones like the S22 and the Steam Deck. Everything: gaming PCs. Your first fights are timed: below 55 fps the game lowers the resolution, then the look, and says so. The look never changes the fight.</div>' },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  optControls() {
    const s = this.settings;
    const ap = () => this.applyViewSettings();
    this.menus.open('opt-ctl', () => ({
      kicker: 'Options', title: 'Controls',
      items: [
        { type: 'set', label: 'Touch controls', get: () => s.touch, set: this.setting('touch', (v) => { this.touchOn = v === 'on' || (v === 'auto' && matchMedia('(pointer: coarse)').matches); }),
          options: [{ label: 'Auto', value: 'auto' }, { label: 'On', value: 'on' }, { label: 'Off', value: 'off' }] },
        { type: 'set', label: 'Stick side', get: () => s.touchSide, set: this.setting('touchSide', () => this.updateTouchVisibility()), options: [{ label: 'Left', value: 'right' }, { label: 'Right', value: 'left' }] },
        { type: 'meter', label: 'Stick size', min: 0.7, max: 1.4, step: 0.1, get: () => s.padSize, set: this.setting('padSize', ap), fmt: (v) => Math.round(v * 100) + '%' },
        { type: 'meter', label: 'Square size', min: 0.7, max: 1.4, step: 0.1, get: () => s.btnSize, set: this.setting('btnSize', ap), fmt: (v) => Math.round(v * 100) + '%' },
        { type: 'meter', label: 'Dead zone', min: 0.05, max: 0.4, step: 0.05, get: () => s.deadZone, set: this.setting('deadZone', ap), fmt: (v) => Math.round(v * 100) + '%' },
        { type: 'toggle', label: 'Haptics', get: () => s.haptics, set: this.setting('haptics', ap) },
        { type: 'set', label: 'Camera', get: () => s.camera, set: this.setting('camera', ap), options: [{ label: 'Follow me', value: 'follow' }, { label: 'Whole arena', value: 'arena' }] },
        { type: 'html', html: `<div class="sh-mono" style="color:var(--dim);line-height:1.7">
          STICK · left / right run · UP jumps (up again in the air: a flip, a second jump; held with a jetpack: thrust) · DOWN crouches · DOWN on an item picks it up · in the air, push into a wall to cling, up to kick off it<br>
          SQUARE · swipe: jab that way (three quick: jab, cross, hook) · swipe up: uppercut · swipe down: slam (in the air: stomp dive) · sweep across: haymaker · along the bottom band: kick (swiped up: roundhouse, crouching: leg sweep, at a run or in the air: flying kick), a long sweep there: dropkick · tap: throw what you hold, along the stick (empty hands: jump) · hold in the air: jetpack · swipe and hold: charge, beam, grab<br>
          VIEW · the eye button (TAB, pad SELECT) shows the whole arena for a moment<br>
          KEYS · arrows/WASD · SPACE jump · X hit/use (UP + X uppercut, DOWN + X slam) · C kick (in the air: flying kick) · V haymaker · E throw · TAB view · ESC pause<br>
          PAD · stick · A jump · X hit/use (with the stick as on keys) · B kick · Y haymaker · RB throw · SELECT view · START pause</div>` },
        { label: 'Learn the moves', small: true, onOk: () => new Tutorial(this).start() },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  optAccess() {
    const s = this.settings;
    this.menus.open('opt-acc', () => ({
      kicker: 'Options', title: 'Access',
      items: [
        { type: 'set', label: 'Screen shake', get: () => s.shake, set: this.setting('shake', () => this.applyViewSettings()), options: [{ label: 'Off', value: 0 }, { label: 'Low', value: 0.4 }, { label: 'Full', value: 1 }] },
        { type: 'toggle', label: 'Hit flashes', get: () => s.flashes, set: this.setting('flashes', () => this.applyViewSettings()) },
        { type: 'toggle', label: 'Slow-motion final kill', get: () => s.slowmo, set: this.setting('slowmo') },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  creditsScreen() {
    this.menus.open('credits', () => ({
      kicker: 'Credits', title: 'Credits', wide: true,
      items: [
        { type: 'html', html: `<div class="sh-mono" style="max-width:860px;line-height:1.65">
          <b>${GAME_NAME}</b> · made by Eric with Claude.<br><br>
          <span class="sh-label">Music</span><br>${this.audio.trackCredits().map((c) => escapeHtml(c.credit) + '<br>').join('')}The Splinterhall band's songs are rendered by the game's own generator from the samples below.<br><br>
          <span class="sh-label">Music samples</span><br>VS Chamber Orchestra: Community Edition and the Versilian Community Sample Library (CC0, Versilian Studios) · Sonic Pi sample pack (CC0, freesound.org recordings) · FluidR3 GM soundfont by Frank Wen, rendered by Benjamin Gleitzman's MIDI.js Soundfonts (CC BY 3.0).<br><br>
          <span class="sh-label">Sound effects</span><br>Kenney's Impact, Sci-Fi, Interface and RPG packs · rubberduck's CC0 packs on OpenGameArt.org · qubodup's swooshes · Superpowers asset packs (Sparklin Labs, Pixel-boy) · faxcorp's Electricity pack · Sonic Pi samples · VCSL. All CC0.<br><br>
          <span class="sh-label">Light</span><br>Poly Haven HDRIs (CC0): Empty Warehouse 01 by Sergej Majboroda · Fireplace and Kiara 1 Dawn by Greg Zaal · Warm Reception Dinner by Dimitrios Savva and Jarod Guest.<br><br>
          <span class="sh-label">Type</span><br>Anton · JetBrains Mono · both SIL Open Font License.<br><br>
          <span class="sh-label">Code</span><br>three.js (MIT) · Rapier (Apache-2.0) · postprocessing (Zlib) · Trystero (MIT) · fflate (MIT) · jsQR (Apache-2.0) · QR encoder after Project Nayuki (MIT).<br>Multiplayer transport adapted from Hoverline.</div>` },
        { type: 'spacer' },
        { label: 'Back', small: true, onOk: () => this.menus.back() },
      ],
    }));
  }

  note(text, secs) { this.hudReal.note(text, secs); }

  // ------------------------------------------------------------ matches
  localRosterEntry(slot) {
    return { slot, name: this.settings.name || 'Player', ai: false, local: true, color: this.settings.color };
  }

  async startVersus() {
    const o = this.matchOpts;
    const me = this.settings.color;
    const roster = [{ ...this.localRosterEntry(me) }];
    const free = [...Array(8).keys()].filter((k) => k !== me);
    for (let k = 0; k < o.bots; k++) roster.push({ slot: free[k], name: FIGHTER_COLORS[free[k]].name, ai: true, skill: o.aiSkill });
    if (roster.length < 2) roster.push({ slot: free[0], name: FIGHTER_COLORS[free[0]].name, ai: true, skill: o.aiSkill });
    await this.beginMatch(roster, { ...o }, null);
  }

  async beginMatch(roster, opts, net) {
    this.menus.close();
    this.stopAttract();
    this.hud = this.hudReal;
    this.match = new Match(this, roster, opts, net);
    // A room hears the seed's tune; a local match takes the least familiar of a dozen.
    this.audio.setTune(opts.seed || this.match.seed, { fresh: !net });
    this.audio.startMatch();
    this.updateTouchVisibility();
    if (!net || net.host) await this.match.startRound();
  }

  matchOver(match, champion) {
    const roster = match.roster;
    const name = roster.find((r) => r.slot === champion)?.name || FIGHTER_COLORS[champion].name;
    this.updateTouchVisibility();
    this.menus.open('over', () => ({
      kicker: 'Champion', title: name,
      items: [
        { type: 'html', html: `<div class="sh-row" style="gap:6px;margin-bottom:8px">${roster.map((r) => `<div style="flex:1;min-width:46px;background:var(--ink2);padding:6px;border-top:6px solid ${FIGHTER_COLORS[r.slot].hex}"><div class="sh-title" style="font-size:22px">${match.scores[r.slot]}</div><div class="sh-label" style="font-size:9px">${escapeHtml(r.name)}</div><div class="sh-label" style="font-size:9px">${match.kills[r.slot]} KO</div></div>`).join('')}</div>` },
        ...(match.net ? (match.net.room.isHost ? [
          { label: 'Rematch', primary: true, onOk: () => this.net.rematch() },
        ] : [
          { type: 'html', html: '<div class="sh-mono" style="color:var(--dim)">The host calls the rematch.</div>' },
          { label: 'Lobby', small: true, onOk: () => this.net.toLobby() },
        ]) : [
          { label: 'Rematch', primary: true, onOk: () => this.beginMatch(roster, { ...match.opts, seed: undefined }, null) },
          { label: 'New fighters', small: true, onOk: () => { this.endMatch(); this.versusScreen(); } },
        ]),
        { label: 'Leave', small: true, onOk: () => this.leaveMatch() },
      ],
      onBack: () => false,
    }), false);
  }

  endMatch() {
    if (this.match) this.match.destroy();
    this.match = null;
    this.hudReal.show(false);
    this.paused = false;
    this.updateTouchVisibility();
  }

  async leaveMatch() {
    this.endMatch();
    if (this.net.room) this.net.leave();
    this.menus.close();
    await this.startAttract();
    this.titleScreen();
  }

  pause() {
    if (this.pauseOverride) { this.pauseOverride(); return; }
    if (!this.match || this.match.state === 'over' || this.menus.isOpen) return;
    this.paused = true;
    if (!this.match.net) this.match.paused = true;
    this.updateTouchVisibility();
    this.menus.open('pause', () => ({
      kicker: this.match.net ? 'Room ' + this.net.room?.code : 'Paused', title: 'Paused',
      items: [
        { label: 'Resume', n: '01', onOk: () => this.resume() },
        { label: 'Options', n: '02', onOk: () => this.optionsScreen() },
        ...(this.match.net ? [{ label: 'Reconnect', n: '03', onOk: () => { this.net.reconnect(); this.resume(); } }] : []),
        { label: 'Leave', n: this.match.net ? '04' : '03', onOk: () => this.confirmLeave() },
      ],
      onBack: () => { this.resume(); return false; },
    }), false);
  }

  confirmLeave() {
    this.menus.open('confirm', () => ({
      kicker: 'Leave', title: 'Leave?',
      items: [
        { label: 'Stay', onOk: () => this.menus.back() },
        { label: 'Leave the match', primary: true, onOk: () => this.leaveMatch() },
      ],
    }));
  }

  resume() {
    this.paused = false;
    if (this.match) this.match.paused = false;
    this.menus.close();
    this.updateTouchVisibility();
  }

  // ------------------------------------------------------------ multiplayer
  multiplayerScreen() { this.net.screen(); }

  // ------------------------------------------------------------ editor
  async openEditor(code) {
    this.menus.close();
    this.stopAttract();
    this.endMatch();
    this.editor = new Editor(this);
    this.updateTouchVisibility();
    await this.editor.open(code);
  }

  async closeEditor() {
    if (this.editor) this.editor.close();
    this.editor = null;
    await this.startAttract();
    this.titleScreen();
  }

  // Time real fights until the look holds 55 fps: 240 frames at a time (after the drop-in), and while it
  // doesn't, step down once per check (first 80% resolution, then the next cheaper look at full resolution)
  // and say so. A look picked in the URL (?quality=) is left alone.
  perfWatch(dt) {
    const s = this.settings;
    if (s.perfV !== 2) {
      // The looks got much cheaper (the performance pass after Prototype 3): anyone the old one-off check
      // moved to Lite gets the default look back, and everyone is checked again.
      if (s.perfChecked && s.quality === 'lite') { s.quality = 'clean'; s.resolution = 1; this.view.setQuality('clean', 1); }
      s.perfV = 2; s.perfChecked = false;
      this.saveSettings();
    }
    if (s.perfChecked || params.has('quality') || this.paused || !this.match || this.match.state !== 'round' || this.match.isAttract) { this.perfN = this.perfT = 0; return; }
    this.perfN = (this.perfN || 0) + 1;
    if (this.perfN <= 60) return;
    this.perfT = (this.perfT || 0) + dt;
    if (this.perfN < 300) return;
    const fps = (this.perfN - 60) / this.perfT;
    this.perfN = this.perfT = 0;
    const order = ['lite', 'clean', 'everything'];
    const k = order.indexOf(s.quality);
    if (fps >= 55) s.perfChecked = true;
    else if (s.resolution > 0.8) {
      s.resolution = 0.8; s.perfLowered = true; this.view.resScale = 0.8; this.view.resize();
      this.note(`Running at ${Math.round(fps)} fps · resolution lowered to 80% (Options, Graphics)`, 4);
    } else if (k > 0) {
      s.quality = order[k - 1];
      if (s.perfLowered) { s.resolution = 1; s.perfLowered = false; }
      this.view.setQuality(s.quality, s.resolution);
      this.note(`Running at ${Math.round(fps)} fps · switched to the ${QUALITY[s.quality].name} look (Options, Graphics)`, 4);
    } else s.perfChecked = true;
    this.saveSettings();
  }

  // ------------------------------------------------------------ loop
  loop() {
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.menus.isOpen || this.editor) this.input.pollPad();
      const m = this.editor && this.editor.active ? null : this.match || this.attract;
      try {
        if (this.editor && this.editor.active) this.editor.frame(dt);
        else if (m) {
          if (!(this.paused && !m.net)) { m.update(dt); this.tutorial?.update(dt); }
          if (params.get('render') !== '0') m.draw(dt);
        }
      } catch (e) {
        console.error(e);
      }
      this.audio.tick(dt);
      this.perfWatch(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
