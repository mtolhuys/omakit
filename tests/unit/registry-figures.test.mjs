// The registry figures the tool prints and the docs cite are the pin's, not a
// remembered snapshot: every number in docs/MEASUREMENTS.md M4 and M6 that
// comes from registry.json is recomputed here from the pinned checkout. A pin
// bump that changes them fails this test until the docs follow.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { baselineFigures, catalogPresentation, defaultPresentation, figure } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const figures = baselineFigures({ pinDir })

test("the baseline outcomes at the pin are the ones the docs cite", () => {
  assert.equal(figures.sources, 3653)
  assert.equal(figures.withBaseline, 3608)
  assert.deepEqual(figures.outcomes, { passed: 2025, "review-required": 1557, "needs-fixes": 26 })
  assert.equal(figures.findingsTotal, 27)
  assert.deepEqual(figures.findings, { "curl-pipe-shell": 12, "remote-git-execution-unpinned": 15 })
  assert.deepEqual(figures.capabilities, {
    installer: 702,
    privilege: 639,
    "package-manager": 622,
    "service-management": 514,
    "remote-build": 476,
    "bundled-executable-binary": 34,
    "sudoers-modification": 29,
  })
  assert.equal(figures.retiredIds, 22)
  assert.equal(figures.catalogPlugins, 3691)
})

test("revalidation is a normal part of a listing's life, measured at the pin", () => {
  assert.deepEqual(figures.superseded, { sources: 854, commits: 1270, most: 9 })
  assert.equal(((854 / 3653) * 100).toFixed(1), "23.4")
})

test("docs/MEASUREMENTS.md M4 and docs/UPSTREAM_CONTRACT.md carry the pin's figures, formatted the way figure() prints them", () => {
  const measurements = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  const contract = readFileSync(join(REPO_ROOT, "docs/UPSTREAM_CONTRACT.md"), "utf8")
  for (const text of [measurements, contract]) {
    for (const n of [figures.withBaseline, figures.outcomes.passed, figures.outcomes["review-required"], figures.superseded.sources, figures.superseded.commits]) {
      assert.ok(text.includes(figure(n)), `${figure(n)} is missing from a document that cites the registry`)
    }
  }
  assert.equal(figure(2025), "2,025")
  assert.equal(figure(26), "26")
})

test("the presentation the marketplace derives from a manifest's kinds is what build-catalog.mjs says at the pin", () => {
  // The default `omakit submit` offers when it asks for a category and tags
  // is read from the pinned catalog builder, not copied. This pins what that
  // mapping is at this commit: a marketplace that changes categoryFor() or
  // the tag derivation fails here until the reading and the docs follow.
  const presentation = catalogPresentation(pinDir)
  assert.deepEqual(presentation, {
    rules: [
      { kinds: ["bar-widget"], category: "Widgets" },
      { kinds: ["overlay", "panel", "bar"], category: "Desktop" },
      { kinds: ["service"], category: "System" },
    ],
    fallback: "Other",
    tagsFromKinds: true,
  })
  assert.deepEqual(defaultPresentation(presentation, ["bar-widget"]), { category: "Widgets", tags: ["bar-widget"] })
  assert.deepEqual(defaultPresentation(presentation, ["Panel", "overlay", "service", "x"]), { category: "Desktop", tags: ["panel", "overlay", "service"] })
  assert.deepEqual(defaultPresentation(presentation, ["service"]), { category: "System", tags: ["service"] })
  assert.deepEqual(defaultPresentation(presentation, []), { category: "Other", tags: [] })
  assert.deepEqual(defaultPresentation(presentation, undefined), { category: "Other", tags: [] })
  assert.deepEqual(defaultPresentation({ rules: [], fallback: null, tagsFromKinds: false }, ["bar"]), { category: null, tags: null }, "an unreadable mapping offers nothing")
})

test("the printed why of baseline.preflight is built from the pin, not typed", () => {
  const source = readFileSync(join(REPO_ROOT, "tools/marketplace/submit.mjs"), "utf8")
  assert.ok(source.includes("figures.outcomes"), "submit.mjs reads the outcome counts from baselineFigures")
  assert.ok(!/\b(2,990|1,697|1,226)\b/.test(source), "no snapshot literal survives in submit.mjs")
})
