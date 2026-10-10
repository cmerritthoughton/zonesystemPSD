"""Write the plugin's PNG icons: an eleven-step zone ladder, black to white."""
import struct, zlib, os, sys

def png(path, w, h, pixel):
    rows = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)

def ladder(size, inset):
    def pixel(x, y):
        if x < inset or x >= size - inset or y < inset or y >= size - inset:
            return (0, 0, 0, 0)
        k = min(10, int((x - inset) / (size - 2 * inset) * 11))
        g = round(255 * (k / 10) ** 1.2)
        return (g, g, g, 255)
    return pixel

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "plugin", "icons")
for name, base, inset in (("plugin", 48, 4), ("panel", 23, 2)):
    for scale in (1, 2):
        s = base * scale
        png(os.path.join(out, f"{name}@{scale}x.png"), s, s, ladder(s, inset * scale))
print("icons written")
