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

Every fact row begins with the word `observed`, every count is a count of what
the extraction found, and the report ends by naming what the method cannot
see. A row never says "the plugin does X"; it says "observed X at
`file:line`". The distinction is the product: a static reading that sounds
like a runtime fact is the failure the 0.1 Passport made, and this command
exists to not repeat it.

The known blind spots, printed at the end of every report:

- `command` values built at run time (`command: [tool].concat(args)`, string
  concatenation, template literals with expressions).
- Hosts and paths that arrive through variables, properties, config files or
  environment.
- Commands inside scripts that `inspect` does not follow: a shell script that
  calls a second script is read as one `Process` argv, and the second script
  is read on its own only if it is in the tree.
- QML components loaded from outside the tree, and anything `Loader` or
  `Qt.createComponent` resolves at run time.
- Encoded or obfuscated content (base64, `eval`, `sh -c` with a computed
  string). Where `sh -c`, `bash -c` or `eval` is observed, the row says so
  and stops there.

A tree that shows none of the facts is reported as "observed nothing of this
kind", never as "clean".

## What it reads

The installable tree of the plugin directory (the same tree `submit` checks;
`.git/` and hidden entries excluded), and within it every `.qml`, `.js`,
`.mjs`, `.cjs`, `.sh`, `.bash`, `.zsh`, `.fish`, `.py` file and every file with
a shebang, plus `manifest.json` for the id and the entry points. It does not
read `README.md` for facts: prose that says `curl` is not a process. This is
the second lesson of the 0.1 Passport, which counted a README mention of a
command as an observation.

Sites are counted per occurrence with `file:line`, never per file.

## The report

Order follows how a reviewer reads a tree. Marks are the six of
`docs/TUI.md`; `inspect` uses `░ info` for a fact, `▒ ?` for a fact it could
not resolve (a `command` that is a variable), and `▓ note` for a pattern
row. It never prints `▁ ok` or `█ FAIL`, because it has no verdict to attach
them to.

```text
subject       ~/plugins/example-plugin at 3f9c2a1e, 7 files read (5 qml, 2 sh)
method        static extraction, regular expressions over qml and shell; observed, not executed

processes     observed 3
░ info  Widget.qml:41  ["curl","-fsSL","--max-time","5","https://api.example.com/v1/status"]
        argv array; deadline observed (Timer 8000 ms bound to running, calls kill);
        output through StdioCollector, cap observed (--max-filesize 65536)
░ info  Service.qml:88  ["bash","scripts/refresh.sh"]
        argv array; no deadline observed; output through SplitParser, no cap observed
▒ ?     Panel.qml:12  command: root.cmd
        argv not resolvable statically

hosts         observed 1
░ info  api.example.com  https  Widget.qml:41 via curl
        timeout observed (--max-time 5); size cap observed (--max-filesize 65536);
        -q not observed; -L not observed

writes        observed 2
░ info  Service.qml:30  FileView path: Quickshell.env("XDG_STATE_HOME") + "/example-plugin/state.json"
        under a directory the plugin controls: observed ($XDG_STATE_HOME)
░ info  scripts/refresh.sh:14  > /tmp/example-plugin.cache
        under a directory the plugin controls: not observed (/tmp is shared)

timers        observed 2
░ info  Widget.qml:20  interval 30000 ms, repeat, running, triggeredOnStart
░ info  Widget.qml:55  interval 8000 ms, single shot, started by onRunningChanged

capabilities  marketplace baseline at pin 38060f89, local transport
░ info  observed: installer, package-manager (2 evidence sites, scripts/install.sh)
        official result: review-required (verbatim in --json under marketplaceBaseline)

patterns      of what the marketplace's human review raised, in a 30-issue sample (M11)
▓ note  process lifecycle       observed 1 process with no deadline (Service.qml:88)
        the largest class of review findings, about 20 of every 100 in the sample
▓ note  unbounded buffering     observed 1 collector with no cap (Service.qml:88)
        about 19 of every 100 findings in the sample
▓ note  file and state boundary observed 1 write outside a controlled directory (scripts/refresh.sh:14)
        about 15 of every 100 findings in the sample
▓ note  environment trust       observed 2 tools resolved from PATH (curl, bash); curl without -q
        about 7 of every 100 findings in the sample

not observed  no secret-shaped argv, no http scheme, no sh -c, no Text with rich text bound to output
not visible   commands built at run time, values from variables or config, components outside the tree

░ INSPECTED   3 processes, 1 host, 2 writes, 2 timers; static, see docs/INSPECT.md
```

A pattern row prints only when the tree shows its precondition (a process
without a deadline, a write outside a controlled directory). A pattern whose
precondition is absent is not listed as "ok"; it is simply not there, and the
`not observed` line names what was looked for. The share in the second line
is the sample's, cited from `docs/MEASUREMENTS.md`, and the source names the
entry next to the pattern the way every `submit` check names its `why`.

