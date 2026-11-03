# Sound effects: credits and licences

Every recording used here is public domain under **CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/). No credit is required; it is given anyway. Nothing is CC BY, share-alike or non-commercial.

The 83 files are new mixes: cuts from the recordings below, trimmed, faded, filtered, re-pitched, layered, level-matched and encoded as mono MP3 by `tools/sfx/build_sfx.py` (sources fetched at pinned commits by `tools/sfx/fetch_sources.sh`). Two effects add a tiny synthesized sine "sub" under recorded booms (`explosion_small`, `explosion_big`); everything else is recordings only.

## Sources

| Key | Source | Licence | Where it was fetched from (pinned commit) |
| --- | --- | --- | --- |
| Kenney Impact | **Impact Sounds** by Kenney (kenney.nl) | CC0 | [Boyquotes/kenney-impact-sounds-for-godot](https://github.com/Boyquotes/kenney-impact-sounds-for-godot) `999dd16`, LICENSE = CC0 1.0 |
| Kenney Sci-Fi | **Sci-Fi Sounds** by Kenney | CC0 | [Boyquotes/kenney-sci-fi-sounds-for-godot](https://github.com/Boyquotes/kenney-sci-fi-sounds-for-godot) `c094967`, LICENSE = CC0 1.0 |
| Kenney Interface | **Interface Sounds** by Kenney | CC0 | [Calinou/kenney-interface-sounds](https://github.com/Calinou/kenney-interface-sounds) `4596a49`, Kenney's LICENSE.txt: "Creative Commons Zero, CC0" |
| Kenney RPG | **RPG Audio** by Kenney | CC0 | [Boyquotes/kenney-rpg-audio-for-godot](https://github.com/Boyquotes/kenney-rpg-audio-for-godot) `22eb79b`, LICENSE = CC0 1.0 |
| rubberduck | rubberduck's CC0 packs on OpenGameArt ([rubberduck](https://opengameart.org/users/rubberduck)), as mirrored in Free-SFX's `rubberduck/` folders: `BreakingFalling` = [75 CC0 breaking / falling / hit sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) (licence field "CC0", author rubberduck); `SFX100` = [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx); `SFX100V2` = [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2); `WoodMetal` = [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx); `WaterSplashSlime` = [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) (the folder's source note); `Bang` = 25 CC0 bang / firework SFX (as named in Hoverline's credits); `RPG` = rubberduck's 80-file CC0 RPG pack | CC0 | [EternityForest/Free-SFX](https://github.com/EternityForest/Free-SFX) `f2fe533` (`rubberduck/`), repo LICENSE = CC0 1.0 |
| qubodup | Swooshes by **qubodup** (Iwan Gabovitch), OpenGameArt | CC0 / public domain ("Free for *any* use ... public domain ... cc0") | EternityForest/Free-SFX `qubodup/Swooshes/` (licence note `swoosh.txt` in that folder) |
| Superpowers | **Superpowers asset packs** (Western FPS 2D) by Sparklin Labs / Pixel-boy | CC0 | EternityForest/Free-SFX `Superpowers/` (LICENSE.txt = CC0 1.0; upstream [sparklinlabs/superpowers-asset-packs](https://github.com/sparklinlabs/superpowers-asset-packs)) |
| Electricity | [Electricity game sound pack](https://opengameart.org/content/electricity-game-sound-pack) by faxcorp, OpenGameArt | CC0 (licence field "CC0" on OpenGameArt) | EternityForest/Free-SFX `Electricity/` |
| Sonic Pi | **Sonic Pi sample pack** (freesound.org recordings, see its README for each original) | CC0 | [sonic-pi-net/sonic-pi](https://github.com/sonic-pi-net/sonic-pi) branch `dev`, `df6f17e`, `etc/samples/` (LICENSE.md: "All the bundled samples are ... CC0") |
| VCSL | **Versilian Community Sample Library** by Sam Gossner / Versilian Studios | CC0 | [sgossner/VCSL](https://github.com/sgossner/VCSL) `c1ea7bc` (sparse: Anvil, Brake Drum, Slapstick, Bass Drum 1, Timpani 1) |
| Hoverline | Eric's earlier game Hoverline: three of its 34 trimmed CC0 effects (`missile`, `barrier`, `phase`), themselves from Kenney's packs, rubberduck's packs and Sonic Pi (Hoverline README, Credits) | CC0 | extracted from `SL.SFX` in `hoverline/src/hoverline.html` by `tools/sfx/extract_hoverline.py` |

Sonic Pi originals used (freesound.org, CC0): `drum_heavy_kick` (Zajo, #4832), `drum_cymbal_hard` (menegass, #100056), `elec_twang` (looppool, #13136), `ambi_dark_woosh` (EcoDTR, #27281).

## What each effect is made of

| Effect | Files | Made from |
| --- | --- | --- |
| punch_light | 3 | Kenney Impact punch_medium + VCSL slapstick crack + Kenney RPG cloth |
| punch_mid | 3 | Kenney Impact punch_medium/heavy + Sonic Pi drum_heavy_kick + VCSL slapstick + Kenney RPG chop |
| punch_heavy | 3 | Kenney Impact punch_heavy + Sonic Pi drum_heavy_kick + Kenney RPG chop / rubberduck wood_hit + VCSL slapstick |
| thud | 3 | Kenney Impact soft_heavy + generic_light |
| land | 2 | Kenney Impact soft_medium + Kenney RPG footstep |
| step | 3 | Kenney RPG footsteps (high-passed, quiet scuffs) |
| jump | 1 | qubodup swoosh + Kenney RPG footstep |
| death | 1 | rubberduck wood_cracking (the crack) + Kenney Impact punch_heavy + soft_heavy (the drop) + Sonic Pi kick |
| axe_chop | 2 | Kenney RPG chop + Kenney Impact wood_heavy + qubodup swoosh |
| sword_swing | 3 | qubodup swooshes |
| sword_slash | 2 | qubodup swoosh + rubberduck RPG blade + Kenney RPG knife_slice |
| hammer_smash | 2 | Kenney Impact mining + VCSL anvil + VCSL bass drum + rubberduck stones |
| blade_stick | 2 | Kenney Impact plank_medium + Kenney RPG metal_latch + rubberduck metal_spring |
| throw | 2 | qubodup swooshes |
| pickup | 1 | Kenney RPG metal_latch + belt_handle + Kenney Impact generic_light |
| blunderbuss | 1 | Superpowers gun-4 + rubberduck cannon_02 + Sonic Pi kick + Kenney RPG metal_latch |
| rocket_launch | 1 | Sonic Pi kick + Hoverline missile + rubberduck air burst |
| rocket_flight | 1 | rubberduck air (pitch-swept fly-by) + Kenney Sci-Fi thruster_fire |
| explosion_small | 2 | rubberduck bang + Kenney Sci-Fi low_frequency_explosion + sine sub |
| explosion_mid | 2 | Superpowers explosion + rubberduck bang + Kenney Sci-Fi low_frequency_explosion + rubberduck rock_falling |
| explosion_big | 1 | Kenney Sci-Fi low_frequency_explosion + Superpowers explosion-3 + rubberduck cannon_02 crack + Kenney Sci-Fi explosion_crunch + rubberduck rock_breaking debris tail + sine sub |
| bomb_fuse | 1 | rubberduck spell_fire + firework crackle (fw_03) |
| bomb_bounce | 2 | Kenney Impact metal_heavy + wood_heavy |
| web_splat | 2 | rubberduck slime + Kenney Impact soft_medium |
| web_line | 1 | Sonic Pi elec_twang + rubberduck spring + qubodup swoosh |
| tractor_on | 1 | Kenney Sci-Fi force_field + Hoverline barrier |
| tractor_off | 1 | Electricity powerdown + qubodup swoosh |
| portal_open | 1 | Electricity teleport + Sonic Pi ambi_dark_woosh + Kenney Sci-Fi force_field |
| portal_pass | 1 | Hoverline phase + qubodup swoosh |
| serpent_rise | 1 | rubberduck rock_breaking + Kenney Sci-Fi low_frequency_explosion + explosion_crunch (grind) + rubberduck creature_roar (slowed, "roar of stone") + rubberduck stones |
| serpent_crunch | 2 | Kenney Impact mining + rubberduck stones + rock_breaking |
| jetpack | 1 | Kenney Sci-Fi thruster_fire (one burst) + rubberduck air |
| break_stone | 3 | Kenney Impact mining (thump) + rubberduck stones (crunch) + Kenney Impact footstep_concrete + rubberduck rock_falling (grit) |
| break_wood | 2 | rubberduck wood_breaking (both packs) + Kenney Impact wood_heavy |
| break_iron | 2 | Kenney Impact plate_heavy + VCSL brake drum (the ring) + rubberduck metal_falling |
| break_ice | 2 | rubberduck glass_breaking (lowered) + wood_cracking + Kenney Impact mining |
| break_glass | 2 | rubberduck glass_breaking + Kenney Impact glass_heavy |
| collapse | 1 | rubberduck rock_breaking + Kenney Sci-Fi low_frequency_explosion + explosion_crunch + Kenney Impact mining + rubberduck rock_falling |
| debris | 3 | rubberduck rock_falling (high-passed tinkle) |
| crate_land | 2 | rubberduck wood_slam + Kenney Impact wood_heavy |
| lava_hiss | 1 | rubberduck air (steam) + spell_fire (crackle) + slime |
| splash | 2 | rubberduck splash + Kenney Impact soft_heavy |
| fall_whoosh | 1 | Sonic Pi ambi_dark_woosh (pitch falling) + qubodup swoosh |
| ui_focus | 1 | Kenney Interface click_003 + Kenney RPG metal_latch tick |
| ui_confirm | 1 | Kenney RPG metal_latch + Kenney Impact metal_heavy + Kenney Interface click_005 |
| ui_back | 1 | Kenney Interface switch_007 + Kenney Impact metal_medium |
| ui_ready | 1 | Kenney RPG metal_latch + Kenney Impact plate_heavy + VCSL anvil |
| ui_deny | 1 | Kenney Impact metal_medium (two dead knocks) + Kenney Interface error_006 (low-passed) |
| round_start | 1 | VCSL anvil + Kenney Impact bell_heavy + VCSL brake drum + Kenney Impact plate_heavy + VCSL bass drum |
| round_win | 1 | VCSL anvil + VCSL timpani + Kenney Sci-Fi low_frequency_explosion + Sonic Pi drum_cymbal_hard |

The exact source file behind every layer is listed in `tools/sfx/sources_used.json` (written by the build), and each layer's cut points, speed and filters are in the recipes in `tools/sfx/build_sfx.py`.

## Checked and not used

- **Oculus Audio Pack 1** (facebookincubator/Meta-open-sound): CC BY 4.0, and the CC0 alternatives were as good.
- **Owlish "Sound Effects Pack"** (in EternityForest/Free-SFX): its OpenGameArt page shows no licence, so it was left out.
