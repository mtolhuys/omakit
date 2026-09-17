---
name: omarchy-plugin-build
description: Build the process plumbing of an Omarchy Quattro plugin with omakit's Run block instead of a bare QML Process. Use whenever plugin code starts a program (a Process block, execDetached, a helper script, a poll), when inspect shows a process-lifecycle, unbounded-buffering or environment-trust row, or when a review comment names a deadline, an output cap, PATH, the environment or an orphaned process. Adds tested, versioned files the plugin owns; posts nothing.
---

# Building with the Run block

## Start every process through Run

Whenever plugin code starts a program, it goes through the Run block, never
through a bare `Process {`, `Quickshell.execDetached` or a shell string.
Add the block once, from the plugin's directory:

```bash
omakit add run <path-to-the-plugin-repo>
```

That writes `omakit/Run.qml`, `omakit/run-supervisor.py` and
`omakit/NOTICE` into the plugin's tree, each with a header naming the
block, its version, the MIT licence, the omakit commit and the body's
sha256, and nothing else. Commit them with the plugin: they are the
plugin's files now. Then, in the QML that starts the program:

```qml
import "omakit"

Run {
    id: catalog
    command: [Quickshell.env("HOME") + "/.config/omarchy/plugins/<id>/catalog.sh", "--refresh"]
    deadlineMs: 30000
    onFinished: result => {
        if (result.state === "ok") model.parse(result.stdout)
        else status.text = result.state + (result.reason ? ": " + result.reason : "")
    }
}
```

and `catalog.start()` where the program should run. The rules Run holds,
and the count of review comments in one week that asked for each, are in
`docs/BLOCKS.md`. The ones that shape the call:

- `command[0]` is an absolute path. Omarchy's own commands are under
  `Quickshell.env("HOME") + "/.local/share/omarchy/bin/"`; the plugin's
  own helpers under its plugin directory; system tools under `/usr/bin/`.
  A bare name is `spawn-failed` with the reason.
- `command` is argv. `["/usr/bin/bash", "-c", "..."]` is refused; write
  the helper as a file and pass its path. `allowShellString: true` exists
  for the one case that cannot be a file, on its own line, where a reviewer
  sees it.
- The program sees `PATH=/usr/bin`, `HOME`, `LANG`, `XDG_RUNTIME_DIR` and
  what `environment: ({ ... })` adds. Nothing else. A helper that needs a
  variable gets it there, by name.
- `deadlineMs` is when the run ends whatever the program does; pick it for
  the slow case and let `timeout` be the state that tells the user.
- `result.stdout` and `result.stderr` are bounded plain text with control
  characters removed; bind them to a `Text` with `textFormat:
  Text.PlainText`, never to rich text.
- `result.state` is one of `ok`, `exit`, `timeout`, `overflow`,
  `cancelled`, `spawn-failed`, `supervisor-lost`, `python-missing`. Handle
  `ok` and show the state word for the rest; every failure state carries
  `reason` or `stderr` for the details.
- A `start()` on a live run cancels it and follows; destroying the
  component ends the group. Do not add a `Timer` that kills, a
  `Component.onDestruction` that signals, or a `StdioCollector`: the block
  does those, and inspect knows it.

## Never edit the block's files

`omakit inspect` recognises an unmodified block by the sha256 in its header
and lists it as one row that raises nothing; a modified copy is reported
as modified and read like any other file, and `omakit add run --update`
refuses to overwrite it. If the block lacks something, the fix belongs in
omakit; open an issue there, keep the copy unmodified, and put what the
plugin needs on the plugin's side of the API.

Update the copy when omakit ships a new block version:

```bash
omakit add run <path-to-the-plugin-repo> --update
```

## Helpers that also run outside Run

A helper Run starts inherits the closed environment, and so does every
program the helper starts by bare name: `jq`, `find`, `curl` inside it
resolve in `/usr/bin` and nowhere else, which is what the review asks for
at that boundary. Nothing in the helper has to change for that.

A helper that also runs where Run did not start it (a hook Omarchy runs
from `hooks/`, a test, a terminal) starts with these three lines, its
own, on the plugin's side:

```bash
PATH=/usr/bin
unset BASH_ENV ENV
set -euo pipefail
```

## Check the result

After adding the block and moving each site to it, run the check loop of
`skills/omarchy-plugin-check/SKILL.md`. `omakit inspect` should show one
`blocks` line, `run 0.1.0, 2 files, unmodified: no row of its own`, each
`Run {` site as a process with its deadline observed through the block,
and no process-lifecycle or unbounded-buffering row at those sites. A row
that remains names a site that still uses `Process` directly.
