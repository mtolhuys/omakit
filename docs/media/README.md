# The GIFs in the README

Both are real, unedited program output. Nothing in them was typed by hand,
reordered or rewritten, and they are reproducible from this repository.

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

Then, from the repository root:

```bash
python3 docs/media/render.py docs/media/submit.scene.json docs/media/submit.gif
python3 docs/media/render.py docs/media/watch.scene.json  docs/media/watch.gif
```

`render.py` is documentation tooling, not part of omakit: it needs Pillow and
ffmpeg, which omakit itself does not. It types the command, reveals the captured
lines, and scrolls. It cannot draw a character that is not in the capture.

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
