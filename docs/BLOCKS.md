# Blocks: the Run and Store contracts

A block is a small set of files a plugin copies into its own tree with
`omakit add`, that does one piece of the plumbing the marketplace's review
blocks on most, built and tested once. This page is the contract of the
two blocks, Run 0.2.0 and Store 0.2.0: what each does, which review
comments each line answers, the API, what it costs, what it does not do,
and how it is added, updated and recognised. The reasoning and the measurements behind the
design are in [BLOCKS_SPIKE.md](BLOCKS_SPIKE.md); the plan and its gates in
[history](history/2026-09-17-blocks-plan.md), what is still open in
[BLOCKS_PLAN.md](BLOCKS_PLAN.md). The adversarial review of 2026-09-18 and
what 0.2.0 changed for each of its findings is in
[evidence/blocks/2026-09-18-review.json](evidence/blocks/2026-09-18-review.json).

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
| `omakit/run-supervisor.py` | The helper `Run.qml` starts through `/usr/bin/python3 -I -S -B`, by absolute path, next to it. It takes a per-run token from stdin, forks the program into a new session behind a gate, announces the leader, releases the gate on `Run.qml`'s acknowledgement, watches it through a pidfd, reads both pipes under caps, keeps the deadline, ends the group and reaps the leader last. Every line it reports starts with the token. |
| `omakit/NOTICE` | The listing: block, version, licence, copyright, source commit and body sha256 per file. |

Stock Omarchy 4.0.3 has `/usr/bin/python3` (3.14.7) as a dependency of
its desktop packages, not as an Omarchy choice: in the 4.0.3 guest
`pacman -Qi python` lists `uwsm`, the session manager, `ufw`, `udiskie`
and `python-gobject` among what requires it (`guest-plumbing.txt` in
[the lab run of 2026-09-18](evidence/lab/20260918-160936-run/), read
from the installed packages; the same reading of 2026-09-17 is in
[that record](evidence/blocks/2026-09-17-run-lab-guest.json), whose
session was dev-linked and says so). `Run.qml` reports
`python-missing` when it cannot be started, and the lab suite runs on the
guest to see it is there.

## The contract, line by line

Each line cites how many of the 1,001 security blocker comments in the M13
week raise it ([record](evidence/blocks/2026-09-17-run-requirements.json);
the counts overlap, 587 comments raise at least one). A count is what the
review asked for, read by a calibrated classification model; it is not a
promise that the comment would not have been written. Two lines carry
`(review)` instead of a count: they answer the adversarial review of
2026-09-18 on the block's own plumbing, not a class of marketplace
comments.

