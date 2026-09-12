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
"hold"}]}. A scene with "wordmark": true has its finished wordmark measured for
vertical seams, and its shaded cells for being one flat tone, before the GIF
is written (see verify_wordmark).
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

# DejaVu Sans Mono, wherever the distribution keeps it. OMAKIT_RENDER_FONTS
# names a directory to look in first, for a machine that has the font
# somewhere else (a Python environment that bundles it, for instance).
FONT_DIRS = [
    *([Path(p) for p in [__import__("os").environ.get("OMAKIT_RENDER_FONTS", "")] if p]),
    Path("/usr/share/fonts/truetype/dejavu"),
    Path("/usr/share/fonts/TTF"),
    Path("/usr/share/fonts/dejavu"),
    Path("/usr/share/fonts/dejavu-sans-mono-fonts"),
]


def font_path(name):
    for directory in FONT_DIRS:
        candidate = directory / name
        if candidate.exists():
            return str(candidate)
    sys.exit(f"render: {name} not found in {', '.join(str(d) for d in FONT_DIRS)}; set OMAKIT_RENDER_FONTS")


FONT_REGULAR = font_path("DejaVuSansMono.ttf")
FONT_BOLD = font_path("DejaVuSansMono-Bold.ttf")
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


# The block elements are drawn here, not taken from the font, which is what a
# terminal does too: Alacritty, kitty, foot and Ghostty all rasterise the
# box-drawing and block-element range themselves, because a font's block glyphs
# are sized to the font's em box and not to the terminal's cell, and the seams
# show. DejaVu Sans Mono's dark shade stops one pixel short of the cell on every
# side, so the wordmark's shaded prefix rendered as a stipple with grid lines
# through it. The four densities below fill the whole cell, so the letters join.
#
# A shade is a solid fill of the foreground at partial coverage, because that
# is what the terminal Omarchy ships draws. Measured, 2026-09-12, the banner
# in all four terminals on one Omarchy desktop: Alacritty, foot and Ghostty
# each fill the cell flat, and only kitty dithers. In Alacritty's source
# (builtin_font.rs) the dark shade is a fill at 192/255, medium 128/255, light
# 64/255; foot's box-drawing.c uses 0xc000, 0x8000 and 0x4000 of 0xffff, the
# same three quarters, half and quarter. The renderer's earlier dither at a
# two-pixel pitch was a pattern no terminal draws, and at the README's 620px it
# rasterised into a screen door: the first thing anyone saw of the project
# read as a broken render rather than a second tone.
BLOCKS = {
    "\u2588": "full",
    "\u2593": "dark",
    "\u2592": "medium",
    "\u2591": "light",
    "\u2581": "floor",
}
COVERAGE = {"full": 255, "dark": 192, "medium": 128, "light": 64}


