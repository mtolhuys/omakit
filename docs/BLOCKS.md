# Blocks: the Run contract

A block is a small set of files a plugin copies into its own tree with
`omakit add`, that does one piece of the plumbing the marketplace's review
blocks on most, built and tested once. This page is the contract of the
first block, Run 0.1.0: what it does, which review comments each line
answers, the API, what it costs, what it does not do, and how it is added,
updated and recognised. The reasoning and the measurements behind the
design are in [BLOCKS_SPIKE.md](BLOCKS_SPIKE.md); the plan and its gates in
[BLOCKS_PLAN.md](BLOCKS_PLAN.md).

A block is not a marketplace rule and never presents itself as one. It
implements behaviour measured from public review comments (M13,
[MEASUREMENTS.md](MEASUREMENTS.md)) and says so; whether a plugin passes
review is the reviewer's decision, and a block cannot claim it.

## What Run is

Run starts one program for a plugin and always ends it. Two files under
`omakit/` in the plugin's tree:

| File | What it is |
| --- | --- |
| `omakit/Run.qml` | The QML object a plugin uses: properties, `start()`, `cancel()`, `finished(result)`. |
| `omakit/run-supervisor.py` | The helper `Run.qml` starts through `/usr/bin/python3 -I -S -B`, by absolute path, next to it. It forks the program into a new session, watches it through a pidfd, reads both pipes under caps, keeps the deadline, ends the group and reaps the leader last. |
| `omakit/NOTICE` | The listing: block, version, licence, copyright, source commit and body sha256 per file. |

Stock Omarchy 4.0.3 has `/usr/bin/python3` (3.14.7) as a dependency of
its desktop packages, not as an Omarchy choice: on the stock guest
`pacman -Qi python` lists `uwsm`, the session manager, `ufw`, `udiskie`
and `python-gobject` among what requires it ([record](evidence/blocks/2026-09-17-run-lab-guest.json),
the lab run of 2026-09-17). `Run.qml` reports `python-missing` when it
cannot be started, and the lab gate runs on the stock guest to see it is
there.

## The contract, line by line

Each line cites how many of the 1,001 security blocker comments in the M13
week raise it ([record](evidence/blocks/2026-09-17-run-requirements.json);
the counts overlap, 587 comments raise at least one). A count is what the
review asked for, read by a calibrated classification model; it is not a
promise that the comment would not have been written.

| Line | Comments | What Run does |
| --- | ---: | --- |
| Absolute executable path | 366 | `command[0]` must be absolute; anything else is `spawn-failed` with the reason `command[0] is not an absolute path`. The supervisor and the interpreter are absolute too: `/usr/bin/python3` and the file next to `Run.qml`. |
| Closed environment | 351 | `clearEnvironment: true`; the program sees `PATH=/usr/bin`, `HOME`, `LANG=C.UTF-8`, `XDG_RUNTIME_DIR` and what the plugin adds through `environment`. Nothing else of the shell's environment reaches it, and nothing reaches what it starts: a helper under Run inherits the closed environment for every line inside it (measured: a helper calling `env`, `sort`, `sed`, `wc` by bare name with shadow copies first in the session's PATH and `BASH_ENV` set scored 0 hits in every run; 3 for the control). |
| Output cap while reading | 313 | `maxBytes` and `maxLines` per stream, counted by the supervisor as bytes arrive; over either, the run ends as `overflow` with TERM, grace, KILL. `keepBytes` is what the result carries; the rest is counted and dropped, never buffered. Measured: 1 GiB through a run leaves the Quickshell process within 0.3 MB of where it started. |
| Hard deadline | 291 | `deadlineMs` from `start()`, absolute, in the supervisor's clock; at it, TERM to the group, `graceMs` later KILL, state `timeout`. A backstop `Timer` in `Run.qml` at deadline plus grace plus 3 s sends KILL to the group by pgid and to the supervisor, state `supervisor-lost`, for the case where the supervisor itself is gone. |
| Untrusted output as plain text | 266 | `result.stdout` and `result.stderr` are text of at most `keepBytes` each with C0 (except tab and newline), DEL, C1 and the bidirectional controls removed, meant for `Text.PlainText`. An escape sequence loses its ESC and shows as the text that followed it. |
| Cancel on destruction and supersession | 130 | `Component.onDestruction` starts a detached reaper (the same file, `--kill-group`) that sends TERM, waits the grace, sends KILL, because the `Process` destructor SIGKILLs the supervisor synchronously right after. `start()` on a live run cancels it first; its result comes back as `cancelled`, then the new run starts. `cancel()` is TERM to the supervisor, which ends the group as it does on a deadline. |
| Group teardown | 126 | The program is the leader of a new session; TERM goes to the whole group, then KILL after the grace, and the run ends only when `/proc` shows no live member of the group, polled every 20 ms in the supervisor (a descendant holding the pipe after the leader exits is ended in about 50 ms, not after the grace). |
| argv, not a shell string | 106 | `command` is argv; a shell string is refused as `spawn-failed`: `sh`, `bash`, `zsh`, `dash`, `fish`, `ksh`, `python`, `python3`, `perl`, `ruby`, `php`, `lua` or `node` as `command[0]` with a `-c` among its leading options (alone or in a cluster, `-lc`). `allowShellString: true` lets it through, on its own line, where a reviewer sees it. |
| Reap order and pid identity | 18 | The leader's status is read with `waitid(P_PIDFD, WNOWAIT)` and it is reaped with `waitpid` only after the group is empty, so the group number cannot be reused by an unrelated process while it is being signalled. Measured in the spike: pure QML cannot do this, because `QProcess` reaps the leader the moment it exits. |

