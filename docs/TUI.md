# What the terminal shows, and why

The visual system is defined once, in `tools/marketplace/style.mjs`, and every
command draws with it. This document is the decisions and their trade-offs; the
source holds the constants, and `tests/unit/style.test.mjs` reads every source
file so that the decisions cannot drift. Where a choice was made because of a
measurement, the measurement is here.

## The contract that comes first

stdout is an API. A coding agent parses it, and a person pastes it into an
issue. So:

- Colour and motion are for a terminal only. Piped stdout is byte-identical to
  a terminal run with the escapes stripped; `plain(coloured) === uncoloured` is
  asserted over every rendering and over the binary itself
  (`tests/unit/cli.test.mjs` runs `omakit` piped, with `FORCE_COLOR`, and with
  `NO_COLOR`, and compares).
- Progress goes to stderr and is drawn only when stderr is a terminal.
- `NO_COLOR` removes colour and nothing else. Measured before this was so: a
  terminal run of `omakit` drew the wordmark, a `NO_COLOR` run printed a text
  heading in its place and fell silent during `submit`. That is a different
  program, not a different palette. Now the wordmark and the progress line are
  drawn without a single escape, and `TERM=dumb` and a pipe are the things
  that remove them; omakit has no switch of its own, because it reads no
  environment variable.
- Every colour is an ANSI palette index (30–37, 39, 90–97, bold). No truecolor,
  no 256-colour, no background. The Omarchy theme decides what blue is.
- Colour is named by role at every call site and by hue in exactly one
  table, `ROLES` in `style.mjs`; the index each role gets was chosen by
  measuring every installed theme, in [PALETTE.md](PALETTE.md).

## One vocabulary

Five states, and only five. Each has one glyph, one word and one tint, and the
only way to print one is `mark()` in `style.mjs`:

| state | mark | tint | when |
| --- | --- | --- | --- |
| pass | `▁ ok` | green | a check passed, a step is done |
| fail | `█ FAIL` | red, bold | a blocking failure |
| advisory | `▓ note` | yellow | a failure that does not block |
| info | `░ info` | dim | a fact with no verdict |
| unknown | `▒ ?` | yellow | a check that could not be made |

Before this, `submit` said `ok  `/`FAIL`, `doctor` said `ok    `/`note  `/
`PROBLEM`/`?     `, `setup` said `ok `/`PROBLEM`, `upgrade` said `REFUSED` and
`note`, `pin` said `ok - `. Five spellings of two ideas, four different column
widths. The test now fails if a status word or a block glyph is typed in any
file but `style.mjs`, so a sixth state or a second spelling of `ok` cannot
appear without changing the one definition.

A verdict, the closing line of a command, is the same glyph with the verdict's
own word: `█ REFUSED`, `▁ READY`, `█ VALIDATION STALE`, `▁ VALIDATION CURRENT`,
`▒ VALIDATION UNKNOWN`, `█ NOT READY`.

## Hierarchy without hue

The measured problem: on Omarchy's Matte Black theme every ANSI hue resolves to
nearly the same grey. Green reads orange, yellow reads red, cyan reads grey. The
old wordmark told `oma` from `kit` by tint and by bold, and a block glyph has no
stroke for a bold face to thicken, so on that theme it was one flat word. Any
distinction carried by hue alone was not carried there.

