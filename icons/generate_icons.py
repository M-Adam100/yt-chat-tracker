#!/usr/bin/env python3
"""Generate simple PNG icons (no external deps).

Draws a YouTube-red rounded square with a white speech bubble + magnifier dot.
Run: python3 icons/generate_icons.py
"""
import os
import struct
import zlib

RED = (255, 0, 51, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def rounded(x, y, w, h, r):
    if x < r and y < r:
        return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > w - 1 - r and y < r:
        return (x - (w - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > h - 1 - r:
        return (x - r) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
    if x > w - 1 - r and y > h - 1 - r:
        return (x - (w - 1 - r)) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
    return True


def make(size):
    w = h = size
    px = [[CLEAR for _ in range(w)] for _ in range(h)]
    r = max(2, size // 6)

    # Rounded red background.
    for y in range(h):
        for x in range(w):
            if rounded(x, y, w, h, r):
                px[y][x] = RED

    # White speech bubble body (rounded rect) roughly centered/upper area.
    bx0, by0 = int(size * 0.22), int(size * 0.24)
    bx1, by1 = int(size * 0.78), int(size * 0.60)
    br = max(1, size // 12)
    bw, bh = bx1 - bx0, by1 - by0
    for y in range(by0, by1):
        for x in range(bx0, bx1):
            if rounded(x - bx0, y - by0, bw, bh, br):
                px[y][x] = WHITE

    # Little tail on the bubble (triangle pointing down-left).
    tail_top = by1 - 1
    tail_x = bx0 + int(bw * 0.28)
    tail_h = max(2, size // 8)
    for i in range(tail_h):
        yy = tail_top + i
        if 0 <= yy < h:
            for x in range(tail_x, tail_x + (tail_h - i)):
                if 0 <= x < w:
                    px[yy][x] = WHITE

    # Three red "text" dots inside the bubble.
    cy = (by0 + by1) // 2
    dot_r = max(1, size // 22)
    for k, fx in enumerate((0.36, 0.5, 0.64)):
        cx = int(size * fx)
        for y in range(cy - dot_r, cy + dot_r + 1):
            for x in range(cx - dot_r, cx + dot_r + 1):
                if 0 <= x < w and 0 <= y < h and (x - cx) ** 2 + (y - cy) ** 2 <= dot_r * dot_r:
                    px[y][x] = RED

    return px, w, h


def write_png(path, px, w, h):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            raw.extend(px[y][x])

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for size in (16, 48, 128):
        px, w, h = make(size)
        out = os.path.join(here, f"icon{size}.png")
        write_png(out, px, w, h)
        print("wrote", out)


if __name__ == "__main__":
    main()