## The API

```qml
import "omakit"

Run {
    id: catalog
    command: [Quickshell.env("HOME") + "/.config/omarchy/plugins/me.plugin/catalog.sh", "--refresh"]
    environment: ({ MY_PLUGIN_CACHE: cacheDir })    // added to the base, never replacing it
    deadlineMs: 30000                                 // default 10000
    graceMs: 1000                                     // default 1000
    maxBytes: 4194304                                 // default 1048576, per stream
    maxLines: 100000                                  // default 10000, per stream
    keepBytes: 65536                                  // default 65536, per stream
    onFinished: result => {
        if (result.state === "ok") model.parse(result.stdout)
        else status.text = result.state + ": " + (result.reason || result.stderr)
    }
}

catalog.start()      // once; a start() on a live run cancels it and follows
catalog.cancel()     // TERM, grace, KILL; the result comes back as cancelled
catalog.running      // true from start() to the result
```

`finished(result)` delivers one object:

| Field | Value |
| --- | --- |
| `state` | one of `ok`, `exit`, `timeout`, `overflow`, `cancelled`, `spawn-failed`, `supervisor-lost`, `python-missing`; nothing else, ever |
| `exitCode` | the program's exit status, or null when it was signalled or never ran |
| `termSignal` | the signal that ended the leader, or null |
| `stdout`, `stderr` | plain text, at most `keepBytes` characters each, control characters removed |
| `outBytes`, `outLines`, `errBytes`, `errLines` | what was read, in full, before the run ended |
| `ms` | from `start()` to the result, `Run.qml`'s clock |
| `pgid` | the group the program led, 0 when nothing was started |
| `survivors` | live members of the group when the supervisor gave up on it; 0 in every measured run |
| `reason` | for `spawn-failed`, `supervisor-lost` and `python-missing`: one sentence |

