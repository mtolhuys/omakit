# Marketplace boundary and integration

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

**The submitter is.** Of the 464 submissions parked in the author's own court,
roughly 339 contain code the marketplace has never seen, and 77% never produce
the fresh validation that would revive them. The failures are mechanical: a title
prefix, a heading, a stale pin. That is the work this tool removes, and it
removes it before a person is involved at all.

The one thing it plausibly saves the maintainer is measurable and small: the
staleness paragraph he has written by hand on 358 issues, roughly 5.5% of his
total review writing, plus the first read on code that was already out of date,
which was 19% of the parked sample. That is the honest size of it.

## Where this tool helps

| Pain, measured | What this tool does |
| --- | --- |
| 39 submissions fell out on the title prefix alone; 11 more are malformed in the body, one by a single word | Generates title and body from the pinned form and has the marketplace's own parser judge them before anything is posted |
| 1,226 of 2,990 listings needed a human to look because of a capability | Runs the official baseline locally on the exact commit first, and says which capability triggered it |
| 103 issues mention agent-control files, and no automated check reports them | Refuses to submit a tree that contains one, with the exact paths and the remedy |
| 73% of parked submissions have a HEAD the marketplace never saw | A read-only pin watch that names the one action which refreshes the review pin |

Full figures and method: [MEASUREMENTS.md](MEASUREMENTS.md).

## Verified integration seam

At marketplace commit `38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6`
(`Add Plugin updates plugin (#6374)`, baseline version 3, enforcement mode
`selective`, marker protocol 4):

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
