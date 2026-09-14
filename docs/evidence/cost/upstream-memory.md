# Draft: the shell's memory after a restart has two resting levels and two events

**Status: a draft for a person to file against the Omarchy shell. Not
filed. Everything below is measured from outside the process with
`omakit cost`; nothing here says what inside the shell causes it.**

## Summary

After `omarchy-restart-shell`, and after `listPlugins` has reported every
plugin, the shell's memory (`Pss` from `/proc/<pid>/smaps_rollup`, sampled
twice a second) does three things that two starts of the same configuration
do not do alike:

1. It holds a load-time high of 550 to 615 MB and then **releases 55 to
   65 MB in one step at a variable moment**, 9.5 to 22 s after ready (most
   at about 15.6 s), or before that, or not within the first 23 s at all.
2. It **comes to rest on one of two levels about 35 MB apart** (about 530 or
   about 565 MB in the guest below). Over 80 restarts of one configuration
   set, the high level was seen in 0 of 10 restarts of the baseline
   configuration and in 19 of 70 restarts with one more plugin enabled,
   13 of those 19 with one of two plugins.
3. It then **rises 10 to 15 MB in one step, sometimes twice**, 32 to 44 s
   after ready, in 16 of 40 restarts observed that late.

The practical effect is that a startup A/B measurement of a plugin's memory
against a baseline has a floor of 32 MB over five runs on this guest, which
is above most plugins' whole footprint, and that no sampling point removes
it. CPU is unaffected (floor 0.13% over the same runs).

## Setup

