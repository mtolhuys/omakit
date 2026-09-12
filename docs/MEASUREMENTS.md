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
| Registry figures | `registry.json` and `site/catalog.json` at the pinned marketplace commit, recomputed by this repository's own tests. |

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

## M3. Agent-control files are blocked by a human, and nothing warns first

| Measurement | Value |
| --- | --- |
| Issues mentioning agent-control files | 103 |
| Sampled maintainer review comments about them | 24 of 328 |
| Detected by the marketplace's automated baseline | no |

An instruction file inside an installed plugin is treated as a prompt-injection
surface, and listing is blocked on it. Because no automated check reports it, an
author learns about it from a human review round, which is the most expensive
round there is.

Used by: `tree.agent-control`. The check is recursive over the installable tree
and matches `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.mcp.json`, anything under
`.claude/` or `.codex/`, and instruction files under any `skills/` directory.
Matching is case-insensitive on the basename, because an agent reads `agents.md`
as readily as `AGENTS.md`.

This is an Omakit check derived from public issue text. It is not marketplace
policy and does not claim to be; its verdict is labelled `omakit`, not
`marketplace-pin`.

## M4. The baseline decides whether a human has to look at all

From `registry.json` at the pin, across 2,990 listings:

| Outcome | Count |
| --- | --- |
| `passed` | 1,697 |
| `review-required` | 1,226 |
| `needs-fixes` | 20 |
| Findings ever recorded, total | 21 (`curl-pipe-shell` 11, `remote-git-execution-unpinned` 10) |

Capabilities recorded: installer 516, privilege 489, package-manager 472,
service-management 386, remote-build 370, bundled-executable-binary 32,
sudoers-modification 23.

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
`registry.json` at the pin by `tests/unit/contract.test.mjs`'s neighbours; it
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
