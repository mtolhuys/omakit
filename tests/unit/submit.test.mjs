// Definition of done, first half: submit passes a known-good plugin and refuses
// every measured failure class on a crafted fixture.
import test from "node:test"
import assert from "node:assert/strict"
import { submitPreflight } from "../../tools/marketplace/submit.mjs"
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
    "tree.agent-control",
    "identity.available",
    "submission.category",
    "submission.tags",
    "submission.official-parser",
  ]) {
    assert.equal(verdict[id], "fail", `${id} should have failed`)
    assert.ok(result.blocking.includes(id), `${id} should be blocking`)
  }

  const agentControl = result.checks.find((check) => check.id === "tree.agent-control")
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
