# Installing omakit

The README says the one line; this page says the rest: the clone route, PATH,
what it needs, what it puts on your machine, how it updates and how to remove
it, and what a dependency scanner sees in it and why.

## Install

```bash
npm install --global omakit
omakit setup
```

If `omakit` is not found afterwards, npm's global `bin` is not on your PATH
(measured: an npm global prefix under `~/.local/share` whose `bin` no shell
searched). Run `"$(npm prefix --global)/bin/omakit" setup` once: it prints the
one line that puts that directory on PATH for the shell in `$SHELL`, and the
rc file to keep it in; `omakit doctor` reports the same as `omakit.path`.
Nothing writes to your rc file for PATH.

`omakit setup` also installs tab completion for the shell in `$SHELL` and
then asks a new interactive shell whether it can complete `omakit`, the way
TAB asks (`docs/MEASUREMENTS.md`, M8). On a stock Omarchy it can, and setup
says `▁ ok`. Where a new shell has no completion loader, setup names what is
missing and asks once: "Add one guarded line to ~/.bashrc so completions
load?" On yes (or `--yes`, for an agent), it appends one marked block and
nothing else:

```bash
# omakit completion
[[ -r /usr/share/bash-completion/bash_completion ]] && source /usr/share/bash-completion/bash_completion
```

(for zsh: the `fpath+=~/.zfunc` and `autoload -Uz compinit && compinit`
lines under the same marker, in `~/.zshrc`). The marker is looked for first,
so a second run appends nothing; omakit never edits or removes the block.
On no, the lines are printed and nothing is written. Open terminals need a
new shell afterwards (`exec bash`). `omakit doctor` reports the script, its
omakit version and pin, the loader and the spec as `omakit.completion`, and
`omakit upgrade` re-runs the completion step through the omakit it just
installed, so the script always names the version that is on PATH; a script
from another omakit is noticed at startup, once a day, in one dim line.

Or read what you run:

```bash
git clone --depth 1 https://github.com/mtolhuys/omakit ~/.local/share/omakit
ln -s ~/.local/share/omakit/bin/omakit ~/.local/bin/omakit
omakit setup
```

| Needs | Why |
| --- | --- |
| Node 22 or newer | the tool is plain ESM with no dependencies and no build step. A stock Omarchy has Node and npm through `mise`, along with `git`, `gh` and `ttfx` |
| `git` | the pin, and reading a subject's tree at an exact commit |
| `/usr/bin/python3`, on the plugin's machine | the Run and Store blocks a plugin copies start their supervisor and helper there by absolute path; a stock Omarchy 4.0.3 has it, `omakit doctor` reports it as `blocks.python`, and omakit itself does not need it |
| network, once | `omakit pin`. After that, `submit` and `verify` on a local repository need none at all |
| 15 MB on disk | the pinned checkout, in `$XDG_CACHE_HOME/omakit/marketplace`, or `~/.cache/omakit/marketplace` |

`omakit upgrade` updates either install through the installer that made it:
`npm` for the package, at the exact version the registry names, and a
fast-forward for a clone. `omakit doctor` says when a newer version is
published. Nothing in omakit fetches and runs its own replacement, and
`omarchy-mise-install npm:omakit` would, so it is not the way in.

## What it puts on your machine

Everything omakit writes is under two roots it follows XDG for, plus the
completion script where your shell loads one from. It writes nowhere else,
and it never edits your rc file for `PATH`.

| Path | What it is | How big |
| --- | --- | --- |
| `~/.cache/omakit/marketplace` | the pinned marketplace checkout every rule is read from | 15 MB |
| `~/.cache/omakit/registry` | the registry and catalog as last read | small |
| `~/.cache/omakit/lab/` | the lab: the verified ISO, the base, staging, the lock | gigabytes, and only after `omakit lab setup` |
| `~/.local/state/omakit/weigh/` | the documents `omakit weigh` wrote, and its per-restart timing | small |
| `~/.local/state/omakit/lab/runs/` | one record per lab run, with its logs and screenshots | small |
| `~/.local/share/bash-completion/completions/omakit` | the completion script, for bash | small |
| `~/.config/fish/completions/omakit.fish` | the same, for fish | small |
| `~/.zfunc/_omakit` | the same, for zsh | small |

