<p align="center">
  <img src="https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif" alt="Animated Omakit wordmark above the line tested plumbing for plugins" width="512">
</p>

**Tested plumbing, the marketplace's own checks, and a disposable Omarchy to test in.**

The three parts are the Run and Store blocks a plugin copies into its own tree, the marketplace's own checks run locally, and repository suites run in a disposable guest. Behind the first are M13's 1,001 security blocker comments from one measured week: 587 raise a Run line, 527 a Store line, and runner plus store handle 777 of 1,001 when read as an upper bound, not as a result for any plugin ([M13](docs/MEASUREMENTS.md#m13-what-the-review-blocks-on-over-one-week-of-comments-and-which-of-it-a-block-can-own)). No reviewer has seen a ported plugin yet.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml)

<!-- TODO(socket-badge): Restore the live Socket package-report badge when its endpoint reliably returns image/svg+xml without a Cloudflare challenge. Last checked 2026-09-19. -->

## What it delivers

| Command | What you get | Documentation |
| --- | --- | --- |
| `omakit add <block> [<plugin-dir>]` | Copy the Run or Store block into a plugin. The plugin owns the files, and an edited copy is never overwritten. | [Blocks](docs/BLOCKS.md) |
| `omakit inspect <plugin-dir>` | See what the tree does and what deserves attention, with the file and line for each observation. | [Inspect](docs/INSPECT.md) |
| `omakit verify <plugin-repo>` | Get the marketplace's security result for your commit, exactly as it would see it. | [Verify](docs/COMMANDS.md#omakit-verify) |
| `omakit submit <plugin-repo>` | Run every submission check and get the issue title and body ready to paste. Nothing is posted. | [Submit](docs/SUBMIT.md) |
| `omakit watch ...` | See whether the marketplace-validated commit is still current and what to do when it is not. | [Watch](docs/VALIDATION_WATCH.md) |
| `omakit audit [<plugin>]` | Find installed plugins running commits the marketplace never validated. | [Audit](docs/AUDIT.md) |
| `omakit lab <command>` | Set up, inspect, prove in or prune the disposable Omarchy guest. | [Lab](docs/LAB.md) |
| `omakit weigh <plugin>` | Measure a plugin's CPU and child processes against the shell's own baseline, then restore the shell config. | [Weigh](docs/WEIGH.md) |
| `omakit setup`, `omakit doctor` | Prepare or check the pin, completion, tools and disposable lab. | [Install](docs/INSTALL.md) |
| `omakit pin`, `omakit upgrade`, `omakit parity`, `omakit help --agent` | Maintain Omakit or inspect its own contract and parity proof. | [All commands](docs/COMMANDS.md) |

The complete syntax, options, exit codes and JSON/output contract are in the [command reference](docs/COMMANDS.md).

## Install

```bash
npm i -g omakit && omakit setup
npx skills add mtolhuys/omakit
```

Omakit needs [Node 22+](package.json) and Git. `omakit setup` prepares the pinned marketplace checkout and shell completion. The blocks also need `/usr/bin/python3`. Audit and weigh need a running Omarchy shell. The lab needs KVM, QEMU and OVMF; `omakit doctor` reports what is missing and installs nothing.

## Build

`omakit add run <plugin-dir>` and `omakit add store <plugin-dir>` copy versioned process and private-state plumbing into the plugin's `omakit/` directory; the plugin owns those files, and an edited copy is never overwritten. Commit the copied files before checking, because check reads committed `HEAD` unless you pass `--allow-dirty`. Why that plumbing is worth taking from somewhere else is [in one page](docs/WHY.md).

![Recorded terminal showing inspect before omakit add run, the copied Run files, and inspect after the fixture is ported](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/add-run.gif)

## Check

`omakit inspect <plugin-dir>` shows what the tree does, `omakit verify <plugin-repo>` runs the marketplace's baseline, and `omakit submit <plugin-repo>` runs every submission check and prints a title and body without posting them.

![Recorded terminal showing inspect ranking two long functions and listing the review class observed in a fixture](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/inspect.gif)

![Recorded terminal showing submit refusing a fixture with three blocking checks and printing their remedies](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif)

## Track

`omakit watch --all` compares open submissions with the commits the marketplace validated, while `omakit audit` compares installed third-party plugins with their validated commits; both are read-only.

![Recorded terminal showing watch-all count two current submissions and display their validation and discussion records](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif)

![Recorded terminal showing audit list installed plugin drift and close with the 13-of-19 drift summary](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif)

## Prove

After one `omakit lab setup`, `omakit lab prove <suite>` boots a fresh overlay from the verified base, prints the guest identity, runs Run, Store or weigh in that guest, records the result, removes the overlay and checks the base unchanged.

![Recorded terminal showing omakit lab prove run identify the disposable guest, complete all 19 Run scenarios, remove the overlay, verify the unchanged base and close PROVED](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/lab-prove.gif)

`omakit weigh <plugin>` is the supporting desktop measurement: after explicit consent it restarts the shell without and with the plugin, reports CPU and child processes against the baseline's own spread, and restores `shell.json`.

![Recorded terminal showing all six Theme Manager weigh samples, shell restoration, the CPU noise floor and the completed report](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh.gif)

## Evidence

| What was measured | Record |
| --- | --- |
| Review plumbing | 1,001 blocker comments; Run 587, Store 527, either 777, [M13 record](docs/evidence/blocks/2026-09-17-review-blockers.json) |
| Run | 19 of 19 on the desktop and 19 of 19 on the stock 4.0.3 guest at Run 0.2.1, [desktop](docs/evidence/blocks/2026-09-18-run-lab-desktop.json), [fresh guest](docs/evidence/lab/20260919-143209-run/runlab.json) |
| Store | 15 of 15 on the desktop and stock guest, including the simulated foreign owner, [desktop](docs/evidence/blocks/2026-09-18-store-lab-desktop.json), [guest](docs/evidence/lab/20260918-161230-store/storelab.json) |
| The disposable guest | guest `omarchy 4.0.3-1`, skew false, 2m 42.2s, 440,209,408 B overlay removed, base unchanged, [fresh run](docs/evidence/lab/20260919-143209-run/run.json) |
| The two ports | [Theme Manager through Run](docs/evidence/blocks/2026-09-17-theme-manager-port.json), [Sidecar through Store](docs/evidence/blocks/2026-09-17-sidecar-port.json); neither submitted, no reviewer has seen either |
| Validation drift | 326 of 519 readable open-submission comparisons stale, 64 of 583 unknown, [dated record](docs/evidence/staleness/2026-09-15.json) |
| README captures | eight GIFs made from committed captures and scenes, with commands, hashes, dimensions and timings in the [M10 record](docs/evidence/readme/2026-09-19-positioning.json) |
| First-reader path | packaged install, blocks, checks, tracking and a 19-scenario guest run exercised from `/tmp`, [dated record](docs/evidence/ux/2026-09-19-readme-test.json) |
| Package boundary | 0 runtime and 0 development dependencies in [package.json](package.json); 0 marketplace writes enforced by the read-only tests |

## Documentation

Every page, and which question each one answers: [the documentation
index](docs/README.md).

- [The path from a plugin to a listing](docs/WALKTHROUGH.md) and [when a command stops](docs/FAILURES.md)
- [Why the blocks exist](docs/WHY.md), [the blocks themselves](docs/BLOCKS.md) and [their design spike](docs/BLOCKS_SPIKE.md)
- [Commands](docs/COMMANDS.md), [inspect](docs/INSPECT.md), [submit](docs/SUBMIT.md), [watch](docs/VALIDATION_WATCH.md), [audit](docs/AUDIT.md) and [weigh](docs/WEIGH.md)
- [The disposable lab](docs/LAB.md) and [every measurement](docs/MEASUREMENTS.md)
- [Installation](docs/INSTALL.md), [media recipes](docs/media/README.md) and [repository rules](AGENTS.md)

Licence: [MIT](LICENSE).
