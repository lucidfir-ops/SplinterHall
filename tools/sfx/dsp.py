"""Small offline DSP kit for building Splinterhall's sound effects (numpy/scipy).

Everything works on mono float32 arrays at SR (44.1 kHz). Sources are decoded
with ffmpeg. Used by tools/sfx/build_sfx.py.
"""
import os
import subprocess
from fractions import Fraction

import numpy as np
from scipy import signal

SR = 44100
_cache = {}
ROOTS = {}   # prefix -> folder, filled by build_sfx.py
EXT = {}     # prefix -> default extension
USED = {}    # source key -> set of output names (for CREDITS.md)
_current = [None]


def set_current(name):
    _current[0] = name


def resolve(key):
    pre, rest = key.split(':', 1)
    path = os.path.join(ROOTS[pre], rest)
    if not os.path.splitext(rest)[1]:
        path += EXT[pre]
    return path


def load(key):
    if _current[0]:
        USED.setdefault(key, set()).add(_current[0])
    if key not in _cache:
        path = resolve(key)
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR),
                            '-f', 'f32le', '-'], capture_output=True, check=True)
        x = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
        x = x - np.mean(x[:min(len(x), 2048)]) * 0  # keep as is; DC removed by final HPF
        _cache[key] = x
    return _cache[key].copy()


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def undb(d):
    return 10 ** (d / 20)


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def norm(x, to=1.0):
    p = peak(x)
    return x * (to / p) if p > 0 else x


def trim_lead(x, thr_db=-42, pre=0.002):
    """Drop leading silence (relative to the file's peak), keep `pre` s before the onset."""
    p = peak(x)
    if p == 0:
        return x
    idx = np.where(np.abs(x) > p * undb(thr_db))[0]
    if not len(idx):
        return x
    start = max(0, idx[0] - int(pre * SR))
    return x[start:]


def trim_tail(x, thr_db=-50, hold=0.01):
    p = peak(x)
    if p == 0:
        return x
    # 5 ms envelope so a quiet sample inside a decaying ring doesn't cut early
    n = int(0.005 * SR)
    env = np.sqrt(np.convolve(x ** 2, np.ones(n) / n, mode='same'))
    idx = np.where(env > p * undb(thr_db))[0]
    if not len(idx):
        return x
    end = min(len(x), idx[-1] + int(hold * SR))
    return x[:end]


def seg(x, a=0.0, d=None):
    s = int(a * SR)
    e = len(x) if d is None else min(len(x), s + int(d * SR))
    return x[s:e]


def rate(x, r):
    """Tape-speed change: r > 1 is higher and shorter."""
    if abs(r - 1) < 1e-4:
        return x
    f = Fraction(1 / r).limit_denominator(400)
    return signal.resample_poly(x, f.numerator, f.denominator)


def sweep_rate(x, r0, r1):
    """Tape-speed that glides from r0 to r1 over the sound (for falls and Doppler)."""
    n = len(x)
    # output sample k reads input at position p(k); integrate the rate
    out_len = int(n / ((r0 + r1) / 2))
    rk = np.linspace(r0, r1, out_len)
    pos = np.cumsum(rk)
    pos = pos[pos < n - 1]
    return np.interp(pos, np.arange(n), x)


def _sos(kind, f, order=2):
    if isinstance(f, (list, tuple)):
        wn = [v / (SR / 2) for v in f]
    else:
        wn = f / (SR / 2)
    return signal.butter(order, wn, btype=kind, output='sos')


def hp(x, f, order=2):
    return signal.sosfilt(_sos('highpass', f, order), x)


def lp(x, f, order=2):
    return signal.sosfilt(_sos('lowpass', f, order), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos('bandpass', [lo, hi], order), x)


