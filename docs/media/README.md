# The GIFs in the README

All four are real, unedited program output. Nothing in them was typed by hand,
reordered or rewritten, and they are reproducible from this repository: rendering
them again from the committed scenes and captures, with the same Pillow,
FreeType and ffmpeg, produces byte-identical files. Measured: a different
Pillow, FreeType or ffmpeg re-renders the same capture to a GIF that differs
in frame count and bytes, so the versions are recorded here: `banner`, `setup`
and `watch` with the versions on the recording desktop on 2026-09-12;
`submit` re-recorded on 2026-09-13 (Pillow 12.3.0, FreeType 2.14.3, ffmpeg
4.4.2) after `tree.agent-control` became advisory and the baseline figures
became the pin's, because the GIF has to show what the tool prints.

| GIF | What it is | How it was captured |
| --- | --- | --- |
| `banner.gif` | the wordmark scanning in, then one shine pass, exactly as the tool draws it | a terminal session with timings |
| `setup.gif` | `omakit setup` on a machine with no pin yet, the wordmark through `ttfx` first | a terminal session with timings |
| `submit.gif` | `omakit submit` refusing a plugin with no license, no removal instructions and a reserved id, and warning about its agent-control files | stdout, revealed line by line |
| `watch.gif` | `omakit watch` on a real open submission whose validated commit has fallen behind | stdout, revealed line by line |

Two capture kinds, because the two need different things. `submit` and `watch`
print once and never redraw, so their stdout is enough and the renderer reveals
it line by line at a readable pace. `banner` and `setup` animate in place with
carriage returns and cursor-up, so they are recorded with `script --log-out
--log-timing` and replayed against a small line-oriented screen model at the real
recorded delays. That replay is why the scanner in `banner.gif` moves at the
speed the program actually draws it.

## How they were made

The captures in `captures/` are the exact stdout of real runs, taken with
`FORCE_COLOR=1` so the colour a person sees in a terminal ends up in the file:

```bash
# submit, refusing a fixture plugin (and warning about its agent-control files). The subject is a
# fixture from tests/fixtures/plugins.mjs, materialised into a temporary Git
# repository, so anyone can reproduce it without a plugin of their own.
node --input-type=module -e '
  import { materialise, BAD } from "./tests/fixtures/plugins.mjs"
  const { "nested/manifest.json": _skip, ...tree } = BAD
  console.log(materialise(tree, { origin: "https://github.com/example/omarchy-plugin-clockwork" }).dir)
' > /tmp/subject
FORCE_COLOR=1 ./bin/omakit submit "$(cat /tmp/subject)" \
  --category Widgets --tags bar,quickshell --offline \
  > docs/media/captures/submit-refused.ansi 2>&1

# watch, on a real open submission whose validated commit had fallen behind
FORCE_COLOR=1 ./bin/omakit watch \
  https://github.com/omacom/omarchy-plugin-marketplace/issues/4403 \
  > docs/media/captures/watch-stale.ansi 2>&1
```

The two animated ones are recorded with their timings:

```bash
script -q --log-out docs/media/captures/banner.out \
          --log-timing docs/media/captures/banner.tim \
  -c 'stty rows 12 cols 40; node --input-type=module -e "import { banner } from \"./tools/marketplace/banner.mjs\"; await banner({ tagline: \"the safe place to find out\" })"'

rm -rf .cache/marketplace   # so setup has something to do
which ttfx                  # on PATH, so the wordmark plays its effect first
script -q --log-out docs/media/captures/setup.out \
          --log-timing docs/media/captures/setup.tim \
  -c "stty rows 28 cols 100; NODE_NO_WARNINGS=1 ./bin/omakit setup"
```

The `stty` is not decoration: `script` hands the program a pty with no window
size, and the banner refuses to animate into a terminal whose height it cannot
confirm, because five rows redrawn with cursor-up in a screen with no room to
hold them strand a row of an earlier frame above the wordmark.

Then, from the repository root:

```bash
for scene in banner setup submit watch; do
  python3 docs/media/render.py docs/media/$scene.scene.json docs/media/$scene.gif
done
```

Every render verifies itself. In the animated region a frame is only taken at the
moment the program jumps its cursor back up, which is the only point at which a
redrawn block is complete, and after rendering it asserts that each frame is a
block of lines the program actually wrote in one go. Without that check the
replay happily assembled a frame from two different redraws, which looked like a
wordmark with its bottom row missing and an `I` that read as a `T`.

The scan is what a bare `omakit` and `setup` draw when `ttfx` is not on PATH,
and its shine pass is how they end the effect when it is; no other command
draws the wordmark. It is on a budget (`MOTION.bannerBudgetMs` in `tools/marketplace/style.mjs`,
220ms), so the GIF is brisk because the program is: the first version took 1.4
seconds, which is long enough to be in the way of someone who ran `help` to
read a flag.

`render.py` is documentation tooling, not part of omakit: it needs Pillow, ffmpeg
and DejaVu Sans Mono, which omakit itself does not (`OMAKIT_RENDER_FONTS` names
a directory to find the font in if it is not where the distribution keeps it).
The `setup` capture also needs `ttfx` on PATH when it is recorded, because
the wordmark plays in through it when it is there: the committed capture was
made with `ttfx 0.3.2`, with the effect and seed frozen in
`tools/marketplace/effect.mjs`, so the same version replays the same 42 frames.
Re-recording without it produces the scan instead, which is also real output,
and a different GIF.
It cannot draw a character that is not in the capture. It slices the capture by
the byte counts the timing log records rather than by characters, because a
block character is three bytes and slicing by characters tears escape sequences
in half.

The block elements (`█ ▓ ▒ ░ ▁`) are drawn by the renderer as cells, not taken
from the font, which is what a terminal does too: Alacritty, kitty, foot and
Ghostty all rasterise that range themselves, because a font's block glyphs are
sized to its em box and not to the cell. Measured: DejaVu's dark shade stops one
pixel short of the cell on every side, so the wordmark's shaded `oma` rendered
as a stipple with grid lines through it. A shade cell is a flat fill of the
foreground at the coverage Alacritty and foot use (`▓` 192/255, `▒` 128/255,
`░` 64/255), because that is what the terminal Omarchy ships draws; the
renderer's earlier two-pixel dither was a pattern no terminal draws and at the
README's 620px it read as a screen door. `docs/TUI.md` has the measurement.
A scene with `"wordmark": true` has its finished wordmark measured before the
GIF is written: for every lit cell with a lit cell under it, the pixel rows on
both sides of the boundary must carry ink, and the render refuses otherwise.
`banner.gif` reports the count (`wordmark joins at 30 cell boundaries`).

## The one thing that is left out

`submit.gif` omits 34 lines in the middle: the marketplace's own baseline report
for that commit, which is long. The GIF says so on screen, in place, with a dim
line naming what was cut. Nothing else is removed, and the full output is what
`omakit submit` prints.

## Why the subject differs between the two

The submit GIF uses a fixture, because pointing the demo at somebody's real
plugin would publish a list of that plugin's problems on this project's front
page. The watch GIF uses a real submission, because a stale validation is a fact
about the submission rather than a judgement of the code, and because a staged
one would not be evidence of anything. Its author's login is not printed.
