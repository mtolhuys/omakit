# The GIFs in the README

The README uses eight GIFs. Every one is rendered by `render.py` from a scene
and a real command capture committed beside it. No frame is drawn or edited by
hand. All command scenes use the same terminal chrome, palette, prompt and
DejaVu Sans Mono cells. Scene widths stop at 110 columns, and the final frame is
the most informative screen of the command.

Keep all eight README image sources absolute at
`https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/...`. npmjs.com
renders the packaged README outside the repository, so repository-relative
paths are broken there. The absolute `main` URLs are deliberate and match the
previous release; do not convert them back to relative paths.

The renderer may omit captured lines for reading length. An omission is declared
in the scene, appears visibly in the GIF, preserves the original order, and never
changes the capture. The full capture always remains beside the scene.

| GIF | What the final frame shows | Capture kind |
| --- | --- | --- |
| `banner.gif` | the finished wordmark and `tested plumbing for plugins` on one line | timed terminal replay |
| `add-run.gif` | inspect before, the three copied files, and inspect after the port | three fixture commands |
| `inspect.gif` | the size score, two long functions, environment-trust sites and `INSPECTED` | one fixture command |
| `submit.gif` | `REFUSED`, three root causes, their remedies and the retry command | one fixture command |
| `watch-all.gif` | two current issues, their validation state and the closing limitation | live read-only command |
| `audit.gif` | every audited plugin row and the 13-of-19 drift summary | live read-only command |
| `weigh.gif` | six samples, equal restoration hashes, noise floor, plugin result and evidence path | consented desktop measurement |
| `lab-prove.gif` | guest identity, 19-scenario result, run cost, overlay removal, unchanged base and `PROVED` | disposable guest run |

## Capture rules

Run from the repository root. Every one-shot command sets `FORCE_COLOR=1`,
removes `NO_COLOR`, and disables only the passive update notice. Redirect both
stdout and stderr so the capture is the exact terminal report. A failed or drift
outcome keeps its real exit status; the recipe notes where that status is
expected.

The banner is the one timed replay. It is recorded at the 40-column terminal
width and 12 rows used by the banner capture rule. The scene is 29 cells wide,
so one leading terminal cell centres the fixed 27-character line beneath the
wordmark.

## Recipes

### Banner

```bash
TERM=xterm-256color FORCE_COLOR=1 script -q \
  --log-out docs/media/captures/banner.out \
  --log-timing docs/media/captures/banner.tim \
  -c "stty rows 12 cols 40; node --input-type=module -e 'import { banner } from \"./tools/marketplace/banner.mjs\"; await banner(); process.stdout.write(\" tested plumbing for plugins\\n\")'"
```

### Add Run

Materialise the fixture and keep the printed directory as `subject`:

```bash
subject="$(node --input-type=module -e '
  import { materialiseInspectFixture } from "./tests/fixtures/inspect.mjs"
  console.log(materialiseInspectFixture("process-without-deadline").dir)
')"
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit inspect "$subject" > docs/media/captures/add-run-before.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit add run "$subject" > docs/media/captures/add-run-add.ansi 2>&1
```

Apply this exact fixture port, then commit it in the temporary repository:

```diff
-import Quickshell.Io
+import "omakit"
@@
-  Process {
+  Run {
     id: usageProcess
     command: ["/usr/bin/df", "-h", "/"]
-    running: true
-    stdout: StdioCollector {
-      onStreamFinished: root.usage = this.text
-    }
+    deadlineMs: 8000
+    onFinished: result => root.usage = result.stdout
   }
+  Component.onCompleted: usageProcess.start()
```

```bash
git -C "$subject" add Widget.qml omakit
git -C "$subject" commit -m "Port process through Run"
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit inspect "$subject" > docs/media/captures/add-run-after.ansi 2>&1
```

### Inspect

```bash
subject="$(node --input-type=module -e '
  import { materialiseInspectFixture } from "./tests/fixtures/inspect.mjs"
  console.log(materialiseInspectFixture("long-function").dir)
')"
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit inspect "$subject" > docs/media/captures/inspect-fixture.ansi 2>&1
```

### Submit

