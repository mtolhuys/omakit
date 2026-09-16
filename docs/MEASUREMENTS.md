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

## A1. Installed commits against marketplace validation

The first completed desktop audit ran on 2026-09-15 with the shell running,
using the local revision: `node bin/omakit audit --out <capture.json>`.
It exited 1 for drift. No checkout action was run.

| Measurement | Value | Origin |
| --- | --- | --- |
| Installed | 55 | `omarchy plugin list --json` length |
| First-party excluded | 37 | Installed `firstParty` or catalog `sourceType: builtin` |
| Audited | 18 | Third-party row count |
| Validated | 9 | Rows whose primary state is `validated` |
| Drift | 9 | 5 `ahead`, 1 `diverged`, 3 `unlisted` |
| Largest count ahead | 31, `io.github.calebhat.weather` | `git rev-list --count 986604e0a7275f7060ac18adec7493393c55906f..HEAD` |
| Catalog read time | 2026-09-15T00:26:28.400Z | Immutable catalog cache `liveRegistry fetchedAt`; the run resolved live HEAD |

The catalog was
[3d240d4dde4d148017792bac08720b9ac158d6a6](https://github.com/omacom/omarchy-plugin-marketplace/blob/3d240d4dde4d148017792bac08720b9ac158d6a6/site/catalog.json).
Weather's installed HEAD was `fda4aaa88e6f47af1925ae4eb7b18e9ba5bfc7fa`.
The missing validated object for Disk Lens was reported as `diverged`, with
`shallow clone: false`. Modified flags do not replace a validated primary state.

Captured stdout:

```text
catalog       live HEAD 3d240d4d at 2026-09-15T00:26:28.400Z
installed     55
first-party   37 left out
audited       18

▓ note  io.github.mtolhuys.disk-lens
        diverged: validated commit not in local history; shallow clone: false;
        HEAD 5a4b1b27; validated 7f0ea22a on 2026-09-14T09:51:46.925Z
        → git -C
          "/home/mtolhuijs/.config/omarchy/plugins/io.github.mtolhuys.disk-lens"
          checkout 7f0ea22aee80a4f7f23ade4dede500f61eedba75

▓ note  io.github.calebhat.weather
        31 commits ahead of validated 986604e0 (2026-08-29T10:43:31.905Z); HEAD
        fda4aaa8
        → git -C
          "/home/mtolhuijs/.config/omarchy/plugins/io.github.calebhat.weather"
          checkout 986604e0a7275f7060ac18adec7493393c55906f

▓ note  robzolkos.github
        1 commit ahead of validated c38e600b (2026-09-13T09:33:19.839Z); HEAD
        64807fcd
        → git -C "/home/mtolhuijs/.config/omarchy/plugins/robzolkos.github"
          checkout c38e600ba76af0771c708cbc546154bd24aeb7e8

▓ note  io.github.mtolhuys.news-radar
        3 commits ahead of validated 8b07c89d (2026-09-14T09:51:46.925Z); HEAD
        139fdd28
        → git -C
          "/home/mtolhuijs/.config/omarchy/plugins/io.github.mtolhuys.news-radar"
          checkout 8b07c89dea0d317f2ff15f55a0e971083e26022a

▓ note  omaplug
        12 commits ahead of validated efa46690 (2026-09-13T11:23:42.682Z); HEAD
        b8479d40
        → git -C "/home/mtolhuijs/.config/omarchy/plugins/omaplug" checkout
          efa46690991ea59c3c290456807545dd7350dc03

▓ note  crmne.hyprmoncfg
        2 commits ahead of validated 513e5ce6 (2026-09-14T11:14:57.429Z); HEAD
        cf05a04a
        → git -C "/home/mtolhuijs/.config/omarchy/plugins/crmne.hyprmoncfg"
          checkout 513e5ce669224f3d3eabf72bd4342fb29f7622c7

▓ note  io.github.pablo-merino.altswitch
        validated 8f54d684 on 2026-08-30T09:56:21.339Z; modified

▓ note  io.github.mtolhuys.plugin-pulse
        unlisted: manifest id and origin match no marketplace listing; HEAD
        2d099d42; modified

░ info  io.github.mtolhuys.news-readers
        unlisted: manifest id and origin match no marketplace listing; HEAD
        7d91c50e

░ info  bjarneo.workspace-layout
        unlisted: manifest id and origin match no marketplace listing; HEAD
        f5d06c11

▁ ok    expose.window-overview
        validated 4f49c093 on 2026-09-13T09:33:19.839Z

▁ ok    io.github.sirjul1337.lock-explorer
        validated ed8e8f82 on 2026-09-14T09:51:46.925Z

▁ ok    bobbynicholas.omaland
        validated ec232b6a on 2026-08-29T10:43:31.905Z

▁ ok    io.github.mtolhuys.onscreen-keyboard
        validated a41b45a7 on 2026-09-14T09:51:46.925Z

▁ ok    io.github.mtolhuys.theme-manager
        validated cc6486ac on 2026-09-14T09:51:46.925Z

▁ ok    akshar.radio-atlas
        validated b290c29c on 2026-09-12T08:40:57.042Z

▁ ok    io.github.mtolhuys.sidecar
        validated 93800d2c on 2026-09-14T09:51:46.925Z

▁ ok    omadock
        validated d2d355c5 on 2026-09-13T09:33:19.839Z

        → To validate a newer commit:
          https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=verify-plugin.yml
        Verify or update a listed plugin; choose "Verify and publish a newer
        upstream commit".

█ DRIFT  9 of 18 run a commit the marketplace validated; 9 run one it never saw.
```

An earlier probe on 2026-09-15 could not produce K of M:
`omarchy plugin list --json` answered `omarchy-shell is not running`, so M was
not knowable and `omakit audit` correctly stopped as `NOT AUDITED`. The catalog
and two checkout facts recorded in [AUDIT.md](AUDIT.md) were used to define and
test the states, but were not substituted for the shell's installed list.
That failed probe is retained because a failed list is not zero installed plugins.

Used by: `omakit audit`. This is a dated desktop snapshot, not a source-safety
verdict or a prediction about another installed set.

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

The historical staleness aggregate is dated 2026-09-12. Recovered research
notes show it was a sample estimate, not a full 464-issue measurement. The
[recovered excerpt](evidence/staleness/recovered-notes-2026-09-12.md) records
68 stale pairs among 93 readable sampled issues. Original per-issue records
were not found, so historical HEADs cannot be reconstructed honestly. The
full, current label-defined queue is re-measured below using bot markers
and default-branch `commits.atom`, with per-issue sources and unknowns.

| Measurement | Value |
| --- | --- |
| Historical sampled submissions with a default-branch HEAD different from the validated commit, 2026-09-12 | 68/93 readable (73.1%) in a 100-issue sample drawn from a 464-issue queue; 7 unreadable |
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


### Full queue re-measured on 2026-09-15

```bash
node tools/marketplace/measure-staleness.mjs > docs/evidence/staleness/2026-09-15.json
```

The [per-issue record](evidence/staleness/2026-09-15.json) contains every
issue number, bot-validated full commit or null, default-branch HEAD or null,
verdict, read window and source URLs. The recovered queue definition is the
union of open `needs-fixes` and `security-needs-fixes` issues, excluding pull
requests and deduplicating issue numbers. Both label populations are read
with complete pagination. This is a full queue attempt, not a sample.

```json
{
  "measurement": "M6",
  "date": "2026-09-15",
  "openedAt": "2026-09-15T15:10:47.394Z",
  "completedAt": "2026-09-15T15:12:19.539Z",
  "sample": false,
  "total": 583,
  "compared": 519,
  "stale": 326,
  "current": 193,
  "unknown": 64,
  "staleShareOfCompared": 0.628131021194605,
  "staleShareOfPopulation": null
}
```

From 15:10:47.394 to 15:12:19.539 UTC, 326/519 readable comparisons were
stale (62.8%), 193 current, with 64 unknown among 583 issues. The client
read each issue's latest full security-baseline bot marker and compared it
with that repository's default-branch `commits.atom` HEAD. It did not use
the authenticated HEAD API. Missing markers, incomplete baseline records and
unreadable feeds are explicit unknowns. Feed reads were shared per repository;
issue comments were completely paginated up to the existing ten-page guard.

Unequal commit identifiers establish stale validation, not which commit is
an ancestor of the other. The exact stale share of all 583 is unknown; its
observed lower bound is 326/583 (55.9%) and upper bound 390/583 (66.9%).
The 62.8% denominator is 519 comparable issues. These are live reads across
a dated window, not historical HEADs at a single immutable instant. The
2026-09-12 sample and today's larger queue differ in both date and coverage,
so their rates alone do not establish a trend. No issue, comment or label
was changed. The measurement script uses the existing GET-only client.

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

## M8. Tab completion was written, never proven, and the proof is not `complete -p`

Measured on 15 September 2026 against the installed Omarchy (`OMARCHY_PATH`
`~/Projects/omarchy/core`, shell `4.0.0.alpha`) and against the packaged
`/usr/share/omarchy` and the plugin lab's pin `b5589fa`, all three the same
on every point below.

| Measurement | Value |
| --- | --- |
| What `omakit setup` checked after writing the completion script, before this | nothing: it reported "installed" and never asked a shell |
| Where Omarchy sources bash-completion | `default/bash/shell`, lines 8 and 9, sourced by `default/bash/rc`; not `init`, which sources fzf's and Omarchy's own `omarchy` completion |
| Since when | commit `5a8687b3`, 6 July 2025, "Enable bash-completion by default", first released in v1.2.0 |
| `bash-completion` in `install/omarchy-base.packages` | yes; 2.18.0 installed |
| The user directory bash-completion searches | `${XDG_DATA_HOME:-~/.local/share}/bash-completion/completions/` (`bash_completion` lines 3545 and 3676), where `setup` writes |
| A user hook directory that Omarchy's rc sources | none: `rc` sources `envs`, `shell`, `aliases`, `functions` and `init`; the skel `~/.bashrc` sources `rc` and says to add your own lines under it, so `~/.bashrc` is the file |
| `complete -p omakit` in a fresh interactive bash | `no completion specification` |
| `_comp_load omakit`, then `complete -p omakit` | `complete -F _omakit omakit` |
| `omakit we<TAB>` in a real pty | `omakit weigh `; `omakit su<TAB>` gives `submit`, `--cat<TAB>` gives `--category` |
| `complete -p omakit` after the first TAB | `complete -F _fzf_path_completion omakit`: fzf's wrapper, which delegates to `_omakit` |

So the premise that Omarchy never sources bash-completion did not hold on
any tree examined; the completion worked. What did not hold was the check:
`complete -p omakit` in a fresh shell is empty because bash-completion loads
a user-directory script on the first TAB and not before (`complete -D`
through `_comp_complete_load`), and after that TAB it names fzf's wrapper.
A check that asserted `complete -p` in a fresh shell would have reported a
working completion as broken on every stock Omarchy.

Consequences, in `tools/marketplace/completion-check.mjs`: the probe is an
interactive shell asked to load `omakit` the way TAB does (`_comp_load`,
then `complete -p`), and reports the loader (`_init_completion` defined) and
the spec (eager, lazy, none) separately; `setup` prints `▁ ok` only when a
new shell shows the spec; where the loader is absent (a `~/.bashrc` that no
longer sources Omarchy's rc, a zsh without `compinit`) it names what is
missing and asks once before appending one marked block to `~/.bashrc` (or
`~/.zshrc`), never otherwise; `omakit doctor` reports the same four facts as
`omakit.completion`; and the script's first line names the omakit version
and pin it was rendered from, so a script from another omakit is noticed at
startup, once a day, from one line. Measured while building the probe: a
stray `; ` before `&&` made bash refuse the whole `-c` string, and the
first real run reported "no loader" on this machine, which has one; the
probe now parses in every shell the suite can find.

Used by: `omakit setup`, `omakit doctor` (`omakit.completion`), `omakit
upgrade` (the completion step re-run through the new omakit), and the
startup notice in `cli.mjs`.

## M9. Open updates and documentation-only review

Measured on 2026-09-15, 13:54:05.710 to 13:54:50.758 UTC, against
marketplace HEAD `3d240d4dde4d148017792bac08720b9ac158d6a6`.
Command used, from the repository root:

```bash
node tools/marketplace/measure-review-cost.mjs > /tmp/omakit-review-cost-measurement.json
```

The [machine-readable capture](evidence/review-cost/2026-09-15.json) records
every compared pair, file count, compare API source URL and skipped reason.
Its population counts are:

```json
{
  "measurement": "M9",
  "date": "2026-09-15",
  "marketplaceHead": "3d240d4dde4d148017792bac08720b9ac158d6a6",
  "sample": false,
  "pluginUpdates": 307,
  "manualQueue": 140,
  "manualQueueShare": 0.4560260586319218,
  "docsOnly": 4,
  "compared": 139,
  "skipped": 1,
  "docsOnlyShareOfCompared": 0.02877697841726619,
  "docsOnlyShareOfManualQueue": null
}
```

All open `plugin-update` issues were discovered through paginated repository
issue reads, excluding pull requests. Of 307 updates, 140 (45.6%) carried
`security-review-required`. The entire labelled subset was attempted, not
sampled. Of 139 complete validated diffs, 4 (2.9%) were docs-only. One compare
returned 404 (issue #4295), so the exact docs-only share of all 140 is unknown:
the observed lower bound is 4/140 (2.86%), and the upper bound is 5/140 (3.57%).
An unavailable comparison is not a runtime change or a zero-file diff.

The latest issue baseline marker is parsed by the pinned marketplace code.
The previous commit is the most recent different, dated validation record
no later than that marker: an earlier issue marker, a registry listing or
listing-history record, or the catalog's `upstreamValidatedCommit` and
`upstreamValidatedAt`. The registry and catalog are read at the same HEAD.
The compare API must report a forward, complete file list below its 300-file
limit. Docs-only means a nonempty diff whose paths are all under `docs/`,
Markdown, `LICENSE`, or image files; renames qualify at both ends. This
classifies paths, not the content or effect of documentation. A missing
previous record is skipped with a reason, never replaced with a Git parent
or the author's description. Issue labels and comments are live reads during
the dated window, not immutable data at the registry commit.

M4 explains the mechanism: the baseline scans the whole snapshot's
capabilities, not the update diff. M9 measures how often documentation-only
changes are present in that queue; it does not measure minutes spent by a
maintainer or establish a marketplace rule. The account's earlier badge-only
description is not substituted for compare results against recorded validated
commits.

Used by: advisory `review.cost` in `omakit submit`, and the review-cost summary
in `omakit watch --all`. No issue, comment or label was written.

## C1. Weigh noise floor

The figures behind `omakit weigh` are the measurements themselves and their
noise floor, not a population statistic, so this entry is a different kind
of evidence from M2 to M7: three runs of `tests/lab/weigh.sh` in the Omarchy
plugin lab guest (stock pin `b5589fa`, shell `4.0.0.alpha`, one 1280x800
screen, software rendering) on 14 September 2026, each `omakit weigh --all
--runs 5 --yes` over the four fixtures under `tests/fixtures/weigh/` and three
listed plugins (`bjarneo.workspace-layout`, `omaplug`,
`io.github.calebhat.weather`), 40 restarts per run, `shell.json` md5
`2caeda7f4da844a0d51b045ae5652346` before and after every run, no backup
left behind, every document valid against `tools/weigh/contract.mjs`. The
documents are under `docs/evidence/weigh/`, with the earlier bash audit's run
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

What holds across all three runs: the 180 ms timer weighs 2.7 to 2.8% CPU
(run 3: 2.73, 2.40, 2.66, 2.73, 2.73) against a CPU floor of one or two
clock ticks over the window (0.067 to 0.133%), the clean fixture is within
noise on both and the report says so in those words, the poller's
`inotifywait` (4.1 MB) and workspace-layout's two watchers (8.2 MB) are
attributed by command line in every run, and the three listed plugins have
memory medians of 9 to 21 MB in every run against fixture medians of -12 to
14. What does not hold: at five runs, no plugin's memory median clears a
32 MB floor, and the memory column is a fact about the shell's start rather
than a plugin's weight until C2 is understood, so the README sentence
speaks about CPU and child processes and not about memory at all.

Pairing by resting level, tried offline and not adopted. On 15 September
2026 every restart of the two traced runs was classified by its resting
level, the minimum `Pss` of its trace (two-means over the 40 levels of each
run: centres 529.9 and 554.9 MB in run 3, 528.4 and 543.3 in run 2), and
every plugin delta was recomputed against baseline runs of the same level
only. The floor within the low level is 7.27 MB at the settle and 7.41 MB
at the trace minimum in run 3 (five baseline runs), and 15.46 MB in run 2
(four), so a same-level floor does land near the 8.67 MB first seen within
a level. It cannot be used, for a reason the classification itself shows:
**the high level was never seen in a baseline restart**, 0 of 10 across the
two runs, and was seen in 19 of 70 plugin restarts, 7 of `omaplug`'s 10,
6 of `bjarneo.workspace-layout`'s 10, and 6 of the other five plugins' 50.
There is no high-level baseline to pair a high plugin run with (in run 3,
`omaplug` had no same-level peer in any of its five runs), and pairing
would treat as noise a level that appears only when a plugin is present,
which is the opposite of what a weighing may do. Within the low
level the same-level deltas are what the medians already say (run 3, at
the settle: fixtures -1.9 to 2.7 MB, `io.github.calebhat.weather` 10.2,
`bjarneo.workspace-layout` 10.3, spreads 4 to 11 MB), so the low-level
figure is not wrong; it is the high level that is not understood. Until it
is (C2), memory stays a fact about the shell's start, not the plugin's
weight, and interleaved or per-level runs are not implemented. The
classification script's inputs are the three traced documents under
`docs/evidence/weigh/` and nothing else.

CPU quantum. The CPU floor is one or two clock ticks over the 15 s window,
and a delta is quantised to ticks too: run 1 judged `fixture.idle-panel`
above noise on CPU with a median of -0.066662% (one tick over 15.003 s)
against a floor of 0.066653% (one tick over 15.005 s). The rule is now that
a CPU delta is above noise only when it exceeds the floor and one tick over
the window (`docs/WEIGH.md`); under it the same row is within noise, and no
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

Used by: `omakit weigh`, its confirmation, and `docs/WEIGH.md`. Not by any
`submit` check.

## C2. The shell's memory after a restart has two levels and two events

Shell behaviour, measured while lowering C1's floor, and recorded here as a
candidate for an upstream report; `omakit weigh` does not correct for it, it
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

The consequences for `omakit weigh` are the 30 s settle (the window sits
after the release), the trace kept in every document (a machine whose
release comes later shows it), and memory reported as the shell's own
startup variance rather than as a plugin's weight (C1), because the high
level is not understood.

What is known about the high level, from the traces alone: it was never
seen in a baseline restart (0 of 10) and was seen in 19 of 70 plugin
restarts, concentrated on `omaplug` (7 of 10) and `bjarneo.workspace-layout`
(6 of 10), which are the two plugins that do the most at start (an update
check spawned per bar instance; two `inotifywait` watchers and a service).
The guest's journal was not captured in these runs, so what follows is a
hypothesis, not a finding, in the order it would be tested:

1. A bar rebuild after start. Any change to `bar.layout` rebuilds every
   widget on every monitor, and the first such rebuild cost 19 MB on the
   installed shell with nothing returned afterwards (`docs/WEIGH.md`,
   Limits). A plugin that writes `shell.json` as it starts, to persist a
   setting, would trigger one. Test: `configRewritten` per sample
   (recorded from the next run on), and `Handler was registered but will
   not be used` in the shell's journal, which a rebuild logs for every
   widget with an `IpcHandler`.
2. A plugin reload after start. A `close_write`, `create`, `delete` or
   `move` anywhere under `~/.config/omarchy/plugins/` except a `.git/` or
   a hidden entry makes the registry rescan 150 ms later and re-instantiate
   every plugin into a new runtime generation (`PluginRegistry.qml`,
   `localPluginWatcher` and `localPluginIdForPath` at the pin), and memory
   is not returned on unload. `omaplug` writes its state under
   `$XDG_RUNTIME_DIR`, not the plugin tree, so no trigger has been found
   yet. Test: the generation directories under
   `$XDG_RUNTIME_DIR/omarchy/plugin-runtime/` after a run (one per rescan),
   captured by the lab scenario from the next run on.
3. A race between the 55 to 65 MB release and a plugin that is still
   initialising: a release that lands while a plugin is mid-load could be
   smaller or skipped. Test: the moment of the release in each high-level
   trace against the plugin's own start-time work, from the journal.

The lab scenario now copies `journalctl --user -t omarchy-shell` and the
generation listing next to the document, so the next cycle can settle 1
and 2 without a fourth kind of run. A report to the shell's maintainers,
`docs/evidence/weigh/upstream-memory.md`, carries the three observations,
the traces and the reproduction, and is a draft a person files.

## Passive npm update notice (0.4.0, 15 September 2026)

The check has a 1,000 ms wall-time network budget, limiting the first normal
terminal invocation's added wait to one second. Successful checks and notices
are throttled for 24 hours; an unavailable registry retries after one hour.
These are explicit latency and request budgets, not inferred network speed.
There is no process or background polling after an invocation exits.

The live public-registry check with installed version 0.2.0 returned the
published version 0.3.0 in 360 ms, emitted the upgrade notice, and wrote 81
bytes of version/time metadata in disposable state. Repeating the invocation
returned no notice and made no second registry request. The timeout regression
uses a never-resolving registry with a 20 ms injected budget, verifies abort,
and requires completion below 500 ms to allow test-runner scheduling.
`tests/unit/update-check.test.mjs` also proves daily/hourly boundaries, changed
install versions, unavailable state, prerelease precedence and skipped modes.

## Responsive output (0.4.1, 15 September 2026)

Real pseudo-terminal captures of the full help command measured 180 lines at
40 columns, 122 at 60, 95 at 80, 85 at 100, and 75 at both 120 and 160.
The 120-column cap is an explicit reading-width choice; wider terminals retain
that width. Tests compare every word and syntax fragment across all six
widths, compare colour/plain output, and execute the real command at 40 and
120 columns. Exact URLs, paths and commit identifiers stay whole even if
one atom exceeds the room in a very narrow window.

Captured help at 60 and 120 columns was visually inspected using JetBrains
Mono Nerd Font and the current terminal's palette (background #121212,
foreground #bebebe, typeable #e68e0d and placeholder #b91c1c). Signature
continuations align at six columns, paragraphs wrap at the selected width,
and the wider capture shows the same content in fewer lines. A separate
20-column test proves the compact logo uses no cursor animation. Pipes and
file output use the stable 80-column geometry; JSON and verbatim issue and
marketplace sections are not reflowed.


## M10. README evidence and command captures

Recorded on 2026-09-15, package 0.4.1, local revision `4a29230`.
The [machine-readable record](evidence/readme/2026-09-15.json) ties each
README capture count to its unedited ANSI file, and records GIF sizes,
durations, dimensions and the before/after word count. Commands and renderer
versions are in [media/README.md](media/README.md#refreshed-command-captures-2026-09-15).

```bash
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit watch --all > docs/media/captures/watch-all.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit audit > docs/media/captures/audit-drift.ansi 2>&1
FORCE_COLOR=1 DISABLE_UPDATE_NOTIFIER=1 env -u NO_COLOR ./bin/omakit weigh --list > docs/media/captures/weigh-list.ansi 2>&1
```

The author's account had 5 checked issues, all CURRENT, with 2 human discussion
records. Four were update issues in the manual queue; 2 of their 4 complete
validated comparisons were documentation-only. This is the account snapshot,
not M9's marketplace population. CURRENT compares HEAD with the validated
commit and does not imply approval. The desktop had 55 installed plugins,
37 excluded first-party entries and 18 audited entries: 9 validated and 9
drift, matching A1's counts. Audit exited 1 and printed checkout suggestions;
none were executed. The list read 55 installed plugins, 47 enabled and 1
previously weighed; its single recorded run explicitly lacked spread and a
noise floor. No weighing or shell restart was performed for this capture.

The 30-of-30 baseline parity figure is the existing 2026-09-12 run in
[evidence/parity/2026-09-12-local-vs-github-2.json](evidence/parity/2026-09-12-local-vs-github-2.json):
0 mismatches and 0 failures across 18 passed, 8 review-required and 4
needs-fixes subjects at marketplace pin
`38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6`. It was not rerun for this
README rewrite and does not assert parity for every future marketplace pin.
M6 and M7 retain their original dated population and churn measurements.

The README features 5 GIFs from committed real-output captures: the existing
banner and refusal fixture, plus the 3 refreshed account/desktop runs.
Pillow decoded every frame; durations are the sum of frame delays and sizes
are file byte counts. The new GIFs use the unchanged scene renderer, which
reveals lines and visibly annotates omissions; it does not alter captured
output. These captures and the repository's read-only source check record
0 marketplace writes. The submit refusal is a reproducible fixture, not a
new run of the author's plugin. Rendering fidelity and read-only checks are
not a claim that the baseline proves a plugin safe.


### M10 second-pass package facts, 2026-09-15

`package.json` at 0.4.1 has 0 entries in `dependencies` and 0 in
`devDependencies` (both absent). Count command:

```bash
node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json")); console.log(Object.keys(p.dependencies || {}).length, Object.keys(p.devDependencies || {}).length)'
```

The same package declares `engines.node` as `>=22` and `license` as `MIT`.
Omarchy Quattro is the target shell contract, not a benchmark result. The
refusal capture ends with 3 blocking checks. Submit's issue title/body are
assembled by `tools/marketplace/issue.mjs` and printed when readiness allows;
0 marketplace writes is the source-check evidence recorded in M10.


### M10 completed desktop weighing and final screens, 2026-09-15

The [second-pass machine-readable record](evidence/readme/2026-09-15-second-pass.json)
records current GIF hashes, sizes, durations, scene widths, maximum shown
line lengths and identical-frame final holds. It also records package facts
and the README word count. The earlier same-day record remains historical.
The [completed desktop weighing](evidence/weigh/desktop-2026-09-15-omadock.json)
ran 3 baseline and 3 plus-one samples on the author's desktop, at the default
30 s settle and 15 s window. Baseline median: 535.55 MB Pss and 1.53% CPU.
Baseline spread: 8.80 MB Pss and 0.33% CPU. Omadock completed all 3 pairs
with no measurable shell CPU above that floor. Memory remains a shell fact,
not an attributed plugin weight; C1 and C2's caveats still apply. The config
was restored with equal before/after md5, and the shell answered afterwards.
Full commands, cuts and renderer versions are in [media/README.md](media/README.md#second-pass-final-screens-2026-09-15).

## M11. What the human review raises, by class

The automated baseline decides whether a person has to look (M4). This entry
is about what that person then says. Thirty issues with maintainer review
comments were read on 2026-09-12, every review in the sample written by the
same maintainer: issues 4405, 4404, 4403, 4402, 4393, 4392, 4390, 4385, 4380,
4375, 4370, 4365, 4360, 4350, 4340, 4330, 4320, 4310, 4300, 4280, 4260, 4240,
4220, 4200, 4150, 4100, 4050, 4000, 3900 and 3800, about 88 findings raised
by the maintainer. Each finding was put in one class by one reader, going by
the reviewer's own wording. The [record](evidence/inspect/2026-09-12-review-classes.json)
carries the sample, the classes and the reviewer's requirement for each in
paraphrase.

| Class | Share of findings | The requirement, in the reviewer's terms |
| --- | --- | --- |
| process lifecycle | about 20% | absolute deadline, cancel on destruction, process-group cleanup, no reaping of the leader before TERM then KILL |
| unbounded buffering | about 19% | byte and line bounds on the producer side; clipping after `onExited` does not count |
| file and state boundary | about 15% | private 0700 directory, no-follow descriptor, size cap, 0600 exclusive temp, atomic replace, no check-then-use |
| environment trust | about 7% | absolute helper paths instead of PATH resolution, minimal environment, `curl -q` |
| secrets | about 7% | never in argv, never in logs or notifications, protected at rest |
| supply chain | about 7% | pinned refs, checksums, no self-update from the network, provenance for bundled binaries |
| network egress | about 5% | HTTPS only, private addresses refused, redirect origin pinned |
| untrusted text to display | about 5% | `Text.PlainText`, control characters stripped, length bound |
| argument grammar | about 4% | argv only, strict grammar and length on values that reach a command |
| privilege disclosure | about 3% | `docker` or `input` group membership named as root-equivalent |

Two more figures from the same sample. Submissions that reached a human
review went through about two further push-and-re-review rounds on average,
range 0 to 4, so roughly three readings per plugin. And in 2 of the 30 the
automated baseline had passed the exact commit the reviewer then blocked,
which is the baseline documenting its own limit ("not a security review"),
not a defect; it means an author sees green today and still enters the
rounds.

Limits, stated. Thirty issues is a small sample and the shares are rounded;
they sum to 92 because a few findings fit no class. The classes are one
reader's, not the maintainer's taxonomy, and a maintainer who changes what he
looks for changes them. None of the classes is about what a plugin does; all
of them are about the plumbing between QML and the operating system:
starting, buffering, cleaning up, reading, writing, fetching, showing. That
is what makes them observable in the source at all.

Used by: the pattern rows of `omakit inspect`, each of which cites its class
here and prints the share beside it, and nothing else. `inspect` prints a
pattern only where the tree shows the class's precondition and never turns
the share into a verdict; a share says how often reviewers raised a class,
not how likely this plugin is to be blocked.

### What the extraction saw over 18 listed trees, 2026-09-15

The design note asks for `inspect` over the third-party trees `omakit
audit` lists on the author's desktop before the release. The run recorded
in [evidence/inspect/2026-09-15-listed-sample.json](evidence/inspect/2026-09-15-listed-sample.json)
was made on a machine with no Omarchy desktop, so its sample is the first 18
distinct repositories in the pinned catalog's order whose listing is
community, laid out as a root plugin and carrying a validated commit, each
fetched read-only at that commit in reviewer mode (pin `38060f89`). Totals:
515 process sites, of which 57 are QML `Process` blocks and 458 are shell
lines, 17 hosts, 63 writes, 40 timers, 15 `▒ ?` rows and 73 pattern rows;
17 of the 18 trees printed at least one pattern row and one tree showed no
fact of any kind. The shell lines dominate because a script contributes one
site per command segment and two trees carry several scripts; that is the
count of what the extraction saw, not of what the plugins do, and the report
says the two apart on its processes line and its closing line. The record
was re-read twice from the reviewer-mode cache, with no fetch: once to add
the split, holding every other count equal, and once after the shell reader
learned to keep a `$(...)` assignment and a multi-line quoted program whole
and to read `command: []` through the assignment to the block's id, which
took the shell count from 932 to 458 lines and the writes from 104 to 63,
and moved five trees' pattern rows; the first run's totals stand in the
history of this file. The record's
rows carry no repository and no commit: the selection rule above reproduces
the set from the pinned catalog, and per-tree observations about named
third-party plugins are not published as a list, the same line the
review-class sample holds. Any regeneration keeps it that way. No plugin is
named for it in the README. The record replaces nothing and is replaced by a
run over the desktop set when one is made.

## M12. How long a plugin's functions are, in listed trees

Measured 2026-09-16 over the first 50 distinct repositories in the pinned
catalog's order whose listing is community, laid out as a root plugin and
carrying a validated commit (the `inspect` record's selection rule of
2026-09-15, widened from 18 to 50), each fetched read-only at that commit
in reviewer mode, re-measured the same day after three extraction fixes,
and again after four more (both below). The run is reproducible:

```bash
node tools/inspect/measure-functions.mjs   # writes docs/evidence/inspect/<date>-function-lengths.json
```

`extractFunctions` in `tools/inspect/functions.mjs` found 6034 functions: a
`function name(`, a named arrow function (`const load = (rows) => {`,
`this.load = rows => {`), a method shorthand `load(rows) {` inside an
object literal or a class, or a multi-line `onSomething: {` handler in QML
and JavaScript; a `name() {` or `function name` block in shell; a `def` in
Python. For each, the length in lines from its first line to its last, the
deepest nesting below its body, and the branches in it (`if`, `else if`,
`for`, `while`, `switch`, `case`, `catch`, `&&`, `||`, `?:` and their shell
and Python equivalents). Shell and Python shapes that are data or a
continuation are read as such rather than as control flow. In shell, a
`||` or `&&` followed by one flow word (`return`, `exit`, `continue`,
`break`, `true`, `false`, `:`) with an optional status (a number, `$?` or
a variable) and nothing else on the line but a `;` or the `;;` that ends a
case arm is a guard and not a branch, so `[[ -f $x ]] || return 1` counts
0 and `x || returns` counts 1; the body of a heredoc up to its delimiter
alone on a line, and a quoted string that spans lines (an awk or Python
program in single quotes, a remote command in double quotes) from its
opening quote to the line that closes it, count toward the length and
toward nothing else; a case arm is a `)` with text after it on a line
with no `(` before it but its own, so `$(...)` in a test is not one; a
block opens with `if`, `for`, `while`, `until`, `case` or `select` at the
start of a line and closes with `fi`, `done` or `esac` anywhere a
statement can start, so `if x; then y; fi` on one line is a branch and no
level. A `$(...)`, `${...}` or backtick substitution nested in a string
reads its own quotes, and one that spans lines is shell and read as
shell. In Python, a line that starts
while a bracket is open, inside a triple-quoted string, or after a line
ending in a backslash is a continuation of the statement above it, and a
def's parameter list spanning lines is a continuation of the def: it
counts toward the length and the branches and never toward nesting; a
bracket or backslash continuation ends at the first line at the def's
indent that is not a closing bracket, a triple-quoted string at its
close. Branch words inside strings, docstrings and comments are prose,
and a `def` quoted in a docstring is not a function. The quantiles are
nearest-rank over all 6034 pooled:

| | p50 | p75 | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| lines | 7 | 13 | 25 | 41 | 495 |
| branches | 1 | | 6 | | 85 |
| nesting | 0 | | 2 | | 7 |

The [record](evidence/inspect/2026-09-16-function-lengths.json) carries,
per tree and without repository or commit, the function count by kind, the
longest and median length, the lines inside every function
(`functionLines`), the lines inside functions over any p90 threshold
(`heavyLines`) and their ratio (`heavyShare`, `null` for the one tree with
no function: a tree with nothing to measure did not measure light, and a 0
there would lift every other tree's rank); the histogram of each measure;
and the method. Three trees hold nearly half the functions
(1,130, 1,083 and 619, QML and Python), which the pooling takes as it is: a
listed function is a listed function whichever tree it is in. Of the 49
heavy shares, 6 are 0 with functions in the tree and stay, the median is
0.39 and the largest 0.84.

Three earlier records are in the file's history. The 0.5.0 record (commit
`7df451a`; 6041 functions, p90 22 lines, 6 branches, nesting 2, nesting
max 18, branches max 87, six shares of 0 among 50) carried four kinds of
noise, each measured on one listed plugin's main branch before the fix: a Python function whose
multi-line call sat inside a `for` and a `try` read as nesting 3 from the
arguments' indentation, over the p90 of 2; a 36-line shell function whose
body is a Python heredoc read as 9 branches and nesting 4 from the
Python's `if`, `for` and `with` lines, and an awk program in single quotes
the same way; a 233-line shell function of `|| return 1` guards read as
131 branches, 5 after the fix; and the tree with no function sat in the
sample as a share of 0. Two more, found while reviewing the fix: a `def`
whose parameter list spans lines was read as its signature only, the
signature's lines at depth 0, so a 217-line `send` in a vendored library
counted as five; and `and`, `or` and `if` inside a docstring's prose
counted as branches, and a `def` quoted in a docstring's example counted
as a function, seven of them in that library. Reading such a def through
to its body is what moved the line p90: 178 Python functions in the
sample grew, none shrank, and the seven quoted defs are gone, most of
this in the one tree that vendors that library (1,083 functions), so the
line p90 went from 22 to 25 while branches stayed at 6 and nesting at 2.
The nesting max fell from 18 to 7 and the branches max from 87 to 85. The 0.4.3 record (commit
`6619c26`; 50 trees, 6040 functions, p90 22 lines, 6 branches, nesting 3)
was made with three extraction faults, each of which moved a measure
without the code changing shape, so it was re-measured rather than kept: a
Python body counted as depth 1 and one `if` as depth 2, where a shell or
QML body starts at 0, so a five-line Python function with one `if` ranked
above 75 of 100 listed functions; a brace that opens an object or array
literal counted as a nesting level, so a `return { a, b }` spread over
lines was nesting; and only `function name(` and `onSomething: {` were
functions, so a named arrow function or a method shorthand, which is where
a `*Model.js` keeps its logic, was invisible. The first record over 18
trees (715 functions, p90 18 lines, 7 branches, nesting 2) is behind it.
The nesting p90 moved from 3 to 2 with those fixes; the line and branch
quantiles did not move. Limits, stated: a function is still what a regular
expression recognises, so an anonymous callback, a method whose parameter
list spans lines and a shell function declared on one line are not
counted; the literal test reads the text before a brace and is not a
parser; the shell line scanner tracks quotes, `$(...)` inside quotes, a
comment start and the first heredoc on a line, so a second heredoc on
the same line is read as shell, a delimiter the regular expression does
not name (`<<!`) is not seen, and a heredoc whose delimiter never comes
(a syntax error in bash) runs to the end of the file; a Python bracket
continuation cannot run past a statement at the def's indent, so a
miscounted bracket ends the function early rather than late, while a
triple-quoted string never closed runs to the end of the file; the
sample is 50 trees and the p90 is one number from them.

`tools/inspect/patterns.mjs` carries the same three histograms and the 49
heavy shares as data, held equal to the record by the unit tests, so a
function's rank and a tree's position can be read without the document: a
function's rank is the share of listed functions with a smaller value, 0
for the smallest listed value and 100 for one over every listed value, the
largest of the three being the function's rank; a tree's rank is the share
of listed trees with a share and a strictly smaller one, so the report
says the tree is "no heavier than N of 49 listed trees": a tie is level,
not lighter, and the 49 is the count of listed trees with a share.

Used by: the `long functions` block of `omakit inspect`, which lists a
function when it is over the p90 of any of the three (25 lines, 6 branches,
nesting 2), longest first, each with its rank, and says so in its heading;
and the size score, 10 minus the tree's rank divided by ten, two decimals,
printed under the baseline line. The score is line-weighted on purpose. The
0.4.3 score was 10 minus the mean rank of the tree's functions, which
weighed ten small functions the same as one huge one, so every
decomposition raised the mean: on a listed plugin of 332 functions scoring
3.75, splitting a 12-function shell script into 35 single-purpose functions
left it at 3.75 and splitting an 84-line, nesting-5 Python function into
eight named steps lowered it to 3.72. Under the heavy share those lines
leave the heavy set, so the split raises the score, and twenty three-line
functions added beside a long one barely move it, which `tests/unit/inspect.test.mjs`
holds. A tree with no function over the thresholds scores 10.00, a tree
heavier than every listed tree 0.00. It is a position among listed plugins
and never a grade of one; a tree with no function has no score. The person
who asked for the tool asked for long functions first, so the default view
puts that block before the review classes; that order is a preference and
the report names the measurement, not a severity. `--json` carries every
function under `observed.functions`, the ones over the thresholds under
`size.over`, the tree's share under `size.heavyShare` and the listed trees'
shares under `size.sample.heavyShares`.
