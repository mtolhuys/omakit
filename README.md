<p align="center">
  <img src="docs/media/banner.gif" alt="omakit" width="620">
</p>

<p align="center">
  <strong>The safe place to find out.</strong><br>
  Everything knowable about an Omarchy Quattro plugin submission, checked
  before you post it: the tree, the manifest, the form, the commit, and the
  marketplace's own security baseline with its outcome reported as it is. A submission is judged at one exact commit
  and drifts from it the moment you push; <code>watch</code> says when that
  has happened. All of it runs on your own machine and publishes nothing: no
  issue, no comment, no label, nobody's attention spent until you choose to.
</p>

![omakit submit refusing a plugin that ships agent-control files](docs/media/submit.gif)

```bash
omakit submit <plugin-repo> --category Widgets --tags bar,quickshell
```

Fifteen checks, each naming its source and, when it fails, the measured reason it
exists. A blocking failure produces no submission body at all, because a refusal
that still hands you the body is only a suggestion. The plugin above is fine
except that it ships instruction files an agent will read once installed: 103
marketplace issues mention exactly that, and no automated check reports it, so
today an author finds out from a human review round.

## Install

Three commands. The third one is the tool doing its job.

```bash
git clone --depth 1 https://github.com/mtolhuys/omakit ~/.local/share/omakit
ln -s ~/.local/share/omakit/bin/omakit ~/.local/bin/omakit
omakit setup
```

![omakit setup checking the environment and fetching the pinned checkout](docs/media/setup.gif)

`omakit setup` checks the environment, fetches the marketplace checkout that
every rule is read from, and tells you what to try first. It is idempotent. The
fetch takes about 2 seconds and 16 MB, because it takes only the seven files
omakit reads out of that repository rather than the 325 MB it is at that commit.
On an Omarchy machine with `ttfx` installed, the wordmark above plays in through
it first, in omakit's own colours and inside a stated budget; without it, and
everywhere else, `setup` is byte for byte the same tool.
Then:

```bash
omakit submit ~/src/my-plugin --category Widgets --tags bar,quickshell
```

| Needs | Why |
| --- | --- |
| Node 22 or newer | the tool is plain ESM with no dependencies and no build step |
| `git` | the pin, and reading a subject's tree at an exact commit |
| network, once | `omakit pin`. After that, `submit` and `verify` need none at all |
| 16 MB on disk | the pinned checkout, in `.cache/` beside the tool |

There is nothing to authenticate. If you have `gh auth login` done, omakit
reads that credential for GET requests and stores nothing (a token in `GH_TOKEN`
or `GITHUB_TOKEN` reaches it the same way, because `gh` honours those itself);
without a login, `watch` and `parity` share GitHub's 60-requests-an-hour
unauthenticated allowance and `submit` and `verify` do not touch the network at
all. omakit reads no environment variable of its own. `omakit doctor` says which of the
three you are on.

```bash
omakit doctor        # what is installed, what is pinned, and what has moved
omakit help --agent  # the operating instructions, for the agent running this
omakit pin           # what setup does for the pin, on its own
omakit completion bash | zsh | fish   # a completion script, from the pin's own form
```

The completion script knows the subcommands and their flags, completes a
directory for `<target>`, and offers the categories and tags the pin's
submission form actually has. `omakit setup` says where your shell loads it
from, until it is there.

While `submit` works, a scanner sweeps across a progress line naming the step it
is on. It is drawn on stderr and only when stderr is a terminal, so a piped run
gives an agent exactly the bytes it gave before; `NO_COLOR` takes its tint
away and `TERM=dumb` or a pipe removes it.

Every colour omakit prints is an ANSI palette entry, never a 24-bit or
256-colour escape, so your Omarchy theme decides what they look like and
recolouring the tool means recolouring the terminal. Green passed, red blocking,
yellow your attention, blue something you type, dim where a rule came from;
which index each role gets was chosen by measuring all 32 installed themes
([docs/PALETTE.md](docs/PALETTE.md)), not by taste. And nothing is said by
colour alone, because on a theme like Matte Black every hue is nearly the same
grey: a verdict is also a block glyph whose density is its weight
(`█ FAIL`, `▓ note`, `▁ ok`), the one line that fixes things is the only line
that starts with `→`, and the wordmark's `oma` is shade where its `kit` is
solid. `NO_COLOR` removes the colour and nothing else. The words never change:
stripping the colour from a coloured run gives the piped run back character for
character, and a test asserts it. The whole system, and why each choice was
made, is in [docs/TUI.md](docs/TUI.md).

![omakit watch reporting that a validated commit has fallen behind](docs/media/watch.gif)

```bash
omakit watch <submission-issue-url>
```

That submission passed validation and passed the security baseline with zero
findings. It is stuck because the marketplace validated one exact commit, and
the only action that makes it validate a newer one is editing the issue body. Pushing the fix does
nothing. Commenting "fixed in `abc123`" does nothing. **73% of the 464
submissions parked in their author's court have a default-branch HEAD the
marketplace never saw.**

