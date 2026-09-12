# The GIFs in the README

All four are real, unedited program output. Nothing in them was typed by hand,
reordered or rewritten, and they are reproducible from this repository: rendering
them again from the committed scenes and captures produces byte-identical files.

| GIF | What it is | How it was captured |
| --- | --- | --- |
| `banner.gif` | the wordmark scanning in, then two shine passes | a terminal session with timings |
| `setup.gif` | `omakit setup` on a machine with no pin yet | a terminal session with timings |
| `submit.gif` | `omakit submit` refusing a plugin that ships agent-control files | stdout, revealed line by line |
| `watch.gif` | `omakit watch` on a real open submission with a stale pin | stdout, revealed line by line |

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
# submit, refusing a plugin that ships agent-control files. The subject is a
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

# watch, on a real open submission whose pin had gone stale
FORCE_COLOR=1 GITHUB_TOKEN=... ./bin/omakit watch \
  https://github.com/omacom/omarchy-plugin-marketplace/issues/4403 \
  > docs/media/captures/watch-stale.ansi 2>&1
```

The two animated ones are recorded with their timings:

```bash
script -q --log-out docs/media/captures/banner.out \
          --log-timing docs/media/captures/banner.tim \
  -c 'node --input-type=module -e "import { banner } from \"./tools/marketplace/banner.mjs\"; await banner({ tagline: \"marketplace submit preflight for Omarchy Quattro plugins\" })"'

rm -rf .cache/marketplace   # so setup has something to do
script -q --log-out docs/media/captures/setup.out \
          --log-timing docs/media/captures/setup.tim \
  -c "NODE_NO_WARNINGS=1 ./bin/omakit setup"
```

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

`render.py` is documentation tooling, not part of omakit: it needs Pillow and
ffmpeg, which omakit itself does not. It cannot draw a character that is not in
the capture. Its line height is set to the exact height of a full block glyph, so
block-drawn letters join up instead of breaking into a dot matrix, and it slices
the capture by the byte counts the timing log records rather than by characters,
because a block character is three bytes and slicing by characters tears escape
sequences in half.

## The one thing that is left out

`submit.gif` omits 40 lines in the middle: the marketplace's own baseline report
for that commit, which is long. The GIF says so on screen, in place, with a dim
line naming what was cut. Nothing else is removed, and the full output is what
`omakit submit` prints.

## Why the subject differs between the two

The submit GIF uses a fixture, because pointing the demo at somebody's real
plugin would publish a list of that plugin's problems on this project's front
page. The watch GIF uses a real submission, because a stale review pin is a fact
about the submission rather than a judgement of the code, and because a staged
one would not be evidence of anything. Its author's login is not printed.
