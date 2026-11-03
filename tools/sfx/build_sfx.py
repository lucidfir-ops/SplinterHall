"""Build Splinterhall's sound effects: assets/audio/sfx/*.mp3 + sfx.json.

    tools/sfx/fetch_sources.sh <cache>                       # CC0 sources, pinned commits
    python3 -I tools/sfx/extract_hoverline.py <hoverline.html> <cache>/hoverline
    python3 -I tools/sfx/build_sfx.py <cache> [--only name,name] [--wav dir]
    node tools/sfx/test-sfx.mjs                              # headless Chrome check
    tools/sfx/preview.html (serve the repo root over HTTP)   # a button per effect

The build is deterministic: the same sources give byte-identical MP3s. Every
source file and the effects using it are written to tools/sfx/sources_used.json.

Each effect is a recipe: layers of trimmed, faded, filtered and re-pitched cuts
from CC0 recordings (dsp.L), mixed, then set to a loudness target (max 50 ms
K-weighted RMS) with a peak ceiling, high-passed at 30 Hz, and encoded as a mono
MP3 (44.1 kHz for bright effects, 22.05 kHz for dark ones; 48-64 kbps).

Levels: every file is mastered hot (look-ahead limited to -2 dBFS) for the best
MP3 resolution, and each recipe states how loud the effect should play in the
game (`mix_db`, max 50 ms K-weighted RMS) and PEAK caps its played peak. The base
gain written to sfx.json is the lower of the two, so the effects sit under the
metal music (limiter peaks -1 dBFS, sections -16 to -26 dB RMS): explosions
loudest (played peaks -5 to -6.5 dBFS per channel, centred), hits and terrain in
the middle (-7 to -10), UI and footsteps quietest (-14 to -20). The runtime then
applies distance, pan, ±2 dB and ±6% pitch.
"""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dsp  # noqa: E402
from dsp import L, mix, SR  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'assets', 'audio', 'sfx')

# shorthand for source keys
KI = 'ki:impact_'           # Kenney Impact Sounds (ogg)
KS = 'ks:'                  # Kenney Sci-Fi Sounds (ogg)
KU = 'ku:'                  # Kenney Interface Sounds (wav)
KR = 'kr:'                  # Kenney RPG Audio (ogg)
RD = 'fs:rubberduck/'       # rubberduck's OpenGameArt packs, via EternityForest/Free-SFX (opus)
QB = 'fs:qubodup/Swooshes/'  # qubodup swooshes (opus)
SP = 'fs:Superpowers/'      # Sparklin Labs Superpowers packs (opus)
EL = 'fs:Electricity/'      # "Electricity game sound pack" (opus)
PI = 'pi:'                  # Sonic Pi samples (flac)
HV = 'hv:'                  # Hoverline's trimmed effects (mp3)
VA = 'vc:Idiophones/Struck Idiophones/Anvil/'
VB = 'vc:Idiophones/Struck Idiophones/Brake Drum/'
VS = 'vc:Idiophones/Struck Idiophones/Slapstick/'
VW = 'vc:Idiophones/Struck Idiophones/Woodblock/'
VR = 'vc:Idiophones/Struck Idiophones/Ratchet/'
VK = 'vc:Membranophones/Struck Membranophones/Bass Drum 1/'
VT = 'vc:Membranophones/Struck Membranophones/Timpani 1/Hit/'


def setup_roots(cache):
    dsp.ROOTS.update({
        'ki': os.path.join(cache, 'kenney_impact', 'addons', 'kenney impact sounds'),
        'ks': os.path.join(cache, 'kenney_scifi', 'addons', 'kenney sci-fi sounds'),
        'ku': os.path.join(cache, 'kenney_iface', 'addons', 'kenney_interface_sounds'),
        'kr': os.path.join(cache, 'kenney_rpg', 'addons', 'kenney rpg audio'),
        'fs': os.path.join(cache, 'freesfx'),
        'pi': os.path.join(cache, 'sonicpi', 'etc', 'samples'),
        'hv': os.path.join(cache, 'hoverline'),
        'vc': os.path.join(cache, 'vcsl'),
    })
    dsp.EXT.update({'ki': '.ogg', 'ks': '.ogg', 'ku': '.wav', 'kr': '.ogg', 'fs': '.opus',
                    'pi': '.flac', 'hv': '.mp3', 'vc': '.wav'})


def sub_boom(dur=0.5, f0=70, f1=38, seed=0):
    """A short sine thump with a falling pitch, used only to firm up the low end of
    recorded booms (the recordings carry the character)."""
    t = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.08)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / (dur * 0.35))


# --------------------------------------------------------------------------
# Recipes. Each returns a list of variants (numpy arrays); the second argument of
# @recipe is the in-game level (mix_db), see recipe().
# --------------------------------------------------------------------------
R = {}


def recipe(name, mix_db, pv=0.06, gv=2.0, sr=44100, kbps=56, cap=None, gap=None):
    """mix_db: how loud the effect should play (per channel, centred, dist 0, vol 1),
    as max 50 ms K-weighted RMS in dBFS. The file itself is mastered hot (peak -1 dBFS) and the
    base gain written to sfx.json brings it down to this level."""
    def deco(fn):
        R[name] = dict(fn=fn, mix=mix_db, pv=pv, gv=gv, sr=sr, kbps=kbps, cap=cap, gap=gap)
        return fn
    return deco


