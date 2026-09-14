# What a plugin weighs on the shell

`omakit weigh` answers the question a person asks of a plugin, how heavy
is it, with a measurement: what it adds to the shell in CPU and in child
processes, and what the shell's own memory did while it was there. Not estimated from the
source, not read from a timer's declared interval, measured from outside the
process by starting the shell without the plugin and with it.

```bash
omakit weigh <plugin-id-or-dir>       # one plugin
omakit weigh --all                    # every enabled third-party plugin
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
a weight to one plugin is a difference between two shells, one without it and
one with it, both started clean.

For the plugin under measurement, two shell configurations:

- **baseline**: your enabled set minus every plugin under measurement;
- **baseline plus one**: the same set with that one plugin enabled, placed
  where you had it.

For each configuration, `--runs` runs (default 3). A run is: write the
configuration to `shell.json`, `omarchy-restart-shell`, wait until
`listPlugins` reports every installed plugin, then a settle period
(`--settle`, default 30 seconds), then a sample window (`--window`, default
15 seconds). The memory sample is taken at the end of the window:

- `Pss` of the shell pid from `/proc/<pid>/smaps_rollup`, in MB. This is
  the headline memory figure: proportional set size counts a shared page
  once, divided among the processes that share it, so the number moves with
  what the shell itself holds and not with what a library happened to map.
- `VmRSS` of the shell pid from `/proc/<pid>/status`, at the same moment,
  kept in the raw samples for comparison with the earlier method.
- Both again at the settle, before the window opened (`pssKbSettled`,
  `rssKbSettled`), and both traced twice a second through the window
  (`trace`), so the document shows the shell's climb to its plateau and the
  settle can be judged from the data rather than assumed.

Over the window:

- `utime + stime` of the shell pid from `/proc/<pid>/stat`, at the start
  and the end, as CPU percent of the window's measured length;
- `cutime + cstime` of the shell pid, the CPU of every child it has reaped,
  so a poller that runs for milliseconds is counted even when no sample saw
  it alive;
- every descendant of the shell pid, twice a second, by walking
  `/proc/[0-9]*/stat` parent ids up to the shell: its command name, its
  first argument, its `VmRSS` and its cumulative CPU.

The plugin's weight is the difference: run *i* of "baseline plus one" minus
run *i* of the baseline, one delta per run, reported as the median with the
spread (highest minus lowest). Child processes are attributed to the plugin
when their full command line appears in the "plus one" runs and in none of
the baseline runs, and are reported separately from the shell's own figures,
so a plugin that adds 2 MB inside the shell and 40 MB in a helper reads as
both. A difference in count is never lost either: when the with-plugin
restart has more children than the paired baseline restart and the extra
ones run a command line the baseline also runs, they cannot be attributed,
and the row says "N unattributed child process(es)" with their commands,
or "up to N unattributed child process(es) in 1 of 3 runs" when the
difference was in some runs only, so the median does not round it away
(measured on a desktop: four `sidecarctl` helpers against two in one run
of three, twelve children against ten, none attributable by command line). Every figure in the output carries its origin: the `/proc` path it was
read from, the window, and the run count.

## The noise floor, and what "within noise" means

Two shells started from the same configuration do not weigh the same. The
baseline runs measure that: the spread of the baseline's own Pss and CPU
across its runs is the noise floor, and it is printed once, in the header,
before any plugin row.

A CPU delta whose median is not larger in magnitude than the baseline
spread is reported as **no measurable CPU**, in those words. It is not
rounded to zero and it is not hidden: the median and its spread are printed
beside the words, and the raw deltas are in the JSON. It means the
measurement cannot tell this plugin from nothing at this run count and
window; it does not mean the weight is zero.

A row is marked `ok` when its CPU is within noise, `note` when it is above
the floor, and `?` when no run of that plugin completed. The verdict is a
comparison, never a judgement about whether the weight is acceptable; that is
the author's to make with the number in front of them.

**Memory is a fact about the shell's start, not the plugin's weight, until
the shell's two resting levels are understood.** The memory delta stays in
the table and in the JSON (`shellPssMb`, `verdict.memory`), but the header
labels it "within the shell's own startup variance (N MB)", no row is marked
on it, and no sentence about the plugin carries it. The measured reason, in
`docs/MEASUREMENTS.md`: the shell comes to rest on one of two levels about
35 MB apart, the high one seen in 0 of 10 baseline restarts and 19 of 70
plugin restarts, so a memory delta against the baseline mixes what the
plugin holds with which level the shell landed on, and no pairing of runs
separates the two from outside the process (C1); what the levels are is
recorded as a hypothesis (C2). A sentence that said "under N MB" or
"costs N MB" would be a claim about the wrong thing.

The floor was measured before this command shipped, and two ideas did not
survive it. The audit it was ported from read `VmRSS` at the end of a
window that opened 8 s after `listPlugins` answered, and measured a
baseline memory spread of 15.54 MB over three runs in the plugin lab guest.
The first port took the memory sample at that 8 s settle instead, a fixed
event rather than a wall-clock offset; over five baseline runs the `Pss`
there was 526, 596, 586, 582 and 593 MB, a 70.3 MB spread. A trace of `Pss`
twice a second through the window then showed why neither point is
settled: `listPlugins` answers about 0.3 s after the restart, the shell
holds a load-time high of 550 to 615 MB, and it releases 55 to 65 MB at a
moment that varied from 9.5 to 22 s after ready, coming to rest on one of
two levels about 35 MB apart. A window opening at 8 s reads either side of
that release. So the settle is 30 s, the window sits after the release, the
headline is read at the end of the window, and the settle-time sample and
the trace stay in every document so a machine whose release comes later
shows it. What no sampling point removes is the two levels: two starts of
the same configuration can differ by 35 MB before any plugin is added, and
that is the floor this guest reports (32 MB over five runs). Every floor,
from every lab run, is in `docs/MEASUREMENTS.md` under C1, and the shell
behaviour behind it under C2.

The rule for CPU has one more clause. A CPU delta is above noise only when
its magnitude exceeds the baseline spread **and** exceeds one clock tick
over the window (`100 / (CLK_TCK × window)`, 0.067% at 100 Hz over 15 s),
which is the smallest difference the measurement can express. Measured in
the lab: a one-tick delta over a 15.003 s window (-0.066662%) read as above
a one-tick floor over a 15.005 s window (0.066653%), and one tick against
one tick is no difference at all. The tick is in every row as
`withinNoise.cpuTickPercent`, and `tools/weigh/contract.mjs` applies the same
rule when it checks a document. Memory has no such clause: a page is far
below any floor.

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
`bar` (a whole bar) is not measured: replacing the bar is not a weight. A
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

## Options, checked first

Every token on the command line is checked before anything else: an option
`weigh` does not know (`-n 1`, `-n=1`, `--run 1`), an option without its
value, or one positional beyond the plugin is refused as `█ NOT WEIGHED`
with the offending token and the accepted list, `--runs N`, `--window S`,
`--settle S`, `--all`, `--json`, `--out FILE`, `--yes`, exit 2, before the
preflight. `--runs=3` is read as `--runs 3`. Measured before this: `-n 1`
ran three runs as if nothing had been passed.

## Compatibility, before the confirmation

Before anything is printed about restarts, the command checks that this is
an Omarchy whose shell it can weigh on, with probes that read and never
call a method that changes anything: `omarchy-shell` on PATH (an Omarchy
older than the Quattro shell has none), `omarchy-restart-shell` on PATH,
`omarchy` and `qs` on PATH, `$OMARCHY_PATH/shell/shell.qml` present,
`$OMARCHY_PATH/version` readable, `omarchy-shell shell ping` answering, and
the shell's IPC listing (`qs ipc -p $OMARCHY_PATH/shell show`) carrying
`listPlugins`, `listShellConfig`, `setPluginEnabled` and `enablePlugin`
under the `shell` target; the first two the measurement calls, the other
two the shell's own plugin commands call on its behalf. Any failure is
refused as `█ NOT WEIGHED` with one sentence naming what is missing and
the one thing to do, exit 1, before any confirmation. The shell's path is
printed beside its version only when the running shell is not the stock
one at `~/.local/share/omarchy`.

## Confirmation

Because it restarts the shell, the command asks first. The confirmation
names the plugins, the restart count, `(1 + plugins) × runs`, and an
estimate in minutes. A restart costs about a minute with the defaults:
the shell is back and reporting every plugin in about a second in the lab
guest (39 restarts measured) and a few seconds on a desktop, and then the
30 s settle and the 15 s window run; the estimate takes the shell's own
time from the previous run on this machine
(`$XDG_STATE_HOME/omakit/weigh/timing.json`, 5 s before any run exists) and
adds the settle and the window. So one plugin at three runs is six
restarts, about five minutes. `--all` is sized for a lab machine rather
than a working desktop: a desktop with 47 enabled plugins is 144 restarts
at three runs, about two hours, and 240 at five, about three and a half,
and the desktop has no bar, panels or plugins for any of it. At a terminal
the command waits for `y`; in a pipe, from an agent, or with `--json`, it
refuses with `█ NOT WEIGHED` unless `--yes` is passed. An agent must never
pass `--yes` without having asked the person whose shell it is.

The question states the knob that sets the count and the minutes:

```text
Restart the shell 6 times now, about 5 minutes? (--runs 3; --runs 1 for a quick look without a spread) [y/N]:
```

`--runs 1` is the quick look: two restarts for one plugin, about two
minutes, and an honest result. One baseline run has no spread, so there is
no noise floor; every row is `▒ ?` with "one run, no spread: no floor to
judge against (--runs 3 gives one)" as its reason, `noiseFloor` carries
nulls with `origin` saying why, `verdict.memory` and `verdict.cpu` are
`unknown`, `readme` is null and no README sentence is printed, and the
report closes with `▒ WEIGHED`. The figures are all there, median of one;
what a quick look cannot give is the verdict.

## The JSON contract

`--json` prints the document on stdout; it is always written to `--out`
(default `$XDG_STATE_HOME/omakit/weigh/<date>.json`, or
`~/.local/state/omakit/weigh/<date>.json`). The document is the API. New
fields may be added; existing fields never change meaning.
`tools/weigh/contract.mjs` is the executable form of this section and
`tests/unit/weigh.test.mjs` holds every produced document to it.

```text
omakit            string   the omakit version that produced the document
command           "weigh"
method            string   the method above, in one sentence
started, ended    string   UTC timestamps
host              string   hostname
shell             { version, omarchyPath }
settings          { runs, windowSeconds, settleSeconds, readyTimeoutSeconds,
                    sampleIntervalMs, clockTicksPerSecond }