| Line | Comments | What Run does |
| --- | ---: | --- |
| Absolute executable path | 366 | `command[0]` must be absolute; anything else is `spawn-failed` with the reason `command[0] is not an absolute path`. The supervisor and the interpreter are absolute too: `/usr/bin/python3` and the file next to `Run.qml`. |
| Closed environment | 351 | `clearEnvironment: true`; the program sees `PATH=/usr/bin`, `HOME`, `LANG=C.UTF-8`, `XDG_RUNTIME_DIR` and what the plugin adds through `environment`. Nothing else of the shell's environment reaches it, and nothing reaches what it starts: a helper under Run inherits the closed environment for every line inside it (measured: a helper calling `env`, `sort`, `sed`, `wc` by bare name with shadow copies first in the session's PATH and `BASH_ENV` set scored 0 hits in every run; 3 for the control). |
| Output cap while reading | 313 | `maxBytes` and `maxLines` per stream, counted by the supervisor as bytes arrive; over either, the run ends as `overflow` with TERM, grace, KILL. `keepBytes` is what the result carries; the rest is counted and dropped, never buffered. Measured: 1 GiB through a run leaves the Quickshell process within 0.3 MB of where it started. |
| Hard deadline | 291 | `deadlineMs` from `start()`, absolute, in the supervisor's clock; at it, TERM to the group, `graceMs` later KILL, state `timeout`. A backstop `Timer` in `Run.qml` at deadline plus grace plus 3 s sends KILL to the group by pgid and to the supervisor, state `supervisor-lost`, for the case where the supervisor itself is stopped. A `start()` queued behind that backstop waits until the killed supervisor is reaped before it follows (R3). |
| Untrusted output as plain text | 266 | `result.stdout` and `result.stderr` are text of at most `keepBytes` each with C0 (except tab and newline), DEL, C1 and the bidirectional controls removed, meant for `Text.PlainText`; the supervisor removes them and `Run.qml` removes them again from whatever it delivers, `reason` included. An escape sequence loses its ESC and shows as the text that followed it. |
| Unforgeable protocol | (review) | The program is a same-uid child of the supervisor and can open the supervisor's stdout through `/proc/<ppid>/fd/1` and write into it (measured: it can, on a stock kernel with Yama scope 1). So `Run.qml` generates 128 random bits per run and writes them to the supervisor's stdin, never argv or the environment, which `/proc` shows; the supervisor consumes them before the fork; every line it reports starts with them; `Run.qml` drops a line without them, takes the first `leader` line and the first `result` only, accepts a `state` only from the closed set, and bounds the unfinished line it buffers at six times `keepBytes` plus 64 KiB. A forged leader, a forged result or a stream without a newline changes nothing (R1). |
| Cancel on destruction and supersession | 130 | `Component.onDestruction` starts a detached reaper (the same file, `--kill-group`) that sends TERM, waits the grace, sends KILL, because the `Process` destructor SIGKILLs the supervisor synchronously right after. A run whose leader line `Run.qml` has not read yet is still behind the supervisor's gate: the forked child waits for one byte before it execs, the dying supervisor closes the gate, the child exits unrun (R4). `start()` on a live run cancels it first; its result comes back as `cancelled`, then the new run starts. `cancel()` is TERM to the supervisor, which ends the group as it does on a deadline. |
| A supervisor that dies is not an escape | (review) | A program can `kill -9` its own supervisor (same uid). When the supervisor exits or dies without a valid result, `Run.qml` starts the detached reaper for the group it learned, reports `supervisor-lost` with what it did in `reason`, and the group is TERM, grace, KILL like any other end (R2). |
| Group teardown | 126 | The program is the leader of a new session; TERM goes to the whole group, then KILL after the grace, and the run ends only when `/proc` shows no live member of the group, polled every 20 ms in the supervisor (a descendant holding the pipe after the leader exits is ended in about 50 ms, not after the grace). |
| argv, not a shell string | 106 | `command` is argv; a shell string is refused as `spawn-failed`. What is refused, best effort and not a sandbox: an interpreter by basename (digits and dots stripped: `python3.14` is `python`) with its string flag among its leading options, alone, in a cluster (`-lc`, `-ne`), or behind options that take a value (`-o pipefail -c`, `-W ignore -c`, `--rcfile x -c`, `+x -c`): `-c` for `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`, `rbash`, `ash`, `mksh` and `busybox <shell>`, `-c` for `python`, `-e` and `-E` for `perl`, `-e` for `ruby` and `lua`, `-r` and `--run` for `php`, `-e`, `-p`, `--eval` and `--print` for `node`; `flock -c` and `--command`; and the same seen through `env` (its `NAME=value` words and options skipped), `nice`, `timeout` (its duration skipped), `setsid`, `flock` (its lock file skipped), `xargs`, `sudo`, `doas`, `nohup`, `stdbuf`, `ionice`, `chrt`, `unbuffer` and `busybox`, up to eight deep. A script path followed by `-c` is a script (`bash x.sh -c`), and `--` ends the options. An interpreter, wrapper or flag not in this list is not refused; `allowShellString: true` lets any of it through, on its own line, where a reviewer sees it (R5). |
| Reap order and pid identity | 18 | Inside the supervisor, the leader's status is read with `waitid(P_PIDFD, WNOWAIT)` and it is reaped with `waitpid` only after the group is empty, so the group number cannot be reused by an unrelated process while the supervisor signals it. Measured in the spike: pure QML cannot do this, because `QProcess` reaps the leader the moment it exits. The two paths that signal by number without the supervisor are under what Run does not do. |

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
`exit` with code 127 and not a spawn failure. `supervisor-lost` says in
`reason` what happened to the supervisor and that the group it named was
handed to the reaper.

