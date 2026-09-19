# Blocks: plan for the change of direction

Status: plan, not an implementation claim. Branch `feature/blocks`, cut from
`main` at `8150265` (0.5.1) on 2026-09-17. Nothing here is released.

## The change in one paragraph

omakit today tells a plugin author what the marketplace would refuse. From
here it also hands them the plumbing the review blocks most, built and tested
once: small files a plugin copies into its own tree with `omakit add`, that
start processes and keep state the way the review asks for. The checks stay;
they become the second half of the story. The name stays too: it was always
a kit.

## Why, measured

Source: [M13 evidence](../evidence/blocks/2026-09-17-review-blockers.json), the
latest 6,000 comments on `omacom/omarchy-plugin-marketplace`, 2026-09-10 to
2026-09-17, classified per comment. Every figure below is in that file.

| Finding | Figure |
| --- | --- |
| Maintainer comments in 6.7 days, one account | 1,530 |
| Of those, a security blocker | 1,001 |
| Of those, the validated commit is behind | 292 |
| Blocker comments saying an earlier round still blocks | 527 of 1,008 |
| Main class: executables through PATH and the inherited environment | 254 |
| Main class: file and state boundary | 240 |
| Main class: unbounded output | 141 |
| Security blocker comments where a bounded process runner handles at least one raised blocker | 581 of 1,001 |
| Same, runner plus private state store | 777 of 1,001 |
| Issues whose every security blocker comment is handled by runner plus store | 465 of 668 |
| Comments where the reviewer asks for a fixed or verified helper himself | 235 |
| Author comments reporting a fix, and reporting a new commit | 853 and 416 of 1,438 |

Read the coverage rows as an upper bound: a block handles a comment when at
least one blocker in it is that block's plumbing, not when the comment is
resolved. On 2026-09-12 the question for building primitives at all was
whether more than seventy percent of review findings are plumbing a runtime
can own; 777 of 1,001 is 78%.

Traction of the current positioning, for the record: 1 star, 12 unique
visitors and no issue from anyone else in the first five days.

## What exists already, checked 2026-09-17

| Project | What it gives | What it does not |
| --- | --- | --- |
| `wbso-ai/omarchy-plugin-security-skill` (72 stars, MIT, last commit 2026-09-07) | One SKILL.md with rules from about 5,500 review comments and an appendix of helper shapes reviewers accepted: descriptor-bound state file (Python), supervised command (bash), pinned fetch, bounded QML process, signal by pidfd | Versioned files, tests, updates, or a way for tooling to recognise an unmodified helper. Two of its early commits fixed copy-paste helpers that reopened the boundaries they were meant to close. |
| `tcballard/build-omarchy-plugins` (48) | Agent workflow, scaffolding templates, process-safety guidance | Tested runtime code for the boundaries |
| `ussego/oma` (0) | JS to QML SDK and CLI | Anything about the review boundary |
| `nunomaduro/omarchy-plugin-template` (0) | Lint, format and test template | Runtime plumbing |
| `tuthan/omasafe` and its skill | What an installed plugin can do, for users | Anything for authors |

The gap, stated narrowly: accepted shapes exist as text to copy. Nobody ships
them as tested, versioned files that can be added, updated and recognised.
That is what blocks are.

## What a block is

- A small set of files under `omakit/` in the plugin's tree, for example
  `omakit/Run.qml` plus a supervisor helper if the spike needs one.
- Every file starts with a header: block name, block version, SPDX licence
  (MIT), copyright, the omakit commit it came from, and the sha256 of the
  file body. `omakit/NOTICE` lists the same per file, which covers the
  review's vendored-code expectation (record the upstream commit, keep the
  licence, disclose modifications).
- No binaries (the baseline turns one into a `bundled-executable-binary`
  capability), no agent-control files, no network at runtime, no dependency
  outside a stock Omarchy install. Helpers run by absolute path with a closed
  environment.
- Added and updated only by an explicit command. Never overwritten when the
  copy was modified; the command says so and stops.
- Recognised by `omakit inspect`: an unmodified block is one row with its name
  and version and raises no pattern rows on its own lines; a modified block is
  reported as modified.

### Run (first)

Starts one program for a plugin and always ends it. Draft contract, to be
fixed by the spike and written to `docs/BLOCKS.md`:

- absolute executable path required, argv only, no shell string;
- `clearEnvironment` with a small explicit environment;
- hard deadline, then TERM, a short grace, KILL, for the whole process group,
  and the leader is reaped last;
