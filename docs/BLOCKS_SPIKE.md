# Run spike: two designs measured on a real Quattro shell

Status: phase 1 of [the blocks plan](BLOCKS_PLAN.md), done 2026-09-17. This
is a measurement record and a design decision. No omakit source changed, no
block exists yet, nothing was released or posted. Every figure below says
how it was measured; the per-run rows are in
[evidence](evidence/blocks/2026-09-17-run-spike.json).

## The question

Run starts one program for a plugin and always ends it. Two designs could do
that from a plugin's own tree without a binary:

- **(a) pure QML**: `Process` with `clearEnvironment` and a minimal
  environment, the program started through `/usr/bin/setsid` so the leader
  is a session and group leader, `SplitParser` with an empty marker to count
  output as it arrives, a deadline `Timer`, then TERM, grace, KILL to the
  process group through `/usr/bin/kill`, and a group KILL from
  `Component.onDestruction`.
- **(b) QML plus a supervisor**: the same `Process` and environment, running
  `/usr/bin/python3 -I -S -B <plugin dir>/run-supervisor.py` by absolute
  path. The supervisor forks the program into a new session, watches it
  through a pidfd, reads both pipes in a `select` loop under byte and line
  caps, keeps an absolute deadline, sends TERM to the group, waits the
  grace, sends KILL, waits until the group is empty, and reaps the leader
  last. It prints one JSON line per event; the last is the result.

Gate G1 asks of either: all five scenarios end within deadline plus grace,
no orphan survives, no process group is signalled after it was reaped.

## Is the plumbing on a stock install

The desktop this ran on is a development Omarchy (`dev (e5b0dc22)`), so the
stock question was answered from the lab's 4.0.3 base image,
`omarchy-iso/test-runs/omarchy-4.0.3/base.qcow2`, installed 2026-09-10. Its
installer's pacman log (`runs/20260910-212615/pacman.log`, 944 `installed`
lines, `omarchy (4.0.3-1)` among them) records:

| File | Package on stock 4.0.3 | Why it is there | Same on the desktop |
| --- | --- | --- | --- |
| `/usr/bin/python3` | `python 3.14.7-1` | a dependency: `pactree -r python` on the same package set lists kitty, gdb through base-devel, libreoffice-fresh, obs-studio and others; `install/omarchy-base.packages` does not name it | yes, `python3 -> python3.14` |
| `/usr/bin/setsid` | `util-linux 2.42.3-1` | part of `base` | yes |
| `/usr/bin/kill` | `util-linux 2.42.3-1` | part of `base`; `procps-ng 4.0.7-1` is installed but does not own `/usr/bin/kill` on Arch | yes, `pacman -Qo` |
| `/usr/bin/quickshell` | `quickshell 0.3.1-1` | `install/omarchy-base.packages` line 112 | yes |

