# Splinterhall Design Guide

The live, editable copy of this guide is the Splinterhall Design Guide in Claude: https://claude.ai/artifact/8ktm1R6UhMH4pshNjM47CD

Nov 1, 2026 · @Eric

## The game in one page

Splinterhall (working title) is a physics stickman brawler for up to 8 fighters: last one standing wins the round, first to 5 rounds wins the match. It runs in a browser on itch.io, phone first, also tablet, Steam Deck and desktop, and every fighter plays on their own screen.

The arena is a side-on slice of a full 3D world. Everything that moves does so on one flat plane, but nothing on screen is 2D: fighters, blocks, debris, sparks and smoke are all lit 3D meshes, and the camera looks into a deep 3D backdrop.

**Pillars**

- **Simple hands, wild results.** One stick and two buttons. Everything interesting comes from physics: ragdolls, falling terrain, thrown blocks, portals.
- **The ground is a weapon.** Every level is built from hundreds of physics blocks. Rockets carve it, hammers smash it, unsupported chunks fall as whole slabs.
- **The music fights with you.** An instrumental metal band is generated live and swells to a crescendo when the fight peaks.
- **Restraint.** A tight roster of items and settings, each one distinct, rather than everything at once.

**Locked decisions**

| Decision | Choice |
| --- | --- |
| View | Side-on 2.5D: Three.js full 3D, physics on one plane |
| Fighters | Active ragdolls that balance themselves, Stick Fight style |
| Players | Up to 8, each on their own device; AI fills empty slots |
| Controls | One analogue stick, Jump, Action |
| Graphics | Full 3D everywhere in play; no sprites, billboards or 2D drawing |
| Music | Instrumental only: viking, battle and power metal, no vocals, no hum |
| Size | About 10 MB of audio, about 14 MB in all |
| UI | Brutalist and angular: hard edges, slabs, no rounded icons |

## Controls

The whole game plays with one analogue stick and two buttons, Jump and Action. The stick both moves and aims.

| Input | What it does |
| --- | --- |
| Stick left / right | Run. Speed follows how far the stick is pushed |
| Stick direction | Aim. The arm and the held item point where the stick points; up aims up |
| Stick down, standing on an item | Pick it up. A held item is dropped in its place (swap) |
| Stick down, in the air | Fast fall |
| Jump | Jump. A second tap in the air is a small double jump. Held in the air with a jetpack: thrust |
| Action | Use the held item; with empty hands, punch |
| Action, held | Charge: wind up a heavy swing, or hold a beam, web line or charge shot |
| Stick down + Action | Throw the held item along the aim, hard |

**Aim rule.** With the stick near centre, the fighter aims straight ahead in the direction it faces. Past 30% deflection the aim follows the stick in all 360 degrees. Aim is smoothed over about 60 ms so a thumb flick doesn't jitter.

**Devices**

- **Phone and tablet (landscape):** a circular touch pad on the left, built like Hoverline's pitch pad: it appears where the thumb lands, shows its ring and a knob, and reads the vector from that centre. Two large angular buttons on the right, Jump lower and Action upper-left of it. Haptic tick on hit if supported.
- **Gamepad:** left stick (or d-pad), A = Jump, X or B = Action. Start = pause.
- **Keyboard:** arrows or WASD, Space or Z is Jump, X or J is Action (up only aims, it never jumps), Escape = pause. Mouse aim is not used, so all inputs stay equal.

Every input is reduced to the same 3 values per frame (stick x, stick y, buttons bitmask) before it reaches the game or the network.

## Fighters

Each fighter is an active ragdoll: 10 rigid bodies joined by motorised hinges that try to hold a pose, so the figure stays upright and responsive until something hits it hard enough to knock it around.

**Body.** Head (ball, 0.32 m radius), torso, and an upper and lower part for each arm and leg (capsules). Standing height about 1.8 m. The parts of one fighter never collide with each other.

**Balance and movement.**

- A PD controller turns the torso and pelvis toward upright every step. Its strength is the fighter's **poise**: 100% normally, dropping to 0 for 0.3 to 1.2 s after a heavy hit (scaled by the hit), then recovering. Low poise is where the comedy comes from.
- Running applies a horizontal force at the hips toward a target speed of 7 m/s, with full control on the ground and 60% in the air. The legs play a walk cycle through their motor targets, timed to speed.
- Grounded = a short ray from the hips finds terrain within 1.1 m. Jump is an upward impulse of about 9 m/s, plus a smaller double jump in the air.
- The arms aim: the leading arm's motor targets point the hand along the aim, holding the item. The other arm swings loosely.

**Punching.** Action with empty hands thrusts the leading fist along the aim for 0.12 s. Damage and knockback come from the fist's actual speed when it lands, so a running punch hits harder.

**Damage.** 100 health. Damage comes from weapons and from impacts: anything (a block, a body, the ground) that hits a fighter faster than 9 m/s relative deals damage scaling with speed and mass. The fighter's colour dims toward grey as health falls, and the hit part flashes white for 60 ms.

