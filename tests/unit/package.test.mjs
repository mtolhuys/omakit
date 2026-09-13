import test from "node:test"
import assert from "node:assert/strict"
import { assertPackageArtifact, EXPECTED_PACKAGE_PATHS, MAX_PACKED_BYTES } from "../package-assert.mjs"

test("the reviewed package shape reports its measured baseline and chosen ceiling", () => {
  const files = EXPECTED_PACKAGE_PATHS.map((path) => ({ path }))
  const result = assertPackageArtifact([{ files, size: 81_351 }])
  assert.equal(result.fileCount, 38)
  assert.equal(result.packedBytes, 81_351)
  assert.equal(result.ceilingBytes, MAX_PACKED_BYTES)
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
