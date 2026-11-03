# Splinterhall

A physics stickman brawler for up to 8 fighters, in the browser: phone first, also tablet, Steam Deck and desktop. Side-on 2.5D drawn in full 3D with Three.js, active-ragdoll fighters, destructible terrain made of physics blocks, a dozen strange and mundane items, seeded levels with a level editor, AI fighters, multiplayer on the internet or one Wi-Fi, and instrumental viking, battle, power and folk metal: songs pre-rendered from the game's own metal generator plus Creative Commons folk metal, with the live generator as an option.

**Play:** run `npm install` then `npm run build`, and open `dist/web/index.html` through any static web server (or upload `dist/splinterhall-itch.zip` to itch.io as an HTML game).

## Controls

Your fighter is a 3D skeleton animated through a repertoire of moves (jab, cross, hook, haymaker, uppercut, slam, superman punch, stomp dive, front kick, roundhouse, leg sweep, flying kick, dropkick, throw; axe chop, backhand, whirl and somersault; sword thrust, slash and lunge; hammer smash and spin). Hits land where the limbs are drawn.

| Input | Touch | Gamepad | Keys |
| --- | --- | --- | --- |
| Run and aim | Left thumb stick: left / right | Left stick / d-pad | Arrows or WASD |
| Jump, double jump (a somersault) | Stick up (again in the air) | A | Space or Z |
| Crouch | Stick down | Down | Down |
| Wall cling, wall jump | Push into a wall in the air, then up | Push in, then A | Push in, then Space |
| Jetpack | Hold the stick up (or hold the square) in the air | Hold A | Hold Space |
| Jab, cross, hook / use item (hold to charge) | Swipe the square toward the target, up to three quick | X | X or J |
| Uppercut | Swipe up | Up + X | Up + X |
| Slam (in the air: stomp dive) | Swipe down | Down + X | Down + X |
| Haymaker / heavy weapon move (axe whirl, sword lunge, hammer spin) | Sweep across the square | Y | V or L |
| Kicks: front kick; roundhouse (aimed up); leg sweep (crouching); flying kick (at a run or in the air) | Swipe along the square's bottom band | B | C or K |
| Dropkick | A long sweep along the bottom band | — | — |
| Pick up / swap | Stick down on an item | Down | Down |
| Throw (along the stick) | Tap the square (empty hands: a tap jumps) | RB | E |
| Look at the whole arena for a moment | The eye button | Select | Tab |
| Pause | ≡ | Start | Escape |

The camera follows your fighter closely (one player per device) and widens to keep a nearby opponent in shot; markers on the screen edge point at everyone out of view. Options → Controls → Camera switches to the whole-arena camera.

## What's here

| Path | What it is |
| --- | --- |
| `src/sim/` | The simulation (host only): Rapier 2D world, active-ragdoll fighters, terrain blocks and collapse, items, the serpent |
| `src/level/` | The seeded level generator, level codes and custom-code edits |
| `src/anim/` | The fighter skeleton, the move library (keyframed clips with their hit windows) and the animator (locomotion + moves + ragdoll hand-over) |
| `src/ai/` | AI fighters |
| `src/view/` | The Three.js view: blocks, fighters, items, effects, the four settings, post-processing |
| `src/audio/` | The track player, the live metal engine (`music/`) and the effects player |
| `src/net/` | Multiplayer rooms (transport adapted from Hoverline) and snapshot packing |
| `src/ui/`, `src/game/`, `src/editor/` | Menus, HUD, input, the app and match flow, the level editor |
| `assets/` | Audio samples, HDRIs, fonts |
| `tools/` | Build, headless tests and sims, screenshots, the cover renderer, the sample pipeline |
| `docs/DESIGN.md` | The design guide this game was built from |
| `docs/CLAUDE-NOTES.md` | How to build, test and hand over an update (for Claude sessions) |

## Building

```
npm install
npm run build          # dist/web/, dist/splinterhall-itch.zip, dist/splinterhall-source.zip, dist/splinterhall-wifi-host.zip
node tools/cover.mjs dist/splinterhall-cover.png   # the 630x500 itch.io cover
```

New players: Learn on the title screen walks through every move with a training dummy.

The move reel: open `index.html?reel=1` to watch every animation against a dummy, or capture it to video with `node tools/dev/reel.mjs <outdir>`; `node tools/dev/poses.mjs <outdir>` draws quick skeleton contact sheets without WebGL, and `node tools/dev/movereach.mjs` measures every move's reach.

Credits for every asset and library are in `CREDITS.md` and on the in-game Credits page.
