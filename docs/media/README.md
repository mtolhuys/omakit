# The GIFs in the README

The five README GIFs and the two retained documentation GIFs are recorded program output. Nothing in them was typed by hand,
reordered or rewritten, and they are reproducible from this repository: rendering
them again from the committed scenes and captures, with the same Pillow,
FreeType and ffmpeg, produces byte-identical files. Measured: a different
Pillow, FreeType or ffmpeg re-renders the same capture to a GIF that differs
in frame count and bytes, so the versions are recorded here: `banner`, `setup`
and `watch` with the versions on the recording desktop on 2026-09-12;
`submit` re-recorded on 2026-09-13 (Pillow 12.3.0, FreeType 2.14.3, ffmpeg
4.4.2) after `tree.agent-control` became advisory and the baseline figures
became the pin's, because the GIF has to show what the tool prints; and
`submit` again later on 2026-09-13 (Pillow 12.3.0, FreeType 2.14.3, ffmpeg
n9.0.1) after `identity.available` began naming where its registry came from.
Measured at that re-recording: the same capture and the same Pillow and
FreeType, with ffmpeg n9.0.1 instead of 4.4.2, re-rendered the previous
`submit.gif` to 797,813 bytes against the committed 792,201, so the ffmpeg
version is part of the record and not decoration. `watch.gif` and `setup.gif`
were left alone at that point because nothing they print had changed: `watch`
does not read the registry, and the `setup` capture was taken with `omakit`
already on PATH, where no install hint prints.

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

## What is left out

`submit.gif` omits 34 lines in the middle: the marketplace's own baseline report
for that commit, which is long. The GIF says so on screen, in place, with a dim
line naming what was cut. The full output is what
`omakit submit` prints.

## Why the subject differs between the two

The submit GIF uses a fixture, because pointing the demo at somebody's real
plugin would publish a list of that plugin's problems on this project's front
page. The watch GIF uses a real submission, because a stale validation is a fact
about the submission rather than a judgement of the code, and because a staged
one would not be evidence of anything. Its author's login is not printed.


## Refreshed command captures, 2026-09-15

`watch --all`, `audit` and `weigh --list` were captured on the author's account
and desktop at local revision `4a29230`, package 0.4.1. No tool output was
changed for presentation. The current `weigh --list` prints plugin records,
not a compact table; the GIF preserves those records. Full captures include
stderr and are not hand-edited. These runs suppress only the update notice
and remove `NO_COLOR` so the forced-colour capture does not gain a runtime
warning about contradictory colour settings.

```bash
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit watch --all > docs/media/captures/watch-all.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit audit > docs/media/captures/audit-drift.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit weigh --list > docs/media/captures/weigh-list.ansi 2>&1

python3 docs/media/render.py docs/media/watch-all.scene.json docs/media/watch-all.gif
python3 docs/media/render.py docs/media/audit.scene.json docs/media/audit.gif
python3 docs/media/render.py docs/media/weigh-list.scene.json docs/media/weigh-list.gif
```

All three new scenes use 88 columns and 26 rows, matching `submit` and the
retained single-issue `watch` capture. They were rendered with Pillow 12.3.0,
FreeType 2.14.3 and ffmpeg n9.0.1; `OMAKIT_RENDER_FONTS` selected the bundled
DejaVu Sans Mono font directory. The renderer itself is unchanged.

| README GIF | Bytes | Duration | Dimensions | Recording |
| --- | ---: | ---: | --- | --- |
| [`banner.gif`](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif) | 14,026 | 5.20 s | 440 × 268 | 2026-09-12 |
| [`submit.gif`](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif) | 858,362 | 15.68 s | 777 × 516 | 2026-09-13 |
| [`watch-all.gif`](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif) | 566,215 | 13.96 s | 777 × 516 | 2026-09-15 |
| [`audit.gif`](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif) | 710,223 | 15.28 s | 777 × 516 | 2026-09-15 |
| [`weigh-list.gif`](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh-list.gif) | 226,308 | 12.24 s | 777 × 516 | 2026-09-15 |

`watch-all.gif` includes the five CURRENT verdicts, two human discussion
records and the live review-cost summary. `audit.gif` reveals drift before
matching rows and ends with the measured 9-of-18 drift count. `weigh-list.gif`
visibly omits capture lines 29–233 (205 unweighed-record lines) and 244–278
(35 further disabled-record lines). The complete 278-line capture is retained;
the scene's omission notices are presentation annotations, not command output.
The other two refreshed scenes omit no lines.

The historical [single-issue stale GIF](watch.gif) is linked from
[VALIDATION_WATCH.md](../VALIDATION_WATCH.md), keeping the README to one GIF
per command. [setup.gif](setup.gif) remains in the installation documentation.
The README uses absolute raw-main URLs for all five GIFs. The existing live
badge row is unchanged, including the version and CI badges, to keep it current.

Word-count method: exclude fenced code, images, badge markup and URLs; include
headings, table cells and documentation link labels. Count word tokens including
internal apostrophes, periods, slashes and hyphens. The same method counted
825 words before this rewrite and 259 after it. The provenance and limits of
the README evidence are recorded as M10 in [MEASUREMENTS.md](../MEASUREMENTS.md).


The local GFM preview used the styles read from the actual repository page.
At an 880px browser viewport, page scroll width was 865px (the remainder was
the vertical scrollbar), with zero overflowing article elements. All five
GIFs and four live badges loaded. The temporary preview substituted local
GIF files for the new raw-main URLs; the README source itself was not
rewritten for preview. Published-main verification awaits a push. The new
assets are deliberately unreleased local work.
