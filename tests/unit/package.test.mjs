import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { REPO_ROOT } from "./helpers.mjs"
import { assertPackageArtifact, EXPECTED_PACKAGE_PATHS, MAX_PACKED_BYTES } from "../package-assert.mjs"

test("the reviewed package shape reports its measured baseline and chosen ceiling", () => {
  const files = EXPECTED_PACKAGE_PATHS.map((path) => ({ path }))
  const result = assertPackageArtifact([{ files, size: 81_351 }])
  assert.equal(result.fileCount, 133)
  assert.equal(result.packedBytes, 81_351)
  assert.equal(result.ceilingBytes, MAX_PACKED_BYTES)
})

test("the real npm pack matches the reviewed list, so a new file cannot reach a release unlisted", () => {
  // Measured: v0.1.3's release run failed in CI on "added
  // [tools/marketplace/path-hint.mjs]" because the list above was checked
  // against itself locally and against `npm pack` only in the workflow. Now
  // the pack is read here too, so the suite is red before the tag exists.
  const json = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { timeout: 120_000,
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  const packed = JSON.parse(json)
  const result = assertPackageArtifact(packed)
  assert.equal(result.fileCount, EXPECTED_PACKAGE_PATHS.length)
  assert.ok(result.packedBytes <= MAX_PACKED_BYTES)
  // AGENTS.md is guidance for coding agents working on omakit itself
  // (CONTRIBUTING.md, "Repository layout"): never a deliverable, so it is in
  // neither the reviewed list nor the tarball npm would actually build.
  assert.ok(!EXPECTED_PACKAGE_PATHS.includes("AGENTS.md"))
  assert.ok(!packed[0].files.some((file) => file.path === "AGENTS.md"), "AGENTS.md is not in the tarball")
})

test("an added publishable path is refused by name", () => {
  const files = [...EXPECTED_PACKAGE_PATHS, "unexpected.txt"].map((path) => ({ path }))
  assert.throws(
    () => assertPackageArtifact([{ files, size: 1 }]),
    /added \[unexpected\.txt\]/,
  )
})

test("an oversized tarball is refused with its size and the chosen ceiling", () => {
  const files = EXPECTED_PACKAGE_PATHS.map((path) => ({ path }))
  assert.throws(
    () => assertPackageArtifact([{ files, size: MAX_PACKED_BYTES + 1 }]),
    new RegExp(`${MAX_PACKED_BYTES + 1} bytes, over the ${MAX_PACKED_BYTES}-byte ceiling`),
  )
})

test("a missing package size cannot pass the ceiling check", () => {
  const files = EXPECTED_PACKAGE_PATHS.map((path) => ({ path }))
  assert.throws(
    () => assertPackageArtifact([{ files }]),
    /size is missing or is not a finite number/,
  )
})
