# Changelog

## Prototype 4
- Fighters are 3D skeletons now, animated, not physics puppets: shoulders and hips have depth, near and far limbs sit at different distances from the camera, and moves swing through depth (a hook comes round from the side, a roundhouse whips round, an axe whirls all the way round you). The physics ragdoll takes over only when a fighter is knocked loose or killed, and they get up from wherever it left them.
- A repertoire of moves, each a keyframed animation with full reach: jab → cross → hook; haymaker; uppercut; slam; superman punch (an air dash along the swipe); stomp dive; front kick; roundhouse (kick swiped upward); leg sweep (crouch + kick, a full turn that trips people in front and behind); flying kick (kick at a run or in the air); dropkick; throw. Axe: chop, backhand, whirl (two turns round you), somersault in the air. Sword: thrust high, middle or low along the swipe (Nidhogg-style), slash, lunge. Hammer: overhead smash, two-turn spin.
- Hits land where the limbs are drawn: every attack is tested against the other fighters' drawn skeletons. Crouching ducks under jabs, crosses and hooks; sweeps, slams, kicks and haymakers still find you.
- Locomotion is animated too: a fighting stance, a run with planted feet and pumping arms, a deep crouch and crouch-walk, rising and falling poses, a somersault on the double jump, a wall cling with a hand on the wall, a landing squash, and turning round through depth.
- Feel: swing trails on whatever is striking, a short hit-stop on big hits, a flinch when hit, and moves you start with the stick let go carry their own momentum (a step into a jab, a lunge behind a haymaker).
- Controls: on touch, the stick's up is jump (up again in the air: double jump; held: jetpack) and down is crouch. A tap on the square throws what you're holding along the stick (with empty hands a tap still jumps). Keys: E throws, Tab shows the whole arena. Pad: RB throws, Select shows the arena.
- Camera: close on your own fighter (one player per device), leading the way you run and widening to keep a nearby opponent in shot; markers on the screen edge point at anyone out of view. The whole arena shows during the drop-in, after you die, and for a moment when you tap the eye button. Options → Controls → Camera can switch back to the whole-arena camera.
- Performance: about half the draw calls (205 → 107 in the Bunker): blocks are a light chamfered box batched per material (7k vertices instead of 296k), scenery is merged per material and drawn after the arena, the shadow map is fitted to the view (1024² on phones), the glow's bright pass runs at half resolution, and phones use FXAA. The automatic check now aims for 55 fps, lowers resolution before the look, and gives back Clean to anyone the old check had dropped to Lite. Fighter heads use a tenth of the vertices.
- Music: songs pre-rendered from the metal generator (two each of viking, battle and power), plus two Creative Commons folk metal tracks by PeriTune (CC BY 4.0). Options → Music → Source picks Tracks (default) or the live generator, which only loads when chosen.
- AI uses the new moves (sweeps on duckers, roundhouses, weapon heavies when crowded) and throws with a tap.
- `?reel=1` plays every move against a dummy (`tools/dev/reel.mjs` records it); `tools/dev/poses.mjs` and `tools/dev/movereach.mjs` check poses and reach headlessly.

## Prototype 3
- Movement tuned toward Stick Fight: faster, snappier running (full speed in a tenth of a second), jumps about twice as high (two body heights; a double jump reaches 6 m), heavier falls, strong air control, loose flailing limbs in the air, and bigger knockback (more so in the air).
- Wall cling and wall jumps: push into a wall in the air to slide down it slowly; jump to kick off it (the double jump comes back), so walls can be climbed.
- More moves from the square: swipe up for an uppercut (launches people), swipe down for a slam (a stomp dive in the air, with a shockwave on landing), a long sweep along the kick band for a dropkick (huge, but you land on your back), and three quick jabs end in a cross. Keys and pads pick the move with the stick (Up + X uppercut, Down + X slam; a kick in the air is a dropkick).
- Throwing is now stick up + swipe, and the item flies along the swipe (keys and pads: Up + X).
- Presses made while a move is still finishing are kept for a quarter second, so mashing never drops a hit.
- AI: its own route map with proper headroom checks (no more jumping into overhangs), memory of routes that failed, giving up on foes and items it can't reach, wandering instead of standing still, never jumping into a ceiling, and the new moves and throw.
- Fixed: fighters could stand on the face of a wall (a ground ray starting inside the wall), get pinned in one-block tunnels (they now crouch through), snag a foot in the seam between two blocks (a small hop frees them), or stay embedded in a block after a big hit (they pop out).
- Learn covers the new moves and wall jumps (12 steps); the practice room has a full-height wall for them.

## Prototype 2
- Touch controls are one gesture square instead of Jump and Action buttons: tap to jump (again in the air to double jump), swipe to hit toward the swipe, sweep across for a haymaker, swipe along the dashed bottom band to kick, swipe and hold to keep using an item, hold in the air for the jetpack. The square shows each move's name and trail as you make it.
- New moves for everyone: the haymaker (slow, staggers, sends people flying) and the kick (trips people up, catches people who duck). Keys: C kick, V haymaker. Pad: B kick, Y haymaker.
- Ducking: hold the stick down on the ground. Jabs and haymakers pass over a ducking fighter; kicks don't.
- Jabs land along the aim line, so they no longer scoop low from the guard.
- Fighters have 250 health (was 100); rounds last about twice as long.
- A marker in your colour (light shaft, octagon, chevron) shows where you are during the drop-in and fades as the fight starts.
- Learn: a practice room with a training dummy that walks through every move, with prompts for touch, keys or a pad. Offered first on the title screen.
- Music is quieter by default (50%, was 80%); saves on the old default move to the new one.
- Fixed: a round with item drops off still dropped one item early.

## Prototype 1
- First build, from the design guide (docs/DESIGN.md).
- Side-on 2.5D brawler in full 3D (Three.js), physics in Rapier 2D on one plane. Arena 40 x 24 m.
- Active-ragdoll stick fighters: 10 bodies held in a pose by velocity control, a hover spring at the hips, poise that drops when hit hard.
- Terrain of 1 m blocks in six materials; blocks are fixed until they lose their link to bedrock, then fall as whole slabs that shatter when they land hard.
- Items: bearded axe, greatsword, war hammer, blunderbuss, rocket launcher, bombs, web gun, tractor beam, portal gun, serpent horn, jetpack, bare hands.
- Seeded levels in four settings (Bunker, Forge, Fjord, Hall) and five archetypes; every level passes a reachability check; codes are 8 characters.
- Level editor with custom codes (the seed plus the edits), saving, testing with AI.
- AI fighters in three skills.
- Live instrumental metal (viking, battle, power) that climbs a five-rung ladder with the fight.
- Multiplayer rooms for up to 8 on the internet or one Wi-Fi with no internet (Hoverline's transport), host-authoritative snapshots. If the host drops, the next player hosts and everyone returns to the lobby; a player who leaves mid-match is taken over by an AI.
- Optional Wi-Fi host pack (`splinterhall-wifi-host.zip`) for hosting from a Steam Deck, Linux PC or Mac.
- Ragnarök (after 90 s) finally covers the whole arena, so every round ends.
- Brutalist, angular UI; every screen works with touch, a gamepad or keys.
