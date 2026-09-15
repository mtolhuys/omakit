---
name: omarchy-plugin-check
description: Check an Omarchy Quattro plugin while building or changing it, before committing or pushing. Use whenever you create, edit, refactor or test an Omarchy plugin, when asked whether a plugin is marketplace-ready, or before any push to its default branch. Runs the marketplace's own security baseline and submission checks locally, read-only, reports what the marketplace would refuse, and lists what the tree does (processes, hosts, writes, timers) as observations beside the review classes a human reviewer raises most.
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

## Read what the tree does before a human does

After the two commands above pass, and again whenever you add or change a
`Process`, a `curl`, a `FileView`, a shell script or a `Timer`, run:

```bash
omakit inspect <path-to-the-plugin-repo> --json
```

`inspect` lists what the tree shows, in the order a reviewer reads it: every
process with its argv and whether a deadline is observed for it, every host
with its timeout and size-cap flags, every write with whether its path falls
under a directory the plugin controls, every timer with its interval, and the
baseline's capabilities. Below the facts, `patterns` holds one entry per
review class the marketplace's human review has raised, only where the tree
shows the class's precondition (a process with no deadline, a collector with
no cap, a write under `/tmp`, `curl` without `-q`), with the class's measured
share of review findings (`share`, from M11 of `docs/MEASUREMENTS.md`).
`lookedFor` names the classes whose precondition was not observed.

How to read "observed". Every row is what regular expressions found in the
text at `file:line`, never a runtime fact and never a verdict: `deadline
observed` means a killing `Timer`, a `timeout` in argv or a destruction
handler is in the file; `no cap observed` means the argv shows none of
`head -c`, `--max-filesize` or `timeout`; `observed nothing of this kind`
means the extraction found nothing, not that the tree is clean. A `▒ ?` row
(`argvForm: "computed"`, `argv: null`) is a command the text does not show
as a literal; do not guess it for the owner, read the file. `notVisible`
names what the method cannot see (commands built at run time, values from
variables or config, components outside the tree), and a tree that uses
those has facts `inspect` did not list.

What to do with a pattern row. It is not a marketplace rule and not a
finding: the marketplace's automated baseline blocks, a maintainer reviews,
and `inspect` only reports that the tree shows something reviewers have
raised in about N of every 100 findings. Show the owner the row and the
requirement in the reviewer's own terms from the M11 table (an absolute
deadline, producer-side bounds, a private 0700 directory, `curl -q`, no
secret in argv), and let the owner decide; never describe the row as a
requirement the marketplace enforces, and never say "safe" or "clean" about
a tree with no rows. The `supply-chain` row is the baseline's own finding
restated with its evidence sites; the baseline result is what decides there.
Exit status is 0 whenever a report was produced, so do not read the exit
code as pass or fail; 2 means the target could not be read.

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
