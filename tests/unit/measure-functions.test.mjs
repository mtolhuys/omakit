// The M12 measurement script's pure parts: the selection rule over a
// catalog, the quantiles, the histograms and the record a set of trees
// builds, held so the record on disk and the code that wrote it cannot
// drift apart without a red test. The network half (fetching 50 trees)
// is not run here; tests/unit/submit.test.mjs holds SIZE to the record.
import test from "node:test"
import assert from "node:assert/strict"
import { buildRecord, heavyLinesOf, histogram, quantile, selectTrees, TREES } from "../../tools/inspect/measure-functions.mjs"

const fn = (lines, branches = 0, depth = 0) => ({ lines, branches, depth })

test("selectTrees applies the record's rule: community, root-plugin, validated commit, one per repository, catalog order, the first 50", () => {
  const plugin = (repo, extra = {}) => ({ repo, sourceType: "community", repositoryLayout: "root-plugin", listingValidatedCommit: "a".repeat(40), ...extra })
  const catalog = { plugins: [
    plugin("https://github.com/a/one"),
    plugin("https://github.com/a/one"),
    plugin("https://github.com/a/suite", { repositoryLayout: "suite" }),
    plugin("https://github.com/a/official", { sourceType: "official" }),
    plugin("https://github.com/a/unvalidated", { listingValidatedCommit: null }),
    plugin("https://github.com/a/two", { listingValidatedCommit: "B".repeat(40) }),
  ] }
  assert.deepEqual(selectTrees(catalog), [{ repo: "https://github.com/a/one", commit: "a".repeat(40) }, { repo: "https://github.com/a/two", commit: "b".repeat(40) }])
  assert.equal(selectTrees({ plugins: Array.from({ length: 80 }, (_, i) => plugin(`https://github.com/a/r${i}`)) }).length, TREES)
  assert.deepEqual(selectTrees({}), [])
})

test("quantile is nearest-rank and histogram is value to count in ascending order", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(quantile(sorted, 0.5), 5)
  assert.equal(quantile(sorted, 0.9), 9)
  assert.equal(quantile(sorted, 0.95), 10)
  assert.equal(quantile([7], 0.5), 7)
  assert.equal(quantile([], 0.5), null)
  assert.deepEqual(histogram([3, 1, 3, 10, 1, 1]), { 1: 3, 3: 2, 10: 1 })
  assert.deepEqual(Object.keys(histogram([10, 9, 100])), ["9", "10", "100"])
})

test("buildRecord: the thresholds are the p90s, a tree with no function has a null share, a light tree has 0, and the histograms sum to the sample", () => {
  const heavy = [fn(40, 1, 1), fn(4), fn(4), fn(4), fn(4), fn(4), fn(4), fn(4), fn(4), fn(4)]
  const light = [fn(3), fn(5)]
  const record = buildRecord([{ functions: [], byKind: { qml: 0, js: 0, shell: 0, python: 0 } }, { functions: heavy, byKind: { qml: 10, js: 0, shell: 0, python: 0 } }, { functions: light, byKind: { qml: 0, js: 0, shell: 2, python: 0 } }], { fetchFailed: [], date: "2026-01-01", previous: "older" })
  assert.equal(record.measurement, "M12")
  assert.equal(record.sample.trees, 3)
  assert.equal(record.sample.functions, 12)
  assert.deepEqual(record.quantiles.lines, { p50: 4, p75: 4, p90: 5, p95: 40, max: 40 })
  const thresholds = { lines: record.quantiles.lines.p90, branches: record.quantiles.branches.p90, depth: record.quantiles.depth.p90 }
  assert.equal(heavyLinesOf(heavy, thresholds), 40)
  assert.deepEqual(record.rows.map((row) => [row.functions, row.functionLines, row.heavyLines, row.heavyShare]), [[0, 0, 0, null], [10, 76, 40, Math.round((40 / 76) * 10000) / 10000], [2, 8, 0, 0]])
  assert.deepEqual(record.rows.map((row) => [row.longest, row.medianLines]), [[0, null], [40, 4], [5, 4]])
  assert.deepEqual(record.rows[1].byKind, { qml: 10, js: 0, shell: 0, python: 0 })
  for (const measure of ["lines", "branches", "depth"]) assert.equal(Object.values(record.distribution[measure]).reduce((sum, count) => sum + count, 0), 12)
  assert.match(record.notes, /older$/)
  // The method is one whole text: every rule the extractor applies is named, and nothing cut it short.
  for (const phrase of ["guard and not a branch", "heredoc", "triple-quoted string", "null with no function", "nearest-rank"]) assert.ok(record.method.includes(phrase), `method lacks "${phrase}"`)
  assert.doesNotMatch(record.method, /\bIn shell, a $/)
})
