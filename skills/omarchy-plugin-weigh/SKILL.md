---
name: omarchy-plugin-weigh
description: Weigh an Omarchy Quattro plugin on the shell, in CPU and child processes, by restarting the shell without it and with it. Use before a submission, after a change that adds a timer, a process or a file watcher, or when asked how heavy a plugin is. Restarts the person's shell, so it must never run without their explicit agreement.
---

# What a plugin weighs on the shell

## The one thing to get right

**This command restarts the shell.** `omakit weigh` measures a plugin by
starting the person's `omarchy-shell` without the plugin and with it, several
times, and it edits `~/.config/omarchy/shell.json` for the duration. Every
other omakit command is read-only; this one is not. So:

- Never run it with `--yes` unless the person has just agreed, in this
  conversation, to have their shell restarted that many times. The command
  prints the count and the estimated minutes before it asks; put those in
  front of the person and wait for their answer.
- Never run it while they are in the middle of something on that desktop.
  The bar, every panel and every plugin go away and come back on each
  restart, (1 + plugins) × runs times, and a restart costs about a minute
  (a 30 s settle and a 15 s window after each). One plugin at three runs is
  six restarts, about five minutes. `--all` is sized for a lab machine, not
  a working desktop: 47 enabled plugins is 144 restarts and about two hours
  at three runs, three and a half at five. Offer `--all` only for a machine
  nobody is using.
- Never run it on your own machine's shell as a stand-in for theirs. The
  weight is the weight on the machine the plugin runs on.

Without `--yes`, from a pipe or with `--json`, the command prints the plan
and refuses with a usage error (exit 2); nothing is touched. That refusal is
the correct outcome of an agent running it unasked.

## When to run it

- Before submitting: the README sentence it produces belongs in the
  plugin's README, next to what the plugin does. The question a person
  asks is how heavy it is; this answers it with a measurement.
- After a change that adds a `Timer`, a `Process`, a `FileView` with
  `watchChanges`, a `SystemClock`, or a `Connections` to a busy service. A
  declared interval says nothing about what runs; this measures it.
- When the owner asks how heavy the plugin is. Answer with the measured
  figures and their noise floor, never with an estimate from the source.

## Run it

```bash
omakit weigh <plugin-id-or-dir>                # one plugin, asks first
omakit weigh <plugin-id-or-dir> --yes --json   # only after the person agreed
omakit weigh --all --yes                       # every enabled third-party plugin
```

The plugin must be installed and enabled in the running shell: the
measurement puts it back exactly where the person has it. A plugin of kind
`bar` is refused (replacing the whole bar is not a weight), and so is a locked
session. `--runs` (default 3), `--window` (default 15 s) and `--settle`
(default 30 s) trade time for a lower noise floor; leave them at their
defaults unless the floor is too high to answer the question.

If `omakit` is not installed: `npm install --global omakit` (Omarchy ships
Node and npm through mise), then `omakit doctor`. `weigh` needs no pin and no
network.

## Reading the verdicts

The header prints the **noise floor** once: the spread of the baseline's
own CPU across its runs. A plugin whose median CPU delta is not larger than
that floor has **no measurable CPU**, in those words, and the row is `ok`.
A row is `note` when CPU is above the floor, and `?` when no run of it
completed.

- `no measurable CPU` means the measurement cannot tell the plugin from
  nothing at this run count and window. It does not mean zero. Say "no
  measurable CPU against a floor of N%", with the number.
- `above noise on CPU` is a measured weight. Report the median and its
  spread, and the children line separately: a plugin that adds 0.1% in the
  shell and runs a 40 MB helper weighs both.
- **Memory is the shell's, not the plugin's, for now.** The memory delta is
  printed with its spread, and the header labels it "within the shell's own
  startup variance (N MB)". Never turn it into a sentence about the plugin
  ("costs N MB", "under N MB"): the shell comes to rest on one of two
  levels 35 MB apart after a restart, and that difference is not the
  plugin's (`docs/MEASUREMENTS.md`, C1 and C2). If the owner asks about
  memory, say exactly that and show the figure with the variance beside it.
- A negative median is printed as measured. Do not round it to zero and do
  not explain it away; it means the delta is inside the noise.
- Never describe a weight as acceptable or unacceptable. The verdict is a
  comparison with the floor; whether the number is fine is the owner's
  call, made with the number in front of them.

In `--json`, each row carries `verdict.memory` and `verdict.cpu`
(`within-noise`, `above-noise`, `unknown`), `withinNoise` with the floors,
the stats objects (`median`, `spread`, `min`, `max`, `runs`), and `origin`
naming the `/proc` paths and the arithmetic. `config.md5Before` and
`config.md5After` must be equal and `config.restored` true; if they are not,
tell the person at once and name `config.backup`, which is kept. The full
contract is `docs/WEIGH.md`.

## What to paste into the README

The last thing the command prints is the sentence, per plugin, and the path
of the JSON that is its evidence:

```text
Weighs no CPU above the floor (0.13%) and runs 2 child processes using 8.2 MB and 0.1% CPU, on Omarchy 4.0.0.alpha, measured with omakit weigh on 2026-09-14
```

Paste it as it is, under a heading such as "What it weighs", and keep the
JSON with the plugin's evidence or link to it. It names the CPU floor even
when the plugin is under it, and the child processes with their memory;
it never names the shell's memory, and neither should you in that README.
Re-run and replace the sentence after any change that adds a timer,
a process or a watcher; a sentence measured on an older commit is a claim
about a plugin that no longer exists.

## What the measurement does not know

Per-plugin memory inside the shell is knowable only by this A/B, because Qt
allocates from shared heaps. RSS never falls when a plugin is unloaded and
every bar widget rebuilds on any layout change, so nothing here measures a
running shell before and after; both sides start fresh. The weight of a panel
only while it is open, and any weight that depends on another plugin, are not
measured. Do not extrapolate either.