def shade(colour, kind, background=BG):
    """The foreground blended into the background at the shade's coverage."""
    alpha = COVERAGE[kind]
    return tuple((c * alpha + b * (255 - alpha)) // 255 for c, b in zip(colour, background))


def block(draw, x, y, width, height, kind, colour):
    """Draw one block-element cell at (x, y) with the given cell size."""
    x0, y0 = int(round(x)), int(y)
    x1, y1 = int(round(x + width)), int(y + height)
    if kind == "floor":
        # The lower one-eighth block: a floor line at the bottom of the cell.
        draw.rectangle([x0, y1 - max(2, height // 8), x1 - 1, y1 - 1], fill=colour)
        return
    draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=shade(colour, kind))


def _runs(text):
    """Split text into (is_block, run) pairs."""
    out = []
    for char in text:
        is_block = char in BLOCKS
        if out and out[-1][0] == is_block:
            out[-1] = (is_block, out[-1][1] + char)
        else:
            out.append((is_block, char))
    return out


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

    cell = measure(regular, "M")
    for row, line in enumerate(lines[-rows:]):
        y = pad_top + row * line_height
        x = PAD_X
        for text, colour, is_bold in spans(line):
            font = bold if is_bold else regular
            fill = BRIGHT if is_bold and colour == FG else colour
            # Runs of block elements are drawn as cells; everything else is text.
            for is_block, run in _runs(text):
                if is_block:
                    for char in run:
                        block(draw, x, y, cell, line_height, BLOCKS[char], fill)
                        x += cell
                else:
                    draw.text((x, y), run, font=font, fill=fill)
                    x += measure(font, run)
        if cursor is not None and row == len(lines[-rows:]) - 1 and cursor:
            draw.rectangle([x + 1, y + 2, x + int(measure(regular, "M")), y + line_height - 3], fill=FG)
    return image


SEQ = re.compile(r"\x1b\[(\??[0-9;]*)([A-Za-z])")
# DECSC and DECRC, save and restore the cursor: the two-byte sequences ttfx
# redraws each of its frames with (ESC 8, ESC 7, cursor-up, the rows).
SAVE, RESTORE = "\x1b7", "\x1b8"


def replay(out_path, timing_path, min_delay=3, max_delay=260):
    """Turn a `script --log-out --log-timing` capture into (screen, delay) frames.

    The screen model is line oriented on purpose, because that is exactly how
    this tool draws: the wordmark rewrites its five rows in place and the
    progress line rewrites itself. Carriage return, erase-line, cursor-up,
    save and restore cursor (which ttfx frames its redraws with) and the
    cursor-visibility toggles are honoured; anything else is passed through
    into the line, where the SGR parser that draws a frame handles it.

    A frame is taken at a settled screen, never at a chunk boundary. In the
    animated region the settled moment is the cursor jumping back up, and that
    jump happens inside a chunk, so the snapshot is taken there rather than after
    the chunk is finished. Taking it at the chunk boundary is how this renderer
    once produced a wordmark with new rows above stale ones, where the bottom row
    went missing and an I read as a T.
    """
    data = Path(out_path).read_bytes()
    decoder = codecs.getincrementaldecoder("utf-8")("replace")

    # Where the animated region ends: after the last cursor-up, output is
    # ordinary lines plus a single-line progress redraw, and the bottom line is
    # settled enough to draw.
    ups = list(re.finditer(rb"\x1b\[[0-9]*A", data))
    animated_until = ups[-1].end() if ups else 0

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
    frames, at, held = [], 0, 0.0
    saved = (0, 0)

    def screen():
        return list(lines)

    def emit():
        nonlocal held
        now = screen()
        if frames and frames[-1][0] == now:
            return
        frames.append((now, max(min_delay, min(max_delay, round(held * 100)))))
        held = 0.0

    def feed(text, boundary):
        """Feed one chunk. Calls `boundary` the moment a redraw block ends."""
        nonlocal row, column, fresh, saved
        index = 0
        while index < len(text):
            char = text[index]
            if text.startswith(SAVE, index):
                saved = (row, column)
                index += len(SAVE)
                continue
            if text.startswith(RESTORE, index):
                row, column = saved
                fresh = column == 0
                while len(lines) <= row:
                    lines.append("")
                index += len(RESTORE)
                continue
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
                        # The block above is finished. Snapshot it here.
                        boundary()
                        row = max(0, row - int(argument or 1))
                        column, fresh = 0, True
                    elif argument.startswith("?"):
                        # Cursor shown or hidden: nothing on screen changes.
                        pass
                    continue
            lines[row] = char if fresh else lines[row] + char
            fresh = False
            column += 1
            index += 1

    # A chunk can end in the middle of an escape sequence. Held over rather than
    # drawn, or it lands on screen as a literal "ESC[".
    partial = re.compile(r"\x1b\[?\??[0-9;]*$")
    pending = ""

    for delay, count in chunks:
        text = pending + decoder.decode(data[at:at + count])
        start_at = at
        at += count
        pending = ""
        tail = partial.search(text)
        if tail and tail.group(0):
            pending = tail.group(0)
            text = text[:tail.start()]
        held += delay
        if not text:
            continue
        before = screen()
        feed(text, emit)
        if screen() != before and start_at > animated_until and row >= len(lines) - 1:
            emit()

    remainder = pending + decoder.decode(data[at:], True)
    if remainder:
        feed(remainder, emit)
    emit()

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
    verify(cleaned, data, animated_until)
    return cleaned


def verify(frames, data, animated_until):
    """Every frame of the animated region must be a block the program wrote.

    Not a nicety: a frame assembled from two different redraws is exactly the
    glitch this renderer had, where the wordmark lost its bottom row and an I
    read as a T. The check is cheap and it runs on every render, so the failure
    cannot come back quietly.
    """
    if not animated_until:
        return
    # Normalise the controls the screen model consumes rather than stores: the
    # pty's carriage returns, and the per-line erase the animation writes before
    # each row. What is left is the content the program put on screen.
    text = data.decode("utf-8", "replace").replace("\r\n", "\n")
    text = text.replace("\x1b[2K", "").replace("\r", "")
    text = text.replace(SAVE, "").replace(RESTORE, "")
    text = re.sub(r"\x1b\[\?[0-9;]*[hl]", "", text)
    height = 0
    for match in re.finditer(r"\x1b\[([0-9]*)A", text):
        height = max(height, int(match.group(1) or 1))
    if not height:
        return
    for index, (screen, _) in enumerate(frames):
        block = "\n".join(screen[:height])
        if block not in text:
            raise SystemExit(
                f"render: frame {index} is not a block the program wrote; "
                f"the replay assembled it from two different redraws"
            )


WORDMARK_INK = "\u2588\u2593"


def verify_wordmark(image, lines, size, chrome):
    """The wordmark's block rows must join: no seam between a cell and the one below it.

    The wordmark carries its oma/kit split by density (a shaded block against a
    full one) rather than by colour, because on a monochrome theme colour says
    nothing. A shade glyph is a pattern, and a pattern only reads as a letter if
    the font tiles it to the edge of the cell. This measures the rendered image:
    for every lit cell with a lit cell directly under it, the pixel rows on both
    sides of the boundary must contain ink inside the cell's span. A seam there
    would turn the letters into a dot matrix, and the render refuses to ship it.
    """
    regular = ImageFont.truetype(FONT_REGULAR, size)
    line_height = regular.getbbox("\u2588")[3] + 1
    cell = measure(regular, "M")
    pad_top = PAD_TOP if chrome else 14
    pixels = image.load()
    plain = [SGR.sub("", line) for line in lines]
    rows = [row for row, text in enumerate(plain) if any(ch in WORDMARK_INK for ch in text)]
    if not rows:
        raise SystemExit("render: the wordmark scene has no block rows to verify")

    def inked(x0, x1, y):
        return any(pixels[x, y] != BG for x in range(int(x0), int(x1)))

    checked = 0
    for row in rows:
        below = row + 1
        if below >= len(plain):
            continue
        for column, char in enumerate(plain[row]):
            if char not in WORDMARK_INK or column >= len(plain[below]) or plain[below][column] not in WORDMARK_INK:
                continue
            x0 = PAD_X + column * cell
            x1 = x0 + cell
            boundary = pad_top + below * line_height
            for y in (boundary - 1, boundary):
                if not inked(x0, x1, y):
                    raise SystemExit(
                        f"render: the wordmark does not join vertically at row {row}, column {column} "
                        f"({char!r} over {plain[below][column]!r}): pixel row {y} inside the cell is empty"
                    )
            checked += 1
    if not checked:
        raise SystemExit("render: the wordmark has no vertically adjacent block cells to verify")

    # And the shaded prefix is a tone, not a pattern: every pixel of a dark
    # shade cell is one colour, and that colour is neither the background nor
    # the full block's. The two-pixel dither this replaced fails here, because
    # a dithered cell holds both the foreground and the background.
    tones = set()
    for row in rows:
        for column, char in enumerate(plain[row]):
            if char != "\u2593":
                continue
            x0 = PAD_X + column * cell
            y0 = pad_top + row * line_height
            seen = {pixels[x, y] for x in range(int(round(x0)), int(round(x0 + cell))) for y in range(y0, y0 + line_height)}
            if len(seen) != 1:
                raise SystemExit(
                    f"render: the shade cell at row {row}, column {column} is {len(seen)} colours, not one tone"
                )
            tones |= seen
    full = {pixels[int(round(PAD_X + column * cell)) + 1, pad_top + row * line_height + 1]
            for row in rows for column, char in enumerate(plain[row]) if char == "\u2588"}
    if not tones or tones & (full | {BG}):
        raise SystemExit("render: the shade tone is not distinct from the full block and the background")
    return checked


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

    if scene.get("wordmark"):
        # The last frame is the finished wordmark. Measured, not trusted.
        joins = verify_wordmark(frames[-1][0], screen, size, chrome)
        print(f"{out_path}: wordmark joins at {joins} cell boundaries")

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
        # The palette is built over every pixel of every frame, not over what
        # moves between them: with stats_mode=diff the colours of the animated
        # region won the 32 entries, and a colour that first appears when the
        # motion stops lost its own. Measured on setup.gif once the wordmark
        # ran through ttfx: the repainted prefix, (46, 152, 161) in the frame
        # the renderer drew, came out (112, 144, 127) in the GIF. With full
        # statistics it is exact, and submit.gif grows by 4 KB.
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-vf", "palettegen=max_colors=32:stats_mode=full", str(palette)])
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