`$XDG_CACHE_HOME` and `$XDG_STATE_HOME` move the first two roots if you set
them, and `$XDG_DATA_HOME`, `$XDG_CONFIG_HOME` and `$ZDOTDIR` move the
completion script. Nothing here is written until you run the command that
needs it: an omakit that has only ever run `submit` has the first row and no
other.

`omakit doctor` reports the pin's checkout and its size as `pin.checkout`
and `pin.size`, the completion script as `omakit.completion`, and the
lab's lines beside them; `omakit lab inspect` is the lab's own inventory,
with the bytes.

## Removing it

```bash
omakit lab prune                                   # the lab, asked once, with the bytes said
npm uninstall --global omakit                      # or remove the clone and the symlink
rm -rf ~/.cache/omakit ~/.local/state/omakit       # the pin, the registry cache, the records
```

`prune` first, while omakit is still installed: it is the only thing that
knows what the lab owns, and the lab is the only part measured in gigabytes.
The completion script is removed with the path from the table above; the one
guarded block that `setup` may have added to your `~/.bashrc` or `~/.zshrc`
is yours to delete, because omakit never edits or removes it.

## Updating

Two different things could mean "upgrade" here, and only one of them may ever
move on its own. That distinction is now enforced rather than argued.

**The tool:**

Normal interactive use (`omakit`, `watch`, `submit`, `verify`, `audit` and
`weigh`) checks npm for a newer release at most once per 24 hours and prints
the installed and available versions with the upgrade command on stderr.
It waits at most one second for the network; failures stay quiet and retry
after an hour. It never installs automatically or sends a GitHub credential
to npm. Pipes, JSON, `--out`, `--offline`, help, CI, setup and upgrade never
perform this passive check. Set `DISABLE_UPDATE_NOTIFIER=1` to disable it.

Only installed/latest version metadata and the check time are stored at
`$XDG_STATE_HOME/omakit/update-check.json` (or
`~/.local/state/omakit/update-check.json`). An unwritable state directory
does not prevent commands from running, but cannot throttle later invocations.
`omakit doctor` always checks explicitly unless `--offline` is passed.
Version comparisons follow semantic precedence, including prereleases;
an install ahead of the newest published version is never downgraded.

```bash
omakit upgrade          # the npm package, or a clone: through its own installer
omakit upgrade --dry-run
omakit doctor          # check the published version now
```

It is not a self-updater of the kind this repository warns other people
about: it never fetches and runs its own replacement. On an npm install it asks
the registry for the newest version and, if that is newer, runs the `npm` on
PATH with frozen arguments (`npm install --global --ignore-scripts omakit@<that
version>`, never `@latest`, never with sudo), and it refuses when the npm on
PATH is not the one that installed it. On a clone it fast-forwards from the
remote you cloned it from, and refuses a dirty tree, a detached HEAD, a remote
that is not this repository, and anything that is not a fast-forward. In every
refusal it names what to run yourself. `git -C ~/.local/share/omakit pull`
still works on a clone and does the same thing.

**The pin** does not move by itself, ever, and `omakit upgrade` does not move it
either: a test asserts that its source does not so much as mention the pin or
the cache. Bumping it changes where the submission contract and the baseline
policy are read from, and the procedure in
[UPSTREAM_CONTRACT.md](UPSTREAM_CONTRACT.md) ends in re-proving
transport parity and committing the evidence. `omakit doctor` tells you when the
pin is behind in something omakit reads from it, names which paths changed,
and then leaves it alone: `registry.json` and `site/catalog.json` moving is
fine, because those are read live from HEAD (about 140 commits a day touch
only `registry.json`, so "behind" alone would be true of every run); the
marketplace's code or forms moving is a note, and what you can do about it
is run `omakit upgrade`, since a newer omakit may already carry the new pin,
and otherwise open an issue naming the paths. That the
pin can go stale unnoticed is the same defect class `omakit watch` reports, so it
would be poor form to hide it here.


