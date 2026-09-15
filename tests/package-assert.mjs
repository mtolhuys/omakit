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
export const MAX_PACKED_BYTES = 204_800

export const EXPECTED_PACKAGE_PATHS = Object.freeze([
  "LICENSE",
  "README.md",
  "bin/omakit",
  "package.json",
  "skills/omarchy-plugin-audit/SKILL.md",
  "skills/omarchy-plugin-check/SKILL.md",
  "skills/omarchy-plugin-weigh/SKILL.md",
  "skills/omarchy-plugin-submit/SKILL.md",
  "skills/omarchy-plugin-validation-watch/SKILL.md",
  "tests/parity/corpus.mjs",
  "tests/parity/run.mjs",
  "tools/audit/audit.mjs",
  "tools/audit/git.mjs",
  "tools/audit/report.mjs",
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
