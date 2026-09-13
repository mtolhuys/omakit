// Definition of done, first half: submit passes a known-good plugin and refuses
// every measured failure class on a crafted fixture.
import test from "node:test"
import assert from "node:assert/strict"
import { missingSubmitFlags, submitPreflight } from "../../tools/marketplace/submit.mjs"
import { renderSubmit } from "../../tools/marketplace/report.mjs"
import { verifyAgainstOfficialParser } from "../../tools/marketplace/issue.mjs"
import { submissionContract } from "../../tools/marketplace/form.mjs"
import { materialise, GOOD, BAD, NO_ROOT_FILES } from "../fixtures/plugins.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const contract = await submissionContract({ pinDir })

function verdicts(result) {
  return Object.fromEntries(result.checks.map((check) => [check.id, check.verdict]))
}

test("a known-good plugin passes every check and produces a postable issue", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT,
    target: fixture.dir,
    category: "Widgets",
    tags: "bar,quickshell",
    notes: "No privileges needed.",
    offline: true,
  })
  assert.equal(result.ready, true, `blocking: ${result.blocking.join(", ")}`)
  assert.deepEqual(result.blocking, [])
  assert.equal(result.subject.commit, fixture.commit)
  assert.equal(result.validationCommit.local, fixture.commit)
  assert.equal(result.plugin.id, "omakit-fixture.good")
  assert.equal(result.issue.title, "[Plugin]: Fixture Good")
  assert.ok(verifyAgainstOfficialParser(contract, result.issue).ok)
  assert.equal(result.baseline.consequence.outcome, "passed")
  assert.equal(result.baseline.consequence.blocksApproval, false)
})

test("every check names a source and a measured reason", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar", offline: true,
  })
  for (const check of result.checks) {
    assert.ok(["marketplace-pin", "omakit"].includes(check.source), `${check.id}: bad source ${check.source}`)
    assert.ok(check.why && check.why.length > 40, `${check.id}: no measured reason`)
    assert.ok(/\d/.test(check.why), `${check.id}: the reason carries no number`)
  }
})

test("the crafted fixture is refused, and every measured failure class is named", async () => {
  const fixture = materialise(BAD, { origin: "https://github.com/example/omarchy-plugin-fixture-bad" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT,
    target: fixture.dir,
    category: "Nonsense",
    tags: "bar,system,media,ai",
    offline: true,
  })
  assert.equal(result.ready, false)
  assert.equal(result.issue, null, "a refused submission must not produce a body")

  const verdict = verdicts(result)
  for (const id of [
    "plugin.root-manifest",
    "plugin.root-license",
    "plugin.readme-install-removal",
    "identity.available",
    "submission.category",
    "submission.tags",
  ]) {
    assert.equal(verdict[id], "fail", `${id} should have failed`)
    assert.ok(result.blocking.includes(id), `${id} should be blocking`)
  }
  // The body could not render, so the three checks that read it waited on
  // the two fields that failed: a question, not a third and fourth failure.
  for (const id of ["submission.headings", "submission.checklist", "submission.official-parser"]) {
    assert.equal(verdict[id], "unknown", `${id} waited`)
    assert.ok(!result.blocking.includes(id) && !result.advisory.includes(id), `${id} counts nowhere`)
    assert.ok(result.unknown.includes(id))
    const check = result.checks.find((entry) => entry.id === id)
    assert.equal(check.detail, "not checked: it needs submission.category and submission.tags to pass first")
    assert.equal(check.remedy, null)
  }

  const agentControl = result.checks.find((check) => check.id === "tree.agent-control")
  assert.equal(agentControl.verdict, "fail")
  assert.equal(agentControl.severity, "advisory", "the marketplace lists plugins that ship agent-control files, so this warns and never refuses")
  assert.ok(result.advisory.includes("tree.agent-control"))
  assert.deepEqual(agentControl.paths.map((path) => path.split(": ")[0]), [
    ".claude/settings.json",
    ".mcp.json",
    "AGENTS.md",
    "docs/CLAUDE.md",
    "skills/publishing/SKILL.md",
  ])
  assert.ok(agentControl.remedy.includes("DEVELOPMENT.md"))

  const identity = result.checks.find((check) => check.id === "identity.available")
  assert.ok(identity.detail.includes("reserved-plugin-id"))

  const baseline = result.checks.find((check) => check.id === "baseline.preflight")
  assert.equal(baseline.verdict, "fail")
  assert.equal(baseline.severity, "advisory", "a non-selectively-blocking finding does not block publication")
  assert.ok(result.baseline.consequence.findings.includes("curl-pipe-shell"))
  assert.ok(baseline.paths.some((path) => path.startsWith("curl-pipe-shell: install.sh:")))
})