# Highest peak (dBFS, per channel) each effect may reach when played centred at
# dist 0, vol 1, before the runtime's random ±2 dB. The base gain is the lower of
# the loudness-based and peak-based gains, so short transients (clicks, punches)
# are held by their peak and sustained ones (hiss, whoosh) by loudness. A hard pan
# adds up to +2.9 dB on one side and the random level up to +2 dB, so the loudest
# effects are set to -5 dBFS to keep a single effect under -0.1 dBFS anywhere.
# Brief: hits around -6 to -10 dBFS, explosions loudest, UI and footsteps quietest.
PEAK = {
    'explosion_big': -5.0, 'explosion_mid': -5.5, 'explosion_small': -6.5, 'serpent_rise': -5.5,
    'collapse': -6.0, 'hammer_smash': -6.0, 'blunderbuss': -6.0, 'round_start': -6.0, 'round_win': -6.0,
    'punch_heavy': -7.0, 'death': -7.0, 'axe_chop': -7.5, 'rocket_launch': -7.5, 'serpent_crunch': -7.5,
    'break_stone': -8.0, 'break_wood': -8.0, 'break_iron': -8.0, 'break_ice': -9.0, 'break_glass': -9.0,
    'punch_mid': -8.5, 'thud': -10.0, 'sword_slash': -9.0, 'blade_stick': -10.0, 'bomb_bounce': -10.0,
    'crate_land': -10.0, 'splash': -8.5, 'web_splat': -10.0, 'punch_light': -10.5, 'land': -12.0,
    'portal_open': -10.0, 'portal_pass': -11.0, 'web_line': -11.0, 'lava_hiss': -10.0, 'fall_whoosh': -10.0,
    'tractor_on': -13.0, 'tractor_off': -13.0, 'jetpack': -13.0, 'rocket_flight': -12.0,
    'sword_swing': -13.0, 'throw': -14.0, 'jump': -15.0, 'pickup': -14.0, 'bomb_fuse': -15.0,
    'step': -19.0, 'debris': -17.0,
    'ui_focus': -20.0, 'ui_back': -17.0, 'ui_confirm': -16.0, 'ui_deny': -17.0, 'ui_ready': -14.0,
}

# src/audio/sfx.js pans a mono buffer with a StereoPannerNode (equal-power): centred,
# each channel carries it at -3.01 dB. The base gain makes up for that, so the
# PEAK / mix_db numbers above are what each channel actually gets when centred.
PAN_LAW_DB = 3.01

FILE_CEIL = -2.0      # file peak ceiling, dBFS (MP3 decoding can overshoot by ~1 dB)
FILE_LOUD = -7.0      # file loudness target before limiting...
MAX_LIMIT = 4.0       # ...but never more than this many dB of peak limiting

# ---- fighters --------------------------------------------------------------


@recipe('punch_light', -17.0, kbps=48)
def _():
    out = []
    for i, (src, r) in enumerate([(KI + 'punch_medium_000', 1.12), (KI + 'punch_medium_001', 1.18),
                                  (KI + 'punch_medium_003', 1.1)]):
        out.append(mix(L(src, d=0.16, r=r, hp=140, fo=0.05),
                       L(VS + 'slapstick_rr%d' % (i + 1), d=0.05, r=1.1, g=-9, hp=1800, fo=0.03),
                       L(KR + 'cloth_1', a=0.08, d=0.08, r=1.4, g=-16, hp=900, at=0.0, fo=0.04)))
    return out


@recipe('punch_mid', -15.0, kbps=48)
def _():
    out = []
    for i, src in enumerate([KI + 'punch_medium_002', KI + 'punch_medium_004', KI + 'punch_heavy_001']):
        out.append(mix(L(src, d=0.26, hp=80, fo=0.08),
                       L(PI + 'drum_heavy_kick', d=0.14, r=1.3, g=-10, lp=1200, fo=0.06),
                       L(VS + 'slapstick_rr%d' % (i + 1), d=0.05, r=0.9, g=-11, hp=1500, fo=0.03),
                       L(KR + 'chop', a=0.03, d=0.06, r=1.1, g=-14, hp=2000, fo=0.03)))
    return out


@recipe('punch_heavy', -13.0, kbps=56)
def _():
    out = []
    for src, crack in [(KI + 'punch_heavy_000', KR + 'chop'), (KI + 'punch_heavy_002', KR + 'chop'),
                       (KI + 'punch_heavy_004', RD + 'WoodMetal/wood_hit_02')]:
        out.append(mix(L(src, d=0.42, hp=50, fo=0.15),
                       L(PI + 'drum_heavy_kick', d=0.22, r=0.9, g=-6, lp=900, fo=0.1),
                       L(crack, d=0.12, r=0.85, g=-8, hp=1200, fo=0.05),
                       L(VS + 'slapstick_rr1', d=0.05, r=0.75, g=-10, hp=1200, fo=0.03)))
    return out


