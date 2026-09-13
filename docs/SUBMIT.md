# `omakit submit`

One command, run before a submission is posted. It reports everything that is
knowable in advance, prints the exact issue title and body, and posts nothing.

```
omakit submit <target> --category <category> --tags <a,b> [--notes <text>]
```

`<target>` is a local Git repository path, or `<https url>@<40-char sha>` for
reviewing somebody else's commit read-only. The plugin's name and id come from
the root `manifest.json`; `--name` overrides the name.

## What it refuses to do

It never creates the issue. Creating it happens only after the plugin owner
explicitly approves, which is also what the marketplace's own agent instructions
require. It never comments, labels, or opens a pull request, and there is no code
path in this repository that could: `tests/unit/read-only.test.mjs` proves that
no HTTP method other than GET exists anywhere in the tree.

When a blocking check fails, no body is produced at all. A refusal that still
handed you a body would just be a suggestion.

## The checks

Each check carries a source. `marketplace-pin` means the rule is the
marketplace's own, read from a pinned checkout at an exact commit, so a pin
update changes it. `omakit` means the check is this project's, derived from
public issue text; it is not marketplace policy and never claims to be.

| Check | Source | What it decides |
| --- | --- | --- |
| `plugin.root-manifest` | pin | Exactly one `manifest.json`, at the root, valid JSON, with an id. |
| `plugin.root-readme` | pin | A root README exists. |
| `plugin.root-license` | pin | A root license or COPYING file exists. |
| `plugin.readme-install-removal` | omakit | The README mentions installing and removing, because the generated checklist signs that claim. Keyword probe, not a reading. |
| `tree.agent-control` | omakit | Advisory: names every agent-control file in the installable tree. It never refuses, because the marketplace lists plugins that ship them (6 of 34 inspected). |
| `identity.available` | pin | The plugin id is unused, not retired, outside the reserved namespace, and the repository is not already listed. The registry and catalog it reads are the marketplace's current HEAD when online, the pin when not (`--offline`, or no network); the detail names which, with the commit. The remedy follows the cause, one arrow each in this order: leave the reserved namespace; a retired id cannot be reused; an id taken by another repository names that repository; a plugin listed by its own repository has nothing to submit and is sent to the marketplace's verification form for a newer commit (the form's action name is read from the pin). In `--json` such a `remedy` is an array. |
| `submission.title` | pin | The title is the form's own prefix plus the plugin name. |
| `submission.category` | pin | Exactly one category from the form's controlled list. |
| `submission.tags` | pin | One to three tags from the form's controlled list. |
| `submission.repository-url` | pin | A public GitHub repository root URL, taken from `origin`, never invented. |
| `submission.headings` | pin | The six form headings, in the form's order. |
| `submission.checklist` | pin | All five checklist items, exact text, checked. |
| `submission.official-parser` | pin | The marketplace's own `parseCurrentSubmission` accepts the rendered title and body. |
| `submission.validation-commit` | omakit | The local commit is the repository's current default-branch HEAD, because that is what the marketplace will actually validate. |
| `baseline.preflight` | pin | The official security baseline over a local snapshot, verbatim, plus what its outcome will cause. |

Every one of them states its measured reason in the output when it fails, and in
the source either way. The numbers are in [MEASUREMENTS.md](MEASUREMENTS.md).

A check has three verdicts. `pass` and `fail` are its own. `unknown`, drawn as
`▒ ?`, is a check that could not run because one it depends on failed:
`submission.headings`, `submission.checklist` and `submission.official-parser`
read the rendered body, so when the title, the category, the tags or the
repository URL failed, they say which check they waited on, and they count in
neither `blocking` nor `advisory`. The closing refusal lists root causes only
and says how many checks waited on them. Measured before this: a run with no
`--category` and no `--tags` on a listed plugin said "6 blocking checks failed"
for two causes.

No `--category` or no `--tags` is a usage error, decided before any check runs:
exit 2, the missing flag(s) named, and the form's own category and tag lists
printed under it, read from the pin. They are an editorial choice nobody else
can make, so nothing is rendered without them.

## Nothing about the format is written down here

The title prefix, the six headings, the nine categories, the thirteen tags and
the exact text of the five checklist items are all read from
`.github/ISSUE_TEMPLATE/submit-plugin.yml` in the pinned checkout. The maximum
tag count comes from the pinned `scripts/submission.mjs`. The reserved plugin-id
namespace is read out of the pinned `scripts/build-catalog.mjs` next to the
marketplace's own `reserved-plugin-id` check. The listed ids, the retired ids and
the listed repositories come from `registry.json` and `site/catalog.json`, and
those two files alone are read from the marketplace's current HEAD when the
network is there, because the pin's copy is stale within hours
([MEASUREMENTS.md](MEASUREMENTS.md) M7); with `--offline`, or when HEAD cannot
be read, they come from the pin, and the output says so either way.

The form and the marketplace's own constants are then cross-checked against each
other. If they disagree, `omakit submit` refuses to generate anything and says
which halves diverged, because generating a body from half of an inconsistent pin
is how malformed submissions happen.

## What `baseline.preflight` does and does not say

It runs the marketplace's own `runSecurityBaseline` from the pinned commit, over
a local Git transport, and reports the result verbatim beside what the pinned
policy says that result causes:

| Outcome | What it causes |
| --- | --- |
| no findings, no capabilities | `passed`: nothing in the baseline holds the submission back |
| no findings, one or more of the seven capabilities | `review-required`: a maintainer must look at this exact commit |
| any finding | `needs-fixes`, but only `sudoers-dangerous-passwordless-command` and `privileged-process-control-from-shared-temp` block publication under the current `selective` enforcement mode; the other three carry a `review-required` disposition a maintainer may accept |

The outcome derivation, the disposition, the blocking rule set and the
enforcement mode are read from the pinned `security-baseline-policy.mjs`. None of
them is restated in this repository, and no outcome is renamed.

This is not a safety claim and the output does not make one. The baseline
performs no general data-flow analysis and is not a security review. `submit`
prints the marketplace's own two closing sentences on this, read out of the
marketplace's own report builder at the pin, and it never constructs the
machine-readable attestation marker the marketplace's bot posts.

## After submitting

The marketplace then validates one exact commit, and the only action that makes
it validate a newer one is editing the issue body. See
[VALIDATION_WATCH.md](VALIDATION_WATCH.md).