- stdout and stderr capped in bytes and lines while reading, never clipped
  after exit; overflow ends the run;
- cancel on destruction and on supersession;
- one result object with a closed set of end states (ok, exit code, timeout,
  overflow, cancelled, spawn failed) and bounded stderr text meant for
  `Text.PlainText`.

Every requirement cites how many blocker comments raise it, counted over the
M13 working set by a committed script.

### Store (second)

Private state and cache for a plugin: a 0700 directory under the XDG base,
descriptor-relative no-follow opens, regular-file and owner checks, a size cap
on read, exclusive 0600 temp plus atomic replace on write, no `/tmp`, schema
check on parse. Same header, test and recognition rules as Run.

### Later, in M13 order, only after the evaluation gate

Pinned artifact installer (336 comments), safe fetch (207), secrets (203),
plain text (140). Not planned before the evaluation on 2026-10-15.

## Phases and gates

Dates are targets. A gate that fails stops the next phase; it does not move
the date.

| Phase | Window | Output | Gate |
| --- | --- | --- | --- |
| 0. Direction | 17 Sep | This plan, M13 evidence, branch | Maarten's decisions below |
| 1. Run spike | 18 to 20 Sep | A throwaway plugin on a real Quattro shell that proves one Run design against five scenarios: a producer writing 1 GB, a descendant holding the pipe open, a program that ignores TERM, a hostile PATH and environment, destroying the component mid-run. Plus: is `/usr/bin/python3` present on a stock 4.0.3 install (lab VM), and does `SplitParser` with an empty marker give byte counts before memory grows | G1: all five scenarios end within deadline plus grace, no orphan survives, no process group signalled after reap; design choice (pure QML with absolute `setsid`/`kill`, or QML plus a Python or bash supervisor) written down with the measurements |
| 2. Run 0.1 | 21 to 26 Sep | `docs/BLOCKS.md` Run contract with M13 counts, `blocks/run/`, lab tests from the spike made repeatable, `omakit add run [dir]` with `--update`, header and NOTICE, inspect recognition, skill `omarchy-plugin-build` (use Run whenever code starts a process), package ceiling re-measured | G2: lab suite green on the desktop, unit suite green in CI, inspect over a fixture using Run shows no process pattern row at its sites, `add` refuses a modified copy |
| 3. Proof, Run | 24 Sep to 30 Sep | Theme Manager's 26 QML `Process` blocks ported to Run on its own branch (inspect on 2026-09-17: 23 process-lifecycle sites, 18 unbounded-buffering sites), checked with verify, submit and inspect before and after. Done 2026-09-17 on `run-port` ([BLOCKS.md](../BLOCKS.md), the first port): 0 and 0 after, 24 of 24 sites with a deadline through the block, the fetch blocker proven against hostile repositories. Submitted only once the Run port and the fetch fix are both in, on the default branch, by Maarten | G3: submitted; the reviewer's outcome is recorded whatever it is. Nobody is asked to look |
| 4. Store 0.1 and its proof | 26 Sep to 6 Oct | Same as phase 2 for Store, starting from the plugin's own cache transaction (0.5.15: owner-checked no-follow directory descriptors, descriptor-relative atomic publication), which drew no further file-state comment in review; then Theme Manager's catalog cache and theme directory writes ported to it (two of its four blocker comments in the M13 week were file and state) | G2 for Store, and the Store port submitted |
| 5. Rebrand release 0.6.0 | when G2 (Run) holds and the port is finished with its before and after measured, target 1 Oct; the submission and its outcome are not a gate | README, package metadata, docs, skills, banner and GIFs per the section below; release notes; npm and AUR by Maarten | Maarten reads the README and says ship |
| 6. Show | from release | One data-led post (M13 aggregate, what Run is, how to add it), reply where builders already talk, the Sunday Space, offer a pointer PR to the skills that carry copy-paste helpers. Optional, about a day: an `action.yml` in this repository (no separate package) that runs `verify`, `inspect` and the block check on push, and in the job summary says when an open marketplace issue validated an older commit than the one pushed | none |
| Evaluation | 15 Oct | Three signals: Theme Manager's ported commits reviewed without a process or state blocker; someone else's plugin using Run; an unprompted outside signal (star, issue, reference, a mention by the maintainer) | Two of three: continue with Store and the next block. None: stop building blocks, offer Run upstream as a pull request instead |

### GitHub Action, checked 2026-09-17

