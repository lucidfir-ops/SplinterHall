#!/usr/bin/env python3
"""Analyse offline renders of the music engine.

    python3 -I tools/music/analyse.py [RENDER_DIR] [--png]

For each match-<style>.wav (+ .json log from render.mjs): loudness per rung (RMS over the bars spent at each
rung), true peak, the ladder trace against the scripted action, band energy per rung (low end, guitar fizz
above 6 kHz), L/R correlation of the guitars, and optionally spectrogram PNGs (ffmpeg showspectrumpic).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal

LEVELS = ['Prowl', 'Riff', 'Charge', 'Battle', 'Crescendo']


def load_stereo(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, 2).copy()


def db(v):
    return 20 * np.log10(max(float(v), 1e-12))


def band_db(x, sr, lo, hi):
    sos = signal.butter(4, [lo, hi] if hi < sr / 2 else lo, 'bandpass' if hi < sr / 2 else 'highpass', fs=sr, output='sos')
    y = signal.sosfilt(sos, x)
    return db(np.sqrt(np.mean(y ** 2)))


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return float(np.max(np.abs(up)))


def analyse(wav, log, png=False):
    sr = 44100
    x = load_stereo(wav)
    mono = x.mean(axis=1)
    info = json.loads(Path(log).read_text()) if Path(log).exists() else {}
    bars = info.get('bars', [])
    dur = len(mono) / sr
    print(f'\n=== {wav.name}  "{info.get("name", "?")}"  {dur:.1f} s')
    if info.get('tune'):
        t = info['tune']
        print(f'  {t["style"]} {t["bpm"]} bpm {t["meter"]} {t["keyLabel"]} riff {t["riff"]}  palette {t["palette"]}')
    pk = float(np.max(np.abs(x)))
    tp = true_peak(x[: sr * 200])
    print(f'  sample peak {db(pk):.2f} dBFS, true peak {db(tp):.2f} dBTP, clip samples {info.get("clip", "?")}, '
          f'peak voices {info.get("peakVoices", "?")}')
    # per rung loudness: concatenate bars at each level (not builds)
    per = {i: [] for i in range(5)}
    for i, b in enumerate(bars):
        t0 = b['t0']
        t1 = bars[i + 1]['t0'] if i + 1 < len(bars) else t0 + 2
        if b.get('build') or t1 - t0 > 5:
            continue
        a, e = int(t0 * sr), int(min(t1, dur) * sr)
        if e > a:
            per[b['level']].append(mono[a:e])
    print('  rung       bars  RMS dB  <120Hz  120-500 0.5-2k  2-6k  >6k (dB rel. RMS)')
    out = {}
    for lv in range(5):
        if not per[lv]:
            continue
        seg = np.concatenate(per[lv])
        r = db(np.sqrt(np.mean(seg ** 2)))
        bands = [band_db(seg, sr, 25, 120), band_db(seg, sr, 120, 500), band_db(seg, sr, 500, 2000),
                 band_db(seg, sr, 2000, 6000), band_db(seg, sr, 6000, 20000)]
        print(f'  {LEVELS[lv]:10s} {len(per[lv]):4d}  {r:6.1f}  ' + '  '.join(f'{b - r:6.1f}' for b in bands))
        out[LEVELS[lv]] = dict(bars=len(per[lv]), rms=round(r, 1), bands=[round(b - r, 1) for b in bands])
    # third-octave profile and transient punch in the loudest rung present
    top = max((lv for lv in range(5) if per[lv]), default=None)
    if top is not None:
        seg = np.concatenate(per[top])
        f, P = signal.welch(seg, sr, nperseg=16384)
        ref = 10 * np.log10(np.sum(P[(f >= 800) & (f < 1250)]) + 1e-20)
        cents = [50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 12500]
        prof = []
        for c in cents:
            m = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))
            prof.append(10 * np.log10(np.sum(P[m]) + 1e-20) - ref)
        print(f'  1/3-oct profile ({LEVELS[top]}, dB re 1 kHz): ' + ' '.join(f'{c}:{v:+.0f}' for c, v in zip(cents, prof)))

        def punch(lo, hi):
            sos = signal.butter(4, [lo, hi], 'bandpass', fs=sr, output='sos')
            y = np.abs(signal.sosfilt(sos, seg))
            w = int(0.01 * sr)
            e = y[: len(y) // w * w].reshape(-1, w).max(axis=1)
            return db(np.percentile(e, 98) / (np.median(e) + 1e-9))
        print(f'  punch (98th pct / median of 10 ms peaks): kick 40-100 Hz {punch(40, 100):.1f} dB, '
              f'snare 150-250 Hz {punch(150, 250):.1f} dB, crack 2-5 kHz {punch(2000, 5000):.1f} dB')
    # per-bus levels by rung, from the analyser taps (dB RMS, mono downmix)
    lv = info.get('levels', [])
    if lv and bars:
        keys = [k for k in lv[0].keys() if k != 't']
        starts = [b['t0'] for b in bars]
        import bisect
        acc = {i: {k: [] for k in keys} for i in range(5)}
        for row in lv:
            i = bisect.bisect_right(starts, row['t']) - 1
            if i < 0 or bars[i].get('build'):
                continue
            if i + 1 < len(bars) and bars[i + 1]['t0'] - bars[i]['t0'] > 5:
                continue
            for k in keys:
                acc[bars[i]['level']][k].append(row[k])
        print('  K-weighted dB (drum pieces pre drum-bus fader)\n            ' + ' '.join(f'{k:>6s}' for k in keys))
        for i in range(5):
            if not acc[i][keys[0]]:
                continue
            print(f'  {LEVELS[i]:9s} ' + ' '.join(f'{max(-99, db(np.sqrt(np.mean(acc[i][k])))):6.1f}' for k in keys))
    # ladder trace (one char per bar) with the scripted moments
    trace = ''.join('^' if b.get('build') else 'PRCBX'[b['level']] for b in bars)
    print('  ladder:', trace)
    times = [b['t0'] for b in bars]
    marks = []
    for s in info.get('spec', []):
        if s[1] in ('finalKill', 'roundEnd', 'roundStart', 'matchEnd'):
            marks.append(f'{s[1]}@{s[0]:.0f}s')
    print('  moments:', ', '.join(marks))
    # intensity over time from states
    st = info.get('states', [])
    if st:
        line = ' '.join(f'{s["t"]:.0f}:{s["intensity"]:.2f}{s["levelName"][0]}' for s in st[::10])
        print('  intensity:', line)
    # 1 s RMS envelope summary
    w = sr
    env = [db(np.sqrt(np.mean(mono[i:i + w] ** 2))) for i in range(0, len(mono) - w, w)]
    print('  RMS per 5 s:', ' '.join(f'{np.mean(env[i:i + 5]):.0f}' for i in range(0, len(env), 5)))
    # stereo: correlation over loud sections
    L, R = x[:, 0], x[:, 1]
    c = float(np.dot(L, R) / (np.sqrt(np.dot(L, L) * np.dot(R, R)) + 1e-12))
    print(f'  L/R correlation {c:.2f}')
    if png:
        p = wav.with_suffix('.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-lavfi',
                        'showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log:stop=16000:color=intensity', str(p)], check=True)
        print('  spectrogram', p)
    return dict(rungs=out, peak=round(db(pk), 2), true_peak=round(db(tp), 2), trace=trace)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    d = Path(args[0] if args else '/tmp/splinterhall-music-renders')
    png = '--png' in sys.argv
    res = {}
    for wav in sorted(d.glob('match-*.wav')):
        res[wav.stem] = analyse(wav, wav.with_suffix('.json'), png)
    (d / 'analysis.json').write_text(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