**Death.** At 0 health, or below the arena's kill line, every motor switches off and the body goes fully limp. Corpses stay in the round as physics objects, and can be thrown, tractor-beamed and portalled. Deaths below the kill line (abyss, lava, sea) end with a setting-specific splash or burn.

**Look.** Limbs are smooth 3D capsules in the fighter's colour with a thin bright emissive core so bloom gives them a glow; the head is a sphere. No faces. The 8 colours are chosen to stay apart for colour-blind players: Bone, Ember, Glacier, Venom, Gold, Blood, Violet, Ash-teal.

## Physics, terrain and destruction

Physics is Rapier 2D (WebAssembly) at a fixed 60 steps a second on the host. The plane is x across, y up, in metres; the 3D renderer places everything at z = 0 and gives it depth for looks only.

**Arena.** About 48 m wide by 27 m tall, framed so a phone in landscape still shows a fighter clearly. Below the floor is the kill line: an abyss, lava or sea depending on the setting. The sides and the top are open; anything that leaves by more than 12 m dies.

**Blocks.** Terrain is a grid of 1 m cells. Each solid cell is a block with a material:

| Material | Health | Mass | Behaviour |
| --- | --- | --- | --- |
| Bedrock | Unbreakable | Fixed | Anchors a level; never moves |
| Stone | 60 | Heavy | Grey concrete or rock; breaks into chunks |
| Wood | 25 | Light | Planks and timber; splinters; ignites in a blast |
| Iron | 140 | Very heavy | Rings when hit; rarely breaks |
| Ice | 20 | Medium | Slippery to stand on; shatters |
| Glass | 8 | Light | Brittle panes; shatter into shards |

Neighbouring blocks of a level's built structures may be merged into larger slabs (up to 4 x 1 or 2 x 2) to cut body count; a slab breaks back into cells when damaged.

**Anchoring and collapse.** Blocks start as fixed bodies, so a level of 600 to 900 blocks costs almost nothing while it stands. After any destruction the game flood-fills the block graph from the bedrock. Every group no longer connected becomes one dynamic compound body and falls as a single slab. A falling slab that hits hard enough breaks into individual dynamic blocks. Loose blocks settle and go to sleep.

**Damage to terrain.** Explosions deal damage to every block in radius, falling off with distance, and push loose bodies outward. Heavy melee (hammer, charged swings) damages the block it strikes. A block at 0 health is removed and spawns 3D debris (below).

**Debris.** A broken block becomes 4 to 8 shards of its material: some are real dynamic bodies that fighters can trip on (capped at 120 in the world, oldest fade first), the rest are visual-only pieces that tumble with simple gravity and fade.

**Props.** Loose dynamic objects placed by the level: crates (wood), explosive barrels (blast when hit hard or burned), boulders, planks, hanging chains (jointed links) and lanterns. They exist to be thrown, stacked and knocked over.

**Budgets (host).** At most 260 dynamic bodies awake at once, beyond which the oldest debris is removed. A physics step must stay under 5 ms on a Galaxy S22.

## Items

Twelve items, each a real 3D model with its own silhouette, each used with Action and aimed with the stick. Hands hold one item; the jetpack is the only thing worn on the back, so it never takes the hand.

| Item | Use (Action) | Hold Action | Ammo | Destroys terrain |
| --- | --- | --- | --- | --- |
| Bearded axe | Quick chop along the aim | Wind up a heavy chop | Unlimited; throwable, it spins and sticks in what it hits | Wood |
| Greatsword | Wide sweeping slash, long reach | Lunge | Unlimited | No |
| War hammer | Slow overhead smash, huge knockback | Wind up a ground-pound shockwave | Unlimited | Yes, the block it strikes |
| Blunderbuss | 7-pellet spread, big recoil that can launch you | - | 4 shots | Glass |
| Rocket launcher | Rocket that explodes on contact | - | 3 rockets | Yes, 2.4 m blast |
| Bombs | Lob a fused bomb; it bounces and blows after 2 s | Longer hold = longer throw | 3 bombs | Yes, 3 m blast |
| Web gun | Sticky glob: a fighter hit is stuck to the nearest surface for 1.5 s; loose blocks are glued in place | Fire a web line that anchors to terrain; you swing on it and reel in until release | 8 globs | No |
| Tractor beam | - | Grab the first body along the aim (block, prop, corpse or fighter) and drag it on the beam; release flings it | 6 s of beam | No, but flung blocks smash |
| Portal gun | First shot opens the orange portal on the surface it hits, second the blue; anything entering one leaves the other with its speed turned to the new surface | - | Portals last the round | No |
| Serpent horn | Blow it: a stone serpent bursts from the ground near the closest enemy, arcs through the arena chewing blocks and flinging fighters, then dives | - | 1 use | Yes, along its path |
| Jetpack (worn) | Hold Jump in the air to thrust along the stick | - | 4 s of fuel, refills slowly on the ground | No |
| Bare hands | Punch | Grab a ledge or a body you touch, while held | - | No |