Read carefully: python is present on every stock 4.0.3 install, but as a
dependency of desktop packages, not as an Omarchy choice. The image was not
booted for this; the log is the installer's own record of what it put on
the disk, and the desktop's identical versions were checked with `pacman
-Q`. Booting the guest to confirm at runtime is listed at the end.

## What was built

A throwaway plugin directory per candidate under this session's scratch
directory, outside the repository, each with a `shell.qml` that reads the
scenario from `SPIKE_SCENARIO`, creates the candidate's `Run` object 3 s
after load, starts it and logs JSON events, plus the candidate's `Run.qml`
(and `run-supervisor.py` for (b)). A third directory, (c), is the control: a
plain `Process` with the program's name looked up through PATH, the
inherited environment, a `StdioCollector` and a deadline that signals the
leader only. It exists to show the harness sees a failure.

Never loaded into the running omarchy-shell. Each run started its own
`quickshell -p <dir>` inside `systemd-run --user --scope -p MemoryMax=768M`
and stopped that scope afterwards, which also ends anything a candidate
might have left behind, after the survivors were counted.

The scenario programs, all started by absolute path with argv only:

| Scenario | Program | Deadline, grace, cap |
| --- | --- | --- |
| producer | `/usr/bin/head -c 1073741824 /dev/zero` | 60 s, 1 s, 1 MiB: overflow expected |
| producer-stream | the same 1 GiB | 120 s, 1 s, 2 GiB: the whole stream must pass and memory must not follow it |
| holder | `holder.sh`: `/usr/bin/sleep 300 &`, echo one line, `exit 0` | 10 s, 1 s |
| stubborn | `stubborn.sh`: `trap '' TERM`, then `/usr/bin/sleep 1` in a loop; the ignored disposition is inherited by every sleep | 2 s, 1 s |
| hostile | `envprobe.sh`: prints `PATH`, `BASH_ENV`, `PYTHONPATH`, `HOME`, `command -v kill`, and `env` through bare `env`, `sort`, `sed`, `wc` | 5 s, 1 s |
| destroy | `tree.sh`: a `bash -c 'sleep 300 & wait'` child, a `sleep 300` child, then `wait`; the Run object is destroyed 500 ms after start | 10 s, 1 s |

For hostile, the Quickshell instance itself was started with a shadow
directory first in `PATH` holding executable `kill`, `setsid`, `python3`,
`bash`, `sh`, `head`, `sleep`, `env`, `sort`, `sed`, `wc` that append a line
to `hits.log` and exec the real one, `BASH_ENV` pointing at a file that
appends a line, and `PYTHONPATH` at a directory whose `json.py` appends a
line and exits 99.

How each column was measured:

- **Time to end**: `Date.now()` in the QML from `start()` to the result, or
  to the `Component.onDestruction` event for destroy.
- **Pss**: `/proc/<quickshell pid>/smaps_rollup`, sampled every 100 ms by
  the driver. *Before* is the last sample before the start event, *peak* the
  maximum until the end event, *after* the last sample, at least 1.5 s after
  the end. Fresh instances differ in their baseline (114,245 to 146,812 kB
  across the 36 runs), so the table reports the deltas.
- **Survivors**: counted 2 s after the end, twice: every process whose pgid
  is the leader's, from `ps -eo pid,pgid`, and every pid in the scope's
  `cgroup.procs` other than Quickshell's own.
- **Signals**: each TERM and KILL the candidate sent, with its moment, from
  the candidate's own log.
- **To an empty group**: a group signal that found nobody. In (a),
  `/usr/bin/kill` exiting non-zero with `No such process`; in (b),
  `os.killpg` raising `ProcessLookupError`. This is the observable form of
  "a signal after reap": a group with no members has a pgid the kernel is
  free to hand to a new process.
- **Shadow hits**: lines in `hits.log` after the run.
- **Leader is the group**: for every run whose leader lived long enough,
  the driver read `/proc/<leader>/stat` and compared pid, pgrp and sid.

Three runs per candidate and scenario, 36 runs, median with min–max.

## Measurements

| Scenario | Cand. | End state | Time to end, ms | Pss peak − before, kB | Pss after − before, kB | Survivors | Signals sent (at ms) | To an empty group | Shadow hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| producer | a | overflow | 7 (5–8) | 8,782 (7,773–10,082) | 8,727 (7,773–10,081) | 0 | TERM@4 / TERM@5 / TERM@7 | 0 | 0 |
| producer | b | overflow | 56 (52–56) | 9,127 (9,045–10,037) | 9,142 (8,990–10,049) | 0 | TERM@11 / TERM@12 | 0 | 0 |
| producer-stream | a | ok | 1,593 (1,579–1,597) | 9,945 (7,881–9,999) | 9,945 (7,881–9,998) | 0 | none | 0 | 0 |
| producer-stream | b | ok | 559 (542–570) | 10,812 (9,125–12,244) | 10,810 (9,125–12,244) | 0 | none | 0 | 0 |
| holder | a | ok | 1,006 (1,005–1,008) | 154 (130–169) | 162 (129–168) | 0 | TERM@3 / TERM@6 | 0 | 0 |
| holder | b | ok | 56 (54–59) | 141 (131–188) | 188 (141–202) | 0 | TERM@12 / TERM@13 | 0 | 0 |
| stubborn | a | timeout | 3,074 (3,005–3,078) | 185 (177–229) | 181 (177–229) | 0 | TERM@2001 KILL@3004 / TERM@2070 KILL@3073 / TERM@2074 KILL@3077 | 0 | 0 |
| stubborn | b | timeout | 3,064 (3,061–3,069) | 109 (70–324) | 166 (109–324) | 0 | TERM@2011 KILL@3022 / TERM@2011 KILL@3023 / TERM@2012 KILL@3023 | 0 | 0 |
| hostile | a | ok | 6 (6–6) | 167 (121–176) | 167 (121–174) | 0 | none | 0 | 0 |
| hostile | b | ok | 59 (53–59) | 139 (85–144) | 139 (82–156) | 0 | none | 0 | 0 |
| destroy | a | destroyed | 502 (501–502) | 122 (120–266) | 121 (120–374) | 0 | none logged; a detached group KILL | 0 | 0 |
| destroy | b | destroyed | 502 (501–502) | 139 (135–1,029) | 135 (107–1,094) | 0 | none logged; a detached reaper, TERM then grace then KILL | 0 | 0 |

The control, one run each, same driver: hostile ended ok in 6 ms with
**3 shadow hits** (the shadow `bash` ran, `BASH_ENV` was sourced twice) and
the program saw a 14,849-byte environment against 347 bytes under either
candidate; holder ended ok in 2 ms and left **one survivor**, the `sleep`,
in the scope. The harness sees what it is for.

Six things the table does not say on its own:

1. **Both candidates pass G1.** Every one of the 36 runs ended inside
   deadline plus grace, with 0 survivors by both counts, and 0 signals to an
   empty group.
2. **The first version of (a) did signal an empty group.** In its first
   holder run the descendant died on TERM at 3 ms and the KILL at the end of
   the grace, 1,004 ms, returned `No such process` (log kept as
   `a-holder.v1-blind-kill.log`). The version measured above probes the
   group with `kill -s 0` before every KILL and before ending after a leader
   exit. That removes the observed case, not the class: in (a) the leader is
   reaped by Quickshell's `QProcess` the moment it exits, so from then on
   every group signal is a check followed by a signal against a pgid the
   kernel may reuse in between. (b) holds the leader unreaped until the
   group is empty, so its pgid cannot be reused while it signals; that is
   what "reaped last" buys. `pid_max` on this host is 4,194,304.
3. **`SplitParser` with an empty marker streams.** 1 GiB passed through it
   in 1.59 s, 64 KiB chunks counted as they arrived, and the Quickshell
   process ended the run within +0.9 MB of where it started when nothing was
   kept (one extra run with `keepBytes` 0: before 113,971 kB, peak 115,064,
   after 114,903). The +8 to +10 MB on the producer rows of both candidates
   is the instrumentation: 64 KiB of kept text passing through
   `JSON.stringify` and `console.log`, and it is the same size whether 1 MiB
   or 1 GiB was read. (b) with `keepBytes` 0: +148 kB.
4. **`setsid` execs in place.** In all 20 runs whose leader was alive when
   the driver looked, pid, pgrp and sid were equal, so `Process.processId`
   is the group in (a) and the supervisor's forked pid is the group in (b).
5. **(b) ends sooner after a leader exit with survivors; (a) waits the
   grace.** Holder: 56 ms against 1,006 ms. (a) would need a process spawn
   per poll to know the group emptied (`/usr/bin/kill -s 0`: 0.4 ms each,
   measured over 20 runs), so it waits the grace instead; (b) scans `/proc`
   in-process every 20 ms.
6. **(b) costs about 50 ms and a second process per run.** Hostile is the
   cleanest comparison: 6 ms against 59 ms. The interpreter itself is 8.3 ms
   (`python3 -I -S -B -c pass`, median of 20, min 7.5, max 9.8, against
   12.7 ms with site enabled); the rest is the supervisor's imports, the
   fork, and one 20 ms tick of its ending loop. While it waits it holds
   5,746 kB Pss (12,248 kB Rss), from its own `smaps_rollup` 0.5 s into a
   `sleep 2` run.

What `omakit inspect` says about the candidates today, each committed as
a bare plugin with a manifest: both raise *process lifecycle* and
*unbounded buffering* rows on their own `Process` sites, because the command
is assigned at run time and the parser is a `SplitParser`; the supervisor's
`main` is 148 lines, 34 branches, rank 100 in M12. Both are phase 2 work:
recognition of an unmodified block is in the plan, and the supervisor gets
split before it ships.

## The decision: (b), QML plus the supervisor

Both designs end everything. (b) is chosen for what (a) cannot do by
construction, each row measured above:

| Contract line (plan, Run) | (a) pure QML | (b) supervisor |
| --- | --- | --- |
| the leader is reaped last | no: `QProcess` reaps on exit; every later group signal races pid reuse (item 2) | yes: `waitid(P_PIDFD, WNOWAIT)` reads the status, `waitpid` runs after the group is empty |
| capped in bytes and lines while reading | in UTF-16 units after Quickshell's UTF-8 decode; invalid bytes already replaced | in bytes from the pipe; only the kept part is decoded |
| ends when the group is gone | after the grace, always (item 5) | when `/proc` shows no live member (56 ms on holder) |
| cancel on destruction | group KILL, no grace: nothing outlives the component to wait | a detached reaper mode of the same file: TERM, grace, KILL (0 survivors, 3 runs) |
| one result object | assembled in QML | one JSON line, sizes bounded by `keepBytes` |
| bulk output | through the QML engine, 1.59 s per GiB, flat memory | never enters Quickshell, 0.56 s per GiB |

The price of (b), stated so the evaluation on 2026-10-15 can weigh it: about
50 ms and a 5.7 MB helper process per run, which is nothing for a
user-triggered action and 2.5 percent of a 2 s poll; a second file in the
plugin tree, Python, that the review has already seen as an accepted shape
("signal by pidfd" in the MIT skill listed in the plan) and that inspect
will recognise as a block; and `/usr/bin/python3` as a dependency the stock
install has by accident of its desktop packages, not by Omarchy's
declaration. If a future Omarchy release drops every package that pulls
python, Run breaks on that release; the pin watcher does not see that, so
the lab suite runs on every new release (phase 2 lists it).

What the spike keeps from (a): the measured fact that `SplitParser` with an
empty marker streams, which is why the QML half of (b) can read the
supervisor's line protocol with a `"\n"` marker and never a collector; and
the closed environment, identical in both.

## Draft Run API

To be fixed in `docs/BLOCKS.md` in phase 2, with the M13 count per line.
Two files under `omakit/` in the plugin: `Run.qml` and `run-supervisor.py`.

```qml
import "omakit"

