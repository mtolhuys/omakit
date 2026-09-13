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
Commit/version: 38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6 (baseline v3, selective, marker protocol 4)
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
Executable proof/test: tests/parity/run.mjs (30 of 30 identical, docs/evidence/parity/);
  tests/parity/offline.mjs (no network during a local run, docs/evidence/offline/);
  tests/unit/*.test.mjs
Verified result: VERIFIED
Verified on: 2026-09-12 (Europe/Amsterdam)
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
| Location | `.cache/marketplace`, under the tool; nothing moves it |
| Setup | `omakit pin`: `git fetch --depth 1 origin <commit>` then a detached checkout; idempotent; refuses a modified checkout |
| Identity constant | `tools/marketplace/pin.mjs` (`MARKETPLACE_PIN`), the only home of the commit |
| Commit | `38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6` ("Add Plugin updates plugin (#6374)") |
| Policy read from the checkout | `securityBaselineVersion` `3`, `securityBaselineEnforcementMode` `selective` |
| Official limits at the pin | file 512 KiB, snapshot 8 MiB / 1000 files, binary probe 4 KiB, asset probe 256 files / 1 MiB (`scripts/security-baseline-limits.mjs`) |
| Scope facts the adapter relies on | symlink entries (`120000`) are skipped; executables (`100755`) over the file limit are probed with `Range: bytes=0-4095` and expect `206` with `content-range`; setup-named binary assets are probed with a 1 MiB range and a complete image makes the scan `security-baseline-unavailable`; `.txt` is not a scanned extension |
| Registry facts | 2,963 sources with `listingValidatedCommit`; 2,916 with an `automatedSecurityBaseline` record (1,681 passed, 1,215 review-required, 20 needs-fixes); 3,001 catalog plugin ids; 22 retired ids; 749 sources (25.3%) with at least one superseded validated commit, 1,108 superseded commits in all |

## Updating the pin

A deliberate change, in this order:

1. Change `MARKETPLACE_PIN` in `tools/marketplace/pin.mjs`.
2. Remove `.cache/marketplace` and run `omakit pin`.
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
