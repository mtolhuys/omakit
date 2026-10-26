# Upstream contract ledger

This file prevents Omakit from coding against remembered or imagined marketplace
behaviour. Every external contract this repository relies on is recorded here
with its source, its ref and its proof.

This repository has exactly one upstream contract, because it has exactly one
job. The Omarchy Quattro runtime contracts, the plugin-lab observations and the
conformance work recorded in the Omakit archive are out of scope here and were
deliberately not harvested; they remain in the archive.

## Marketplace baseline seam

```text
Dependency: Omarchy Plugin Marketplace security baseline and submission format
Canonical source: https://github.com/omacom/omarchy-plugin-marketplace
Branch/ref: main
Commit/version: bdf24b347fcb2fb7a0af18104ab68dc6ecbf9882 (baseline v3, selective, marker protocol 4)
Relevant symbol/section:
  - scripts/security-baseline-scanner.mjs: runSecurityBaseline(repoUrl, commitSha, options)
  - scripts/security-baseline-scope.mjs: resolveSecuritySnapshot(repoUrl, commitSha, { fetchImpl, token, requiredPaths, listedPlugins })
  - scripts/security-baseline-analysis.mjs: buildSecurityBaseline({ repository, repoUrl, commitSha, files }, options)
  - scripts/security-github-snapshot.mjs: githubJson(path, { fetchImpl, token }) -> https://api.github.com<path>
  - scripts/security-baseline-policy.mjs: securityBaselineOutcome, securityBaselineDisposition,
      securityBaselineBlocksApproval, securityBaselineSelectivelyBlockingRules,
      securityBaselineVersion, securityBaselineEnforcementMode, rule and capability catalogs
  - scripts/security-baseline-report.mjs: buildSecurityBaselineDetails, buildSecurityBaselineReport
  - scripts/security-baseline-record.mjs: findLatestSecurityBaseline, parseSecurityBaselineMarker
  - scripts/submission.mjs: parseCurrentSubmission, extractRepositoryUrl, allowedCategories,
      allowedTags, maximumSubmissionTags, submissionChecklist, submissionTitlePrefix
  - .github/ISSUE_TEMPLATE/submit-plugin.yml: the submission form itself
  - .github/workflows/route-issue-automation.yml: the only workflow with a direct `issues` trigger
  - .github/workflows/refresh-catalog.yml: HEAD comparison, listed plugins only
  - registry.json, site/catalog.json: listed ids, retired ids, listed repositories
  - test/security-baseline.test.js: upstream tests inject fetchImpl, so the seam is exercised upstream
Omakit reliance: run the official baseline on a local commit through a local Git
  transport; read the submission contract from the form; verify the rendered body
  with the official parser; read the validated commit from the official marker.
Executable proof/test: tests/parity/run.mjs (30 of 30 identical at bdf24b34, docs/evidence/parity/);
  tests/parity/offline.mjs (no network during a local run, docs/evidence/offline/);
  tests/unit/*.test.mjs
Verified result: VERIFIED
Verified on: 2026-10-26 (Europe/Amsterdam) at bdf24b34; 2026-10-01 at b441b4f0; 2026-09-21 at 70dcc454 and at b7b29654; first verified 2026-09-12 at 38060f89
```

Two modules at the pin are deliberately *not* imported:

- `scripts/build-catalog.mjs` imports `sharp`, a native dependency. Omakit has
  zero runtime dependencies, so it reads that file as text for the two values
  it needs (the reserved plugin-id namespace and the category mapping,
  `reservedNamespace` and `catalogPresentation`) and does not re-validate
  manifests.
  Re-implementing the marketplace's manifest rules here would be copied policy
  that drifts from the pin silently.
- `serializeSecurityBaselineMarker` is never called. It builds the
  machine-readable attestation the marketplace's bot posts, and nothing in this
  repository may construct something that could be pasted into an issue as the
  marketplace's own attestation. `tests/unit/read-only.test.mjs` proves it is
  absent.

## Pinned checkout