Measured afterwards over all 32 installed themes ([PALETTE.md](PALETTE.md)):
the cyan every command used for what you could type was pixel-identical to the
foreground on Matte Black and under 3:1 in three other themes, so the one role
a reader most needs to spot was the least visible one there; and the grey used
for labels and brackets was under 3:1 in 23 of 32. What you could type is blue
now (at least 21 CIELAB units from the foreground in every chromatic theme,
and Matte Black's own amber accent there), and a label, a bracket or a rule is
dim, which every terminal derives from the foreground and which is readable in
all 32. Four hues, and no more than four: a screen with six colours on it is
not livelier, it is noisier.

So nothing is carried by hue alone. Each distinction has a second carrier that a
monochrome terminal has to honour:

- **Density.** The block ramp `█ ▓ ▒ ░ ▁` is read as severity: the more ink,
  the more it matters. A blocking failure is the full block; a pass is a floor
  line. The wordmark's `oma`, the ecosystem's prefix, is drawn in the dark shade
  and its `kit`, this tool's own name, in the full block. The prefix recedes into
  texture and the name stands solid. The tint is still applied when colour is
  on, so a colour theme gets both cues.
- **Case.** `FAIL` is the only upper-case mark. In a column of lower-case marks
  it is the one the eye lands on.
- **Column.** Every line starts at one of three stops (below). A check body is
  under the check's name; a key's value is under every other key's value.
- **Air.** Passing checks run together, two lines each and nothing between
  them. A failing or advisory check is a block with a blank line on either
  side. On a monochrome theme the failures are still the things with air around
  them.
- **Shape.** The one line that fixes things is the only line that starts with
  `→`. There is exactly one under any failure.

The trade-off of the density choice is the shade glyph itself. `▓` is a pattern,
and a pattern only reads as a letter when adjacent cells tile without a seam.
Terminals draw the block-element range themselves for exactly that reason;
fonts do not always. Measured while re-recording the README GIF: DejaVu Sans
Mono's `▓` stops one pixel short of its cell on every side, so the wordmark
rendered as a stipple with grid lines through it. The GIF renderer now
rasterises block cells the way a terminal does, and a scene marked `wordmark`
has its finished wordmark measured for seams before the GIF is written (30 cell
boundaries in `banner.gif`, all joined). In a real terminal the same holds
because the terminal, not the font, draws the cell.

The second trade-off is what a shade cell is filled with. The renderer's first
version dithered it, three pixels lit in four at a two-pixel pitch, which is a
pattern no terminal Omarchy ships draws: at the 903 pixels the GIF is rendered
at it was a visible dot grid, and at the 620 the README shows it at it
rasterised into a screen door, so the first thing anyone saw of the project
read as a broken render rather than a second tone. Measured on one Omarchy
desktop, the banner drawn in all four terminals: Alacritty, foot and Ghostty
fill the cell flat with the foreground at partial coverage, and only kitty
dithers, at a pitch finer than the GIF could carry. The coverage is in their
source: Alacritty's `builtin_font.rs` fills `▓` at 192/255, `▒` at 128/255 and
`░` at 64/255; foot's `box-drawing.c` at 0xc000, 0x8000 and 0x4000 of 0xffff,
the same three quarters, half and quarter. The renderer now draws exactly that,
the foreground blended into the background at those three coverages, so the
GIF shows what Omarchy's default terminal shows. In the terminal nothing
changed; the split was always a tone there. What is given up is kitty's
texture, which the GIF does not show, and the seam check keeps its meaning:
a flat cell has ink on every row, so a cell that failed to join would still be
caught.

## One scale

Three stops, in columns, and every line starts at one of them:

| stop | width | what starts there |
| --- | --- | --- |
| 0 | | a status line, a key, a heading, a verdict |
| `GUTTER` | 8 | the body of a check: its detail, its paths, its arrow, its reason |
| `LABEL` | 14 | the value beside a key (`subject`, `commit`, `validated`, `current HEAD`) |

`GUTTER` is the widest mark (`█ FAIL`, 6) plus two spaces, so a body sits under
the name it belongs to; the test derives it rather than reading it. `LABEL` is
the widest key the tool prints (`current HEAD`, 12) plus two, and `field()`
throws on a wider key rather than shift everything below it. `STEP` (2) is the
one indent unit for nesting under a heading; the continuation of an arrow line
sits under the arrow's text, and the continuation of a labelled line under the
label's text. No source file outside
`style.mjs` may repeat a literal number of spaces or start a template with a
hand-typed indent; the test reads for both.

## Eighty columns

Everything omakit composes fits in 80 columns. Measured before this was
enforced, in the real output of five commands: 32 of the tool's own lines were
wider. The wrapper wrapped at 78 and then indented by 7, so a check's
why-paragraph reached column 85; the refusal line listed nine check ids on one
line and reached 207; an upgrade refusal 124; the watch header 99; one help
line 83.

`wrap()` now counts its indent as part of the width. A word longer than the
room it has (a URL, a 40-character sha, an absolute path) is left whole on a
line of its own, never broken and never elided. A `backticked span` is one
word, so `omakit pin` is never split across a line break, and the backticks
themselves never reach the terminal: the span takes the typeable role's blue
instead, because
it is the thing you could type.

So the rule is over what omakit composes, not over every word it is handed,
and the measurement says so: a line is over width when it is wider than eighty
and omakit had a choice about it, which is any line with more than one word on
it. `overflows()` in `style.mjs` is that measurement, and both test files use
it rather than their own. Measured before this was settled: `doctor` prints
the pinned checkout's absolute path, and from a checkout at a 91-column path
the suite was red while from a 60-column one it was green, so whether the rule
held depended on where the repository was cloned. The other way out, eliding
the path to `~/…` or with a middle ellipsis, was rejected: stdout is an API, an
agent reads that line for the path, `~` is not a path it can open, and an
ellipsis is not a path at all. The same
holds for every directory the tool names, in the missing-pin failure, the
`pin.size` remedy and the upgrade refusal. `tests/unit/cli.test.mjs` runs
`doctor` against a checkout at a path wider than the terminal and asserts that
the path is the only thing over eighty and that it is printed whole.

Two things are exempt, and both are somebody else's text quoted verbatim: the
marketplace's own baseline report, and the issue body, whose checklist
sentences are the form's own, character for character. Rewrapping either would
be editing it. `tests/unit/style.test.mjs` renders every report and measures;
`tests/unit/cli.test.mjs` measures the binary's own output.

## Scannability

A person has to find the one failing check and the one action in under two
seconds. Three decisions serve that:

1. The mark is in the gutter, the check id is bold beside it, and the source
   (`[marketplace-pin]` or `[omakit]`) is pushed to the right edge, so the
   marks form a column, the ids form a column, and the sources form a column.
2. The remedy is the only line that starts with `→`, and it is blue, the one
   tint reserved for what you type. The measured reason for the check follows
   it under a dim `why` label; the reason is prose and keeps the foreground,
   only its label is dim.
3. A refusal ends with the failing checks and their arrows again. After fifteen
   checks and the marketplace's report, the fail blocks are off the top of the
   screen, and the last screen is the one a person is looking at. `▁ READY`
   ends the other way: the title, the body, and the one `gh issue create`
   command, in that order.

## Motion, on a budget

Every animation states its budget in `MOTION`, in `style.mjs`, and nowhere
else; the test fails on a literal interval anywhere else.

- The wordmark scan is `bannerBudgetMs` (220ms) in total, whatever the length
  of the name: the frame delay is derived from the budget. The first version
  took 1.4 seconds, which is long enough to be in the way of someone who ran
  `help` to read a flag. The wordmark is drawn in two places: a bare
  `omakit`, where the short list under it fits on any screen, and `setup`, a
  first run already spending seconds on the pin. Not on `help`, whose 53
  lines scroll it off the top before anyone has read it, and not on
  `doctor`, which is run to read a report.
- The progress line has no duration of its own; it lasts as long as the work.
  Its budget is a frame rate, `progressFrameMs` (70ms). It is on stderr, it
  names the phase it is in rather than merely moving, and its label is cut to
  the terminal's width, because a label that wraps is a row the clear cannot
  reach. Measured: the pin fetch labelled itself with a URL and an absolute
  path, 150 columns on a 100-column pty.
- No command is silent while it works. `submit` and `setup` already narrated;
  `watch` (1.7s on the network), `doctor` (1.5s), `upgrade` (a fetch), `verify`
  (the baseline) and `pin` (the fetch) now do too.
- One text effect, and only where the wordmark is drawn: a bare `omakit` and
  `omakit setup`. Where `ttfx` (Omarchy's own port of TerminalTextEffects, the
  thing its screensaver draws with) is on PATH, the wordmark plays in through
  its `expand` before the scan's finished frame is painted: `effectFrameRate` (60) and `effectBudgetMs`
  (1500, a hard timeout after which the process is killed) are in `MOTION`,
  and the arguments are frozen in `effect.mjs` and asserted by the read-only
  test: stdin only, no file, no path, one effect, one seed. Measured: 42
  frames, 713ms. One wordmark has one entrance, so it plays on both and on
  nothing else. Absent, unexecutable or over budget, the wordmark is byte for
  byte what the scan draws, and every other command is byte for byte the
  same whether `ttfx` is there or not; the suite proves both with a fake
  `ttfx` on PATH.

  Colour stays omakit's, and there is no truecolor exception. Measured before
  that was settled, the wordmark with omakit's own palette escapes piped
  through `ttfx` in each of its `--existing-color-handling` modes: `ignore`
  paints its own truecolor gradient; `always` and `dynamic` honour the input
  tint but re-encode palette index 36 as the fixed truecolor 0;128;128 and
  drop 39, so the theme no longer decides what cyan is; `--xterm-colors` does
  the same in 256-colour. So the effect runs with `--no-color` over the plain
  glyphs, whose `▓`/`█` split survives because it is in the characters, and
  omakit walks back up the five rows, paints the finished wordmark itself and
  ends it the way the scan ends: the same shine pass, frame for frame,
  on the scan's schedule (about 110ms). `ttfx` has a `highlight` of its own,
  and it was measured: with colour off, 128 of its 129 frames are identical
  to the finished wordmark, because the highlight is carried by colour alone.

## Failure states, in one register

Every way a command can stop says, in this order: what happened (the code, in
bold, after a `█ FAIL` mark), what it means (the message the module raised,
wrapped in the gutter), and the one command that fixes it (an arrow). On
stderr, exit 1, or 2 for a usage error.

| state | what a person sees |
| --- | --- |
| unknown command | `█ FAIL  unknown command`, `→ omakit help`, then the front door |
| submit without `--category` or `--tags`, in a pipe or with `--json` | `█ FAIL  usage`, one sentence naming the missing flag(s), the form's categories and tags on labelled lines under it, `→ omakit submit <target> --category <c> --tags <a,b>`; decided after the registry, so a listed plugin is never asked; `--json` prints `{ "usage": { "missing", "categories", "tags", "maximumTags" } }` on stdout, exit 2 either way. At a terminal on both ends it is not a failure: the two questions are asked on stderr, numbered from the pinned form, with the marketplace's own default in brackets |
| missing pin | `█ FAIL  marketplace-unavailable`, `→ omakit pin`; doctor reports it as a problem with the same arrow |
| no network | `█ FAIL  network-unavailable`, `→ Connect to the network, then run it again.`; `submit` runs every local check and marks the one that needed the network, naming `--offline`; `doctor` marks the two it could not make `▒ ?` and names `--offline` |
| dirty tree | `█ FAIL  dirty-worktree`, `→ Commit the changes, or pass --allow-dirty` |
| no GitHub login | not a failure: `░ info` in `setup`, with `gh auth login` as the arrow; `submit` and `verify` need none |
| non-fast-forward upgrade | `█ REFUSED  this checkout at … is not an ancestor of origin/main …`, `→ git -C … log --oneline HEAD..origin/main` |

Measured before this: a missing pin crashed `submit` with a stack trace that
named `./bin/omakit marketplace-pin`, a command that no longer exists; no
network crashed `watch` and `upgrade` with stack traces, had `setup` print
git's own `fatal:` line and then `PROBLEM Command failed: git -C …`, and left a
half-fetched pin behind that produced `ambiguous argument 'HEAD'` on the next
run; a typo got a bare `unknown command: frobnicate`. `tests/unit/cli.test.mjs`
runs each of these against the binary, the no-network case inside
`unshare -rn`.

## What is deliberately not here

- No icons beyond the block ramp and the arrow. The ramp is the tool's one
  motif: the wordmark ends on the same two glyphs the progress line moves.
- No boxes, tables or rules of `─`. The one separator is a heading over a floor
  rule, the shape the wordmark has, used for the issue title, the issue body
  and the marketplace's report.
- No spinner without a phase name, and no banner outside the front door and `setup`.
- No colour that is not a palette index, no dimmed sentence, no backtick that
  reaches the terminal.