Agent-first: the expected user is a coding agent submitting a plugin on an
owner's behalf. Zero dependencies, plain ESM, one entry point, no build step.
Read-only against the marketplace, and it never posts anything.

## Updating

Two different things could mean "upgrade" here, and only one of them may ever
move on its own. That distinction is now enforced rather than argued.

**The tool:**

```bash
omakit upgrade          # fast-forwards this checkout of omakit itself
omakit upgrade --dry-run
```

It refuses a dirty tree, a detached HEAD, a remote that is not this repository,
and anything that is not a fast-forward, and it names what to run yourself in
each case. It is not a self-updater of the kind this repository warns other
people about: it fast-forwards a Git checkout you cloned, from the remote you
cloned it from, and it touches nothing else. On a package install it says so and
prints `npm i -g omakit@latest`. `git -C ~/.local/share/omakit pull` still works
and does the same thing.

**The pin** does not move by itself, ever, and `omakit upgrade` does not move it
either: a test asserts that its source does not so much as mention the pin or
the cache. Bumping it changes where the submission contract and the baseline
policy are read from, and the procedure in
[docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md) ends in re-proving
transport parity and committing the evidence. `omakit doctor` tells you when the
pin is behind the marketplace's current branch and then leaves it alone. That the
pin can go stale unnoticed is the same defect class `omakit watch` reports, so it
would be poor form to hide it here.

## What it is doing

Nothing about the submission format is written down in this repository. The
title prefix, the six form headings in order, the nine categories, the thirteen
tags and the exact text of the five checklist items are all read from
`.github/ISSUE_TEMPLATE/submit-plugin.yml` in a marketplace checkout pinned to an
exact commit. The rendered body is then handed to the marketplace's own
`parseCurrentSubmission` from that same commit. If it accepts the body here, it
accepts it there, and no rule can drift.

The security baseline is the marketplace's own code, imported unmodified and run
over a local snapshot with no network. Omakit adds no rule, renames no outcome,
and never restates the result as a safety claim: the baseline does no data-flow
analysis and is not a security review, and the output says so in the
marketplace's own words.

Every check is labelled. `[marketplace-pin]` is the marketplace's rule, read from
the pin. `[omakit]` is this project's own check, derived from public issue data.
Those are not marketplace policy and do not claim to be.

## Why it exists

Four numbers, all measured on public marketplace data on 2026-09-12. Method,
limits and the rest of the figures: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

| Measured | Consequence |
| --- | --- |
| 39 submissions fell out on the title prefix alone, and 11 more are malformed in the body, one by a single word | the format is generated from the pinned form and judged by the marketplace's own parser |
| 1,226 of 2,990 listings needed a human to look, because of a capability | the official baseline runs locally on the exact commit first, and names the capability |
| 103 issues mention agent-control files, which no automated check reports | submit refuses the tree and prints the paths and the remedy |
| 73% of parked submissions have a HEAD the marketplace never saw; 46% of the maintainer's own revalidation requests never produced one | a read-only validation watch that names the one action which re-runs validation |

It does not claim to unblock the maintainer. His review writing barely repeats,
his median time from submission to publication is hours, and the queue waiting on
him is a median half a day old. The honest size of what this saves him is the
staleness paragraph he has written by hand on 358 issues, roughly 5.5% of his
review writing. The rest of the benefit is the submitter's.
[docs/MARKETPLACE.md](docs/MARKETPLACE.md) states that in full.

## Evidence, not claims

```bash
npm test        # 130 tests, node --test, no dependencies
```

| Claim | Proof |
| --- | --- |
| The local transport produces the marketplace's own result | 30 of 30 identical, [docs/evidence/parity/](docs/evidence/parity/) |
| A local run touches no network | run inside `unshare -rn`, [docs/evidence/offline/](docs/evidence/offline/) |
| The generated body is well formed | the marketplace's own parser, `tests/unit/issue.test.mjs` |
| Nothing writes to the marketplace | `tests/unit/read-only.test.mjs`, over every source file |
| No agent-control file can reach a plugin | `tests/unit/self-containment.test.mjs` |
| The GIFs above are real output | captures and renderer in [docs/media/](docs/media/) |

Committed evidence records a digest of each side rather than the results
themselves: findings about a specific third-party plugin are not this project's
to publish.

## Documentation

| Document | For |
| --- | --- |
| [docs/SUBMIT.md](docs/SUBMIT.md) | every check and what it decides |
| [docs/VALIDATION_WATCH.md](docs/VALIDATION_WATCH.md) | the validation watch: what the marketplace validated, and what moves it |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | every number, its method and its limits |
| [docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md) | the seam, the pin, the boundaries |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | who this actually helps |
| [docs/PALETTE.md](docs/PALETTE.md) | every installed Omarchy theme measured, and which palette index each role gets |
| [docs/TUI.md](docs/TUI.md) | what the terminal shows, and why it looks that way |
| [AGENTS.md](AGENTS.md) | changing this repository |

MIT. Derived work built on public data from
`omacom/omarchy-plugin-marketplace`; not affiliated with or endorsed by that
project.