@recipe('thud', -16.0, kbps=48, sr=22050)
def _():
    return [mix(L(KI + 'soft_heavy_00%d' % i, d=0.3, hp=45, fo=0.12),
                L(KI + 'generic_light_00%d' % i, d=0.1, g=-7, hp=400, fo=0.04)) for i in (0, 2, 4)]


@recipe('land', -18.0, kbps=48, sr=22050)
def _():
    return [mix(L(KI + 'soft_medium_00%d' % a, d=0.16, hp=50, fo=0.06),
                L(KR + 'footstep_%d' % b, d=0.14, g=-4, hp=200, fo=0.06)) for a, b in ((1, 1), (3, 3))]


@recipe('step', -27.0, pv=0.08, gv=3.0, kbps=48, sr=22050, gap=0.06)
def _():
    # dry scuffs: Kenney RPG footsteps, tightened, the low thump trimmed so a run doesn't boom
    return [L(KR + 'footstep_%d' % i, d=0.13, hp=180, lp=7000, fo=0.05).render() for i in (0, 3, 4)]


@recipe('jump', -22.0, kbps=48)
def _():
    # a short cloth/air push off: swoosh tail + a dry scuff at the start
    return [mix(L(QB + 'swosh-12', a=0.02, d=0.2, r=1.35, hp=500, fo=0.1, g=-2),
                L(KR + 'footstep_1', d=0.07, r=1.1, g=-6, hp=250, fo=0.03))]


@recipe('death', -13.0, pv=0.04, kbps=56)
def _():
    # a snap (dry wood crack) then a body drop: no voice
    return [mix(L(RD + 'WoodMetal/wood_cracking_04', d=0.12, r=0.8, hp=500, g=-1, fo=0.05),
                L(KI + 'punch_heavy_003', d=0.4, r=0.85, g=-1, hp=40, fo=0.15, at=0.02),
                L(KI + 'soft_heavy_001', d=0.3, g=-4, hp=40, fo=0.12, at=0.16),
                L(PI + 'drum_heavy_kick', d=0.2, r=0.75, g=-10, lp=500, at=0.0, fo=0.1))]


# ---- blades and blunt --------------------------------------------------------


@recipe('axe_chop', -14.0)
def _():
    return [mix(L(KR + 'chop', d=0.22, r=r, hp=120, fo=0.08),
                L(KI + 'wood_heavy_00%d' % w, d=0.18, g=-4, hp=50, fo=0.08),
                L(QB + 'swosh-05', a=0.04, d=0.07, r=1.3, g=-12, hp=700, fi=0.02, fo=0.02, at=0.0))
            for r, w in ((0.9, 1), (1.0, 3))]


@recipe('sword_swing', -19.0, pv=0.08)
def _():
    return [L(QB + s, d=d, r=r, hp=350, fo=0.08).render()
            for s, d, r in (('swosh-26', 0.26, 1.25), ('swosh-40', 0.3, 1.3), ('swosh-15', 0.28, 1.2))]


@recipe('sword_slash', -15.0)
def _():
    return [mix(L(QB + 'swosh-08', d=0.18, r=1.35, hp=400, fo=0.05, g=-3),
                L(RD + 'RPG/blade_0%d' % b, d=0.24, hp=800, at=0.04, fo=0.1),
                L(KR + 'knife_slice_2', a=0.2, d=0.2, r=1.1, g=-6, hp=1500, at=0.05, fo=0.08))
            for b in (1, 3)]


@recipe('hammer_smash', -11.0, pv=0.05)
def _():
    return [mix(L(KI + 'mining_00%d' % m, d=0.5, r=0.82, hp=40, fo=0.2),
                L(VA + 'Anvil_Hit3_v3_rr1_Mid', d=0.6, r=0.7, g=-8, hp=200, tail=(0.04, 0.12), fo=0.15),
                L(VK + 'BDrumNew_hit_v7_rr1_Sum', d=0.5, r=0.9, g=-3, lp=500, tail=(0.08, 0.15), fo=0.15),
                L(RD + 'RPG/stones_04', d=0.35, g=-10, hp=600, at=0.03, fo=0.12))
            for m in (0, 3)]


@recipe('blade_stick', -16.0)
def _():
    # a hard bite into wood/stone with a short metallic quiver
    return [mix(L(KI + 'plank_medium_00%d' % p, d=0.16, hp=150, fo=0.06),
                L(KR + 'metal_latch', a=0.03, d=0.12, g=-8, hp=1500, fo=0.06),
                L(RD + 'WoodMetal/metal_spring_02', d=0.3, r=1.5, g=-9, hp=1500, at=0.02, tail=(0.04, 0.08), fo=0.1))
            for p in (0, 2)]


@recipe('throw', -20.0, pv=0.08)
def _():
    return [L(QB + s, d=0.3, r=r, hp=300, fo=0.1).render() for s, r in (('swosh-03', 1.15), ('swosh-43', 1.2))]


@recipe('pickup', -20.0, pv=0.04)
def _():
    # grabbing a weapon: leather grip + metal latch
    return [mix(L(KR + 'metal_latch', d=0.2, hp=300, fo=0.08),
                L(KR + 'belt_handle_1', d=0.2, g=-8, hp=1000, at=0.0, fo=0.08),
                L(KI + 'generic_light_001', d=0.08, g=-10, hp=150, fo=0.04))]


