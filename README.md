<p align="center">
  <img src="https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/banner.gif" alt="omakit" width="440">
</p>

The marketplace validates one exact commit of your plugin. Push a fix or comment "fixed", and nothing re-runs ([M6](docs/MEASUREMENTS.md#m6-the-validated-commit-falls-behind-silently-and-that-is-the-centre-of-this-tool)). omakit runs the marketplace's own checks locally, watches your submission and posts nothing.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml) [![Socket](https://socket.dev/api/badge/npm/package/omakit)](https://socket.dev/npm/package/omakit)

## Install

```bash
npm i -g omakit && omakit setup
npx skills add mtolhuys/omakit
```

Runs where [Node 22+](package.json) and Git run; `weigh` and `audit` need a running Omarchy shell.

Licence: [MIT](LICENSE).

## `omakit submit <plugin-repo>`

![submit refusing a fixture plugin before any issue is posted](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/submit.gif)

Checks the exact commit with the marketplace's own baseline and, when ready, prints the exact issue title and body for you to paste. The GIF shows a refusal with three blocking checks and their fixes.

## `omakit watch --all`

![watch counts and two current issues, including human discussion](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/watch-all.gif)

Checks your submission commits and names the action that re-runs stale validation: edit the issue body. The GIF shows five CURRENT issues in the counts and the first two issues with a discussion; CURRENT means matching commits, not approval.

## `omakit audit`

![audit keeping drift rows and the DRIFT summary visible together](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/audit.gif)

Compares your installed plugin commits with the marketplace's validated commits. The GIF shows drift rows first: on the author's desktop, 9 of 18 audited plugins ran commits the marketplace never validated.

## `omakit inspect <plugin-dir>`

![inspect showing a size score and the two review classes one fixture shows](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/inspect.gif)

Reads a plugin's tree and prints what needs attention, biggest first: a size score (10 minus the mean rank of its functions among functions in listed plugins, [M12](docs/MEASUREMENTS.md#m12-how-long-a-plugins-functions-are-in-listed-trees)), the functions over what 90 of 100 listed functions stay under, then each review class the tree shows with the class's measured share of review findings ([M11](docs/MEASUREMENTS.md#m11-what-the-human-review-raises-by-class)) and up to five sites. No verdict, nothing run from the tree; `--full` is every site, `--json` the document. Over 18 listed plugins read at their validated commits, the extraction counted 515 process sites (57 QML `Process` blocks, 458 shell lines), 17 hosts, 63 writes and 40 timers, left 15 rows it could not resolve, and printed 73 pattern rows across 17 of the 18 ([record](docs/evidence/inspect/2026-09-15-listed-sample.json)).

## `omakit weigh <plugin>`

![completed three-run desktop weighing with baseline samples and the noise floor](https://raw.githubusercontent.com/mtolhuys/omakit/main/docs/media/weigh.gif)

Measures the shell with and without your plugin, reading Pss and CPU. The GIF shows three completed runs on the author's desktop, with baseline and plugin samples and a 0.33% CPU floor ([method](docs/WEIGH.md)).

## Evidence, not claims

| Measurement | Evidence |
| --- | --- |
| Baseline parity | 30/30 identical results, [recorded corpus](docs/evidence/parity/2026-09-12-local-vs-github-2.json), 2026-09-12 |
| Stale validated commit | 326/519 readable comparisons stale (62.8%); 64/583 unknown, [2026-09-15 data](docs/evidence/staleness/2026-09-15.json) |
| Registry churn | 4,201/4,293 registry-only commits in 30 days, 2026-09-13, [M7](docs/MEASUREMENTS.md#m7-the-registry-moves-by-the-hour-the-code-and-the-rules-move-by-the-week) |
| GIFs are recorded output | 6 GIFs with [captures and scenes](docs/media/README.md) |
| Posts nothing | 0 marketplace writes, [M10](docs/MEASUREMENTS.md#m10-readme-evidence-and-command-captures) |
| Zero dependencies | 0 runtime and 0 development dependencies, counted in [package.json](package.json) |

## Documentation

- Using: [install](docs/INSTALL.md), [commands](docs/COMMANDS.md), [audience](docs/MARKETPLACE.md).
- Checks and measurements: [submit](docs/SUBMIT.md), [inspect](docs/INSPECT.md), [watch](docs/VALIDATION_WATCH.md), [audit](docs/AUDIT.md), [evidence](docs/MEASUREMENTS.md).
- Method docs: [how](docs/HOW.md), [weigh](docs/WEIGH.md), [upstream contract](docs/UPSTREAM_CONTRACT.md), [palette](docs/PALETTE.md), [terminal](docs/TUI.md).
- Contributing: [repository rules](AGENTS.md), [releasing](docs/RELEASING.md), [media](docs/media/README.md).
