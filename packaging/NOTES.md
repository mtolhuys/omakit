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

The `v0.1.0` tag does not exist yet, so its GitHub-generated tarball has no checksum that can be measured. `packaging/aur/PKGBUILD` and `.SRCINFO` use `SKIP` for the locally verified pre-release package; as part of the AUR submission, replace it with the release tarball's measured SHA-256 and regenerate `.SRCINFO` with `makepkg --printsrcinfo`.