The refusal is a repository fixture, never a third-party plugin:

```bash
subject="$(node --input-type=module -e '
  import { materialise, BAD } from "./tests/fixtures/plugins.mjs"
  const { "nested/manifest.json": _skip, ...tree } = BAD
  console.log(materialise(tree, { origin: "https://github.com/example/omarchy-plugin-clockwork" }).dir)
')"
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit submit "$subject" \
  --category Widgets --tags bar,quickshell --offline \
  > docs/media/captures/submit-refused.ansi 2>&1
test "$?" -eq 1
```

### Watch all and audit

```bash
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit watch --all --user mtolhuys > docs/media/captures/watch-all.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit audit > docs/media/captures/audit-drift.ansi 2>&1
test "$?" -eq 1
```

These are dated account and desktop snapshots. `CURRENT` means the validated
commit matches HEAD, not approval or publication. Audit prints checkout
suggestions and executes none.

### Weigh

This command restarts the live shell six times and must only run after explicit
consent:

```bash
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit weigh io.github.mtolhuys.theme-manager \
  --runs 3 --yes \
  --out docs/evidence/weigh/desktop-2026-09-19-theme-manager.json \
  > docs/media/captures/weigh-theme-manager.ansi 2>&1
```

The capture must show three baseline and three plugin samples, equal before and
after md5 values, `restored and verified`, `WEIGHED`, and the evidence path.

### Lab prove

The verified base must already be ready. The command fetches nothing:

```bash
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit lab prove run \
  > docs/media/captures/lab-prove.ansi 2>&1
```

Keep the resulting `host.log`, `run.json` and `runlab.json` under
`docs/evidence/lab/<run-id>-run/`.

## Render

`render.py` needs Pillow, ffmpeg and DejaVu Sans Mono. `OMAKIT_RENDER_FONTS`
may name the directory containing `DejaVuSansMono.ttf`.

```bash
for scene in banner add-run inspect submit watch-all audit weigh lab-prove; do
  python3 docs/media/render.py "docs/media/$scene.scene.json" "docs/media/$scene.gif"
done
```

The 2026-09-19 render used Pillow 12.3.0, FreeType 2.14.3 and ffmpeg n9.0.1.
Each render verified the capture replay and, for the banner, 30 joined wordmark
cell boundaries.

## Deliberate omissions

- `submit.gif` replaces capture lines 107 to 140 with one visible note. Those
  34 lines are the marketplace baseline report already represented above and
  below the cut.
- `weigh.gif` replaces its first 13 plan and backup-notice lines. The six
  samples, restore, method, floor, result and evidence stay visible.
- `lab-prove.gif` replaces the long guest package-database warning, 19 repetitive
  scenario detail lines and one duplicate guest-document path. The identity,
  suite summary, duration, cleanup and verdict stay visible.
- The other five scenes omit nothing.

## Measured files, 2026-09-19

| GIF | Bytes | Duration | Dimensions | Final hold | Widest shown line |
| --- | ---: | ---: | --- | ---: | ---: |
| `banner.gif` | 14,355 | 5.12 s | 455 x 298 | 4.20 s | timed replay |
| `add-run.gif` | 39,424 | 30.00 s | 830 x 688 | 9.16 s | 79 columns |
| `inspect.gif` | 29,311 | 13.44 s | 830 x 592 | 8.16 s | 79 columns |
| `submit.gif` | 959,947 | 16.32 s | 830 x 592 | 6.20 s | 80 columns |
| `watch-all.gif` | 39,537 | 11.32 s | 830 x 816 | 8.12 s | 102 columns |
| `audit.gif` | 88,472 | 10.04 s | 830 x 1680 | 8.16 s | 100 columns |
| `weigh.gif` | 60,450 | 11.08 s | 830 x 944 | 7.20 s | 102 columns |
| `lab-prove.gif` | 32,864 | 13.04 s | 830 x 496 | 9.16 s | 93 columns |

All shown lines fit their scene width, and every displayed URL is complete.
The hashes, capture counts, package facts and README word count are in
[M10's machine-readable record](../evidence/readme/2026-09-19-positioning.json).
