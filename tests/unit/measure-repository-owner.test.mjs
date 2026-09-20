import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ownerCounts, measureRepositoryOwner } from "../../tools/marketplace/measure-repository-owner.mjs"
import { REPO_ROOT } from "./helpers.mjs"

test("M15 counts unreadable bodies apart, and a share only over the readable ones", () => {
  assert.deepEqual(ownerCounts([{ owner: "a", ownerDiffers: true }, { owner: "b", ownerDiffers: false }, { owner: null, ownerDiffers: null }]),
    { total: 3, readable: 2, unreadable: 1, ownerDiffers: 1, ownerMatches: 1, differsShareOfReadable: 0.5 })
  assert.equal(ownerCounts([]).differsShareOfReadable, null)
})

test("M15 reads the Repository URL with the pinned parser and compares its owner with the author, case-insensitively", async () => {
  const body = (url) => `### Repository URL\n\n${url}\n\n### Category\n\nDesktop\n\n### Tags\n\nBar\n\n### Suggest a missing tag\n\n_No response_\n\n### Maintainer notes\n\n_No response_\n\n### Submission checklist\n\n- [X] x\n`
  const labels = []
  const report = await measureRepositoryOwner(REPO_ROOT, { discover: async (_owner, _repo, _creator, options) => {
    labels.push(options.labels)
    return [
      { number: 7787, state: "open", title: "[Plugin]: Omacrunch", user: { login: "mtolhuys" }, labels: [{ name: "submission" }, { name: "needs-fixes" }], body: body("https://github.com/mtolhuijs/omacrunch") },
      { number: 2, state: "open", user: { login: "MTolhuys" }, labels: [], body: body("https://github.com/mtolhuys/omacrunch.git") },
      { number: 3, state: "open", user: { login: "author" }, labels: [], body: "no repository here" },
      { number: 4, state: "closed", user: { login: "author" }, labels: [], body: body("https://github.com/x/y") },
      { number: 5, state: "open", user: { login: "author" }, labels: [], body: body("https://github.com/x/y"), pull_request: {} },
    ]
  } })
  assert.deepEqual(labels, ["submission"])
  assert.equal(report.measurement, "M15")
  assert.equal(report.sample, false)
  assert.deepEqual(report.rows.map((row) => [row.issue, row.owner, row.ownerDiffers]), [[2, "mtolhuys", false], [3, null, null], [7787, "mtolhuijs", true]])
  assert.deepEqual(report.rows[0].labels, [])
  assert.deepEqual(report.rows[2].labels, ["submission", "needs-fixes"])
  assert.match(report.rows[1].reason, /Repository URL/)
  assert.deepEqual({ total: report.total, readable: report.readable, unreadable: report.unreadable, ownerDiffers: report.ownerDiffers }, { total: 3, readable: 2, unreadable: 1, ownerDiffers: 1 })
})

test("the M15 record's counts are its rows', and docs/MEASUREMENTS.md cites them", () => {
  const record = JSON.parse(readFileSync(join(REPO_ROOT, "docs/evidence/repository-owner/2026-09-20.json"), "utf8"))
  assert.equal(record.sample, false)
  const { rows, ...counts } = record
  const expected = ownerCounts(rows)
  for (const key of Object.keys(expected)) assert.equal(counts[key], expected[key], key)
  const docs = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  const section = docs.slice(docs.indexOf("## M15."))
  assert.ok(section.length > 0, "M15 is a section of docs/MEASUREMENTS.md")
  for (const figure of [`"total": ${record.total}`, `"readable": ${record.readable}`, `"ownerDiffers": ${record.ownerDiffers}`, `"ownerMatches": ${record.ownerMatches}`, record.date]) {
    assert.ok(section.includes(figure), `docs/MEASUREMENTS.md M15 cites ${figure}`)
  }
})