## What Socket reports and why

A supply-chain scanner such as Socket reads the package for the capabilities
its code uses, and omakit uses several that a scanner flags by design. Every
one of them is what the tool is for, and each has the test that holds it to
that:

- **Process spawning.** `gh auth token --hostname github.com` is the one `gh`
  invocation, with frozen arguments, to borrow a login for GET requests. `git`
  is spawned for the pinned marketplace checkout (`fetch`, `checkout`,
  `rev-parse`, `ls-tree`, `cat-file` and their read-only kin) and for
  `omakit upgrade` on a clone (`merge` of a fast-forward, local only). `npm`
  is spawned by `omakit upgrade` alone, with frozen arguments, at an exact
  version and never `@latest`. `ttfx`, when installed, draws the wordmark
  from stdin with frozen arguments. `omakit weigh` runs the Omarchy shell
  commands from one frozen table: `omarchy-shell`, `omarchy-restart-shell`,
  `omarchy plugin list`, `omarchy-plugin-catalog`, `qs`,
  `omarchy-hyprland-session-locked`, `systemctl --user show-environment` and
  `getconf`. No shell is ever invoked with a string; every spawn is a binary
  and an argument list, and `tests/unit/read-only.test.mjs` asserts the
  arguments of each.
- **Filesystem.** The pinned marketplace checkout and the live registry cache
  under `$XDG_CACHE_HOME/omakit/` (or `~/.cache/omakit/`), the one completion
  script `setup` installs where the shell in `$SHELL` loads it from, the one
  marked block `setup` appends to `~/.bashrc` or `~/.zshrc` after an
  explicit yes (above), a once-a-day stamp under `$XDG_STATE_HOME/omakit/`
  behind the stale-completion notice, and the files a `--out` names. `weigh` alone also writes `~/.config/omarchy/shell.json`
  for the duration of a measurement, its timestamped backup beside it, and
  its documents and per-restart timing under `$XDG_STATE_HOME/omakit/weigh/`;
  `tests/unit/self-containment.test.mjs` counts those writes and refuses any
  other, and no code path writes into a plugin tree or copies a file at all.
- **Environment.** `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `HOME`, `SHELL`, `PATH`, `ZDOTDIR`, and `OMARCHY_PATH` (the
  session's shell, read the way `omarchy-restart-shell` reads it), plus the
  terminal's own `NO_COLOR`, `FORCE_COLOR` and `TERM`. Every one is somebody
  else's convention; omakit reads no variable of its own and never a token
  (`GH_TOKEN` and `GITHUB_TOKEN` are honoured by `gh` itself).
- **Network.** GET only, from one call site, to four hosts: `api.github.com`,
  `github.com` (the public commit feed), `raw.githubusercontent.com` (two
  registry files at an exact commit) and `registry.npmjs.org` (`upgrade`
  and `doctor` asking for the newest version). The borrowed credential goes
  to `api.github.com` and nowhere else. `verify` on a local repository
  touches no network at all, proven by a run inside `unshare -rn`
  ([evidence/offline/](evidence/offline/)).
- **No install scripts.** The package has no `postinstall` or any other
  lifecycle script, no build step and no runtime dependency; `npm pack` is
  held to a reviewed file list and a size ceiling by `tests/package-assert.mjs`.

`weigh` is the one command that changes the machine it runs on, and it says
so and asks before the first restart ([WEIGH.md](WEIGH.md)). Everything else
reads.
