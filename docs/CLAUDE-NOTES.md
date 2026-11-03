# Notes for Claude

How to build, test and hand over an update of Splinterhall. Read README.md and docs/DESIGN.md as well. The live, editable design guide is the Splinterhall Design Guide in Claude: https://claude.ai/artifact/8ktm1R6UhMH4pshNjM47CD

## Making an update

1. `npm install` (once), edit `src/`, then `node tools/build.mjs --nozip` for a quick build or `npm run build` for the zips.
2. Syntax and bundle errors show in the build. Then run the headless checks below.
3. Update `CHANGELOG.md` (a new `## Prototype N` at the top) and bump `PROTOTYPE` in `src/core/consts.js`.
4. Don't push to GitHub: Eric uploads the source zip himself.

## Headless checks (Node, no browser)

- `node tools/levels-ascii.mjs 400` builds 400 random codes twice: all must pass the level check and be deterministic. `node tools/levels-ascii.mjs <code>` prints one level as ASCII.
- `node tools/dev/codes.mjs` round-trips custom codes (editor edits) and archetype overrides.
- `node tools/sim-bots.mjs 40` plays 40 rounds of 8 AI fighters: no errors, no unfinished rounds; it prints round lengths, deaths by cause and damage by kind.
- `node tools/sim-chaos.mjs 16` gives every fighter an item and uses it, to catch crashes in item code.
- `node tools/dev/moves.mjs` checks every bare-hand move on a flat floor (jab-cross-hook, haymaker, uppercut, slam, stomp dive, front kick, roundhouse, leg sweep both sides, flying kick, dropkick, reach, ducking, input buffering), the tap throw and the empty-handed tap jump.
- `node tools/dev/movereach.mjs [clip,clip]` measures every move clip's reach (the longest centre-to-centre distance it still lands at) and whether it hits a crouching target.
- `node tools/dev/poses.mjs <dir> [only=a,b]` runs the move reel's scenes in Node and draws skeleton contact sheets with Pillow (side view plus a top view for depth): the fast way to tune a pose without WebGL.
- `node tools/dev/jumps.mjs` prints the movement numbers (jump and double-jump height, air time, run speed and acceleration, a wall-jump climb).
- `node tools/dev/stuck.mjs [rounds] [fighters]` finds AI fighters that stay put for 5 s with somewhere to be, says why (jumping into a ceiling, no route, swinging at nothing…), and prints the longest stuck time. Aim for a few cases and a worst case under 10 s.
- `node tools/dev/gestures-unit.mjs` checks the gesture square's swipe classifier against a table of swipes.

Rapier rules learned the hard way:
- Never change a body (velocity, type, removal) inside a Rapier query callback (`intersectionsWithShape`, `contactPairsWith`, `forEachImpulseJoint`); collect first, act after.
- A block broken by a hit removes its body, so look bodies up with `sim.bodyOf(collider)` after any damage.
- Rapier reuses a removed body's slot, and `world.getRigidBody(oldHandle)` then returns the *new* body, so it is not a liveness check. Use `sim.bodyAlive(body)`, `sim.colAlive(col)` and `sim.jointAlive(joint)` (identity checks) before touching anything kept across steps. (`sim.alive()` is the list of living fighters.)
- The simulation is deterministic for a level code, round and match seed (no `Math.random` in `src/sim/` or `src/ai/`), so `node tools/dev/repro.mjs <code> <round>` replays an AI round from `sim-bots` exactly.

## Browser checks (headless Chrome with SwiftShader)

