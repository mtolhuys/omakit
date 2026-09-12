# omakit

One command that tells you whether an Omarchy Quattro plugin is ready to submit
to the [plugin marketplace](https://github.com/omacom/omarchy-plugin-marketplace),
and one that tells you why a submission has gone quiet.

Agent-first: the expected user is a coding agent submitting a plugin on an
owner's behalf. Zero runtime dependencies, plain ESM, `node --test`, one
executable entry point, no build step. Read-only against the marketplace at all
times, and it never posts anything.

```console
$ omakit pin
ok - marketplace pin 38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6 (baseline 3, selective)

$ omakit submit ~/src/omarchy-plugin-clock --category Widgets --tags bar,quickshell
subject      https://github.com/example/omarchy-plugin-fixture-good
commit       71d3e37a77f6bfd029c855785197d8b25d2ce3c6
marketplace  pin 38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6 (baseline 3, selective)

ok   plugin.root-manifest  [marketplace-pin]
       manifest.json declares id "omakit-fixture.good" and name "Fixture Good"

ok   plugin.root-readme  [marketplace-pin]
       root README: README.md

ok   plugin.root-license  [marketplace-pin]
       root license: LICENSE

ok   plugin.readme-install-removal  [omakit]
       README mentions installation: yes; removal or uninstall: yes

ok   tree.agent-control  [omakit]
       no agent-control files in the installable tree

ok   identity.available  [marketplace-pin]
       id "omakit-fixture.good" is unused, outside the reserved omarchy.* namespace,
       and the repository is not listed

ok   submission.title  [marketplace-pin]
       title will be "[Plugin]: Fixture Good"

ok   submission.category  [marketplace-pin]
       category: Widgets

ok   submission.tags  [marketplace-pin]
       tags: Bar, Quickshell

ok   submission.repository-url  [marketplace-pin]
       https://github.com/example/omarchy-plugin-fixture-good

ok   submission.headings  [marketplace-pin]
       6 headings rendered in form order

ok   submission.checklist  [marketplace-pin]
       5 items rendered with the form's exact text, all checked

ok   submission.official-parser  [marketplace-pin]
       accepted: repo https://github.com/example/omarchy-plugin-fixture-good,
       category Widgets, tags bar, quickshell

ok   submission.pinned-commit  [omakit]
       local commit 71d3e37a77f6bfd029c855785197d8b25d2ce3c6 is the current
       main-branch HEAD

ok   baseline.preflight  [marketplace-pin]
       passed (disposition clear, enforcement selective, blocksApproval false). No
       findings and no capabilities. Nothing in the baseline holds this submission
       back.

--- the marketplace's own baseline report for this commit ---

## Automated security baseline

✅ **Automated security baseline passed at commit `71d3e37…`.**

No action is required.

This deterministic baseline detects only its documented patterns and is not designed to stop a motivated attacker.

This is not a security audit, certification, warranty, or endorsement.

Official baseline preview over a local snapshot. The marketplace rescans the
public commit itself. This is not approval, listing, verification or a
security audit.

Pinned commit: 71d3e37a77f6bfd029c855785197d8b25d2ce3c6
  = main-branch HEAD (71d3e37a77f6bfd029c855785197d8b25d2ce3c6)

--- issue title ---
[Plugin]: Fixture Good

--- issue body ---
### Repository URL

https://github.com/example/omarchy-plugin-fixture-good

### Category

Widgets

### Tags

Bar, Quickshell

### Suggest a missing tag

_No response_

### Maintainer notes

_No response_

### Submission checklist

- [X] The repository is public and contains installation and removal instructions.
- [X] I have documented the plugin license and any external dependencies.
- [X] I confirm that I own or have permission to submit this plugin and its preview assets.
- [X] The plugin does not overwrite user configuration without explicit consent.
- [X] I understand that approval is for listing and is not a security review.

This is not posted. Ask the plugin owner to approve it, then create the
issue yourself, for example:

  gh issue create --repo omacom/omarchy-plugin-marketplace \
    --title "[Plugin]: Fixture Good" \
    --body-file <the body above>

After it is created: Edit the issue body. That is the only action that re-runs
validation and the security baseline against a new commit: a push does not, and
a comment does not.
```

When a blocking check fails, the failing paths, a remedy and the measured reason
are printed instead, and **no body is produced at all**.

## Why this exists

Two things, both measured on public marketplace data on 2026-09-12. Full figures
and method in [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

**Submissions fail on mechanics.** 39 fell out on the title prefix alone, 14 of
them still open and 7 rescued by hand. 11 more open submissions are malformed in
the body and get a validation error that blames the maintainer for the author's
mistake; one of those differs from a valid submission by the single word
"Suggested" instead of "Suggest". Separately, 103 issues mention agent-control
files inside an installable plugin tree, which no automated check reports, so an
author learns about them only from a human review round.

**And then the review pin goes stale, silently.** After validation the review is
pinned to one exact commit, and the only action that moves that pin is editing the
issue body: there is no `issue_comment` trigger anywhere in the marketplace, so
pushing a fix does nothing and commenting "fixed in `abc123`" does nothing. Of the
464 submissions parked in their author's court, 73% have a default-branch HEAD the
marketplace never saw; 47% pushed after the maintainer's review without the
marketplace ever seeing it, and 82% of those authors also commented, so they are
engaged and stuck rather than gone. Of 13 open submissions inspected with no
labels left, 9 had passed validation and passed the security baseline with zero
findings, and were blocked solely by a stale pin.

```console
$ omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
```

## What it does not claim

The baseline it runs is the marketplace's own code, imported unmodified from a
read-only checkout pinned to an exact commit. It performs no data-flow analysis
and is not a security review; this tool says so in the marketplace's own words,
read out of the marketplace's own report builder, and never renames an official
outcome or constructs the attestation marker the marketplace's bot posts.

Every check names its source. `[marketplace-pin]` means the rule is the
marketplace's, read from the pin. `[omakit]` means the check is this project's
own, derived from public issue data — not marketplace policy, and it does not
claim to be. Nothing here is endorsed by the marketplace's maintainers, and
nothing in this tool asks them to install, configure or read anything.

## Install

Node 22 or newer, and `git`.

```bash
git clone https://github.com/mtolhuys/omakit
cd omakit
./bin/omakit pin     # fetches the pinned marketplace checkout into .cache/
./bin/omakit help
```

`GITHUB_TOKEN` is optional, read-only, and never written to disk.

## Evidence

| Claim | Proof |
| --- | --- |
| The local transport produces the marketplace's own result | `omakit parity --count 30`, evidence in [docs/evidence/parity/](docs/evidence/parity/) |
| A local run touches no network | `node tests/parity/offline.mjs <url@sha>` inside `unshare -rn`, evidence in [docs/evidence/offline/](docs/evidence/offline/) |
| The generated body is well formed | the marketplace's own `parseCurrentSubmission` from the pin, in `tests/unit/issue.test.mjs` |
| Nothing writes to the marketplace | `tests/unit/read-only.test.mjs`, over every source file |
| No agent-control file can reach a plugin | `tests/unit/self-containment.test.mjs` |

Committed evidence records a digest of each side rather than the results
themselves: findings about a specific third-party plugin are not this project's
to publish.

```bash
npm test
```

## Documentation

| Document | For |
| --- | --- |
| [docs/SUBMIT.md](docs/SUBMIT.md) | every check and what it decides |
| [docs/PIN_WATCH.md](docs/PIN_WATCH.md) | the pin mechanism |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | every number, its method and its limits |
| [docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md) | the seam, the pin, the boundaries |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | who this actually helps, stated honestly |
| [AGENTS.md](AGENTS.md) | changing this repository |

MIT. This repository is derived work built on public data from
`omacom/omarchy-plugin-marketplace`; it is not affiliated with or endorsed by
that project.