`spawn-failed` comes with the exec's own errno text (`No such file or
directory`, `Permission denied`) through a close-on-exec pipe the child
writes to when `execv` fails, so a program that exits 127 on its own is
`exit` with code 127 and not a spawn failure.

Omarchy's own commands live under `~/.local/share/omarchy/bin`; the base
`PATH` is `/usr/bin` alone, so a plugin names them by absolute path
(`Quickshell.env("HOME") + "/.local/share/omarchy/bin/omarchy-theme-set"`),
or adds the directory through `environment: ({ PATH: "/usr/bin:" + ... })`
on its own line. A helper script the plugin ships is named the same way,
from `Quickshell.env("HOME") + "/.config/omarchy/plugins/<id>/"`.

## What it costs

From `tests/lab/run/` on the desktop (Quickshell 0.3.1-1, python 3.14.7-1,
2026-09-17, [record](evidence/blocks/2026-09-17-run-lab-desktop.json)); the
stock 4.0.3 guest, same day, same 13 scenarios, all ok
([record](evidence/blocks/2026-09-17-run-lab-guest.json)), 1 GiB in 917 ms
there and every other row within 20 ms of the desktop's:

| Scenario | Time to end | Quickshell Pss after minus before |
| --- | ---: | ---: |
| a program that prints one line and exits | 56 ms | +249 kB |
| 1 GiB streamed through, `keepBytes` 65,536 | 550 ms | +288 kB |
| a leader that exits while a descendant holds the pipe | 48 ms | within noise |
| a program that ignores TERM, deadline 2 s, grace 1 s | 3,053 ms | +822 kB |
| ten runs started at once, 1 MiB each | 57 ms to the last result | +634 kB |

About 50 ms and one helper process (5.7 MB Pss while it waits) per run,
of which 8 ms is the interpreter (`python3 -I -S -B -c pass`, median of
20). Time to end is `Run.qml`'s clock from `start()` to the result; Pss is
`/proc/<quickshell pid>/smaps_rollup` sampled every 100 ms, the last
sample before `start()` against the last sample at least 1.5 s after the
result; the method is in `tests/lab/run/report.py`.

## What Run does not do

- It does not follow a program out of its session. A program that calls
  `setsid` itself, or a daemon that double-forks, leaves the group and Run
  cannot end it; `survivors` counts only the group.
- It does not read the program's environment expectations. A helper that
  needs a variable gets it through `environment`, explicitly.
- It does not make a shell helper's insides safe. A helper Run starts
  inherits the closed environment, which is what the review asks for at
  that boundary; the three lines for a helper that also runs outside Run
  (a hook Omarchy runs, a test) are in the `omarchy-plugin-build` skill.
- It does not decide what a reviewer decides. The counts above are what the
  review asked for in one week; a block is plumbing, not approval.

## Adding, updating, recognising

```bash
omakit add run                 # into ./omakit/ of the plugin in the current directory
omakit add run <plugin-dir>    # into <plugin-dir>/omakit/
omakit add run --update        # replace an unmodified older copy; refuse a modified one
omakit add run --json          # the same, as a document
```

`add` writes exactly the block's files and `omakit/NOTICE`, and nothing
else; it refuses to overwrite a file that is already there without
`--update`, and with `--update` it refuses, before writing anything, a copy
whose body is not one omakit ever shipped: a modified block is the
author's, and the command says so and stops. Every written file's header
carries the block name and version, the SPDX licence, the copyright, the
omakit commit it came from (the checkout's HEAD, or the package's recorded
commit) and the sha256 of the body after the header line, so
`sha256sum <(tail -n +7 omakit/Run.qml)` is the whole check.

`omakit inspect` reads the header and the body: an unmodified block is one
row, `block run 0.1.0, 2 files, unmodified`, and its lines raise no pattern
row; a `Run {` site in the plugin's own QML is listed as a process with its
deadline observed through the block. A file with a block header whose body
is not a shipped one is reported as `modified`, and its lines are read like
any other file.

## Versioning

The block version is its own, `0.1.0`, independent of omakit's. A change
to either file's body is a new block version; `omakit add run --update`
moves an unmodified copy to it, and `inspect` names the version a copy
carries beside the one omakit ships. `blocks/run/NOTICE` in the omakit
tree and `omakit/NOTICE` in a plugin list the same per file.

## What this page does not say

It never says that a block gets a plugin through review, that it makes a
plugin safe or secure, or that the marketplace endorses it. The
marketplace says its checks are not a security audit; a block cannot
claim more. What it says is what the block does and how many comments in
the M13 week asked for it.
