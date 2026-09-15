<p align="center">
  <img src="https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif" alt="omakit" width="440">
</p>

omakit gives Omarchy plugin authors and agents [four command views](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures) of submission readiness, validation, installed drift and recorded weight.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml) [![Socket](https://socket.dev/api/badge/npm/package/omakit)](https://socket.dev/npm/package/omakit)

## Install

```bash
npm i -g omakit && omakit setup
npx skills add mtolhuys/omakit
```

## `omakit submit <plugin-repo>`

![submit refusing a fixture plugin before any issue is posted](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif)

Runs the marketplace's own baseline on the exact commit and posts nothing ([M4: 2,916 baseline records](docs/MEASUREMENTS.md#m4-the-baseline-decides-whether-a-human-has-to-look-at-all), [M10: 0 marketplace writes](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures)). The GIF shows a refusal; fix the reported problems before preparing the issue.

## `omakit watch --all`

![watch checking five current issues, with baseline results and human discussion](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif)

Five issues are CURRENT, with human discussion visible; CURRENT means matching commits, not approval ([M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures)). For a stale example and the next step, see [validation watch](docs/VALIDATION_WATCH.md).

## `omakit audit`

![audit listing installed plugin drift before matching commits](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif)

Drift rows come first: 9 of 18 audited plugins run commits the marketplace never validated ([M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures)). The checkout commands are suggestions, not actions performed by this run.

## `omakit weigh --list`

![weigh listing installed plugins and their recorded weighing status](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh-list.gif)

The list shows 55 installed plugins, 47 enabled and 1 weighed; that single run has no spread or noise floor ([M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures)). This reads stored results; see [the weighing method](docs/WEIGH.md) before starting a measurement.

## Evidence, not claims

| Measurement | Evidence |
| --- | --- |
| Baseline parity | 30/30 local and marketplace results identical, [M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures) |
| Validated commit behind HEAD | 73% of 464 submissions parked with their author, snapshot 2026-09-12, [M6](docs/MEASUREMENTS.md#m6-the-validated-commit-falls-behind-silently-and-that-is-the-centre-of-this-tool) |
| Registry churn | 4,201/4,293 commits touched only the registry in 30 days, [M7](docs/MEASUREMENTS.md#m7-the-registry-moves-by-the-hour-the-code-and-the-rules-move-by-the-week) |
| GIFs are recorded output | 5 GIFs, committed captures and scenes, [M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures) |

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md): installation and upgrades.
- [docs/HOW.md](docs/HOW.md): baseline and check labels.
- [docs/COMMANDS.md](docs/COMMANDS.md): commands and authentication.
- [docs/SUBMIT.md](docs/SUBMIT.md): checks and output contract.
- [docs/VALIDATION_WATCH.md](docs/VALIDATION_WATCH.md): commits, discussion and review queues.
- [docs/AUDIT.md](docs/AUDIT.md): installed commit states.
- [docs/WEIGH.md](docs/WEIGH.md): method, noise and restoration.
- [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md): numbers and limits.
- [docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md): pin and boundaries.
- [docs/MARKETPLACE.md](docs/MARKETPLACE.md): intended audience.
- [docs/PALETTE.md](docs/PALETTE.md): palette indices.
- [docs/TUI.md](docs/TUI.md): terminal presentation.
- [docs/RELEASING.md](docs/RELEASING.md): release procedure.
- [docs/media/README.md](docs/media/README.md): captures and rendering.
- [AGENTS.md](AGENTS.md): repository contribution rules.
