# Module map

Omakit never copies marketplace policy. It imports the official analysis from a
read-only checkout of the pinned marketplace commit and feeds it a snapshot of a
local commit through the transport seam the marketplace tests itself
(`resolveSecuritySnapshot(..., { fetchImpl })`).

| File | Purpose |
| --- | --- |
| `pin.mjs` | The pin identity (one home) and the reproducible setup: `omakit pin` fetches exactly that commit into `$XDG_CACHE_HOME/omakit/marketplace` and refuses a modified checkout. |
| `local-transport.mjs` | Answers the four request shapes the official resolver makes, from a local clone at the exact commit. No network, no credentials, no writes. |
| `run-baseline.mjs` | Runs the pinned official baseline over either transport and reports the pin identity beside the result. |
| `verify.mjs` | Builds the `marketplaceBaseline` section: pin, transport, assumptions, the official result verbatim, the statement. `omakit verify` renders it for a person (`renderVerify` in `report.mjs`) and prints the document itself behind `--json` and `--out`. |
| `preflight.mjs` | Translates that result into what it will cause on submission, using the pinned policy, and renders the marketplace's own report text with its attestation marker stripped and asserted absent. |
| `yaml.mjs` | A deliberately small YAML reader for the pinned issue form. Accepts that subset and throws on anything else. |
| `form.mjs` | The submission contract, read from the form and cross-checked against the marketplace's own constants. Also the route for a plugin that is already listed: the marketplace's verification form and its "newer commit" choice, read from `verify-plugin.yml` at the pin and cross-checked against `plugin-verification-request.mjs`. |
| `registry.mjs` | The plugin-id and repository universe: the reserved namespace from the pinned catalog builder, the listed and retired ids and listed repositories from `registry.json` and `site/catalog.json` at the marketplace's current HEAD when the network is there (cached under `$XDG_CACHE_HOME/omakit/registry/<commit>/`, never in the pin) and at the pin with `--offline`; `liveFileUrl()` is the only way to the raw file host, at a 40-character commit, for those two files. `sameRepository()` is the one rule for "the subject's own repository" (owner and name, case-insensitively, a trailing `.git` ignored), and `listingOf()` is what the catalog records about a listing: since when, which commit, verified or not, checked when. |
| `tree.mjs` | The installable tree of a subject at one exact commit, from the Git object database. |
| `plugin.mjs` | The root files the submission contract needs, and the declared plugin identity. |
| `agent-control.mjs` | The recursive agent-control warning, and its remedy. |
| `issue.mjs` | Renders the issue the way the form would, then has the marketplace's own parser judge it. |
| `submit.mjs` | Assembles every check with its measured reason, and withholds the body when a blocking check fails. Three outcomes: `ready` (the body), `refused` (a blocking check failed) and `listed` (the plugin is already listed by its own repository: `identity.available` passes with the listing's record, the five body checks are omitted rather than drawn as waiting, no body exists on purpose, and `listing` carries the listed commit against the local one and the form to use for a newer commit). Decides the category and tags after the registry: a listed plugin, own or taken, is asked for neither; an unlisted one without them is asked through `ask.mjs` at a terminal, and is a usage error otherwise. Ends with `reproduce`, the command line that repeats the run without asking. Under `--offline` the validation-commit check is `skipped`, not passed: verdict `skipped`, listed under `skipped` and not `unknown`, never blocking, and the READY line says "1 check skipped (--offline)". |
| `ask.mjs` | The two questions `submit` asks a person at a terminal, and only there: category and tags, numbered from the pinned form, with the marketplace's own presentation for the manifest's kinds (read from the pinned catalog builder) as the default where it is on the list. Prompts on stderr, nothing persisted. |
| `doctor.mjs` | What is installed, what is pinned, and what has moved. `omakit.version` is one check for one question, is this the current omakit: `ok` with "0.1.8, the newest published version", a `note` with "0.1.8; 0.1.9 is published" and the upgrade command, `unknown` with the registry's failure code, `info` offline; its evidence carries `{ installed, latest, source }`. `pin.freshness` compares each path in `PIN_PATHS` between the pin and the marketplace's HEAD by tree or blob id and splits what moved by the list `registry.mjs` reads live from: `registry.json` and `site/catalog.json` moving is `ok`, because those are read from HEAD anyway; anything else moving (`scripts/`, the two forms) is a `note` naming the paths, with an action a user can take, `omakit upgrade` and then an issue at the repository named in package.json. The maintainer's pin procedure stays in `docs/UPSTREAM_CONTRACT.md` and is never printed. HEAD unreadable is `unknown`. `--json` carries `changedPaths`, `readLive` and `pinned` under the check's evidence. |
| `watch.mjs` | The validation watch: validated commit versus current default-branch HEAD, and the one action that refreshes it. |
| `github.mjs` | Read-only GitHub access. GET only. The credential is your `gh` login, read through one frozen `gh auth token` call, and is never written anywhere. |
| `style.mjs` | The visual system, defined once: the palette, the status vocabulary, the block ramp, the columns, the motion budgets, and the composition helpers every command draws with. Six states: `▁ ok`, `█ FAIL`, `▓ note`, `░ info`, `▒ ?` for a check that could not be made, and `▔ skip` for a check a flag said not to make, the floor's ink at the ceiling so it is never read as a pass. `docs/TUI.md` explains it. |
| `report.mjs` | Text rendering of submit, watch, doctor and verify for the agent that runs this tool, and the person reading over its shoulder. |
| `path-hint.mjs` | Is `omakit` reachable as a bare command, and if not, the one line that makes it so for the install that is here: a symlink for a clone, the npm prefix's `bin` on PATH for a package, said for the shell in `$SHELL`. `setup` and `doctor` print it; nothing writes an rc file. |
| `usage.mjs` | The help text, as data. |
| `completion.mjs` | A completion script for bash, zsh or fish, derived from the help data and the pin's form: the subcommands and flags are read out of `COMMANDS`, the categories and tags out of the pinned submission form, and the script says which pin it came from. `setup` installs it for the shell in `$SHELL`, the one file this tool writes outside its own checkout. |
| `banner.mjs` | The wordmark, on a bare `omakit` and in `setup` only. |
| `effect.mjs` | The one text effect: the wordmark through `ttfx` where it is drawn, with frozen arguments, a hard budget, no colour of its own, and nothing at all when `ttfx` is not there. |
| `progress.mjs` | The progress line, on stderr, only when a person is looking. |
| `paths.mjs` | Omakit's cache directory, following XDG, and `withHomeAbbreviated()`: a path under `$HOME` written as `~/...` for a person, applied where doctor, setup and pin render text and never where a result is built, so `--json` keeps every path absolute. |
| `cli.mjs` | The one entry point behind `bin/omakit`, and the one register every failure is reported in. `submit` exits on the outcome: 1 for `refused`, 0 for `ready` and `listed`. `cost` confirms before its first restart and exits 130 when interrupted, after the restore. |

`tools/cost/` is `omakit cost`, the one command that changes the user's own
machine (docs/COST.md):

| File | Purpose |
| --- | --- |
| `cost/commands.mjs` | The frozen table of Omarchy commands the measurement runs (`omarchy-shell`, `omarchy-restart-shell`, `omarchy plugin list`, `omarchy-plugin-catalog`, `qs list`, the session-lock check, `systemctl --user show-environment`, `getconf`), and the one spawn call site under `tools/cost/`. |
| `cost/proc.mjs` | Reading `/proc`: `utime+stime` and `cutime+cstime` from `stat`, `VmRSS` from `status`, `Pss` from `smaps_rollup`, and a descendant walk by parent id, all against a root that tests point at a directory. |
| `cost/config.mjs` | Where `shell.json` is, the pure transform that removes a set of plugin ids from the effective configuration, the byte-for-byte backup, the restore and its md5 verification. |
| `cost/stats.mjs` | Median, spread, the stats object, and the within-noise comparison. |
| `cost/audit.mjs` | `planCost()` reads and decides (what runs, how many restarts, the estimate) and writes nothing; `measureCost()` restarts, samples and restores in a `finally`; `buildDocument()` turns the samples into the document. |
| `cost/contract.mjs` | The JSON contract of docs/COST.md as a validator, run by the unit tests and by the lab over a real document. |
| `cost/report.mjs` | The confirmation and the report for a person, drawn with `style.mjs`; the README sentence and the evidence path come last. |
| `cost/confirm.mjs` | The one question, at a terminal, on stderr. |

```text
omakit pin
omakit submit /path/to/plugin-repo                       # asks for the category and tags at a terminal
omakit submit /path/to/plugin-repo --category Widgets --tags bar,quickshell
omakit submit https://github.com/owner/repo@<40-char sha> --category System --tags system
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/4829
omakit verify /path/to/plugin-repo                       # --json for the document
omakit parity --count 30
```

A local repository needs an `origin` on github.com for the official code to name
the repository; without one the baseline section records `transport: "none"` and
the reason. Reviewer targets are fetched read-only into
`.cache/subjects/<owner>__<repo>/` and never executed.

Metadata that cannot be known from a local clone (repository visibility, archived
and disabled state, tree truncation) is answered with the minimal valid value and
listed in `assumedByAdapter`. The marketplace rescans the public commit itself; a
local run is a preview, never an authority.

Parity is proven, not assumed: `omakit parity` compares both transports over real
listed repositories at their listing-validated commits, stratified on the outcome
the registry recorded so the corpus always contains repositories that are not
`passed`. Results land in `docs/evidence/parity/`, recording a digest of each
side rather than the findings themselves. The GitHub side uses whatever
credential `github.mjs` resolves (a `gh` login, and only that), read-only.

Two rules about the output, stated as rules because each is an exception to
a wider one. Everything omakit writes itself stays within 80 columns; text
that will be posted verbatim, the marketplace's own baseline report and the
issue body rendered from the pinned form, is never wrapped and may exceed 80,
because a wrapped body would not be the body. And stdout is the whole result;
stderr carries interactive decoration, the progress line from `progress.mjs`
and the chooser from `ask.mjs`, only when stderr is a TTY, so a piped stderr
is empty on success, and failures go to stderr always. `tests/unit/cli.test.mjs`
holds both: the width test names the two verbatim regions by their heading
and holds every other line to 80, the three-way test asserts the empty pipe,
and a pseudo-terminal test asserts that a terminal's stderr gets the progress
sequences and nothing else.

`parity`, `watch`, `doctor` and `submit` reach the network, with Node's
built-in `fetch`, which does not read proxy environment variables by default.
Behind a proxy, run them with `NODE_USE_ENV_PROXY=1`. `submit` reads two things
online, the subject's default-branch HEAD and the marketplace's current
registry, and `--offline` turns both off; `verify` needs no network at all
beyond fetching a reviewer-mode subject, and `tests/parity/offline.mjs` proves
it.