Omarchy's own commands live under `~/.local/share/omarchy/bin`; the base
`PATH` is `/usr/bin` alone, so a plugin names them by absolute path
(`Quickshell.env("HOME") + "/.local/share/omarchy/bin/omarchy-theme-set"`),
or adds the directory through `environment: ({ PATH: "/usr/bin:" + ... })`
on its own line. A helper script the plugin ships is named the same way,
from `Quickshell.env("HOME") + "/.config/omarchy/plugins/<id>/"`.

## What it costs

From `tests/lab/run/` on the desktop (Quickshell 0.3.1-1, python 3.14.7-1,
2026-09-18, Run 0.2.0, [record](evidence/blocks/2026-09-18-run-lab-desktop.json)).
The same 19 scenarios ran the same afternoon on the stock 4.0.3 guest
through `omakit lab run run`, all ok, the guest's installed package
`omarchy 4.0.3-1` read by the run and its session not linked
([record](evidence/lab/20260918-160936-run/runlab.json)): there the
first row took 157 ms, 1 GiB streamed through in 1,469 ms, and the other
three rows below were within 20 ms of the desktop's; one run each, so no
spread is known, and the desktop's rows are the ones in the table. An
earlier guest run that day ([record](evidence/blocks/2026-09-18-run-lab-guest.json),
1 GiB in 865 ms) had its session dev-linked to a source checkout and is
superseded; it says so in place.

| Scenario | Time to end | Quickshell Pss after minus before |
| --- | ---: | ---: |
| a helper that prints its environment and exits | 63 ms | +317 kB |
| 1 GiB streamed through, `keepBytes` 65,536 | 833 ms | +333 kB |
| a leader that exits while a descendant holds the pipe | 58 ms | +289 kB |
| a program that ignores TERM, deadline 2 s, grace 1 s | 3,061 ms | +309 kB |
| ten runs started at once, 1 MiB each | 68 ms to the last result | +676 kB |

One cost is not in the table and is the marketplace's: a plugin that
carries Run 0.2.0 shows the `privilege` capability in the marketplace
security baseline, and is `review-required` for that alone. Measured
2026-09-18 on a throwaway plugin with nothing but a manifest, a README, a
licence and `omakit add run` ([record](evidence/blocks/2026-09-18-run-block-baseline.json)):
`privilege` at `omakit/run-supervisor.py` (line 57, the line where the
supervisor's wrapper list names `sudo` and `doas` so that `sudo sh -c`
is refused as a shell string, R5). The baseline is a source scan and
reads the word. Not changed in the release round: dropping the two words
narrows a contract line that answers 106 comments, and that is a block
change with its own review; the release notes list it. Theme Manager was
review-required already, for `installer`.

About 60 ms and one helper process (5.7 MB Pss while it waits) per run,
of which 8 ms is the interpreter (`python3 -I -S -B -c pass`, median of
20) and under a millisecond the token and the gate's round trip (0.1.0
measured 56 ms for the first row on 2026-09-17). Time to end is
`Run.qml`'s clock from `start()` to the result; Pss is
`/proc/<quickshell pid>/smaps_rollup` sampled every 100 ms, the last
sample before `start()` against the last sample at least 1.5 s after the
result; the method is in `tests/lab/run/report.py`.

## What Run does not do

- It does not follow a program out of its group. A program that calls
  `setsid` or `setpgid` itself, or a daemon that double-forks, leaves the
  group and Run cannot end it; `survivors` counts only the group.
- It does not hold the group number after the supervisor is gone (R6). The
  detached reaper and the backstop signal the group by number, and the
  supervisor that held the leader unreaped is being killed at that moment;
  during the reaper's grace (1 s by default) the number is free. An
  unrelated process would be hit only if it took that exact pid in that
  second, which needs the pid counter to wrap: 4,194,304 pids on the stock
  kernel (`kernel.pid_max`), 32,768 where a distribution keeps the old
  value.
- It does not give up before the deadline (R7). After `cancel()` or an
  overflow, a group member that KILL does not end (uninterruptible sleep on
  a hung mount) keeps the supervisor polling until deadline plus grace plus
  2 s, and the backstop fires 1 s later; with a deadline of ten minutes a
  `cancel()` can take ten minutes to report, and a `start()` queued behind
  it waits with it. The condition is a process that survives SIGKILL.