In a random sample of 60 plugin repositories from the pinned registry (2,964
repositories), 14 have any workflow in `.github/workflows`. An existing Action,
`duclucky/omarchy-plugin-ci` (1 star, beta since 2026-08-23), checks manifest,
QML contract, capabilities and lifecycle; a code search found no workflow
using it. What an omakit Action would add that it does not: the marketplace's
own baseline at the pushed commit, the stale-validation notice at the moment a
push makes it stale (292 maintainer comments in the M13 week), and a check
that vendored blocks are unmodified and current. It stays read-only: it never
edits or comments on a marketplace issue, because a re-triggered validation
lands in the maintainer's queue.

## Rebrand

### What changes

| Surface | From | To |
| --- | --- | --- |
| One line | "runs the marketplace's own checks locally, watches your submission and posts nothing" | "Tested building blocks for the plumbing Omarchy plugin reviews block most, and the checks for the rest." Two alternatives for Maarten below |
| README order | submit, inspect, watch, audit, weigh, verify, doctor | Build (`add run`, `add store`), Check (`inspect`, `verify`, `submit`), Track (`watch`), More (`audit`, `weigh`, `doctor`, `setup`) |
| README lead evidence | stale commits (M6) | M13 rows: 1,001 blockers, runner 581, runner plus store 777, with the upper-bound sentence |
| `package.json` | "The safe place to find out" description, preflight keywords | Blocks first in description; keywords add `building-blocks`, `qml`, `quickshell` |
| AGENTS.md | five skills, rule 2 "never write down a marketplace rule" | six skills; rule 2 amended: a block implements behaviour measured from public review comments (M13) and says so, it never presents itself as the marketplace's rules, and marketplace facts are still read from the pin |
| Skills | check, submit, watch, weigh, audit | plus `omarchy-plugin-build`; `check` points at blocks when inspect shows a process or state pattern |
| Media | banner, six GIFs | banner scene with the new line; GIF of `omakit add run` then inspect before and after |
| Docs | COMMANDS, MARKETPLACE "audience" | `docs/BLOCKS.md` contract; MARKETPLACE audience section rewritten around blocks; this plan removed or moved to history at release |

### What does not change

The name, the MIT licence, zero dependencies (blocks are files a plugin owns,
not a dependency), read-only against the marketplace, posts nothing, every
number measured, palette indices, no assistant or vendor names in the tree,
the author signs every commit.

### Words we do not use

"passes review", "approved", "safe", "secure", "certified", "official". The
marketplace itself says its checks are not a security audit; a block cannot
claim more. Allowed: what the block does, and the M13 count of comments that
raise it.

### Risks

| Risk | What we do |
| --- | --- |
| Run itself gets a blocker in review | Phase 3 finds it on our own plugin first; a blocker becomes a fix plus a test plus a changelog line |
| Omarchy or the marketplace ships its own helper or a safe process API | Offer Run upstream; the evaluation's fallback is exactly that |
| Review policy moves (PATH resolution already moved to hardening for same-UID cases in September) | Re-measure M13 weekly with the same questions; the pin watcher already reports validator changes |
| Copying the accepted shapes from the existing skill | Write from the review wording and our own tests; where a shape is taken from that MIT skill, credit it in NOTICE |
| Scope creep back into seven commands | No new check command until the evaluation |
| A block encodes a rule that later changes | Blocks are versioned; `omakit add <block> --update` and inspect's version row make an old copy visible |

## Decisions, 2026-09-17

1. The name stays omakit.
2. The working line was superseded by the release positioning. No alternative remains open.
3. The command is `omakit add run`, `omakit add store`, with `--update`.
4. Theme Manager is the proof plugin for both blocks: the author's most popular plugin, 26 QML `Process` blocks, and an open review with two file-state blockers and one unbounded-fetch blocker in the M13 week. Its supply-chain blocker (mutable catalog entries into theme install) is not a block's job and is fixed on its own.
5. The Sunday Space of 20 Sep shares the idea and where it is heading, from the M13 aggregate. No request for testers and no dates.
6. The rebrand ships as 0.6.0. 1.0.0 waits until it holds without exception: Run and Store each through at least three real reviews with no process or state blocker, the lab suite green on two Omarchy releases, no open blocker on any of the author's plugins, and at least one plugin by someone else using a block in the catalog.

## Known limit of the proof plugin

Theme Manager's tree has 469 shell lines that start programs, and Run only
owns the boundary where QML starts one. Programs a shell helper starts inside
itself still need absolute paths and a closed environment in that helper.
The spike records whether Run should offer a small shell prelude for that, or
leave it to the author with a pointer.