### The patterns and what "observed" means for each

| Pattern | Precondition the extraction can see | Share of findings, M11 |
| --- | --- | --- |
| process lifecycle | a `Process` with no observed deadline: no `Timer` whose handler calls `kill()` or `signal()` on it, no `timeout` in argv, no `Component.onDestruction` that stops it | about 20% |
| unbounded buffering | `StdioCollector` or `SplitParser` on a process whose argv shows no producer-side cap (`head -c`, `--max-filesize`, `timeout`) | about 19% |
| file and state boundary | a write whose path is not under `$XDG_STATE_HOME`, `$XDG_CACHE_HOME`, `$XDG_CONFIG_HOME/omarchy/plugins/<id>` or `$XDG_RUNTIME_DIR`; a temp file without `mktemp`; `mkdir` without `-m 700` | about 15% |
| environment trust | a tool name in argv position 0 without a slash; `curl` without `-q` | about 7% |
| secrets | an argv element or a `console.log` argument matching `Authorization`, `Bearer`, `token=`, `api_key`, `password`; `wl-copy` with a computed value | about 7% |
| supply chain | `git clone` or `curl` in an installer without a pinned ref or a checksum, as the baseline's own `remote-git-execution-unpinned` and `curl-pipe-shell` already record; `inspect` prints the baseline's evidence and adds nothing | about 7% |
| network egress | an `http:` URL; `curl` with `-L` and no `--proto`; a literal private address | about 5% |
| untrusted text to display | a `Text` whose `text` binds to a collector's output and whose `textFormat` is not `Text.PlainText` | about 5% |
| argument grammar | a `${...}` or `+` expression inside an argv element | about 4% |
| privilege disclosure | `sudo`, `pkexec`, `docker`, or `/dev/input` in argv, with whether the README mentions it | about 3% |

The percentages are the maintainer's review findings by class in a fixed
sample, one reader's classification, dated. They say how often reviewers have
raised a class, not how likely this plugin is to be blocked, and the report
words them that way.

## Options

```bash
omakit inspect <plugin-dir>            # the report
omakit inspect <plugin-dir> --json     # the document on stdout
omakit inspect <plugin-dir> --out <f>  # write the document to a file as well
omakit inspect <plugin-dir> --offline  # skip the baseline section (prints ▔ skip)
```

`<plugin-dir>` resolves the way `submit` resolves its target
(`tools/subject/resolve.mjs`): a directory, or a Git checkout whose HEAD is
recorded as the subject commit. There is no `--fix`, no `--strict`, no
threshold flag, because there is nothing to pass or fail.

## Exit status

`0` when a report was produced, whatever it observed. `2` when the target
could not be read (no directory, no manifest, nothing to inspect). There is no
exit status for "found something", because finding something is the normal
outcome and not a failure.

## The JSON contract

`--json` prints the document on stdout. The document is the API: new fields
may be added, existing fields never change meaning.
`tools/inspect/contract.mjs` is the executable form and the unit tests hold
every produced document to it.

```text
omakit            string   the omakit version that produced the document
command           "inspect"
method            string   one sentence: static extraction, regular expressions, observed
subject           { dir, commit|null, repository: { url|null }, filesRead: { qml, js, shell, python, other } }
observed          { processes[], hosts[], writes[], timers[] }
notResolvable     [{ file, line, kind, text }]   sites the extraction saw but could not read
patterns          [{ id, observedCount, sites: [{ file, line }], measurement: "M11", share: number }]
                  only patterns whose precondition was observed
lookedFor         string[]  pattern ids whose precondition was not observed
notVisible        string[]  the fixed blind-spot list above, verbatim
marketplaceBaseline
                  the `verify` section verbatim, or { skipped: true, reason } under --offline
```

A process:

```text
file, line        where the Process or command is declared
argv              string[] | null   null when not resolvable statically
argvForm          "array" | "string" | "computed"
deadline          { observed: boolean, via: "timer-kill" | "timeout-argv" | "destruction" | null, ms: number|null }
output            { collector: "StdioCollector" | "SplitParser" | "none" | "unknown", capObserved: boolean, via: string|null }
shellWrapper      boolean   true when argv[0..1] is sh -c, bash -c or eval
```

A host: `{ host, scheme, file, line, tool, timeout: { observed, via }, sizeCap: { observed, via }, flags: string[] }`.
A write: `{ file, line, path, via, controlledDirectory: "observed" | "not-observed" | "unknown", mode: string|null }`.
A timer: `{ file, line, intervalMs, repeat, running, triggeredOnStart, startedBy: string|null }`.

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
