# What a plugin costs the shell

`omakit cost` answers one question for a plugin author: what does my plugin
cost the shell, in megabytes and CPU, measured. Not estimated from the
source, not read from a timer's declared interval, measured from outside the
process by starting the shell without the plugin and with it.

```bash
omakit cost <plugin-id-or-dir>       # one plugin
omakit cost --all                    # every enabled third-party plugin
```

This is the one omakit command that is not read-only against your own
machine: it restarts your shell and edits `~/.config/omarchy/shell.json` for
the duration of the measurement. Everything it does to that file, and how it
puts it back, is under "The `shell.json` mutation" below. It never touches
the marketplace, never posts anything, and never writes into a plugin tree.

## What it measures

Every Omarchy Quattro plugin runs inside one long-running Quickshell process,
`omarchy-shell`, next to every other plugin. `/proc/<shell pid>` is shared
by all of them: its memory and CPU time are totals, and Qt allocates from
shared heaps with no per-component accounting. So the only way to attribute
a cost to one plugin is a difference between two shells, one without it and
one with it, both started clean.

For the plugin under measurement, two shell configurations:

- **baseline**: your enabled set minus every plugin under measurement;
- **baseline plus one**: the same set with that one plugin enabled, placed
  where you had it.

For each configuration, `--runs` runs (default 3). A run is: write the
configuration to `shell.json`, `omarchy-restart-shell`, wait until
`listPlugins` reports every installed plugin, then a settle period
(`--settle`, default 8 seconds), then a sample window (`--window`, default
15 seconds). At the fixed event that ends the settle, before the window
opens, the memory sample is taken:

- `Pss` of the shell pid from `/proc/<pid>/smaps_rollup`, in MB. This is
  the headline memory figure: proportional set size counts a shared page
  once, divided among the processes that share it, so the number moves with
  what the shell itself holds and not with what a library happened to map.
- `VmRSS` of the shell pid from `/proc/<pid>/status`, at the same moment,
  kept in the raw samples for comparison with the earlier method, and again
  at the end of the window, which is where that earlier method read it.

Over the window:

- `utime + stime` of the shell pid from `/proc/<pid>/stat`, at the start
  and the end, as CPU percent of the window's measured length;
- `cutime + cstime` of the shell pid, the CPU of every child it has reaped,
  so a poller that runs for milliseconds is counted even when no sample saw
  it alive;
- every descendant of the shell pid, twice a second, by walking
  `/proc/[0-9]*/stat` parent ids up to the shell: its command name, its
  first argument, its `VmRSS` and its cumulative CPU.

The plugin's cost is the difference: run *i* of "baseline plus one" minus
run *i* of the baseline, one delta per run, reported as the median with the
spread (highest minus lowest). Child processes are attributed to the plugin
when their full command line appears in the "plus one" runs and in none of
the baseline runs, and are reported separately from the shell's own figures,
so a plugin that costs 2 MB inside the shell and 40 MB in a helper reads as
both. Every figure in the output carries its origin: the `/proc` path it was
read from, the window, and the run count.

## The noise floor, and what "within noise" means

Two shells started from the same configuration do not weigh the same. The
baseline runs measure that: the spread of the baseline's own Pss and CPU
across its runs is the noise floor, and it is printed once, in the header,
before any plugin row.

A plugin whose median delta is not larger in magnitude than the baseline
spread is reported as **within noise**, in those words. It is not rounded to
zero and it is not hidden: the median and its spread are printed beside the
words, and the raw deltas are in the JSON. Within noise means the measurement
cannot tell this plugin from nothing at this run count and window; it does
not mean the cost is zero. Memory and CPU are judged separately, so a plugin
can be within noise on memory and above it on CPU, and the row says which.

A row is marked `ok` when both are within noise, `note` when either is above
the floor, and `?` when no run of that plugin completed. The verdict is a
comparison, never a judgement about whether the cost is acceptable; that is
the author's to make with the number in front of them.

The floor was lowered before this command shipped. The audit it was ported
from read `VmRSS` at the end of the window and measured a baseline memory
spread of 15.54 MB over three runs in the plugin lab guest, so only the two
largest plugins in that run rose above it and every fixture read within
noise. Two changes brought it down: `Pss` instead of `VmRSS`, and the memory
sample taken at a fixed event (every plugin reported loaded, plus the
settle) instead of at a wall-clock offset. Both floors, measured in the same
lab run, are recorded in `docs/MEASUREMENTS.md` under C1, so the claim that
the second is lower is a number and not a sentence.