Run {
    id: catalog
    command: [Quickshell.shellDir + "/catalog.sh", "--refresh"]  // command[0] absolute; argv only; no shell string
    environment: ({ OMARCHY_THEME_MANAGER_CACHE: cacheDir })      // added to the base; never replaces it
    deadlineMs: 30000     // hard; TERM to the group at this moment
    graceMs: 1000         // then KILL to the group
    maxBytes: 4194304     // per stream, counted while reading; over it the run ends as overflow
    maxLines: 100000
    keepBytes: 65536      // per stream, what the result carries; the rest is counted and dropped
    onFinished: result => { ... }
}
```

- `start()`: starts the supervisor with `clearEnvironment: true` and the
  base environment `PATH=/usr/bin`, `HOME`, `LANG=C.UTF-8`,
  `XDG_RUNTIME_DIR` (the last two read from Quickshell's own environment)
  plus `environment`. Measured: a helper under it sees 7 variables, 4 of
  them the base, 3 bash's own (`PWD`, `SHLVL`, `_`). Calling `start()`
  while a run is live cancels that run first; its result comes back as
  `cancelled` (supersession).
- `cancel()`: TERM to the supervisor, which ends the group the way it does
  on a deadline; the result comes back as `cancelled`.
- `running`: true from `start()` until the result.
- `finished(result)`: one object, `state` from the closed set `ok`, `exit`,
  `timeout`, `overflow`, `cancelled`, `spawn-failed`, `supervisor-lost`;
  `exitCode` (null when signalled), `termSignal`, `stdout` and `stderr` as
  text of at most `keepBytes` each, meant for `Text.PlainText`; `outBytes`,
  `outLines`, `errBytes`, `errLines` as counted; `ms`; `pgid`.
  `supervisor-lost` is the one state the plan's draft did not have: the
  supervisor exited without a result line, or the QML backstop timer
  (deadline plus grace plus 3 s) fired; the backstop sends a detached group
  KILL by pgid and KILL to the supervisor.
- `Component.onDestruction`: if a run is live, a detached
  `run-supervisor.py --kill-group <pgid> --grace-ms <graceMs>`. The
  `Process` destructor SIGKILLs the supervisor synchronously right after
  (Quickshell 0.3.1 `process.cpp`: `setParent(nullptr)` then `kill()`), so
  the reaper is what outlives the component.

Two things the spike learned that the contract must say:

- The base `PATH` is `/usr/bin` only. Omarchy's own commands live in
  `~/.local/share/omarchy/bin`; a plugin passes them by absolute path built
  from `Quickshell.env("HOME")`, or adds that directory through
  `environment.PATH`, explicitly, on its own line, where a reviewer sees it.
  Theme Manager's `omarchy`, `omarchy-theme-bg-set` and `omarchy-theme` calls
  are exactly that case.
- `spawn-failed` needs a real signal from the child. The spike's supervisor
  exits 127 on a failed `execv`, indistinguishable from a program that
  exits 127; phase 2 uses a close-on-exec pipe the child writes the errno
  into.

## The prelude decision: no prelude; a pointer

The question (plan, "Known limit of the proof plugin"): Theme Manager's
helpers start most programs from shell lines Run does not own; should Run
ship a small shell prelude for absolute paths, a closed environment and
bounded output, or leave it to the author with a pointer.

What the helpers look like, counted on the installed checkout at `7239ae8`
(2026-09-17): 11 shell and Python helpers, 2,392 lines; about 70 program
names inside them resolved through PATH (`jq`, `find`, `mkdir` 7 each,
`tr`, `stat`, `sort` 5 each, `curl`, `python3`, `tar`, `omarchy-theme`, and
so on), 6 lines with `/usr/bin/`, 1 `PATH=` assignment and it is not PATH
(`ICONS_THEME_PATH`), shebangs of both `#!/bin/bash` and `#!/usr/bin/env
bash`, `catalog.sh` ending in `exec python3 "$script_dir/catalog-cache.py"`.
On the QML side, 23 `Process` sites, 0 `clearEnvironment`, helpers started
by script path, Omarchy commands by bare name.

The measurement that decides it is the hostile row. `envprobe.sh` is a
helper of that shape: it calls `env`, `sort`, `sed` and `wc` by bare name,
and shadow copies of all four sat first in the session's PATH with
`BASH_ENV` set. Under either candidate, six runs, 0 hits, `PATH=/usr/bin`,
`BASH_ENV=unset`, 7 variables. Under the control, 3 hits. A helper started
by Run inherits Run's closed environment, and so does everything the helper
starts; the boundary Run closes reaches every line inside the helper
without the helper changing. That is how the runner covers "QML and shell
helpers", the wording the M13 question was asked with.

What a prelude would add, and why not now:

- For helpers Run starts: nothing about the environment. A `set -euo
  pipefail`, `umask 077` and temp-file discipline are shell hygiene, real,
  but not Run's contract and not what the 254 environment-trust comments
  are about.
- For helpers Run does not start: Theme Manager has one, the hook under
  `hooks/theme-set.d/`, which Omarchy runs in Omarchy's environment. A
  prelude sourced there is a file the plugin must locate by its own path
  from inside a process it does not own; that is a second boundary with its
  own review questions, not a smaller version of the first.
- The cost is real: a second block file to add, source at the top of 11
  helpers, version, keep unmodified and recognise, for a boundary that is
  already closed from outside. The plan's rule is one block at a time, and
  the review moved PATH resolution to hardening for same-UID cases in
  September (plan, risks).

So: Run's contract states that a helper it starts, and everything the
helper starts, runs in the closed environment, and the
`omarchy-plugin-build` skill carries the pointer: start every helper
through Run; a helper that must also run outside Run (a hook, a test) sets
`PATH=/usr/bin`, unsets `BASH_ENV` and `ENV`, and uses `set -euo pipefail`
in its first lines, its own three lines, its own review. Revisit at the
evaluation gate if a reviewer raises a PATH lookup inside a helper that Run
started; that would be a new fact, and M13 re-measured weekly will show it.

## Limits

- One host, one Quickshell version (0.3.1-1), 36 runs. The stock check
  read the installer's log of the base image; the guest was not booted.
- The scenario programs are small and honest. A program that forks out of
  its session (`setsid` again, a daemon) escapes any group; neither design
  claims otherwise, and the contract will say so.
- Time to end in (b) includes Quickshell starting the supervisor's process;
  the supervisor's own clock was not recorded separately.
- Pss deltas under 400 kB are inside the instance-to-instance spread of a
  fresh Quickshell and are reported, not read.
- The candidates are throwaway code in a scratch directory and are not
  committed; phase 2 writes the block from this contract, with the header,
  NOTICE, tests and the split of `main`.
