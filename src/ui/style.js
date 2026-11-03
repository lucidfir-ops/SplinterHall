// The brutalist UI: flat slabs, hard edges, heavy condensed type, straight-line icons.
// No rounded corners and no circles anywhere.
export const CSS = `
:root {
  --ink: #0C0C0B; --ink2: #161614; --bone: #E8E2D4; --dim: #8A857A; --rule: #E8E2D4;
  --accent: #F2C230; --accent-ink: #0C0C0B;
  --disp: 'Anton', 'Impact', 'Arial Narrow', sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'Courier New', monospace;
  --cut: 14px;
  --safe-l: env(safe-area-inset-left, 0px); --safe-r: env(safe-area-inset-right, 0px);
  --safe-t: env(safe-area-inset-top, 0px); --safe-b: env(safe-area-inset-bottom, 0px);
}
#ui, #ui * { box-sizing: border-box; border-radius: 0 !important; }
#ui { font-family: var(--mono); color: var(--bone); -webkit-tap-highlight-color: transparent; }
.sh-layer { position: absolute; inset: 0; pointer-events: none; }
.sh-layer > * { pointer-events: auto; }
.sh-hidden { display: none !important; }

/* ---------- screens ---------- */
.sh-screen { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(300px, 44%) 1fr; pointer-events: none; }
.sh-screen > * { pointer-events: auto; }
.sh-bar { background: rgba(12,12,11,.9); border-right: 2px solid var(--rule); padding: calc(28px + var(--safe-t)) 28px calc(24px + var(--safe-b)) calc(28px + var(--safe-l));
  display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; animation: sh-in .12s linear; }
.sh-bar.wide { grid-column: 1 / -1; border-right: 0; background: rgba(12,12,11,.92); }
@keyframes sh-in { from { transform: translateX(-24px); opacity: .0; } to { transform: none; opacity: 1; } }
.sh-kicker { font: 700 11px/1 var(--mono); letter-spacing: .28em; color: var(--dim); text-transform: uppercase; }
.sh-h1 { font: 400 clamp(40px, 7vw, 92px)/.86 var(--disp); text-transform: uppercase; letter-spacing: .01em; margin: 6px 0 4px; }
.sh-h2 { font: 400 clamp(28px, 4vw, 48px)/.9 var(--disp); text-transform: uppercase; margin: 2px 0 8px; }
.sh-rule { height: 2px; background: var(--rule); margin: 6px 0 14px; flex: none; }
.sh-label { font: 700 11px/1.2 var(--mono); letter-spacing: .2em; text-transform: uppercase; color: var(--dim); }
.sh-mono { font: 500 13px/1.45 var(--mono); }
.sh-title { font: 400 clamp(28px, 4vw, 44px)/.9 var(--disp); text-transform: uppercase; }
.sh-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
.sh-col { display: flex; flex-direction: column; gap: 8px; }
.sh-spacer { flex: 1; }
.sh-panel { background: var(--ink); border: 2px solid var(--rule); padding: 16px; }
/* Wi-Fi pairing: a full-screen layer; scrolls when the panel is taller than the screen. */
.sh-pairhold { position: fixed; inset: 0; z-index: 30; overflow: auto; display: flex; padding: 12px; background: rgba(12,12,11,.92); }
.sh-pairhold > .sh-panel { margin: auto; display: flex; flex-direction: column; gap: 8px; width: min(640px, 100%); }
.sh-pairhold > .sh-panel > label, .sh-pairhold textarea { display: block; }
@media (max-height: 520px) and (orientation: landscape) {
  .sh-pairhold > .sh-panel { width: min(900px, 100%); display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 18px; row-gap: 6px; align-items: start; }
  .sh-pairhold > .sh-panel > * { grid-column: 2; }
  .sh-pairhold > .sh-panel > :nth-child(3) { grid-column: 1; grid-row: 1 / span 9; }
  .sh-pairhold > .sh-panel > :nth-child(3):empty, .sh-pairhold > .sh-panel > :nth-child(3):not(:has(:not([hidden]))) { display: none; }
}

/* Slab buttons: one corner cut at 45 degrees, hard offset shadow on focus. */
.sh-btn { position: relative; appearance: none; border: 0; background: var(--ink2); color: var(--bone); cursor: pointer;
  font: 400 clamp(22px, 2.6vw, 34px)/1 var(--disp); text-transform: uppercase; letter-spacing: .02em; text-align: left;
  padding: 12px 18px 11px 14px; display: flex; align-items: baseline; gap: 14px; outline: none; isolation: isolate;
  clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%); transition: transform .08s linear; }
.sh-btn .n { font: 700 12px/1 var(--mono); letter-spacing: .1em; color: var(--dim); min-width: 22px; }
.sh-btn .v { margin-left: auto; font: 700 13px/1 var(--mono); letter-spacing: .12em; color: var(--dim); align-self: center; }
.sh-btn.small { font-size: clamp(16px, 1.8vw, 22px); padding: 9px 14px 8px 12px; }
.sh-btn.tiny { font: 700 12px/1 var(--mono); letter-spacing: .14em; padding: 9px 12px; }
.sh-btn:hover { background: #22221f; }
.sh-btn.focus, .sh-btn:focus-visible { background: var(--accent); color: var(--accent-ink); transform: translate(-3px, -3px); box-shadow: none; }
.sh-btn.focus .n, .sh-btn.focus .v, .sh-btn:focus-visible .n { color: var(--accent-ink); }
.sh-shadow { position: relative; }
.sh-shadow::before { content: ''; position: absolute; inset: 0; background: var(--bone); transform: translate(6px, 6px); opacity: 0;
  clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%); }
.sh-shadow:has(.sh-btn.focus)::before { opacity: 1; }
.sh-btn.on { box-shadow: inset 6px 0 0 var(--accent); }
.sh-btn.sh-primary { background: var(--bone); color: var(--ink); }
.sh-btn.sh-primary .n { color: var(--ink); }
.sh-btn[disabled] { opacity: .35; pointer-events: none; }
.sh-menu { display: flex; flex-direction: column; gap: 10px; }
.sh-menu > .sh-shadow > .sh-btn { width: 100%; }
.sh-row > .sh-shadow { flex: 0 0 auto; }
.sh-row > .sh-shadow > .sh-btn { height: 100%; }
.sh-edtools .sh-shadow > .sh-btn { width: 100%; }

/* Settings rows */
.sh-set { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; padding: 10px 12px; background: var(--ink2);
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); cursor: pointer; outline: none; }
.sh-set .k { font: 700 12px/1.2 var(--mono); letter-spacing: .16em; text-transform: uppercase; }
.sh-set .val { font: 400 22px/1 var(--disp); text-transform: uppercase; display: flex; gap: 8px; align-items: center; }
.sh-set.focus { background: var(--accent); color: var(--accent-ink); }
.sh-meter { display: inline-flex; gap: 3px; }
.sh-meter i { width: 9px; height: 18px; background: currentColor; opacity: .22; transform: skewX(-14deg); }
.sh-meter i.f { opacity: 1; }
.sh-tick { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 2px solid currentColor; font: 700 14px/1 var(--mono); }

/* Title */
.sh-titlestamp { position: absolute; right: calc(20px + var(--safe-r)); bottom: calc(18px + var(--safe-b)); text-align: right; pointer-events: none; }
.sh-titlestamp .t { font: 400 clamp(54px, 11vw, 168px)/.8 var(--disp); text-transform: uppercase; letter-spacing: -.01em; color: var(--bone);
  text-shadow: 6px 6px 0 rgba(12,12,11,.85); }
.sh-titlestamp .r { height: 3px; background: var(--bone); margin: 10px 0 8px auto; width: 100%; }
.sh-titlestamp .s { font: 700 12px/1 var(--mono); letter-spacing: .3em; text-transform: uppercase; color: var(--bone); text-shadow: 2px 2px 0 var(--ink); }

/* Music player */
.sh-player { display: grid; gap: 6px; margin-top: 10px; }
.sh-player .now { font: 700 11px/1.35 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.sh-player .now b { color: var(--bone); font-weight: 700; }

/* Lobby roster */
.sh-roster { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; min-height: 180px; }
.sh-slot { background: var(--ink2); display: flex; flex-direction: column; justify-content: flex-end; padding: 8px 6px; position: relative; min-height: 170px;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
.sh-slot .bar { position: absolute; left: 0; right: 0; top: 0; height: 0; transition: height .15s linear; }
.sh-slot .nm { position: relative; font: 400 18px/1 var(--disp); text-transform: uppercase; word-break: break-all; }
.sh-slot .st { position: relative; font: 700 10px/1.3 var(--mono); letter-spacing: .14em; text-transform: uppercase; margin-top: 4px; }
.sh-slot.ready .bar { height: 100%; opacity: .9; }
.sh-slot.ready .nm, .sh-slot.ready .st { color: var(--ink); }
.sh-code { font: 400 clamp(48px, 9vw, 110px)/.85 var(--disp); letter-spacing: .06em; }

/* Inputs */
.sh-input { appearance: none; background: var(--ink2); color: var(--bone); border: 2px solid var(--bone); padding: 12px 14px; font: 700 20px/1 var(--mono);
  letter-spacing: .14em; text-transform: uppercase; width: 100%; outline: none; }
.sh-input:focus { border-color: var(--accent); }

/* Swatches */
.sh-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.sh-swatch { height: 44px; border: 0; cursor: pointer; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); outline: none; }
.sh-swatch.on { box-shadow: inset 0 0 0 4px var(--ink), inset 0 0 0 7px var(--bone); }
.sh-swatch.focus { transform: translate(-3px, -3px); box-shadow: 6px 6px 0 var(--bone); }

/* ---------- HUD ---------- */
.sh-hud { position: absolute; inset: 0; pointer-events: none; }
.sh-scores { position: absolute; left: calc(12px + var(--safe-l)); right: calc(12px + var(--safe-r)); top: calc(10px + var(--safe-t)); display: flex; gap: 6px; justify-content: center; }
.sh-score { display: flex; align-items: center; gap: 3px; padding: 5px 7px; background: rgba(12,12,11,.72); }
.sh-score .chip { width: 8px; height: 16px; margin-right: 4px; }
.sh-score i { width: 7px; height: 12px; transform: skewX(-18deg); background: currentColor; opacity: .25; }
.sh-score i.f { opacity: 1; }
.sh-score.dead { opacity: .4; }
.sh-score.me { outline: 2px solid var(--bone); outline-offset: 0; }
.sh-held { position: absolute; left: calc(14px + var(--safe-l)); bottom: calc(14px + var(--safe-b)); display: flex; align-items: center; gap: 10px;
  background: rgba(12,12,11,.72); padding: 8px 12px 8px 10px; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
.sh-held svg { width: 46px; height: 30px; }
.sh-ammo { display: flex; gap: 3px; }
.sh-ammo i { width: 8px; height: 16px; transform: skewX(-18deg); background: var(--bone); }
.sh-ammo i.e { opacity: .2; }
.sh-fuel { width: 70px; height: 7px; background: rgba(232,226,212,.2); margin-top: 4px; }
.sh-fuel b { display: block; height: 100%; background: #66c8ff; }
.sh-hp { width: 120px; height: 10px; background: rgba(232,226,212,.18); clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.sh-hp b { display: block; height: 100%; }
.sh-feed { position: absolute; right: calc(14px + var(--safe-r)); top: calc(44px + var(--safe-t)); display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.sh-kill { display: flex; align-items: center; gap: 6px; background: rgba(12,12,11,.72); padding: 4px 6px; animation: sh-in .12s linear; }
.sh-kill i { width: 14px; height: 14px; display: block; }
.sh-kill svg { width: 14px; height: 14px; }
/* Learn: the coach's panel, top centre. */
.sh-practice .sh-scores { display: none; }
.sh-tut { position: absolute; left: 50%; top: calc(12px + var(--safe-t)); transform: translateX(-50%); width: min(560px, calc(100vw - 150px)); pointer-events: auto;
  background: rgba(12,12,11,.9); border: 2px solid var(--bone); padding: 10px 14px 12px; clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%); }
.sh-tut .k { font: 700 10px/1 var(--mono); letter-spacing: .26em; text-transform: uppercase; color: var(--dim); }
.sh-tut .t { font: 400 clamp(26px, 5vh, 40px)/1 var(--disp); text-transform: uppercase; margin: 4px 0 4px; }
.sh-tut .x { font: 700 12px/1.45 var(--mono); letter-spacing: .04em; color: var(--bone); max-width: 46ch; }
.sh-tut .bar { display: flex; gap: 3px; margin-top: 9px; }
.sh-tut .bar i { flex: 1; height: 5px; background: rgba(232,226,212,.2); }
.sh-tut .bar i.f { background: var(--bone); }
.sh-tut .bar i.c { background: var(--accent); }
.sh-tut .skip { position: absolute; right: 22px; top: 10px; background: none; border: 0; color: var(--dim); font: 700 10px/1 var(--mono); letter-spacing: .2em; text-transform: uppercase; cursor: pointer; padding: 4px; }
.sh-tut.ok { border-color: var(--accent); }
.sh-tut.ok .t { color: var(--accent); }
.sh-stamp { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; pointer-events: none; }
.sh-stamp .big { font: 400 clamp(90px, 22vh, 240px)/.8 var(--disp); color: var(--bone); text-shadow: 8px 8px 0 rgba(12,12,11,.9); letter-spacing: .02em; }
.sh-stamp .sub { font: 700 13px/1 var(--mono); letter-spacing: .3em; text-transform: uppercase; margin-top: 12px; text-shadow: 2px 2px 0 var(--ink); }
.sh-edge { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 0 transparent; transition: box-shadow .25s linear; }
.sh-edge.flood { box-shadow: inset 0 0 0 18px var(--edge, #fff); }
.sh-edge.warn { animation: sh-warn 1s steps(2) infinite; }
@keyframes sh-warn { 0% { box-shadow: inset 0 0 0 6px #d8262e; } 100% { box-shadow: inset 0 0 0 0 transparent; } }
.sh-results { position: absolute; left: 50%; bottom: calc(12% + var(--safe-b)); transform: translateX(-50%); display: flex; gap: 6px; align-items: flex-end; }
.sh-res { width: 64px; background: rgba(12,12,11,.85); padding: 8px 6px; display: flex; flex-direction: column; gap: 6px; align-items: stretch; animation: sh-up .14s linear both; }
@keyframes sh-up { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.sh-res .bar { height: 6px; }
.sh-res .nm { font: 400 15px/1 var(--disp); text-transform: uppercase; overflow: hidden; white-space: nowrap; }
.sh-res .pts { display: flex; gap: 2px; flex-wrap: wrap; }
.sh-res .pts i { width: 7px; height: 12px; transform: skewX(-18deg); background: var(--bone); opacity: .2; }
.sh-res .pts i.f { opacity: 1; }
.sh-res.win { outline: 3px solid var(--bone); }
.sh-pausebtn { position: absolute; right: calc(10px + var(--safe-r)); top: calc(8px + var(--safe-t)); width: 40px; height: 34px; background: rgba(12,12,11,.72); border: 0;
  display: grid; place-items: center; pointer-events: auto; cursor: pointer; }
.sh-pausebtn i { display: block; width: 18px; height: 3px; background: var(--bone); box-shadow: 0 6px 0 var(--bone), 0 -6px 0 var(--bone); }
.sh-lag { position: absolute; left: 50%; top: calc(40px + var(--safe-t)); transform: translateX(-50%); font: 700 10px/1 var(--mono); letter-spacing: .2em;
  background: #d8262e; color: var(--bone); padding: 4px 8px; }
.sh-fps { position: absolute; left: calc(8px + var(--safe-l)); top: calc(8px + var(--safe-t)); font: 700 11px/1 var(--mono); background: rgba(12,12,11,.7); padding: 3px 5px; }
.sh-note { position: absolute; left: 50%; top: calc(56px + var(--safe-t)); transform: translateX(-50%); background: var(--ink); border: 2px solid var(--bone);
  padding: 8px 14px; font: 700 12px/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase; animation: sh-in .12s linear; pointer-events: none; max-width: 90vw; text-align: center; }

/* ---------- touch controls ---------- */
#ui.sh-touch-on .sh-held { left: 50%; transform: translateX(-50%); bottom: calc(10px + var(--safe-b)); }
.sh-stickzone { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
.sh-touchpad { position: absolute; width: 0; height: 0; pointer-events: none; opacity: 0; --r: 70px; }
.sh-touchpad.on { opacity: 1; }
.sh-touchpad.up .sh-ring { background: rgba(232,226,212,.2); border-color: var(--bone); }
.sh-touchpad .sh-ring { position: absolute; left: calc(var(--r) * -1); top: calc(var(--r) * -1); width: calc(var(--r) * 2); height: calc(var(--r) * 2);
  border: 2px solid rgba(232,226,212,.7); clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); background: rgba(12,12,11,.25); }
.sh-touchpad .sh-knob { position: absolute; left: 0; top: 0; width: 34%; width: calc(var(--r) * .7); height: calc(var(--r) * .7); transform: translate(-50%, -50%);
  background: var(--bone); clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); opacity: .85; }
.sh-tbtn { position: absolute; display: grid; place-items: center; pointer-events: auto; touch-action: none; border: 2px solid rgba(232,226,212,.75);
  background: rgba(12,12,11,.3); font: 700 11px/1 var(--mono); letter-spacing: .18em; color: var(--bone); user-select: none; }
.sh-tbtn.on { background: var(--bone); color: var(--ink); }
.sh-tview { top: calc(8px + var(--safe-t)); right: calc(58px + var(--safe-r)); width: 40px; height: 34px; border: 0; background: rgba(12,12,11,.72); }
/* The gesture square: tap = jump, swipe = hit, sweep = haymaker, the lower band = kicks. */
.sh-tact { --sq: calc(var(--bs, 1) * clamp(150px, 46vh, 250px)); right: calc(18px + var(--safe-r)); bottom: calc(18px + var(--safe-b));
  width: var(--sq); height: var(--sq); display: block; overflow: hidden; clip-path: polygon(22px 0, 100% 0, 100% 100%, 0 100%, 0 22px); }
.sh-tact.on { background: rgba(232,226,212,.1); color: var(--bone); }
.sh-thint { position: absolute; left: 14px; top: 12px; font: 700 9px/1.6 var(--mono); letter-spacing: .16em; color: rgba(232,226,212,.5); pointer-events: none; }
.sh-thint b { color: rgba(232,226,212,.85); font-weight: 700; }
.sh-kickband { position: absolute; left: 0; right: 0; bottom: 0; height: 36%; border-top: 2px dashed rgba(232,226,212,.35); background: rgba(232,226,212,.05); pointer-events: none; }
.sh-kickband span { position: absolute; left: 14px; bottom: 10px; font: 700 9px/1 var(--mono); letter-spacing: .16em; color: rgba(232,226,212,.5); }
.sh-kickband b { color: rgba(232,226,212,.85); }
.sh-trail { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; }
.sh-trail polyline { fill: none; stroke: var(--bone); stroke-width: 7; stroke-linecap: square; stroke-linejoin: miter; }
.sh-trail.fade { animation: sh-trail .35s linear; }
@keyframes sh-trail { from { opacity: .85; } to { opacity: 0; } }
.sh-gest { position: absolute; right: 12px; top: 10px; font: 400 24px/1 var(--disp); letter-spacing: .02em; color: var(--bone); opacity: 0; pointer-events: none; }
.sh-tact.flash .sh-gest { animation: sh-gest .42s linear; }
@keyframes sh-gest { 0% { opacity: 1; transform: translateY(0); } 70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
.sh-left .sh-stickzone { left: 50%; }
.sh-left .sh-tact { right: auto; left: calc(18px + var(--safe-l)); }

/* ---------- editor ---------- */
.sh-ed { position: absolute; inset: 0; pointer-events: none; }
.sh-ed > * { pointer-events: auto; }
.sh-edtools { position: absolute; left: calc(10px + var(--safe-l)); top: calc(10px + var(--safe-t)); bottom: calc(10px + var(--safe-b)); width: 168px; display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; background: rgba(12,12,11,.86); padding: 10px; border-right: 2px solid var(--bone); }
.sh-edtop { position: absolute; left: calc(190px + var(--safe-l)); right: calc(10px + var(--safe-r)); top: calc(10px + var(--safe-t)); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sh-edcode { background: rgba(12,12,11,.86); padding: 8px 10px; font: 700 12px/1.2 var(--mono); letter-spacing: .1em; word-break: break-all; max-width: 46vw; }
.sh-edstatus { position: absolute; left: calc(190px + var(--safe-l)); bottom: calc(10px + var(--safe-b)); background: rgba(12,12,11,.86); padding: 8px 10px; font: 700 11px/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.sh-edstatus.bad { background: #d8262e; }
.sh-qr { background: var(--bone); padding: 12px; display: inline-block; }

@media (max-width: 760px), (max-height: 520px) {
  .sh-screen { grid-template-columns: 1fr; }
  .sh-bar { border-right: 0; padding: calc(14px + var(--safe-t)) 16px calc(14px + var(--safe-b)) calc(16px + var(--safe-l)); gap: 7px; }
  .sh-btn { font-size: 22px; padding: 9px 14px 8px 12px; }
  .sh-titlestamp .t { font-size: 46px; }
  .sh-roster { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sh-slot { min-height: 74px; }
  .sh-edtools { width: 132px; }
  .sh-edtop, .sh-edstatus { left: calc(150px + var(--safe-l)); }
}
@media (max-height: 520px) and (min-width: 700px) {
  .sh-screen { grid-template-columns: minmax(280px, 46%) 1fr; }
  .sh-titlestamp { display: block; }
}
`;
