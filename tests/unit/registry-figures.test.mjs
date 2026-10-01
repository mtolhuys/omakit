// The registry figures the tool prints and the docs cite are the pin's, not a
// remembered snapshot: every number in docs/MEASUREMENTS.md M4 and M6 that
// comes from registry.json is recomputed here from the pinned checkout. A pin
// bump that changes them fails this test until the docs follow.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { baselineFigures, catalogBuilderText, catalogPresentation, defaultPresentation, figure } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const figures = baselineFigures({ pinDir })

test("the baseline outcomes at the pin are the ones the docs cite", () => {
  assert.equal(figures.sources, 4493)
  assert.equal(figures.withBaseline, 4449)
  assert.deepEqual(figures.outcomes, { passed: 2451, "review-required": 1962, "needs-fixes": 36 })
  assert.equal(figures.findingsTotal, 38)
  assert.deepEqual(figures.findings, { "curl-pipe-shell": 17, "remote-git-execution-unpinned": 21 })
  assert.deepEqual(figures.capabilities, {
    installer: 928,
    privilege: 817,
    "package-manager": 806,
    "service-management": 666,
    "remote-build": 598,
    "sudoers-modification": 40,
    "bundled-executable-binary": 39,
  })
  assert.equal(figures.retiredIds, 69)
  assert.equal(figures.catalogPlugins, 4532)
})

test("revalidation is a normal part of a listing's life, measured at the pin", () => {
  assert.deepEqual(figures.superseded, { sources: 1110, commits: 1648, most: 9 })
  assert.equal(((1110 / 4493) * 100).toFixed(1), "24.7")
})

test("docs/MEASUREMENTS.md M4 and docs/UPSTREAM_CONTRACT.md carry the pin's figures, formatted the way figure() prints them", () => {
  const measurements = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  const contract = readFileSync(join(REPO_ROOT, "docs/UPSTREAM_CONTRACT.md"), "utf8")
  for (const text of [measurements, contract]) {
    for (const n of [figures.withBaseline, figures.outcomes.passed, figures.outcomes["review-required"], figures.superseded.sources, figures.superseded.commits]) {
      assert.ok(text.includes(figure(n)), `${figure(n)} is missing from a document that cites the registry`)
    }
  }
  assert.equal(figure(2451), "2,451")
  assert.equal(figure(26), "26")
})

test("the presentation the marketplace derives from a manifest's kinds is what build-catalog.mjs says at the pin", () => {
  // The default `omakit submit` offers when it asks for a category and tags
  // is read from the pinned catalog builder, not copied. This pins what that
  // mapping is at this commit: a marketplace that changes categoryFor() or
  // the tag derivation fails here until the reading and the docs follow.
  const presentation = catalogPresentation(catalogBuilderText(pinDir))
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
