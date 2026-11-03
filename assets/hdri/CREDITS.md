# HDRI environment maps: credits and licences

All four maps are from [Poly Haven](https://polyhaven.com), released under **CC0 1.0** (public domain, no credit required; credited here anyway). Licence: https://polyhaven.com/license

| File | Setting | Original | Author | Poly Haven page |
| --- | --- | --- | --- | --- |
| `bunker.hdr` | Bunker: cool, overcast industrial concrete under fluorescent strips | Empty Warehouse 01 (`empty_warehouse_01_1k.hdr`) | Sergej Majboroda | https://polyhaven.com/a/empty_warehouse_01 |
| `forge.hdr` | Forge: dim room lit by a glowing furnace-like hearth, brick vault | Fireplace (`fireplace_1k.hdr`) | Greg Zaal | https://polyhaven.com/a/fireplace |
| `fjord.hdr` | Fjord: cold blue dusk over a rocky ridge, pink afterglow on the horizon | Kiara 1 Dawn (`kiara_1_dawn_1k.hdr`) | Greg Zaal | https://polyhaven.com/a/kiara_1_dawn |
| `hall.hdr` | Hall: warm rustic banquet hall, brick, timber barn doors, chandeliers, iron stove | Warm Reception Dinner (`warm_reception_dinner_1k.hdr`) | Dimitrios Savva (photography), Jarod Guest (processing) | https://polyhaven.com/a/warm_reception_dinner |

## Where the files came from

The network allowed GitHub only, so the 1k `.hdr` files were taken from public GitHub repositories that carry them unmodified, using a partial clone plus sparse checkout of just those files. Each file's MD5 was checked against Poly Haven's own published file list (`https://api.polyhaven.com/files/<id>`, entry `hdri > 1k > hdr`) and matched, so these are the original Poly Haven files:

| Original | MD5 (matches Poly Haven) | Fetched from |
| --- | --- | --- |
| `empty_warehouse_01_1k.hdr` | `ab2931b0191b050b97b1e08ab67b0fb0` | [pmndrs/drei-assets](https://github.com/pmndrs/drei-assets) `hdri/` |
| `kiara_1_dawn_1k.hdr` | `fcefd321c51b468ead9d5e1a369a3735` | [pmndrs/drei-assets](https://github.com/pmndrs/drei-assets) `hdri/` |
| `fireplace_1k.hdr` | `42ea9e4241d230a343955f4921b9ab30` | [SonyCSLParis/funiki](https://github.com/SonyCSLParis/funiki) `scenes/projects/3_hdri/2_fireplace/` |
| `warm_reception_dinner_1k.hdr` | `8c6c3de99bcde3e60233073d03340ed3` | [SonyCSLParis/funiki](https://github.com/SonyCSLParis/funiki) `scenes/projects/3_hdri/4_reception/` |

The three.js examples folder (`mrdoob/three.js`, `examples/textures/equirectangular/`) was checked first; its 1k Poly Haven maps are all outdoor daylight or sunset scenes (Venice Sunset, Spruit Sunrise, Quarry 01, Blouberg Sunrise 2, Moonless Golf, Pedestrian Overpass, San Giuseppe Bridge), so none suited the Bunker, Forge or Hall interiors.

## Processing

`tools/assets/build_hdri.py` (with `tools/assets/rgbe.py`, a small numpy RGBE reader and writer):

1. Box-downscaled 1024x512 to **512x256** (energy-preserving 2x2 average, so lamps and the fire keep their total light).
2. A small white-balance push toward the setting (Bunker and Fjord cooler; Forge and Hall slightly desaturated, to 75% and 85%, so the image light doesn't drown the fighters' colours).
3. Scaled so the solid-angle mean luminance is 0.50 (Bunker), 0.30 (Forge), 0.36 (Fjord) and 0.45 (Hall), so the four maps light a scene at similar strength and the renderer can use one `envMapIntensity` per setting near 1.
4. Written as RLE RGBE (`FORMAT=32-bit_rle_rgbe`), readable by three.js `HDRLoader` (formerly `RGBELoader`).

Sizes: bunker 414 KB, forge 418 KB, fjord 353 KB, hall 352 KB, 1.54 MB in all. All four parse with three.js `HDRLoader` (512x256, float).
