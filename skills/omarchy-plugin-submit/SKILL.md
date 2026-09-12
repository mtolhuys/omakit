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

## Run it

```bash
omakit pin     # once, and after any pin change: fetches the pinned marketplace checkout
omakit submit <path-to-the-plugin-repo> --category <category> --tags <a,b>
```

The plugin's name and id come from the root `manifest.json`. The repository URL
comes from `origin`. You supply the category and the tags, because nobody else
can: they are an editorial choice about where the plugin belongs.

If you do not know which category and tags are allowed, run the command without
them. The failing checks print the controlled lists, read from the pinned form.

Useful flags: `--notes` for the Maintainer notes field, `--suggest-tag` for the
optional suggestion, `--name` when the manifest has no name, `--json` for a
machine-readable result, `--offline` to skip the one check that needs the network.

## Reading the result

Exit code 0 means every blocking check passed and the output contains the issue
title and body. Exit code 1 means it refused, and no body was produced.

Each check names a source. `[marketplace-pin]` is the marketplace's own rule, read
from a pinned checkout. `[omakit]` is this tool's own check, derived from public
issue data. Do not describe those to the owner as marketplace requirements.

A failing check prints the failing paths, a remedy and the measured reason it
exists. Fix the cause, do not work around the check.

## The two refusals people argue with

**`tree.agent-control`.** Agent-control files anywhere in the installable tree
(`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.mcp.json`, anything under `.claude/` or
`.codex/`, instruction files under `skills/`) are a prompt-injection surface once
the plugin is installed, and listing is blocked on them by a human reviewer after
a long wait. 103 marketplace issues mention this. The remedy is to move the
guidance to a non-agent filename such as `DEVELOPMENT.md`, untrack the originals
so they leave the installable tree, and keep a recursive check in the release
process so they cannot return. Do not simply rename one file and resubmit; the
check is recursive for a reason.

**`submission.validation-commit`.** The marketplace pins its review to the commit it
resolves when the issue is validated, which is the pushed default-branch HEAD, not
whatever is checked out locally. Push first, then submit. 73% of submissions
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

Tell the owner the one thing nobody tells them: the review is now pinned to one
exact commit, and **editing the issue body** is the only action that moves that
pin. Pushing a fix does nothing. Commenting "fixed in `abc123`" does nothing.
Then use `omakit watch <issue-url>` to check it later, and see
`skills/omarchy-plugin-pin-watch/SKILL.md`.