- `node tools/shot.mjs "bot=1&code=JXAH67KH" out.png 1280 720 10` runs an AI match and screenshots it (prints draw calls). `fighters=2` zooms the camera in; `quality=lite|clean|everything`.
- `node tools/ui-shots.mjs <dir> 1280x720 844x390 390x844 1280x800` screenshots the title, match setup, a match, pause and the editor at each size.
- `node tools/cover.mjs dist/splinterhall-cover.png` renders the itch.io cover from `?cover=1`.
- `node tools/dev/flow.mjs <dir>` plays title → match → results → rematch → leave against AI.
- `node tools/dev/musicflow.mjs` unlocks audio, then reports the music's tune, rung and voices through the menu and a match.
- `node tools/dev/mprelay.mjs 3` runs three separate browsers through the Wi-Fi host pack (`dist/wifi-host/wifi-host.py`, started by the script): create, join, ready, fight, guest input reaching the host, rematch. Use separate browsers: background tabs in one browser get about one animation frame a second, which starves a host tab.
- `node tools/dev/mpflow.mjs 3` is the same between tabs of one browser (`mp=local`); fine for lobby, takeover and rematch, too slow for the fight itself.
- `node tools/dev/wifishots.mjs <dir>` screenshots the Wi-Fi pairing screens at desktop and landscape-phone sizes.
- `node tools/dev/gestures.mjs` sends real touch events to the gesture square on a phone-sized page (tap, hold, swipes, sweep, kick band, double tap, pad down to duck). Run it without a screenshot path: with rendering on, this machine draws a few frames a second and the timing checks fail.
- `node tools/dev/tutorial.mjs` plays the whole Learn tutorial with the keyboard; `node tools/dev/tutshots.mjs <dir>` screenshots the coach on a phone and a desktop.
- `node tools/dev/reel.mjs <dir> [only=a,b] [fps=30] [size=1280x720] [quality=clean] [sheet=1]` captures the move reel (`?reel=1`, scenes in `src/game/reel-scenes.js`) frame by frame into an MP4 (and contact sheets). Slow on this machine: about a second a frame.
- `node tools/dev/camshots.mjs <dir>` screenshots the player camera on a phone: drop-in, follow, the eye's overview, back.
- `node tools/dev/intro.mjs <dir>` screenshots the round-start marker; `node tools/dev/ragnarok.mjs <dir>` the rising abyss in the Bunker and Hall.

## Controls in code

