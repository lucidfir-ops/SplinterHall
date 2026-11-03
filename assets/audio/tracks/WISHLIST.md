# Track wishlist

Tracks that might suit Splinterhall, licensed CC0 or CC BY (nothing NC, SA or ND), that couldn't be downloaded here:
the build machine's shell only reaches GitHub and the package registries, so OpenGameArt, Free Music Archive,
archive.org, Jamendo and ccMixter were out of reach. I could read their pages but not hear them, so listen before
adding anything. Genuine CC BY / CC0 folk metal is rare; the two PeriTune tracks already in the game are the best
I found, and nothing below is confirmed folk metal.

## Adding a track (two minutes)

1. Download the file into `assets/audio/tracks/`.
2. Recommended: make it sit level with the others (96 kbps MP3, -14 LUFS, true peak under -1 dBTP, silence trimmed):
   `node tools/music/pregen.mjs --import assets/audio/tracks/DOWNLOAD.ogg --out some-name.mp3`
   then delete the download. (Any MP3 works without this step; it may just be louder or quieter.)
3. Add one line to `tracks.json`, inside `"tracks": [ ... ]` (a trailing comma is fine):
   ```
   {"file": "some-name.mp3", "title": "Title", "artist": "Artist", "style": "folk", "licence": "CC BY 4.0", "credit": "\"Title\" by Artist (page URL), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)", "source": "page URL"},
   ```
   `style` is viking, battle, power or folk (folk plays when the style is Viking or Any). The `credit` line appears
   on the in-game Credits page by itself.
4. For CC BY, also add the credit line to `CREDITS.md` and to this folder's `CREDITS.md`. CC0 needs no credit.

## Candidates

| Title | Artist | Licence | What the page says | Page | File |
| --- | --- | --- | --- | --- | --- |
| Celtic Warrior | Damiano Baldoni | CC BY 4.0 | Tagged fantasy, Celtic; from his album Lost Dynasty. Might be orchestral rather than metal. | https://opengameart.org/content/celtic-warrior-by-damiano-baldoni | Damiano_Baldoni_-_Celtic_Warrior.mp3 (10.8 MB) |
| Viking March | nightm4re | CC0 | Tagged viking, march, RPG, fantasy; from an abandoned game. | https://opengameart.org/content/viking-march | viking-march.ogg (1 MB) |
| Untitled Metal Track | Kistol | CC0 | Metal; was the title music of Cult of Damaskus. A battle candidate, not folk. FLAC also offered. | https://opengameart.org/content/untitled-metal-track | untitled_metal_track.mp3 (3.8 MB) |
| Megasong | Emma_MA | CC0 | Heavy metal and hard rock, "in the vein of Megaman ... with more realistic instruments". Power or battle. | https://opengameart.org/content/megasong | megasong.mp3 (5.4 MB) |
| Bravery Vampire | MintoDog | CC0 | "Intense and sad electric guitar music", 180 bpm, loopable. Battle. | https://opengameart.org/content/bravery-vampire | bravery_vampire_bpm180.ogg (4.4 MB) |

OpenGameArt files are normally served from `https://opengameart.org/sites/default/files/<file name>`; if that
fails, use the download link on the page.

## Downloadable, but left out

- **PeriTune: "Raid3"** (power metal, 190 bpm, 2016, https://peritune.com/blog/2016/09/16/raid3/), plus the hard
  rock "Raid" and "Raid2". They're in the same GitHub pack copy as the two folk metal tracks
  (https://github.com/expandabit/BarClash, folder `5_Sound/Sound_PeriTune-2020_9-Battle_Tracks/`). PeriTune's terms
  page (https://peritune.com/about/) says everything published up to February 2026 stays under CC BY 4.0, but the
  track pages themselves don't name a licence, and they aren't folk metal, so I didn't add them. Raid3 would suit
  the Power style if you want it: download `22-Raid3.mp3` from that folder and follow the steps above.

## Checked and rejected

- "Celtic Spooky Metal Music for video game" by Navet56 (OpenGameArt): no licence chosen on the page, only
  "please credit me".
- alkakrab's "Free Viking Folk Music Pack" and kirillvp's "Metal Music Pack" (itch.io): free to use, but no
  licence named.
- maxstack's packs (itch.io): CC BY-SA 4.0 (share-alike).
- Beetlemuse's Latin-titled doom tracks (OpenGameArt): CC BY or CC BY-SA, but doom-style synth metal, not folk.
- Alexander Nakarada's viking tracks (CC BY 4.0, some on GitHub): Danheim-style drums and chants, not metal.
- Shane Ivers / Silverman Sound's "Staldorn Suite" and "Pagan Cross" (CC BY 4.0): orchestral and recorder folk,
  not metal.
