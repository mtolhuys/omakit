// The registry figures the tool prints and the docs cite are the pin's, not a
// remembered snapshot: every number in docs/MEASUREMENTS.md M4 and M6 that
// comes from registry.json is recomputed here from the pinned checkout. A pin
// bump that changes them fails this test until the docs follow.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { baselineFigures, figure } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const figures = baselineFigures({ pinDir })

test("the baseline outcomes at the pin are the ones the docs cite", () => {
  assert.equal(figures.sources, 2963)
  assert.equal(figures.withBaseline, 2916)
  assert.deepEqual(figures.outcomes, { passed: 1681, "review-required": 1215, "needs-fixes": 20 })
  assert.equal(figures.findingsTotal, 21)
  assert.deepEqual(figures.findings, { "curl-pipe-shell": 11, "remote-git-execution-unpinned": 10 })
  assert.deepEqual(figures.capabilities, {
    installer: 514,
    privilege: 485,
    "package-manager": 468,
    "service-management": 382,
    "remote-build": 366,
    "bundled-executable-binary": 31,
    "sudoers-modification": 23,
  })
  assert.equal(figures.retiredIds, 22)
  assert.equal(figures.catalogPlugins, 3001)
})

test("revalidation is a normal part of a listing's life, measured at the pin", () => {
  assert.deepEqual(figures.superseded, { sources: 749, commits: 1108, most: 9 })
  assert.equal(((749 / 2963) * 100).toFixed(1), "25.3")
})

test("docs/MEASUREMENTS.md M4 and docs/UPSTREAM_CONTRACT.md carry the pin's figures, formatted the way figure() prints them", () => {
  const measurements = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  const contract = readFileSync(join(REPO_ROOT, "docs/UPSTREAM_CONTRACT.md"), "utf8")
  for (const text of [measurements, contract]) {
    for (const n of [figures.withBaseline, figures.outcomes.passed, figures.outcomes["review-required"], figures.superseded.sources, figures.superseded.commits]) {
      assert.ok(text.includes(figure(n)), `${figure(n)} is missing from a document that cites the registry`)
    }
  }
  assert.equal(figure(1681), "1,681")
  assert.equal(figure(20), "20")
})

test("the printed why of baseline.preflight is built from the pin, not typed", () => {
  const source = readFileSync(join(REPO_ROOT, "tools/marketplace/submit.mjs"), "utf8")
  assert.ok(source.includes("figures.outcomes"), "submit.mjs reads the outcome counts from baselineFigures")
  assert.ok(!/\b(2,990|1,697|1,226)\b/.test(source), "no snapshot literal survives in submit.mjs")
})
