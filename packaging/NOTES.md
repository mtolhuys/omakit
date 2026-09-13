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

Done on the `launch` branch on 2026-09-13: the README replacements above, the
`OMAKIT_MARKETPLACE_PIN` override removed (omakit reads no variable of its
own; tests set `XDG_CACHE_HOME`), the AUR completion scripts regenerated after
`omakit completion` went, and `release.yml` made to succeed without a secret.

The first release is published by hand:

1. `main` carries all of it. A `v0.1.0` tag on `main` starts `release.yml`,
   which runs the suite, builds `omakit-0.1.0.tgz` and `omakit-0.1.0.tar.gz`
   from the tagged commit, creates the GitHub Release with both archives and
   both SHA-256 values, and opens `automation/aur-v0.1.0` with the measured
   PKGBUILD and `.SRCINFO`. With no `NPM_TOKEN` it reports that npm is a
   manual step and does not fail.
2. `npm publish --access public` from a checkout at the tag, with the account's
   own login. Then `npm view omakit version`.
3. Merge `automation/aur-v0.1.0` (GitHub holds its CI for approval: click
   **Approve workflows to run**), then push `packaging/aur/PKGBUILD` and
   `.SRCINFO` from that merge to `ssh://aur@aur.archlinux.org/omakit.git`.
   `AUR_SSH_PRIVATE_KEY` stays absent; the AUR job reports a no-op.
4. First week: configure npm Trusted Publishing for `mtolhuys/omakit` and
   `release.yml`, so the next tag publishes with provenance on its own.
5. The weekly pin-freshness run keeps one `[automation] Marketplace pin
   differs from HEAD` issue in this repository.

Still unverified until the first tag: GitHub's event delivery, the cache
service, the effective permission ceiling, the Release upload, the bot-created
pull request and its approval gate, and the scheduled issue state machine.

## Local phase-two evidence

- `actionlint` 1.7.12 reported 0 findings across the 3 workflow files.
- Node 22's full suite passed 173 named tests across 24 files; the run had 0 failures and 0 skips.
- `npm pack --dry-run --json` reported exactly 38 files, 81,351 packed bytes and 250,182 unpacked bytes; `tests/package-assert.mjs` accepted the list and the 102,400-byte ceiling.
- `makepkg --printsrcinfo` and the committed `.SRCINFO` had a 0-line diff, and `bash -n` accepted PKGBUILD.
- A clean Arch `base-devel` container built and installed `omakit-0.1.0-1-any.pkg.tar.zst` from a local release-layout source archive. A normal user then ran `setup`, got a `READY` verdict from `submit --offline`, and ran `doctor --offline`; the measured `/usr` tree digest was the same before and after all three commands (`7088421437d2102b938bbd3a84c4d93df98ce41d3133decdc077407e1e04b3f1`).
