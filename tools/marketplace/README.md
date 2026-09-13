# Module map

Omakit never copies marketplace policy. It imports the official analysis from a
read-only checkout of the pinned marketplace commit and feeds it a snapshot of a
local commit through the transport seam the marketplace tests itself
(`resolveSecuritySnapshot(..., { fetchImpl })`).

| File | Purpose |
| --- | --- |
| `pin.mjs` | The pin identity (one home) and the reproducible setup: `omakit pin` fetches exactly that commit into `.cache/marketplace` and refuses a modified checkout. |
| `local-transport.mjs` | Answers the four request shapes the official resolver makes, from a local clone at the exact commit. No network, no credentials, no writes. |
| `run-baseline.mjs` | Runs the pinned official baseline over either transport and reports the pin identity beside the result. |
| `verify.mjs` | Builds the `marketplaceBaseline` section: pin, transport, assumptions, the official result verbatim, the statement. |
| `preflight.mjs` | Translates that result into what it will cause on submission, using the pinned policy, and renders the marketplace's own report text with its attestation marker stripped and asserted absent. |
| `yaml.mjs` | A deliberately small YAML reader for the pinned issue form. Accepts that subset and throws on anything else. |
| `form.mjs` | The submission contract, read from the form and cross-checked against the marketplace's own constants. |
| `registry.mjs` | The plugin-id and repository universe, and the reserved namespace, read from the pinned registry, catalog and catalog builder. |
| `tree.mjs` | The installable tree of a subject at one exact commit, from the Git object database. |
| `plugin.mjs` | The root files the submission contract needs, and the declared plugin identity. |
| `agent-control.mjs` | The recursive agent-control warning, and its remedy. |
| `issue.mjs` | Renders the issue the way the form would, then has the marketplace's own parser judge it. |
| `submit.mjs` | Assembles every check with its measured reason, and withholds the body when a blocking check fails. |
| `watch.mjs` | The validation watch: validated commit versus current default-branch HEAD, and the one action that refreshes it. |
| `github.mjs` | Read-only GitHub access. GET only. The credential is your `gh` login, read through one frozen `gh auth token` call, and is never written anywhere. |
| `style.mjs` | The visual system, defined once: the palette, the status vocabulary, the block ramp, the columns, the motion budgets, and the composition helpers every command draws with. `docs/TUI.md` explains it. |
| `report.mjs` | Text rendering of submit, watch and doctor for the agent that runs this tool, and the person reading over its shoulder. |
| `usage.mjs` | The help text, as data. |
| `completion.mjs` | A completion script for bash, zsh or fish, derived from the help data and the pin's form: the subcommands and flags are read out of `COMMANDS`, the categories and tags out of the pinned submission form, and the script says which pin it came from. `setup` installs it for the shell in `$SHELL`, the one file this tool writes outside its own checkout. |
| `banner.mjs` | The wordmark, on a bare `omakit` and in `setup` only. |
| `effect.mjs` | The one text effect: the wordmark through `ttfx` where it is drawn, with frozen arguments, a hard budget, no colour of its own, and nothing at all when `ttfx` is not there. |
| `progress.mjs` | The progress line, on stderr, only when a person is looking. |
| `cli.mjs` | The one entry point behind `bin/omakit`, and the one register every failure is reported in. |

```text
omakit pin
omakit submit /path/to/plugin-repo --category Widgets --tags bar,quickshell
omakit submit https://github.com/owner/repo@<40-char sha> --category System --tags system
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/4829
omakit verify /path/to/plugin-repo
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

`parity` and `watch` are the only commands that reach the network, and they do it
with Node's built-in `fetch`, which does not read proxy environment variables by
default. Behind a proxy, run them with `NODE_USE_ENV_PROXY=1`. `submit` and
`verify` need no network at all beyond fetching a reviewer-mode subject, and
`tests/parity/offline.mjs` proves it.
