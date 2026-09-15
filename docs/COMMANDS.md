# The commands

Every command, what it reads, what it prints, and what it will not do. The
short list is `omakit help`; this page is the rest.

Agent-first: the expected user is a coding agent submitting a plugin on an
owner's behalf. Zero dependencies, plain ESM, one entry point, no build step.

```bash
omakit setup                 # the environment, the pin, tab completion, and what to try first
omakit submit <plugin-repo>  # every check, the issue title and body; asks for a category and tags at a terminal
omakit watch <issue-url>     # the commit the marketplace validated, against the plugin's current HEAD
omakit watch --all           # check every open marketplace issue authored by your gh account
omakit watch --list          # list those issues without checking every plugin
omakit watch                 # choose one or several issues at a terminal
omakit verify <plugin-repo>  # the official security baseline over the local transport; --json for the document
omakit parity                # the baseline over GitHub versus the local transport, on real listings; writes the evidence
omakit audit [<plugin>]      # installed third-party commits against the commits the marketplace validated
omakit weigh <plugin>        # what a plugin weighs on the shell, measured by restarting it without and with the plugin; asks first
omakit inspect <plugin-dir>  # what a plugin tree does, as observations: processes, hosts, writes, timers, the baseline's capabilities, and the review classes the tree shows
omakit doctor                # what is installed, what is pinned, and what has moved
omakit pin                   # what setup does for the pin, on its own
omakit upgrade               # updates omakit through its own installer: npm, or a fast-forward
omakit help --agent          # the operating instructions, for the agent running this
```

![omakit setup checking the environment and fetching the pinned checkout](media/setup.gif)

`omakit setup` checks the environment, fetches the marketplace checkout that
every rule is read from, installs tab completion for the shell you run it from
and proves it in a new shell (`docs/INSTALL.md` says what it asks when the
shell has no loader)
(bash, zsh or fish, read from `$SHELL`), and tells you what to try first. It is
idempotent. The fetch takes about 2 seconds and 15 MB, because it takes only the
seven files omakit reads out of that repository rather than the 325 MB it is at
that commit. The completion script knows the subcommands and their flags,
completes a directory for `<target>`, and offers the categories and tags the
pin's submission form actually has. For `omakit weigh <TAB>` it offers the
plugin ids the running shell has installed, read at TAB time through
`omarchy-shell shell listPlugins` and `jq` (enabled ids first, whole bars
left out, since a bar cannot be weighed), and falls back to a directory
when the shell does not answer within a second. The decision behind that:
nothing starts a node process behind a TAB, because node's startup is not
something to put between a keystroke and its answer, and the ids are the
shell's to report, not a list to bake into a script that would go stale
the next time a plugin is added. The same pipeline is in the bash, zsh and
fish scripts, and `tests/unit/completion.test.mjs` runs its jq expression.

`omakit verify` prints the official baseline result alone, with no Omakit
check around it: the subject, the pin, the transport and what the local
adapter assumes, then the marketplace's own outcome, each finding as a block
with its rule id, whether it blocks publication under the pinned policy, the
file and line, and the official text verbatim, then the marketplace's own
statement. `--json` prints the document itself, unchanged from earlier
releases, and `--out <file>` writes it; agents and the skills use those.

`omakit submit` reads the marketplace's registry first, and a run has three
outcomes. `READY`, exit 0: every blocking check passed and the title and body
follow. `REFUSED`, exit 1: a blocking check failed and no body is produced.
`LISTED`, exit 0: the plugin is already listed by its own repository (the
manifest id is in the catalog, and the listing's repository is the subject's
declared `origin`, compared as owner and name), so the submission form is not
the route. Nothing is wrong and nothing was refused: `identity.available`
passes with the listing's record (since when, which commit, verified or not),
the five checks that exist only for the body are omitted, nothing is asked,
and the closing block names the commit the marketplace lists, the local
commit, whether they are the same, and the marketplace's verification form
with the choice that lists a newer commit, read from the pin's
`verify-plugin.yml`. Measured on 0.1.6: this state printed `FAIL
identity.available`, `REFUSED`, and "Fix it, then run submit again" under a
remedy that said there was nothing to submit. An id taken by another
repository, a retired id or a reserved one is still refused. In `--json`, the
outcome is `outcome: "ready" | "refused" | "listed"`, `ready` stays a boolean
that is true for the first only, and a listed run carries a `listing` object.

An unlisted plugin needs a category and tags, and they are an editorial
choice nobody else can make: at a terminal it asks, once each, with the form's
own lists numbered and the marketplace's own default for the manifest's kinds
offered where it is on the list; in a pipe, from an agent, or with `--json` it
is the usage error with the same lists, exit 2. A listed plugin is asked for
neither. A `READY` or `REFUSED` report ends with the command line that repeats
the run without asking, and `--json` carries it as `reproduce`.

Account-wide watch without `--user` requires `gh auth login` so it can discover your account. `--user <login>` can discover a public author's issues without a login. An individual issue URL still works unauthenticated. Discovery reads open authored issues, excludes pull requests, follows pagination, and refuses an incomplete list. JSON, `--out` and pipes never prompt: pass `--all`, `--list` or an issue URL. See [VALIDATION_WATCH.md](VALIDATION_WATCH.md) for batch output and exit codes.

If you have `gh auth login` done, omakit
reads that credential for GET requests and stores nothing; a token in
`GH_TOKEN` or `GITHUB_TOKEN` reaches it the same way, because `gh` honours
those itself. Without either, `watch` and `parity` share GitHub's
60-requests-an-hour unauthenticated allowance; `submit` reads two things
online, the subject's default-branch HEAD and the marketplace's current
registry, and `--offline` turns both off; `verify` on a local repository does
not touch the network at all (a `<url>@<sha>` target is fetched once, over
git, into the cache). omakit reads no environment variable of its own, and

![omakit inspect over a fixture with one process and no deadline](media/inspect.gif)

`omakit inspect <plugin-dir>` reads the plugin's tree at its commit and
prints what the text shows, in the order a reviewer reads it: every
`Process` with its argv, whether a deadline is observed for it and what
collects its output; every `http` or `https` literal with its host, the tool
it reaches and the timeout and size-cap flags beside it; every write with
whether its path falls under a directory the plugin controls; every `Timer`
with its interval; and the capabilities and findings the marketplace's own
baseline records for the same tree, through `verify`. Below the facts, one
row for each class the marketplace's human review has raised, printed only
where the tree shows the class's precondition and citing the class's measured
share of review findings ([M11](MEASUREMENTS.md#m11-what-the-human-review-raises-by-class)).
It is regular expressions over QML and shell, and every row says so: a
command that is not one literal is a `▒ ?` row with no argv, a section with
nothing in it says "observed nothing of this kind", and the report ends by
naming what the method cannot see. No score, no verdict, no `--fix`: it runs
nothing from the tree, resolves no host and writes nothing into it, and the
one word it closes on is `INSPECTED`. `--json` prints the document of
[INSPECT.md](INSPECT.md), `--out` writes it to a file as well, `--offline`
skips the baseline section. Exit 0 with a report, whatever it observed; 2
when the target could not be read.

`omakit doctor` names the credential source it found, or that it found none.

Every colour omakit prints is an ANSI palette index, so your Omarchy theme
decides what it looks like, and nothing is said by colour alone. What the
terminal shows and why is [TUI.md](TUI.md); which index each role
gets, measured over all 32 installed themes, is
[PALETTE.md](PALETTE.md).
