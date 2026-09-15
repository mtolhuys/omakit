# Auditing installed plugins

`omakit audit` compares every installed third-party plugin's running commit
with the exact commits the marketplace records as validated. It reads the
installed shell, the marketplace catalog and local Git checkouts. It changes
nothing.

## Facts, verified 2026-09-15

The pinned checkout is clean and is the documented commit:

```text
$ git -C "$XDG_CACHE_HOME/omakit/marketplace" status --short
[no output]
$ git -C "$XDG_CACHE_HOME/omakit/marketplace" rev-parse HEAD
38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6
```

The catalog is an object with a `plugins` array. These are the values of every
catalog field used by `audit`, for two installed listings:

```json
[
  {
    "id": "io.github.pablo-merino.altswitch",
    "repo": "https://github.com/Pablo-Merino/omarchy-altswitch",
    "sourceType": "community",
    "verificationStatus": "unverified",
    "listingValidatedCommit": "b99a58ca94e7ffcb6785d009a2e88f9e68599642",
    "listingValidatedAt": "2026-08-28T22:57:15.992Z",
    "listingValidatedBranch": "main",
    "upstreamObservedCommit": "8f54d684c89d66ecf51e6e5a9c5c574758de79be",
    "upstreamObservedBranch": "main",
    "upstreamCheckedAt": "2026-09-11T09:43:23.063Z",
    "upstreamCheckStatus": "passed",
    "upstreamValidatedCommit": "8f54d684c89d66ecf51e6e5a9c5c574758de79be",
    "upstreamValidatedAt": "2026-08-30T09:56:21.339Z"
  },
  {
    "id": "akshar.radio-atlas",
    "repo": "https://github.com/AksharP5/omarchy-radio-atlas",
    "sourceType": "community",
    "verificationStatus": "unverified",
    "listingValidatedCommit": "4e88a70f79cef462f84a56f19fb3a3971d958e21",
    "listingValidatedAt": "2026-09-04T09:29:27.750Z",
    "listingValidatedBranch": "main",
    "upstreamObservedCommit": "655bf29517a9329b3ba78955feecf6ded20c1414",
    "upstreamObservedBranch": "main",
    "upstreamCheckedAt": "2026-09-11T09:43:23.063Z",
    "upstreamCheckStatus": "passed",
    "upstreamValidatedCommit": "655bf29517a9329b3ba78955feecf6ded20c1414",
    "upstreamValidatedAt": "2026-09-10T08:57:03.312Z"
  }
]
```

During the initial probe, the installed-plugin command did not answer because the shell
was not running. That failure is authoritative, so `audit` must stop as
`NOT AUDITED` rather than substitute another list:

```text
$ omarchy plugin list --json | jq '.[0]'
omarchy-shell is not running
```

The catalog command did answer. Its first row shows that it carries the source
directory:

```json
$ omarchy-plugin-catalog | jq '.[0]'
{
  "id": "akshar.radio-atlas",
  "name": "Radio Atlas",
  "description": "Explore live radio on a rotatable globe and play stations through Omarchy's media controls.",
  "kinds": [
    "panel",
    "bar-widget"
  ],
  "firstParty": false,
  "manifestPath": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas/manifest.json",
  "sourceDir": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas",
  "entryPoints": {
    "panel": "RadioAtlas.qml",
    "barWidget": "BarWidget.qml"
  },
  "barWidget": {
    "displayName": "Radio Atlas",
    "description": "Open the world radio globe",
    "category": "Media",
    "allowMultiple": false,
    "defaultSection": "left"
  },
  "bar": null,
  "barWidgetPath": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas/BarWidget.qml",
  "barPath": null
}
```

`tools/weigh/list.mjs:51-90` already joins `omarchy plugin list --json` to
`omarchy-plugin-catalog` by `id`, taking `sourceDir` from the latter. `audit`
reuses that join.

`submit` passes the manifest id and the clone's origin to `checkIdentity` at
`tools/marketplace/submit.mjs:242-245`. `checkIdentity` compares the id and
repository at `tools/marketplace/registry.mjs:432-467`, using
`sameRepository` at lines 133-136. That comparison reduces a repository to
owner and name, ignores case and a trailing `.git`. `audit` reuses those
functions.