# ---- guns and blasts ----------------------------------------------------------


@recipe('blunderbuss', -11.0, pv=0.05)
def _():
    return [mix(L(SP + 'western-fps-2d/gun-4', d=0.6, r=0.82, hp=40, fo=0.25),
                L(RD + 'Bang/cannon_02', d=0.5, r=1.1, g=-4, hp=60, fo=0.2),
                L(PI + 'drum_heavy_kick', d=0.22, r=0.7, g=-4, lp=400, fo=0.1),
                L(KR + 'metal_latch', d=0.12, r=0.8, g=-16, hp=2000, at=0.0, fo=0.05))]


@recipe('rocket_launch', -13.0, pv=0.05)
def _():
    # thump out of the tube + the ignition hiss
    return [mix(L(PI + 'drum_heavy_kick', d=0.25, r=0.75, lp=600, fo=0.1),
                L(HV + 'missile', d=0.55, r=0.9, g=-1, hp=60, fo=0.2),
                L(RD + 'SFX100V2/sfx100v2_air_03', d=0.28, r=0.85, g=-6, hp=1200, at=0.02, fo=0.12))]


@recipe('rocket_flight', -19.0, pv=0.04)
def _():
    # one short burning whoosh-by (not a loop): play it when a rocket passes
    x = dsp.load(RD + 'SFX100V2/sfx100v2_air_02')
    x = dsp.trim_lead(x)[:int(0.8 * SR)]
    x = dsp.bp(x, 300, 6000)
    x = dsp.sweep_rate(x, 1.15, 0.8)
    roar = dsp.lp(dsp.load(KS + 'thruster_fire_000')[int(1.5 * SR):int(2.3 * SR)], 900)
    n = min(len(x), len(roar))
    y = dsp.norm(x[:n]) + 0.6 * dsp.norm(roar[:n])
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.25) * np.exp(-np.maximum(0, t - 0.32) / 0.18)
    return [dsp.fade(y * env, 0.01, 0.06)]


@recipe('explosion_small', -12.0, pv=0.06, sr=44100, kbps=56)
def _():
    return [mix(L(RD + 'Bang/bang_0%d' % b, d=0.7, hp=50, fo=0.3),
                L(KS + 'low_frequency_explosion_001', d=0.5, r=1.2, g=-4, lp=300, fo=0.2),
                L(sub_boom(0.4, 90, 45), g=-9, trim=False, fo=0.1))
            for b in (7, 9)]


@recipe('explosion_mid', -10.0, pv=0.05, kbps=56)
def _():
    return [mix(L(SP + 'western-fps-2d/explosion-%d' % e, d=1.1, hp=35, fo=0.4),
                L(RD + 'Bang/bang_0%d' % b, d=0.5, g=-5, hp=1200, fo=0.2),
                L(KS + 'low_frequency_explosion_000', a=0.15, d=0.9, g=-3, lp=250, fo=0.3),
                L(RD + 'BreakingFalling/bfh1_rock_falling_01', d=0.8, g=-14, hp=900, at=0.22, fo=0.3))
            for e, b in ((1, 6), (3, 1))]


@recipe('explosion_big', -8.5, pv=0.04, kbps=64)
def _():
    # low boom + crack + debris tail
    return [mix(L(KS + 'low_frequency_explosion_000', a=0.12, d=1.5, lp=260, fo=0.6),
                L(SP + 'western-fps-2d/explosion-3', d=1.25, g=-1, hp=40, fo=0.5),
                L(RD + 'Bang/cannon_02', d=0.4, g=-5, hp=1500, fo=0.2),
                L(KS + 'explosion_crunch_004', d=1.6, g=-9, hp=200, fo=0.6, at=0.05),
                L(RD + 'BreakingFalling/bfh1_rock_breaking_02', d=0.86, g=-12, hp=700, at=0.45, fo=0.3),
                L(sub_boom(0.8, 70, 32), g=-6, trim=False, fo=0.3))]


@recipe('bomb_fuse', -22.0, pv=0.05)
def _():
    # a short spitting fizz (about 0.6 s; re-trigger while lit if wanted)
    x = dsp.load(RD + 'RPG/spell_fire_06')
    x = dsp.trim_lead(x)[:int(0.62 * SR)]
    x = dsp.hp(x, 2500)
    crackle = dsp.hp(dsp.load(RD + 'Bang/fw_03')[int(0.1 * SR):int(0.72 * SR)], 3000)
    n = min(len(x), len(crackle))
    y = dsp.norm(x[:n]) + 0.5 * dsp.norm(crackle[:n])
    return [dsp.fade(y, 0.02, 0.1)]


@recipe('bomb_bounce', -17.0)
def _():
    return [mix(L(KI + 'metal_heavy_00%d' % m, d=0.2, r=0.8, hp=80, fo=0.08),
                L(KI + 'wood_heavy_00%d' % w, d=0.15, g=-5, hp=60, fo=0.06))
            for m, w in ((0, 0), (2, 2))]


# ---- strange items ---------------------------------------------------------------


