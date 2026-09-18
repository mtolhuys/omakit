# Contributing to Omakit

Omakit's invariants are part of the product. Read them before changing code;
the structural tests turn the same rules into failures, but prose is the first
place a contributor should meet them.

## Branches and releases

This repository is trunk-based. `main` is always releasable, every change lands
through a short-lived branch and pull request, and there is no `develop` branch.
A `v*` tag on `main` makes a release; the tag is the release decision, not a
second branch or a later stabilization step.

## Run the project

Omakit has zero runtime dependencies and no build step. Node 22 or newer and
Git are sufficient:

```bash
./bin/omakit pin
npm test
npm pack --dry-run
```

The first command fetches the immutable marketplace commit used by the suite.
The test command uses Node's built-in test runner. The pack command shows the
exact publishable file list and measured archive size without publishing it.

Before opening a pull request, run all three commands.

## Repository layout

`tools/marketplace/README.md` is the module map: one row per file under
`tools/`, with what each reads and never writes. `AGENTS.md` at the root is
guidance for coding agents working on omakit itself; it is not in the npm
package (`tests/package-assert.mjs` proves it), and omakit is not a plugin, so
the `tree.agent-control` note, which is about a plugin's installable tree, does
not apply to it.

## What the suite protects

- `tests/unit/read-only.test.mjs` proves the tool has one literal-GET HTTP call
  site, borrows only `gh auth token --hostname github.com`, and has no path that
  writes to the marketplace. Workflow YAML may write only to this repository.
- `tests/unit/self-containment.test.mjs` holds the project to plain ESM, zero
  runtime dependencies, no build, no writes into a plugin tree, and no
  disk image or archive anywhere in the tree: the lab ships the ability to
  acquire a lab, never an ISO or a base.
- `tests/unit/lab.test.mjs` holds `tools/lab/` to the guest: the argument
  lists QEMU and SSH are started with, the binaries that may be spawned,
  and no word that reaches the host's own session outside an ssh command.
- `tests/unit/submit.test.mjs` requires every verdict to carry its source and a
  measured reason recorded in `docs/MEASUREMENTS.md`.
- `tests/unit/style.test.mjs` and `tests/unit/cli.test.mjs` protect stdout as an
  API: a pipe has the same words, no escape sequence, and no hidden colour-only
  meaning. Pipes compose at 80 columns; terminals use their available width,
  up to 120 columns. Responsive tests preserve the text at each width. Two
  rules qualify that, each with its reason, and the tests say the same:
  - Text that will be posted verbatim is never wrapped and may exceed 80
    columns: the marketplace's own baseline report, and the issue body
    rendered from the pinned form. A wrapped body would not be the body. The
    width test names both regions by their section heading, asserts each is
    the `--json` text line for line, and holds every other line to 80.
  - stderr carries interactive decoration, the progress line and the
    chooser, only when stderr is a TTY. A piped stderr is empty on success;
    failures go to stderr always. The three-way test asserts the empty pipe,
    and a pseudo-terminal test (util-linux `script`, skipped where it is
    absent) asserts that a successful `doctor` puts nothing but the progress
    sequences on a terminal's stderr.
- `tests/unit/pin.test.mjs` keeps every marketplace path behind the immutable
  pin and prevents a sparse checkout from quietly fetching another rule.
- `tests/package-assert.mjs`, exercised by `tests/unit/package.test.mjs`,
  compares all 57 publishable paths and enforces a 204,800-byte tarball
  ceiling when CI feeds it `npm pack --dry-run --json`. The ceiling exists to
  refuse an accidental tree (a pin, a cache, a fixture) rather than to hold
  the package at a size: it was 102,400 bytes against the measured
  81,351-byte baseline, and was raised at 0.1.8 when the package measured
  102,177 bytes at 0.1.7 and the fixes to the 0.1.6 review did not fit under
  it. With audit, the measured 150,642-byte, 57-file package left 2,958
  bytes under the previous 153,600-byte ceiling; the current ceiling leaves 54,158 bytes above
  that audit baseline. The measurements are recorded beside the assertion.
- `tests/unit/workflows.test.mjs` holds workflow actions, permissions, secrets,
  triggers and GitHub write boundaries to the policy described here.

These tests are intentionally structural. A review should not have to infer
from good intentions that a second fetch call, an unpinned action or a new
runtime package is harmless.

## Tests belong to the change

Every behavioural change lands with a test that fails without it. Run that test
against the unmodified behaviour first when practical; a test that was already
green cannot prove the new behaviour. Documentation-only changes still run the
full suite because documentation and packaged file selection are checked as
part of the repository tree.

Do not update the marketplace pin as a side effect. Its separate procedure is
in `docs/UPSTREAM_CONTRACT.md` and ends with a 30-repository parity proof.

## Debts

None open. The last one, strict argument checking for every command, closed
when `tools/marketplace/options.mjs` became the one table the help
signatures, the completion scripts and the parser are held to
(`tests/unit/options.test.mjs`); an undocumented `--profile marketplace`
pair that `verify` used to filter out went with it.

## Commit messages

Use a short imperative subject that states the measured reason for the change,
not a list of files or a paraphrase of the diff. For example:

```text
Keep the package within 21,049 bytes of its measured baseline
```

The author signs the work and nothing signs under it: no `Co-authored-by`
trailer at all, no trailer whose key ends in `-by` or `-session` or starts with
`Generated`, no "Generated with [...]" line, and no `[bot]` or `noreply@`
identity other than GitHub's own; `tests/unit/hygiene.test.mjs` holds the whole
history to that, by shape and without naming any tool. Keep each commit green;
a red commit is not a useful unit for review or bisection.