The verification route is read from the pin by `newerCommitChoice` at
`tools/marketplace/form.mjs:152-167`. It returned:

```json
{
  "formPath": ".github/ISSUE_TEMPLATE/verify-plugin.yml",
  "name": "Verify or update a listed plugin",
  "choice": "Verify and publish a newer upstream commit"
}
```

`watch` imports the marketplace's verification parser from the pin at
`tools/marketplace/watch.mjs:57-95`. It uses that parser for verification-form
issues instead of restating their shape.

`liveRegistry` at `tools/marketplace/registry.mjs:213-265` is the existing
loader for both `registry.json` and `site/catalog.json`. It reads both at one
resolved marketplace HEAD commit, caches the pair, and falls back to the pin.
At `--offline`, line 233 returns the pin directly. `audit` reuses this loader
unchanged.

Two installed third-party Git checkouts gave these facts. The ancestor tested
for each is its `upstreamValidatedCommit` from the catalog above.

```text
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas rev-parse HEAD
b290c29c1a9bfd1a0296f05fe995e1cd4e6e6ccd
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas status --porcelain
[no output]
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas remote get-url origin
https://github.com/AksharP5/omarchy-radio-atlas.git
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas merge-base --is-ancestor 655bf29517a9329b3ba78955feecf6ded20c1414 HEAD; echo $?
0

$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch rev-parse HEAD
8f54d684c89d66ecf51e6e5a9c5c574758de79be
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch status --porcelain
 M altswitch.lua
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch remote get-url origin
https://github.com/Pablo-Merino/omarchy-altswitch.git
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch merge-base --is-ancestor 8f54d684c89d66ecf51e6e5a9c5c574758de79be HEAD; echo $?
0
```

## Run it

```bash
omakit audit
omakit audit <plugin-id-or-dir>
omakit audit --drift
omakit audit --json
omakit audit --out audit.json
omakit audit --offline
```

The shell's installed-plugin list is authoritative. A directory target must
belong to that list. Tab completion offers installed plugin ids, then falls
back to directories, the same way `weigh` does. Tests drive both targets
through the shared model. Run `omakit setup` with the local revision to refresh
an older completion script.

| Option | Result |
| --- | --- |
| `<plugin-id-or-dir>` | Audit one installed plugin instead of every installed plugin. |
| `--drift` | Print only rows whose primary state is not `validated`. Counts and exit status still cover the selected set. |
| `--json` | Print the JSON document on stdout and nothing else. |
| `--out <file>` | Write the JSON document to the file and print the human rendering. With `--json`, stdout remains the JSON document. |
| `--offline` | Read the catalog from the exact marketplace pin and say so in the header. |

Unknown options, a missing `--out` value and a second positional are usage
errors before the shell or catalog is read.

## States and flags

Every audited plugin has one primary state.

| State | Meaning |
| --- | --- |
| `validated` | Installed HEAD equals `listingValidatedCommit` or `upstreamValidatedCommit`. |
| `ahead` | A validated commit is an ancestor of HEAD. The row gives the Git commit count and the catalog's validation date. |
| `diverged` | No validated commit is an ancestor. A missing validated object reads "validated commit not in local history" and records whether the clone is shallow. Otherwise the row distinguishes a different origin from divergent history. |
| `unverified` | The plugin is listed but records no validated commit. Its verification status is stated. |
| `unlisted` | Neither manifest id nor Git origin matches a listing. If they match different listings, neither is used and the conflict is stated. |
| `unknown` | The source directory is missing, the directory is not a Git checkout, or a Git question failed. The error is kept. |

Flags stack on that state. `modified` means `git status --porcelain` was not
empty. `disabled` comes from `omarchy plugin list --json`. `upstream moved`
means the catalog's `upstreamObservedCommit` differs from installed HEAD and
from every validated commit. It does not fetch the repository.

Validated facts read `validated <short> on <date>`. Ahead facts read
`<N> commits ahead of validated <short> (<date>); HEAD <short>`. Flags follow
a semicolon. The ahead fact names HEAD once.

