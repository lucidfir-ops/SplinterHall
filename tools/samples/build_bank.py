#!/usr/bin/env python3
"""Splinterhall music sample pipeline.

Fetches the source recordings into a scratch directory outside the repo, then for every sample:
trims silence, fades the tail, measures the pitch of pitched notes and resamples them onto the exact
semitone, flattens and bakes a crossfade loop for sustained notes, level-matches, and encodes a mono
44.1 kHz MP3 into assets/audio/music/. Writes assets/audio/music/bank.json and CREDITS.md.

    python3 -I tools/samples/build_bank.py [--scratch DIR] [--no-fetch] [--out DIR] [--jobs N]

The scratch dir (default /tmp/splinterhall-samples, or $SPLINTERHALL_SAMPLES) holds the partial clones and the
downloaded FluidR3 notes; it must be outside the repo. A fresh run downloads about 1.5 GB of git blobs (only the
folders used are checked out) and takes a few minutes; later runs reuse it.

Sources (see CREDITS.md):
  VCSL (CC0)        git partial clone of github.com/sgossner/VCSL
  VSCO-2-CE (CC0)   git partial clone of github.com/sgossner/VSCO-2-CE
  Sonic Pi (CC0)    git partial clone of github.com/sonic-pi-net/sonic-pi (branch dev, etc/samples)
  FluidR3 GM (CC BY 3.0) renders from raw.githubusercontent.com/gleitz/midi-js-soundfonts (gh-pages)
Needs: git, curl, ffmpeg (libmp3lame), python3 with numpy and scipy.
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audiolib import (SR, load, encode_mp3, trim, peak, rms, db, measure_pitch, resample_semis,  # noqa: E402
                      midi_to_hz, hz_to_midi, find_loop, yin_pitch, onset, env)

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'assets' / 'audio' / 'music'

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
FLUID_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']


def fluid_name(m):
    return f'{FLUID_NAMES[m % 12]}{m // 12 - 1}'


# --------------------------------------------------------------------------------------------- sources
VCSL = 'vcsl'
VSCO = 'vsco'
SPI = 'sonicpi'
FLUID = 'fluid'

SOURCES = {
    VCSL: dict(repo='https://github.com/sgossner/VCSL.git', branch=None, dir='VCSL'),
    VSCO: dict(repo='https://github.com/sgossner/VSCO-2-CE.git', branch=None, dir='VSCO-2-CE'),
    SPI: dict(repo='https://github.com/sonic-pi-net/sonic-pi.git', branch='dev', dir='sonic-pi'),
}
FLUID_URL = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/{inst}-mp3/{note}.mp3'

V_SN = 'Membranophones/Struck Membranophones'
V_ID = 'Idiophones/Struck Idiophones'
V_AE = 'Aerophones/Edge-blown Aerophones'
SP = 'etc/samples'

# --------------------------------------------------------------------------------------------- the bank
# Every part: kind 'drum' (unpitched hits, velocity layers + round robins) or 'pitched' (multisampled).
# files: list of dicts with src, path (relative to the source root) or fluid instrument + midi, and
# vel / rr for drums, nominal midi for pitched. Options: max_len (s), tail_db, kbps, loop (sustained),
# shift (octave offset of the source's note names), pitch ('sustain'|'pluck'|'timpani'), layer_db.


def drum(src, path, vel=1, rr=0, **kw):
    return dict(src=src, path=path, vel=vel, rr=rr, **kw)


def vnote(src, path, midi, **kw):
    return dict(src=src, path=path, midi=midi, **kw)


def fnote(inst, midi, **kw):
    return dict(src=FLUID, inst=inst, midi=midi, **kw)


def name_midi(n):
    """'C#3' / 'A#0' / 'Db2' -> MIDI using scientific octaves (C4 = 60)."""
    i = 1
    pc = NOTE[n[0]]
    if len(n) > 1 and n[1] in '#b':
        pc += 1 if n[1] == '#' else -1
        i = 2
    return pc + 12 * (int(n[i:]) + 1)


PARTS = {}

# Drum kit. Kick and toms from the Sonic Pi pack (menegass's acoustic kit). Kick gets a beater click: the
# first 6 ms of a VCSL stick hit, high-passed, mixed under the attack.
PARTS['kick'] = dict(kind='drum', kbps=96, max_len=0.55, tail_db=-50, click=True, files=[
    drum(SPI, f'{SP}/drum_bass_hard.flac', vel=2, rr=0),
    drum(SPI, f'{SP}/drum_bass_soft.flac', vel=1, rr=0, layer_db=-5),
])
PARTS['kick_boom'] = dict(kind='drum', kbps=96, max_len=0.7, tail_db=-50, files=[
    drum(SPI, f'{SP}/drum_heavy_kick.flac', vel=1, rr=0),
])
# Snare: VCSL Modern Snare 1, three velocity layers x two round robins, with the crack of the Sonic Pi
# snare's first 22 ms layered onto the hard and mid layers.
PARTS['snare'] = dict(kind='drum', kbps=112, max_len=0.75, tail_db=-48, crack=True, files=[
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v9_rr1_Mid.wav', vel=3, rr=0),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v9_rr2_Mid.wav', vel=3, rr=1),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v7_rr1_Mid.wav', vel=2, rr=0, layer_db=-5),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v7_rr2_Mid.wav', vel=2, rr=1, layer_db=-5),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v5_rr1_Mid.wav', vel=1, rr=0, layer_db=-11, nocrack=True),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_HitSN_v5_rr2_Mid.wav', vel=1, rr=1, layer_db=-11, nocrack=True),
])
PARTS['snare_roll'] = dict(kind='loop', kbps=96, files=[
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_rollSN_v4_rr1_Mid.wav', seg=(2.0, 5.6)),
])
PARTS['sticks'] = dict(kind='drum', kbps=80, max_len=0.25, tail_db=-45, files=[
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_stick_v1_rr1_Mid.wav', rr=0),
    drum(VCSL, f'{V_SN}/Snare Drum, Modern 1/Snare2_stick_v1_rr2_Mid.wav', rr=1),
])
for t, nm in (('tom_hi', 'hi'), ('tom_mid', 'mid'), ('tom_lo', 'lo')):
    PARTS[t] = dict(kind='drum', kbps=96, max_len=0.95, tail_db=-50, files=[
        drum(SPI, f'{SP}/drum_tom_{nm}_hard.flac', vel=2),
        drum(SPI, f'{SP}/drum_tom_{nm}_soft.flac', vel=1, layer_db=-5),
    ])
PARTS['hat'] = dict(kind='drum', kbps=112, max_len=0.32, tail_db=-45, files=[
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_HitC_v4_rr1_Mid.wav', vel=2, rr=0),
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_HitC_v4_rr2_Mid.wav', vel=2, rr=1),
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_HitC_v2_rr1_Mid.wav', vel=1, rr=0, layer_db=-6),
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_HitC_v2_rr2_Mid.wav', vel=1, rr=1, layer_db=-6),
])
PARTS['hat_open'] = dict(kind='drum', kbps=112, max_len=1.5, tail_db=-50, files=[
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_HitO_rr1_Mid.wav'),
])
PARTS['hat_pedal'] = dict(kind='drum', kbps=96, max_len=0.25, tail_db=-45, files=[
    drum(VCSL, f'{V_ID}/Hi-Hat Cymbal/HiHat_Close_rr1_Mid.wav'),
])
PARTS['ride'] = dict(kind='drum', kbps=112, max_len=2.2, tail_db=-52, files=[
    drum(VCSL, f'{V_ID}/Suspended Cymbal 1/susCymb1_hit_stick_f1.wav', vel=2),
    drum(VCSL, f'{V_ID}/Suspended Cymbal 1/susCymb1_hit_stick_mp1.wav', vel=1, layer_db=-6),
])
PARTS['ride_bell'] = dict(kind='drum', kbps=112, max_len=1.6, tail_db=-50, files=[
    drum(VCSL, f'{V_ID}/Suspended Cymbal 1/susCymb1_hit_bell_mf1.wav'),
])
PARTS['crash'] = dict(kind='drum', kbps=112, max_len=3.2, tail_db=-55, files=[
    drum(VCSL, f'{V_ID}/Suspended Cymbal 2/susCymb2_hit_fff1.wav', rr=0),
    drum(SPI, f'{SP}/drum_cymbal_hard.flac', rr=1),
])
PARTS['crash_big'] = dict(kind='drum', kbps=112, max_len=3.6, tail_db=-55, files=[
    drum(VSCO, 'VSCO 1 Percussion/varMetal/Cymbals/clash/crash_hit_fff_loose_2.wav'),
])
PARTS['china'] = dict(kind='drum', kbps=112, max_len=2.0, tail_db=-50, files=[
    drum(VSCO, 'VSCO 1 Percussion/varMetal/Cymbals/susp/susp_hit_metal_2_ff.wav'),
])
PARTS['splash'] = dict(kind='drum', kbps=112, max_len=0.8, tail_db=-50, files=[
    drum(VSCO, 'VSCO 1 Percussion/varMetal/Cymbals/clash/crash_hit_ff_verytight.wav'),
])
PARTS['swell'] = dict(kind='swell', kbps=96, files=[
    drum(VCSL, f'{V_ID}/Suspended Cymbal 1/susCymb1_cresc_2s.wav', rr=0),
    drum(VCSL, f'{V_ID}/Suspended Cymbal 2/susCymb2_cresc_4s.wav', rr=1),
])
# War drums and frame drum (viking), concert bass drum for the big hits
PARTS['war_drum'] = dict(kind='drum', kbps=96, max_len=2.2, tail_db=-50, files=[
    drum(VCSL, f'{V_SN}/Bass Drum 2/bassdrum_hit_ff.wav', vel=2),
    drum(VCSL, f'{V_SN}/Bass Drum 2/bassdrum_hit_f.wav', vel=1, layer_db=-4),
])
PARTS['war_tom'] = dict(kind='drum', kbps=96, max_len=0.9, tail_db=-50, files=[
    drum(VCSL, f'{V_SN}/Tom 2/Mallet/TomL_HitM_v4_rr1_Mid.wav', rr=0),
    drum(VCSL, f'{V_SN}/Tom 2/Mallet/TomL_HitM_v4_rr2_Mid.wav', rr=1),
])
PARTS['frame_drum'] = dict(kind='drum', kbps=96, max_len=0.9, tail_db=-50, files=[
    drum(VCSL, f'{V_SN}/Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav', rr=0),
    drum(VCSL, f'{V_SN}/Frame Drum/HDrumL_Hit_v3_rr2_Sum.wav', rr=1),
])
# Timpani: five VCSL drums, ff with two round robins and a soft layer; pitched by their principal partial
PARTS['timpani'] = dict(kind='pitched', kbps=96, max_len=2.2, tail_db=-50, pitch='timpani', files=[
    vnote(VCSL, f'{V_SN}/Timpani 1/Hit/Timpani{d}_Hit_v4_rr{r}_Sum.wav', None, vel=2, rr=r - 1, drumno=d)
    for d in (1, 2, 3, 4, 5) for r in (1, 2)] + [
    vnote(VCSL, f'{V_SN}/Timpani 1/Hit/Timpani{d}_Hit_v2_rr1_Sum.wav', None, vel=1, rr=0, drumno=d, layer_db=-8)
    for d in (1, 3)])
PARTS['timpani_roll'] = dict(kind='pitched', kbps=96, pitch='timpani', loopseg=(0.8, 3.4), files=[
    vnote(VSCO, 'Percussion/Timpani/Rolls/Timpani2_Roll_v5_rr1_Sum.wav', None),
])

# DI electric guitar and bass (FluidR3 GM, CC BY 3.0), every 3 semitones
PARTS['gtr_clean'] = dict(kind='pitched', kbps=128, max_len=2.1, tail_db=-60, loop=(0.75, 1.9), pitch='pluck',
                          files=[fnote('electric_guitar_clean', m) for m in range(36, 88, 3)])
PARTS['gtr_mute'] = dict(kind='pitched', kbps=128, max_len=0.6, tail_db=-55, pitch='pluck', fade_ms=60,
                         files=[fnote('electric_guitar_muted', m) for m in range(36, 73, 3)])
PARTS['bass'] = dict(kind='pitched', kbps=128, max_len=2.1, tail_db=-60, loop=(0.8, 1.9), pitch='pluck',
                     files=[fnote('electric_bass_pick', m) for m in range(24, 58, 3)])

# Orchestra (VSCO-2-CE, CC0). VSCO note names sit an octave below scientific pitch (shift=12), checked by
# measuring every file.
CELLO_SUS = ['C1', 'E1', 'G1', 'B1', 'D2', 'F2', 'A2']
VLN_SUS = ['G2', 'B2', 'D3', 'F#3', 'A3', 'C4', 'E4', 'G4']
PARTS['str_sus'] = dict(kind='pitched', kbps=96, max_len=3.0, tail_db=-60, loop=(1.1, 2.8), pitch='sustain',
                        head_db=-50, hpf=40, files=[
    vnote(VSCO, f'Strings/Cello Section/susvib/susvib_{n}_v3_1.wav', name_midi(n) + 12) for n in CELLO_SUS] + [
    vnote(VSCO, f'Strings/Violin Section/susVib/VlnEns_susVib_{n}_v2.wav', name_midi(n) + 12) for n in VLN_SUS])
CELLO_SPIC = ['E1', 'G1', 'B1', 'D2', 'F2', 'A2', 'C3', 'E3']
VLN_SPIC = ['G2', 'B2', 'D3', 'F#3', 'A3', 'C4', 'E4']
PARTS['str_spic'] = dict(kind='pitched', kbps=96, max_len=0.8, tail_db=-55, pitch='sustain', hpf=40, files=[
    vnote(VSCO, f'Strings/Cello Section/spic/spic_{n}_v2_RR{r}.wav', name_midi(n) + 12, rr=r - 1)
    for n in CELLO_SPIC for r in (1, 2)] + [
    vnote(VSCO, f'Strings/Violin Section/Spic/VlnEns_Spic_{n}_v2_rr1.wav', name_midi(n) + 12) for n in VLN_SPIC])
PARTS['horn_sus'] = dict(kind='pitched', kbps=96, max_len=2.6, tail_db=-60, loop=(1.0, 2.4), pitch='sustain',
                         head_db=-50, hpf=40, files=[
    vnote(VSCO, f'Brass/F Horn/sus/MOHorn_sus_{n}_v3_1.wav', name_midi(n) + 12) for n in ['G1', 'A#1', 'D2', 'F2', 'A2', 'C3']])
PARTS['horn_stac'] = dict(kind='pitched', kbps=96, max_len=0.7, tail_db=-55, pitch='sustain', hpf=40, files=[
    vnote(VSCO, f'Brass/F Horn/stac/MOHorn_stac_{n}_v3_rr1.wav', name_midi(n) + 12) for n in ['A#1', 'D2', 'F2', 'A2', 'C3', 'D4']])
PARTS['tbn_stac'] = dict(kind='pitched', kbps=96, max_len=0.7, tail_db=-55, pitch='sustain', hpf=40, files=[
    vnote(VSCO, f'Brass/Tenor Trombone/stac/tenortbn_stac_{n}_v4_rr1.wav', name_midi(n) + 12) for n in ['F1', 'A#1', 'F2', 'A#2', 'D3', 'F3']])
PARTS['tuba_stac'] = dict(kind='pitched', kbps=96, max_len=0.9, tail_db=-55, pitch='sustain', hpf=25, files=[
    vnote(VSCO, f'Brass/Tuba/stac/Tuba3_stac_{n}_v2_rr1_Sum.wav', name_midi(n) + 12) for n in ['A#0', 'D#1', 'F1', 'A#1', 'D2']])
PARTS['tpt_stac'] = dict(kind='pitched', kbps=96, max_len=0.7, tail_db=-55, pitch='sustain', hpf=60, files=[
    vnote(VSCO, f'Brass/Trumpet/stac/Sum_SHTrumpet_stac_{n}_v3_rr1.wav', name_midi(n) + 12) for n in ['C3', 'F3', 'A#3', 'D4']])

# Folk voices: solo violin as the fiddle (VSCO, CC0), alto recorder as the whistle (VCSL, CC0),
# bagpipe drone (FluidR3, CC BY 3.0)
PARTS['fiddle'] = dict(kind='pitched', kbps=112, max_len=2.5, tail_db=-60, loop=(1.0, 2.3), pitch='sustain',
                       head_db=-50, hpf=120, files=[
    vnote(VSCO, f'Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_{n}_f.wav', name_midi(n)) for n in ['G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6']])
PARTS['whistle'] = dict(kind='pitched', kbps=96, max_len=2.5, tail_db=-60, loop=(1.0, 2.3), pitch='sustain',
                        head_db=-50, hpf=200, files=[
    vnote(VCSL, f'{V_AE}/Baroque Alto Recorder/SusVib/AltRecorder_SusVib_{n}_rr1_Main.wav', name_midi(n) + 12) for n in ['G#3', 'C4', 'E4', 'G#4', 'C5', 'E5']])
PARTS['bagpipe'] = dict(kind='pitched', kbps=96, max_len=3.1, tail_db=-60, loop=(1.4, 2.9), pitch='sustain',
                        files=[fnote('bagpipe', m) for m in (45, 48, 51, 54)])

CORE = {'kick', 'kick_boom', 'snare', 'snare_roll', 'sticks', 'tom_hi', 'tom_mid', 'tom_lo', 'hat', 'hat_open',
        'hat_pedal', 'ride', 'ride_bell', 'crash', 'crash_big', 'china', 'splash', 'swell', 'gtr_clean', 'gtr_mute',
        'bass', 'war_drum', 'war_tom', 'frame_drum'}
ORCH = {'timpani', 'timpani_roll', 'str_sus', 'str_spic', 'horn_sus', 'horn_stac', 'tbn_stac', 'tuba_stac', 'tpt_stac'}
FOLK = {'fiddle', 'whistle', 'bagpipe'}

LICENCE = {VCSL: 'CC0', VSCO: 'CC0', SPI: 'CC0', FLUID: 'CC BY 3.0'}
SOURCE_NAME = {VCSL: 'VCSL', VSCO: 'VSCO-2-CE', SPI: 'Sonic Pi', FLUID: 'FluidR3 GM (MIDI.js)'}


# --------------------------------------------------------------------------------------------- fetching
def sh(cmd, cwd=None):
    subprocess.run(cmd, cwd=cwd, check=True)


def fetch(scratch, parts):
    scratch.mkdir(parents=True, exist_ok=True)
    need = {}
    for p in parts.values():
        for f in p['files']:
            if f['src'] == FLUID:
                continue
            need.setdefault(f['src'], set()).add(os.path.dirname(f['path']))
    for src, dirs in need.items():
        s = SOURCES[src]
        d = scratch / s['dir']
        if not (d / '.git').exists():
            cmd = ['git', 'clone', '--filter=blob:none', '--no-checkout', '--depth', '1']
            if s['branch']:
                cmd += ['-b', s['branch']]
            sh(cmd + [s['repo'], str(d)])
            sh(['git', 'sparse-checkout', 'init', '--no-cone'], cwd=d)
        patterns = sorted('/' + x + '/' for x in dirs) + ['/LICENSE*', '/README*']
        sh(['git', 'sparse-checkout', 'set', '--no-cone'] + patterns, cwd=d)
        sh(['git', 'checkout'], cwd=d)
    for p in parts.values():
        for f in p['files']:
            if f['src'] != FLUID:
                continue
            dst = scratch / 'fluid' / f['inst'] / (fluid_name(f['midi']) + '.mp3')
            if dst.exists() and dst.stat().st_size > 0:
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            url = FLUID_URL.format(inst=f['inst'], note=fluid_name(f['midi']))
            sh(['curl', '-sS', '-f', '-o', str(dst), url])


def src_path(scratch, f):
    if f['src'] == FLUID:
        return scratch / 'fluid' / f['inst'] / (fluid_name(f['midi']) + '.mp3')
    return scratch / SOURCES[f['src']]['dir'] / f['path']


def src_label(f):
    if f['src'] == FLUID:
        return f"FluidR3_GM/{f['inst']}-mp3/{fluid_name(f['midi'])}.mp3"
    return f"{SOURCES[f['src']]['dir']}/{f['path']}"


# --------------------------------------------------------------------------------------------- processing
def hp(x, f, order=2):
    sos = signal.butter(order, f, 'highpass', fs=SR, output='sos')
    return signal.sosfilt(sos, x).astype(np.float32)


def timpani_pitch(x):
    """Principal (1,1) mode: strongest partial in 70-260 Hz that has a partner near 1.5x."""
    seg = x[int(0.05 * SR):int(0.8 * SR)]
    n = 1 << 17
    X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    f = np.fft.rfftfreq(n, 1 / SR)
    m = (f > 60) & (f < 700)
    L = 20 * np.log10(X + 1e-12)
    pk, _ = signal.find_peaks(L * m, prominence=6)
    pk = [k for k in pk if m[k]]
    best, bscore = None, -1e9
    for k in pk:
        fk = f[k]
        if not (70 <= fk <= 260):
            continue
        partner = [j for j in pk if abs(f[j] / fk - 1.5) < 0.07]
        score = L[k] + (max(L[j] for j in partner) * 0.5 if partner else -60)
        if score > bscore:
            bscore, best = score, k
    if best is None:
        return None
    # parabolic refine
    a, b, c = L[best - 1], L[best], L[best + 1]
    den = a - 2 * b + c
    di = 0.5 * (a - c) / den if den else 0
    return float(hz_to_midi((best + di) * SR / n))


def flatten_loop_region(x, s, e):
    """Divide out the slow amplitude envelope from s to the end so the loop sustains flat."""
    w = 2048
    a = np.abs(x)
    n = len(x)
    pos = np.arange(s, n, w // 2)
    lv = np.array([np.sqrt(np.mean(x[p:p + w] ** 2)) + 1e-9 for p in pos])
    ref = lv[0]
    g = ref / lv
    g = np.clip(g, 0.25, 4)
    curve = np.interp(np.arange(s, n), pos + w // 2, g, left=g[0], right=g[-1])
    # blend in over 50 ms so there is no step at s
    ramp = np.minimum(1, np.arange(len(curve)) / (0.05 * SR))
    x = x.copy()
    x[s:] *= (1 + (curve - 1) * ramp).astype(np.float32)
    return x


def bake_loop(x, s, e, corr):
    """Crossfade the audio leading into e with the audio leading into s (seamless jump e -> s)."""
    x = x.copy()
    L = int(min(0.12 * SR, s, (e - s) * 0.5))
    t = np.linspace(0, 1, L)
    if corr > 0.9:
        fin, fout = t, 1 - t
    else:
        fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    x[e - L:e] = x[e - L:e] * fout + x[s - L:s] * fin
    tail = int(0.12 * SR)
    end = min(len(x), e + tail)
    x = x[:end].copy()
    # keep a short natural continuation after e (decoders and loop-off release), then fade
    k = end - e
    if k > 8:
        x[e:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return x


def loop_points(x, midi, region):
    s0, e0 = int(region[0] * SR), int(min(region[1], len(x) / SR - 0.05) * SR)
    if e0 - s0 < 0.25 * SR:
        return None
    if midi is not None:
        period = SR / midi_to_hz(midi)
    else:
        period = 400
    W = int(max(512, period * 3))
    best = None
    # search start in the first 40% of the region, end near the region end, period-aligned lengths
    for s in range(s0, s0 + int((e0 - s0) * 0.4), max(1, int(period / 4))):
        a = x[s:s + W]
        na = np.sqrt(np.dot(a, a)) + 1e-12
        kmax = int((e0 - s) / period)
        kmin = max(2, int(0.35 * SR / period))  # loops of at least 0.35 s, so they never buzz
        for k in range(max(kmin, kmax - 40), kmax + 1):
            e = s + int(round(k * period))
            if e + W > len(x) or e > e0:
                continue
            b = x[e:e + W]
            c = float(np.dot(a, b) / (na * (np.sqrt(np.dot(b, b)) + 1e-12)))
            if best is None or c > best[0]:
                best = (c, s, e)
    return best


def process(job):
    name, pname, part, f, scratch = job
    p = src_path(Path(scratch), f)
    x = load(p)
    info = {}
    kind = part['kind']
    if part.get('hpf') or f.get('hpf'):
        x = hp(x, part.get('hpf') or f.get('hpf'))
    if kind == 'loop':
        seg = f['seg']
        x = x[int(seg[0] * SR):int(seg[1] * SR)].astype(np.float32)
        x = flatten_loop_region(x, 0, len(x))
        L = int(0.25 * SR)
        s, e = L, len(x) - int(0.13 * SR)
        x = bake_loop(x, s, e, 0.0)
        x[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
        info['loop'] = [s / SR, e / SR]
    elif kind == 'swell':
        x = trim(x, head_db=-55, tail_db=-60, pre_ms=5)
        e = env(x, 256)
        ip = int(np.argmax(e)) * 256
        end = min(len(x), ip + int(1.4 * SR))
        x = x[:end].copy()
        fo = int(1.0 * SR)
        x[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
        info['peak'] = ip / SR
    else:
        x = trim(x, head_db=part.get('head_db', -42), tail_db=part.get('tail_db', -60),
                 pre_ms=part.get('pre_ms', 1.5), max_len=part.get('max_len'), fade_ms=part.get('fade_ms'))
    if kind == 'drum' and part.get('click'):
        stick = load(Path(scratch) / SOURCES[VCSL]['dir'] / f'{V_SN}/Snare Drum, Modern 1/Snare2_stick_v1_rr1_Mid.wav')
        st = trim(stick, head_db=-30, pre_ms=0.3)[:int(0.006 * SR)]
        st = hp(st, 2200, 4)
        st *= np.cos(np.linspace(0, np.pi / 2, len(st))) ** 2
        st *= peak(x) / max(peak(st), 1e-9) * (10 ** (-13 / 20) if f['vel'] > 1 else 10 ** (-17 / 20))
        o = onset(x, -20)
        x = x.copy()
        x[o:o + len(st)] += st
    if kind == 'drum' and part.get('crack') and not f.get('nocrack'):
        sn = trim(load(Path(scratch) / SOURCES[SPI]['dir'] / f'{SP}/drum_snare_hard.flac'), head_db=-30, pre_ms=0.3)
        cr = hp(sn[:int(0.022 * SR)], 900, 2)
        cr *= np.cos(np.linspace(0, np.pi / 2, len(cr))) ** 1.5
        cr *= peak(x) / max(peak(cr), 1e-9) * 10 ** (-7 / 20)
        o = onset(x, -20)
        x = x.copy()
        x[max(0, o - 20):max(0, o - 20) + len(cr)] += cr
    midi = None
    measured = None
    if kind in ('pitched',):
        how = part.get('pitch', 'sustain')
        if how == 'timpani':
            m = timpani_pitch(x)
            ok = m is not None
            measured = m
        else:
            m, ok = measure_pitch(x, f['midi'], 'sustain' if how == 'sustain' else 'pluck')
            measured = m if ok else None
        if not ok:
            raise RuntimeError(f'{name}: pitch not found')
        target = int(round(m))
        x = resample_semis(x, target - m)
        midi = target
        info['cents'] = round((target - m) * 100, 1)
        if part.get('loopseg'):
            a, b = part['loopseg']
            x = x[:int(b * SR) + int(0.2 * SR)]
            x = flatten_loop_region(x, int(a * SR * 0.6), len(x))
            s, e = int(a * SR), int(b * SR)
            x = bake_loop(x, s, e, 0.0)
            info['loop'] = [s / SR, e / SR]
        elif part.get('loop'):
            lp = loop_points(x, midi, part['loop'])
            if lp:
                c, s, e = lp
                x = flatten_loop_region(x, s, e)
                x = bake_loop(x, s, e, c)
                info['loop'] = [s / SR, e / SR]
                info['loopcorr'] = round(c, 3)
    # level: RMS of the body (attack + early sustain)
    o = onset(x, -20)
    if info.get('loop') and kind == 'pitched' and part.get('pitch') == 'sustain':
        a, b = int(info['loop'][0] * SR), int(info['loop'][1] * SR)
        body = x[a:b]  # sustained notes: match the level they hold at
    else:
        body = x[o:o + int((0.12 if kind == 'drum' else 0.35) * SR)]
    level = rms(body)
    pk = peak(x)
    norm = 10 ** (-1 / 20) / pk
    x = (x * norm).astype(np.float32)
    out = OUT / (name + '.mp3')
    kbps = f.get('kbps', part.get('kbps', 96))
    encode_mp3(out, x, kbps)
    rec = dict(name=name, file=name + '.mp3', part=pname, src=f['src'], source=src_label(f), licence=LICENCE[f['src']],
               vel=f.get('vel', 1), rr=f.get('rr', 0), midi=midi, level=level, norm=norm,
               layer_db=f.get('layer_db', 0.0), len=round(len(x) / SR, 4), on=round(onset(x, -20) / SR, 5),
               kbps=kbps, measured=None if measured is None else round(measured, 3))
    rec.update(info)
    return rec


def file_name(pname, f, i):
    if f.get('midi') is not None and PARTS[pname]['kind'] == 'pitched':
        base = f'{pname}_{f["midi"]}'
    elif f.get('drumno'):
        base = f'{pname}_d{f["drumno"]}'
    else:
        base = pname
    tag = ''
    if PARTS[pname]['kind'] != 'pitched' or f.get('drumno') or f.get('rr'):
        tag = f'_v{f.get("vel", 1)}_r{f.get("rr", 0) + 1}'
    return base + tag


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scratch', default=os.environ.get('SPLINTERHALL_SAMPLES', '/tmp/splinterhall-samples'))
    ap.add_argument('--no-fetch', action='store_true')
    ap.add_argument('--jobs', type=int, default=2)
    ap.add_argument('--out', default=None, help='output folder (default assets/audio/music in the repo)')
    args = ap.parse_args()
    global OUT
    if args.out:
        OUT = Path(args.out).resolve()
    scratch = Path(args.scratch).resolve()
    if str(scratch).startswith(str(REPO)):
        sys.exit('scratch must be outside the repo')
    if not args.no_fetch:
        fetch(scratch, PARTS)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.mp3'):
        old.unlink()
    jobs = []
    for pname, part in PARTS.items():
        for i, f in enumerate(part['files']):
            nm = file_name(pname, f, i)
            if f.get('midi') is None and part['kind'] == 'pitched':
                nm = f'{pname}_d{f.get("drumno", i)}_v{f.get("vel", 1)}_r{f.get("rr", 0) + 1}'
            jobs.append((nm, pname, part, f, str(scratch)))
    names = [j[0] for j in jobs]
    assert len(set(names)) == len(names), 'duplicate output names'
    with ProcessPoolExecutor(args.jobs) as ex:
        recs = list(ex.map(process, jobs))
    # level matching: within each part, equal loudness per velocity layer (plus the layer offset), and
    # every part's loudest layer at a common reference so the engine's mix gains mean something.
    by_part = {}
    for r in recs:
        by_part.setdefault(r['part'], []).append(r)
    files = []
    target = 0.25  # common body RMS reference for every part's loudest layer
    for pname, rs in by_part.items():
        for r in rs:
            # the encoded file is the processed audio times norm, so its body RMS is level * norm
            # equal loudness for every layer; the engine's velocity curve sets how loud each hit plays
            r['gain'] = round(target / max(r['level'] * r['norm'], 1e-9), 5)
        files.extend(rs)
    group = {p: ('core' if p in CORE else 'orch' if p in ORCH else 'folk') for p in PARTS}
    bank = dict(version=1, sr=SR, note='gain: multiply the decoded file by gain to reach the common reference level '
                '(body RMS 0.25; every velocity layer equally loud, the engine applies the velocity curve). on: onset time (s) of the first sample above -20 dB of '
                'peak in the encoded audio, for aligning decoder delay. loop: [start, end] seconds. peak: swell peak (s).',
                parts={p: dict(kind=PARTS[p]['kind'], group=group[p]) for p in PARTS},
                files=[{k: r[k] for k in ('name', 'file', 'part', 'midi', 'vel', 'rr', 'gain', 'len', 'on', 'loop', 'peak',
                                          'cents', 'src', 'licence', 'source') if k in r and r[k] is not None}
                       for r in sorted(files, key=lambda r: (r['part'], r.get('midi') or 0, r['vel'], r['rr']))])
    (OUT / 'bank.json').write_text(json.dumps(bank, indent=1))
    write_credits(files)
    tot = sum(r['len'] for r in files)
    size = sum((OUT / r['file']).stat().st_size for r in files)
    print(f'{len(files)} files, {tot:.1f} s of audio, {size / 1e6:.2f} MB')
    for pname, rs in by_part.items():
        print(f'  {pname:12s} {len(rs):3d} files {sum(r["len"] for r in rs):6.1f} s '
              f'{sum((OUT / r["file"]).stat().st_size for r in rs) / 1e3:7.0f} KB ' +
              ' '.join(f'{r["midi"]}{"" if r.get("cents") is None else "(%+.0fc)" % r["cents"]}' for r in rs if r['midi'] is not None))


def write_credits(files):
    used = {}
    for r in files:
        used.setdefault(r['src'], []).append(r)
    lines = ['# Music samples: credits and licences', '',
             'Every file in this folder was made by `tools/samples/build_bank.py` from the recordings listed below: '
             'trimmed, faded, pitch-measured and resampled onto the semitone, loop-baked where sustained, '
             'level-matched and encoded as mono 44.1 kHz MP3. Nothing here is share-alike or non-commercial.', '',
             '| Source | Licence | Credit | Used for |', '| --- | --- | --- | --- |']
    desc = {
        SPI: ('[Sonic Pi sample pack](https://github.com/sonic-pi-net/sonic-pi/tree/dev/etc/samples) '
              '(freesound.org recordings by menegass and Zajo)', 'CC0 1.0', 'None required',
              'Kick, toms, crash 2, the snare crack layer'),
        VCSL: ('[Versilian Community Sample Library](https://github.com/sgossner/VCSL)', 'CC0 1.0', 'None required',
               'Snare, stick clicks, hi-hats, ride, crash 1, cymbal swells, concert bass drum (war drum), mallet tom, '
               'frame drum, timpani, alto recorder (whistle), the kick beater click'),
        VSCO: ('[VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE)', 'CC0 1.0',
               'None required', 'Strings (cello and violin sections, sustain and spiccato), solo violin (fiddle), '
               'horns, trombone, tuba, trumpet, timpani roll, clash cymbals, china-style suspended cymbal, choked splash'),
        FLUID: ('[FluidR3 GM soundfont renders](https://github.com/gleitz/midi-js-soundfonts) (MIDI.js Soundfonts, '
                'FluidR3_GM)', 'CC BY 3.0', 'FluidR3 GM by Frank Wen, rendered by Benjamin Gleitzman\'s MIDI.js '
                'Soundfonts', 'Clean and palm-muted electric guitar DI notes, picked electric bass, bagpipe drone'),
    }
    for s in (SPI, VCSL, VSCO, FLUID):
        if s in used:
            d = desc[s]
            lines.append(f'| {d[0]} | {d[1]} | {d[2]} | {d[3]} |')
    lines += ['', '**Credit line (CC BY 3.0, for the Credits page and itch.io description):** '
              '"FluidR3 GM by Frank Wen, rendered by Benjamin Gleitzman\'s MIDI.js Soundfonts" '
              '(https://github.com/gleitz/midi-js-soundfonts), used under CC BY 3.0 '
              '(https://creativecommons.org/licenses/by/3.0/). The notes were trimmed, retuned, looped and re-encoded.', '',
              '## Every file', '', '| File | Part | Source recording | Licence |', '| --- | --- | --- | --- |']
    for r in sorted(files, key=lambda r: r['name']):
        lines.append(f"| {r['file']} | {r['part']} | {r['source']} | {r['licence']} |")
    (OUT / 'CREDITS.md').write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
