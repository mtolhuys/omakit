# `omakit watch`: the review pin

```
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
```

Reads one submission issue and answers one question: is the commit the
marketplace validated still the commit the repository is on?

## The mechanism

When a submission is validated, the review is pinned to one exact commit. The
only action that moves that pin is **editing the issue body**.

- `route-issue-automation.yml` is the only workflow with a direct `issues`
  trigger: `types: [opened, edited, reopened, labeled, unlabeled]`.
- There is no `issue_comment` trigger anywhere in the marketplace. A comment
  triggers nothing.
- `refresh-catalog.yml` does compare branch HEADs on a daily cron, but only for
  plugins that are already listed, and it does not rerun the snapshot security
  baseline. Open submissions fall outside it.

So pushing a fix does nothing, and commenting "fixed in `abc123`" does nothing.
Both feel like progress and neither is.

## Why this is the centre of the tool

Of the 464 submissions parked in the author's own court, 73% have a
default-branch HEAD ahead of their validated commit. 47% pushed after the
maintainer's review without the marketplace ever seeing it, and 82% of those
authors also commented, so they are engaged and stuck, not gone. Of 13 open
submissions inspected with no labels left, 9 had passed validation and passed the
automated security baseline with zero findings, and were blocked solely because
the pin had gone stale while they waited. 46% of the maintainer's own requests
for a fresh validation never produced one; in the parked group, 77% never did.

The instruction that would fix this exists. `scripts/submission-feedback.mjs`
contains "edit the issue" 22 times, every one attached to a deterministic
failure. `scripts/validate-submission.mjs` builds the success comment and
contains it zero times, and the success path is the path 97 of 100 parked
submissions took. Full figures and method in [MEASUREMENTS.md](MEASUREMENTS.md).

## What it reads, and what it will not do

It reads the issue, its comments, and the plugin repository's current
default-branch HEAD. The validated commit is not scraped out of prose: it is
parsed with the marketplace's own `findLatestSecurityBaseline` and
`parseSecurityBaselineMarker` from the pinned commit, so the commit compared is
the one the marketplace itself attested. When no marker exists, the short commit
from the validation comment is reported as what it is, too short to compare
reliably, rather than guessed at.

It never edits the issue, never comments, never labels, never opens a pull
request. The one action that refreshes the pin is the author's to take, and the
command says so in the marketplace's own register.

With `GITHUB_TOKEN` set it reads the default branch through the REST API. Without
one it falls back to the repository's public commit feed, which does not consume
the 60-requests-per-hour unauthenticated allowance. The token is read from the
environment and never written anywhere.

## Verdicts

| State | Meaning | Exit |
| --- | --- | --- |
| `current` | The pin is the current default-branch HEAD. Nothing to do. | 0 |
| `stale` | The marketplace has not seen the newer commit. Editing the issue body is what refreshes it. | 0 |
| `unknown` | No validated commit to compare, an incomplete baseline, or an unreadable HEAD. Never reported as `current`. | 2 |
