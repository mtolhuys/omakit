# Design note: `omakit inspect`

Written 2026-09-15 on `feature/inspect`, before any code. `docs/INSPECT.md`
is the contract a user reads; this note is the reasoning an implementer
reads, and the list of numbers each pattern rests on. When the two disagree,
the contract wins and this note is corrected.

## Where it comes from

The archived 0.1 framework had a "Passport": a per-commit dossier meant to
hand a reviewer the facts of a plugin. Its assessment (2026-09-11) found that
it reported the wrong subject (the framework's own repository), missed the
plugin's only executable, counted a README sentence containing a command name
as a "process and command" observation, found zero filesystem paths, printed
counts per category instead of what was observed, and claimed evidence it had
not gathered. `inspect` is the same idea with those failures designed out:

| Passport did | `inspect` does |
| --- | --- |
| subject was the framework repo | subject is the plugin directory, resolved by `tools/subject/resolve.mjs` like `submit` |
| executables by extension or `bin/` only | every file with a shebang or the exec bit, plus every `Process` and shell site |
| hits per file, README included | sites per occurrence with `file:line`; prose never read for facts |
| "Observed count: 6" | the six things, each on its own row |
| `evidenceDigest: null` under a "tests" heading | no evidence section at all; a lab is a separate decision |
| a schema that validated nothing | `tools/inspect/contract.mjs`, executable, held by the unit tests |

And one thing the Passport did right that stays: it never said "safe" or
"approved". `inspect` goes one step further and never says "ok" either.

## Why observations and not findings

`forge check` and the marketplace baseline both produce findings with a
severity. That is the right shape for a rule with a known false-positive rate
and a known remedy. It is the wrong shape for "this plugin starts three
processes", which is neither good nor bad, and for "no deadline observed",
which a regex can only claim about what it saw. So the report is a list of
facts that a reviewer would otherwise gather by hand, and a list of review
classes whose precondition those facts show. Deciding is left to the two tools
that already decide.

The same choice removes a whole category of argument with the marketplace: a
tool that prints "unbounded buffering: FAIL" is a second policy, and the
second rule of `AGENTS.md` forbids writing a marketplace rule down. A tool
that prints "observed a collector with no cap; reviewers raised this class in
about 19 of 100 findings" states a fact about the tree and a fact about the
review history, and nothing else.

## Extraction, per kind of fact

All regular expressions, all over the raw text, all line-numbered. No QML
parser (zero dependencies, and a parser would invite the claim of
completeness that the "observed" label exists to refuse). Each extractor is a
pure function from `{ path, text }` to rows, tested on fixtures.

Processes. A `Process {` block, or a `command:` property, or `.command =`.
Inside the block: `command: [ ... ]` gives an argv array when every element
is a string literal; a string literal gives `argvForm: "string"`; anything
else gives `"computed"` with `argv: null` and a `▒ ?` row. A `running: true`
or `.running = true` or `.startDetached(` records that it starts. Deadline:
a `Timer` in the same file whose `onTriggered` body contains `<id>.kill()`,
`<id>.signal(` or `<id>.running = false`, with that timer's `interval`; or
`timeout` as `argv[0]` (with its seconds); or `Component.onDestruction`
containing the same call. Output: `stdout: StdioCollector`, `SplitParser`,
or none; cap: `head -c`, `--max-filesize`, `timeout` anywhere in argv.
Shell wrapper: `argv[0]` in `sh`, `bash`, `zsh` with `-c` next, or `eval`
in a shell file.

In shell files: every line that is not a comment is a command site; argv is
the whitespace split of the line up to the first unquoted `|`, `;`, `&&`,
`||` (quoted strings kept whole). Pipes are recorded as separate sites with a
`pipedFrom` reference. This is crude and says so.

Hosts. A `https?://` literal anywhere in code or argv gives the host and
scheme. The tool is the argv element before it, or `XMLHttpRequest`, `fetch`
when the literal sits in JS. Flags come from the same argv: `--max-time`,
`-m` (timeout), `--max-filesize` (size cap), `-q`, `-L`, `--proto`. A host in
a variable is not a host; a `${...}` inside the literal makes the row
`▒ ?`.

Writes. `FileView { path: ... }` with `writeAdapter` or `setText`/`write`
calls; in shell, `>`, `>>`, `tee`, `cp`, `mv`, `mkdir`, `mktemp`, `install`,
`touch` with the following path; in JS, `writeFile`, `writeFileSync`,
`appendFile`. Controlled directory: the path's literal prefix, after
expanding `$HOME`/`~` and the `XDG_*` names, is compared with the four
prefixes in `docs/INSPECT.md`; a path that starts with a variable is
`unknown`; `/tmp`, `/var/tmp`, `/dev/shm` are `not-observed`. Mode:
`-m`/`--mode` on `mkdir`/`install`, `chmod` on the same path within the file,
`umask` in the file.

Timers. `Timer {` blocks with `interval`, `repeat`, `running`,
`triggeredOnStart`; `startedBy` is the nearest `<id>.start()` or
`<id>.running = true` outside the block, by handler name. An interval that
is an expression is `▒ ?` with the expression text.

Capabilities. `marketplaceBaselineSection()` from `tools/marketplace/verify.mjs`,
verbatim, under `--offline` skipped with the mark `▔ skip`. For a plugin
directory below the root of a larger repository the section is asked for
that directory (`subdir`), and the local transport serves the commit's
`<sha>:<subdir>` tree as the whole tree, paths relative to it, so the
official code scans the plugin and not the repository around it. Measured
before this: `inspect tests/fixtures/inspect/example` in this repository
reported this repository's own installer and privilege evidence as the
fixture's, the Passport's first failure in a new place. `verify` and
`submit` still scan the root, which for them is the repository the
marketplace would fetch.

## The patterns, each with its number and source

A pattern row prints only when its precondition is in the observed facts.
The share is cited from M11 in `docs/MEASUREMENTS.md`; the capability counts
are M4. No pattern ships without a row in this table, and the unit test that
holds every `submit` check to a `why` with a figure is extended to hold every
`inspect` pattern to a `measurement` and a `share`.

| id | Precondition in the facts | Number | Source |
| --- | --- | --- | --- |
| `process-lifecycle` | a QML process row with `deadline.observed: false`; not an `execDetached` call, which has no deadline by design, and not a shell line | about 20% of findings | M11 |
| `unbounded-buffering` | a process row with a collector and `output.capObserved: false` | about 19% | M11 |
| `file-and-state-boundary` | a write row with `controlledDirectory: "not-observed"`, or a temp path without `mktemp`, or `mkdir` without a mode | about 15% | M11 |
| `environment-trust` | a process row whose tool word (after `sudo`, `env`, `timeout` and the other wrappers) has no slash, shell builtins excepted, or `curl` without `-q` | about 7% | M11 |
| `secrets` | an argv element or `console.log` argument matching the secret-shaped list | about 7% | M11 |
| `supply-chain` | a finding the baseline recorded and does not list as selectively blocking at the pin, which at pin `70dcc454` is exactly `remote-git-execution-unpinned`, `curl-pipe-shell` and `cargo-git-unpinned`; the set is read from the pinned policy through `verify`, so no rule id is written into `tools/inspect/` | about 7% of findings; 21 findings ever recorded across 2,916 baselined listings, 11 and 10 of them these two rules | M11, M4 |
| `network-egress` | a host row with scheme `http`, or `-L` without `--proto`, or a private literal address | about 5% | M11 |
| `untrusted-text-to-display` | a `Text` bound to a collector's `text` without `textFormat: Text.PlainText` | about 5% | M11 |
| `argument-grammar` | a process row with an interpolated or concatenated argv element | about 4% | M11 |
| `privilege-disclosure` | `sudo`, `pkexec`, `docker`, `/dev/input` in argv; whether the README names it | about 3% of findings; `privilege` recorded on 639 listings | M11, M4 |

What is deliberately not a pattern, because no number exists for it: code
style, naming, missing states, hard-coded colours, missing README sections.
`forge check` covers the last three and `inspect` points at it in the docs
rather than duplicating it. The "agent-control files" check (M3) stays in
`submit`, where it already is.

## Wording of a pattern row

In the `--full` view, two lines, always the same shape (the default view
prints the same class with its share and summary as a block heading, the
sites under it, up to five, and the fact at each site):

```text
▓ note  <class, padded>  observed <count> <thing> (<file:line>[, ...])
        about <N> of every 100 review findings in the sample (M11)
```

Never "missing", never "should", never "fix". The remedy lives in the
reviewer's own words in M11 and in `docs/INSPECT.md`; the row names the
observation and the frequency and stops. An agent that wants the remedy
reads the table; the row is not the place to teach.

## Module layout

```text
tools/inspect/
  inspect.mjs      the command: resolve the subject, walk the tree, run the extractors, run verify, build the document
  walk.mjs         the installable tree (reuse tree.mjs) filtered to the file kinds inspect reads, shebang and exec-bit detection
  processes.mjs    Process/command extraction, QML and shell
  hosts.mjs        URL literals and their flags
  writes.mjs       write sites and the controlled-directory test
  timers.mjs       Timer blocks
  functions.mjs    every function, handler, shell function and def with its lines, nesting and branches; the M12 thresholds sit in patterns.mjs as data
  patterns.mjs     the table above as data: id, label, precondition function, measurement, share, the "not observed" phrase
  text.mjs         the text primitives the extractors share: line numbers, brace blocks, a property's value, string and array literals, the crude shell word split
  contract.mjs     the executable JSON contract
  report.mjs       the terminal rendering, marks through style.mjs only: the compact view a person reads by default, the exhaustive one behind --full
tests/fixtures/inspect/<name>/   one small plugin per fact kind and per pattern
tests/fixtures/inspect/<name>.expected.json   the document each fixture produces, compared field by field
tests/fixtures/inspect.mjs       materialises a fixture into a temporary Git repository with an origin, like every other check reads a plugin
tests/unit/inspect.test.mjs      extractors on fixtures, document against the contract, plain(coloured) === uncoloured, exit codes
```

Everything under `tools/inspect/` is held by `tests/unit/read-only.test.mjs`
(no writes, no network calls of its own) and `tests/unit/self-containment.test.mjs`
(no file-copying primitive) like every other module. `style.test.mjs` already
fails on a status word or a block glyph outside `style.mjs`; the verdict word
`INSPECTED` is added there, once.

## Fixtures

One directory per case, each a minimal plugin with a `manifest.json` and one
or two files, small enough to read in a minute:

- `nothing`: a widget with no process, host, write or timer. The report must
  say "observed nothing of this kind" four times and print no pattern.
- `process-with-deadline`: argv array, Timer that kills, StdioCollector with
  `head -c` in the pipe. No pattern rows.
- `process-without-deadline`: the same without the Timer and without the cap.
  Two pattern rows.
- `computed-command`: `command: root.cmd`. One `▒ ?` row, no argv.
- `shell-wrapper`: `["bash", "-c", "..."]`. `shellWrapper: true`.
- `curl-with-caps` and `curl-without-caps`: one host each; the flags differ.
- `http-host`: an `http://` literal. `network-egress`.
- `write-state` and `write-tmp`: FileView under `$XDG_STATE_HOME`, and a
  shell redirect to `/tmp`.
- `timer-180ms`: reuse `tests/fixtures/weigh/timer-180ms`; the interval must
  read `180`.
- `secret-in-argv`: `Authorization: Bearer` in a curl argv. `secrets`.
- `richtext-sink`: a `Text` bound to collector output without `textFormat`.
- `installer-unpinned`: a `scripts/install.sh` with an unpinned `git clone`,
  so the baseline's `remote-git-execution-unpinned` evidence appears and the
  `supply-chain` row cites it rather than re-detecting it.
- `privileged-argv` and `computed-argv-element`, added because no fixture
  above shows the `privilege-disclosure` and `argument-grammar`
  preconditions: `sudo docker` in an argv the README names, and an argv
  element built from a property.
- `example`: the tree behind the example block in `docs/INSPECT.md`, so the
  document's example is real output and the test that compares it stays a
  diff.
- `long-function`: one QML function and one shell function over the M12
  thresholds beside short ones, for the size block.

Each fixture's expected document is committed as JSON next to it, and the
test compares the produced document field by field, so a change in
extraction is a visible diff.

## Evidence for the release notes

Before `inspect` is released, it is run over the listed plugins that
`omakit audit` already sees on the author's desktop (18 third-party trees on
2026-09-15) and the counts are recorded under `docs/evidence/inspect/` with
the date: how many processes, hosts, writes and timers the extraction found
per plugin, how many `▒ ?` rows, and how many pattern rows. That is the
number the README sentence for `inspect` is allowed to use, and it is a count
of what the extraction saw, not of what the plugins do. No plugin is named in
the README.

## Out of scope, and why

Following a command into a second script it calls (data flow). Resolving
QML property bindings across files (a parser). Any run-time observation (the
lab). Any verdict (the two tools that have one). A fix mode (the tool never
writes into a tree). These are not "later"; they are the boundary that keeps
"observed" true.
