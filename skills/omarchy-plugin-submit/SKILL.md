---
name: omarchy-plugin-submit
description: Submit an Omarchy Quattro plugin to the plugin marketplace on its owner's behalf. Use when asked to submit, list or publish a plugin to the Omarchy marketplace, or to check whether a plugin is ready to submit. Runs every pre-submission check, produces the exact issue title and body, and posts nothing.
---

# Submitting an Omarchy plugin

## The one thing to get right

**You do not create the issue.** This tool produces a title and a body. Creating
the issue is a separate, explicit act that needs the plugin owner's approval
first, which is what the marketplace's own agent instructions require. Show the
owner the title, the body and the verdicts, ask, and only then post it.

## If omakit is not installed

```bash
npm install --global omakit   # Omarchy ships Node and npm through mise
omakit doctor                 # node, git, the pin, the credential source, and whether omakit is on PATH
```

If `omakit` is not found after the install, run
`"$(npm prefix --global)/bin/omakit" setup`: it prints the one line that puts
npm's bin on PATH for the shell in `$SHELL`. Keep it current with
`omakit upgrade`, which updates the tool through npm at the exact version the
registry names and never moves the marketplace pin.

## Run it

```bash
omakit pin     # once, and after any pin change: fetches the pinned marketplace checkout
omakit submit <path-to-the-plugin-repo> --category <category> --tags <a,b>
```

The pin is a sparse read-only checkout of one marketplace commit under
`$XDG_CACHE_HOME/omakit/marketplace` (or `~/.cache/omakit/marketplace`). Every
rule is read from it; nothing about the format is written in the tool.

The plugin's name and id come from the root `manifest.json`. The repository URL
comes from `origin`. You supply the category and the tags, because nobody else
can: they are an editorial choice about where the plugin belongs.

If you do not know which category and tags are allowed, run the command without
them: for you, in a pipe or with `--json`, that is a usage error (exit 2) whose
message lists the controlled values, read from the pinned form; with `--json`
the same lists come back under `usage`. A person at a terminal is asked
instead, once each, with the marketplace's own default for the manifest's
kinds. It is decided after the registry is read: a plugin that is already
listed is asked for nothing. A `READY` or `REFUSED` report ends with the
command line that repeats the run without asking, and `--json` carries it as
`reproduce`.

To see the official baseline result alone, with no Omakit check around it:

```bash
omakit verify <path-to-the-plugin-repo> --json
```

`verify` without `--json` prints a report for a person; `--json` is the
document, unchanged between releases.

Useful flags: `--notes` for the Maintainer notes field, `--suggest-tag` for the
optional suggestion, `--name` when the manifest has no name, `--json` for a
machine-readable result, `--offline` to skip the one check that needs the network
and to read the listed ids from the pin instead of the marketplace's current HEAD.

Never pass `--offline` to get around a listed id. `identity.available` reads the
registry from HEAD because the pin's copy is stale within hours; a run that
passes only against the pin describes a marketplace that no longer exists, and
the marketplace will refuse the id anyway. If an id or repository is listed at
HEAD, tell the owner and choose another id.

## Reading the result

A run ends one of three ways; `--json` carries it as `outcome`.

- `READY`, exit 0, `outcome: "ready"`: every blocking check passed and the
  output contains the issue title and body.
- `REFUSED`, exit 1, `outcome: "refused"`: a blocking check failed and no body
  was produced.
- `LISTED`, exit 0, `outcome: "listed"`: the plugin is already listed by its
  own repository. Nothing is wrong and nothing was refused, and there is no
  body, because the submission form is not the route. See below.

Exit code 2 is a usage error: nothing was checked.

**If the outcome is `listed`, stop.** Do not open a submission issue, and
never change the plugin id to get past it: the id is listed by this very
repository, and a renamed id would be a second listing of the same plugin.
Tell the owner the update route, which the output states: the marketplace
lists `verificationCommit`; the local commit is `localCommit`, and
`sameCommit` says whether they are the same; to get a newer commit listed,
open the marketplace's verification form (its name and the choice to pick,
"Verify and publish a newer upstream commit", are printed from the pin's own
form, under `listing.updateRoute` in `--json`), and `omakit watch <the
submission issue>` shows which commit is listed now. A listed plugin is asked
for no category and no tags, and the five body checks are omitted rather than
shown as waiting.

An id listed by a *different* repository is a refusal, `identity.available`
names that repository, and the remedy is another id. That is the one case
where changing the id is the fix.

A check drawn as `▒ ?` did not run because one it depends on failed; its detail
names that check. It is not a failure of its own, and the closing refusal lists
root causes only. Fix those.

Each check names a source. `[marketplace-pin]` is the marketplace's own rule, read
from a pinned checkout. `[omakit]` is this tool's own check, derived from public
issue data. Do not describe those to the owner as marketplace requirements.

A failing check prints the failing paths, a remedy and the measured reason it
exists. Fix the cause, do not work around the check.

## The two refusals people argue with

**`tree.agent-control`.** Agent-control files anywhere in the installable tree
(`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.mcp.json`, anything under `.claude/` or
`.codex/`, instruction files under `skills/`) are read by whatever agent the user
runs next, and 103 marketplace issues mention them. This is a warning, not a
refusal: the marketplace lists plugins that ship them (6 of 34 inspected at
their listed commit), so the body is still produced. Tell the owner, and offer
the remedy: move the guidance to a non-agent filename such as `DEVELOPMENT.md`,
untrack the originals so they leave the installable tree, and keep a recursive
check in the release process so they cannot return. The owner decides; do not
strip files from their tree on your own.

**`submission.validation-commit`.** The marketplace validates the commit it
resolves when the issue is opened or edited, which is the pushed default-branch
HEAD, not whatever is checked out locally. Push first, then submit. 73% of submissions
parked in their author's court have a HEAD the marketplace never saw.

## What the baseline result means

`baseline.preflight` runs the marketplace's own security baseline over a local
snapshot of the exact commit and reports it verbatim.

- `passed`: nothing in the baseline holds the submission back.
- `review-required`: no findings, but one or more of the seven capabilities is
  present, so a maintainer must look at this exact commit. Not a defect. Worth
  explaining in `--notes` rather than hiding.
- `needs-fixes`: findings. Only `sudoers-dangerous-passwordless-command` and
  `privileged-process-control-from-shared-temp` block publication under the
  current enforcement mode; the rest a maintainer may accept for that commit.
  Fixing them first avoids a human round either way.

Never restate any of this as a safety claim. The baseline performs no data-flow
analysis and is not a security review; the output says so in the marketplace's own
words, and so should you.

## After the issue exists

Tell the owner the one thing nobody tells them: the marketplace validated one
exact commit, and **editing the issue body** is the only action that makes it
validate a newer one. Pushing a fix does nothing. Commenting "fixed in `abc123`" does nothing.
Then use `omakit watch <issue-url>` to check it later, and see
`skills/omarchy-plugin-validation-watch/SKILL.md`.
