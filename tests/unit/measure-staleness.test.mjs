import test from "node:test"
import assert from "node:assert/strict"
import { atomHead, stalenessCounts, measureStaleness } from "../../tools/marketplace/measure-staleness.mjs"

test("M6 counts unknowns separately and cannot report a complete population share with missing comparisons", () => {
  assert.deepEqual(stalenessCounts([{ verdict: "stale" }, { verdict: "current" }, { verdict: "unknown" }]),
    { total: 3, compared: 2, stale: 1, current: 1, unknown: 1, staleShareOfCompared: 0.5, staleShareOfPopulation: null })
  assert.equal(stalenessCounts([]).staleShareOfCompared, null)
  assert.equal(stalenessCounts([{ verdict: "stale" }]).staleShareOfPopulation, 1)
  assert.equal(atomHead(`<feed><id>tag:github.com,2008:Grit::Commit/${"a".repeat(40)}</id></feed>`, "feed").commit, "a".repeat(40))
  assert.throws(() => atomHead("<feed/>", "feed"), /No full HEAD/)
})

test("M6 discovers both author-fixes labels, deduplicates issues, excludes PRs and preserves read failures", async () => {
  const labels = []
  const row = { number: 1, state: "open" }
  const report = await measureStaleness("unused", {
    discover: async (_owner, _repo, _creator, options) => {
      labels.push(options.labels)
      return [row, { number: 2, state: "open", pull_request: {} }, { number: 3, state: "closed" }]
    },
    watch: async () => { throw new Error("feed unavailable") },
  })
  assert.deepEqual(labels, ["needs-fixes", "security-needs-fixes"])
  assert.equal(report.rows.length, 1)
  assert.equal(report.rows[0].issue, 1)
  assert.equal(report.unknown, 1)
  assert.match(report.rows[0].reason, /feed unavailable/)
  assert.equal(report.sample, false)
})
