# The measurements behind every check

This document is the evidence base for this tool. Every check in `omakit submit`
and `omakit watch` cites one of the entries below, in the source, next to the
check. A check without a number behind it does not ship.

**This is derived work.** The numbers come from public issues, public workflow
and script sources, and the public `registry.json` of
[`omacom/omarchy-plugin-marketplace`](https://github.com/omacom/omarchy-plugin-marketplace),
read on 2026-09-12. They are one outsider's reading of public data. They are not
the marketplace's rules, not endorsed by its maintainers, and not a description
of what the marketplace will do. Where this tool needs a rule, it reads the rule
from a pinned checkout of that repository rather than from this document.

Population figures are a snapshot of 2026-09-12, roughly 10:00 UTC. Ratios were
stable across the measurement window; absolute counts move by the hour.

## Method

| Source | How |
| --- | --- |
| Population counts | GitHub search API, all 6,391 issues in twelve date slices, deduplicated on issue number. Text searches use `in:comments`, so they count issues, not comments. |
| Sample | 320 issues with 328 maintainer review comments, four strata, fixed seed: 100 open `needs-fixes`, 120 published, 60 waiting on the maintainer, 40 closed `[Verify]:`. |
| Validation staleness | The validated commit from the bot's own comment compared with the default branch HEAD from each plugin repository's `commits.atom`. |
| Registry figures | `registry.json` and `site/catalog.json` at the pinned marketplace commit, counted by `baselineFigures()` in `tools/marketplace/registry.mjs` and pinned by `tests/unit/registry-figures.test.mjs`, which also checks that this document still carries them. |
| Churn per path | `git clone --filter=blob:none` of the marketplace, then `git log --since=30.days --oneline` for the whole tree and `git log --since=30.days --oneline -- <path>` per path omakit reads; a commit touching only `registry.json` is one whose `git show --stat` names that file alone. |

Known limits, stated rather than buried. A HEAD that is ahead proves the pin is
stale, not that the findings were fixed; the push may be a README tweak. The
label-event evidence rests on five requested timelines plus label combinations.
One stratum, "closed but not listed" (667 issues), was not sampled and inherited
the lower rate of the published group. W37 lead times are censored and too low.

## M2. The submission format costs round trips that a generated body cannot

| Measurement | Value |
| --- | --- |
| Submissions that fell out on the title prefix alone | 39 (14 still open, 7 rescued by hand) |
| Open submissions malformed in the body | 11 |
| Of those, distance from a valid submission | one case differs by the single word "Suggested" instead of "Suggest" |
| What a malformed body produces | `❌ The validation result could not be published to the issue. A maintainer must review the workflow.`, which blames the maintainer for the author's mistake |
| Median submission-to-publication, 2026-W33 | 4.9 h |
| Median submission-to-publication, 2026-W36 | 35.0 h (p90 101 h) |
| Parked in the author's own court | 464 submissions, median 5.6 days since last activity |
| Of those, ever produced a fresh validation | 23% (77% never did) |

Used by: `submission.title`, `submission.headings`, `submission.category`,
`submission.tags`, `submission.checklist`, `submission.official-parser`,
`submission.repository-url`, `plugin.root-manifest`, `plugin.root-readme`,
`plugin.root-license`, `identity.available`.

The design consequence: nothing about the format is written down in this
repository. The title prefix, the six headings, the category and tag lists and
the checklist text are read from `.github/ISSUE_TEMPLATE/submit-plugin.yml` at
the pin, and the rendered body is then handed to the marketplace's own
`parseCurrentSubmission` from the same commit. A contract that drifts from the
form by one word reproduces exactly the failure above, so the form is the only
source and the marketplace's own parser is the only judge.

## M3. Agent-control files draw review attention, and nothing warns first

| Measurement | Value |
| --- | --- |
| Issues mentioning agent-control files | 103 |
| Sampled maintainer review comments about them | 24 of 328 |
| Detected by the marketplace's automated baseline | no |
| Listed plugins that ship one at their listed commit | 6 of 34 inspected (2026-09-13) |

An instruction file inside an installed plugin is read by whatever agent the
user runs next, and reviewers raise it. Because no automated check reports it,
an author hears about it from a human review round, which is the most
expensive round there is.

It is not a listing rule, and this check never refuses on it. Measured on
2026-09-13 against `registry.json` at the pin: at their
`listingValidatedCommit` (`git fetch --depth 1 --filter=blob:none origin
<commit>`, then `git ls-tree -r --name-only`), 4 of one author's 5 listed
plugins ship a root `AGENTS.md`, two of them at a commit carrying the
maintainer's own `maintainerVerificationReview`; a fixed-seed sample of 30
listed sources (one unreachable) found 2 more, one with `AGENTS.md`,
`CLAUDE.md` and a `skills/**/SKILL.md`. Six of 34 listed plugins inspected
(18%) carry one at the commit the marketplace listed. So the check is
advisory: it prints the paths and the remedy and still produces the body.

Used by: `tree.agent-control`. The check is recursive over the installable tree
and matches `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.mcp.json`, anything under
`.claude/` or `.codex/`, and instruction files under any `skills/` directory.
Matching is case-insensitive on the basename, because an agent reads `agents.md`
as readily as `AGENTS.md`.

This is an Omakit check derived from public issue text. It is not marketplace
policy and does not claim to be; its verdict is labelled `omakit`, not
`marketplace-pin`.

## M4. The baseline decides whether a human has to look at all

From `registry.json` at the pin: 2,963 listed sources, of which 2,916 carry a
recorded baseline (the rest were listed before the baseline existed or have
no record):

| Outcome | Count |
| --- | --- |
| `passed` | 1,681 |
| `review-required` | 1,215 |
| `needs-fixes` | 20 |
| Findings ever recorded, total | 21 (`curl-pipe-shell` 11, `remote-git-execution-unpinned` 10) |

Capabilities recorded: installer 514, privilege 485, package-manager 468,
service-management 382, remote-build 366, bundled-executable-binary 31,
sudoers-modification 23. Sections are numbered M2, M3, M4 and M6 because M1
and M5 were population figures that no check cites; their numbers were folded
into M2 and M6 and the ids were not reused, since checks cite them by number.

`review-required` is not a defect and needs no source change, but it does mean a
maintainer must look at the exact commit before it can be listed. It is the
single largest determinant of whether a submission waits on a person, and it is
knowable before submitting.

Used by: `baseline.preflight`. Under the current `selective` enforcement mode
only `sudoers-dangerous-passwordless-command` and
`privileged-process-control-from-shared-temp` block publication; the other three
rules produce `needs-fixes` with a `review-required` disposition that a
maintainer may accept for that exact commit. Outcome, disposition, blocking rule
set and enforcement mode are all read from the pinned
`scripts/security-baseline-policy.mjs`, never restated here.

The baseline performs no general data-flow analysis and is not a security
review. This tool never says otherwise: it prints the marketplace's own two
closing sentences, read out of the marketplace's own report builder at the pin.

## M6. The validated commit falls behind silently, and that is the centre of this tool

The marketplace validates one exact commit, and the review that follows is of
that commit.

| Measurement | Value |
| --- | --- |
| Parked submissions with a default-branch HEAD ahead of the validated commit | 73% of 464 |
| Pushed after the maintainer's review without the marketplace ever seeing it | 47% |
| Of those authors, who also commented | 82%, so they are engaged and stuck, not gone |
| Open submissions inspected with no labels left | 13, of which 9 had passed validation and passed the baseline with zero findings and were blocked solely by a validated commit that had fallen behind |
| Maintainer requests for a fresh validation that never produced one | 46% overall, 77% in the parked group |
| Hand-written staleness notices by the maintainer | 358 issues |
| Listed sources whose validated commit was superseded at least once | 749 of 2,963 (25.3%), 1,108 superseded commits, one source revalidated 9 times |

The last row is this repository's own measurement, recomputed from
`registry.json` at the pin by `tests/unit/registry-figures.test.mjs`; it
shows that revalidation is a normal part of a listing's life, not an edge case.

The mechanism, with `file:line`:

- `.github/workflows/route-issue-automation.yml` is the only workflow with a
  direct `issues` trigger: `types: [opened, edited, reopened, labeled, unlabeled]`.
- There is no `issue_comment` trigger anywhere in the repository, so a comment
  triggers nothing.
- `.github/workflows/refresh-catalog.yml` does compare branch HEADs, on
  `cron: 17 4 * * *`, but only for plugins that are already listed, and it does
  not rerun the snapshot security baseline. Open submissions fall outside it.
- Therefore the pin moves only when the author edits the issue body.
- `scripts/submission-feedback.mjs` contains the text `edit the issue` 22 times,
  every one of them attached to a deterministic *failure*.
  `scripts/validate-submission.mjs` builds the *success* comment and contains it
  zero times. The success path is the path 97 of 100 parked submissions took.

Used by: `omakit watch`, and `submission.validation-commit` in `omakit submit`.
The watch reads; it never edits, comments or labels. The action it names is the
author's to take.

## M7. The registry moves by the hour; the code and the rules move by the week

Measured on 2026-09-13 against `omacom/omarchy-plugin-marketplace` at
`d4321b5b`, with a blob-filtered clone and `git log --since=30.days` per path:

| Measurement | Value |
| --- | --- |
| Commits in the last 30 days | 4,293 |
| Of those, touching only `registry.json` | 4,201 (about 140 a day) |
| Changes to each of the eleven files omakit reads rules and code from | 1 to 8 in the month |
| Last change to `submit-plugin.yml` and `scripts/submission.mjs` | 2026-08-30 |
| Last change to `scripts/build-catalog.mjs` | 2026-09-03 |
| Changes under `scripts/` or `.github/ISSUE_TEMPLATE/` since the pin `38060f89` (2026-09-11) | none |

So one pin is right for the code and the rules, which move slowly and must
never be fetched and executed unreviewed, and wrong for the registry, which is
stale within hours of any pin. `identity.available` judges "is this id listed,
is this repository listed, is this id retired" against `registry.json` and
`site/catalog.json`, and a copy frozen at the pin answers those questions about
a marketplace that has since listed about 140 more commits' worth of plugins a
day.

The consequence: `registry.json` and `site/catalog.json` are read from the
marketplace's current default-branch HEAD when the network is there, at the
exact commit `defaultBranchHead()` resolved so the two files cannot disagree
with each other, and from the pin when it is not or when `--offline` is
passed. Nothing under `scripts/` and nothing in `.github/ISSUE_TEMPLATE/` is
ever read from HEAD: the sparse pin stays the only source of executed code and
of the contract. Every run says which source it used and at which commit, in
the check's detail and under `registry` in `--json`. The figures in M4 and M6
are the pin's by design: they are cited in prose that
`tests/unit/registry-figures.test.mjs` holds to the pin, and a number that
moved between two runs could not be cited.

Used by: `identity.available`, and by `pin.freshness` in `omakit doctor`, which
names which of the paths omakit reads changed between the pin and HEAD rather
than only that HEAD moved, because at this rate HEAD has always moved. Not by
`baseline.preflight`, whose figures stay the pin's.

## C1. Cost noise floor

The figures behind `omakit cost` are the measurements themselves and their
noise floor, not a population statistic, so this entry is a different kind
of evidence from M2 to M7: three runs of `tests/lab/cost.sh` in the Omarchy
plugin lab guest (stock pin `b5589fa`, shell `4.0.0.alpha`, one 1280x800
screen, software rendering) on 14 September 2026, each `omakit cost --all
--runs 5 --yes` over the four fixtures under `tests/fixtures/cost/` and three
listed plugins (`bjarneo.workspace-layout`, `omaplug`,
`io.github.calebhat.weather`), 40 restarts per run, `shell.json` md5
`2caeda7f4da844a0d51b045ae5652346` before and after every run, no backup
left behind, every document valid against `tools/cost/contract.mjs`. The
documents are under `docs/evidence/cost/`, with the earlier bash audit's run
of the same day (`rent-audit-lab-2026-09-14.json`: 24 restarts, 3 runs,
`VmRSS` at the end of the window).

| Run | Settle | Baseline memory spread, 5 runs | CPU spread |
| --- | --- | --- | --- |
| bash audit, 3 runs (`rent-audit-lab-2026-09-14.json`) | 8 s | `VmRSS` at the end of the window: 15.54 MB | 0.06% |
| 1, memory sampled at the settle (`lab-2026-09-14-sample-at-settle.json`) | 8 s | `Pss` at the settle 70.31 MB, `VmRSS` at the settle 70.63 MB; `VmRSS` at the end of the window 8.67 MB | 0.067% |
| 2, with a trace (`lab-2026-09-14-settle-8-trace.json`) | 8 s | `Pss` at the settle 41.40 MB; at the end of the window `Pss` 34.61 MB, `VmRSS` 34.95 MB | 0.133% |
| 3, the shipped defaults (`lab-2026-09-14-settle-30.json`) | 30 s | `Pss` at the settle 7.27 MB, `VmRSS` 6.91 MB; at the end of the window `Pss` 31.99 MB, `VmRSS` 32.00 MB | 0.133% |

The floor before this work was 15.54 MB (`VmRSS`, 3 runs); the floor the
shipped method reports on the same guest is 31.99 MB (`Pss` at the end of a
window that opens 30 s after every plugin is reported, 5 runs). It did not
come down, and the two things that were expected to bring it down did not:

- `Pss` against `VmRSS`. In every one of the 40 samples of run 3 the two
  differ by 70.3 to 70.7 MB and move together; `Pss` is the right quantity
  to report (a shared page counted once) and buys no precision.
- The sampling point. What decides the floor is where the shell is in its
  own memory life when the sample is taken, and that is bimodal (C2). Run 3's
  settle-time floor of 7.27 MB is five baseline runs that all landed on the
  low level; the plugin rows of the same run spread 30 to 63 MB because two
  to three of their five runs landed on the high one. The floor from five
  baseline runs can therefore understate the noise, and every row carries
  its own spread beside the floor for that reason.

The plugin table of run 3, `Pss` at the end of the window, the median over
five runs of (with the plugin minus without it), spread in brackets:

| Plugin | Shell MB (spread) | Shell CPU (spread) | Children MB | Children CPU | Processes | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| bjarneo.workspace-layout | 18.19 (36.11) | 0% (0.13) | 8.18 | 0.13% | 2 | no measurable CPU |
| omaplug | 16.86 (41.22) | 0% (0.20) | 0 | -0.13% | 0 | no measurable CPU |
| fixture.idle-panel | 14.20 (62.80) | 0% (0.07) | 0 | -0.33% | 0 | no measurable CPU |
| fixture.clean | 9.16 (30.28) | 0% (0.20) | 0 | 0.07% | 0 | no measurable CPU |
| io.github.calebhat.weather | 8.96 (29.82) | 0% (0.20) | 0 | -0.07% | 0 | no measurable CPU |
| fixture.poller | 3.42 (44.41) | 0% (0.13) | 4.09 | -0.20% | 1 | no measurable CPU |
| fixture.timer-180ms | -12.21 (56.50) | 2.73% (0.33) | 0 | -0.07% | 0 | above noise on CPU |

What holds across all three runs: the 180 ms timer costs 2.7 to 2.8% CPU
(run 3: 2.73, 2.40, 2.66, 2.73, 2.73) against a CPU floor of one or two
clock ticks over the window (0.067 to 0.133%), the clean fixture is within
noise on both and the report says so in those words, the poller's
`inotifywait` (4.1 MB) and workspace-layout's two watchers (8.2 MB) are
attributed by command line in every run, and the three listed plugins have
memory medians of 9 to 21 MB in every run against fixture medians of -12 to
14. What does not hold: at five runs, no plugin's memory median clears a
32 MB floor, and the memory column is a fact about the shell's start rather
than a cost of a plugin until C2 is understood, so the README sentence
speaks about CPU and child processes and not about memory at all.

CPU quantum. The CPU floor is one or two clock ticks over the 15 s window,
and a delta is quantised to ticks too: run 1 judged `fixture.idle-panel`
above noise on CPU with a median of -0.066662% (one tick over 15.003 s)
against a floor of 0.066653% (one tick over 15.005 s). The rule is now that
a CPU delta is above noise only when it exceeds the floor and one tick over
the window (`docs/COST.md`); under it the same row is within noise, and no
other verdict in the three runs changes.

Restart timing. From `omarchy-restart-shell` to every plugin reported took
1 s in 39 of 39 measured restarts of run 3; the 41 restarts of the run took
1,841 s, 44.9 s each, which is the 30 s settle, the 15 s window and the
restart. The earlier estimate of 25 s per restart, carried over from the
bash audit, was its settle and window and not a restart. The estimate the
confirmation prints is built from this: the shell's own time from the
previous run on the machine (5 s before one exists), plus the settle and the
window, about a minute per restart, six restarts and about five minutes for
one plugin at three runs, and 144 restarts and about two hours for `--all`
over 47 enabled plugins.

Used by: `omakit cost`, its confirmation, and `docs/COST.md`. Not by any
`submit` check.

## C2. The shell's memory after a restart has two levels and two events

Shell behaviour, measured while lowering C1's floor, and recorded here as a
candidate for an upstream report; `omakit cost` does not correct for it, it
reports the floor it produces. From the `Pss` traces (twice a second through
every window) of runs 2 and 3, 80 restarts of the same configuration set in
the same guest:

- After `listPlugins` reports every plugin, 0.3 s after
  `omarchy-restart-shell` returns, the shell holds a load-time high of 550
  to 615 MB `Pss`.
- It then releases 55 to 65 MB in one step. In run 2 (window at 8 s) the
  release fell inside the window in 27 of 40 restarts, at 1.5 to 14.3 s
  after the window opened, that is 9.5 to 22 s after ready, most of them at
  15.6 s; the other 13 had either released before the window or not at all
  by its end.
- It comes to rest on one of two levels. In run 3 (window at 30 s), 23 of
  40 restarts sat at 523 to 535 MB at the settle and 17 at 545 to 572 MB, a
  difference of about 35 MB between two starts of the same configuration.
- It then rises 10 to 15 MB in one step, sometimes twice. In run 3 that
  rise fell inside the window in 16 of 40 restarts, at 2.5 to 13.7 s after
  the window opened, that is 32 to 44 s after ready.

The consequences for `omakit cost` are the 30 s settle (the window sits
after the release), the trace kept in every document (a machine whose
release comes later shows it), and a memory floor that is the shell's, not
the sampler's: two starts of the same configuration differ by up to 35 MB
in this guest before any plugin is added, and no sampling point changes
that. What the two levels and the two events are is not known from
outside the process; a report to the shell's maintainers would carry the
traces in `docs/evidence/cost/` and the fixtures under `tests/fixtures/cost/`
that reproduce them on a stock install.