@recipe('web_splat', -16.0)
def _():
    return [mix(L(RD + 'WaterSplashSlime/slime_%s' % s, d=0.4, hp=150, fo=0.12),
                L(KI + 'soft_medium_00%d' % m, d=0.1, g=-8, hp=60, fo=0.04))
            for s, m in (('15', 0), ('07', 2))]


@recipe('web_line', -17.0)
def _():
    # a taut twang as the line catches
    return [mix(L(PI + 'elec_twang', d=0.45, r=0.8, hp=120, fo=0.15),
                L(RD + 'SFX100/spring_03', d=0.35, r=0.9, g=-6, hp=400, fo=0.12),
                L(QB + 'swosh-19', d=0.16, r=1.6, g=-10, hp=1500, fo=0.06))]


@recipe('tractor_on', -18.0, pv=0.03)
def _():
    return [mix(L(KS + 'force_field_002', d=0.55, hp=120, fo=0.2),
                L(HV + 'barrier', d=0.5, r=1.2, g=-6, hp=200, fo=0.2))]


@recipe('tractor_off', -18.0, pv=0.03)
def _():
    # power-down release, with a little push
    x = dsp.trim_lead(dsp.load(EL + 'powerdown'))[:int(0.55 * SR)]
    x = dsp.hp(x, 150)
    x = dsp.decay(x, 0.15, 0.12)
    return [mix(L(x, trim=False, fo=0.1),
                L(QB + 'swosh-12', d=0.25, r=1.1, g=-8, hp=300, fo=0.1))]


@recipe('portal_open', -15.0, pv=0.03)
def _():
    return [mix(L(EL + 'teleport', d=0.75, hp=120, fo=0.25),
                L(PI + 'ambi_dark_woosh', a=0.85, d=0.6, r=1.4, g=-6, hp=60, fi=0.05, fo=0.2),
                L(KS + 'force_field_000', d=0.6, r=0.8, g=-8, hp=100, fo=0.2))]


@recipe('portal_pass', -16.0, pv=0.05)
def _():
    return [mix(L(HV + 'phase', d=0.42, hp=150, fo=0.12),
                L(QB + 'swosh-26', d=0.25, r=1.4, g=-5, hp=500, fo=0.08))]


@recipe('serpent_rise', -10.0, pv=0.03, kbps=56)
def _():
    # grinding stone rumble + a deep, slowed creature roar (the "roar of stone")
    roar = dsp.rate(dsp.trim_lead(dsp.load(RD + 'RPG/creature_roar_02')), 0.62)
    roar = dsp.lp(roar, 1800)
    grind = dsp.bp(dsp.trim_lead(dsp.load(KS + 'explosion_crunch_004')), 120, 2500)
    grind = dsp.rate(grind, 0.75)
    return [mix(L(RD + 'BreakingFalling/bfh1_rock_breaking_02', d=0.86, r=0.6, hp=60, g=-3, fo=0.3),
                L(KS + 'low_frequency_explosion_000', a=0.1, d=1.4, r=0.85, g=-5, lp=220, fi=0.15, fo=0.5),
                L(grind, d=1.5, g=-4, trim=False, fi=0.12, fo=0.5),
                L(roar, g=0, trim=False, at=0.18, fo=0.4),
                L(RD + 'RPG/stones_03', d=1.1, r=0.7, g=-8, hp=300, at=0.3, fo=0.3), dur=1.6)]


@recipe('serpent_crunch', -13.0, pv=0.06)
def _():
    return [mix(L(KI + 'mining_00%d' % m, d=0.45, r=0.7, hp=50, lp=1000, fo=0.18),
                L(RD + 'RPG/stones_0%d' % s, d=0.4, r=0.8, g=-4, hp=300, fo=0.15),
                L(RD + 'BreakingFalling/bfh1_rock_breaking_01', d=0.3, g=-8, hp=1500, at=0.02, fo=0.12))
            for m, s in ((1, 1), (4, 4))]


@recipe('jetpack', -19.0, pv=0.05)
def _():
    # one ~0.4 s thrust burst; re-trigger every ~0.3 s while thrusting
    x = dsp.load(KS + 'thruster_fire_002')[int(1.6 * SR):int(2.05 * SR)]
    y = dsp.bp(x, 150, 7000)
    t = np.arange(len(y)) / SR
    env = np.minimum(1, t / 0.02) * np.exp(-np.maximum(0, t - 0.08) / 0.16)
    puff = dsp.trim_lead(dsp.load(RD + 'SFX100V2/sfx100v2_air_03'))[:len(y)]
    puff = dsp.hp(puff, 800)
    m = min(len(y), len(puff))
    z = dsp.norm(y[:m] * env[:m]) + 0.7 * dsp.norm(dsp.hp(puff[:m], 1500))
    return [dsp.fade(z, 0.003, 0.08)]


# ---- terrain --------------------------------------------------------------------