config            { path, backup, md5Before, md5After, restored }
                  restored is true when md5After equals md5Before
audited           string[] the measured plugin ids
baseline          { config, pssMb, rssMb, pssMbSettled, rssMbSettled,
                    cpuPercent, childRssMb, runs }
                  each figure is a stats object; runs is the raw samples
noiseFloor        { pssMb, rssMb, pssMbSettled, rssMbSettled, cpuPercent,
                    origin }
                  the baseline spreads; the headline floors are pssMb and
                  cpuPercent, both at the end of the window
plugins[]         one row per measured plugin, sorted by totalMb descending
out               string   the path the document was written to
```

A stats object is `{ median, spread, min, max, runs }`: `runs` is the value
per run in run order, and the other four are null when no run completed.

A plugin row:

```text
id, name, kinds, firstParty
runsCompleted     number   runs that produced a sample on both sides
shellPssMb        stats    plus minus baseline, Pss at the end of the window
shellRssMb        stats    the same delta in VmRSS
shellPssMbSettled stats    the same delta in Pss at the settle, for comparison
shellCpuPercent   stats    utime+stime over the window, plus minus baseline
childRssMb        stats    VmRSS of attributed descendants, last seen
childCpuPercent   stats    attributed descendants' CPU over the window, plus
                           the delta in reaped-child CPU