Rows sort as diverged, ahead, modified, unverified, unlisted, unknown, then
validated. Modified is still a stacking flag, not a replacement state.
`--drift` retains that order. The header counts installed, first-party and
audited plugins.

Plugins whose catalog `sourceType` is `builtin`, or whose installed row says
`firstParty`, are counted in the header and left out of the rows and verdict.
They ship with the shell.

## Verdict and exit status

`AUDITED`, exit 0, means every selected third-party row is `validated`, or
there was no third-party row to audit. A modified or disabled validated row
keeps that primary state and flag.

`DRIFT`, exit 1, means at least one row is `ahead`, `diverged`,
`unverified`, `unlisted` or `unknown`.

`NOT AUDITED`, exit 1, means the shell does not answer or neither a live
catalog nor the pin can be read. The reason is printed with the verdict.

Usage errors exit 2. An ahead or diverged row prints, but never runs, the exact
`git -C <dir> checkout <validated-sha>` that returns to a reviewed commit. It
prints the verification form URL once in the footer, built from the pin's
repository, with the form name and newer-commit choice read from the pin. A
form-read failure keeps the audited rows and states the missing route. It
never recommends `omarchy plugin update`, because
that command fast-forwards to mutable HEAD.

## JSON contract

The document has `command`, `catalog`, `counts`, `rows`, `updateRoute`, `updateRouteError` and
`ok`. `catalog.source` is `head` or `pin`; its commit and read time name their
origin. Every count is `{ "value": ..., "origin": ... }`.

Each row has stable `state`, `flags`, `installed`, `validated`, `upstream`,
`sourceDir`, `listing`, `fact`, `aheadBy`, `matchedValidated` and, when Git
failed, `error`. A commit, date, Boolean or count inside those objects is a
figure with `value` and `origin`. Catalog figures name their exact
`site/catalog.json` field. Installed figures name the exact Git or Omarchy
command. Missing catalog facts are `null`, never inferred.

Under `--drift`, `rows` contains the filtered rows. `counts` and `ok` still
describe every selected third-party plugin. `--out` writes this same document.

## What it never does

`audit` does not fetch, pull, checkout or reset a repository. It does not
enable, disable, add, update or remove a plugin. It does not restart the shell,
post to the marketplace or create a local trust baseline. Its Git calls are
limited to HEAD, status, origin, object existence, shallow status, ancestry and
commit-count questions. Implicit fetching of missing objects is disabled.

## Competition, READMEs read 2026-09-15

These comparisons read READMEs, not plugin implementations. Read sources:

| Plugin | What was actually read |
| --- | --- |
| Extension Guard | Raw `main/README.md` from `vltic/omarchy-guard`. |
| OmaSafe | README rendered on the `tuthan/omasafe-plugin` repository page. The raw request failed. |
| Omavet | README rendered on the `vonsensey/omavet` repository page and its marketplace catalog description. The raw request failed. |
| Plugin Guard | Raw `master/README.md` from `kmpeeduwee/omarchy-plugin-guard`. |
| Omaudit Status | README rendered on the `godhiraj-code/omarchy-omaudit-status` repository page. The raw request failed. |

- [Extension Guard](https://github.com/vltic/omarchy-guard) installs and manages human-reviewed pinned copies; `audit` leaves existing checkouts alone and compares them with the marketplace's own validated commits.
- [OmaSafe](https://github.com/tuthan/omasafe-plugin) presents local trust drift and marketplace context through a separately installed scanner; `audit` is the CLI that reads the current marketplace catalog itself and creates no trust baseline.
- [Omavet](https://github.com/vonsensey/omavet) scans capabilities and compares changes with an operator-accepted baseline; `audit` compares installed HEAD with the exact commits the marketplace validated.
- [Plugin Guard](https://github.com/kmpeeduwee/omarchy-plugin-guard) statically scans plugin source and offers an optional model review; `audit` makes no source-safety verdict and measures marketplace commit drift instead.
- [Omaudit Status](https://github.com/godhiraj-code/omarchy-omaudit-status) renders a separate scanner's capability and baseline results in the bar; `audit` performs the marketplace commit comparison directly and prints its own document.