test("an agent-control file alone never refuses: the marketplace lists such plugins", async () => {
  // Measured 2026-09-13 at the pin: 4 of mtolhuys' 5 listed plugins and 2 of a
  // 30-source sample ship AGENTS.md at their listingValidatedCommit.
  const fixture = materialise({ ...GOOD, "AGENTS.md": "# Agent notes\n" }, { origin: "https://github.com/example/omarchy-plugin-fixture-agents" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar,quickshell", offline: true,
  })
  assert.equal(result.ready, true, `blocking: ${result.blocking.join(", ")}`)
  assert.deepEqual(result.blocking, [])
  assert.deepEqual(result.advisory, ["tree.agent-control"])
  assert.ok(result.issue, "a warning still produces the body")
  const check = result.checks.find((entry) => entry.id === "tree.agent-control")
  assert.equal(check.severity, "advisory")
  assert.deepEqual(check.paths.map((path) => path.split(": ")[0]), ["AGENTS.md"])
  assert.match(check.why, /6 of 34 listed plugins/)
})

test("a body that cannot render leaves the checks that read it unknown and out of the refusal", async () => {
  // Measured 2026-09-13: a run with no --category and no --tags on a listed
  // plugin said "6 blocking checks failed" for two causes, and listed
  // headings, checklist and official-parser in the refusal with "not
  // rendered" where a remedy goes. Forced here through the API with no
  // category, which the CLI now refuses earlier as a usage error.
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, tags: "bar", offline: true })
  assert.deepEqual(result.blocking, ["submission.category"], "one root cause")
  assert.deepEqual(result.unknown, ["submission.headings", "submission.checklist", "submission.official-parser"])
  for (const id of result.unknown) {
    const check = result.checks.find((entry) => entry.id === id)
    assert.equal(check.verdict, "unknown")
    assert.equal(check.detail, "not checked: it needs submission.category to pass first")
  }
  const rendered = renderSubmit(result, { colour: false })
  assert.match(rendered, /REFUSED  1 blocking check failed, so no submission body is produced\. 3 checks\n\s+could not run until it passes\./)
  assert.ok(!/^\s+submission\.(headings|checklist|official-parser)$/m.test(rendered), "the refusal lists root causes only")
  assert.equal((rendered.match(/^\S \?\s+submission\./gm) || []).length, 3, "three questions, none of them a FAIL")
})

test("missing --category or --tags is known before any check runs, with the form's own lists", async () => {
  assert.equal(missingSubmitFlags(contract, { category: "Widgets", tags: "bar" }), null)
  const both = missingSubmitFlags(contract, {})
  assert.deepEqual(both.missing, ["--category", "--tags"])
  assert.deepEqual(both.categories, contract.categories)
  assert.equal(both.categories.length, 9)
  assert.deepEqual(both.tags, contract.tagLabels)
  assert.equal(both.tags.length, 13)
  assert.equal(both.maximumTags, 3)
  assert.deepEqual(missingSubmitFlags(contract, { category: "Widgets", tags: " , " }).missing, ["--tags"])
  assert.deepEqual(missingSubmitFlags(contract, { tags: ["bar"] }).missing, ["--category"])
})

test("a missing root manifest, README and license are each reported", async () => {
  const fixture = materialise(NO_ROOT_FILES, { origin: "https://github.com/example/omarchy-plugin-fixture-empty" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", offline: true,
  })
  const verdict = verdicts(result)
  assert.equal(verdict["plugin.root-manifest"], "fail")
  assert.equal(verdict["plugin.root-readme"], "fail")
  assert.equal(verdict["plugin.root-license"], "fail")
  assert.equal(verdict["submission.title"], "fail", "no manifest name and no --name")
  assert.equal(result.ready, false)
})

test("--name supplies a title when the manifest has no name", async () => {
  const fixture = materialise({ ...GOOD, "manifest.json": JSON.stringify({ schemaVersion: 1, id: "omakit-fixture.nameless" }) + "\n" },
    { origin: "https://github.com/example/omarchy-plugin-fixture-nameless" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", pluginName: "Given By Flag", offline: true,
  })
  assert.equal(result.ready, true, `blocking: ${result.blocking.join(", ")}`)
  assert.equal(result.issue.title, "[Plugin]: Given By Flag")
})

test("a dirty worktree is refused unless it is allowed explicitly", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-dirty", dirty: true })
  await assert.rejects(
    () => submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", offline: true }),
    /dirty-worktree|uncommitted/,
  )
  const allowed = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", offline: true, allowDirty: true,
  })
  assert.equal(allowed.subject.cleanTree, false)
})

test("the offline flag makes the validation-commit check advisory, never silent", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", offline: true,
  })
  const check = result.checks.find((entry) => entry.id === "submission.validation-commit")
  assert.equal(check.severity, "advisory")
  assert.match(check.detail, /not checked \(--offline\)/)
  assert.equal(result.validationCommit.matches, null)
  assert.match(result.validationCommit.note, /watch/)
})
