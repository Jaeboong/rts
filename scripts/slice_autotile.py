"""Slice public/tiles/tile.png into 32 seamless 128x128 RGBA tiles.

Approach:
1. Detect white gutters by scanning column-mean and row-mean brightness on the RGB source.
2. Group consecutive columns/rows above the gutter brightness threshold into "gutter runs",
   and consecutive columns/rows below into "content runs".
3. Expect 8 horizontal content runs and 4 vertical content runs (8 cols x 4 rows of tiles).
4. Crop each tile to its content rect verbatim (no further bbox shrink), resize to 128x128 with
   Lanczos, convert to RGBA, save.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path("C:/Project/rts2/public/tiles/tile.png")
OUT_DIR = Path("C:/Project/rts2/public/tiles/auto")

EXPECTED_COLS = 8
EXPECTED_ROWS = 4
TARGET_SIZE = 128

# Brightness threshold to consider a column/row "white gutter".
# White gutters in the sheet are pure ~255; tile content is way below.
GUTTER_BRIGHTNESS = 240.0


def find_content_runs(line_mean: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    """Return inclusive (start, end) ranges of indices whose mean brightness < threshold.

    Treats the array boundary as bounded by gutter (so leading or trailing content
    that touches the image edge still produces a valid run).
    """
    is_content = line_mean < threshold  # True = tile content; False = gutter / off-tile
    runs: list[tuple[int, int]] = []
    n = len(is_content)
    i = 0
    while i < n:
        if not is_content[i]:
            i += 1
            continue
        start = i
        while i < n and is_content[i]:
            i += 1
        end = i - 1
        runs.append((start, end))
    return runs


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src)
    h, w, _ = arr.shape
    print(f"source: {w}x{h}")

    col_mean = arr.mean(axis=(0, 2))  # shape (W,)
    row_mean = arr.mean(axis=(1, 2))  # shape (H,)

    col_runs = find_content_runs(col_mean, GUTTER_BRIGHTNESS)
    row_runs = find_content_runs(row_mean, GUTTER_BRIGHTNESS)

    # Filter out trivially short runs that are noise (e.g. anti-aliased single-pixel
    # speckles inside a gutter). Pick the EXPECTED_COLS longest col runs and
    # EXPECTED_ROWS longest row runs, then resort by start coordinate.
    def pick_runs(runs: list[tuple[int, int]], expected: int, label: str) -> list[tuple[int, int]]:
        if len(runs) < expected:
            raise RuntimeError(
                f"detected only {len(runs)} {label} content runs, expected {expected}: {runs}"
            )
        if len(runs) == expected:
            return runs
        # Keep the `expected` longest by length, then sort positionally.
        runs_sorted = sorted(runs, key=lambda r: (r[1] - r[0]), reverse=True)[:expected]
        return sorted(runs_sorted, key=lambda r: r[0])

    col_runs = pick_runs(col_runs, EXPECTED_COLS, "column")
    row_runs = pick_runs(row_runs, EXPECTED_ROWS, "row")

    print("column content runs (left, right inclusive):")
    for r in col_runs:
        print(f"  {r}  width={r[1] - r[0] + 1}")
    print("row content runs (top, bottom inclusive):")
    for r in row_runs:
        print(f"  {r}  height={r[1] - r[0] + 1}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    saved: list[tuple[str, int]] = []
    for r_idx, (top, bottom) in enumerate(row_runs):
        for c_idx, (left, right) in enumerate(col_runs):
            # PIL crop uses (left, upper, right, lower) where right/lower are exclusive.
            crop = src.crop((left, top, right + 1, bottom + 1))
            resized = crop.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
            rgba = resized.convert("RGBA")  # opaque alpha; no transparent margins added
            out_path = OUT_DIR / f"tile-c{c_idx}r{r_idx}.png"
            rgba.save(out_path, format="PNG")
            saved.append((out_path.name, out_path.stat().st_size))

    print(f"saved {len(saved)} tiles to {OUT_DIR}")
    for name, size in saved:
        print(f"  {name}  {size} bytes")


if __name__ == "__main__":
    main()
