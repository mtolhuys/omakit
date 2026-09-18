import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// npm pack measured 81,351 bytes with the machine-readable freshness evidence,
// and the first ceiling, 102,400 bytes, left 21,049 bytes for deliberate
// growth while rejecting an accidental tree. At 0.1.7 the package measured
// 102,177 bytes, 223 under that ceiling, and the fixes to the 0.1.6 review
// could not land under it, so the ceiling is 153,600 bytes: 51,423 bytes over
// the 0.1.7 measurement, still half the size of an accidental tree with a
// pin or a cache in it. With `omakit weigh` (eight modules under tools/weigh/
// and a fourth skill) the package measured 132,544 bytes, 50 files, 21,056
// under the ceiling; at 0.2.0, with the command renamed to weigh and the
// README made the door, 135,136 bytes, 50 files, 18,464 under it; at 0.2.1,
// with completion proven in a new shell, one option table, weigh --list and
// plugin ids at TAB time, 144,798 bytes, 53 files, 8,802 under it; at 0.2.2,
// with the question written whole, 145,397 bytes, 53 files, 8,203 under it.
// With `omakit audit`, three audit modules and a fifth skill, the package
// measured 150,642 bytes, 57 files, 2,958 under that ceiling. The ceiling is
// now 204,800 bytes, leaving 54,158 bytes while still rejecting an accidental
// tree with the 15 MB marketplace pin or a cache in it.
// At 0.4.0, account-wide watch and the update-notice module measured 157,417
// bytes across 58 files, leaving 47,383 bytes under the unchanged ceiling.
// With `omakit inspect`, eleven modules under tools/inspect/, the package
// measured 201,424 bytes across 72 files, 3,376 under the same ceiling. At
// 0.5.0, with the M12 measurement script (tools/inspect/measure-functions.mjs),
// the 50 listed heavy shares as data and the re-measured record's history in
// the docs, it measured 209,579 bytes across 73 files, 4,779 over it, so the
// ceiling is now 256,000 bytes: 46,421 bytes of room, still a sixtieth of an
// accidental tree with the 15 MB marketplace pin in it. With the Run block
// (blocks/run/: Run.qml, run-supervisor.py, NOTICE, and blocks/history.json),
// the three block modules under tools/blocks/ and the sixth skill, the
// package measured 233,533 bytes across 81 files, 22,467 under the unchanged
// ceiling: the block files are the deliverable a plugin copies, so they
// ship, and the lab suite and the fixtures that hold them do not. With the
// Store block (blocks/store/: Store.qml, store-helper.py, NOTICE) it
// measured 240,741 bytes across 84 files, 15,259 under the same ceiling. At
// 0.6.0, with the Run-started helper resolver (tools/inspect/helpers.mjs)
// and the README rewritten around the blocks, 247,435 bytes across 85
// files, 8,565 under it; the GIFs and captures under docs/media do not ship.
// With the blocks at 0.2.0 (the token protocol and the gate in Run, the
// string-program tables, the Store checks; the lab suites and their
// records do not ship) it measured 252,565 bytes across 85 files, 3,435
// under the same ceiling. With `omakit lab` (twenty files under
// tools/lab/: the release pin, the 632-byte armoured Omarchy signing key,
// the 351-line toolchain patch, one harness and three suites in bash, and
// the modules, and the README's fourth job) the package measured 310,081
// bytes across 105 files at the release round's end (310,059 before the
// subcommand was named prove, 309,687 before Run 0.2.1, 308,856 before
// the polish), over that ceiling by 54,081, so the ceiling is now
// 358,400 bytes: 48,319 bytes of room, still a fortieth of an accidental tree with the 15 MB
// marketplace pin in it, and a two-thousandth of the 6.26 GB ISO the lab
// never ships (tests/unit/self-containment.test.mjs sniffs every file for
// an image or archive signature).
export const MAX_PACKED_BYTES = 358_400