childSpawns       stats    distinct attributed pids per window
unattributedChildren
                  stats    children the with-plugin restart had beyond the
                           paired baseline restart whose command line the
                           baseline also runs: a difference in count that
                           attribution cannot claim and never loses
unattributedCommands
                  string[] their commands, comm and first argument only
totalMb           number   shellPssMb.median + childRssMb.median
totalCpuPercent   number   shellCpuPercent.median + childCpuPercent.median
verdict           { memory, cpu, summary }
                  memory and cpu are "within-noise", "above-noise" or
                  "unknown"; summary is the sentence the row prints
withinNoise       { pss, rss, cpu, ownPss, ownCpu, baselinePssSpreadMb,
                    baselineCpuSpreadPercent, cpuTickPercent, note }
                  pss, rss and cpu compare the median delta with the baseline
                  spread; ownPss and ownCpu with the spread of the row's own
                  deltas; cpu and ownCpu also require more than one tick
origin            string   the /proc paths and the arithmetic, in words
readme            string   the sentence for the plugin's README
deltas[]          per run: { run, shellPssMb, shellRssMb, shellPssMbSettled,
                    shellCpuPercent, childRssMb, childCpuPercent,
                    reapedChildCpuPercent, childSpawns, children[],
                    unattributedChildren[] }