- It does not restore the signal dispositions Python ignores (R8). The
  program inherits `SIGPIPE` and `SIGXFSZ` ignored through `execv`, as
  every process a Python parent starts does: a helper's pipeline producer
  that does not check write errors gets `EPIPE` and spins to the deadline
  instead of dying, and a write past `RLIMIT_FSIZE` returns short instead
  of killing the writer. A helper that needs the defaults resets them
  (`trap - PIPE` does not; a shell cannot un-ignore an inherited `SIG_IGN`
  for `SIGPIPE`; a C or Python program can).
- It does not read the program's environment expectations. A helper that
  needs a variable gets it through `environment`, explicitly.
- It does not make a shell helper's insides safe. A helper Run starts
  inherits the closed environment, which is what the review asks for at
  that boundary; the three lines for a helper that also runs outside Run
  (a hook Omarchy runs, a test) are in the `omarchy-plugin-build` skill.
- It does not decide what a reviewer decides. The counts above are what the
  review asked for in one week; a block is plumbing, not approval.
- It does not draw the per-run token from a cryptographic source. The 128
  bits `Run.qml` writes to the supervisor's stdin come from the QML
  engine's ordinary random source (`Math.random`, seeded by Qt), which is
  enough because the program never observes a token, on stdin, in argv,
  in the environment or through `/proc`, and every run gets a new one; a
  token that is never seen does not need to be unguessable, only
  unrepeated within the run.

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
row, `block run 0.2.0, 2 files, unmodified`, and its lines raise no pattern
row; a `Run {` site in the plugin's own QML is listed as a process with its
deadline observed through the block. A file with a block header whose body
is not a shipped one is reported as `modified`, and its lines are read like
any other file.

## The first port: Theme Manager, 2026-09-17

Theme Manager (`io.github.mtolhuys.theme-manager`, 0.6.8, the author's
own) is the proof plugin. On its `run-port` branch every QML process site
goes through Run: 23 `Process` blocks, 3 `execDetached` calls and one
`Util.execArgv` became 24 Run sites and 2 in-process `FileView` writes
(the selection and done files a waiting `omarchy-menu-images` reads must
survive the picker's destruction, and Run ends its group on destruction).
Seven `bash -c` strings are gone: five became argv helpers, two the
writes. Measured with the same omakit checkout and pin before (`7239ae8`,
the commit the marketplace validated) and after
([record](evidence/blocks/2026-09-17-theme-manager-port.json), counts only):

| inspect | Before | After |
| --- | ---: | ---: |
| process lifecycle rows | 23 | 0 |
| unbounded buffering rows | 18 | 0 |
| QML sites with a deadline observed | 0 of 26 | 24 of 24 |
| QML sites that are a shell string | 6 | 0 |
| environment trust, QML sites | 13 | 0 |
| environment trust, shell lines | 462 | 484; 434 once the 50 names in the 9 helpers a Run site resolves to are counted apart |
| file and state boundary rows | 7 | 7 |
| blocks row | none | `run 0.1.0, 2 files, unmodified` |
| verify | review-required, installer | the same at 0.1.0; at 0.2.0, review-required, installer and privilege (below) |
| submit | listed | the same |

The shell lines rose by the five new helpers' bare `mkdir`, `cmp`, `cp`,
`stat`, `readlink`, `flock`, `tr` and `gsettings`, which run under Run's
closed environment (the prelude decision, [BLOCKS_SPIKE.md](BLOCKS_SPIKE.md)).
Since phase 5 inspect says so: where every QML process site of a tree is
a Run site, a helper a Run site's `argv[0]` resolves to through the text
is started through Run, its shell lines carry `closedEnvironment: true`,
and the environment-trust row counts their tool names apart, in words. On
the port 12 of the 24 sites resolve to 9 helpers of the tree; 434 ambient
sites remain: the hook Omarchy runs, the five lab scripts nothing in the
plugin starts, and three helpers Run does start but whose argv the text
does not show (`icons-browse.sh` and `install-wallpaper.sh` from a
function that returns the array, `reset-icons.sh` from a ternary of
arrays), which inspect leaves ambient rather than guess
([record](evidence/blocks/2026-09-17-theme-manager-port.json),
`closedEnvironmentReading`).
What the port ran: the ported controllers and the picker's Run sites in a
separate Quickshell instance under `systemd-run --user --scope -p
MemoryMax=768M`, 16 actions as expected, the desktop's icon theme and
background untouched; and the plugin's own lab acceptance in the plugin
lab guest, 27 of 27, including a theme install and apply, a wallpaper
install with `omarchy-theme-bg-set`, and the hook at its real path. That
guest's session was dev-linked to the omarchy checkout at `b5589fa` (the
v4.0.3 tag plus one merge), so the 27 steps exercised that checkout's
shell and not the installed 4.0.3-1 package; the record says so, and
"on the stock guest" is withdrawn. It has not been re-run: `omakit lab`
runs this repository's suites, not a plugin's acceptance
([LAB.md](LAB.md), what the lab does not do).

