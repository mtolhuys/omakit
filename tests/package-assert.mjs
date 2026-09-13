import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// npm pack measured 81,351 bytes with the machine-readable freshness evidence.
// The 102,400-byte ceiling leaves 21,049 bytes for deliberate growth while
// rejecting an accidental tree.
export const MAX_PACKED_BYTES = 102_400

export const EXPECTED_PACKAGE_PATHS = Object.freeze([
  "LICENSE",
  "README.md",
  "bin/omakit",
  "package.json",
  "skills/omarchy-plugin-submit/SKILL.md",
  "skills/omarchy-plugin-validation-watch/SKILL.md",
  "tests/parity/corpus.mjs",
  "tests/parity/run.mjs",
  "tools/marketplace/agent-control.mjs",
  "tools/marketplace/ask.mjs",
  "tools/marketplace/banner.mjs",
  "tools/marketplace/cli.mjs",
  "tools/marketplace/completion.mjs",
  "tools/marketplace/doctor.mjs",
  "tools/marketplace/effect.mjs",
  "tools/marketplace/form.mjs",
  "tools/marketplace/github.mjs",
  "tools/marketplace/issue.mjs",
  "tools/marketplace/local-transport.mjs",
  "tools/marketplace/path-hint.mjs",
  "tools/marketplace/parity-output.mjs",
  "tools/marketplace/paths.mjs",
  "tools/marketplace/pin.mjs",
  "tools/marketplace/plugin.mjs",
  "tools/marketplace/preflight.mjs",
  "tools/marketplace/progress.mjs",
  "tools/marketplace/README.md",
  "tools/marketplace/registry.mjs",
  "tools/marketplace/report.mjs",
  "tools/marketplace/run-baseline.mjs",
  "tools/marketplace/setup.mjs",
  "tools/marketplace/style.mjs",
  "tools/marketplace/submit.mjs",
  "tools/marketplace/tree.mjs",
  "tools/marketplace/upgrade.mjs",
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
