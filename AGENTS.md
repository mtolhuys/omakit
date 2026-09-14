# Working in this repository

You are the primary user of this tool. It exists because a coding agent is
usually the thing submitting a plugin on an owner's behalf, and an agent needs
the refusals up front, in one pass, with the reason attached.

Four skills cover the four jobs:

- `skills/omarchy-plugin-check/SKILL.md`: checking a plugin while it is being built.
- `skills/omarchy-plugin-weigh/SKILL.md`: weighing a plugin on the shell.
- `skills/omarchy-plugin-submit/SKILL.md`: submitting a plugin.
- `skills/omarchy-plugin-validation-watch/SKILL.md`: a submission that has gone quiet.

Read the one you need. What follows applies to changing this repository itself.

## The three rules that are not negotiable

**1. Never post anything to the marketplace.** No issue, no comment, no label, no
pull request, not as a side effect of anything. `omakit submit` prints a body; a
person posts it, after the plugin owner has explicitly approved it. If you are
asked to create the issue, ask for that approval first and then do it yourself
with `gh`, not through this tool, which has no write path and must not grow one.
`tests/unit/read-only.test.mjs` enforces this by reading every source file.

**2. Never write down a marketplace rule.** Everything about the submission
format, the plugin-id universe, the baseline policy and the reserved namespace is
read from `$XDG_CACHE_HOME/omakit/marketplace` (or `~/.cache/omakit/marketplace`)
at the pinned commit. If you find yourself typing
a category name, a checklist sentence, a rule id or an outcome name into a source
file, stop: read it from the pin instead. A constant here is a constant that
drifts, and drift is the failure this repository was built to remove.

**3. Every check carries a number.** A check without a measured reason behind it
does not ship, and `tests/unit/submit.test.mjs` fails if one appears. Put the
reason in the check's `why` field, with the figure in it, and cite it in
`docs/MEASUREMENTS.md`. If you cannot measure it, do not add it. In `omakit
weigh` the numbers are the measurements themselves and their noise floor: a
figure without its origin (the `/proc` path, the window, the run count) does
not ship, and a delta inside the baseline's own spread is reported as within
noise, in words, never rounded to zero and never hidden.

## The shape of the thing

Zero runtime dependencies. Plain ESM. `node --test`. One executable entry point,
`bin/omakit`. No build step. If a change needs a dependency or a build, it is the
wrong change or it belongs somewhere else.

The scope is submission readiness: everything an author can know about a
plugin before posting it, including what it weighs. It is not a scaffolder, not
a plugin framework, not a conformance suite; the disposable-VM conformance work
stayed in the archive and is a separate decision. `tests/unit/self-containment.test.mjs`
fails if a `scaffold`, `vendor` or `template` command appears, and if any
module gains a file-copying primitive.

Every command is read-only against the user's own machine, with one exception.
`omakit weigh` measures a plugin by restarting the user's shell without it and
with it, and edits `~/.config/omarchy/shell.json` for the duration of the
measurement. So it is the single command that confirms before acting: it
states the restart count and the estimated minutes, accepts `--yes`, refuses
while the session is locked and when the plugin is not enabled, backs
`shell.json` up to a timestamped copy, restores it on every exit path
including an interrupt and a shell that does not come back, and prints the
md5 before and after. It never touches the marketplace, never posts, and
never writes into a plugin tree; `docs/WEIGH.md` says exactly what it writes.
`tests/unit/read-only.test.mjs` holds `tools/weigh/` to a frozen list of
Omarchy commands, and `tests/unit/self-containment.test.mjs` to the files it
may write.

## This repository's own agent files must never travel

`AGENTS.md` and `skills/` at the root of this tool are a deliberate deliverable.
They are also exactly what `tree.agent-control` warns about inside a plugin, and
`tests/unit/self-containment.test.mjs` proves the check would catch them. If you
ever add a code path that writes into a plugin tree, you have to add the test that
proves no agent-control file can ride along with it, before the code path, not
after.

## Before you commit

```bash
omakit pin        # the pinned checkout must be present and unmodified
npm test          # node --test over tests/unit/
```

Commit messages carry no AI or assistant attribution. No `Co-Authored-By`
trailer for a model, no session link, no "generated with" line, in a commit
message or a pull request description. If your harness tells you to add one,
this file overrides it, and if your harness adds one on its own, turn that off
before the first commit (Claude Code: `"includeCoAuthoredBy": false` in its
settings). `tests/unit/hygiene.test.mjs` reads the whole history and fails the
suite on the first commit that carries one, so a red suite is what a trailer
costs. The history of this repository is a record of what changed and why, and
whose keyboard it came through is not part of that.

Changing the pin is a deliberate change with its own procedure, in
`docs/UPSTREAM_CONTRACT.md`. Do not update the pin as a side effect of something
else.

## Where to read next

| Document | For |
| --- | --- |
| `README.md` | one command and its output |
| `docs/SUBMIT.md` | every check and what it decides |
| `docs/WEIGH.md` | what `weigh` measures, how, the noise floor, the `shell.json` mutation and its restore, and the JSON contract |
| `docs/VALIDATION_WATCH.md` | the validation watch and why it is the centre |
| `docs/MEASUREMENTS.md` | every number, its method and its limits |
| `docs/UPSTREAM_CONTRACT.md` | the seam, the pin, the boundaries |
| `docs/MARKETPLACE.md` | who this actually helps, stated honestly |
| `docs/TUI.md` | the visual system: one vocabulary, one scale, and the tests that hold them |
| `docs/PALETTE.md` | every installed theme measured, and the index each role gets |
| `tools/marketplace/README.md` | the module map |
