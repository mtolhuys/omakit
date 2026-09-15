---
name: omarchy-plugin-check
description: Check an Omarchy Quattro plugin while building or changing it, before committing or pushing. Use whenever you create, edit, refactor or test an Omarchy plugin, when asked whether a plugin is marketplace-ready, or before any push to its default branch. Runs the marketplace's own security baseline and submission checks locally, read-only, and reports what the marketplace would refuse.
---

# Checking a plugin while you build it

## Run this the way you run a test suite

After every meaningful change to an Omarchy plugin, run both, from the
plugin's repository root or with its path:

```bash
omakit verify <path-to-the-plugin-repo> --json
omakit submit <path-to-the-plugin-repo> --category <category> --tags <a,b> --json --offline
```

`verify` is the marketplace's own security baseline over this exact commit,
verbatim, with no Omakit check around it. `submit` is every pre-submission
check the marketplace applies, rendered from the marketplace's own form and
judged by the marketplace's own parser.

**Always pass `--category` and `--tags`.** A run without them asks a person
at a terminal, and an agent must never wait on a keyboard. If you do not know
the allowed values, run once without them in a pipe or with `--json`: that is
a usage error (exit 2) whose message lists the controlled values, read from
the pinned form. Pick the category and tags with the owner; they are an
editorial choice about where the plugin belongs.

`--offline` belongs in this loop and nowhere else: it skips the one check that
needs the network and reads the listed ids from the pin. For the real
submission, drop it, and use `skills/omarchy-plugin-submit/SKILL.md`.

## If omakit is not installed

```bash
npm install --global omakit   # Omarchy ships Node and npm through mise
omakit doctor                 # node, git, the pin, the credential source, and whether omakit is on PATH
```

If `omakit` is not found after the install, run
`"$(npm prefix --global)/bin/omakit" setup`: it prints the one line that puts
npm's bin on PATH for the shell in `$SHELL`. Keep it current with
`omakit upgrade`. The first `submit` or `verify` needs the pin: `omakit pin`
fetches a sparse read-only checkout of one marketplace commit under
`$XDG_CACHE_HOME/omakit/marketplace` (or `~/.cache/omakit/marketplace`).

## Reading the result

`submit --json` ends with `outcome`:

- `ready`, exit 0: every blocking check passed. The plugin would be accepted
  by the marketplace's automated checks as it is now.
- `refused`, exit 1: a blocking check failed. `blocking` lists the root
  causes; each check carries `detail`, `paths`, `remedy` and `why`.
- `listed`, exit 0: the plugin is already listed by this repository.
  `listing` names the reviewed commit and whether the local commit is it.

Each check has a `verdict`: `pass`, `fail`, `unknown` (it could not run
because a check it depends on failed; fix that one first) or `skipped` (not
run under `--offline`). `severity` is `blocking` or `advisory`; an advisory
check never turns `ready` into `refused`.

Each check names a `source`. `marketplace-pin` is the marketplace's own rule,
read from the pinned checkout. `omakit` is this tool's own check, derived
from public issue data with the measurement in `why`. Never describe an
`omakit` check to the owner as a marketplace requirement.

Fix the cause the remedy names. Do not work around a check, do not strip files
from the owner's tree on your own, and never change the plugin id to get past
`identity.available` when the listing is this repository's own.

## What the baseline result means

`verify` and the `baseline.preflight` check report the official outcome:

- `passed`: nothing in the baseline holds the plugin back.
- `review-required`: no findings, but one or more of the seven capabilities is
  present, so a maintainer must look at this exact commit. Not a defect; worth
  explaining in the submission's `--notes` rather than hiding.
- `needs-fixes`: findings, each with a rule id, the file, and the marketplace's
  own remedy text. Only `sudoers-dangerous-passwordless-command` and
  `privileged-process-control-from-shared-temp` block publication under the
  current enforcement mode; the rest a maintainer may accept for that commit.
  Fixing them first avoids a human round either way.

Never restate any of this as a safety claim. The baseline performs no data-flow
analysis and is not a security review; the output says so in the marketplace's
own words, and so should you.

## The commit rule

The marketplace validates the pushed default-branch HEAD, not whatever is
checked out locally. Run the check on the commit that will be pushed, then
commit and push before the real submission. On 2026-09-15, 326/519 readable author-fixes
comparisons were stale, with 64 of 583 issues unknown; that is the
round this loop is meant to prevent.

## When the plugin is ready

Hand over to `skills/omarchy-plugin-submit/SKILL.md`. The owner decides
whether to submit, and you never open the issue yourself.
