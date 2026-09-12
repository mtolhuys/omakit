# `omakit watch`: the validated commit

```
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
```

Reads one submission issue and answers one question: is the commit the
marketplace validated still the commit the repository is on?

## The mechanism

The marketplace validates one exact commit, and the review that follows is of
that commit. The only action that makes it validate a newer one is **editing the
issue body**.

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
their validated commit had fallen behind while they waited. 46% of the maintainer's own requests
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
request. The one action that re-runs validation is the author's to take, and the
command says so in the marketplace's own register.

Authenticated it reads the default branch through the REST API. The credential
comes from your `gh` login, or from `GITHUB_TOKEN` if you set one, in that order
of preference and with the variable winning. Without either it falls back to the
repository's public commit feed, which does not consume the 60-requests-per-hour
unauthenticated allowance. Nothing is written anywhere: the credential is read
when a request is about to be made, used for GET, and discarded with the
process. `omakit doctor` names the source it found.

## Two real runs

Both verdicts, against real open submissions on 2026-09-12, verbatim. The
command does not print the author's login: the text rendering ends up pasted into
issues, reports and screenshots, and the login adds nothing that the repository
URL does not already say. It is still in `--json` for callers that need it.

```console
$ omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/4403
issue         https://github.com/omacom/omarchy-plugin-marketplace/issues/4403
state         open; labels submission, needs-fixes, security-needs-fixes,
              security-review-required
title         [Plugin]: One-Time Codes
plugin repo   https://github.com/fooblahblah/omarchy-otp

validated     de02fb5aa7243c0f84afa0442d16b50ba39144c1
              outcome passed, 0 finding(s), 0 capability/ies, checked
              2026-09-02T12:04:41.368Z
current HEAD  1ce9f4c189f78ad352915e868dd5a200fdeb006c
              main branch, via api, 2026-09-03T10:27:18Z

█ VALIDATION STALE  The validated commit is
                    de02fb5aa7243c0f84afa0442d16b50ba39144c1. The repository's
                    current main-branch HEAD is
                    1ce9f4c189f78ad352915e868dd5a200fdeb006c. The marketplace
                    has not seen the newer commit. Pushing it did not tell the
                    marketplace, and neither did any comment. The newer commit
                    landed after the last human review comment on this issue.

→ Edit the issue body. That is the only action that re-runs validation and the
  security baseline against a new commit: a push does not, and a comment does
  not.

Read-only. This command did not comment, label or edit anything. Comments on the
issue: 4 (1 from the author, 1 from a reviewer).
```

That submission's automated baseline passed with zero findings. It is not waiting
on a security problem. It is waiting because the commit that fixed the review
comments was pushed and never offered, which is the 9-of-13 case in
[MEASUREMENTS.md](MEASUREMENTS.md).

The other verdict, on a submission whose author did work it out:

```console
$ omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/4829
validated     bc2f75cf15f7827511d79a7afa1680198e79c8ef
              outcome review-required, 0 finding(s), 3 capability/ies, checked
              2026-09-07T07:01:52.811Z
current HEAD  bc2f75cf15f7827511d79a7afa1680198e79c8ef
              main branch, via api, 2026-09-04T22:25:20Z

▁ VALIDATION CURRENT  The validated commit is
                      bc2f75cf15f7827511d79a7afa1680198e79c8ef, which is the
                      current main-branch HEAD. Nothing needs refreshing.
```

This is the one the underlying measurement caught mid-flight: on 2026-09-12 it
was recorded with a validated commit of `f16bb9ba` against a HEAD of `bc2f75cf`,
and by the time of this run the author had re-offered the newer commit. `current`
means the submission is genuinely waiting on a person, and the right response is
to read the review comments rather than to touch the issue.

## Verdicts

| State | Meaning | Exit |
| --- | --- | --- |
| `current` | The validated commit is the current default-branch HEAD. Nothing to do. | 0 |
| `stale` | The marketplace has not seen the newer commit. Editing the issue body is what refreshes it. | 0 |
| `unknown` | No validated commit to compare, an incomplete baseline, or an unreadable HEAD. Never reported as `current`. | 2 |
