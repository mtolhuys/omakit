# From a plugin to a listing

The other pages are contracts: each one states what a command decides and
refuses. This one is the path, in order, with the command at each step and
what a good outcome looks like. Nothing here is new; it is the reference read
in the order the work actually happens.

| Step | Command | You are done when |
| --- | --- | --- |
| Install | `npm i -g omakit && omakit setup` | `omakit doctor` names nothing missing that you need |
| Build | `omakit add run`, `omakit add store` | the copied files are committed |
| Check | `omakit inspect`, `omakit verify` | you have read what the tree does, and the baseline's own outcome |
| Prove | `omakit lab prove run` | the suite proved what it asserts, in a guest that is not your desktop |
| Weigh | `omakit weigh <plugin>` | you can say what it costs the shell, measured |
| Submit | `omakit submit <dir> --category <c> --tags <a,b>` | `READY`, and a title and body to post yourself |
| Track | `omakit watch <issue-url>` | `current`, not `stale` |

## Install

```bash
npm i -g omakit && omakit setup
```

`setup` fetches the pinned marketplace checkout that every rule is read from,
about 2 seconds and 15 MB, and installs completion for your shell. It is
idempotent. `omakit doctor` says what this machine lacks and installs nothing;
[INSTALL.md](INSTALL.md) has the clone route and what a dependency scanner
sees in the package.

## Build the plumbing before writing around it

```bash
omakit add run ./my-plugin
omakit add store ./my-plugin     # if the plugin keeps a file of its own
git -C ./my-plugin add omakit && git -C ./my-plugin commit -m "Add the omakit blocks"
```

Start every process through `Run` and keep every file of the plugin's own
through `Store`. Why that is worth taking from somewhere else is
[WHY.md](WHY.md); the API, with a copy-pasteable QML example and the full
result object, is [BLOCKS.md](BLOCKS.md#the-api).

Commit the copied files. Everything below reads the tree at a commit, never
the working copy, so an uncommitted change is a change nothing checks.

## Check while you are still working

```bash
omakit inspect ./my-plugin
omakit verify ./my-plugin
```

`inspect` prints what the tree does, in the order a reviewer reads it, and
then the review classes your tree shows a precondition for. It is
observations, not a verdict: the closing word is `INSPECTED` and there is no
`--fix`. `verify` prints the marketplace's own security baseline over your
exact commit, verbatim, adding nothing.

Run both the way you run a test suite. Neither posts anything, and neither
needs the network for a local repository.

## Prove it, if the host can

```bash
omakit lab inspect                 # what is pinned, what is on disk, what the host lacks
omakit lab setup                   # one consent, then the pinned ISO and one base
omakit lab prove run
```

Optional, and the only part that boots anything. `setup` is the one path that
fetches bytes, after one consent that names the exact size and destination,
and it needs KVM, QEMU and OVMF. A run happens in a disposable guest built
from a read-only base, and your desktop is not touched.
[LAB.md](LAB.md) has the trust anchor and what one run costs.

## Weigh it, with the owner's agreement

```bash
omakit weigh my.plugin.id
```

This restarts the shell several times, so it asks first and refuses rather
than guessing when nothing can answer. What comes back is a difference
between two shells, not a reading taken from one: [WEIGH.md](WEIGH.md).

## Submit

```bash
omakit submit ./my-plugin --category Widgets --tags bar,baz
```

Sixteen checks, each naming whose rule it is, and three outcomes.
`READY` prints the exact issue title and body. **You post it.** The tool
creates nothing: no HTTP method other than GET exists anywhere in the tree.

`REFUSED` produces no body at all, lists the root causes with the measured
reason each check exists, and ends with the command line that repeats the
run. Fix, commit, run it again. Every refusal code and the one action for it
are in [FAILURES.md](FAILURES.md); the checks themselves are in
[SUBMIT.md](SUBMIT.md).

The category and the tags are an editorial choice the tool will not invent.
At a terminal it asks; in a pipe or under `--json` it is a usage error with
the form's own lists.

## After it is posted

```bash
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
```

The marketplace validated one exact commit, and the review that follows is of
that commit. Pushing a fix does not change it and commenting does not change
it: editing the issue body is the only action that makes it validate a newer
one. `watch` says `current`, `stale` or `unknown`, and
[VALIDATION_WATCH.md](VALIDATION_WATCH.md) says why that is the centre of the
tool.

Once you are listed, `omakit audit` is the other side of the same question:
which installed plugins, yours and everybody's, are running a commit nobody
validated.

## If you are an agent

The path is the same, the skills name it step by step, and every command
ends as one JSON document with a stable `error.code`:
[SKILLS.md](SKILLS.md).
