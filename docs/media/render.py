#!/usr/bin/env python3
"""Render a captured terminal session into a GIF for the README.

Documentation tooling, not part of the tool: it needs Pillow and ffmpeg, which
omakit itself does not. It exists so the GIFs in this directory are reproducible
rather than magic, and so nobody has to trust that the recording matches what the
command actually prints.

The input is the real, unedited stdout of a real run, captured with FORCE_COLOR=1
(see README.md in this directory for the exact commands). This script types the
command, reveals the captured output line by line, and scrolls. It never invents
a line: every character it draws came out of the program.

Usage:
    python3 docs/media/render.py <scene.json> <out.gif>

A scene file is {"title", "width", "rows", "steps": [{"command", "capture",
"hold"}]}.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
FONT_SIZE = 14
LINE_HEIGHT = 19
PAD_X = 18
PAD_TOP = 34
PAD_BOTTOM = 14

BG = (13, 17, 23)
CHROME = (22, 27, 34)
BORDER = (48, 54, 61)
FG = (201, 209, 217)
BRIGHT = (240, 246, 252)
DOTS = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]

ANSI = {
    31: (255, 123, 114),
    32: (63, 185, 80),
    33: (210, 153, 34),
    34: (121, 192, 255),
    36: (57, 197, 207),
    90: (139, 148, 158),
}

SGR = re.compile(r"\x1b\[([0-9;]*)m")


def spans(line):
    """Split one captured line into (text, colour, bold) spans."""
    out = []
    colour, bold, at = FG, False, 0
    for match in SGR.finditer(line):
        if match.start() > at:
            out.append((line[at:match.start()], colour, bold))
        for code in (int(part or 0) for part in match.group(1).split(";")):
            if code == 0:
                colour, bold = FG, False
            elif code == 1:
                bold = True
            elif code == 2:
                colour = ANSI[90]
            elif code in ANSI:
                colour = ANSI[code]
        at = match.end()
    if at < len(line):
        out.append((line[at:], colour, bold))
    return out


def elide(lines, omissions):
    """Replace 1-indexed [first, last] ranges with one visible marker line.

    A GIF that quietly dropped output would be a lie about what the command
    prints. Nothing is reordered and nothing is rewritten: where a block is left
    out for length, a dim line says so and says what it was.
    """
    if not omissions:
        return lines
    keep, cut = [], {}
    for first, last, label in omissions:
        for number in range(first, last + 1):
            cut[number] = label
    marked = set()
    for number, line in enumerate(lines, start=1):
        label = cut.get(number)
        if label is None:
            keep.append(line)
        elif label not in marked:
            marked.add(label)
            keep.append(f"\x1b[90m       [{label}]\x1b[0m")
    return keep


def measure(font, text):
    return font.getlength(text)


def frame(title, cols, rows, lines, cursor=None):
    """Draw one frame: window chrome plus `rows` rows of `lines`."""
    regular = ImageFont.truetype(FONT_REGULAR, FONT_SIZE)
    bold = ImageFont.truetype(FONT_BOLD, FONT_SIZE)
    width = int(PAD_X * 2 + measure(regular, "M" * cols))
    height = PAD_TOP + rows * LINE_HEIGHT + PAD_BOTTOM
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)

    draw.rectangle([0, 0, width - 1, PAD_TOP - 10], fill=CHROME)
    draw.line([(0, PAD_TOP - 10), (width, PAD_TOP - 10)], fill=BORDER)
    for index, colour in enumerate(DOTS):
        x = 14 + index * 16
        draw.ellipse([x, 8, x + 9, 17], fill=colour)
    draw.text(
        (width // 2 - measure(regular, title) // 2, 5),
        title,
        font=ImageFont.truetype(FONT_REGULAR, 12),
        fill=ANSI[90],
    )

    for row, line in enumerate(lines[-rows:]):
        y = PAD_TOP + row * LINE_HEIGHT
        x = PAD_X
        for text, colour, is_bold in spans(line):
            font = bold if is_bold else regular
            draw.text((x, y), text, font=font, fill=BRIGHT if is_bold and colour == FG else colour)
            x += measure(font, text)
        if cursor is not None and row == len(lines[-rows:]) - 1 and cursor:
            draw.rectangle([x + 1, y + 2, x + int(measure(regular, "M")), y + LINE_HEIGHT - 3], fill=FG)
    return image


def build(scene, out_path):
    cols, rows = scene["width"], scene["rows"]
    title = scene["title"]
    frames = []  # (image, centiseconds)
    screen = []

    def shot(delay, cursor=None):
        frames.append((frame(title, cols, rows, screen or [""], cursor), delay))

    for step in scene["steps"]:
        prompt = "\x1b[32m$\x1b[0m "
        command = step["command"]
        screen.append(prompt)
        # Type the command in bursts, so it reads as typing without spending a
        # frame per character or a second of the GIF on an empty screen.
        burst = scene.get("typing", 6)
        for end in range(0, len(command) + 1, burst):
            screen[-1] = prompt + command[:end]
            shot(3, cursor=True)
        screen[-1] = prompt + command
        shot(70, cursor=True)

        captured = Path(step["capture"]).read_text().rstrip("\n").split("\n")
        captured = elide(captured, step.get("omit", []))
        reveal = step.get("reveal", 2)
        pace = step.get("pace", 9)
        # "pauses": [[line number after elision, centiseconds], ...] holds the
        # frame once that line is on screen, so a reader can actually read the
        # part that matters.
        pauses = {int(line): int(delay) for line, delay in step.get("pauses", [])}
        for index in range(0, len(captured), reveal):
            screen.extend(captured[index:index + reveal])
            last = min(index + reveal, len(captured))
            hold = max([pace] + [delay for line, delay in pauses.items() if index < line <= last])
            shot(hold)
        shot(step.get("hold", 260))
        screen.append("")

    with tempfile.TemporaryDirectory() as work:
        listing = Path(work) / "frames.txt"
        entries = []
        for index, (image, delay) in enumerate(frames):
            name = Path(work) / f"f{index:05d}.png"
            image.save(name)
            entries.append(f"file '{name}'\nduration {delay / 100:.2f}\n")
        entries.append(f"file '{Path(work)}/f{len(frames) - 1:05d}.png'\n")
        listing.write_text("".join(entries))

        palette = Path(work) / "palette.png"
        run = lambda args: subprocess.run(args, check=True, capture_output=True)
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-vf", "palettegen=max_colors=32:stats_mode=diff", str(palette)])
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-i", str(palette),
             "-lavfi", "paletteuse=dither=none:diff_mode=rectangle", "-loop", "0", str(out_path)])
    return len(frames), Path(out_path).stat().st_size


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is required")
    scene = json.loads(Path(sys.argv[1]).read_text())
    count, size = build(scene, sys.argv[2])
    print(f"{sys.argv[2]}: {count} frames, {size / 1024:.0f} KB")
