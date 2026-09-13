import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
