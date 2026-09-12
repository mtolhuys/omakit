# omakit

**Everything knowable about an Omarchy Quattro plugin submission, before you
post it. And afterwards, why it is sitting still.**

![omakit submit refusing a plugin that ships agent-control files](docs/media/submit.gif)

```bash
omakit submit <plugin-repo> --category Widgets --tags bar,quickshell
```

Fifteen checks, each naming its source and, when it fails, the measured reason it
exists. A blocking failure produces no submission body at all, because a refusal
that still hands you the body is only a suggestion. The plugin above is fine
except that it ships instruction files an agent will read once installed: 103
marketplace issues mention exactly that, and no automated check reports it, so
today an author finds out from a human review round.

![omakit watch reporting that a review pin has gone stale](docs/media/watch.gif)

```bash
omakit watch <submission-issue-url>
```

That submission passed validation and passed the security baseline with zero
findings. It is stuck because the review is pinned to one exact commit, and the
only action that moves that pin is editing the issue body. Pushing the fix does
nothing. Commenting "fixed in `abc123`" does nothing. **73% of the 464
submissions parked in their author's court have a default-branch HEAD the
marketplace never saw.**

Agent-first: the expected user is a coding agent submitting a plugin on an
owner's behalf. Zero dependencies, plain ESM, one entry point, no build step.
Read-only against the marketplace, and it never posts anything.

## Install

Node 22 or newer, and `git`.

```bash
git clone https://github.com/mtolhuys/omakit
cd omakit
./bin/omakit pin      # fetches the pinned marketplace checkout into .cache/
./bin/omakit help
```

`GITHUB_TOKEN` is optional, read-only, and never written to disk.

## What it is doing

Nothing about the submission format is written down in this repository. The
title prefix, the six form headings in order, the nine categories, the thirteen
tags and the exact text of the five checklist items are all read from
`.github/ISSUE_TEMPLATE/submit-plugin.yml` in a marketplace checkout pinned to an
exact commit. The rendered body is then handed to the marketplace's own
`parseCurrentSubmission` from that same commit. If it accepts the body here, it
accepts it there, and no rule can drift.

The security baseline is the marketplace's own code, imported unmodified and run
over a local snapshot with no network. Omakit adds no rule, renames no outcome,
and never restates the result as a safety claim: the baseline does no data-flow
analysis and is not a security review, and the output says so in the
marketplace's own words.

Every check is labelled. `[marketplace-pin]` is the marketplace's rule, read from
the pin. `[omakit]` is this project's own check, derived from public issue data.
Those are not marketplace policy and do not claim to be.

## Why it exists

Four numbers, all measured on public marketplace data on 2026-09-12. Method,
limits and the rest of the figures: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

| Measured | Consequence |
| --- | --- |
| 39 submissions fell out on the title prefix alone, and 11 more are malformed in the body, one by a single word | the format is generated from the pinned form and judged by the marketplace's own parser |
| 1,226 of 2,990 listings needed a human to look, because of a capability | the official baseline runs locally on the exact commit first, and names the capability |
| 103 issues mention agent-control files, which no automated check reports | submit refuses the tree and prints the paths and the remedy |
| 73% of parked submissions have a HEAD the marketplace never saw; 46% of the maintainer's own revalidation requests never produced one | a read-only pin watch that names the one action which refreshes the review |

It does not claim to unblock the maintainer. His review writing barely repeats,
his median time from submission to publication is hours, and the queue waiting on
him is a median half a day old. The honest size of what this saves him is the
staleness paragraph he has written by hand on 358 issues, roughly 5.5% of his
review writing. The rest of the benefit is the submitter's.
[docs/MARKETPLACE.md](docs/MARKETPLACE.md) states that in full.

## Evidence, not claims

```bash
npm test        # 60 tests, node --test, no dependencies
```

| Claim | Proof |
| --- | --- |
| The local transport produces the marketplace's own result | 30 of 30 identical, [docs/evidence/parity/](docs/evidence/parity/) |
| A local run touches no network | run inside `unshare -rn`, [docs/evidence/offline/](docs/evidence/offline/) |
| The generated body is well formed | the marketplace's own parser, `tests/unit/issue.test.mjs` |
| Nothing writes to the marketplace | `tests/unit/read-only.test.mjs`, over every source file |
| No agent-control file can reach a plugin | `tests/unit/self-containment.test.mjs` |
| The GIFs above are real output | captures and renderer in [docs/media/](docs/media/) |

Committed evidence records a digest of each side rather than the results
themselves: findings about a specific third-party plugin are not this project's
to publish.

## Documentation

| Document | For |
| --- | --- |
| [docs/SUBMIT.md](docs/SUBMIT.md) | every check and what it decides |
| [docs/PIN_WATCH.md](docs/PIN_WATCH.md) | the pin mechanism |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | every number, its method and its limits |
| [docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md) | the seam, the pin, the boundaries |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | who this actually helps |
| [AGENTS.md](AGENTS.md) | changing this repository |

MIT. Derived work built on public data from
`omacom/omarchy-plugin-marketplace`; not affiliated with or endorsed by that
project.
