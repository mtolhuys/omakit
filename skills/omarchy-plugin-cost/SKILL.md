---
name: omarchy-plugin-cost
description: Measure what an Omarchy Quattro plugin costs the shell, in MB and CPU, by restarting the shell without it and with it. Use before a submission, after a change that adds a timer, a process or a file watcher, or when asked how heavy a plugin is. Restarts the person's shell, so it must never run without their explicit agreement.
---

# What a plugin costs the shell

## The one thing to get right

**This command restarts the shell.** `omakit cost` measures a plugin by
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
  cost is the cost on the machine the plugin runs on.

Without `--yes`, from a pipe or with `--json`, the command prints the plan
and refuses with a usage error (exit 2); nothing is touched. That refusal is
the correct outcome of an agent running it unasked.

## When to run it

- Before submitting: the README sentence it produces belongs in the
  plugin's README, next to what the plugin does.
- After a change that adds a `Timer`, a `Process`, a `FileView` with
  `watchChanges`, a `SystemClock`, or a `Connections` to a busy service. A
  declared interval says nothing about what runs; this measures it.
- When the owner asks how heavy the plugin is. Answer with the measured
  figures and their noise floor, never with an estimate from the source.

## Run it

```bash
omakit cost <plugin-id-or-dir>                # one plugin, asks first
omakit cost <plugin-id-or-dir> --yes --json   # only after the person agreed
omakit cost --all --yes                       # every enabled third-party plugin
```

The plugin must be installed and enabled in the running shell: the
measurement puts it back exactly where the person has it. A plugin of kind
`bar` is refused (replacing the whole bar is not a cost), and so is a locked
session. `--runs` (default 3), `--window` (default 15 s) and `--settle`
(default 30 s) trade time for a lower noise floor; leave them at their
defaults unless the floor is too high to answer the question.

If `omakit` is not installed: `npm install --global omakit` (Omarchy ships
Node and npm through mise), then `omakit doctor`. `cost` needs no pin and no
network.

## Reading the verdicts

The header prints the **noise floor** once: the spread of the baseline's
own memory and CPU across its runs. A plugin whose median delta is not
larger than that floor is **within noise**, in those words, and the row is
`ok`. A row is `note` when memory or CPU is above the floor, and `?` when
no run of it completed.

- `within noise` means the measurement cannot tell the plugin from nothing
  at this run count and window. It does not mean zero. Say "within the
  noise floor of N MB and N% CPU", with the numbers.
- `above noise` is a measured cost. Report the median and its spread, and
  the children line separately: a plugin that costs 2 MB inside the shell
  and 40 MB in a helper process costs both.
- A negative median is printed as measured. Do not round it to zero and do
  not explain it away; it means the delta is inside the noise.
- Never describe a cost as acceptable or unacceptable. The verdict is a
  comparison with the floor; whether the number is fine is the owner's
  call, made with the number in front of them.

In `--json`, each row carries `verdict.memory` and `verdict.cpu`
(`within-noise`, `above-noise`, `unknown`), `withinNoise` with the floors,
the stats objects (`median`, `spread`, `min`, `max`, `runs`), and `origin`
naming the `/proc` paths and the arithmetic. `config.md5Before` and
`config.md5After` must be equal and `config.restored` true; if they are not,
tell the person at once and name `config.backup`, which is kept. The full
contract is `docs/COST.md`.

## What to paste into the README

The last thing the command prints is the sentence, per plugin, and the path
of the JSON that is its evidence:

```text
Costs 19.8 MB and 0.1% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14
```

Paste it as it is, under a heading such as "What it costs", and keep the
JSON with the plugin's evidence or link to it. A plugin within noise gets
"under N MB and under N% CPU", the floor, and that is the honest sentence
for it. Re-run and replace the sentence after any change that adds a timer,
a process or a watcher; a sentence measured on an older commit is a claim
about a plugin that no longer exists.

## What the measurement does not know

Per-plugin memory inside the shell is knowable only by this A/B, because Qt
allocates from shared heaps. RSS never falls when a plugin is unloaded and
every bar widget rebuilds on any layout change, so nothing here measures a
running shell before and after; both sides start fresh. The cost of a panel
only while it is open, and any cost that depends on another plugin, are not
measured. Do not extrapolate either.
