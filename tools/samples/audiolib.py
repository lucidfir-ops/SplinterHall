"""Shared audio helpers for the Splinterhall sample pipeline (numpy + scipy + ffmpeg).

Everything works on mono float32 arrays at 44.1 kHz.
"""
import subprocess
import numpy as np
from fractions import Fraction
from scipy import signal

SR = 44100


def load(path, sr=SR):
    """Decode any audio file with ffmpeg to mono float32."""
    out = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
        check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def save_wav(path, x, sr=SR):
    x = np.clip(np.asarray(x, dtype=np.float32), -1, 1)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                    '-c:a', 'pcm_s16le', str(path)], input=x.tobytes(), check=True)


def encode_mp3(path, x, kbps, sr=SR):
    x = np.clip(np.asarray(x, dtype=np.float32), -1, 1)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-ar', str(sr), '-ac', '1', '-write_xing', '1',
                    str(path)], input=x.tobytes(), check=True)


def db(v):
    return 20 * np.log10(max(float(v), 1e-12))


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)))) if len(x) else 0.0


def env(x, win=256):
    """Peak-ish envelope (moving max of |x|) used for onset and tail detection."""
    a = np.abs(x)
    n = len(a) // win
    if n == 0:
        return np.array([peak(x)])
    return a[:n * win].reshape(n, win).max(axis=1)


def onset(x, thresh_db=-40):
    """Index of the first sample above thresh relative to the peak."""
    p = peak(x)
    if p <= 0:
        return 0
    idx = np.nonzero(np.abs(x) > p * 10 ** (thresh_db / 20))[0]
    return int(idx[0]) if len(idx) else 0