The review's open blocker on the plugin (at `cc6486a`: a partial clone's
`git cat-file -s` before the size check, an unbounded tree and pack fetch)
had been replaced on main by a bounded archive download; the port adds
the proof against real hostile repositories served over a local socket
(`tests/theme-install-hostile.py`): an oversized blob refused after the
inventory pass with nothing extracted, an oversized pack refused before a
byte of body when its length is declared and at the cap plus one 64 KiB
read when it is not, a trickle stopped by the deadline. Git is not started
from QML anywhere in the plugin. The port is not submitted; the plan says
when.

## Store

Store keeps one private file for a plugin: read, write and remove, the
way the review asks for. Two files under `omakit/`, beside Run's, which
Store uses to start its helper (`omakit add store` writes both blocks):

| File | What it is |
| --- | --- |
| `omakit/Store.qml` | The QML object: `pluginId`, `name`, `kind`, `maxBytes`, `schema`; `read()`, `write(value)`, `remove()`; `finished(result)`; operations queue and run one at a time. |
| `omakit/store-helper.py` | The helper Store starts through Run: the descriptor walk from HOME, the checks on every descriptor, the capped read, the schema check, the exclusive staging file and the rename. One JSON line is the result. |

The code is the catalog cache transaction of `omarchy-theme-manager`
0.5.15 (`catalog-cache.py`, commit `dbd70be`, 2026-09-12), which the
marketplace review read without a further file or state comment, carried
over function by function and split under the M12 size.

### The contract, line by line

