# README replacements

The README is owned by another session. Apply these exact replacements there by hand.

## Install commands

Replace the current three-command clone installation block with:

````markdown
Install from npm:

```bash
npm install --global omakit
omakit setup
```

On Arch Linux, install the AUR package instead:

```bash
yay -S omakit
omakit setup
```
````

## Pin size and location

Replace the `16 MB on disk` requirement row with:

```markdown
| 16 MB on disk | the measured pinned checkout, in `$XDG_CACHE_HOME/omakit/marketplace` or `~/.cache/omakit/marketplace` when XDG is unset |
```

Replace the setup size sentence with:

```markdown
The fetch takes about 2 seconds and 16 MB, because it takes only the seven files omakit reads out of that repository rather than the measured 325 MB at that commit; the checkout lives in `$XDG_CACHE_HOME/omakit/marketplace`, or `~/.cache/omakit/marketplace` when XDG is unset.
```

## Upgrade routes

Replace the package-install sentence in **The tool** with:

```markdown
It is not a self-updater: a Git checkout is fast-forwarded, an npm install names `npm i -g omakit@latest`, and the Arch package under `/usr` names `sudo pacman -Syu omakit`.
```

## AUR release checksum

The `v0.1.0` release does not exist yet, so its attached source tarball has no checksum that can be measured. `packaging/aur/PKGBUILD` and `.SRCINFO` use `SKIP` for the locally verified pre-release package; the release workflow replaces it with the attached tarball's measured SHA-256 and opens a pull request containing both files.

## README badges

README.md still has uncommitted work in the other checkout, so it was not edited. Put these badges at the top of that file when merging:

```markdown
[![CI](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml/badge.svg)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/omakit.svg)](https://www.npmjs.com/package/omakit)
```

## Phase-two handoff

1. Push the `packaging` branch. This only uploads the branch; it does not publish a package or create a release.
2. Open a pull request from `packaging` to `main`. CI should start three jobs: Ubuntu on Node 22, Ubuntu on Node 24, and the portable macOS suite on Node 22. Each summary should name the test count, package size, 102,400-byte ceiling, exact marketplace pin, and any named skip.
3. Watch that first CI run. Confirm all three jobs pass, the zsh and fish completion parsers actually run on Linux, the cache key ends in the 40-character pin, and macOS names `no network is a failure state, not a stack trace` as Linux-only. Merge only after that proof is green.
4. Before releasing, allow GitHub Actions write access and enable **Allow GitHub Actions to create and approve pull requests** in the repository Actions settings. For the first npm publish, add repository secret `NPM_TOKEN`: a short-lived granular npm token allowed to publish `omakit`, with read/write package access and bypass-2FA, then remove it after the first release. Once the package exists, configure npm Trusted Publishing for repository `mtolhuys/omakit` and workflow `release.yml`, explicitly allow direct `npm publish`, and leave `NPM_TOKEN` absent. Optional AUR publishing uses repository secret `AUR_SSH_PRIVATE_KEY`, an unencrypted dedicated Ed25519 private key whose public half is registered with the AUR account. That key can push every AUR package maintained or co-maintained by that account, not only `omakit`; omit it to keep the AUR job inert.
5. After the pull request is merged, tag that exact `main` commit `v0.1.0` and push the tag. The tag starts a fresh proof, publishes the already-checked npm tarball with provenance, creates a GitHub Release with npm and source archives plus both SHA-256 values, and opens or updates `automation/aur-v0.1.0` as one reviewable AUR-metadata pull request. A replay refuses to replace an existing asset or differing release body. GitHub holds CI for a `GITHUB_TOKEN`-created pull request for approval, so click **Approve workflows to run** on that PR. When `AUR_SSH_PRIVATE_KEY` exists, the same measured PKGBUILD and `.SRCINFO` are also pushed to AUR; without it the job reports a no-op.
6. The weekly pin-freshness run then keeps one `[automation] Marketplace pin differs from HEAD` issue in this repository: it creates, updates or reopens it while the full commits differ and closes it once they match. A missing or unknown HEAD fails without changing any issue.

Locally unverified because they require the first push or release: GitHub's event delivery, cache service and effective repository permission ceiling; npm package-name ownership, `NPM_TOKEN`, OIDC trusted-publisher matching and the published provenance; GitHub Release upload and the bot-created AUR pull request; the approval-gated CI on that pull request; the scheduled issue state machine; AUR account/package authorization and outbound SSH on port 22; and a clean AUR build from the not-yet-existing release URL. The local online `omakit doctor --json` run also returned `pin.freshness: unknown` because this sandbox could not reach GitHub, so its live HEAD comparison remains unverified here.

## Local phase-two evidence

- `actionlint` 1.7.12 reported 0 findings across the 3 workflow files.
- Node 22's full suite passed 173 named tests across 24 files; the run had 0 failures and 0 skips.
- `npm pack --dry-run --json` reported exactly 38 files, 81,351 packed bytes and 250,182 unpacked bytes; `tests/package-assert.mjs` accepted the list and the 102,400-byte ceiling.
- `makepkg --printsrcinfo` and the committed `.SRCINFO` had a 0-line diff, and `bash -n` accepted PKGBUILD.
- A clean Arch `base-devel` container built and installed `omakit-0.1.0-1-any.pkg.tar.zst` from a local release-layout source archive. A normal user then ran `setup`, got a `READY` verdict from `submit --offline`, and ran `doctor --offline`; the measured `/usr` tree digest was the same before and after all three commands (`7088421437d2102b938bbd3a84c4d93df98ce41d3133decdc077407e1e04b3f1`).