## The `shell.json` mutation

The configuration written for each run is derived from the effective
configuration the shell reports (`omarchy-shell shell listShellConfig`), not
from the file, with a set of plugin ids removed:

- every bar layout entry (`bar.layout.left`, `center`, `right`) whose `id`
  is in the set is removed, so a bar widget is placed where you had it when
  it is put back;
- every entry of `plugins[]` whose `id` is in the set is removed;
- a first-party id in the set is added to `disabledPlugins[]`, because a
  first-party plugin is enabled unless listed there; `disabledPlugins` is
  removed when that leaves it empty.

The baseline is the effective configuration with every measured id removed;
"baseline plus one" is the effective configuration with every measured id
except that one removed. Nothing else in the file changes. A plugin of kind
`bar` (a whole bar) is not measured: replacing the bar is not a cost. A
plugin that is not enabled is refused, because there is no place to put it
back into.

Before the first write, `shell.json` is read and its bytes written to
`shell.json.omakit-backup-<UTC timestamp>` beside it, and the md5 of the
backup is printed. On every exit path, a completed run, a failed restart, a
thrown error, `SIGINT` or `SIGTERM`, the backup's bytes are written back
over `shell.json`, the shell is restarted once more so it runs your own
configuration, the md5 of the restored file is compared with the backup's,
and the backup is removed only when they are equal. The md5 after the
restore is printed beside the one before. A restore whose md5 differs keeps
the backup and says so, and the command exits 1. The restore writes the
bytes it read; it does not reformat, reorder or re-serialise the file.

A configuration whose shell does not answer after the restart, or whose
`listPlugins` does not reach the installed count within 45 seconds, produces
no sample; the row says how many runs completed, and a plugin with no
completed run is `?`. Nothing is estimated in its place.

The session-lock check is the one `omarchy-restart-shell` makes,
`omarchy-hyprland-session-locked`: while the compositor holds a session
lock, the command refuses before touching anything.

## Confirmation

Because it restarts the shell, the command asks first. The confirmation
names the plugins, the restart count, `(1 + plugins) × runs`, and an
estimate in minutes built from a per-restart timing stored from the previous
run on this machine (`$XDG_STATE_HOME/omakit/cost/timing.json`, or the lab's
figure of 25 seconds before any run exists) plus the settle and the window.
At a terminal it waits for `y`; in a pipe, from an agent, or with `--json`,
it refuses with a usage error unless `--yes` is passed. An agent must never
pass `--yes` without having asked the person whose shell it is.

## The JSON contract

`--json` prints the document on stdout; it is always written to `--out`
(default `$XDG_STATE_HOME/omakit/cost/<date>.json`, or
`~/.local/state/omakit/cost/<date>.json`). The document is the API. New
fields may be added; existing fields never change meaning.
`tools/cost/contract.mjs` is the executable form of this section and
`tests/unit/cost.test.mjs` holds every produced document to it.

```text
omakit            string   the omakit version that produced the document
command           "cost"
method            string   the method above, in one sentence
started, ended    string   UTC timestamps
host              string   hostname
shell             { version, omarchyPath }
settings          { runs, windowSeconds, settleSeconds, readyTimeoutSeconds,
                    sampleIntervalMs, clockTicksPerSecond }
config            { path, backup, md5Before, md5After, restored }
                  restored is true when md5After equals md5Before
audited           string[] the measured plugin ids
baseline          { config, pssMb, rssMb, rssMbWindowEnd, cpuPercent,
                    childRssMb, runs }
                  each figure is a stats object; runs is the raw samples
noiseFloor        { pssMb, rssMb, rssMbWindowEnd, cpuPercent, origin }
                  the baseline spreads; the headline floors are pssMb and
                  cpuPercent
plugins[]         one row per measured plugin, sorted by totalMb descending
out               string   the path the document was written to
```

A stats object is `{ median, spread, min, max, runs }`: `runs` is the value
per run in run order, and the other four are null when no run completed.

A plugin row:

```text
id, name, kinds, firstParty
runsCompleted     number   runs that produced a sample on both sides
shellPssMb        stats    plus minus baseline, Pss at the fixed event
shellRssMb        stats    the same delta in VmRSS at the fixed event
shellCpuPercent   stats    utime+stime over the window, plus minus baseline
childRssMb        stats    VmRSS of attributed descendants, last seen
childCpuPercent   stats    attributed descendants' CPU over the window, plus
                           the delta in reaped-child CPU
childSpawns       stats    distinct attributed pids per window
totalMb           number   shellPssMb.median + childRssMb.median
totalCpuPercent   number   shellCpuPercent.median + childCpuPercent.median
verdict           { memory, cpu, summary }
                  memory and cpu are "within-noise", "above-noise" or
                  "unknown"; summary is the sentence the row prints
withinNoise       { pss, rss, cpu, ownPss, ownCpu, baselinePssSpreadMb,
                    baselineCpuSpreadPercent, note }
                  pss, rss and cpu compare the median delta with the baseline
                  spread; ownPss and ownCpu with the spread of the row's own
                  deltas
origin            string   the /proc paths and the arithmetic, in words
readme            string   the sentence for the plugin's README
deltas[]          per run: { run, shellPssMb, shellRssMb, shellCpuPercent,
                    childRssMb, childCpuPercent, reapedChildCpuPercent,
                    childSpawns, children[] }
runs[]            the raw "plus one" samples
```

A raw sample, on both sides:

```text
label, run, shellPid, started, ended, readyAfterSeconds, windowSeconds
shell             { pssKb, rssKb, memoryAt: "settled", rssKbWindowEnd,
                    cpuTicksStart, cpuTicksEnd, cpuSeconds, cpuPercent,
                    reapedChildTicksStart, reapedChildTicksEnd,
                    reapedChildCpuSeconds, reapedChildCpuPercent }
children[]        { pid, comm, arg0, firstSeen, lastSeen, cpuFirst, cpuLast,
                    rssLast, samples }
```

A child's `arg0` is its first argument cut to 80 characters and nothing
more: the full command line is used to tell two watchers apart during the
run and never reaches the file, because a command line can carry a token.

## The README sentence

The last thing the command prints, per plugin, is the sentence to paste into
the plugin's README, and the path of the JSON as its evidence:

```text
Costs 19.8 MB and 0.1% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14
```

A plugin within noise gets the floor instead of a figure that would be
smaller than the measurement's own uncertainty: `Costs under 3.1 MB and
under 0.06% CPU on Omarchy ...`. The figures are the totals, shell plus
attributed children. `--json` carries the sentence as `readme`.

## Limits

- Per-plugin memory inside the process is knowable only by A/B. Qt allocates
  from shared heaps; there is no per-component accounting, and nothing here
  claims one.
- RSS does not fall on unload. Measured on the installed shell over three
  disable-and-enable cycles of one bar widget: 521 MB before the first
  change, 540 MB after it, 545 MB after the sixth, and never lower after a
  widget was removed. A before-and-after inside one running shell measures
  growth, not the plugin.
- Every bar widget rebuilds on any layout change. In the same measurement,
  an unrelated widget's `inotifywait` child got a new pid on every one of
  the six layout changes and every widget re-registered its `IpcHandler`,
  so a "without" window inside a running shell measures the rebuild of
  everything else. That is why the in-process differential is not used, and
  both sides of the A/B start from a fresh shell.
- A live walk of the shell's object graph is not used either. It found the
  gap between declared and running timers (9.76 wakeups per second live
  against 3.30 declared on one machine), and it also stalled the shell's
  only thread for 20 seconds until the shell was killed, and sees one object
  on a stock install, where a third-party plugin is handed a scoped facade
  instead of the shell root. A measurement that can hang the thing it
  measures does not ship.
- What the measurement does not know: the cost of a plugin only while it is
  open or in use (a panel with `keepLoaded` off costs nothing while closed,
  and that is what is measured), and any cost that depends on another
  plugin being present.
- GPU time per plugin and which plugin caused a specific frame drop are not
  measurable this way and are not reported.
- The noise floor is the machine's. A guest with software rendering and one
  screen has a different floor from a desktop with three; the floor is
  printed with every run so a figure is never read without it.

## Provenance

The method, the `shell.json` transform, the descendant attribution and the
four fixtures under `tests/fixtures/cost/` were ported from a standalone
startup A/B audit written as a shell plugin and its bash CLI, whose lab
evidence of 14 September 2026 (24 restarts, seven plugins, three runs,
`shell.json` md5 identical before and after) is committed under
`docs/evidence/cost/`. That plugin also had a viewer panel for the audit
JSON, a layer-shell overlay with a centred card. The panel was not carried
over: the JSON is the API and a terminal renders it. It lives on only in a
git bundle of that repository, `rent-89987b4.bundle`, kept in the owner's
handoff directory outside this repository.
