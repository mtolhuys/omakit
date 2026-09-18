<p align="center">
  <img src="https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif" alt="omakit" width="512">
</p>

**The plumbing plugin reviews block most, built and tested once.**

In one week of the Omarchy plugin marketplace, 2026-09-10 to 2026-09-17, one reviewer wrote 1,001 security blocker comments. 587 of them ask for something a bounded process runner does (an absolute path, a closed environment, a deadline, an output cap, a process group ended, argv instead of a shell string), 527 for something a private state file does (no-follow opens, no check-then-use, an atomic replace, owner and mode checks, a size cap, a schema). Read as an upper bound, a runner plus a store handles at least one blocker in 777 of the 1,001 ([M13](docs/MEASUREMENTS.md#m13-what-the-review-blocks-on-over-one-week-of-comments-and-which-of-it-a-block-can-own)): "handles" means the comment raises that plumbing, not that the comment is resolved. omakit ships that plumbing as two blocks a plugin copies into its own tree, and the checks for the rest. No reviewer has seen a ported plugin yet.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml) [![Socket](https://socket.dev/api/badge/npm/package/omakit)](https://socket.dev/npm/package/omakit)

## Build

| Command | What you get | Read more |
| --- | --- | --- |
| `omakit add run <plugin-dir>` | `Run.qml` and the supervisor it starts: one program, absolute path, argv only, a closed environment, a hard deadline, byte and line caps while reading, TERM then KILL to the whole group, the leader reaped last, one result object; nothing decided about privilege, so the block adds no capability to the marketplace's scan. Two files under `omakit/`, each with its version and its body's sha256 in the header. | [blocks](docs/BLOCKS.md) |
| `omakit add store <plugin-dir>` | `Store.qml` and its helper: one private file per plugin under the XDG state or cache base, reached by descriptor with no-follow at every step, checked after every open and never before, read under a cap and a schema, written through an exclusive 0600 staging file and a rename. Brings `run`, which it uses. | [blocks](docs/BLOCKS.md) |

A block is a file the plugin owns: added and updated only by `omakit add`, never overwritten once modified, and recognised by `omakit inspect` as one row that raises nothing. Each line of a block's contract cites how many of the 1,001 comments asked for it.

## Check

| Command | What you get | Read more |
| --- | --- | --- |
| `omakit inspect <plugin-dir>` | What needs attention before a reviewer looks: the longest functions, then the classes reviewers raise most, each with the file and line; a `Run {` site as a process with its deadline, a `Store {` site as a write under the plugin's own directory, an unmodified block as one row. | [inspect](docs/INSPECT.md) |
| `omakit verify <plugin-repo>` | The marketplace's security result for your commit, exactly as it would see it. | [commands](docs/COMMANDS.md) |
| `omakit submit <plugin-repo>` | Every check the marketplace applies, and the issue title and body ready to paste. Nothing is posted for you. | [submit](docs/SUBMIT.md) |

## Track

| Command | What you get | Read more |
| --- | --- | --- |
| `omakit watch <issue-url>` | Whether the commit the marketplace checked is still the one you are shipping, and what re-runs validation when it is not. The marketplace validates one exact commit; push a fix or comment "fixed", and nothing re-runs ([M6](docs/MEASUREMENTS.md#m6-the-validated-commit-falls-behind-silently-and-that-is-the-centre-of-this-tool)). | [watch](docs/VALIDATION_WATCH.md) |

## Prove

| Command | What you get | Read more |
| --- | --- | --- |
| `omakit lab prove <suite>` | A suite run in a disposable Omarchy guest, never on your desktop: the pinned 4.0.3 release from an immutable verified base, a fresh overlay per run, the guest's installed `omarchy` package printed before the suite and written into the document with the run id. The Run and Store suites, and `weigh` against a real shell. | [lab](docs/LAB.md) |
| `omakit lab inspect`, `omakit lab setup`, `omakit lab prune` | What the lab is pinned to and what is on disk, read-only; one consent naming the exact size and destination before the first byte, then the ISO verified against the pinned SHA-256 and the Omarchy signature and one base built by the pinned toolchain; what the lab owns on disk, removed with the bytes said. Nothing is fetched implicitly, and no image ships. | [lab](docs/LAB.md) |

## More

| Command | What you get | Read more |
| --- | --- | --- |
| `omakit audit` | Installed plugins running code the marketplace never checked. | [audit](docs/AUDIT.md) |
| `omakit weigh <plugin>` | What a plugin costs the shell in memory and CPU, measured by restarting it. | [weigh](docs/WEIGH.md) |
| `omakit doctor`, `omakit setup` | What is installed and pinned; or set everything up once, with tab completion. | [install](docs/INSTALL.md) |

Every number a command prints has a measured origin in [MEASUREMENTS.md](docs/MEASUREMENTS.md); nothing is a guess and nothing is a grade. Nothing here claims that a plugin gets through review; a block does what its contract says, and what was measured is below.

## Install

```bash
npm i -g omakit && omakit setup
npx skills add mtolhuys/omakit
```

Runs where [Node 22+](package.json) and Git run; the blocks need `/usr/bin/python3`, which a stock Omarchy 4.0.3 has as a dependency of its desktop packages; `weigh` and `audit` need a running Omarchy shell; `lab` needs KVM, QEMU and the OVMF firmware, reported by `omakit doctor` and installed by nobody but you.

Licence: [MIT](LICENSE).

## `omakit add run`, then `inspect` before and after

![omakit add run into a fixture, then inspect before and after: the process-lifecycle and unbounded-buffering rows are gone](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/add-run.gif)

`inspect` on a fixture with one bare `Process` shows a process with no deadline and a collector with no cap; after `omakit add run` and the one-site port, the same fixture shows the block as one row and the site as a process with its deadline through the block, and no pattern row. The GIF is recorded output ([captures and scenes](docs/media/README.md)).

## `omakit submit <plugin-repo>`

![submit refusing a fixture plugin before any issue is posted](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif)

Checks the exact commit with the marketplace's own baseline and, when ready, prints the exact issue title and body for you to paste. The GIF shows a refusal with three blocking checks and their fixes.

## `omakit watch --all`

![watch counts and two current issues, including human discussion](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif)

Checks your submission commits and names the action that re-runs stale validation: edit the issue body. The GIF shows five CURRENT issues in the counts and the first two issues with a discussion; CURRENT means matching commits, not approval.

## `omakit inspect <plugin-dir>`

![inspect showing a fixture's size score, its two long functions with their ranks, and the one review class it shows](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/inspect.gif)

Reads a plugin's tree and prints what needs attention, biggest first: a size score ([M12](docs/MEASUREMENTS.md#m12-how-long-a-plugins-functions-are-in-listed-trees)), the functions over what 90 of 100 listed functions stay under, then each review class the tree shows with its measured share of review findings ([M11](docs/MEASUREMENTS.md#m11-what-the-human-review-raises-by-class)) and up to five sites. No verdict, nothing run from the tree; `--full` is every site, `--json` the document.

## `omakit audit` and `omakit weigh <plugin>`

![audit keeping drift rows and the DRIFT summary visible together](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif)

`audit` compares your installed plugin commits with the marketplace's validated commits; on the author's desktop, 9 of 18 audited plugins ran commits the marketplace never validated. `weigh` measures the shell with and without your plugin, reading Pss and CPU, with the baseline's own spread as the noise floor ([method](docs/WEIGH.md), [GIF](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh.gif)).

## Evidence, not claims

| Measurement | Evidence |
| --- | --- |
| Run: the design chosen by measurement | 36 runs, five scenarios, two candidates, on a real Quattro shell: both end every scenario, the supervisor is chosen for reaping last, [spike](docs/BLOCKS_SPIKE.md), 2026-09-17 |
| Run: lab scenarios | 19 of 19 on the desktop and 19 of 19 on the stock 4.0.3 guest (installed `omarchy 4.0.3-1`, read by the run), at 0.2.0 and again at 0.2.1, six of them written to fail on 0.1.0 after the review of 2026-09-18, [desktop](docs/evidence/blocks/2026-09-18-run-lab-desktop.json), [guest](docs/evidence/lab/20260918-172451-run/runlab.json), [review](docs/evidence/blocks/2026-09-18-review.json) |
| The lab: one run, identified | that guest run through `omakit lab prove run`: skew false, 2m 53.4s, a 413,470,720 B overlay removed, the base unchanged, [record](docs/evidence/lab/20260918-160936-run/run.json), [M14](docs/MEASUREMENTS.md#m14-what-one-lab-run-costs-and-what-the-lab-is-pinned-to) |
| Store: lab scenarios | 15 of 15 on the desktop and 15 of 15 on the stock guest with a root-owned file simulated, three of them written to fail on 0.1.0, [desktop](docs/evidence/blocks/2026-09-18-store-lab-desktop.json), [guest](docs/evidence/lab/20260918-161230-store/storelab.json) |
| Port: Theme Manager through Run | process lifecycle 23 to 0, unbounded buffering 18 to 0, 24 of 24 QML sites with a deadline, 27 of 27 lab steps in a guest whose session was dev-linked to omarchy `b5589fa` (not the installed package; the record says so), [record](docs/evidence/blocks/2026-09-17-theme-manager-port.json); not submitted, no reviewer has seen it |
| Port: Sidecar through Store | the device state through the block, a planted link refused and moved aside, 71 tests, [record](docs/evidence/blocks/2026-09-17-sidecar-port.json); inspect's counts unchanged, and the record says why |
| Baseline parity | 30/30 identical results, [recorded corpus](docs/evidence/parity/2026-09-12-local-vs-github-2.json), 2026-09-12 |
| Stale validated commit | 326/519 readable comparisons stale (62.8%); 64/583 unknown, [2026-09-15 data](docs/evidence/staleness/2026-09-15.json) |
| Registry churn | 4,201/4,293 registry-only commits in 30 days, 2026-09-13, [M7](docs/MEASUREMENTS.md#m7-the-registry-moves-by-the-hour-the-code-and-the-rules-move-by-the-week) |
| GIFs are recorded output | 7 GIFs with [captures and scenes](docs/media/README.md) |
| Posts nothing | 0 marketplace writes, [M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures) |
| Zero dependencies | 0 runtime and 0 development dependencies, counted in [package.json](package.json) |

## Documentation

- Building: [blocks](docs/BLOCKS.md), [the spike behind Run](docs/BLOCKS_SPIKE.md), [what is still open](docs/BLOCKS_PLAN.md).
- Using: [install](docs/INSTALL.md), [commands](docs/COMMANDS.md), [audience](docs/MARKETPLACE.md).
- Checks and measurements: [submit](docs/SUBMIT.md), [inspect](docs/INSPECT.md) and [its design note](docs/INSPECT_DESIGN.md), [watch](docs/VALIDATION_WATCH.md), [audit](docs/AUDIT.md), [evidence](docs/MEASUREMENTS.md).
- Proving: [the lab](docs/LAB.md), [its inventory](docs/history/2026-09-18-lab-inventory.md), [its plan](packaging/LAB_PLAN.md).
- Method docs: [how](docs/HOW.md), [weigh](docs/WEIGH.md), [upstream contract](docs/UPSTREAM_CONTRACT.md), [palette](docs/PALETTE.md), [terminal](docs/TUI.md).
- Contributing: [repository rules](AGENTS.md), [releasing](docs/RELEASING.md), [media](docs/media/README.md).
