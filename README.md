<p align="center">
  <img src="https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif" alt="Animated Omakit wordmark followed by Build it, check it, prove it." width="512">
</p>

**Build it, check it, prove it.**

Build means the Run and Store blocks a plugin copies into its own tree: in one measured week, 587 of 1,001 security blocker comments raised process plumbing, 527 raised private-state plumbing, and 777 raised at least one of the two. These are upper bounds on plumbing a block can own, not comments a block resolves ([M13](docs/MEASUREMENTS.md#m13-what-the-review-blocks-on-over-one-week-of-comments-and-which-of-it-a-block-can-own)). Check means running the marketplace's own checks locally. Prove means running the repository's suites in a disposable Omarchy guest. No reviewer has seen a ported plugin yet.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml) [![Socket package report](https://socket.dev/api/badge/npm/package/omakit)](https://socket.dev/npm/package/omakit)

## Install

```bash
npm i -g omakit && omakit setup
npx skills add mtolhuys/omakit
```

Omakit needs [Node 22+](package.json) and Git. The blocks also need `/usr/bin/python3`. Audit and weigh need a running Omarchy shell. The lab needs KVM, QEMU and OVMF; `omakit doctor` reports what is missing and installs nothing.

## Build

`omakit add run <plugin-dir>` and `omakit add store <plugin-dir>` copy versioned process and private-state plumbing into the plugin's `omakit/` directory; the plugin owns those files, and an edited copy is never overwritten. Commit the copied files before checking, because check reads committed `HEAD` unless you pass `--allow-dirty`.

![Recorded terminal showing inspect before omakit add run, the copied Run files, and inspect after the fixture is ported](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/add-run.gif)

## Check

`omakit inspect <plugin-dir>` shows what the tree does, `omakit verify <plugin-repo>` runs the marketplace's baseline, and `omakit submit <plugin-repo>` runs every submission check and prints a title and body without posting them.

![Recorded terminal showing inspect rank two long functions and list the review class observed in a fixture](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/inspect.gif)

![Recorded terminal showing submit refuse a fixture with three blocking checks and print their remedies](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif)

## Track

`omakit watch --all` compares open submissions with the commits the marketplace validated, while `omakit audit` compares installed third-party plugins with their validated commits; both are read-only.

![Recorded terminal showing watch-all count four current submissions and display their validation and discussion records](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif)

![Recorded terminal showing audit list installed plugin drift and close with the 12-of-19 drift summary](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif)

## Prove

After one `omakit lab setup`, `omakit lab prove <suite>` boots a fresh overlay from the verified base, prints the guest identity, runs Run, Store or weigh in that guest, records the result, removes the overlay and checks the base unchanged.

![Recorded terminal showing omakit lab prove run identify the guest, complete all 19 Run scenarios, remove the overlay and close PROVED](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/lab-prove.gif)

`omakit weigh <plugin>` is the supporting desktop measurement: after explicit consent it restarts the shell without and with the plugin, reports CPU and child processes against the baseline's own spread, and restores `shell.json`.

![Recorded terminal showing all six weigh samples, shell restoration, the noise floor and Omadock's completed report](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh.gif)

## Evidence

| What was measured | Record |
| --- | --- |
| Review plumbing | 1,001 blocker comments; Run 587, Store 527, either 777, [M13 record](docs/evidence/blocks/2026-09-17-review-blockers.json) |
| Run | 19 of 19 on the desktop and 19 of 19 on the stock 4.0.3 guest at Run 0.2.1, [desktop](docs/evidence/blocks/2026-09-18-run-lab-desktop.json), [fresh guest](docs/evidence/lab/20260918-191139-run/runlab.json) |
| Store | 15 of 15 on the desktop and stock guest, including the simulated foreign owner, [desktop](docs/evidence/blocks/2026-09-18-store-lab-desktop.json), [guest](docs/evidence/lab/20260918-161230-store/storelab.json) |
| The disposable guest | guest `omarchy 4.0.3-1`, skew false, 3m 11.7s, 449,974,272 B overlay removed, base unchanged, [fresh run](docs/evidence/lab/20260918-191139-run/run.json) |
| The two ports | [Theme Manager through Run](docs/evidence/blocks/2026-09-17-theme-manager-port.json), [Sidecar through Store](docs/evidence/blocks/2026-09-17-sidecar-port.json); neither submitted, no reviewer has seen either |
| Validation drift | 326 of 519 readable open-submission comparisons stale, 64 of 583 unknown, [dated record](docs/evidence/staleness/2026-09-15.json) |
| README captures | eight GIFs made from committed captures and scenes, with commands, hashes, dimensions and timings in the [M10 record](docs/evidence/readme/2026-09-18-rebrand.json) |
| Package boundary | 0 runtime and 0 development dependencies in [package.json](package.json); 0 marketplace writes enforced by the read-only tests |

## Documentation

- [Blocks](docs/BLOCKS.md) and [their design spike](docs/BLOCKS_SPIKE.md)
- [Commands](docs/COMMANDS.md), [inspect](docs/INSPECT.md), [submit](docs/SUBMIT.md), [watch](docs/VALIDATION_WATCH.md), [audit](docs/AUDIT.md) and [weigh](docs/WEIGH.md)
- [The disposable lab](docs/LAB.md) and [every measurement](docs/MEASUREMENTS.md)
- [Installation](docs/INSTALL.md), [media recipes](docs/media/README.md) and [repository rules](AGENTS.md)

Licence: [MIT](LICENSE).