def peaking(x, f, gain_db, q=1.0):
    """RBJ peaking EQ."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return signal.lfilter(b, a, x)


def shelf_lo(x, f, gain_db):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / 2 * np.sqrt(2)
    c = np.cos(w)
    sa = 2 * np.sqrt(A) * al
    b = [A * ((A + 1) - (A - 1) * c + sa), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sa)]
    a = [(A + 1) + (A - 1) * c + sa, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sa]
    return signal.lfilter(b, a, x)


def fade(x, fi=0.001, fo=0.01):
    x = x.copy()
    ni, no = min(len(x), int(fi * SR)), min(len(x), int(fo * SR))
    if ni > 1:
        x[:ni] *= np.sin(np.linspace(0, np.pi / 2, ni)) ** 2
    if no > 1:
        x[-no:] *= np.cos(np.linspace(0, np.pi / 2, no)) ** 2
    return x


def decay(x, start, tau):
    """Exponential decay applied after `start` s (shortens long rings)."""
    t = np.arange(len(x)) / SR
    env = np.where(t < start, 1.0, np.exp(-(t - start) / tau))
    return x * env


def env_ad(x, attack, hold, release):
    t = np.arange(len(x)) / SR
    env = np.clip(t / max(attack, 1e-4), 0, 1)
    env = np.where(t > attack + hold, np.exp(-(t - attack - hold) / max(release, 1e-4)), env)
    return x * env


def sat(x, drive=2.0):
    p = peak(x)
    if p == 0:
        return x
    y = np.tanh(drive * x / p) / np.tanh(drive)
    return y * p


def rev(x):
    return x[::-1].copy()


def noise(dur, seed=1):
    rng = np.random.default_rng(seed)
    return rng.standard_normal(int(dur * SR)) * 0.3


class L:
    """One layer: source key + edits. Rendered peak-normalised, then `g` dB."""

    def __init__(self, src, a=0.0, d=None, r=1.0, g=0.0, at=0.0, hp=None, lp=None,
                 fi=0.0015, fo=0.012, tail=None, sat=None, trim=True, fx=None):
        self.__dict__.update(dict(src=src, a=a, d=d, r=r, g=g, at=at, hp=hp, lp=lp, fi=fi,
                                  fo=fo, tail=tail, sat=sat, trim=trim, fx=fx))

    def render(self):
        x = self.src if isinstance(self.src, np.ndarray) else load(self.src)
        if self.trim:
            x = trim_lead(x)
        x = seg(x, self.a, self.d)
        if self.r != 1:
            x = rate(x, self.r)
        if self.hp:
            x = hp(x, self.hp)
        if self.lp:
            x = lp(x, self.lp)
        if self.fx:
            x = self.fx(x)
        if self.tail:
            x = decay(x, *self.tail)
        if self.sat:
            x = sat(x, self.sat)
        x = fade(x, self.fi, self.fo)
        return norm(x) * undb(self.g)


def mix(*layers, dur=None):
    rendered = [(ly.render(), int(ly.at * SR)) for ly in layers]
    n = max(len(x) + o for x, o in rendered)
    if dur:
        n = min(n, int(dur * SR))
    out = np.zeros(n)
    for x, o in rendered:
        if o >= n:
            continue
        m = min(len(x), n - o)
        out[o:o + m] += x[:m]
    return out


# ---- loudness -------------------------------------------------------------
def k_weight(x):
    """Approximate ITU-R BS.1770 K-weighting (high shelf +4 dB, high-pass ~60 Hz)."""
    y = hp(x, 60, 2)
    # high shelf: +4 dB above ~1.5 kHz
    A = 10 ** (4 / 40)
    w = 2 * np.pi * 1500 / SR
    al = np.sin(w) / 2 * np.sqrt(2)
    c = np.cos(w)
    sa = 2 * np.sqrt(A) * al
    b = [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa)]
    a = [(A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa]
    return signal.lfilter(b, a, y)


def loudness(x, win=0.05):
    """Max K-weighted RMS over `win`-second windows, in dBFS."""
    y = k_weight(x)
    n = max(1, int(win * SR))
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    e = np.convolve(y ** 2, np.ones(n) / n, mode='valid')
    return float(db(np.sqrt(e.max())))


def limit(x, ceil_db=-1.0, lookahead=0.002, release=0.06):
    """Look-ahead peak limiter: gain never lets |x| exceed the ceiling, attack
    within `lookahead`, one-pole release. Returns the limited signal."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    c = undb(ceil_db)
    a = np.abs(x)
    g = np.minimum(1.0, c / np.maximum(a, 1e-12))
    la = max(1, int(lookahead * SR))
    g = minimum_filter1d(g, size=2 * la + 1, mode='nearest')
    g = uniform_filter1d(g, size=la, mode='nearest')
    # release: gain may fall instantly but only rises with time constant `release`
    k = 1 - np.exp(-1.0 / (release * SR))
    y = np.empty_like(g)
    prev = 1.0
    for i in range(len(g)):
        v = g[i]
        prev = v if v < prev else prev + (v - prev) * k
        y[i] = prev
    out = x * y
    return np.clip(out, -c, c)
