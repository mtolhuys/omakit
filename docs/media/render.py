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

import codecs
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
# A full block at 14px is 18px tall. The line height matches it exactly, so
# block-drawn letters join up instead of breaking into a dot matrix. Any looser
# and the wordmark stops reading as letters.
LINE_HEIGHT = 18
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


def frame(title, cols, rows, lines, cursor=None, size=FONT_SIZE, chrome=True):
    """Draw one frame: optional window chrome plus `rows` rows of `lines`."""
    regular = ImageFont.truetype(FONT_REGULAR, size)
    bold = ImageFont.truetype(FONT_BOLD, size)
    line_height = ImageFont.truetype(FONT_REGULAR, size).getbbox("\u2588")[3] + 1
    pad_top = PAD_TOP if chrome else 14
    width = int(PAD_X * 2 + measure(regular, "M" * cols))
    height = pad_top + rows * line_height + PAD_BOTTOM
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)

    if chrome:
        draw.rectangle([0, 0, width - 1, pad_top - 10], fill=CHROME)
        draw.line([(0, pad_top - 10), (width, pad_top - 10)], fill=BORDER)
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
        y = pad_top + row * line_height
        x = PAD_X
        for text, colour, is_bold in spans(line):
            font = bold if is_bold else regular
            draw.text((x, y), text, font=font, fill=BRIGHT if is_bold and colour == FG else colour)
            x += measure(font, text)
        if cursor is not None and row == len(lines[-rows:]) - 1 and cursor:
            draw.rectangle([x + 1, y + 2, x + int(measure(regular, "M")), y + line_height - 3], fill=FG)
    return image


SEQ = re.compile(r"\x1b\[([0-9;]*)([A-Za-z])")


def replay(out_path, timing_path, min_delay=3, max_delay=260):
    """Turn a `script --log-out --log-timing` capture into (screen, delay) frames.

    The screen model is line oriented on purpose, because that is exactly how
    this tool draws: the wordmark rewrites its five rows in place and the
    progress line rewrites itself. Carriage return, erase-line and cursor-up are
    honoured; anything else is passed through into the line, where the SGR parser
    that draws a frame handles it. Consecutive identical screens are collapsed,
    so one frame is one visible change, and the delays are the real ones the
    capture recorded rather than a guess.
    """
    # The timing log counts BYTES, and a block character is three of them, so the
    # capture is sliced as bytes and decoded incrementally. Slicing the decoded
    # string instead drifts and tears escape sequences in half, which shows up as
    # a wordmark that never finishes redrawing.
    data = Path(out_path).read_bytes()
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    chunks = []
    for line in Path(timing_path).read_text().splitlines():
        delay, _, count = line.partition(" ")
        try:
            chunks.append((float(delay), int(count)))
        except ValueError:
            continue

    # `fresh` is separate from the column on purpose: an SGR sequence writes no
    # cell, so it must not advance the column, but the line must still count as
    # started or the next character would overwrite the colour code.
    lines, row, column, fresh = [""], 0, 0, True
    frames, at = [], 0

    def screen():
        return list(lines)

    def feed(text):
        nonlocal row, column, fresh
        index = 0
        while index < len(text):
            char = text[index]
            if char == "\n":
                row += 1
                column, fresh = 0, True
                while len(lines) <= row:
                    lines.append("")
                index += 1
                continue
            if char == "\r":
                column, fresh = 0, True
                index += 1
                continue
            if char == "\x1b":
                match = SEQ.match(text, index)
                if match:
                    argument, final = match.group(1), match.group(2)
                    index = match.end()
                    if final == "m":
                        lines[row] = match.group(0) if fresh else lines[row] + match.group(0)
                        fresh = False
                    elif final == "K":
                        lines[row] = ""
                        column, fresh = 0, True
                    elif final == "A":
                        row = max(0, row - int(argument or 1))
                        column, fresh = 0, True
                    continue
            lines[row] = char if fresh else lines[row] + char
            fresh = False
            column += 1
            index += 1

    # A chunk can also end in the middle of an escape sequence. Held over to the
    # next chunk rather than drawn, or it lands on screen as literal "ESC[".
    partial = re.compile(r"\x1b\[?[0-9;]*$")
    pending = ""

    for delay, count in chunks:
        text = pending + decoder.decode(data[at:at + count])
        at += count
        pending = ""
        tail = partial.search(text)
        if tail and tail.group(0):
            pending = tail.group(0)
            text = text[:tail.start()]
        if not text:
            continue
        before = screen()
        feed(text)
        now = screen()
        if now == before:
            continue
        centiseconds = max(min_delay, min(max_delay, round(delay * 100)))
        frames.append((now, centiseconds))

    # Whatever the timing log did not account for is still real output. Feeding
    # the remainder guarantees the last frame is the program's final state.
    remainder = pending + decoder.decode(data[at:], True)
    if remainder:
        before = screen()
        feed(remainder)
        if screen() != before:
            frames.append((screen(), min_delay))
    # `script` writes its own start and finish lines into the log. They are not
    # program output, so they are dropped wherever they land.
    footer = re.compile(r"^Script (done|started) on ")
    cleaned = []
    for captured, delay in frames:
        kept = [line for line in captured if not footer.match(line)]
        while kept and kept[-1] == "":
            kept.pop()
        if kept:
            cleaned.append((kept, delay))
    return cleaned


def build(scene, out_path):
    cols, rows = scene["width"], scene["rows"]
    title = scene["title"]
    frames = []  # (image, centiseconds)
    screen = []

    size = scene.get("fontSize", FONT_SIZE)
    chrome = scene.get("chrome", True)

    def shot(delay, cursor=None):
        frames.append((frame(title, cols, rows, screen or [""], cursor, size, chrome), delay))

    for step in scene["steps"]:
        prompt = "\x1b[32m$\x1b[0m "
        command = step.get("command", "")
        if step.get("replay"):
            if step.get("command"):
                screen.append(prompt + step["command"])
                shot(70, cursor=True)
            base = list(screen)
            for captured, delay in replay(step["replay"]["out"], step["replay"]["timing"]):
                screen[:] = base + captured
                shot(delay)
            shot(step.get("hold", 320))
            screen.append("")
            continue
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
