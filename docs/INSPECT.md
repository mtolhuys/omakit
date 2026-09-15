# Inspecting a plugin

`omakit inspect <plugin-dir>` reads a plugin tree and reports what the plugin
does, as observations: which processes it starts and with what argv, which
hosts it reaches and whether a timeout and a size cap are on the request,
which paths it writes and whether they fall under a directory the plugin
controls, which timers run and at what interval, and which capabilities the
marketplace's own baseline records for the same tree. Below the facts it
names the review patterns that the marketplace's human review has raised most
often, each with the measured share behind it, where the tree shows the
pattern's precondition.

It produces no score and no verdict. Every row is an observation, and every
observation is labelled as one, because it comes from regular expressions over
QML and shell, not from running the plugin.

## What it is

The submit preflight answers "will the marketplace's automation accept this
issue". The baseline (`omakit verify`) answers "what will the marketplace's
scanner record". Neither answers the question a human reviewer asks first,
which is "what does this thing do": the reviewer opens the tree, finds every
`Process`, every `curl`, every write and every `Timer`, and then asks about
deadlines, buffers, boundaries and secrets. `inspect` does that reading once,
deterministically, before the issue is opened, and prints it in the order the
reviewer reads it.

The audience is the same as the rest of this tool: a coding agent building a
plugin on an owner's behalf, and the person who reviews what the agent built.
An agent that can see "observed: `curl` to `api.example.com` without
`--max-time` and without `--max-filesize`" fixes it before submission. A
reviewer who is handed the same list reads the tree faster.

## What it is not

- Not a security review, not a scan, not a lint. It does not say "safe",
  "unsafe", "pass" or "fail" about anything, and it never blocks. The
  marketplace's automated baseline blocks; `inspect` reports.
- Not a scorer. There is no number at the bottom, no grade, no percentage of
  anything for the plugin. The only percentages it prints are the measured
  shares of review findings behind each pattern, and those describe the
  marketplace's review history, not the plugin.
- Not a data-flow analysis. It matches text. A command assembled at run time
  from variables, a URL read from a config file, a path built by string
  concatenation and a component instantiated from a file outside the tree are
  all things it does not see, and the closing lines say so on every run.
- Not a claim about the runtime. It never starts the plugin, never runs a
  script from the tree, never resolves a host, never opens a socket.
- Not a source of marketplace rules. The capability names and the baseline
  result come from the pinned marketplace code through `omakit verify`, never
  restated here (AGENTS.md, rule 2).
- Not a lab. The disposable-VM work stayed in the archive; `inspect` is static
  by design, and the "observed" label is what keeps that honest.

## The "observed" rule

