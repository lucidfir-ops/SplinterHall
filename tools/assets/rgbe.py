"""Minimal Radiance RGBE (.hdr) reader and writer, numpy only.

read_hdr(path) -> float32 array (H, W, 3), linear radiance
write_hdr(path, img, rle=True) writes new-style RLE scanlines (the format
three.js' HDRLoader / RGBELoader read).
"""
import numpy as np


def read_hdr(path):
    with open(path, 'rb') as f:
        data = f.read()
    # header: lines until a blank line, then the resolution line
    pos = 0
    fmt_ok = False
    while True:
        end = data.index(b'\n', pos)
        line = data[pos:end].strip()
        pos = end + 1
        if line.startswith(b'FORMAT=') and b'32-bit_rle_rgbe' in line:
            fmt_ok = True
        if line == b'':
            break
    if not fmt_ok:
        raise ValueError('not a 32-bit_rle_rgbe file: ' + path)
    end = data.index(b'\n', pos)
    res = data[pos:end].split()
    pos = end + 1
    if res[0] != b'-Y' or res[2] != b'+X':
        raise ValueError('unsupported orientation %r' % res)
    h, w = int(res[1]), int(res[3])
    buf = np.frombuffer(data, dtype=np.uint8, offset=pos)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    p = 0
    for y in range(h):
        if w < 8 or w > 0x7fff or buf[p] != 2 or buf[p + 1] != 2 or (buf[p + 2] & 0x80):
            # flat (uncompressed) scanline
            out[y] = buf[p:p + w * 4].reshape(w, 4)
            p += w * 4
            continue
        if (int(buf[p + 2]) << 8 | int(buf[p + 3])) != w:
            raise ValueError('bad scanline width')
        p += 4
        for c in range(4):
            x = 0
            row = out[y, :, c]
            while x < w:
                n = int(buf[p]); p += 1
                if n > 128:
                    n -= 128
                    row[x:x + n] = buf[p]; p += 1
                else:
                    row[x:x + n] = buf[p:p + n]; p += n
                x += n
    e = out[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - (128 + 8)), 0.0).astype(np.float32)
    return out[..., :3].astype(np.float32) * scale[..., None]


def _to_rgbe(img):
    img = np.maximum(img.astype(np.float32), 0)
    m = img.max(axis=2)
    mant, ex = np.frexp(m)
    ok = m > 1e-32
    sc = np.where(ok, mant * 256.0 / np.where(ok, m, 1), 0)
    rgb = np.clip(np.floor(img * sc[..., None]), 0, 255).astype(np.uint8)
    e = np.where(ok, ex + 128, 0).astype(np.uint8)
    return np.concatenate([rgb, e[..., None]], axis=2)


def _rle_channel(row):
    out = bytearray()
    w = len(row)
    x = 0
    while x < w:
        # look for a run of >= 3 starting at x
        run_start = x
        while run_start < w:
            r = 1
            while run_start + r < w and r < 127 and row[run_start + r] == row[run_start]:
                r += 1
            if r >= 3:
                break
            run_start += 1
        # literal bytes before the run
        while x < run_start:
            n = min(128, run_start - x)
            out.append(n)
            out += bytes(row[x:x + n])
            x += n
        if run_start < w:
            r = 1
            while run_start + r < w and r < 127 and row[run_start + r] == row[run_start]:
                r += 1
            out.append(128 + r)
            out.append(int(row[run_start]))
            x = run_start + r
    return out


def write_hdr(path, img, rle=True, comment=None):
    h, w, _ = img.shape
    rgbe = _to_rgbe(img)
    hdr = b'#?RADIANCE\n'
    if comment:
        for line in comment.splitlines():
            hdr += b'# ' + line.encode('ascii', 'replace') + b'\n'
    hdr += b'FORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (h, w)
    body = bytearray()
    for y in range(h):
        if rle and 8 <= w <= 0x7fff:
            body += bytes([2, 2, (w >> 8) & 0xff, w & 0xff])
            for c in range(4):
                body += _rle_channel(rgbe[y, :, c])
        else:
            body += rgbe[y].tobytes()
    with open(path, 'wb') as f:
        f.write(hdr)
        f.write(body)


def downscale(img, w, h):
    """Box-filter downscale by an integer factor (energy preserving)."""
    H, W, _ = img.shape
    fy, fx = H // h, W // w
    if fy * h != H or fx * w != W:
        raise ValueError('size must divide evenly: %dx%d -> %dx%d' % (W, H, w, h))
    return img.reshape(h, fy, w, fx, 3).mean(axis=(1, 3))
