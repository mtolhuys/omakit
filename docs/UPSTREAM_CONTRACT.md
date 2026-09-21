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
Commit/version: b7b2965431c52fc6311fdb389bd9f0d6275235c4 (baseline v3, selective, marker protocol 4)
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
Executable proof/test: tests/parity/run.mjs (30 of 30 identical at b7b29654, docs/evidence/parity/);
  tests/parity/offline.mjs (no network during a local run, docs/evidence/offline/);
  tests/unit/*.test.mjs
Verified result: VERIFIED
Verified on: 2026-09-21 (Europe/Amsterdam) at 70dcc454 and again at b7b29654; first verified 2026-09-12 at 38060f89
```

Two modules at the pin are deliberately *not* imported:

- `scripts/build-catalog.mjs` imports `sharp`, a native dependency. Omakit has
  zero runtime dependencies, so it reads that file as text for the one constant
  it needs (the reserved plugin-id namespace) and does not re-validate manifests.
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
| Commit | `b7b2965431c52fc6311fdb389bd9f0d6275235c4` ("Add OmaStudio plugin (#6843)", 2026-09-21 18:18 UTC); before it `70dcc454` (2026-09-21, one day) and `38060f89` ("Add Plugin updates plugin (#6374)", 2026-09-11 to 2026-09-21); see the pin history below |
| Policy read from the checkout | `securityBaselineVersion` `3`, `securityBaselineEnforcementMode` `selective` |
| Official limits at the pin | file 512 KiB, snapshot 8 MiB / 1000 files, binary probe 4 KiB, asset probe 256 files / 1 MiB (`scripts/security-baseline-limits.mjs`) |
| Scope facts the adapter relies on | symlink entries (`120000`) are skipped; executables (`100755`) over the file limit are probed with `Range: bytes=0-4095` and expect `206` with `content-range`; setup-named binary assets are probed with a 1 MiB range and a complete image makes the scan `security-baseline-unavailable`; `.txt` is not a scanned extension |
| What omakit reads | `PIN_READS` in `tools/marketplace/pin.mjs` names the ten files omakit opens under `scripts/` and how (seven imported, three read as text); `pinnedReadSet(pinDir)` adds what the imported ones import, by regex over `from "./x.mjs"` in the pinned text and never by loading a module: 16 of the 34 files under `scripts/` at `b7b29654`. `tests/unit/pin.test.mjs` derives the ten from the sources and pins the sixteen, so a new read here or a new import upstream is a visible diff |
| What moved since the pin | `omakit doctor` compares what omakit reads between the pin and the marketplace's HEAD: each file in the read set by blob id, `registry.json` and `site/catalog.json` by blob id, `.github/ISSUE_TEMPLATE/` by tree id (the pin side from the local checkout, the HEAD side through the git-trees API at the exact commit: three tree reads, a fourth for the `scripts/` tree only when its id moved, a fifth GET for the policy module's text at HEAD only when its blob moved). Graded by what the difference can do to a verdict: `ok` when nothing in the read set moved (the data files are read live; `scripts/` moving elsewhere is said as "in none of the 16 files omakit reads"); `info` when a read file moved and `securityBaselineVersion` and `securityBaselineEnforcementMode` read the same at HEAD, the files named, verdicts unchanged, nothing to do; `advice` when a constant differs, a read file is gone at HEAD, or the form directory moved, with `omakit upgrade` as the action when a newer omakit is published and otherwise that the maintainer is notified (the weekly workflow opens the one issue; doctor never asks for one). Offline or on any error it says `unknown`. In `--json`, under `evidence`: `changedPaths`, `readLive`, `pinned` as before, plus `reads`, `moved`, `missing` and `policy.{pin,head}`. Measured in `docs/MEASUREMENTS.md` M7: of the three `scripts/` commits since `38060f89`, 5e401552 grades `ok` under this comparison and graded `advice` under the tree comparison. The procedure below is the maintainer's and is not printed |
| Read live, read pinned | `registry.json` and `site/catalog.json` are read from the marketplace's current default-branch HEAD when the network is there (at the exact commit `defaultBranchHead()` resolved, cached under `$XDG_CACHE_HOME/omakit/registry/<commit>/`, never written into the checkout) and from the pin with `--offline` or when HEAD cannot be read; everything under `scripts/` and `.github/ISSUE_TEMPLATE/` is only ever read from the pin. The one exception is a comparison, not a read: `doctor` fetches `scripts/security-baseline-policy.mjs` at HEAD as text through `headTextUrl()`, takes its two constants and drops it; nothing imports it, caches it or derives a rule from it. Measured reason in `docs/MEASUREMENTS.md` M7: 4,201 of 4,293 commits in 30 days touched only `registry.json` |
| Registry facts | 3,664 sources with `listingValidatedCommit`; 3,619 with an `automatedSecurityBaseline` record (2,031 passed, 1,562 review-required, 26 needs-fixes); 3,702 catalog plugin ids; 23 retired ids; 854 sources (23.3%) with at least one superseded validated commit, 1,270 superseded commits in all |

## Pin history

| Pin | Marketplace date | Omakit releases | What moved in the pinned paths since the previous pin |
| --- | --- | --- | --- |
| `38060f89` | 2026-09-11 | 0.1.0 to 0.6.4 | first pin |
| `70dcc454` | 2026-09-21 | 0.6.5 | 863 commits, two in `scripts/` or `.github/ISSUE_TEMPLATE/`: 7dd6e56 adds the tag `vpn` to `allowedTags` and to the form's Tags list (read from the pin, so `submit` accepts it without a code change); 40315f2 lets a standard-installation verification reuse a valid installer-only maintainer review (`plugin-verification.mjs`, a new `securityBaselineEligibleForReviewedStandardInstallation` in the policy module, `verify-plugin.yml` wording; the maintainer's flow after listing, nothing the preflight reads). `securityBaselineVersion`, `securityBaselineEnforcementMode`, the rule and capability catalogs, the limits, the feedback table (37 codes) and the label set are byte-identical. Parity re-proved 30 of 30 at offset 1 (`docs/evidence/parity/2026-09-21-local-vs-github-2.json`); offset 0 is 29 of 30, 0 mismatches, modoterra/omabench gone from github.com (`2026-09-21-local-vs-github.json`). Under the graded comparison (0.6.7): `advice`, for the two forms; `submission.mjs` and the policy module are in the read set and moved, the constants read the same (measured 2026-09-21 with `b7b29654` as the pin and `38060f89` as HEAD: 5 GETs) |
| `b7b29654` | 2026-09-21 18:18 UTC | 0.6.6 | 14 commits, one in `scripts/`: 5e401552 ("Delist multi-monitor.workspaces and preserve retired migration history (#7954)") lets `validateRegistryRepositoryMigrations` in `scripts/repository-identity.mjs` accept a migration chain that ends at fully retired plugins. Omakit does not import that module (it validates the marketplace's own registry on their side); the retired-id count moves from 22 to 23. Policy constants, catalogs, limits, feedback table, labels and the form are byte-identical. Parity re-proved 30 of 30 at offset 0: `docs/evidence/parity/2026-09-21-local-vs-github-3.json`. Under the graded comparison (0.6.7): `ok`, "scripts/ moved in none of the 16 files omakit reads" (measured with `70dcc454` as HEAD: 4 GETs); the tree comparison that prompted this bump graded it `advice` |

## GitHub account-wide issue discovery

`tools/marketplace/github.mjs` reads `GET /user` to resolve the signed-in account and `GET /repos/{owner}/{repo}/issues` with `creator`, `state=open`, `sort=updated`, `direction=desc`, `per_page=100` and `page`. GitHub's issue endpoint also returns pull requests; Omakit excludes the `pull_request` key and checks creator/state locally. All requests use the existing GET-only transport and borrowed `gh` credential. An explicit `--user` bypasses `GET /user`. Source: [authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), [repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues), checked 2026-09-15. Fixture proof: `tests/unit/watch-all.test.mjs`; no marketplace pin or policy is changed.

## Updating the pin

A deliberate change, in this order:

1. Change `MARKETPLACE_PIN` in `tools/marketplace/pin.mjs`.
2. Remove `$XDG_CACHE_HOME/omakit/marketplace` (or `~/.cache/omakit/marketplace` when XDG is unset) and run `omakit pin`.
3. Run `npm test`. The contract cross-check fails loudly if the form and the
   marketplace's own constants disagree at the new commit; the submission tests
   fail if the rendered body is no longer accepted by the official parser.
4. Run `omakit parity --count 30` and commit its evidence file.
5. Update the pinned-checkout rows above.
6. Note any behaviour change in the README.

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