Every section line states what was observed and how many (`processes
observed 3`), every row under it is one site with its `file:line` and what
the text shows there, every qualifier in a row is worded as an observation
("deadline observed", "no cap observed", "under a directory the plugin
controls: not observed"), every count is a count of what the extraction
found, and the report ends by naming what the method cannot see. A row never
says "the plugin does X"; it says what was observed at `file:line`. The
distinction is the product: a static reading that sounds like a runtime fact
is the failure the 0.1 Passport made, and this command exists to not repeat
it.

The known blind spots, printed at the end of every report as the
`not visible` line and carried in the document as `notVisible`, one fixed
phrase each:

- `commands built at run time`: `command: [tool].concat(args)`, string
  concatenation, template literals with expressions. Such a command is a
  `▒ ?` row with `argv: null`, never a guess.
- `hosts and paths from variables, properties, config or the environment`.
- `scripts a command calls that inspect does not follow`: a shell script that
  calls a second script is read as one argv, and the second script is read on
  its own only if it is in the tree.
- `components loaded from outside the tree`, and anything `Loader` or
  `Qt.createComponent` resolves at run time.
- `encoded or obfuscated content, and what a sh -c or eval string runs`:
  base64, `eval`, `sh -c` with a computed string. Where `sh -c`, `bash -c` or
  `eval` is observed, the row says so and stops there.

A tree that shows none of the facts is reported as "observed nothing of this
kind", never as "clean".

## What it reads

The installable tree of the plugin directory at the subject commit, read
from the Git object database the way `submit` reads it (`.git/` and hidden
entries excluded, an uncommitted edit not seen), and within it every `.qml`,
`.js`, `.mjs`, `.cjs`, `.sh`, `.bash`, `.zsh`, `.fish`, `.py` file and every
file with a shebang or the executable bit, plus `manifest.json` for the id.
It does not read `README.md` for facts: prose that says `curl` is not a
process. This is the second lesson of the 0.1 Passport, which counted a
README mention of a command as an observation. The one thing the README is
asked is whether it names a privileged tool the argv already shows, for the
`privilege disclosure` pattern, and that is a fact about the README.

Sites are counted per occurrence with `file:line`, never per file.

## The report

Marks are the six of `docs/TUI.md`; `inspect` uses `░ info` for a fact,
`▒ ?` for a fact it could not resolve (a `command` that is a variable, an
interval that is an expression), `▓ note` for a review class row, and
`▔ skip` for the baseline under `--offline`. It never prints `▁ ok` or
`█ FAIL`, because it has no verdict to attach them to.

Two views of the one document. The default is an overview that fits one
screen and names no site: the subject, the files read and the baseline
outcome; then one line per kind of fact with its count and the ratios a
reviewer asks about (`deadline 1 of 3`, `output cap 1 of 2`, `timeout 1 of
1`, `curl -q 0 of 1`, `under a controlled directory 1`), the shell lines
counted by script and directory; then the review classes this tree shows,
each with its share of review findings in the M11 sample and how many
sites here show it, and the classes not shown. That is what a person reads
to know the shape of a tree, and it is the same for a tree with one script
and one with thirty. `--full` is the exhaustive view, in the order a
reviewer reads a tree: every process with its argv and every qualifier,
every host, every write, every timer, the capabilities, every pattern row
with every site, the whole `not observed` and `not visible` lists, and the
`method` line. `--json` is the document, which carries everything either
view shows. Measured before the split: a listed tree with four shell
scripts printed 372 process rows of two lines each, and the pattern rows a
reviewer would act on sat under 750 lines of argv.

```text
subject       ~/plugins/fixture-example at a3bf9e2d
files         3 read: 1 qml, 2 shell
baseline      review-required at pin 38060f89: installer, privilege,
              package-manager

processes     3  deadline 1 of 3, output cap 1 of 2, not resolvable 1
shell lines   2  in 2 scripts: scripts/ 2
hosts         1  https 1 of 1, timeout 1 of 1, size cap 1 of 1, curl -q 0 of 1
writes        2  under a controlled directory 1, outside one 1
timers        2  repeating 1 of 2, intervals 8000 to 30000 ms

review        6 of 10 classes reviewers raise show here; their share of review
              findings (M11, a 30-issue sample), and the sites here
▓ note  process lifecycle          20%  2 sites
▓ note  unbounded buffering        19%  1 site
▓ note  file and state boundary    15%  1 site
▓ note  environment trust           7%  4 sites
▓ note  network egress              5%  1 site
▓ note  privilege disclosure        3%  1 site
not shown     secrets, supply chain, untrusted text to display, argument grammar

░ INSPECTED  static reading, so run-time commands and values from variables are
             not seen; --full for every site, --json for the document
```

That is the real default output over `tests/fixtures/inspect/example/`, at
eighty columns as a pipe gets it; `--full` prints the same tree as five
process rows with their argv arrays and every qualifier, one row per host,
write and timer, and every site under every pattern row.
A pattern row prints only when the tree shows its precondition (a process
without a deadline, a write outside a controlled directory). A pattern whose
precondition is absent is not listed as "ok"; it is simply not there, and the
`not observed` line of `--full` (`not shown` in the overview) names what
was looked for. The share is the sample's, cited from `docs/MEASUREMENTS.md`,
and the source names the entry next to the pattern the way every `submit`
check names its `why`. The review line for a tree that shows none of the
ten preconditions says so.

### The patterns and what "observed" means for each

| Pattern | Precondition the extraction can see | Share of findings, M11 |
| --- | --- | --- |
| process lifecycle | a `Process` block with no observed deadline: no `Timer` whose `onTriggered` calls `kill()` or `signal()` on it or sets its `running` false, no `timeout` in argv, no `Component.onDestruction` that does the same; an `execDetached` call is not one, and a shell line is not one | about 20% |
| unbounded buffering | `StdioCollector` or `SplitParser` on a process whose argv shows no producer-side cap (`head -c`, `--max-filesize`, `timeout`) | about 19% |
| file and state boundary | a write whose canonical path is not under `$XDG_STATE_HOME`, `$XDG_CACHE_HOME`, `$XDG_CONFIG_HOME/omarchy/plugins/<id>` or `$XDG_RUNTIME_DIR`, `mktemp` excepted; a `mkdir` with no mode | about 15% |
| environment trust | a process whose tool word (the first argv word after `sudo`, `env`, `timeout` and the other wrappers) has no slash, shell builtins excepted; `curl` reaching a host without `-q` | about 7% |
| secrets | an argv element, or a `console.log` argument, matching `Authorization`, `Bearer`, `token=`, `api_key`, `password` or `secret=`; `wl-copy` with a computed argv element | about 7% |
| supply chain | a finding the baseline recorded and does not list as selectively blocking at the pin (at pin `38060f89`: `remote-git-execution-unpinned`, `curl-pipe-shell`, `cargo-git-unpinned`, read from the pinned policy, never named in the code); `inspect` prints the baseline's evidence sites and adds nothing | about 7% |
| network egress | an `http:` literal; `curl` with `-L` and no `--proto`; a loopback, link-local or private-range literal | about 5% |
| untrusted text to display | a `Text`, `Label` or `TextEdit` whose `text` binds to a `StdioCollector` or `SplitParser` id's `.text` and whose `textFormat` is not `Text.PlainText` | about 5% |
| argument grammar | an argv array with an element that is an expression rather than a literal (`"--user=" + name`, a template with `${...}`, a property) | about 4% |
| privilege disclosure | `sudo`, `pkexec`, `doas`, `docker` or `/dev/input` in argv, with whether the README names each | about 3% |

The percentages are the maintainer's review findings by class in a fixed
sample, one reader's classification, dated. They say how often reviewers have
raised a class, not how likely this plugin is to be blocked, and the report
words them that way. The ids, the shares and their order are held to
`docs/evidence/inspect/2026-09-12-review-classes.json` by the unit tests,
and every entry of `tools/inspect/patterns.mjs` to a measurement that is a
section of `docs/MEASUREMENTS.md`.

## Options

```bash
omakit inspect <plugin-dir>                # the report, for a person
omakit inspect <plugin-dir> --full         # every site, every qualifier, the whole lists
omakit inspect <plugin-dir> --json         # the document on stdout
omakit inspect <plugin-dir> --out <f>      # write the document to a file as well
omakit inspect <plugin-dir> --offline      # skip the baseline section (prints ▔ skip)
omakit inspect <plugin-dir> --allow-dirty  # read the committed tree of a checkout with uncommitted changes
```

`<plugin-dir>` resolves the way `submit` resolves its target
(`tools/subject/resolve.mjs`): a directory inside a Git checkout, whose HEAD
is recorded as the subject commit and whose tree at that commit is what is
read, or `<https url>@<40-char sha>` fetched read-only into the cache. A
directory below the checkout's root is read as the plugin's root, so a
plugin kept in a subdirectory of a larger repository is inspected on its
own: the facts are extracted from that directory's tree, and the baseline
is run over that tree alone, served to the official code by the local
transport as if it were the repository, with the line
`tree.root=<dir>/ (the plugin directory below the repository root, not the
root)` under `assumedByAdapter` so the document says which tree the
baseline saw. The subject commit stays the repository's, since that is the
commit the tree was read at. Nothing from outside the plugin directory is
ever printed as the plugin's; the unit tests inspect a fixture below this
repository's own root and hold the whole document to that. A checkout with
uncommitted changes is refused with the remedy `submit`
gives, exit 1, and `--allow-dirty` reads the committed tree as it is, the
way `submit --allow-dirty` does. There is no `--fix`, no `--strict`, no
threshold flag, because there is nothing to pass or fail.

## Exit status

`0` when a report was produced, whatever it observed. `2` when the target
could not be read (no directory, no Git checkout, no commit, no manifest,
nothing to inspect) and for a usage error. `1` for a refusal that is not
about the target's readability: uncommitted changes without `--allow-dirty`,
or no pinned marketplace checkout for the baseline (`omakit pin`). There is
no exit status for "found something", because finding something is the
normal outcome and not a failure.

## The JSON contract

`--json` prints the document on stdout. The document is the API: new fields
may be added, existing fields never change meaning.
`tools/inspect/contract.mjs` is the executable form and the unit tests hold
every produced document to it.

```text
omakit            string   the omakit version that produced the document
command           "inspect"
method            string   one sentence: static extraction, regular expressions, observed
subject           { dir, commit, mode, pluginId|null, repository: { url|null }, filesRead: { qml, js, shell, python, other } }
observed          { processes[], hosts[], writes[], timers[] }
counts            { processes: { total, qml, shell }, hosts, writes, timers, notResolvable }
                  the headline: how many process sites are QML Process blocks and how many are
                  shell lines, since a script contributes one site per command segment
notResolvable     [{ file, line, kind, text }]   sites the extraction saw but could not read:
                  kind "command" (a computed command), "host" (an expression where the host would be),
                  "timer-interval" (an interval that is an expression)
patterns          [{ id, observedCount, sites: [{ file, line }], observation, summary, measurement: "M11", share: number }]
                  only patterns whose precondition was observed; `observation` is the --full row's
                  first line, starting with the word observed; `summary` is it without the sites
lookedFor         string[]  pattern ids whose precondition was not observed
notVisible        string[]  the five blind spots above, one fixed phrase each, verbatim
marketplaceBaseline
                  the `verify` section verbatim, or { skipped: true, reason } under --offline
```

A process:

```text
file, line        where the command is declared: the `command:` line of a Process block, the line
                  that assigns `<id>.command`, an execDetached call, or the shell line
declaredIn        "qml" | "shell"   a Process block or execDetached, or a command line of a script
id                string | null     the Process block's id
argv              string[] | null   null when not resolvable statically; for an array with a computed
                  element, that element is its source text and `expressions` names it
argvForm          "array" | "string" | "computed"   a string is split into words the way a shell would
expressions       [{ index, text }]   the argv elements that are expressions, not literals
commandText       string | null     the expression a computed command was read from
running           boolean   `running: true`, `<id>.running = true` or `<id>.start()` observed
detached          boolean   a Quickshell.execDetached call, which has no deadline by design
deadline          { observed: boolean, via: "timer-kill" | "timeout-argv" | "destruction" | null, ms: number|null }
output            { collector: "StdioCollector" | "SplitParser" | "none" | "unknown", capObserved: boolean, via: string|null }
shellWrapper      boolean   true when the tool is sh, bash, zsh, dash, fish or ksh with -c next, or eval
pipedFrom         { line, argv0 } | null   for a shell site that reads the previous segment's output
```

A shell script contributes one site per command segment of every line that
is not a comment, split at `|`, `;`, `&&` and `||`, with a command
substitution `$(...)` read as its own site; builtins and keywords (`cd`,
`set`, `echo`, `if`, ...) start no process and are not sites, `eval` is.

A host:

```text
host, scheme      the literal's host and http or https
file, line, tool  where the literal sits and the tool it reaches: the argv's first word after any
                  wrapper (sudo, env, timeout, ...), the call on the line (fetch, XMLHttpRequest,
                  Qt.openUrlExternally), or null when neither is on the line
timeout           { observed, via }   --max-time, -m, --connect-timeout, --timeout, -T, or a timeout wrapper
sizeCap           { observed, via }   --max-filesize, --quota, or head -c in the same pipeline
flags             string[]   every option word beside the literal
privateAddress    boolean    a loopback, link-local or private-range literal, or localhost
```

A write:

```text
file, line, path  where and what, `path` as written (a literal or the expression text)
via               "FileView" | ">" | ">>" | "tee" | "cp" | "mv" | "mkdir" | "mktemp" | "install" | "touch" | "ln"
                  | "writeFile" | "writeFileSync" | "appendFile" | "appendFileSync" | "open"
canonicalPath     string | null   the path's literal prefix after `~`, `$HOME`, `${X}` and
                  Quickshell.env("X") are read as the XDG names; null when it starts with an expression
controlledDirectory  "observed" | "not-observed" | "unknown"
controlledBy      the controlled prefix the path is under, when observed; otherwise null
temp              boolean   under /tmp, /var/tmp or /dev/shm
mode              string | null   -m on mkdir or install, mktemp's own mode, `chmod N` on the same path
                  in the file, or `umask N` in the file
```

A timer:

```text
file, line, id    the Timer block and its id
intervalMs        number | null   null when the interval is an expression, carried in intervalText
intervalText      string | null
repeat, running, triggeredOnStart   boolean, or null when bound to an expression
startedBy         string | null   the handler outside the block that starts it, or "script"
```

## What it never does

Runs nothing from the tree. Fetches nothing except what `omakit verify`
already fetches, which under the local transport is nothing. Writes nothing
into the tree, nothing to the marketplace, nothing to GitHub; the document
goes to stdout and, when asked, to `--out`. `tests/unit/read-only.test.mjs`
holds `tools/inspect/` to that.

## Competition, sources read 2026-09-15

`omaforge check` (github.com/omarchy-forge/forge, Go, v0.4.0, last commit
2026-08-26) validates the manifest and tree against the official validator
contract (OF100 to OF112), adds publish-readiness rules (README, license,
semver, sections, preview) and eleven heuristics, five of which are keyword
presence tests on the bar-widget entry point (theme tokens, keyboard, loading,
empty and error states, OF210 to OF214) and six of which are substring or
regex matches: `/usr/share/omarchy`, `sudo `, `pacman `, a string-form
`command:`, a hard-coded hex colour, a NUL byte (OF300 to OF305). Its own
words: "heuristics require human review and do not prove a vulnerability or
runtime defect". Every result is a finding with a severity; it extracts no
argv, no hosts, no written paths and no timer intervals, and it does not run
the marketplace baseline. `forge check` is the tool to run for structure and
publish-readiness; `inspect` reports none of that.

The marketplace's automated security baseline (pinned at `38060f89`,
`scripts/security-baseline-analysis.mjs`) records five finding rules
(`cargo-git-unpinned`, `curl-pipe-shell`, `remote-git-execution-unpinned`,
`sudoers-dangerous-passwordless-command`,
`privileged-process-control-from-shared-temp`) and seven capabilities
(`installer`, `privilege`, `package-manager`, `service-management`,
`remote-build`, `bundled-executable-binary`, `sudoers-modification`), each
with evidence snippets, line numbers and, for its patterns, the extracted URL,
repository slug or destination path. It scans shell scripts, `bin/`,
`scripts/`, installer-named files, sudoers and service files, `.qml`, `.js`,
`.mjs`, `.cjs`, `.py`, `.desktop`, and README shell blocks. It does not
enumerate a plugin's processes, hosts, writes or timers as such, does not
look at deadlines, buffers, boundaries or display sinks, and says of itself
that it performs no general data-flow analysis and is not a security review.
`inspect` runs it unmodified through `verify` and prints its result beside the
observations; it copies none of its rules.

What neither does, and `inspect` does: list every process with argv, every
host with its timeout and cap flags, every write with its directory, every
timer with its interval, from one static pass, labelled observed; and name
the review classes with their measured frequency. What `inspect` does not do
that both do: decide anything.