- Every device becomes `{ x, y, b, jp, ap, ak, ad }` (`src/ui/input.js`): stick, held bits (1 jump, 2 action), press counters, and for the latest Action press its kind (`ATK.NORMAL`, `HEAVY`, `KICK`, `UPPER`, `SLAM`, `DROPKICK`, `THROW`) and direction byte (`NO_DIR` = use the stick's aim). The same array goes over the network to the host.
- Touch: the stick pushed up (past `UP_ON`, released below `UP_OFF`) counts a jump and holds bit 1 (jetpack); a tap on the square is an `ATK.THROW` press, which the fighter turns into a jump when its hands are empty (`tapJump` in `Fighter.control`).
- The gesture thresholds are `GESTURE` in `src/ui/input.js`; gesture times come from the events' own timestamps so slow frames don't turn taps into holds.

## Animation and moves

- `src/anim/skeleton.js`: the 3D skeleton (15 joints; local frame x forward, y up, z toward the camera; the near limbs F sit at +z), poses as limb directions plus scalars (lean, twist, spin, roll, tilt, dx, dy), slerped blends, two-bone IK, `solve()` to world joints.
- `src/anim/moves.js`: every move is a clip of partial keyframe poses (fields can be functions of the aim), hit windows on a limb or the weapon, pushes (`set: 'exact'` overrides velocity), events (`throw`, `pound`) and flags (`move` = share of run speed kept, `crouch`, `fall`, `cancel` = when the next move may start).
- `src/anim/animator.js`: procedural locomotion (stance, run with planted feet, crouch, air rise/fall, double-jump somersault, wall cling, jetpack, dive, landing squash, turning round through depth) under the clips; item stances; flinch; the hand-over to the physics ragdoll when poise is gone (and back, from where the ragdoll lies).
- Each step: `Items.action` advances the move → `Fighter.animate` poses it → `Items.meleeTick` tests hits → `Fighter.drive` points the physics limbs at the flattened pose. After the physics step `Fighter.placeAnim` re-places the pose so the frame shows it where the body is.
- Hits are tested against other fighters' drawn joints (`segDist` in `src/sim/items.js`), and against blocks and props with Rapier queries. Which move a press makes: `handMove`, `kickMove`, `weaponMove` in `src/sim/items.js`.
- Frames carry `joints` (15 × xyz), `wup` (the held item's blade side) and `strike` (the limb whose hit window is open, for the view's swing trails); snapshots pack the joints as bytes relative to the torso.
- A hit of 14+ damage triggers a short hit-stop (`Sim.hitStop`, a few steps at a tenth of the speed, at most every 0.35 s).
- The AI routes on its own map (`navMap` in `src/ai/nav.js`); the level generator's `reachMap` must not change, or level codes would build different levels. Health is `FIGHTER_HP` in `src/core/consts.js` (snapshots carry it in one byte: keep it at or under 255).
- Movement constants (run, jumps, fall pull, air control, wall slide and wall jump) are at the top of `src/sim/fighter.js`.

## Camera

- `src/view/camera.js`: `PlayerCam` follows the local fighter (15 m across, widening to 20 m to keep the nearest opponent within 9 m), leads the way you run, and gives the whole arena during the drop-in, after you die, and for 2.6 s when asked (`toggleOverview`: the eye button, Tab, pad Select). `EdgeMarkers` puts a chevron on the screen edge for each fighter out of view. Settings → Controls → Camera: Follow me / Whole arena.

## Music and multiplayer

- Music: `src/audio/music/` (engine), `assets/audio/music/` (179 samples, `bank.json`, per-file credits), `tools/samples/build_bank.py` (rebuilds the samples from the original libraries), `tools/music/` (browser harness, offline renderer, analysis). Offline previews: `MUSIC_RENDER_DIR=<dir> node tools/music/render.mjs --preview`.
- A local match picks the least familiar of a dozen tunes (`setTune(seed, { fresh: true })`); a room plays the seed's tune so everyone hears the same song.

## Music tracks (the default source)

- Options → Music → Source: **Tracks** (default, `settings.musicSource = 'tracks'`) or **Live generator** (`'live'`). `src/audio/audio.js` picks the source; the live generator is a dynamic `import()` (`loadMusic` in `src/audio/hookup.js`), so its code runs and its 3.8 MB of samples are fetched only when Live is chosen, and switching back stops it and lets it go. With Tracks, `audio.musicApi()` (what `match.js` reaches through `app.music`) is a frozen no-op object, so the reactive calls cost nothing.
- `src/audio/tracks.js` is the track player: `assets/audio/tracks/tracks.json` lists the songs (`file, title, artist, style, licence, credit, source`; style viking | battle | power | folk, and folk plays with Viking and Any; trailing commas are forgiven). Two `<audio>` elements stream the files through `MediaElementAudioSourceNode` → deck gain → a fader (0.5 in menus, 1 in matches) → `Audio.musicBus`, so the volume setting works. Shuffled, no repeats until the pool runs out, a 1 s gap-free hand-over at the end of a song (the files carry their own fades), a 1.2 s crossfade on Next. Missing files are skipped; a missing manifest means silence. Both elements play a moment of silence inside the first tap or key (`Audio.unlock`), which is what lets iOS play them later; the tracks pause while the tab is hidden.
- Credit lines of non-game tracks show on the in-game Credits page straight from the manifest (`audio.trackCredits()`); also add them to `CREDITS.md` and `assets/audio/tracks/CREDITS.md`. `assets/audio/tracks/WISHLIST.md` lists CC tracks found but not downloaded, and the steps to add one.
- Regenerate the six Splinterhall band songs: `MUSIC_RENDER_DIR=<dir> node tools/music/pregen.mjs` (renders them one at a time in headless Chrome through `tools/music/pregen.html`, about 30 s each to render and 40 s to master on this machine; `--only viking-a,power-b`, `--list`, `--master-only`). The songs are `SONGS` and their arcs `ARCS` at the top of the file: intensity targets in seconds, moved onto 4-bar phrase lines, ending with the match-end cadence. Mastering: fade in 1.8 s and out 3.4 s, -14 LUFS integrated, true peak under -1 dBTP (it re-measures the MP3), 96 kbps stereo MP3, and the manifest's `gen-*` entries are rewritten.
- Loudness-match a downloaded track: `node tools/music/pregen.mjs --import <file> --out <name>.mp3` (trims silence, short fades, same loudness and encoding). `node tools/music/pregen.mjs --check` measures everything in the manifest and the folder size.
- Browser check: `node tools/music/trackflow.mjs` (after a build) unlocks audio with a key, checks the title widget, Next, a song's gap-free hand-over, a missing file, the switch to Live and back, a short match, console errors, that no live sample is fetched while Source is Tracks, and one tap on a phone page under Chrome's real autoplay policy. `tools/dev/musicflow.mjs` follows the live generator, so it only shows the band when Source is Live generator.
- Multiplayer: `src/net/room.js` (lobby, roster, host takeover) over Hoverline's transport (`endpoint.js`, `carriers.js`, `mqtt.js`, `direct.js`, `wifi.js`); `src/game/net.js` is the game side. Inputs go to the host only (`sendFast('in', …, room.hostId)`); snapshots at 20/s; events batched per snapshot. Room tests: `node tools/net/test-node.mjs`; the browser suite needs a test broker (see the top of `tools/net/test-browser.mjs`).
- The Wi-Fi host pack (`tools/release/wifi-host/`, built into `dist/splinterhall-wifi-host.zip`) is Hoverline's `wifi-host.py` with the relay name `splinterhall` and port 5199.
- URL parameters: `?bot=1` (AI only), `?dev=1` (you plus AI), `fighters=N`, `code=XXXXXXXX`, `setting=bunker|forge|fjord|hall`, `quality=…`, `render=0`, `mp=local` (multiplayer between tabs), `broker=ws://…` (test MQTT broker), `test=1` (exposes `window.__splinterhall`), `editor=1`, `cover=1`.

## Performance

Target: 60 fps on a Samsung Galaxy S22 (landscape about 844x390 CSS px at devicePixelRatio ~2.8) in the default look, Clean. Hoverline holds 60 there; it renders at pixel ratio 2 with Lambert materials, no shadows and one post pass, so per pixel it is far cheaper than this game.

How to measure (tools in `tools/perf/`; this machine only has SwiftShader, a CPU rasteriser, so its milliseconds are a relative proxy for GPU work and swing a lot when anything else runs):
- `node tools/perf/build-perf.mjs <dir> [--src <dir>]` bundles a copy (unminified) away from `dist/web`, so A/B builds can't change under a test. To A/B, copy `src/` aside, build both.
- `node tools/perf/bench.mjs --web <dir> --size 844x390 --dpr 1.5 --query "bot=1&fighters=8&code=B7BGP1BR&quality=clean" --seed perf1 --tick 900 --cam 20,11.5,42 --configs base,nopost,noshadow,noblocks,...` restarts the match with a fixed seed, steps the simulation to the tick (the same moment in any build), freezes it and prints work counts that don't depend on machine load: draws, triangles and vertex-shader runs in the main and shadow passes (after culling), fragments shaded in the main pass (split blocks / scenery / rest) and the post passes with the pixels they write. Then it times configs (switch a part off, or `k:aa=smaa;bloomLevels=8` to set look knobs) interleaved one frame at a time; compare low quartiles, and `--workconfigs` gives counts per config. `--shotconfigs a,b --shotdir d` screenshots each config. The phone size (844x390) emulates touch, so `isPhone()` is true.
- `node tools/perf/ab.mjs <webA> <webB> --query ...` opens two builds side by side at the same moment and renders them alternately: the fairest timing when the machine is busy.
- `node tools/perf/profile.mjs --web <dir>` samples main-thread JavaScript per frame by file and function (use a small canvas so waiting on the GPU process stays low).
- The game's own frame-rate check (`perfWatch` in `src/game/app.js`) would change the look mid-test; the tools mark it done in localStorage.

What costs what (Clean, Bunker, 1266x585 pixels, before → after the performance pass; work counts are exact for that frame):

| Part | Before | After |
| --- | --- | --- |
| Draw calls a frame (main + shadow + post) | 205 | 107 |
| Block vertices a frame (main + shadow) | 296,100 + 294,000 (RoundedBox, 900 unshared vertices a block) | 7,224 + 7,000 (24-vertex chamfered box) |
| All vertex-shader runs (main + shadow) | 343,105 + 317,600 | 56,749 + 30,476 |
| Scenery draw calls (Bunker / Hall) | 132 / 172 | 10 / 18 (static meshes merged per material) |
| Fragments shaded in the main pass | 2.26 M (3.05 per pixel) | 1.71 M (2.31); Forge 2.32 M → 0.99 M, Fjord 1.97 M → 1.03 M |
| Post passes / pixels written | 20 / 4.2 Mpx (SMAA high, full-res bright pass, 8 bloom levels) | 14 / 2.16 Mpx on phones (FXAA, half-res bright pass, 6 levels); desktop Clean keeps SMAA: 16 / 4.53 Mpx at 1280x720 |
| Shadow map | 2048² over a fixed 56x44 m | fitted to the view each frame (about 40x36 m whole arena, 20x16 m for a 15 m view; same softness in metres): 1024² on phones, 2048² elsewhere |
| Main-thread time to issue a frame (SwiftShader A/B) | 3.5-5.3 ms | 1.2-3.4 ms |
| Frame time, SwiftShader A/B (Forge / Fjord / Hall Clean; Bunker Lite / Everything) | 1828 / 1767 / 1590; 522 / 1932 ms | 1420 / 1504 / 1312; 414 / 1669 ms (-15 to -22%) |

What is left, roughly in order (SwiftShader, Clean, Bunker): the block material itself (MeshStandard with albedo, normal and roughness maps, image-based light and PCF shadows: about 40% of the frame), the image-based light on every standard material (`noenvmap` about -30%), the post chain (about -30% with none), the shadow map (about -20%), the four abyss mist planes in the Bunker and Hall (0.6 M blended fragments), the sky (now drawn last), the fighters (20 draws and ~42k vertices with the outline hulls; the head is an icosahedron of detail 3, 3,840 unshared vertices). Pixel ratio is the biggest lever: Clean at 1.25 instead of 1.5 is about -30%, at 1.0 about -55%.

Looks per device: `QUALITY` in `src/view/view.js`; a look's `phone` entry overrides knobs when `isPhone()` (coarse pointer, short screen side ≤ 600 px). Clean on a phone uses FXAA (one pass) and a 1024² shadow map; elsewhere SMAA and 2048². `perfWatch` (`src/game/app.js`) times 240 frames of each real fight until the look holds 55 fps; below that it steps down once per check (80% resolution first, then the next cheaper look) and says so. Picking a look or resolution in Options stops it.

Rules that keep it fast:
- Static scenery goes into `this.root` and is merged per material after the setting is built (`mergeStatic` in `src/view/env.js`): share materials (`std()`), and mark anything that moves or animates `userData.live`.
- Draw order: the arena (renderOrder 0), then scenery (1), then the sky (2), so the depth test throws away hidden scenery before it is shaded. Don't draw big backgrounds first.
- Blocks: one batch per material (`src/view/blocks.js`); at 24 vertices a block, spatial chunks only added draw calls (34 a pass for 8x8 chunks against 4). Uploads touch only changed instances.
- No per-frame allocation in particle pools and weather (`src/view/fx.js`, `src/view/env.js`); pools upload only their live instances.
- Lights: every point light is paid for by every lit pixel. The explosion flashes in `src/view/fx.js` switch three point lights on and off, which changes the light count, so the first explosions compile new shader variants of every lit material (a one-off hitch); keeping them always on would cost every pixel three lights instead.

## Handing over

Each handover is three files from `dist/`: `splinterhall-itch.zip`, `splinterhall-cover.png`, `splinterhall-source.zip` (the build also writes the optional `splinterhall-wifi-host.zip`). Say what changed, and whether level codes still build the same levels.