@recipe('break_stone', -15.0, cap=6)
def _():
    # crunch + grit: the pickaxe thump (filtered so it doesn't ring or boom) under
    # cracking stone and a spray of falling grit
    return [mix(L(KI + 'mining_00%d' % m, d=0.3, r=r, hp=110, lp=1100, g=-4, fo=0.12),
                L(RD + 'RPG/stones_0%d' % s, d=0.4, g=0, hp=300, at=0.005, fo=0.15),
                L('ki:footstep_concrete_00%d' % c, d=0.1, r=0.7, g=-5, hp=200, fo=0.04),
                L(RD + 'BreakingFalling/bfh1_rock_falling_0%d' % f, d=0.45, g=-5, hp=800, at=0.05, fo=0.15))
            for m, r, s, c, f in ((0, 0.9, 1, 0, 4), (2, 1.0, 4, 1, 5), (3, 0.85, 2, 2, 6))]


@recipe('break_wood', -15.0, cap=6)
def _():
    return [mix(L(RD + 'WoodMetal/wood_breaking_0%d' % b, d=0.45, hp=120, fo=0.15),
                L(KI + 'wood_heavy_00%d' % w, d=0.2, g=-4, hp=60, fo=0.08),
                L(RD + 'BreakingFalling/bfh1_wood_breaking_0%d' % c, d=0.3, g=-8, hp=1000, at=0.03, fo=0.1))
            for b, w, c in ((1, 1, 3), (2, 2, 4))]


@recipe('break_iron', -15.0, cap=6)
def _():
    # iron rings: a struck brake drum / anvil partial plus a plate crash
    return [mix(L(KI + 'plate_heavy_00%d' % p, d=0.35, hp=80, fo=0.12),
                L(VB + v, d=0.9, g=-5, hp=250, tail=(0.1, 0.25), fo=0.25),
                L(RD + 'BreakingFalling/bfh1_metal_falling_03', d=0.4, g=-9, hp=600, at=0.04, fo=0.12))
            for p, v in ((1, 'BrakeDrum1_Hammer_v3_rr1_Mid'), (2, 'BrakeDrum2_Hammer3_v3_rr1_Mid'))]


@recipe('break_ice', -16.0, cap=6)
def _():
    # brittle crack + glassy tinkle, darker than glass
    return [mix(L(RD + 'BreakingFalling/bfh1_glass_breaking_0%d' % g, d=0.45, r=0.78, hp=300, lp=9000, fo=0.15),
                L(RD + 'WoodMetal/wood_cracking_04', d=0.15, r=1.2, g=-4, hp=1200, fo=0.05),
                L(KI + 'mining_002', d=0.15, r=1.3, g=-9, hp=200, fo=0.06))
            for g in (2, 5)]


@recipe('break_glass', -16.0, cap=6)
def _():
    return [mix(L(RD + 'BreakingFalling/bfh1_glass_breaking_0%d' % g, d=0.55, hp=500, fo=0.2),
                L(KI + 'glass_heavy_00%d' % h, d=0.2, g=-5, hp=300, fo=0.08))
            for g, h in ((2, 0), (5, 3))]


@recipe('collapse', -11.0, pv=0.04, kbps=56)
def _():
    # a slab giving way: deep rumble + tumbling stone
    grind = dsp.bp(dsp.trim_lead(dsp.load(KS + 'explosion_crunch_001')), 150, 3000)
    return [mix(L(RD + 'BreakingFalling/bfh1_rock_breaking_02', d=0.86, r=0.75, hp=60, g=-2, fo=0.3),
                L(KS + 'low_frequency_explosion_001', d=0.9, r=0.75, g=-4, lp=200, fi=0.03, fo=0.3),
                L(KI + 'mining_004', d=0.6, r=0.65, g=-4, hp=40, lp=1000, at=0.05, fo=0.2),
                L(grind, d=1.0, r=0.8, g=-6, trim=False, fo=0.4),
                L(RD + 'BreakingFalling/bfh1_rock_falling_01', d=0.9, g=-4, hp=500, at=0.3, fo=0.3), dur=1.4)]


@recipe('debris', -24.0, pv=0.08, gv=3.0, gap=0.04, cap=8)
def _():
    return [L(RD + 'BreakingFalling/bfh1_rock_falling_0%d' % f, d=0.3, hp=900, fo=0.12).render()
            for f in (4, 6, 7)]


@recipe('crate_land', -16.0)
def _():
    return [mix(L(RD + 'WoodMetal/wood_slam_0%d' % s, d=0.32, hp=70, fo=0.12),
                L(KI + 'wood_heavy_00%d' % w, d=0.2, g=-4, hp=50, fo=0.08))
            for s, w in ((1, 0), (2, 3))]


# ---- kill line ---------------------------------------------------------------------


@recipe('lava_hiss', -15.0, pv=0.05)
def _():
    # a sizzle burst as something hits the lava: steam hiss + fire crackle
    hiss = dsp.trim_lead(dsp.load(RD + 'SFX100V2/sfx100v2_air_02'))[:int(0.9 * SR)]
    hiss = dsp.bp(hiss, 1800, 9000)
    fire = dsp.trim_lead(dsp.load(RD + 'RPG/spell_fire_03'))[:int(0.9 * SR)]
    n = min(len(hiss), len(fire))
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.01) * np.exp(-t / 0.35)
    y = (dsp.norm(hiss[:n]) + 0.8 * dsp.norm(fire[:n])) * env
    return [mix(L(y, trim=False, fo=0.2),
                L(RD + 'WaterSplashSlime/slime_09', d=0.35, r=0.7, g=-8, hp=100, fo=0.1))]


