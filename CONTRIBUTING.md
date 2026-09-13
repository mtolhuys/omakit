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

## What the suite protects

- `tests/unit/read-only.test.mjs` proves the tool has one literal-GET HTTP call
  site, borrows only `gh auth token --hostname github.com`, and has no path that
  writes to the marketplace. Workflow YAML may write only to this repository.
- `tests/unit/self-containment.test.mjs` holds the project to plain ESM, zero
  runtime dependencies, no build, and no writes into a plugin tree.
- `tests/unit/submit.test.mjs` requires every verdict to carry its source and a
  measured reason recorded in `docs/MEASUREMENTS.md`.
- `tests/unit/style.test.mjs` and `tests/unit/cli.test.mjs` protect stdout as an
  API: a pipe has the same words, no escape sequence, and no hidden colour-only
  meaning.
- `tests/unit/pin.test.mjs` keeps every marketplace path behind the immutable
  pin and prevents a sparse checkout from quietly fetching another rule.
- `tests/package-assert.mjs`, exercised by `tests/unit/package.test.mjs`,
  compares all 40 publishable paths and enforces a 102,400-byte tarball
  ceiling against the measured 81,351-byte baseline when CI feeds it
  `npm pack --dry-run --json`.
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

## Commit messages

Use a short imperative subject that states the measured reason for the change,
not a list of files or a paraphrase of the diff. For example:

```text
Keep the package within 21,049 bytes of its measured baseline
```

Do not add assistant attribution, session links, `generated with` lines or
model co-author trailers. Keep each commit green; a red commit is not a useful
unit for review or bisection.
