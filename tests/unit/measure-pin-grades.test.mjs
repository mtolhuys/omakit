// M7's three comparisons over a made-up marketplace history: the script
// grades each change with the shipped comparePin() and pinFreshness(),
// answering every request from the clone. Measured on 2026-10-01 against the
// real history, the grades it gives equal the v0.6.6 and v0.6.7 tags' own
// (docs/evidence/pin-freshness/2026-10-01-grades.json); here each kind of
// change is built on purpose, so each grade is known before the run.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { PIN_READS, POLICY_MODULE } from "../../tools/marketplace/pin.mjs"
import { GRADED_PATHS, measurePinGrades } from "../../tools/marketplace/measure-pin-grades.mjs"

const BUILDER = "scripts/build-catalog.mjs"
const APPROVAL = "scripts/approve-submission.mjs"
const builder = (prefix, extra = "") => [
  "function categoryFor(kinds) {",
  '  if (kinds.includes("gadget")) return "Gadgets";',
  '  return "Elsewhere";',
  "}",
  "export function check(id) {",
  `  if (id.toLowerCase().startsWith("${prefix}")) {`,
  '    checkError("reserved-plugin-id", "reserved");',
  "  }",
  "}",
  "const entry = { tags: kinds.slice(0, 3).map((kind) => kind.toLowerCase()) };",
  extra,
].join("\n")

test("each kind of change grades as each comparison would grade it, and the counts are over the read set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-pin-grades-"))
  const env = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { timeout: 60_000, encoding: "utf8", env })
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (message) => {
    git("add", "-A")
    git("commit", "-q", "-m", message)
    return git("rev-parse", "HEAD").trim()
  }
  try {
    git("init", "-q", "-b", "main")
    git("config", "commit.gpgsign", "false")
    for (const read of PIN_READS) put(read.path, "export const placeholder = 1;\n")
    put(POLICY_MODULE, 'export const securityBaselineVersion = 3;\nexport const securityBaselineEnforcementMode = "selective";\n')
    put(BUILDER, builder("acme."))
    put(APPROVAL, 'for (const required of ["submission", "checked"]) {\n}\n')
    put("scripts/approve-plugin-update.mjs", 'for (const required of ["update-request", "submission"]) {\n}\n')
    put("registry.json", "{}\n")
    put("site/catalog.json", "{}\n")
    put(".github/ISSUE_TEMPLATE/submit.yml", "name: submit\n")
    const base = commit("base")

    put(BUILDER, builder("acme.", "// a retry"))
    const sameValues = commit("the builder moves, its values do not")
    put(BUILDER, builder("ac.", "// a retry"))
    const namespace = commit("the namespace changes")
    put("scripts/elsewhere.mjs", "export const unread = 1;\n")
    const unread = commit("a file nothing reads")
    put("registry.json", '{"sources":[]}\n')
    commit("data only")
    put(".github/ISSUE_TEMPLATE/submit.yml", "name: submit a plugin\n")
    const form = commit("the form")
    put(APPROVAL, 'for (const required of ["submission", "checked"]) {\n}\n// reworded\n')
    const label = commit("an approval script moves, its label does not")

    const result = await measurePinGrades({ clone: dir, since: base, until: "HEAD" })
    assert.deepEqual([...GRADED_PATHS], ["scripts", ".github/ISSUE_TEMPLATE"], "PIN_PATHS less the two data files")
    assert.deepEqual(result.commits.map((row) => [row.commit, row.inReadSet, row.tree, row.blob, row.value]), [
      [sameValues, [BUILDER], "advice", "advice", "ok"],
      [namespace, [BUILDER], "advice", "advice", "advice"],
      [unread, [], "advice", "ok", "ok"],
      [form, [], "advice", "advice", "advice"],
      [label, [APPROVAL], "advice", "info", "ok"],
    ], "the data-only commit is not listed; each other one is graded against its parent")
    assert.equal(result.touchingReadSet, 3)
    assert.deepEqual(result.advice, { tree: 3, blob: 2, value: 1 })
    assert.deepEqual(result.adviceOverAll, { commits: 5, tree: 5, blob: 3, value: 2 })
    assert.match(result.commits[0].detail, /scripts\/build-catalog\.mjs moved, and the 2 values omakit reads from it are unchanged/)
    assert.match(result.commits[1].detail, /reservedNamespace "acme\." at the pin, "ac\." at HEAD/)
    assert.deepEqual(result.commits.map((row) => row.requests), [5, 5, 4, 3, 5], "three tree reads, the scripts tree when it moved, one text per moved text-read file")
    assert.equal(result.range, `${base}..${label}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