| Field | Value |
| --- | --- |
| Location | `$XDG_CACHE_HOME/omakit/marketplace`, defaulting to `~/.cache/omakit/marketplace`; nothing else moves it |
| Setup | `omakit pin`: `git fetch --depth 1 origin <commit>` then a detached checkout; idempotent; refuses a modified checkout |
| Identity constant | `tools/marketplace/pin.mjs` (`MARKETPLACE_PIN`), the only home of the commit |
| Commit | `bdf24b347fcb2fb7a0af18104ab68dc6ecbf9882` ("Update Beam plugin (#12679)", 2026-10-26 12:54 UTC); before it `b441b4f0` (0.6.10 and 0.6.11), `b7b29654`, `70dcc454` and `38060f89`; see the pin history below |
| Policy read from the checkout | `securityBaselineVersion` `3`, `securityBaselineEnforcementMode` `selective` |
| Official limits at the pin | file 512 KiB, snapshot 8 MiB / 1000 files, binary probe 4 KiB, asset probe 256 files / 1 MiB (`scripts/security-baseline-limits.mjs`) |
| Scope facts the adapter relies on | symlink entries (`120000`) are skipped; executables (`100755`) over the file limit are probed with `Range: bytes=0-4095` and expect `206` with `content-range`; setup-named binary assets are probed with a 1 MiB range and a complete image makes the scan `security-baseline-unavailable`; `.txt` is not a scanned extension |
| What omakit reads | `PIN_READS` in `tools/marketplace/pin.mjs` names the ten files omakit opens under `scripts/` and how (seven imported, three read as text), and for each file read as text its `readers`, the values taken out of it as functions from text to value: `reservedNamespace` and `catalogPresentation` from `build-catalog.mjs`, `validatedLabel` from `approve-submission.mjs`, `updateLabel` from `approve-plugin-update.mjs`; `pinnedReadSet(pinDir)` adds what the imported ones import, by regex over `from "./x.mjs"` in the pinned text and never by loading a module: 16 of the 34 files under `scripts/` at `bdf24b34`, as at `b441b4f0`. `tests/unit/pin.test.mjs` derives the ten from the sources and pins the sixteen, so a new read here or a new import upstream is a visible diff |
| What moved since the pin | `omakit doctor` compares what omakit reads between the pin and the marketplace's HEAD: each file in the read set by blob id, `registry.json` and `site/catalog.json` by blob id, `.github/ISSUE_TEMPLATE/` by tree id (the pin side from the local checkout, the HEAD side through the git-trees API at the exact commit: three tree reads, a fourth for the `scripts/` tree only when its id moved, a fifth GET for the policy module's text at HEAD only when its blob moved, and one more for each file read as text whose blob moved). A file read as text is then compared by what omakit reads out of it: its `readers` run on the pin's text and on HEAD's, the same functions the checks call, and a file whose every value is unchanged does not count as moved for the grade. Graded on what is left (`effective`), by what the difference can do to a verdict: `ok` when nothing in the read set counts (the data files are read live; `scripts/` moving elsewhere is said as "in none of the 16 files omakit reads"; a text-read file that moved with its values unchanged is named, with how many values); `info` when the only files that count are in `WORDING_READS` (`pin.mjs`: the baseline's rendered details, the failure table, one label from each approval script; omakit takes wording or a label out of them and decides nothing by them), the files named as wording only; `advice` when a file omakit executes or reads a rule from moved (the whitelist's complement, 12 of 16, whether or not `securityBaselineVersion` and `securityBaselineEnforcementMode` still read the same at HEAD, since a rule can change without its version), a value read out of a text-read file differs (both values printed), a read file is gone at HEAD, or the form directory moved, with `omakit upgrade` as the action when a newer omakit is published and otherwise that the maintainer is notified, and in both cases that every verdict is the pin's until then (the weekly workflow opens the one issue; doctor never asks for one). The two constants are printed beside every grade. Offline or on any error it says `unknown`. In `--json`, under `evidence`: `changedPaths`, `readLive`, `pinned` as before, plus `reads`, `moved` (the blob), `verdictMoved`, `effective` (what the grade is taken from), `missing`, `textReads` (`{ [path]: { moved, values: { [name]: { pin, head, same } } } }`) and `policy.{pin,head}`. Measured in `docs/MEASUREMENTS.md` M7: of the five commits since `38060f89` that touched a file in the read set, the tree comparison (0.6.6) and the blob comparison (0.6.7) grade all five `advice` and the value comparison two (7dd6e56, 40315f2); the three that moved only `build-catalog.mjs` (a166e3ac, b612419c, cb7947ec) grade `ok`. The closure's completeness is held by `tests/unit/pin.test.mjs`: a dynamic `import()`, side-effect import, `require()` or `import.meta.resolve()` in an executed read file fails the suite by file and line (0 of 13 at `bdf24b34`). The procedure below is the maintainer's and is not printed |
| Read live, read pinned | `registry.json` and `site/catalog.json` are read from the marketplace's current default-branch HEAD when the network is there (at the exact commit `defaultBranchHead()` resolved, cached under `$XDG_CACHE_HOME/omakit/registry/<commit>/`, never written into the checkout) and from the pin with `--offline` or when HEAD cannot be read; everything under `scripts/` and `.github/ISSUE_TEMPLATE/` is only ever read from the pin. The one exception is a comparison, not a read: `doctor` fetches `scripts/security-baseline-policy.mjs` and each file read as text at HEAD, each only when its blob moved, through `headTextUrl()` (`HEAD_TEXT_PATHS`), takes the values omakit reads out of it and drops it; nothing imports it, caches it or derives a rule from it, and `tests/unit/read-only.test.mjs` holds the one module that asks for it to no `import()`, evaluation or write. Measured reason in `docs/MEASUREMENTS.md` M7: 4,201 of 4,293 commits in 30 days touched only `registry.json` |
| Registry facts | 5,927 sources with `listingValidatedCommit`; 5,887 with an `automatedSecurityBaseline` record (3,062 passed, 2,769 review-required, 56 needs-fixes); 5,968 catalog plugin ids; 98 retired ids; 1,891 sources (31.9%) with at least one superseded validated commit, 3,215 superseded commits in all |