runs[]            the raw "plus one" samples
```

A raw sample, on both sides:

```text
label, run, shellPid, started, ended, readyAfterSeconds, windowSeconds
configRewritten   boolean  whether shell.json differed at the end of the
                           window from what this run wrote (a plugin that
                           rewrites it as it starts rebuilds the bar);
                           absent in documents from before it was recorded
shell             { pssKb, rssKb, memoryAt: "window-end", pssKbSettled,
                    rssKbSettled, trace: [{ t, pssKb, rssKb }],
                    cpuTicksStart, cpuTicksEnd, cpuSeconds, cpuPercent,
                    reapedChildTicksStart, reapedChildTicksEnd,
                    reapedChildCpuSeconds, reapedChildCpuPercent }
                  t is seconds since the window opened
children[]        { pid, comm, arg0, firstSeen, lastSeen, cpuFirst, cpuLast,
                    rssLast, samples }
```

A child's `arg0` is its first argument cut to 80 characters and nothing
more: the full command line is used to tell two watchers apart during the
run and never reaches the file, because a command line can carry a token.

## The README sentence

The last thing the command prints, per plugin, is the sentence to paste into
the plugin's README, and the path of the JSON as its evidence. It speaks
about CPU and about child processes, never about the shell's memory (see
above). A plugin with nothing above the floor and no child process:

```text
Weighs nothing measurable: no CPU above the floor (0.13%) and no child process, on Omarchy 4.0.0.alpha, measured with omakit weigh on 2026-09-14
```

A plugin with something to report, CPU above noise or a child process:

```text
Weighs 2.7% CPU and runs no child process, on Omarchy 4.0.0.alpha, measured with omakit weigh on 2026-09-14
Weighs no CPU above the floor (0.13%) and runs 2 child processes using 8.2 MB and 0.1% CPU, on Omarchy 4.0.0.alpha, measured with omakit weigh on 2026-09-14
```

The CPU figure is the shell's own median delta when it is above noise, and
the floor is stated when it is not; the child processes are the ones
attributed to the plugin, with their memory and their CPU. `--json` carries
the sentence as `readme`, and `tools/weigh/contract.mjs` refuses any other
form and any sentence that carries a memory figure about the plugin.

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
- What the measurement does not know: the weight of a plugin only while it
  is open or in use (a panel with `keepLoaded` off weighs nothing while
  closed, and that is what is measured), and any weight that depends on
  another
  plugin being present.
- GPU time per plugin and which plugin caused a specific frame drop are not
  measurable this way and are not reported.
- The noise floor is the machine's. A guest with software rendering and one
  screen has a different floor from a desktop with three; the floor is
  printed with every run so a figure is never read without it.

## Provenance

The method, the `shell.json` transform, the descendant attribution and the
four fixtures under `tests/fixtures/weigh/` were ported from a standalone
startup A/B audit written as a shell plugin and its bash CLI, whose lab
evidence of 14 September 2026 (24 restarts, seven plugins, three runs,
`shell.json` md5 identical before and after) is committed under
`docs/evidence/weigh/`. The command carried a different name while it was
being built and was renamed before its first release, because the question
a person asks is how heavy a plugin is. That plugin also had a viewer panel
for the audit
JSON, a layer-shell overlay with a centred card. The panel was not carried
over: the JSON is the API and a terminal renders it. It lives on only in a
git bundle of that repository, `rent-89987b4.bundle`, kept in the owner's
handoff directory outside this repository.
