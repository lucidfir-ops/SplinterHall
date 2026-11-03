#!/usr/bin/env bash
# Fetch the CC0 source recordings used by tools/sfx/build_sfx.py into a cache
# folder outside the repo (default: $SFX_CACHE or ~/.cache/splinterhall-sfx).
# Each repository is fetched at a pinned commit with a partial clone and a
# sparse checkout of only the folders the recipes use.
#
#   tools/sfx/fetch_sources.sh [cache dir]
#   python3 -I tools/sfx/extract_hoverline.py <hoverline.html> <cache>/hoverline
#   python3 -I tools/sfx/build_sfx.py <cache dir>
set -euo pipefail
CACHE="${1:-${SFX_CACHE:-$HOME/.cache/splinterhall-sfx}}"
mkdir -p "$CACHE"

fetch() { # name url sha path...
  local name="$1" url="$2" sha="$3"; shift 3
  local dir="$CACHE/$name"
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$sha" ]; then
    echo "ok    $name"; return
  fi
  rm -rf "$dir"; mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$url"
  git -C "$dir" config core.sparseCheckout true
  git -C "$dir" config gc.auto 0
  printf '%s\n' "$@" > "$dir/.git/info/sparse-checkout"
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$sha"
  git -C "$dir" checkout -q FETCH_HEAD
  echo "fetch $name"
}

fetch sonicpi https://github.com/sonic-pi-net/sonic-pi.git df6f17e4625b0451fa2af8accf2e1e641c7ad458 \
  /LICENSE.md /etc/samples/README.md \
  /etc/samples/drum_heavy_kick.flac /etc/samples/ambi_dark_woosh.flac /etc/samples/elec_twang.flac \
  /etc/samples/drum_cymbal_hard.flac

fetch vcsl https://github.com/sgossner/VCSL.git c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e \
  /LICENSE /README.md \
  "/Idiophones/Struck Idiophones/Anvil/" \
  "/Idiophones/Struck Idiophones/Brake Drum/" \
  "/Idiophones/Struck Idiophones/Slapstick/" \
  "/Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav" \
  "/Membranophones/Struck Membranophones/Timpani 1/Hit/Timpani1_Hit_v4_rr1_Sum.wav"

fetch kenney_impact https://github.com/Boyquotes/kenney-impact-sounds-for-godot.git 999dd1684873f8b020a3aa5b26e713da21688924 \
  /LICENSE "/addons/kenney impact sounds/*.ogg"
fetch kenney_scifi https://github.com/Boyquotes/kenney-sci-fi-sounds-for-godot.git c094967fe930c57ddb376f67c75f8aa0296690b7 \
  /LICENSE "/addons/kenney sci-fi sounds/*.ogg"
fetch kenney_iface https://github.com/Calinou/kenney-interface-sounds.git 4596a49eaf5a533948d49a47467f606bcdea70ff \
  /LICENSE.txt "/addons/kenney_interface_sounds/*.wav"
fetch kenney_rpg https://github.com/Boyquotes/kenney-rpg-audio-for-godot.git 22eb79bb843bbcadcaa6ed119353a33265ffad11 \
  /LICENSE "/addons/kenney rpg audio/*.ogg"

fetch freesfx https://github.com/EternityForest/Free-SFX.git f2fe53330c2cc6dc47c73750409c963219e997be \
  /LICENSE /README.md \
  /rubberduck/ /qubodup/Swooshes/ \
  /Superpowers/LICENSE.txt /Superpowers/README.md /Superpowers/western-fps-2d/ \
  /Electricity/

echo "sources in $CACHE"
