// The registry figures the tool prints and the docs cite are the pin's, not a
// remembered snapshot: every number in docs/MEASUREMENTS.md M4 and M6 and the
// Registry facts row of docs/UPSTREAM_CONTRACT.md that comes from
// registry.json is rendered from docs/evidence/registry-figures.json by
// tools/marketplace/measure-registry-figures.mjs, and recomputed here from
// the pinned checkout. A pin bump that changes them fails this test until the
// script has run with --write.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { baselineFigures, catalogBuilderText, catalogPresentation, defaultPresentation, figure } from "../../tools/marketplace/registry.mjs"
import { CONTRACT_PATH, MEASUREMENTS_PATH, RECORD_PATH, TEST_PATH, measureRegistryFigures, renderContract, renderMeasurements, renderTest, upsert } from "../../tools/marketplace/measure-registry-figures.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const figures = baselineFigures({ pinDir })

// registry-figures:begin rendered from docs/evidence/registry-figures.json by `node tools/marketplace/measure-registry-figures.mjs --write`; change the record, not this block
const AT_PIN = Object.freeze({
  "commit": "bdf24b347fcb2fb7a0af18104ab68dc6ecbf9882",
  "figures": {
    "sources": 5927,
    "listingValidated": 5927,
    "withBaseline": 5887,
    "outcomes": {
      "passed": 3062,
      "review-required": 2769,
      "needs-fixes": 56
    },
    "capabilities": {
      "package-manager": 1184,
      "privilege": 1232,
      "remote-build": 843,
      "bundled-executable-binary": 60,
      "service-management": 1019,
      "installer": 1395,
      "sudoers-modification": 62
    },
    "findings": {
      "curl-pipe-shell": 23,
      "remote-git-execution-unpinned": 35
    },
    "findingsTotal": 58,
    "superseded": {
      "sources": 1891,
      "commits": 3215,
      "most": 20
    },
    "retiredIds": 98,
    "catalogPlugins": 5968
  }
})
// registry-figures:end

test("the figures at the pin are the ones recorded and rendered for it", () => {
  assert.equal(AT_PIN.commit, MARKETPLACE_PIN.commit, "the block is the pin's: run measure-registry-figures.mjs --write after a pin bump")
  assert.deepEqual(figures, AT_PIN.figures)
  assert.equal(figure(AT_PIN.figures.outcomes.passed), AT_PIN.figures.outcomes.passed.toLocaleString("en-US"))
})

test("the record, this test's block and the two documents are what the script renders at the pin: --write would change nothing", () => {
  const { entry, files } = measureRegistryFigures({ repoRoot: REPO_ROOT, pinDir })
  assert.equal(entry.commit, MARKETPLACE_PIN.commit)
  assert.deepEqual(files, { [RECORD_PATH]: "current", [TEST_PATH]: "current", [MEASUREMENTS_PATH]: "current", [CONTRACT_PATH]: "current" })
  const record = JSON.parse(readFileSync(join(REPO_ROOT, RECORD_PATH), "utf8"))
  assert.equal(record.pins[0].commit, MARKETPLACE_PIN.commit, "the pin's entry is first")
  assert.equal(new Set(record.pins.map((pin) => pin.commit)).size, record.pins.length, "one entry per pin")
})

test("a new pin's entry goes first, the outgoing one moves into the earlier pins, and the names come from the data", () => {
  // A made-up record of two pins, with made-up outcome and capability
  // names: the renderer prints whatever keys the registry has.
  const at = (commit, committedAt, n) => ({
    commit: commit.repeat(40),
    committedAt,
    figures: {
      sources: 1000 * n, listingValidated: 1000 * n, withBaseline: 900 * n,
      outcomes: { fine: 600 * n, "look-closer": 290 * n, broken: 10 * n },
      capabilities: { alpha: 5 * n, beta: 7 * n }, findings: { "rule-b": n, "rule-a": n }, findingsTotal: 2 * n,
      superseded: { sources: 100 * n, commits: 150 * n, most: 3 }, retiredIds: n, catalogPlugins: 1100 * n,
    },
  })
  const record = upsert({ pins: [at("a", "2026-01-01T10:00:00Z", 1)] }, at("b", "2026-02-02T11:30:00Z", 2))
  assert.deepEqual(record.pins.map((pin) => pin.commit[0]), ["b", "a"])
  assert.deepEqual(upsert(record, at("b", "2026-02-02T11:30:00Z", 3)).pins.map((pin) => [pin.commit[0], pin.figures.sources]), [["b", 3000], ["a", 1000]], "an entry for the same pin is replaced, not repeated")

  const doc = "# M\n\n<!-- registry-figures:m4 -->\nold\n<!-- /registry-figures:m4 -->\n\n| Listed sources whose validated commit was superseded at least once | old |\n| Other | row |\n"
  const measurements = renderMeasurements(doc, record)
  assert.ok(measurements.includes("From `registry.json` at the pin (`bbbbbbbb`, 2026-02-02 11:30 UTC): 2,000\nlisted sources, of which 1,800 carry a recorded baseline"))
  assert.ok(measurements.includes("| `fine` | 1,200 |\n| `look-closer` | 580 |\n| `broken` | 20 |\n| Findings ever recorded, total | 4 (`rule-a` 2, `rule-b` 2) |"), "largest first, by name on a tie")
  assert.ok(measurements.includes("Capabilities recorded: beta 14, alpha 10."))
  assert.ok(measurements.includes("| Pin | Sources | With a baseline | `fine` | `look-closer` | `broken` |\n| --- | --- | --- | --- | --- | --- |\n| `aaaaaaaa` (2026-01-01 10:00 UTC) | 1,000 | 900 | 600 | 290 | 10 |"))
  assert.ok(measurements.includes("| Listed sources whose validated commit was superseded at least once | 200 of 2,000 (10.0%) at pin `bbbbbbbb`, 300 superseded commits, one source revalidated 3 times (at pin `aaaaaaaa`: 100 of 1,000, 10.0%, 150 commits) |\n| Other | row |"))
  assert.equal(renderMeasurements(measurements, record), measurements, "rendering twice changes nothing")
  assert.equal(renderContract("| Registry facts | old |\n", record), "| Registry facts | 2,000 sources with `listingValidatedCommit`; 1,800 with an `automatedSecurityBaseline` record (1,200 fine, 580 look-closer, 20 broken); 2,200 catalog plugin ids; 2 retired ids; 200 sources (10.0%) with at least one superseded validated commit, 300 superseded commits in all |\n")
  const block = renderTest("a\n// registry-figures:begin\n// registry-figures:end\nb\n", record)
  assert.match(block, /^a\n\/\/ registry-figures:begin rendered from docs\/evidence\/registry-figures\.json[^\n]*\nconst AT_PIN = Object\.freeze\(\{\n  "commit": "b{40}",/)
  assert.ok(block.endsWith("// registry-figures:end\nb\n"))
  for (const render of [renderMeasurements, renderContract, renderTest]) {
    assert.throws(() => render("nothing to render into\n", record), /to render into/, "a document without its block is an error, not a silent no-op")
  }
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