**Item drops.** At the start of a round 2 to 3 items sit on the level's item pads. Every 6 to 9 s a new one falls in from above on a small 3D rune crate that breaks on landing. At most 8 items lie in the world at once. Spent items vanish; dropped and thrown ones stay.

**Throwing.** Stick down + Action throws any held item along the aim at 18 m/s. A thrown item hits for 12 damage plus its weight; the axe and sword hit for 30 and stick in terrain.

**The serpent** is the one summoned monster: a chain of 18 carved stone segments that follows a smooth arc chosen when summoned (rising out of the ground, peaking over the target, diving back in). It is kinematic: it pushes everything aside and destroys every non-bedrock block it passes through, so it reshapes the level. It never hurts the one who summoned it.

**Left out on purpose:** guns that are just reskins of each other, shields, healing, and anything that needs a third button.

## Matches and rounds

There is one mode, Brawl: rounds of last fighter standing, first to 5 round wins takes the match (3, 5, 7 or 10 in the match options). Every round is a new level.

**Round flow**

1. **Drop-in (2.5 s).** The level builds, fighters fall onto their spawn points, the camera settles. Big angular round number. The music plays its intro riff.
2. **Fight.** Items start falling. No time limit until 90 s; after that the Ragnarök phase begins: the kill line rises 1 m every 3 s (the abyss, lava or sea climbs), forcing the end.
3. **Final kill.** When one fighter is left, the host drops the simulation to 25% speed for 1.2 s around the killing blow, the camera pushes in on it, and the music lands its biggest hit.
4. **Round end (3 s).** The winner's colour floods the edge of the screen, the score slabs slide in, and the next level code is shown. A draw (everyone dead within 0.5 s) gives no point.

**Match end.** The champion is shown on a tall slab with the round tally; Rematch, New fighters and Leave. In a room, Rematch needs everyone to press Ready again, as in Hoverline.

**Levels in a match.** Each round's level comes from a playlist: random codes in the ticked settings (default), one fixed code, or a saved list from the editor. Every device shows the code so a good level can be saved.

**Match options:** rounds to win, items (all, melee only, no summons, or a picked set), item drop rate, AI fighters (0 to 7) and their skill, Ragnarök on or off.

## Seeded levels

Every level is built from a short level code, as Hoverline builds tracks: the same code builds the same level on every device, block for block.

**Code format.** 8 characters of Crockford base32, for example `F7K2Q9XM`. The first character is the setting (B Bunker, F Forge, J Fjord, H Hall), the other 7 are a 35-bit seed. Codes are case-insensitive and ignore 0/O and 1/I confusion. A custom level adds a dot and its edits (next section).

**Settings.** One setting per level, never mixed, each with its own materials, light, backdrop and kill line:

| Setting | Built from | Below the floor | Light and air |
| --- | --- | --- | --- |
| Bunker | Raw concrete, steel beams, glass | Foggy abyss | Cold floodlights from above, drifting dust |
| Forge | Basalt, iron plates, chains | Lava sea | Orange light from below, embers rising |
| Fjord | Grey rock, ice, a few timbers | Black sea | Aurora and moon, falling snow |
| Hall | Timber, stone hearths, iron fittings | Misty gorge | Firelight from braziers, smoke haze |

**How a level is built (in order, all from one seeded random stream)**

1. **Archetype.** Islands, Towers, Pit, Cavern or Span, weighted by setting (Forge favours Islands and Span over the lava, Hall favours Towers).
2. **Bedrock.** 2 to 4 unbreakable anchors: pillars rising from below, or ledges from the sides.
3. **Mass.** Solid shapes from noise and stamps (slabs, arches, stairs, overhangs) grown off the anchors, so every block starts connected to bedrock.
4. **Symmetry.** 70% of levels are mirrored left to right for fairness, then 10% of cells are perturbed so they don't feel copy-pasted.
5. **Carve.** Tunnels and gaps cut through the mass so every region is reachable with a jump of 2.4 m up and 4 m across.
6. **Materials.** Filled by setting: a skin of the setting's main material, with wood, glass or ice features where they make good weak points.
7. **Spawns.** 8 standing spots on open top surfaces, spread by farthest-point sampling, each with 2.2 m of headroom.
8. **Item pads and props.** 3 or 4 item pads on reachable spots; props from the setting's list.
9. **Check.** At least 35% of the arena open, all spawns reachable from each other, no spawn sealed in. A level that fails takes the next seed variant (seed + 1), at most 8 tries; this happens the same way on every device.

**Sizes.** The arena stays one size; archetypes vary how much of it is solid (about 600 to 900 blocks before merging).

## Level editor and custom codes

The editor always starts from a seed and saves your changes on top of it, so an untouched level keeps its short code and an edited one grows a little with each change.

**Working in the editor.** The arena is shown in full 3D, exactly as it plays, with a faint 1 m grid on the plane. A cursor cell follows the finger, the mouse or the stick.