## Pin history

| Pin | Marketplace date | Omakit releases | What moved in the pinned paths since the previous pin |
| --- | --- | --- | --- |
| `38060f89` | 2026-09-11 | 0.1.0 to 0.6.4 | first pin |
| `70dcc454` | 2026-09-21 | 0.6.5 | 863 commits, two in `scripts/` or `.github/ISSUE_TEMPLATE/`: 7dd6e56 adds the tag `vpn` to `allowedTags` and to the form's Tags list (read from the pin, so `submit` accepts it without a code change); 40315f2 lets a standard-installation verification reuse a valid installer-only maintainer review (`plugin-verification.mjs`, a new `securityBaselineEligibleForReviewedStandardInstallation` in the policy module, `verify-plugin.yml` wording; the maintainer's flow after listing, nothing the preflight reads). `securityBaselineVersion`, `securityBaselineEnforcementMode`, the rule and capability catalogs, the limits, the feedback table (37 codes) and the label set are byte-identical. Parity re-proved 30 of 30 at offset 1 (`docs/evidence/parity/2026-09-21-local-vs-github-2.json`); offset 0 is 29 of 30, 0 mismatches, modoterra/omabench gone from github.com (`2026-09-21-local-vs-github.json`). Under the graded comparison (0.6.7): `advice`, for the two forms; `submission.mjs` and the policy module are in the read set and moved, the constants read the same (measured 2026-09-21 with `b7b29654` as the pin and `38060f89` as HEAD: 5 GETs) |
| `b7b29654` | 2026-09-21 18:18 UTC | 0.6.6 to 0.6.9 | 14 commits, one in `scripts/`: 5e401552 ("Delist multi-monitor.workspaces and preserve retired migration history (#7954)") lets `validateRegistryRepositoryMigrations` in `scripts/repository-identity.mjs` accept a migration chain that ends at fully retired plugins. Omakit does not import that module (it validates the marketplace's own registry on their side); the retired-id count moves from 22 to 23. Policy constants, catalogs, limits, feedback table, labels and the form are byte-identical. Parity re-proved 30 of 30 at offset 0: `docs/evidence/parity/2026-09-21-local-vs-github-3.json`. Under the graded comparison (0.6.7): `ok`, "scripts/ moved in none of the 16 files omakit reads" (measured with `70dcc454` as HEAD: 4 GETs); the tree comparison that prompted this bump graded it `advice` |
| `b441b4f0` | 2026-10-01 02:34 UTC | 0.6.10 to 0.6.11 | 1,280 commits, 1,268 of them to `registry.json`; four in `scripts/`, all on 2026-09-30, and none in `.github/ISSUE_TEMPLATE/`. a166e3ac ("Keep the catalog refresh alive when one source fails (#9392)"), b612419c ("Retry the catalog refresh budget check and report its cause (#9400)") and cb7947ec ("Fix invalid install command for built-in bar-widget plugins (#2006)") change `build-catalog.mjs`, which omakit reads as text for two values: the reserved namespace and the category mapping read the same at each, so each grades `ok` under the value comparison (0.6.10) and graded `advice` under the blob comparison (0.6.7), the grade `omakit doctor` gave on 2026-09-30. 74513851 ("Check out catalog history without historical file contents (#9426)") changes `build-explorer-data.mjs`, outside the read set: `ok` under both, `advice` under the tree comparison (0.6.6). Policy constants, the labels, the form, the read set (16 of 34) and every read file but `build-catalog.mjs` are byte-identical. Parity re-proved 30 of 30 at offset 0, 0 mismatches, 0 failures, by the version commit 386d1bb: `docs/evidence/parity/2026-10-01-local-vs-github.json` |
| `bdf24b34` | 2026-10-26 12:54 UTC | 0.6.12 | 3,095 commits since `b441b4f0`; four touch scripts, none change the form: 1ada0633 lowers the catalog REST reserve temporarily, 74836ff4 restores it and spreads policy-only revalidation, 8be8e3be resolves recorded former repositories before verification/update access, 1f845b73 labels malformed CLI candidates so their form-error report publishes. Shipped grades by parent: `ok`, `ok`, `ok`, `advice`; the full range is `advice`, 6 clone-answered requests, only `submission.mjs` effective. All 3 values from the two moved text-read files are unchanged. Baseline 3/selective, its rules/capabilities, limits, feedback, label values and form remain unchanged. Strict parsing remains the readiness gate. Full review and measurements: M7; `docs/evidence/pin-freshness/2026-10-26-grades.json` and `2026-10-26-range.json`. Parity re-proved 30 of 30 at offset 0, no mismatches or failures: `docs/evidence/parity/2026-10-26-local-vs-github.json` |

## GitHub account-wide issue discovery

`tools/marketplace/github.mjs` reads `GET /user` to resolve the signed-in account and `GET /repos/{owner}/{repo}/issues` with `creator`, `state=open`, `sort=updated`, `direction=desc`, `per_page=100` and `page`. GitHub's issue endpoint also returns pull requests; Omakit excludes the `pull_request` key and checks creator/state locally. All requests use the existing GET-only transport and borrowed `gh` credential. An explicit `--user` bypasses `GET /user`. Source: [authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), [repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues), checked 2026-09-15. Fixture proof: `tests/unit/watch-all.test.mjs`; no marketplace pin or policy is changed.

## Updating the pin

A deliberate change, in this order:

1. Change `MARKETPLACE_PIN` in `tools/marketplace/pin.mjs`.
2. Remove `$XDG_CACHE_HOME/omakit/marketplace` (or `~/.cache/omakit/marketplace` when XDG is unset) and run `omakit pin`.
3. Replace the old commit in `tests/fixtures/inspect/*.expected.json`, run
   `node tools/marketplace/measure-registry-figures.mjs --write`, which
   records the new pin's registry figures and renders them into the
   figures test, M4, M6 and the Registry facts row above, and run
   `npm test`. The contract cross-check fails loudly if the form and the
   marketplace's own constants disagree at the new commit; the submission tests
   fail if the rendered body is no longer accepted by the official parser.
4. Run `omakit parity --count 30` and commit its evidence file.
5. Grade the marketplace commits since the old pin with
   `node tools/marketplace/measure-pin-grades.mjs --clone <a blob-filtered clone> --since <old pin> --until <new pin>`,
   update the pinned-checkout rows above and M7, and add the pin history row.
6. Note any behaviour change in the README.

`.github/workflows/pin-bump.yml` does steps 1 to 4 and the grading in step
5 when `omakit doctor` grades the pin `advice`, weekly and on dispatch, and
opens a draft pull request in this repository with the diff of each file
that counted for the grade quoted, the commits graded, the suite's and
parity's results, and what is still the maintainer's: the rows, M7, the pin
history and the README. Its prepare job runs the candidate pin's
code with a read-only token; its propose job holds `contents: write` and
`pull-requests: write` here, runs nothing from the checkout or the pin, and
pushes only a commit confined to the paths a bump touches. No workflow
merges the pull request, tags or releases.

If a future marketplace revision removes the `fetchImpl` seam, the baseline
preflight reports that it is unavailable with the reason. Omakit does not imitate
the policy in its place.

## Boundaries that never move

- The marketplace owns validation rules, security policy, labels, approval, the
  catalog and deployment.
- Omakit is read-only against the marketplace at all times. It never writes to
  its issues, labels, registry, catalog or deployments, and never opens an issue
  or pull request there as a side effect of any command.
- Omakit never presents its own checks as marketplace policy and never renames an
  official outcome. Every check output names its source.
- Marketplace policy says AI must not determine baseline outcomes, enforcement,
  labels or approval. Omakit follows the same rule: it runs the marketplace's
  deterministic code and reports it, and decides nothing.
- Nothing in this tool asks the marketplace maintainer to install, configure or
  read anything.
