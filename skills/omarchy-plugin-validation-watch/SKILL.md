---
name: omarchy-plugin-validation-watch
description: Diagnose an Omarchy marketplace plugin submission that has gone quiet or is stuck waiting. Use when a submission issue has had no progress, when a reviewer asked for a fresh validation, or when fixes were pushed but nothing happened. Checks whether the validated commit has fallen behind the repository and names the one action that re-runs validation.
---

# A submission that has gone quiet

## The mechanism, first

The marketplace validates **one exact commit**, and the review that follows is
of that commit. The only action that makes it validate a newer one is **editing
the issue body**.

- The only workflow with a direct `issues` trigger fires on
  `opened, edited, reopened, labeled, unlabeled`.
- There is no `issue_comment` trigger anywhere in the marketplace.
- The daily HEAD comparison covers plugins that are already listed, not open
  submissions.

So pushing a fix does nothing, and commenting "fixed in `abc123`" does nothing.
Both feel like progress. Neither is. The full author-fixes queue was measured on 2026-09-15: 326/519 readable
comparisons were stale (62.8%), with 64 of 583 issues unknown. The older
2026-09-12 sample found 68/93 readable issues stale (73.1%); that rate was
not a measurement of all 464 issues in the queue.

## Check it

```bash
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
omakit watch --all --json
omakit watch --list --json
```

If `omakit` is not installed: `npm install --global omakit` (Omarchy ships Node
and npm through mise), then `omakit doctor`; if the command is not found after
the install, `"$(npm prefix --global)/bin/omakit" setup` prints the one line
that puts npm's bin on PATH. `omakit upgrade` keeps it current through npm.
Add `--json` for a machine-readable result.

Use `--all --json` to discover and check every open marketplace issue authored by the signed-in `gh` account. `--list --json` discovers issue URLs without reading every plugin; use an individual URL for focused follow-up. `--user <login>` selects an explicit public author. A bare `omakit watch` opens a numbered picker only at a terminal; an agent must pass a URL, `--all` or `--list` and never wait on keyboard input.

Inspect every batch row, including read errors and unknown results; a successful row cannot stand in for a failed one. `current` only says the commit matches HEAD. Read the baseline outcome, labels and latest discussion to understand outstanding work; never equate it with approval, publication or restored catalog verification. A run is a single read-only snapshot, not a background monitor.

Read-only. It does not comment, label, or edit anything, and it cannot. It reads
the default branch through the REST API when a credential is available, taking
it from the operator's `gh` login (which itself honours `GH_TOKEN` and
`GITHUB_TOKEN`); without one it falls back to the public commit feed. Never ask the operator for a token: run
`omakit doctor` and read the `github.auth` line, which names the source.

If the diagnosis ends in a resubmission under a new id, run `omakit submit`
online: never pass `--offline` to get around a listed id, because that reads
the listed ids from the pin, which is stale within hours, and the marketplace
refuses against its current registry. If `omakit submit` ends `LISTED`
(`outcome: "listed"` in `--json`), the plugin is already listed by its own
repository: stop, do not change the id, and tell the owner the update route
the output names, the marketplace's verification form with the choice "Verify
and publish a newer upstream commit", read from the pin.

## Acting on each verdict

**`stale`.** The validated commit is behind the repository. Tell the owner plainly: the marketplace has not
seen the newer commit, and the fix is to **edit the issue body** (any edit
re-triggers validation and the baseline against the new commit). Do not advise
them to push again, and do not advise them to comment. If you are asked to do it,
that is an edit to their issue: get their explicit approval and do it yourself,
outside this tool.

**`current`.** The validated commit is the current HEAD. The submission is genuinely waiting
on a person, or on a fix the reviewer asked for that has not been made. Read the
review comments and address the substance. Do not edit the issue to "bump" it: a
fresh validation clears the reviewer's human decision and costs him a complete
re-read of the plugin.

**`unknown`.** There is no validated commit to compare, the last baseline did not
complete, or the repository's HEAD could not be read. The output says which. Never
report this as `current`.

## Before you conclude that the reviewer is behind

Check the assumption. The maintainer's own queue is a median half a day old, and
his median time from submission to publication is hours. If a submission has been
still for five days, the overwhelmingly likely reason is that it is waiting on its
author, not on him.
