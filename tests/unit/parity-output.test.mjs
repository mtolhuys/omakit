import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { strataSizes } from "../../tests/parity/corpus.mjs"
import { parityOutput, ParityOutputError } from "../../tools/marketplace/parity-output.mjs"

test("a source checkout defaults to its evidence directory", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-parity-source-"))
  mkdirSync(join(root, "docs/evidence"), { recursive: true })
  assert.equal(parityOutput({ repoRoot: root }), join(root, "docs/evidence/parity"))
})

test("a packaged tree refuses before work and names --out", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-parity-package-"))
  assert.throws(
    () => parityOutput({ repoRoot: root }),
    (error) => error instanceof ParityOutputError
      && error.code === "parity-output-required"
      && error.message.includes("--out <file>")
      && error.remedy === "omakit parity --out <file>",
  )
})

test("an explicit output is accepted outside the install tree", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-parity-package-"))
  const out = join(mkdtempSync(join(tmpdir(), "omakit-parity-out-")), "evidence.json")
  assert.equal(parityOutput({ repoRoot: root, out }), out)
})

test("the parity strata never exceed the count asked for, and the 30-repository corpus is unchanged", () => {
  // Measured on 2026-09-19: `parity --count 1` ran two repositories,
  // ceil(1/8) needs-fixes and ceil(1/4) review-required, and said 2/2.
  for (let count = 0; count <= 40; count += 1) {
    const sizes = strataSizes(count)
    assert.equal(sizes["needs-fixes"] + sizes["review-required"] + sizes.passed, count, `count ${count} sums to itself`)
    for (const value of Object.values(sizes)) assert.ok(value >= 0, `count ${count}: no negative stratum`)
  }
  assert.deepEqual(strataSizes(1), { "needs-fixes": 1, "review-required": 0, passed: 0 })
  assert.deepEqual(strataSizes(2), { "needs-fixes": 1, "review-required": 1, passed: 0 })
  assert.deepEqual(strataSizes(3), { "needs-fixes": 1, "review-required": 1, passed: 1 })
  assert.deepEqual(strataSizes(30), { "needs-fixes": 4, "review-required": 8, passed: 18 }, "the recorded corpus")
})
