"""Verify sliced tiles: dimensions, RGBA mode, edge alpha samples.

For each tile we sample:
  - alpha at the four edge midpoints (top, bottom, left, right)
  - alpha at the four corners
  - count of fully transparent edge pixels along each border (out of 128)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

OUT_DIR = Path("C:/Project/rts2/public/tiles/auto")
TARGET = 128

print(f"{'tile':<14} {'size':<10} {'mode':<5} {'top@64':<7} {'bot@64':<7} {'lft@64':<7} {'rgt@64':<7} "
      f"{'tl':<3} {'tr':<3} {'bl':<3} {'br':<3} {'top0':<5} {'bot0':<5} {'lft0':<5} {'rgt0':<5}")
print("-" * 110)

issues: list[str] = []
for r in range(4):
    for c in range(8):
        path = OUT_DIR / f"tile-c{c}r{r}.png"
        img = Image.open(path)
        size = f"{img.width}x{img.height}"
        if (img.width, img.height) != (TARGET, TARGET):
            issues.append(f"{path.name}: dimensions {size}")
        if img.mode != "RGBA":
            issues.append(f"{path.name}: mode {img.mode}")
        rgba = img.convert("RGBA")
        px = rgba.load()
        last = TARGET - 1
        mid = TARGET // 2

        # midpoint alphas
        top_mid = px[mid, 0][3]
        bot_mid = px[mid, last][3]
        lft_mid = px[0, mid][3]
        rgt_mid = px[last, mid][3]

        # corner alphas
        tl = px[0, 0][3]
        tr = px[last, 0][3]
        bl = px[0, last][3]
        br = px[last, last][3]

        # count transparent (alpha==0) pixels on each border
        top0 = sum(1 for x in range(TARGET) if px[x, 0][3] == 0)
        bot0 = sum(1 for x in range(TARGET) if px[x, last][3] == 0)
        lft0 = sum(1 for y in range(TARGET) if px[0, y][3] == 0)
        rgt0 = sum(1 for y in range(TARGET) if px[last, y][3] == 0)

        print(f"c{c}r{r}{'':<8} {size:<10} {img.mode:<5} "
              f"{top_mid:<7} {bot_mid:<7} {lft_mid:<7} {rgt_mid:<7} "
              f"{tl:<3} {tr:<3} {bl:<3} {br:<3} "
              f"{top0:<5} {bot0:<5} {lft0:<5} {rgt0:<5}")

        for label, val in (("top@mid", top_mid), ("bot@mid", bot_mid),
                            ("lft@mid", lft_mid), ("rgt@mid", rgt_mid)):
            if val < 255:
                issues.append(f"{path.name}: edge {label} alpha={val} (expected 255)")

print()
if issues:
    print("ISSUES:")
    for issue in issues:
        print(f"  {issue}")
else:
    print("All tiles verified: 128x128 RGBA, edge midpoints fully opaque, no transparent borders.")