export const EXPECTED_PACKAGE_PATHS = Object.freeze([
  "LICENSE",
  "README.md",
  "bin/omakit",
  "blocks/history.json",
  "blocks/run/NOTICE",
  "blocks/run/Run.qml",
  "blocks/run/run-supervisor.py",
  "blocks/store/NOTICE",
  "blocks/store/Store.qml",
  "blocks/store/store-helper.py",
  "package.json",
  "skills/omarchy-plugin-audit/SKILL.md",
  "skills/omarchy-plugin-build/SKILL.md",
  "skills/omarchy-plugin-check/SKILL.md",
  "skills/omarchy-plugin-weigh/SKILL.md",
  "skills/omarchy-plugin-submit/SKILL.md",
  "skills/omarchy-plugin-validation-watch/SKILL.md",
  "tests/parity/corpus.mjs",
  "tests/parity/run.mjs",
  "tests/fixtures/weigh/clean/Widget.qml",
  "tests/fixtures/weigh/clean/manifest.json",
  "tests/fixtures/weigh/clean/tests/harness.qml",
  "tests/fixtures/weigh/idle-panel/Panel.qml",
  "tests/fixtures/weigh/idle-panel/manifest.json",
  "tests/fixtures/weigh/poller/Service.qml",
  "tests/fixtures/weigh/poller/manifest.json",
  "tests/fixtures/weigh/timer-180ms/Widget.qml",
  "tests/fixtures/weigh/timer-180ms/manifest.json",
  "tests/lab/run/harness/scenarios/controls.sh",
  "tests/lab/run/harness/scenarios/envprobe.sh",
  "tests/lab/run/harness/scenarios/forge.sh",
  "tests/lab/run/harness/scenarios/holder.sh",
  "tests/lab/run/harness/scenarios/orphan.sh",
  "tests/lab/run/harness/scenarios/stall.sh",
  "tests/lab/run/harness/scenarios/stubborn.sh",
  "tests/lab/run/harness/scenarios/tree.sh",
  "tests/lab/run/harness/shell.qml",
  "tests/lab/run/report.py",
  "tests/lab/run/suite.sh",
  "tests/lab/store/harness/shell.qml",
  "tests/lab/store/report.py",
  "tests/lab/store/suite.sh",
  "tools/audit/audit.mjs",
  "tools/audit/git.mjs",
  "tools/audit/report.mjs",
  "tools/blocks/add.mjs",
  "tools/blocks/commit.json",
  "tools/blocks/record-commit.mjs",
  "tools/blocks/registry.mjs",
  "tools/blocks/stamp.mjs",
  "tools/inspect/contract.mjs",
  "tools/inspect/functions.mjs",
  "tools/inspect/helpers.mjs",
  "tools/inspect/hosts.mjs",
  "tools/inspect/inspect.mjs",
  "tools/inspect/measure-functions.mjs",
  "tools/inspect/patterns.mjs",
  "tools/inspect/processes.mjs",
  "tools/inspect/report.mjs",
  "tools/inspect/text.mjs",
  "tools/inspect/timers.mjs",
  "tools/inspect/walk.mjs",
  "tools/inspect/writes.mjs",
  "tools/lab/guest.mjs",
  "tools/lab/harness.sh",
  "tools/lab/host.mjs",
  "tools/lab/inspect.mjs",
  "tools/lab/omarchy.gpg",
  "tools/lab/patches/omarchy-iso-test.patch",
  "tools/lab/paths.mjs",
  "tools/lab/pin.json",
  "tools/lab/pin.mjs",
  "tools/lab/prune.mjs",
  "tools/lab/qemu.mjs",
  "tools/lab/qmp-cli.mjs",
  "tools/lab/report.mjs",
  "tools/lab/run.mjs",
  "tools/lab/setup.mjs",
  "tools/lab/suites.mjs",
  "tools/lab/suites/run.sh",
  "tools/lab/suites/store.sh",
  "tools/lab/suites/weigh.sh",
  "tools/lab/verify.mjs",
  "tools/weigh/audit.mjs",
  "tools/weigh/commands.mjs",
  "tools/weigh/config.mjs",
  "tools/weigh/confirm.mjs",
  "tools/weigh/contract.mjs",
  "tools/weigh/list.mjs",
  "tools/weigh/proc.mjs",
  "tools/weigh/report.mjs",
  "tools/weigh/stats.mjs",
  "tools/marketplace/agent-control.mjs",
  "tools/marketplace/ask.mjs",
  "tools/marketplace/banner.mjs",
  "tools/marketplace/cli.mjs",
  "tools/marketplace/completion-check.mjs",
  "tools/marketplace/completion.mjs",
  "tools/marketplace/doctor.mjs",
  "tools/marketplace/effect.mjs",
  "tools/marketplace/form.mjs",
  "tools/marketplace/github.mjs",
  "tools/marketplace/issue.mjs",
  "tools/marketplace/local-transport.mjs",
  "tools/marketplace/measure-review-cost.mjs",
  "tools/marketplace/measure-staleness.mjs",
  "tools/marketplace/path-hint.mjs",
  "tools/marketplace/parity-output.mjs",
  "tools/marketplace/options.mjs",
  "tools/marketplace/paths.mjs",
  "tools/marketplace/pin.mjs",
  "tools/marketplace/plugin.mjs",
  "tools/marketplace/preflight.mjs",
  "tools/marketplace/progress.mjs",
  "tools/marketplace/README.md",
  "tools/marketplace/registry.mjs",
  "tools/marketplace/report.mjs",
  "tools/marketplace/review-cost.mjs",
  "tools/marketplace/run-baseline.mjs",
  "tools/marketplace/setup.mjs",
  "tools/marketplace/style.mjs",
  "tools/marketplace/submit.mjs",
  "tools/marketplace/tree.mjs",
  "tools/marketplace/upgrade.mjs",
  "tools/marketplace/update-check.mjs",
  "tools/marketplace/usage.mjs",
  "tools/marketplace/verify.mjs",
  "tools/marketplace/watch.mjs",
  "tools/marketplace/yaml.mjs",
  "tools/subject/resolve.mjs",
])

export function assertPackageArtifact(document) {
  if (!Array.isArray(document) || document.length !== 1) {
    throw new Error(`npm pack returned ${Array.isArray(document) ? document.length : 0} package records, expected 1`)
  }
  const artifact = document[0]
  const paths = (artifact.files || []).map((file) => file.path).sort()
  const expected = [...EXPECTED_PACKAGE_PATHS].sort()
  if (JSON.stringify(paths) !== JSON.stringify(expected)) {
    const added = paths.filter((path) => !expected.includes(path))
    const missing = expected.filter((path) => !paths.includes(path))
    throw new Error(`npm package file list changed: added [${added.join(", ")}], missing [${missing.join(", ")}]`)
  }
  if (!Number.isFinite(artifact.size)) {
    throw new Error("npm package size is missing or is not a finite number")
  }
  if (artifact.size > MAX_PACKED_BYTES) {
    throw new Error(`npm package is ${artifact.size} bytes, over the ${MAX_PACKED_BYTES}-byte ceiling`)
  }
  return {
    fileCount: paths.length,
    packedBytes: artifact.size,
    ceilingBytes: MAX_PACKED_BYTES,
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  const input = process.argv[2]
  if (!input) throw new Error("usage: node tests/package-assert.mjs <npm-pack.json>")
  process.stdout.write(`${JSON.stringify(assertPackageArtifact(JSON.parse(readFileSync(resolve(input), "utf8"))))}\n`)
}
