"""Draws the app icon: a white sugar packet with crimped ends and a magnifying glass, on packet pink."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

PINK = (207, 47, 123, 255)
PINK_DEEP = (150, 22, 84, 255)
WHITE = (255, 255, 255, 255)
PLUM = (42, 18, 30, 255)
S = 1024  # work size; downsampled at the end


def packet_layer(scale):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = 600 * scale, 400 * scale
    cx, cy = S / 2 - 40 * scale, S / 2 - 50 * scale
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    tooth, teeth = 26 * scale, 7
    pts = [(x0 + tooth, y0), (x1 - tooth, y0)]
    for i in range(1, teeth * 2):
        pts.append((x1 - tooth if i % 2 == 0 else x1, y0 + h * i / (teeth * 2)))
    pts += [(x1 - tooth, y1), (x0 + tooth, y1)]
    for i in range(teeth * 2 - 1, 0, -1):
        pts.append((x0 + tooth if i % 2 == 0 else x0, y0 + h * i / (teeth * 2)))
    d.polygon(pts, fill=WHITE)
    inset = 62 * scale
    d.rounded_rectangle((x0 + inset, y0 + inset * 0.8, x1 - inset, y1 - inset * 0.8),
                        radius=18 * scale, outline=PINK, width=int(16 * scale))
    # printed label lines on the packet face
    d.rounded_rectangle((cx - 150 * scale, cy - 52 * scale, cx + 150 * scale, cy + 6 * scale),
                        radius=29 * scale, fill=PINK)
    d.rounded_rectangle((cx - 100 * scale, cy + 38 * scale, cx + 100 * scale, cy + 64 * scale),
                        radius=13 * scale, fill=(240, 170, 200, 255))
    return layer.rotate(10, resample=Image.BICUBIC, center=(S / 2, S / 2))


def magnifier_layer(scale):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, r = S / 2 + 120 * scale, S / 2 + 110 * scale, 150 * scale
    stroke = 46 * scale
    # handle
    import math
    a = math.radians(45)
    hx0, hy0 = cx + (r + stroke / 2 - 6 * scale) * math.cos(a), cy + (r + stroke / 2 - 6 * scale) * math.sin(a)
    hx1, hy1 = cx + (r + 175 * scale) * math.cos(a), cy + (r + 175 * scale) * math.sin(a)
    d.line((hx0, hy0, hx1, hy1), fill=PLUM, width=int(66 * scale))
    d.ellipse((hx1 - 33 * scale, hy1 - 33 * scale, hx1 + 33 * scale, hy1 + 33 * scale), fill=PLUM)
    # lens: faint glass + ring
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 70))
    d.ellipse((cx - r - stroke / 2, cy - r - stroke / 2, cx + r + stroke / 2, cy + r + stroke / 2),
              outline=PLUM, width=int(stroke))
    return layer


def compose(scale, corner=0):
    img = Image.new("RGBA", (S, S), PINK)
    # soft deeper band at the bottom for depth
    shade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse((-S * 0.4, S * 0.62, S * 1.4, S * 1.6), fill=PINK_DEEP)
    img = Image.alpha_composite(img, shade)
    img = Image.alpha_composite(img, packet_layer(scale))
    img = Image.alpha_composite(img, magnifier_layer(scale))
    if corner:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=corner, fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    return img


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    full = compose(0.86)
    rounded = compose(0.86, corner=200)
    maskable = compose(0.66)
    rounded.resize((192, 192), Image.LANCZOS).save(out / "icon-192.png")
    rounded.resize((512, 512), Image.LANCZOS).save(out / "icon-512.png")
    maskable.resize((512, 512), Image.LANCZOS).save(out / "maskable-512.png")
    maskable.resize((192, 192), Image.LANCZOS).save(out / "maskable-192.png")
    full.convert("RGB").resize((180, 180), Image.LANCZOS).save(out / "apple-touch-icon.png")
    full.resize((64, 64), Image.LANCZOS).save(out / "favicon-64.png")
    full.resize((1024, 1024)).save(out / "_preview-1024.png")


if __name__ == "__main__":
    main(sys.argv[1])