- Omarchy shell `4.0.0.alpha` at `omacom/omarchy` commit `b5589fa` (the
  plugin lab's stock pin), Quickshell 0.3.1, on a fresh install from
  `omarchy-4.0.3.iso` in the Omarchy plugin lab guest (QEMU/KVM, 32 vCPU,
  5120 MiB, one 1280x800 screen, software rendering, user `omarchy`).
- Third-party plugins installed with `omarchy-plugin-add <dir> --enable
  --yes`: `io.github.calebhat.weather`, `bjarneo.workspace-layout`,
  `omaplug`, and four fixtures from omakit's `tests/fixtures/cost/`
  (`clean`: a bar widget with nothing in it; `timer-180ms`: one repeating
  180 ms timer; `poller`: a service with a 5 s poller, an `inotifywait`
  watcher and a helper; `idle-panel`: a panel whose timers run only while
  open).
- Measurement: `omakit cost --all --runs 5 --yes` (defaults: 30 s settle
  after `listPlugins` reports every plugin, then a 15 s window; an earlier
  run used an 8 s settle). For each of the seven plugins the shell is
  restarted with the enabled set minus all seven (baseline) and with that
  set plus the one plugin; 40 restarts per run. `shell.json` is backed up
  and restored byte for byte; md5 `2caeda7f4da844a0d51b045ae5652346`
  before and after every run.
- Sampling: `Pss` and `VmRSS` of the shell pid (`qs list -p
  "$OMARCHY_PATH/shell" --json`) at the end of the settle and twice a
  second through the window; `utime+stime` at both ends of the window.

The complete documents, every sample and every trace, are beside this file:
`lab-2026-09-14-settle-8-trace.json` (8 s settle) and
`lab-2026-09-14-settle-30.json` (30 s settle).

## Observation 1: the release, 8 s settle

`Pss` in MB at the settle (8 s after ready), then every 3 s through the
window (8 to 23 s after ready), then at the end. Baseline is the stock
configuration with the seven plugins removed.

| Configuration | Run | At 8 s | 8 s onward, every 3 s | At 23 s |
| --- | --- | --- | --- | --- |
| baseline | 1 | 567 | 567 / 567 / 567 / 522 / 522 / 516 | 516 |
| baseline | 2 | 554 | 554 / 554 / 554 / 532 / 532 / 532 | 532 |
| baseline | 3 | 590 | 590 / 590 / 590 / 528 / 528 / 527 | 527 |
| baseline | 4 | 592 | 592 / 592 / 592 / 531 / 530 / 530 | 530 |
| baseline | 5 | 551 | 551 / 551 / 551 / 536 / 551 / 551 | 551 |
| plus io.github.calebhat.weather | 1 | 576 | 576 / 576 / 576 / 533 / 533 / 533 | 533 |
| plus io.github.calebhat.weather | 2 | 549 | 549 / 549 / 549 / 532 / 536 | 536 |
| plus io.github.calebhat.weather | 3 | 558 | 558 / 557 / 558 / 538 / 538 / 538 | 538 |
| plus io.github.calebhat.weather | 4 | 601 | 601 / 600 / 601 / 536 / 535 / 537 | 537 |
| plus io.github.calebhat.weather | 5 | 605 | 605 / 605 / 605 / 545 / 544 / 545 | 545 |

Over the 40 restarts of that run the release fell inside the window in 27,
at 1.5 to 14.3 s after it opened (9.5 to 22 s after ready), 20 of them
between 15.1 and 15.7 s after ready; 13 had released earlier or not by
23 s. Baseline `Pss` at 8 s: 526 to 596 MB (a 70 MB spread); at 23 s: 516
to 551 MB.

## Observation 2: two resting levels, 30 s settle

`Pss` in MB at the settle (30 s after ready), every 5 s through the window,
and at its end (45 s after ready).

| Configuration | Run | At 30 s | 30 s onward, every 5 s | At 45 s |
| --- | --- | --- | --- | --- |
| baseline | 1 | 524 | 524 / 524 / 523 / 523 | 523 |
| baseline | 2 | 531 | 531 / 530 / 530 / 540 | 540 |
| baseline | 3 | 532 | 532 / 531 / 531 / 541 | 541 |
| baseline | 4 | 526 | 526 / 541 / 540 / 555 | 555 |
| baseline | 5 | 530 | 530 / 529 / 529 / 536 | 536 |
| plus bjarneo.workspace-layout | 1 | 548 | 548 / 547 / 562 / 561 | 561 |
| plus bjarneo.workspace-layout | 2 | 569 | 569 / 568 / 573 / 573 | 573 |
| plus bjarneo.workspace-layout | 3 | 540 | 540 / 539 / 543 / 543 | 543 |
| plus bjarneo.workspace-layout | 4 | 547 | 547 / 546 / 560 / 560 | 560 |
| plus bjarneo.workspace-layout | 5 | 545 | 545 / 544 / 554 | 554 |
| plus omaplug | 1 | 550 | 550 / 549 / 549 / 555 | 556 |
| plus omaplug | 2 | 550 | 550 / 549 / 549 / 549 | 549 |
| plus omaplug | 3 | 551 | 551 / 564 / 564 / 577 | 577 |
| plus omaplug | 4 | 547 | 547 / 547 / 547 / 550 | 550 |
| plus omaplug | 5 | 547 | 547 / 553 / 553 | 553 |
| plus fixture.clean | 1 | 534 | 534 / 533 / 532 | 532 |
| plus fixture.clean | 2 | 565 | 565 / 565 / 565 / 565 | 565 |
| plus fixture.clean | 3 | 529 | 529 / 529 / 538 / 538 | 538 |
| plus fixture.clean | 4 | 568 | 568 / 567 / 572 | 572 |
| plus fixture.clean | 5 | 532 | 532 / 532 / 531 / 531 | 531 |

`fixture.clean` is a bar widget that declares nothing (a `Text` item), so
its runs 2 and 4 at 565 and 568 MB against runs 1, 3 and 5 at 529 to
534 MB are two starts of, for practical purposes, the same shell. Over the
80 traced restarts, classified by the minimum of each trace with a two-means
split (centres 530 and 555 MB in this run): baseline 0 of 10 high, plugin
runs 19 of 70 high, of which `omaplug` 7 of 10 and `bjarneo.workspace-layout`
6 of 10.

## Observation 3: the later rise

In the 30 s run, 16 of 40 restarts rose 10 to 15 MB in one step at 2.5 to
13.7 s after the window opened (32 to 44 s after ready); baseline runs 2,
3, 4 and 5 above show it (run 4 twice). It does not correlate with a
plugin in the way the resting level does.

## What was checked and ruled out from outside

- `Pss` against `VmRSS`: the two differ by 70.3 to 70.7 MB in every sample
  and move together, so this is not a shared-page accounting effect.
- The sampling point: reading at 8 s, at 30 s or at 45 s after ready moves
  which event a sample lands beside, not the events.
- The shell's CPU over the same windows: 0.13 to 0.27% for the baseline, one
  or two clock ticks over 15 s, with no relation to the level.
- `shell.json` after the whole run: byte-identical to the backup, so
  nothing left a change behind. Whether a plugin rewrote it during a
  window, which would rebuild the bar, was not recorded in these two runs;
  later documents carry it per sample as `configRewritten`.

## What was not checked, and how to

The shell's own journal was not captured in these runs. The next run of
the same scenario copies `journalctl --user -t omarchy-shell` and the
listing of `$XDG_RUNTIME_DIR/omarchy/plugin-runtime/` (one `generation-N`
per rescan) next to the document. The questions those would answer, in
order:

1. Does a high-level start show a bar rebuild after load (`Handler was
   registered but will not be used`, logged for every widget with an
   `IpcHandler` when `bar.layout` is reapplied)? A rebuild cost 19 MB on
   an installed shell and nothing was returned afterwards.
2. Does a high-level start show a second runtime generation, that is, a
   rescan and re-instantiation of every plugin after the first load? A
   `close_write`, `create`, `delete` or `move` under
   `~/.config/omarchy/plugins/` outside `.git/` and hidden entries triggers
   it 150 ms later.
3. Does the 55 to 65 MB release coincide with anything logged, and is it
   smaller or absent on a high-level start?

## Reproduction

On a stock install (or the plugin lab guest), from a checkout of omakit at
the commit that carries `tools/cost/` and `tests/fixtures/cost/`:

```bash
for f in clean timer-180ms poller idle-panel; do omarchy-plugin-add tests/fixtures/cost/$f --enable --yes; done
# plus any third-party plugins already enabled; the lab used weather, workspace-layout and omaplug
node bin/omakit cost --all --runs 5 --yes --out ~/omakit-cost.json
```

This restarts the shell (1 + plugins) × 5 times, about a minute each, and
restores `shell.json` afterwards (the md5 before and after is printed). Then:

```bash
jq -r '[.baseline.runs[], (.plugins[] | .runs[])] | .[] | "\(.label) \(.run) " + ([.shell.trace[] | select((.t*2|floor) % 10 == 0) | (.pssKb/1024|round|tostring)] | join(" / "))' ~/omakit-cost.json
```

prints one line per restart with `Pss` every 5 s through the window; the
two levels and the rise are visible by eye. In the lab this is one
command, `./bin/lab plugin <omakit>/tests/lab/cost.sh`, which installs the
seven plugins into a fresh guest, runs the measurement and copies the
document and the journal into the run directory.