Each line cites how many of the 1,001 security blocker comments in the M13
week raise it ([record](evidence/blocks/2026-09-17-store-requirements.json),
the same run as Run's; 527 comments raise at least one, the counts overlap).

| Line | Comments | What Store does |
| --- | ---: | --- |
| Descriptor-relative opens, no-follow | 392 | Every directory on the way from HOME to the plugin's directory is opened with `O_DIRECTORY | O_NOFOLLOW` relative to the descriptor before it, and the file relative to the last one with `O_NOFOLLOW | O_NONBLOCK`, so a FIFO planted at the file's name opens at once instead of waiting for a writer and is `refused` as `not a regular file` (S1); `O_NONBLOCK` is cleared only after that check. A planted link anywhere is `refused` with the reason `... is a symbolic link` (`ELOOP`, or `ENOTDIR` where a directory was demanded). Measured: a link on the plugin directory, on its parent and on the file itself, 0 bytes reach the target; a FIFO, refused in under a second. A refusal partway through the walk closes the descriptors it opened, so an importer that keeps calling never runs out (S5). |
| No check-then-use | 288 | Nothing is checked by path. Every check is `fstat` on the descriptor that was just opened, and the write is a rename over whatever is there. Measured: a neighbour swapping the file between a regular file and a link 40 operations long; every read `ok`, `missing` or `refused`, the target untouched. |
| Exclusive 0600 temp, atomic replace | 273 | A write goes to `.store-<pid>-<16 hex>.tmp` opened `O_CREAT | O_EXCL` at mode 0600 in the plugin's directory, written in a loop until every byte is there, `fsync`ed, renamed over the name, and the directory is `fsync`ed; a short write, `ENOSPC`, a quota or `RLIMIT_FSIZE` unlinks the staging file and the write is `failed`, the old file untouched (S2). A staging file a crashed writer left is swept once it is older than ten minutes, never sooner. Measured: ten writers at once, the file is one whole write and no staging file is left; a stale staging file is swept and a fresh one kept; a write cut short by `RLIMIT_FSIZE` leaves the old file whole and nothing staged. |
| Owner and regular-file checks | 263 | After every open: a directory is a directory, a file is a regular file, and both are owned by this user; anything else is `refused` by name. Measured in the 4.0.3 guest with `chown root` ([record](evidence/lab/20260918-161230-store/storelab.json), `foreign-owner`): `refused`, `not owned by this user`. |
| Schema check on parse | 218 | A read is parsed as JSON without `NaN` or `Infinity`, nested at most 64 levels deep, and checked against `schema`, a subset: `type` (one name, not a list), `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `maxLength`, `maxItems`, `maxProperties`, `minimum`, `maximum`, `pattern`; a departure is `invalid` with the path that departs. A write is checked the same way before anything is written. A schema outside that subset in shape, or over 64 KiB, is `refused` by keyword before anything is read (S6). |
| Size cap on read | 190 | `maxBytes` (default 1 MiB), enforced while reading: one byte over is `overflow`, and the rest is not read. The result line carries the value as UTF-8, not `\u`-escaped, so a file within the cap is within the helper's output cap whatever script it is in (S3). A write over `maxBytes`, or over 64 KiB of UTF-8 (one argument to the helper, counted in bytes, not characters), is `overflow` before it starts (S4). |
| Refuse group- or world-writable | 146 | Every directory and file on the way with `mode & 022` is `refused`, `writable by the group or by others`; what Store creates is 0700 and 0600. |
| A private 0700 directory under the XDG base | 96 | `$XDG_STATE_HOME/<pluginId>` (default `~/.local/state`) or `$XDG_CACHE_HOME/<pluginId>` (`~/.cache`), created with mode 0700 where missing, one directory per plugin id; the base has to be inside HOME, or the walk cannot vouch for it and the operation is `refused`. |
| No /tmp | 63 | There is no path but the one above; the staging file lives in the plugin's own directory. |

### The API

```qml
import "omakit"

Store {
    id: memory
    pluginId: "io.github.me.plugin"                  // the private directory's name
    name: "memory.json"                              // the file in it
    kind: "state"                                    // or "cache"
    maxBytes: 1048576
    schema: ({ type: "object", required: ["version"], properties: { version: { type: "integer", minimum: 1 } }, additionalProperties: false })
    onFinished: result => {
        if (result.op === "read" && result.state === "ok") apply(result.value)
        else if (result.state !== "missing") status.text = result.state + ": " + result.reason
    }
}

memory.read()
memory.write({ version: 1, themes: {} })
memory.remove()
memory.busy
```

`finished(result)` delivers one object per operation, in the order the
operations were called:

| Field | Value |
| --- | --- |
| `op` | `read`, `write` or `remove` |
| `state` | one of `ok`, `missing`, `invalid`, `refused`, `overflow`, `failed`, `helper-failed`; nothing else |
| `value` | the parsed JSON, on an `ok` read |
| `bytes`, `mtime` | the file's size and modification time, on an `ok` read; the bytes written, on an `ok` write |
| `path` | the file's path, whenever the directory was reached |
| `reason` | one sentence, for every state but `ok` and `missing` |

`refused` names a check that failed on a descriptor; `invalid` a parse or
schema departure; `overflow` a size over the cap; `failed` an operating
system error by name; `helper-failed` a helper that ended other than `ok`
under Run, with Run's state in the reason.

### What it costs

From `tests/lab/store/` on the desktop, 2026-09-18, Store 0.2.0: a read or
a write is one helper run under Run, 84 to 92 ms from the call to the
result across the scenarios' first operation, 199 ms for the 792 KB
non-ASCII read and 3 ms for a write refused in QML for its size; ten
writers started at once all finished within 87 ms. Measured by the
harness's clock (`Date.now()` at the call and at the result), in
[the record](evidence/blocks/2026-09-18-store-lab-desktop.json); the stock
guest's, 15 of 15 through `omakit lab run store` with the installed
package read and the session not linked, is
[the lab record](evidence/lab/20260918-161230-store/storelab.json). The
earlier guest run of that day
([record](evidence/blocks/2026-09-18-store-lab-guest.json)) had its
session dev-linked and is superseded; it says so in place.

### What Store does not do

- It does not keep a cache a helper downloads: a write is one argument to
  the helper, capped at 64 KiB of UTF-8 (the kernel's one-argument limit is
  128 KiB; a schema is capped the same way). A helper that fetches a
  catalog keeps the transaction on its own side; `store-helper.py` is
  importable for that and Theme Manager's `catalog-cache.py` is the same
  code.
- It does not accept a HOME that is itself a symbolic link, or an XDG base
  that is group-writable (S7). `O_NOFOLLOW` applies to the last component,
  so `/home` being a link (`/var/home` on some distributions) is followed
  and fine, but `HOME=/home/me` where `me` is a link is `refused`; and a
  base created with umask 002 (`~/.cache` at 0775) is `refused` by the
  mode check. Both are the walk refusing to vouch, not a defect; the
  condition is that deployment.
- It does not walk outside HOME. An `XDG_STATE_HOME` or `XDG_CACHE_HOME`
  elsewhere is `refused`, because the walk cannot vouch for a directory it
  cannot check owner by owner.
- It does not lock. Two writers race by rename; the last whole write wins,
  and no reader ever sees a partial one.

### The first port: Sidecar, 2026-09-17

Sidecar (`github.com/mtolhuys/omarchy-sidecar`, the author's own) keeps
its device state in a Python daemon, not in QML, so the port is on the
helper's side: on its `store-port` branch `sidecar/util.py` imports
`omakit/store-helper.py` and `sidecar/store.py` reads and writes
`devices.json` through `result_of`, with the walk's `HOME` and
`XDG_STATE_HOME` passed in by the importer rather than read from the
process. A read that is not `ok` and not `missing` moves the file aside
as `devices.corrupt.<hex>.json` and starts the daemon paused
([record](evidence/blocks/2026-09-17-sidecar-port.json), counts only):

| Measured | Before | After |
| --- | ---: | ---: |
| inspect, every count | unchanged | unchanged |
| `blocks` line | none | store 0.1.0 and run 0.1.0, 4 files, unmodified |
| the plugin's tests | 71 | 71 |
| desktop exercise | | `devices.json` 0600 in a 0700 directory; a planted link in the state path refused and moved aside, the daemon paused |
| guest lifecycle | blocked | blocked, identically |

`inspect` counts are unchanged because the writes were never in QML:
inspect reads QML and shell, and a Python daemon's `open()` was never a
row. What the port changes is what the daemon does at the file, and the
evidence is the exercise, not a count. The guest lifecycle is blocked on
`main` and on the port alike, before the block runs: the service reads
`manifest.__sourceDir`, which the shell of the omarchy checkout at
`b5589fa` strips, so the helper path is `/helper/sidecarctl` and the
widget never reaches its state. That is Sidecar 0.2.1's own
incompatibility with that shell, reproduced on `main` in the same lab
guest, whose session was dev-linked to that checkout (the record says
so); whether the installed 4.0.3-1 shell strips it too was not tested.
The port's guest evidence is the Store lab suite on the unlinked guest
([record](evidence/lab/20260918-161230-store/storelab.json)). The port
is not submitted; no reviewer has seen it.

## Versioning

A block's version is its own, `0.2.0` for each since 2026-09-18 (`0.1.0`
on 2026-09-17), independent of omakit's.
A change to a file's body is a new block version; `omakit add <block>
--update` moves an unmodified copy to it, and `inspect` names the version
a copy carries beside the one omakit ships. `blocks/<name>/NOTICE` in the
omakit tree and `omakit/NOTICE` in a plugin list the same per file, every
block present in one NOTICE.

## What this page does not say

It never says that a block gets a plugin through review, that it makes a
plugin safe or secure, or that the marketplace endorses it. The
marketplace says its checks are not a security audit; a block cannot
claim more. What it says is what the block does and how many comments in
the M13 week asked for it.