@recipe('splash', -15.0)
def _():
    return [mix(L(RD + 'WaterSplashSlime/splash_%s' % s, d=0.9, hp=60, fo=0.3),
                L(KI + 'soft_heavy_002', d=0.2, g=-8, hp=40, fo=0.08))
            for s in ('04', '07')]


@recipe('fall_whoosh', -15.0, pv=0.04)
def _():
    # a falling wind whoosh that drops in pitch (the abyss)
    x = dsp.trim_lead(dsp.load(PI + 'ambi_dark_woosh'))
    x = dsp.seg(x, 0.6, 1.6)
    x = dsp.sweep_rate(x, 1.5, 0.75)
    x = dsp.hp(x, 80)
    t = np.arange(len(x)) / SR
    env = np.minimum(1, t / 0.12) * np.exp(-np.maximum(0, t - 0.4) / 0.25)
    return [mix(L(x * env, trim=False, fo=0.15),
                L(QB + 'swosh-31', a=0.0, d=0.6, r=0.7, g=-6, hp=150, fo=0.2))]


# ---- UI: hard clicks, clunks and latches ---------------------------------------------


@recipe('ui_focus', -25.0, pv=0.03, gv=1.0, gap=0.035)
def _():
    # a dry mechanical tick: tiny clunk + click transient
    return [mix(L(KU + 'click_003', hp=200, fo=0.01, trim=False),
                L(KR + 'metal_latch', a=0.035, d=0.05, r=1.4, g=-10, hp=2500, fo=0.02))]


@recipe('ui_confirm', -21.0, pv=0.02, gv=1.0)
def _():
    # a heavy latch clunk
    return [mix(L(KR + 'metal_latch', d=0.22, r=0.85, hp=150, fo=0.08),
                L(KI + 'metal_heavy_002', d=0.11, g=-4, hp=150, fo=0.04),
                L(KU + 'click_005', g=-6, hp=150, trim=False, fo=0.01))]


@recipe('ui_back', -22.0, pv=0.02, gv=1.0)
def _():
    # a dull lower clunk, like a bolt sliding back
    return [mix(L(KU + 'switch_007', d=0.07, r=0.8, hp=120, fo=0.03),
                L(KI + 'metal_medium_001', d=0.12, r=0.75, g=-4, hp=100, fo=0.05))]


@recipe('ui_ready', -19.0, pv=0.02, gv=1.0)
def _():
    # a bolt slammed home: latch + heavy plate
    return [mix(L(KR + 'metal_latch', d=0.2, r=0.75, hp=120, fo=0.06),
                L(KI + 'plate_heavy_001', d=0.3, r=0.9, g=-3, hp=80, fo=0.12, at=0.02),
                L(VA + 'Anvil_Hit2_v3_rr1_Mid', d=0.3, r=1.0, g=-14, hp=1500, tail=(0.02, 0.06), at=0.02, fo=0.08))]


@recipe('ui_deny', -21.0, pv=0.02, gv=1.0)
def _():
    # a blocked latch: two dead metal knocks, no beep
    knock = L(KI + 'metal_medium_000', d=0.09, r=0.7, hp=100, fo=0.04)
    return [mix(knock, L(KI + 'metal_medium_000', d=0.12, r=0.62, hp=100, fo=0.06, at=0.085),
                L(KU + 'error_006', d=0.18, r=0.8, g=-10, hp=100, lp=1500, fo=0.05))]


# ---- round markers -------------------------------------------------------------------


@recipe('round_start', -11.0, pv=0.0, gv=0.0, kbps=56)
def _():
    # a heavy iron clang: anvil strike over a struck brake drum and a low thump
    return [mix(L(VA + 'Anvil_Hit2_v3_rr1_Mid', d=1.4, r=0.72, hp=90, tail=(0.3, 0.45), fo=0.4),
                L(KI + 'bell_heavy_001', d=1.3, r=0.82, g=-3, hp=80, tail=(0.25, 0.4), fo=0.4),
                L(VB + 'BrakeDrum1_Hammer_v3_rr1_Mid', d=1.2, r=0.8, g=-7, hp=120, tail=(0.2, 0.35), fo=0.3),
                L(KI + 'plate_heavy_000', d=0.4, r=0.75, g=-5, hp=60, fo=0.15),
                L(VK + 'BDrumNew_hit_v7_rr1_Sum', d=0.7, g=-5, lp=300, tail=(0.1, 0.2), fo=0.2), dur=1.5)]


@recipe('round_win', -11.0, pv=0.0, gv=0.0, kbps=56)
def _():
    # struck metal + low boom accent, no melody
    return [mix(L(VA + 'Anvil_Hit3_v3_rr1_Mid', d=1.2, r=0.62, hp=90, tail=(0.2, 0.35), fo=0.4),
                L(VT + 'Timpani1_Hit_v4_rr1_Sum', d=1.4, r=0.9, g=-2, lp=500, tail=(0.25, 0.4), fo=0.4),
                L(KS + 'low_frequency_explosion_001', d=0.9, r=0.9, g=-4, lp=200, fo=0.3),
                L(PI + 'drum_cymbal_hard', d=1.0, r=0.8, g=-14, hp=3000, tail=(0.1, 0.3), fo=0.3), dur=1.6)]


