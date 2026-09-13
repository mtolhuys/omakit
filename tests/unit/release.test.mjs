import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")
const steps = workflow.split("      - name: ").slice(1)
const script = (step) => step.split("        run: |\n")[1]?.split("\n").filter((line) => line.startsWith("          ")).map((line) => line.slice(10)).join("\n")
const registry = script(steps.find((step) => step.startsWith("Inspect an existing npm version")))

for (const [name, status, output, error, expectedStatus, decision] of [
  ["a missing version publishes without any npm token", 1, "", "npm error E404", 0, "publish=true\n"],
  ["an identical version can be rerun without republishing", 0, '"sha512-exact"', "", 0, "publish=false\n"],
  ["different bytes at the same version fail", 0, '"sha512-other"', "", 1, ""],
  ["a registry outage fails instead of silently skipping", 1, "", "npm error E503", 1, ""],
  ["an authentication failure is not treated as a missing version", 1, "", "npm error E403", 1, ""],
]) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), "omakit-release-test-"))
    try {
      mkdirSync(join(root, "release-assets"))
      writeFileSync(join(root, "release-assets/npm-integrity.txt"), "sha512-exact\n")
      const resultFile = join(root, "output")
      writeFileSync(resultFile, "")
      writeFileSync(join(root, "npm"), '#!/bin/bash\nprintf "%s" "$MOCK_OUTPUT"\nprintf "%s" "$MOCK_ERROR" >&2\nexit "$MOCK_STATUS"\n', { mode: 0o755 })
      const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_OUTPUT: resultFile, VERSION: "0.1.1", MOCK_OUTPUT: output, MOCK_ERROR: error, MOCK_STATUS: String(status) }
      delete env.NPM_TOKEN
      delete env.NODE_AUTH_TOKEN
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", registry], { cwd: root, env, encoding: "utf8" })
      assert.equal(result.status, expectedStatus, result.stderr)
      assert.equal(readFileSync(resultFile, "utf8"), decision)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("every release shell block parses before it runs in CI", () => {
  for (const step of steps) {
    const body = script(step)
    if (!body) continue
    const result = spawnSync("bash", ["-n"], { input: body, encoding: "utf8" })
    assert.equal(result.status, 0, `${step.split("\n")[0]}: ${result.stderr}`)
  }
})

test("the publish job uses OIDC without static token configuration", () => {
  const publish = workflow.split("\n  publish:")[1].split("\n  github-release:")[0]
  assert.match(publish, /id-token: write/)
  assert.doesNotMatch(publish, /NPM_TOKEN|NODE_AUTH_TOKEN|registry-url:/)
  assert.match(publish, /npm publish .*--provenance --access public/)
})
