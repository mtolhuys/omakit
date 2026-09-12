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
| `tree.agent-control` | omakit | No agent-control file anywhere in the installable tree. |
| `identity.available` | pin | The plugin id is unused, not retired, outside the reserved namespace, and the repository is not already listed. |
| `submission.title` | pin | The title is the form's own prefix plus the plugin name. |
| `submission.category` | pin | Exactly one category from the form's controlled list. |
| `submission.tags` | pin | One to three tags from the form's controlled list. |
| `submission.repository-url` | pin | A public GitHub repository root URL, taken from `origin`, never invented. |
| `submission.headings` | pin | The six form headings, in the form's order. |
| `submission.checklist` | pin | All five checklist items, exact text, checked. |
| `submission.official-parser` | pin | The marketplace's own `parseCurrentSubmission` accepts the rendered title and body. |
| `submission.pinned-commit` | omakit | The local commit is the repository's current default-branch HEAD, because that is what the marketplace will actually pin. |
| `baseline.preflight` | pin | The official security baseline over a local snapshot, verbatim, plus what its outcome will cause. |

Every one of them states its measured reason in the output when it fails, and in
the source either way. The numbers are in [MEASUREMENTS.md](MEASUREMENTS.md).

## Nothing about the format is written down here

The title prefix, the six headings, the nine categories, the thirteen tags and
the exact text of the five checklist items are all read from
`.github/ISSUE_TEMPLATE/submit-plugin.yml` in the pinned checkout. The maximum
tag count comes from the pinned `scripts/submission.mjs`. The reserved plugin-id
namespace is read out of the pinned `scripts/build-catalog.mjs` next to the
marketplace's own `reserved-plugin-id` check. The listed ids, the retired ids and
the listed repositories come from the pinned `registry.json` and
`site/catalog.json`.

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

The review is then pinned to one exact commit, and the only action that moves
that pin is editing the issue body. See [PIN_WATCH.md](PIN_WATCH.md).