| Tool | What it does |
| --- | --- |
| Seed | New seed, or type a code; pick the setting and archetype |
| Paint | Place a block of the chosen material (drag paints a line) |
| Erase | Remove blocks (bedrock included) |
| Bedrock | Mark cells as anchors |
| Prop | Place a crate, barrel, boulder, plank, chain or lantern |
| Spawn | Place or move the 8 spawn points |
| Item pad | Place up to 6 pads; optionally lock a pad to one item |
| Mirror | Mirror every edit to the other half while on |
| Test | Play the level at once with 3 AI fighters; Back returns to the editor |

Undo and redo keep 100 steps. Brush sizes 1, 2 and 3. On a gamepad: stick moves the cursor, Action paints, Jump erases, shoulder buttons change tool.

**Custom code.** `seed code` + `.` + the edit list: each edit is a cell index (11 bits) and what it became (4 bits), or a prop, spawn or pad placed (with its kind), packed into bits, deflated, and written in base32. A few dozen edits make a code of roughly 30 to 60 characters; a heavy rebuild can run to a few hundred. Codes copy as text, share as a QR code (as Hoverline's Wi-Fi pairing does), and paste back in.

**Saving.** Saved levels live in the browser with a name, and can be added to a match playlist. Load, rename, duplicate, delete. A level only saves if it passes the generator's check (reachable spawns, enough open space); otherwise the editor marks the problem cells in red.

## Graphics

The goal is a scene that looks like a lit diorama: heavy, tactile blocks under dramatic light, bright fighters, and a deep 3D world falling away behind. Everything in play is a lit 3D mesh. No sprites, no billboards, no flat images, no 2D canvas drawing in the game view.

**Camera.** A perspective camera (32 degree field of view) looks at the plane from about 40 m away, 6 degrees down, so block tops and sides both show. It frames every living fighter with a margin, never zooms closer than 14 m of visible width or wider than the whole arena, and eases with a critically damped spring. Shake on blasts (scaled by distance), a push-in on the final kill. The framing is the same on every device.

**Blocks.** Instanced, chamfered boxes (2 m deep, 4 cm bevel to catch the light) with physically based materials. Surfaces get procedural detail generated at load from noise, not image files: concrete pores and form-tie holes, wood grain, iron rust and rivets, ice with internal cracks, runes cut into a few stones. Damage shows as darkened, cracked faces before a block breaks.

**Light.** One key light per setting with soft shadows (a single 2048 shadow map fitted tightly to the arena), plus image-based light from an HDRI (Poly Haven, CC0) for reflections and fill. Each setting adds its own practical lights: floodlights, lava glow from below, braziers, aurora. Emissive surfaces (lava, embers, fighter cores, runes) feed bloom.

**Backdrop.** Three 3D depth layers built from the same seed: near ruins and set pieces just behind the plane, a middle band (cliffs, fjord walls, forge chimneys, hall pillars), and a far horizon of mountains or structures, all fading into the setting's fog. Moving life in 3D: drifting snow and embers, dust in light shafts, a slow aurora.

**Effects, all 3D:** explosions are expanding fireball meshes with shader noise, then lit smoke puffs (low-poly icosahedrons that swell and dissolve with a dithered fade); sparks are short stretched glowing capsules; hits on fighters burst into small bright shards of the fighter's colour (no blood); block breaks throw real chunks; lava and sea are animated 3D surfaces with splashes of meshes; portals are rings of glowing geometry with a swirling depth shader; the tractor beam and web line are 3D tubes.

**Post-processing** (pmndrs postprocessing): ambient occlusion (N8AO), mipmap bloom, AgX tone mapping, SMAA, a subtle vignette, colour grade per setting, and chromatic aberration only for a few frames on big hits.

**Fighter readability.** Fighters stay readable above everything: a thin dark outline shell around each limb, the emissive core, and a small 3D chevron in the fighter's colour floating above the head for the local player only. Health shows as the fighter's colour dimming.

## Music engine

A new engine plays an instrumental metal band live in the browser: real recorded drums, guitars through a modelled amp, bass, orchestra and folk instruments, arranged on the fly and pushed toward a crescendo by the fight itself. There are no vocals, no choir and no hum: the only sound under the fight is music and the fight's own effects.

**Borrowed from Hoverline:** one tune per match that changes by steps and is never swapped mid-match; sections that build and drop; samples measured and resampled onto the semitone and level-matched; a memory of the last 16 tunes so a new match picks the least familiar of 12 candidates; the anti-clown rules (a new sound takes over a part rather than stacking; no novelty call-and-response; busy leads in at most half the tunes). Everyone in a room hears the same tune, because the match seed picks it.

**The band**

| Part | Source | Role |
| --- | --- | --- |
| Drums | Multi-velocity acoustic kit (kick, snare, 3 toms, hats, 2 crashes, china, ride, splash) | Beats, fills, blasts, gallops; velocity layers plus seeded round-robin |
| Rhythm guitars | DI electric guitar samples (open and palm-muted) into the amp model | Riffs and chugs, double-tracked hard left and right |
| Lead guitar | Same DI samples, lighter gain, delay and reverb | Hooks and harmonised lines in thirds, vibrato and slides |
| Bass | Picked electric bass, light drive | Locks to the kick and the riff's roots |
| Orchestra | Strings (sustain, staccato), brass (horns, trombones, tuba), timpani | Pads and ostinatos in power metal, stabs and swells in battle metal |
| Folk | Fiddle, whistle, bagpipe drone, frame drum, war drums, horn calls | The hook and colour in viking metal, at most one featured at a time |

**Amp model.** High-pass at 90 Hz, pre-gain, two asymmetric soft-clip stages (4x oversampled) with a mid-scooped tone stack between them, then a 4x12-style cabinet made from a generated impulse response (80 Hz to 5.5 kHz with a low thump and a presence bump). Each rhythm track has its own amp, timing (4 to 9 ms apart) and sample choice, so the double-track sounds wide, not chorused. Power chords are root, fifth and octave summed into the amp, so they distort together as real ones do.

**Styles** (the match seed picks one; the player can prefer one in Music options)

| Style | Tempo | Harmony | Signature |
| --- | --- | --- | --- |
| Power metal | 160 to 190 bpm | Major or harmonic minor | Gallops and double kick, string pads, soaring harmonised lead, key change up a tone at the peak |
| Battle metal | 140 to 165 bpm | Natural minor | Brass stabs on the accents, string ostinato, timpani rolls, blast beats at the peak |
| Viking metal | 100 to 140 bpm, some in 12/8 | Aeolian or dorian | Stomping toms and war drums, tremolo picking, folk hook on fiddle or whistle, horn calls into builds |

**A tune** is: style, key, tempo, mode, three chord progressions (verse, chorus, bridge), a 2-bar main riff, a 4-bar hook, a drum feel and an instrument palette (which folk or orchestral voice features). It is built from music theory rules and pattern libraries, all from the seed.

**Intensity.** The game feeds events in; the engine keeps one number from 0 to 1.

| Event | Adds |
| --- | --- |
| Hit landed | 0.04 (heavy 0.08) |
| Explosion | 0.12 |
| Kill | 0.25 |
| Serpent summoned | 0.30 |
| Blocks broken | 0.01 each, at most 0.1 a second |

It decays toward a floor with a 6 s time constant. The floor rises as the round tightens: fighters close together (pairs within 6 m) lift it, 3 left sets it to at least 0.45, 2 left to 0.65, and the Ragnarök phase to 0.8.

**The ladder.** Five levels, each a fuller arrangement (drawn in the diagram below):

1. **Prowl** (under 0.15): muted chugs on the root or a clean arpeggio, war drum or kick pulse, a low string pad. No cymbals.
2. **Riff** (0.15 to 0.4): the main riff, double-tracked guitars, bass, half-time beat.
3. **Charge** (0.4 to 0.65): full beat, riff variations, crash accents, the orchestra or folk layer enters.
4. **Battle** (0.65 to 0.85): the chorus: lead hook, double kick, full orchestra.
5. **Crescendo** (over 0.85): everything, with the style's peak device (key change, blast beats, or war drums), cymbal swells, the lead harmonised.

&#91;embedded content: intensity ladder · 5 rungs\]

Each rung keeps the same riff and hook and adds parts; only the Crescendo brings the style's peak device.

Changes happen only on bar lines. Going up more than one level inserts a one-bar build (tom fill, snare roll, cymbal swell, strings crescendo) that lands on beat 1 with a crash and a bass hit. Going down needs 4 bars at the current level, then drops one level per 2 bars through a fill. The same riff and hook carry through every level, so the music builds rather than changes song.

**Moments.** Round start: four stick clicks, then Prowl or Riff. Final kill: the band stops dead on the blow with one huge hit (kick, crash, low chord, timpani) that rings through the slow motion. Round end: a 2-bar cadence. Match end: a held final chord over a drum roll and a last hit. Menus: the match tune's Prowl and Riff at lower volume, with a small player (Next, and Viking, Battle or Power).

**Mix.** Peak levels near -16 dB RMS, quiet levels near -26 dB, a limiter on the master with peaks under -1 dBFS. Kick ducks the bass lightly. A Simple music setting runs one amp, fewer drum layers and no orchestra for low-end devices.

**Interface** (the game only ever calls these): `init(ctx, bank)`, `setTune(seed)`, `start('menu' or 'match')`, `roundStart()`, `event(kind, weight)`, `tension({alive, closePairs, ragnarok})`, `finalKill()`, `roundEnd(won)`, `matchEnd()`, `stop()`, `state()`.

## Sound effects

Effects are short real recordings (CC0), trimmed, normalised and level-matched to the music as Hoverline does, with synthesis only as a fallback while samples decode. There are no loops or beds under the fight: no engine hum, wind or ambience tracks.

| Group | Sounds |
| --- | --- |
| Fighters | Punch impacts (3 weights), body thuds, landing, footstep scuffs (quiet), jump, death crack |
| Blades and blunt | Axe chop, sword swing and slash, hammer smash, blade sticking in wood and stone |
| Guns and blasts | Blunderbuss boom, rocket launch and flight, explosion (3 sizes), bomb fuse and bounce |
| Strange items | Web glob splat and line twang, tractor beam on and release, portal open and pass-through, serpent rumble and roar of stone, jetpack burst |
| Terrain | Break sounds per material (stone, wood, iron ring, ice, glass), slab collapse rumble, debris tinkle |
| Kill line | Lava hiss, sea splash, abyss falling whoosh |
| UI | Hard clicks and clunks for focus, confirm, back, ready, deny |

Each play varies pitch by up to 6% and level by 2 dB. Any one sound plays at most every 50 ms; terrain breaks at most 6 at once. Effects are panned by screen position and get quieter with distance from the camera's centre.

## Multiplayer and netcode

Rooms of up to 8 players, each on their own device, using Hoverline's transport and lobby unchanged in spirit; the game protocol on top is new and host-authoritative, because ragdoll physics can't be run in lockstep across browsers.

**Transport (from Hoverline's multiplayer kit).** The same four carriers behind one interface, with a new app id so rooms of the two games never meet:

| Carrier | When | Path |
| --- | --- | --- |
| Internet | Default on itch.io | Two public MQTT brokers over secure WebSocket, plus a direct WebRTC channel where the network allows; duplicates dropped |
| Wi-Fi, no internet | Same Wi-Fi, no internet | Phones pair by swapping QR codes, WebRTC data channels, host relays |
| Wi-Fi host pack | Optional small Python server | Server-sent events and posts to the host machine |
| Local tabs | Tests only (`?mp=local`) | BroadcastChannel |

Unlike Hoverline, the direct WebRTC path is switched on for the internet carrier (Trystero, MIT, with its MQTT signalling), because a fighter needs inputs faster than the brokers' 8 messages a second. When only the brokers get through, the game still plays, with more lag, and the lobby says so.

**Lobby (from Hoverline).** 5-letter room code, roster with names and colours, every player presses Ready and the match starts when all are ready; Ready pings anyone who isn't. Start messages repeat so one lost message can't strand anyone. Reconnect rejoins the same room. The host sets the match options and the playlist; AI fighters fill the empty slots if the host wants them.

**Game protocol**

- **Static level, sent as a code.** Every device builds the level from its code, so the terrain is never sent: only the ids of blocks destroyed and the bodies that move.
- **Inputs up (client to host).** Stick x and y as signed bytes, a buttons byte, and press counters for Jump and Action so a tap is never lost even if a packet is. 30 a second on the direct path, the newest one only on the broker path.
- **Snapshots down (host to all).** 20 a second direct, 8 on brokers: the tick, every fighter's 10 parts (x, y, angle as 16-bit integers), health and held item, and every awake dynamic body. Packed as binary, sent as base64 in the kit's JSON envelope (about 1 to 2 KB).
- **Events down, in order.** Block breaks, slab collapses, explosions, item spawns and pickups, portal placement, kills and round changes go through the kit's sequenced messages, so none are lost. Each device makes its own particles and sounds from them, and feeds its own music engine.
- **Clients interpolate** 100 ms behind on the direct path and 250 ms on brokers. The local fighter's aiming arm follows the local stick at once (a visual override), so aiming feels immediate while the body stays authoritative.
- **The host runs the AI** and the physics. If the host leaves, the round ends, everyone returns to the lobby and the next player becomes host, as in Hoverline.

**Trust.** No anti-cheat beyond the host deciding everything; these are rooms of friends.

## AI fighters

AI fighters press the same stick and two buttons as a player, through the same input path, so they obey the same physics and can't do anything a human can't.

**How they think (10 times a second)**

1. **Read the level.** A navigation grid is built from the blocks: standable cells, and links between them for walking, dropping and jumping (tested against jump height 2.4 m and reach 4 m). It is rebuilt locally whenever blocks break.
2. **Pick a goal.** Score each option: the nearest good item if unarmed, an enemy (closest, weakest, or whoever hit it last), or safety (away from the kill line, out of a falling slab's path, away from a lit bomb).
3. **Move.** Follow the grid path with the stick; jump at jump links; fast-fall to drop. Rapid replanning if knocked off course.
4. **Fight.** Each item has an AI recipe: melee closes in and swings when in reach; guns lead the target by distance over projectile speed; bombs are lobbed with a ballistic solve; the tractor beam grabs the nearest loose block and flings it at an enemy; portals go on a wall behind an enemy and under a ledge; the serpent horn is blown when enemies are clustered.
5. **Survive.** Recover toward ground when airborne over the kill line, jetpack if wearing one, and avoid standing on blocks that are about to fall.

**Skill** (match option): Thrall, Warrior and Berserker. Lower skill adds reaction delay (350, 200, 90 ms), aim error (14, 7, 2 degrees), and worse item choices. Each AI gets a seeded temperament (aggressive, cautious, collector) so 7 bots don't move as one.

**Checks.** A headless sim plays 200 rounds of 8 AI on random levels before release: no round should exceed 3 minutes, every item should get kills, and no level should leave a bot stuck for 10 s or more.

## Menus and UI

The UI is brutalist and angular: flat slabs, hard edges, heavy condensed type, straight-line icons, and not one rounded corner or circle anywhere. It sits over a live 3D scene, so the menus feel like part of the world rather than a page in front of it.

**Visual rules**

- **Shape.** No border-radius, ever. Buttons are slabs with one corner cut at 45 degrees (clip-path), panels are full-height bars that hang from the top edge or stand on the bottom. Rules are solid 2 px lines.
- **Colour.** Near-black `#0C0C0B` and bone `#E8E2D4`, plus one hot accent taken from the current setting (Bunker hazard yellow, Forge ember orange, Fjord glacier cyan, Hall blood red). The accent only marks what matters: focus, the local player, the winner.
- **Type.** A heavy condensed display face in uppercase for titles and buttons (Anton, OFL), a monospace for labels, codes and numbers (JetBrains Mono, OFL). Both bundled, no web font calls. Big numerals: the round number fills a third of the screen height.
- **Icons.** Drawn from straight segments with mitred joins: item silhouettes, chevrons, crosses, bars. Ammo is a row of parallelograms, health a cut bar.
- **Focus.** The focused control inverts to an accent slab with a hard 6 px offset shadow (no blur) and its index number turns black. Entries carry index numbers (01 FIGHT, 02 EDITOR, 03 OPTIONS).
- **Motion.** Hard cuts and short 120 ms slides along one axis. No bounce, no fades longer than 150 ms.
- **Behind the menus.** A live AI brawl on a random level in the menu's setting, with the camera drifting slowly. The title stamps the game's name across it in the display face, 2 px rule underneath.

**Menu map (Hoverline's principles: few choices per page, the most used first)**

- **Title:** Fight, Editor, Options, and a small music player (style, Next, what's playing).
- **Fight:** Versus AI, Multiplayer, Fighter (name and colour), Levels (playlist and codes). Versus AI and Multiplayer both lead to the match page: options on the left, the level playlist on the right with a live 3D preview, Start at the bottom right.
- **Multiplayer:** Create room, Join by code, Wi-Fi with no internet; then the lobby: the roster as 8 tall slabs in fighter colours, Ready, the host's options, Reconnect.
- **Options** (from the title, the pause menu and the lobby): Music, Sound, Graphics, Controls, Accessibility.
- **Pause:** Resume, Options, Leave (Leave asks once).

**Hoverline rules kept.** Every page works with touch, a gamepad or keys; B or Escape is always Back. Focus remembers its place when a page is rebuilt or revisited. Layout checked at phone (both ways round), tablet, Steam Deck (1280 x 800) and desktop up to 2560 wide.

**HUD in a fight: cues, not words.** Along the top, one angular tick strip per fighter in their colour showing round wins. Bottom left, the local fighter's held item icon and ammo parallelograms (jetpack fuel as a second bar when worn). Touch controls drawn as thin bone outlines that fill when pressed. Text appears only between rounds.

## Options and performance

The default look must run smoothly on a Galaxy S22, and one tap must make it run on the Doogee tablet. As in Hoverline, the look is a style choice and never changes the fight.

| Look | What's on | For |
| --- | --- | --- |
| Lite | Shadows from the key light only, no post-processing, near backdrop only, half the particles | Older phones and tablets |
| Clean (default) | Soft shadows, bloom, SMAA, tone mapping, all three backdrop layers, full particles | Phones like the S22, Steam Deck |
| Everything | Clean plus ambient occlusion, higher shadow resolution, denser weather and embers, light shafts | Gaming PCs |

Every part can also be toggled alone. Resolution is a slider from 25% to 100% (Hoverline's Ultra low starts at 25%), and an FPS counter can be shown. On first launch the game times its first 120 frames and drops one tier if it averages under 50 fps, and says so once.

**Other options**

- **Music:** volume, style preference (Any, Viking, Battle, Power), Simple music.
- **Sound:** effects volume, master volume.
- **Controls:** touch pad size and side, button size, haptics, stick dead zone, gamepad and key bindings shown.
- **Accessibility:** screen shake (off, low, full), hit flashes and chromatic aberration off, slow-motion final kill off.

**Budgets on the S22, Clean look:** 60 fps target; under 200 draw calls (blocks, debris and particles instanced); one shadow map; post-processing at most 4 full-screen passes; physics step under 5 ms on the host.

## Code architecture and build

The game is split into a simulation that only the host runs and a view that every device runs, and a single-player match is simply a room of one: the view always draws from snapshots and events, so multiplayer can't drift from single player.

**Repository layout**

| Path | Holds |
| --- | --- |
| `src/sim/` | Rapier world, fighters (ragdoll, balance, damage), terrain blocks and anchoring, items, projectiles, the serpent, round rules. Emits snapshots and events |
| `src/level/` | Settings, the seeded generator, level codes and the custom-code codec, the navigation grid |
| `src/ai/` | AI fighters: planner, item recipes, skill |
| `src/view/` | Three.js scene, camera, materials and procedural textures, instanced blocks, fighter meshes, backdrops, 3D particles, post-processing |
| `src/audio/` | The music engine (`music/`) and effects player |
| `src/net/` | Hoverline's transport kit, the room session and lobby, snapshot packing |
| `src/ui/` | Menus, HUD, touch pad and buttons, gamepad and keys, the editor's UI |
| `assets/` | Audio samples, HDRIs, fonts |
| `tools/` | `build.mjs` (bundle and zips), the sample pipeline, the headless bot sim, the cover renderer |
| `docs/` | This guide as `DESIGN.md`, `CLAUDE-NOTES.md` for later sessions |

**Libraries** (npm, bundled into the game, no runtime CDN calls): `three` (MIT), `@dimforge/rapier2d-compat` (Apache-2.0), `postprocessing` and `n8ao` (MIT, Zlib), `trystero` (MIT), `fflate` (MIT).

**Rules**

- Fixed 60 Hz simulation step; rendering interpolates between steps.
- One seeded random generator (sfc32) for anything that must match across devices: levels, item drops, the tune. `Math.random` only for cosmetics.
- The sim never touches Three.js or the DOM; the view never changes the sim.
- Every input goes through one function that reduces it to stick x, stick y and buttons.
- Test hooks only through URL parameters (`?bot=1`, `?mp=local`, `?render=0`, `?seed=`), never left in builds as globals.

**Build.** `npm run build` bundles with esbuild into `dist/web/` (one `game.js`, `index.html`, `assets/`), then writes `dist/splinterhall-itch.zip` and `dist/splinterhall-source.zip`. The repo is not pushed anywhere; Eric uploads it to GitHub himself.

## Deliverables and testing

Each build hands over three files, and nothing ships until it has passed the checks below.

| File | What it is |
| --- | --- |
| `splinterhall-itch.zip` | Upload to itch.io as an HTML game (index.html at the zip root). Embed at 1280 x 720, landscape, with fullscreen and mobile-friendly ticked |
| `splinterhall-cover.png` | itch.io cover, 630 x 500: a real render from the game with the title set in the display face |
| `splinterhall-source.zip` | The whole repository without `node_modules` or `dist`, ready for Eric to push to GitHub himself |

**Checks before a handover**

1. Syntax and bundle: the build passes, the bundle loads with no console errors.
2. Bot matches: the headless sim (`?bot=1&render=0`) plays 200 rounds of 8 AI on random codes in every setting. No crash, no round over 3 minutes, no stuck bot.
3. Levels: 2,000 random codes build identically twice (same block hash), and every one passes the level check.
4. Multiplayer: two and four tabs with `?mp=local` play a full match; snapshots and events keep the views in step; a client that leaves and reconnects rejoins.
5. Music: a full match rendered offline in each style; section loudness, no clipping, and the ladder climbs and falls with the action. A short preview is sent to listen to.
6. Screens: screenshots at phone landscape and portrait, tablet, Steam Deck (1280 x 800) and desktop (1920 x 1080 and 2560 x 1440), menus and fights, each look.
7. Frame time on SwiftShader as a rough guide, then the real check is on Eric's S22, Doogee tablet and Steam Deck.

**Versioning.** Builds are numbered Prototype 1, 2, 3 as Hoverline's are, shown on the title screen, with a line per build in `CHANGELOG.md`.

## Credits and licences

Every asset is public domain (CC0) or under a licence that only asks for credit; nothing share-alike, nothing with a non-commercial clause. The in-game Credits page and `CREDITS.md` list each one.

| Source | Licence | Used for |
| --- | --- | --- |
| [VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE) | CC0 | Strings, brass, timpani, orchestral percussion |
| [Versilian Community Sample Library](https://github.com/sgossner/VCSL) | CC0 | Folk and world instruments, frame drum, extra drum and cymbal layers |
| [Sonic Pi sample pack](https://github.com/sonic-pi-net/sonic-pi/tree/dev/etc/samples) (freesound.org recordings) | CC0 | The core acoustic drum kit in hard and soft layers |
| [FluidR3 GM soundfont, rendered by MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | CC BY 3.0 (credit Frank Wen and Benjamin Gleitzman) | Electric guitar (clean and muted) and electric bass DI notes, fiddle, bagpipe |
| Kenney sound packs and rubberduck's packs on OpenGameArt, as trimmed for Hoverline | CC0 | Impacts, blasts and UI sounds |
| Poly Haven HDRIs (via the three.js examples) | CC0 | Image-based light and reflections |
| Anton, JetBrains Mono | SIL Open Font License | UI type |
| three, Rapier, postprocessing, N8AO, Trystero, fflate | MIT, Apache-2.0, Zlib | Code libraries |

CC BY items carry their credit line on the Credits page and in the itch.io description.
