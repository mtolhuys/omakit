# The skills, and using omakit from an agent

The expected user of this tool is a coding agent working on an owner's behalf,
so the six skills in [`skills/`](../skills) are part of what it ships, not an
afterthought beside it. Each one covers one job and says, in its own
description, when it applies and what it will not do.

```bash
npx skills add mtolhuys/omakit
```

They install as ordinary skill directories, one `SKILL.md` each. Nothing in
them is required to use omakit; they exist so an agent reaches for the right
command at the right moment without being told each time.

## What ships

| Skill | Job | When it applies |
| --- | --- | --- |
| [`omarchy-plugin-build`](../skills/omarchy-plugin-build/SKILL.md) | build | plugin code starts a program or keeps a file of its own, `inspect` shows a process-lifecycle, unbounded-buffering, environment-trust or file-and-state-boundary row, or a review comment names a deadline, a cap, `PATH`, an orphan, a symlink or an atomic write |
| [`omarchy-plugin-check`](../skills/omarchy-plugin-check/SKILL.md) | check | any time a plugin is created, edited, refactored or tested, and before any push to its default branch |
| [`omarchy-plugin-submit`](../skills/omarchy-plugin-submit/SKILL.md) | check | asked to submit, list or publish a plugin, or to say whether it is ready |
| [`omarchy-plugin-validation-watch`](../skills/omarchy-plugin-validation-watch/SKILL.md) | track | a submission has gone quiet, a reviewer asked for a fresh validation, or fixes were pushed and nothing happened |
| [`omarchy-plugin-audit`](../skills/omarchy-plugin-audit/SKILL.md) | track | before touching, enabling or updating an installed third-party plugin |
| [`omarchy-plugin-weigh`](../skills/omarchy-plugin-weigh/SKILL.md) | track | before a submission, after a change that adds a timer, a process or a file watcher, or when asked how heavy a plugin is |

The jobs are the ones in [HOW.md](HOW.md); prove, the fourth, is
[`omakit lab`](LAB.md) and has no skill of its own, because a run needs a
host the agent cannot arrange for itself.

## The two the skills refuse on the agent's behalf

Both are in the skills because both are places where an agent, left to its own
judgement, would do the helpful thing and be wrong.

**The issue is not yours to create.** `submit` produces a title and a body.
Creating the issue is a separate act that needs the plugin owner's approval,
which is also what the marketplace's own agent instructions require. Nothing
in this repository can post: `tests/unit/read-only.test.mjs` proves no HTTP
method other than GET exists anywhere in the tree.

**Weighing restarts somebody's desktop.** `weigh` measures by restarting the
shell without the plugin and with it, several times, editing `shell.json` for
the duration. It asks first, and `--yes` is that consent given in the command
line by someone who has agreed. In a pipe, from an agent, or under `--json`,
an unanswered question is `not-confirmed` and exit 2, never a guess.

## Reading omakit from a program

Every command can end as one JSON document, and the shape does not change with
the outcome:

```bash
omakit inspect ./my-plugin --json
omakit submit ./my-plugin --category Widgets --tags bar --json --out run.json
```

| Field | Always |
| --- | --- |
| `command` | the command that ran |
| `ok` | true exactly when the exit status is 0 |
| `error` | null on success, `{ code, message, remedy }` otherwise, `remedy` never null |
| the rest | the command's own document |

Read `error.code`, not the sentence: the sentence names this run's file and
commit and is written for a person. Every code, what it means and the one
action are in [FAILURES.md](FAILURES.md). Exit 0 is success, 1 is a refusal
the tool means, 2 is a usage error or an unanswered question. Under `--json`
the failure's sentence also goes to stderr, and a piped stderr is empty on
success.

`omakit help --agent` prints the operating instructions for the agent running
it, and the full contract is [COMMANDS.md](COMMANDS.md#the-contract-every-command-keeps).

## What none of them do

No skill posts anything, comments anywhere, opens a pull request, or writes
into a plugin tree except through `omakit add`, which writes the block's own
files and nothing else. The decisions that stay the owner's stay the owner's:
creating an issue, restarting a desktop, and choosing a category and tags,
which is an editorial choice the tool refuses to invent.
