# Marketplace boundary and integration

This page is the boundary: what the Omarchy Plugin Marketplace already does,
what this tool does instead, and where the two meet. It exists so that no
claim in the other pages can be read as a claim about the marketplace, and so
that anyone weighing whether this tool is worth anything can see the honest
answer rather than the flattering one.

## Why this matters, stated honestly

The Omarchy Plugin Marketplace (`omacom/omarchy-plugin-marketplace`, served at
plugins.omarchy.org, MIT licence) already automates a lot: structured submission
forms, deterministic manifest and repository validation, an exact-commit static
security baseline with `passed`, `review-required` and `needs-fixes` outcomes,
author feedback, guarded approval and update workflows, and catalog publication
after an authorised decision.

What it cannot automate is the human decision, and that decision is where the
real cost sits. It is worth being precise about who this tool helps, because the
obvious claim is the wrong one.

**The maintainer is not the main beneficiary.** His review writing barely
repeats: across 328 of his review comments, no seven-word fragment recurs in
eight or more issues, and 18 of roughly 53,000 comment pairs reach 0.25
similarity. There is nothing to codify and no template to pre-empt him with. His
median time from submission to publication is hours, not weeks, and the queue
that waits on him is a median half a day old. A tool that claimed to unblock him
would be selling something.

**The submitter is.** On 2026-09-15, 326 of 519 readable author-fixes
submissions had stale validated commits; 64 of 583 issues were unknown. The failures are mechanical: a title
prefix, a heading, a validated commit that fell behind. That is the work this tool removes, and it
removes it before a person is involved at all.

The one thing it plausibly saves the maintainer is measurable and small: the
staleness paragraph he has written by hand on 358 issues, roughly 5.5% of his
total review writing, plus the first read on code that was already out of date,
which was 19% of the parked sample. That is the honest size of it.

## Where this tool helps

The measurement that changed the tool's direction on 2026-09-17: over one
week of review, one reviewer wrote 1,001 security blocker comments, and
most of them ask for the same plumbing. 587 raise a line of a bounded
process runner, 527 a line of a private state file, and a runner plus a
store handles at least one blocker in 777 of the 1,001, an upper bound in
the sense that "handles" means the comment raises that plumbing, not that
the comment is resolved
([M13](MEASUREMENTS.md#m13-what-the-review-blocks-on-over-one-week-of-comments-and-which-of-it-a-block-can-own)).
So the tool now hands the submitter that plumbing first, as two blocks the
plugin copies into its own tree (`omakit add run`, `omakit add store`,
[BLOCKS.md](BLOCKS.md)), and keeps the checks for the rest. The blocks
implement what the review wording asks for and say so with the count per
line; they never present themselves as the marketplace's rules, and no
reviewer has yet looked at a plugin that uses them.

| Pain, measured | What this tool does |
| --- | --- |
| 587 of 1,001 security blocker comments in one week raise a process line: an absolute path, a closed environment, a deadline, an output cap, a group ended, argv not a shell string | `omakit add run`: a tested Run block, measured on a real shell and on the stock guest, that does all of it by construction; `inspect` shows each `Run {` site with its deadline |
| 527 of the same 1,001 raise a state line: no-follow, no check-then-use, an atomic replace, owner and mode checks, a size cap, a schema | `omakit add store`: a Store block carried over from a cache transaction the same review read without a further comment |
| 39 submissions fell out on the title prefix alone; 11 more are malformed in the body, one by a single word | Generates title and body from the pinned form and has the marketplace's own parser judge them before anything is posted |
| 1,215 of the 2,916 listings with a recorded baseline needed a human to look because of a capability | Runs the official baseline locally on the exact commit first, and says which capability triggered it |
| 103 issues mention agent-control files, and no automated check reports them | Names every one in the tree with the remedy, as a warning: the marketplace lists plugins that ship them, so it never refuses on it |
| The 2026-09-12 sample found stale validation in 68/93 readable issues | A read-only validation watch that names the one action which re-runs validation |

Full figures and method: [MEASUREMENTS.md](MEASUREMENTS.md).

## Verified integration seam

At marketplace commit `70dcc454e9178b8a12e4ebf1be928621fd3e7735`
(`Add LookAway plugin (#7750)`, baseline version 3, enforcement mode
`selective`, marker protocol 4; first verified at `38060f89`, re-verified at
this commit on 2026-09-21):

- `scripts/security-baseline-scanner.mjs` exports
  `runSecurityBaseline(repoUrl, commitSha, options)`.
- `scripts/security-baseline-scope.mjs` exports
  `resolveSecuritySnapshot(repoUrl, commitSha, options)`, which uses
  `options.fetchImpl` when provided (falls back to `globalThis.fetch`) for
  every GitHub REST request: repository metadata, commit, recursive tree and
  file contents.
- `scripts/security-baseline-analysis.mjs` exports the pure analysis
  `buildSecurityBaseline({ repository, repoUrl, commitSha, files }, options)`,
  plus `detectUnsafeRemoteExecution` and `detectElevatedCapabilities`.
- The marketplace's own tests use mock `fetchImpl` transports
  (`test/security-baseline.test.js`), so the seam is exercised upstream.

Conclusion: the complete official baseline, including snapshot scoping and
limits, can run against a local commit by supplying a transport that answers
those GitHub requests from the local Git object database. No network, no
credentials, no mutation and no copied policy.

## Boundaries

The adapter rules, the pin-update procedure and the boundaries that never move
live in [UPSTREAM_CONTRACT.md](UPSTREAM_CONTRACT.md), next to the seam they
govern.

One of them is worth repeating here, because it is the reason this repository
exists as a separate thing: Omakit is read-only against the marketplace at all
times, and nothing in this tool asks the marketplace maintainer to install,
configure or read anything. It is a tool for the submitter. Anything offered to
the maintainers would be a separate proposal, designed with them, never a
unilateral change.