# --------------------------------------------------------------------------------------
def prep(x, sr_out):
    """High-pass (and band-limit for 22 kHz files). Returns (x, highest safe file loudness)."""
    x = dsp.hp(x, 30, 2)
    if sr_out < 44100:
        x = dsp.lp(x, sr_out * 0.45, 4)
    crest = dsp.db(dsp.peak(x)) - dsp.loudness(x)
    return x, min(FILE_LOUD, FILE_CEIL - crest + MAX_LIMIT)


def finish(x, target):
    """Set the file to `target` loudness, look-ahead limit to FILE_CEIL, trim the
    tail. Returns (x, loudness, peak dB)."""
    x = x * dsp.undb(target - dsp.loudness(x))
    x = dsp.limit(x, FILE_CEIL)
    x = dsp.trim_lead(x, -40, 0.003)
    x = dsp.fade(dsp.trim_tail(x, -54), 0.0015, 0.004)
    return x, dsp.loudness(x), dsp.db(dsp.peak(x))


def encode(x, path, sr_out, kbps):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-ar', str(sr_out), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '%dk' % kbps,
                    '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', path],
                   input=pcm, check=True)


def main():
    args = sys.argv[1:]
    cache = args[0]
    only = None
    wav_dir = None
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
    if '--wav' in args:
        wav_dir = args[args.index('--wav') + 1]
        os.makedirs(wav_dir, exist_ok=True)
    setup_roots(cache)
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'sfx.json')
    manifest = {}
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path)).get('effects', {})
    report = []
    for name, rc in R.items():
        if only and name not in only:
            continue
        dsp.set_current(name)
        variants = rc['fn']()
        files = []
        louds = []
        sr_out = rc['sr']
        prepped = [prep(v, sr_out) for v in variants]
        target = min(t for _, t in prepped)   # variants share one loudness, so one base gain fits all
        ys = [finish(v, target)[0] for v, _ in prepped]
        # equalise variants after limiting (limiting costs the peakier ones some loudness)
        quiet = min(dsp.loudness(y) for y in ys)
        ys = [y * dsp.undb(quiet - dsp.loudness(y)) for y in ys]
        for i, y in enumerate(ys):
            fn = name + ('_%d' % (i + 1) if len(variants) > 1 else '') + '.mp3'
            lufs, pk = dsp.loudness(y), dsp.db(dsp.peak(y))
            encode(y, os.path.join(OUT, fn), sr_out, rc['kbps'])
            if wav_dir:
                import wave
                with wave.open(os.path.join(wav_dir, fn[:-4] + '.wav'), 'wb') as w:
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                    w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
            files.append(fn)
            louds.append(lufs)
            report.append([name, fn, len(y) / SR, lufs, pk, os.path.getsize(os.path.join(OUT, fn)) / 1024])
        # one base gain per effect: loudness target, capped by the played-peak target
        g_loud = rc['mix'] - float(np.mean(louds))
        g_peak = PEAK[name] - max(r[4] for r in report[-len(files):])
        gain = dsp.undb(min(g_loud, g_peak) + PAN_LAW_DB)
        for row in report[-len(files):]:
            row.append(row[4] + dsp.db(gain) - PAN_LAW_DB)
        entry = {'files': files, 'gain': round(float(gain), 4), 'pitchVar': rc['pv'], 'gainVarDb': rc['gv']}
        if rc['cap']:
            entry['maxVoices'] = rc['cap']
        if rc['gap']:
            entry['minGap'] = rc['gap']
        manifest[name] = entry
    # drop stale files
    keep = {f for e in manifest.values() for f in e['files']}
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f not in keep:
            os.remove(os.path.join(OUT, f))
    order = list(R.keys())
    manifest = {k: manifest[k] for k in order if k in manifest}
    doc = {
        '_about': 'Splinterhall sound effects. name -> files (variants, one picked at random), '
                  'gain (base linear gain under the music), pitchVar (max fractional pitch '
                  'variation per play), gainVarDb (max level variation per play, dB), optional '
                  'maxVoices (concurrent cap for this name) and minGap (seconds between plays, '
                  'default 0.05). Built by tools/sfx/build_sfx.py; sources in CREDITS.md.',
        'version': 1,
        'groups': {'break': {'match': 'break_', 'maxVoices': 6}},
        'effects': manifest,
    }
    with open(manifest_path, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print('%-16s %-22s %6s %7s %7s %6s %9s' % ('effect', 'file', 'dur', 'loud', 'peak', 'KB', 'mixPeak'))
    for r in report:
        print('%-16s %-22s %5.2fs %7.1f %7.1f %6.1f %9.1f' % tuple(r))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.mp3'))
    print('%d files, %.1f KB mp3' % (len(keep), total / 1024))
    with open(os.path.join(HERE, 'sources_used.json'), 'w') as f:
        json.dump({k: sorted(v) for k, v in sorted(dsp.USED.items())}, f, indent=1)


if __name__ == '__main__':
    main()