def trim(x, head_db=-42, tail_db=-60, pre_ms=1.5, max_len=None, fade_ms=None):
    """Trim leading silence (keeping a short pre-roll) and the tail below tail_db, then fade out."""
    p = peak(x)
    if p <= 0:
        return x
    s = max(0, onset(x, head_db) - int(SR * pre_ms / 1000))
    x = x[s:]
    e = env(x, 256)
    above = np.nonzero(e > p * 10 ** (tail_db / 20))[0]
    end = (above[-1] + 1) * 256 if len(above) else len(x)
    end = min(end, len(x))
    if max_len:
        end = min(end, int(max_len * SR))
    x = x[:end].copy()
    if len(x) > 8:
        fi = min(len(x) // 4, int(SR * 0.0008))  # tiny fade-in so the cut is click free
        x[:fi] *= np.linspace(0, 1, fi, endpoint=False) ** 0.5 if fi else 1
        fo = int(SR * (fade_ms / 1000)) if fade_ms else min(len(x) // 3, int(SR * 0.08))
        fo = min(fo, len(x) - 1)
        if fo > 0:
            x[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    return x


def noise_floor_db(x, win_ms=50):
    """Quietest window level relative to peak (dB)."""
    w = int(SR * win_ms / 1000)
    n = len(x) // w
    if n < 2:
        return 0.0
    r = np.sqrt(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1))
    return db(r.min() / max(peak(x), 1e-9))


def band_ratio(x, lo, hi):
    """Fraction of spectral energy between lo and hi Hz."""
    if len(x) < 64:
        return 0.0
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    tot = X.sum() + 1e-20
    return float(X[(f >= lo) & (f < hi)].sum() / tot)


def centroid(x):
    if len(x) < 64:
        return 0.0
    X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((X * f).sum() / (X.sum() + 1e-20))


def attack_ms(x):
    """10% to 90% of peak envelope rise time."""
    e = env(x, 32)
    p = e.max()
    if p <= 0:
        return 0.0
    i10 = np.argmax(e > 0.1 * p)
    i90 = np.argmax(e > 0.9 * p)
    return (i90 - i10) * 32 / SR * 1000


def decay_s(x, drop_db=30):
    """Seconds from the peak until the envelope falls drop_db below it."""
    e = env(x, 256)
    ip = int(np.argmax(e))
    thr = e[ip] * 10 ** (-drop_db / 20)
    after = np.nonzero(e[ip:] < thr)[0]
    return (after[0] if len(after) else len(e) - ip) * 256 / SR


# ---------------------------------------------------------------- pitch

def midi_to_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def hz_to_midi(f):
    return 69 + 12 * np.log2(f / 440.0)


def yin_pitch(x, fmin=30, fmax=2000, start_s=None, dur_s=0.6):
    """YIN pitch estimate over a steady chunk (default: skip the attack). Returns Hz or None."""
    if start_s is None:
        start_s = 0.08 if len(x) > SR * 0.4 else 0.02
    s = int(start_s * SR)
    seg = x[s:s + int(dur_s * SR)]
    if len(seg) < SR * 0.05:
        seg = x[:int(dur_s * SR)]
    W = 2048 if fmin < 60 else 1024
    tau_max = int(SR / fmin)
    tau_min = int(SR / fmax)
    hops = range(0, max(1, len(seg) - W - tau_max), 512)
    ests = []
    for h in hops:
        frame = seg[h:h + W + tau_max]
        if len(frame) < W + tau_max:
            break
        if rms(frame) < 1e-4:
            continue
        d = np.zeros(tau_max + 1)
        x0 = frame[:W]
        for tau in range(1, tau_max + 1):
            diff = x0 - frame[tau:tau + W]
            d[tau] = np.dot(diff, diff)
        cmnd = np.ones_like(d)
        cs = np.cumsum(d[1:])
        cmnd[1:] = d[1:] * np.arange(1, tau_max + 1) / (cs + 1e-20)
        cand = np.nonzero(cmnd[tau_min:] < 0.15)[0]
        if len(cand):
            t = cand[0] + tau_min
            while t + 1 <= tau_max and cmnd[t + 1] < cmnd[t]:
                t += 1
        else:
            t = int(np.argmin(cmnd[tau_min:]) + tau_min)
            if cmnd[t] > 0.4:
                continue
        # parabolic interpolation
        if 1 <= t < tau_max:
            a, b, c = cmnd[t - 1], cmnd[t], cmnd[t + 1]
            den = a - 2 * b + c
            t = t + (0.5 * (a - c) / den if den != 0 else 0)
        ests.append(SR / t)
    if not ests:
        return None
    return float(np.median(ests))


def fft_partial_pitch(x, expect_hz, start_s=0.02, dur_s=0.5, search_semis=1.2):
    """Strongest spectral peak near the expected fundamental (or its 2nd/3rd harmonic). For struck/plucked sounds."""
    s = int(start_s * SR)
    seg = x[s:s + int(dur_s * SR)]
    n = 1 << int(np.ceil(np.log2(max(len(seg), 4096) * 4)))
    X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    f = np.fft.rfftfreq(n, 1 / SR)
    best = None
    for h in (1, 2, 3):
        c = expect_hz * h
        lo, hi = c * 2 ** (-search_semis / 12), c * 2 ** (search_semis / 12)
        m = (f >= lo) & (f <= hi)
        if not m.any():
            continue
        i = np.nonzero(m)[0][np.argmax(X[m])]
        if 1 <= i < len(X) - 1:
            a, b, cc = np.log(X[i - 1] + 1e-20), np.log(X[i] + 1e-20), np.log(X[i + 1] + 1e-20)
            den = a - 2 * b + cc
            di = 0.5 * (a - cc) / den if den != 0 else 0
        else:
            di = 0
        fr = (i + di) * SR / n / h
        mag = X[i]
        if best is None or mag > best[1] * (1.0 if h == 1 else 1.5):
            best = (fr, mag)
    return best[0] if best else None


def measure_pitch(x, nominal_midi, kind='sustain'):
    """Measured fundamental in fractional MIDI. Falls back to nominal when the tracker disagrees wildly."""
    exp = midi_to_hz(nominal_midi)
    if kind == 'sustain':
        f = yin_pitch(x, fmin=max(25, exp / 1.6), fmax=min(4000, exp * 1.6))
    else:
        f = fft_partial_pitch(x, exp)
        if f is None:
            f = yin_pitch(x, fmin=max(25, exp / 1.6), fmax=min(4000, exp * 1.6), start_s=0.01, dur_s=0.3)
    if f is None:
        return float(nominal_midi), False
    m = float(hz_to_midi(f))
    # octave errors: fold to within 6 semis of the nominal
    while m - nominal_midi > 6:
        m -= 12
    while nominal_midi - m > 6:
        m += 12
    if abs(m - nominal_midi) > 1.5:
        return float(nominal_midi), False
    return m, True


def resample_semis(x, semis):
    """Varispeed by `semis` semitones (positive = up = shorter)."""
    if abs(semis) < 0.005:
        return x
    ratio = 2 ** (semis / 12)  # output plays `ratio` times faster
    fr = Fraction(ratio).limit_denominator(3000)
    up, down = fr.denominator, fr.numerator
    return signal.resample_poly(x.astype(np.float64), up, down).astype(np.float32)


def find_loop(x, midi, min_len_s=0.35, region=(0.45, 0.85)):
    """Pick loop points in the sustain region: a span of whole pitch periods with the best waveform match.
    Returns (start, end) sample indices or None."""
    n = len(x)
    period = SR / midi_to_hz(midi)
    a0, a1 = int(n * region[0]), int(n * region[1])
    if a1 - a0 < SR * min_len_s:
        return None
    W = int(max(256, period * 2))
    best = None
    k_min = int(np.ceil(SR * min_len_s / period))
    for k in range(k_min, k_min + 40):
        L = int(round(k * period))
        for s in range(a0, a1 - L - W, max(1, int(period // 3))):
            e = s + L
            if e + W >= n:
                break
            a, b = x[s:s + W], x[e:e + W]
            c = np.dot(a, b) / (np.sqrt(np.dot(a, a) * np.dot(b, b)) + 1e-12)
            if best is None or c > best[0]:
                best = (c, s, e)
        if best and best[0] > 0.995:
            break
    if not best:
        return None
    return best[1], best[2]


def bake_crossfade_loop(x, s, e, xf_s=0.08):
    """Make the [s, e) loop seamless: blend the audio leading into e with the audio leading into s, so that
    jumping from e back to s continues the waveform. Keeps 0.15 s after e for release and MP3 padding."""
    x = x.copy()
    L = min(int(xf_s * SR), s, e - s - 1)
    if L > 16:
        t = np.linspace(0, 1, L)
        fade_in = np.sin(t * np.pi / 2) ** 2
        # region before e fades toward the region before s
        x[e - L:e] = x[e - L:e] * (1 - fade_in) + x[s - L:s] * fade_in
    return x[:min(len(x), e + int(0.15 * SR))]
