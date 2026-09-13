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
import { STATUS } from "../../tools/marketplace/style.mjs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Nonsense", tags: "bar", offline: true })
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

// --- identity.available's remedy follows the cause ------------------------------
// Measured 2026-09-13: a plugin listed by its own repository was told to
// "Choose an unused plugin id outside the reserved namespace", the remedy for a
// different failure. Each fixture below collides with an entry in the pinned
// registry (offline, so the pin is the registry read).

const LISTED_ID = "io.github.mtolhuys.disk-lens"
const LISTED_REPO = "https://github.com/mtolhuys/omarchy-disk-lens"
const retiredId = JSON.parse(readFileSync(join(pinDir, "registry.json"), "utf8")).retiredPluginIds[0]
const NEWER_COMMIT = (await import(pathToFileURL(join(pinDir, "scripts/plugin-verification-request.mjs")).href)).upstreamUpdateVerificationAction

function withId(id) {
  return { ...GOOD, "manifest.json": JSON.stringify({ ...JSON.parse(GOOD["manifest.json"]), id }) + "\n" }
}

async function identityOf(tree, origin) {
  const fixture = materialise(tree, { origin })
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar", offline: true })
  return { result, check: result.checks.find((entry) => entry.id === "identity.available") }
}

test("a reserved id is told to leave the namespace", async () => {
  const { check } = await identityOf(withId("omarchy.fixture-reserved"), "https://github.com/example/omarchy-plugin-fixture-reserved")
  assert.equal(check.verdict, "fail")
  assert.match(check.detail, /^reserved-plugin-id: "omarchy\.fixture-reserved" is inside the reserved omarchy\.\* namespace; registry at the pin/)
  assert.deepEqual(check.remedy, ["Choose a plugin id outside the reserved omarchy.* namespace."])
})

test("a retired id is told it cannot be reused", async () => {
  assert.ok(retiredId, "the pin retires at least one id")
  const { check } = await identityOf(withId(retiredId), "https://github.com/example/omarchy-plugin-fixture-retired")
  assert.match(check.detail, new RegExp(`^plugin-id-retired: "${retiredId.replace(/\./g, "\\.")}" was used by a previous listing`))
  assert.deepEqual(check.remedy, ["That id was retired by the marketplace and cannot be reused; choose another."])
})

test("an id taken by another repository names that repository", async () => {
  const { check } = await identityOf(withId(LISTED_ID), "https://github.com/example/omarchy-plugin-fixture-taken")
  assert.match(check.detail, /^plugin-id-listed: "io\.github\.mtolhuys\.disk-lens" is already listed by mtolhuys\/omarchy-disk-lens; registry at the pin/)
  assert.deepEqual(check.remedy, ["That id is taken by mtolhuys/omarchy-disk-lens; choose another."])
})

test("a plugin listed by its own repository is not a failed check: it is listed, and the run says so", async () => {
  // disk-lens at the pin: listed id, same repository. Measured on 0.1.6: this
  // printed FAIL identity.available, REFUSED, and "Fix it, then run submit
  // again" under a remedy saying there was nothing to submit. Offline, so the
  // listing is read from the pin, and the output says so.
  const { result, check } = await identityOf(withId(LISTED_ID), LISTED_REPO)
  assert.equal(check.verdict, "pass")
  assert.equal(check.remedy, null)
  assert.equal(check.detail, "listed by this repository since 2026-08-31, verification commit 5b98b315cf1bf8ab1a8b5250a0c493dda8b6fa4b (verified, checked 2026-09-10T17:40:18.858Z); registry at the pin 38060f89 (offline)")
  assert.equal(result.outcome, "listed")
  assert.equal(result.ready, false)
  assert.deepEqual(result.blocking, [])
  assert.equal(result.issue, null)
  assert.deepEqual(Object.keys(result.listing), ["repository", "id", "addedAt", "verificationCommit", "verificationStatus", "verificationCheckedAt", "localCommit", "sameCommit", "source", "updateRoute"])
  assert.equal(result.listing.source, "pin")
  assert.equal(result.listing.sameCommit, false)
  assert.equal(result.listing.localCommit, result.subject.commit)
  assert.equal(result.listing.updateRoute.choice, NEWER_COMMIT)
  assert.match(NEWER_COMMIT, /newer/, "read from the pin, not typed")
  assert.ok(!result.checks.some((entry) => /^submission\.(category|tags|headings|checklist|official-parser)$/.test(entry.id)), "no body is rendered on purpose, so the body checks are omitted")

  const rendered = renderSubmit(result, { colour: false })
  assert.ok(!rendered.includes("FAIL") && !rendered.includes("REFUSED") && !rendered.includes("READY"), rendered)
  assert.ok(!rendered.includes("Fix it") && !rendered.includes("omakit submit "), "no closing fix line and no reproduce line")
  assert.ok(!rendered.includes("Choose an unused plugin id"), "the old remedy is gone")
  const tail = rendered.slice(rendered.indexOf("LISTED"))
  assert.match(tail, /^LISTED  io\.github\.mtolhuys\.disk-lens is already listed by this repository, so\n {10}the submission form is not the route\./)
  assert.match(tail, /\nlisted {8}5b98b315cf1bf8ab1a8b5250a0c493dda8b6fa4b\n {14}verified, checked 2026-09-10T17:40:18\.858Z, read from the pin\n/)
  assert.match(tail, new RegExp(`\\nlocal HEAD {4}${result.subject.commit}\\n {14}not the listed commit\\n`))
  assert.match(tail, new RegExp(`To get it listed, open the marketplace's "Verify or update a listed plugin" form\\nand choose "${NEWER_COMMIT}"\\.\\nomakit watch <the submission issue> shows which commit is listed now\\.$`))

  // A listed repository with a manifest id it does not list is still a
  // failure: the marketplace refuses the repository, and the id is not the
  // listed one, so nothing here says which plugin this is.
  const fresh = await identityOf(withId("io.github.mtolhuys.fixture-fresh"), LISTED_REPO)
  assert.equal(fresh.check.verdict, "fail")
  assert.equal(fresh.result.outcome, "refused")
  assert.match(fresh.check.detail, /^submission-repository-listed: mtolhuys\/omarchy-disk-lens is already listed; registry/)
  assert.equal(fresh.check.remedy.length, 1)
  assert.match(fresh.check.remedy[0], /^This plugin is already listed/)
})

test("an id taken by another repository is the refusal it was, closing with the fix line and the reproduce line", async () => {
  const { result, check } = await identityOf(withId(LISTED_ID), "https://github.com/example/omarchy-plugin-fixture-taken")
  assert.equal(check.verdict, "fail")
  assert.equal(result.outcome, "refused")
  assert.equal(result.ready, false)
  assert.equal(result.listing, null)
  assert.deepEqual(result.blocking, ["identity.available"])
  const rendered = renderSubmit(result, { colour: false })
  assert.match(rendered, /REFUSED  1 blocking check failed, so no submission body is produced\./)
  assert.match(rendered.replace(/ \\\n\s+/g, " "), /Fix it, then run submit again:\n\S omakit submit \S+ --category Widgets --tags bar --offline$/)
  assert.ok(!rendered.includes("LISTED"))
})

test("more than one cause prints the arrows in order: retired, then listed", async () => {
  const { check } = await identityOf(withId(retiredId), LISTED_REPO)
  assert.equal(check.remedy.length, 2)
  assert.match(check.remedy[0], /^That id was retired/)
  assert.match(check.remedy[1], /^This plugin is already listed/)
  const taken = await identityOf(withId("omarchy." + LISTED_ID), "https://github.com/example/omarchy-plugin-fixture-two")
  assert.deepEqual(taken.check.remedy, ["Choose a plugin id outside the reserved omarchy.* namespace."], "reserved alone when the id is not otherwise listed")
})

// --- the category and tags are decided after the registry ----------------------
// Measured on 0.1.5: `omakit submit <a listed plugin>` exited 2 asking for
// --category and --tags, and would then have refused at identity.available
// with "nothing to submit".

test("a listed plugin without flags is never a usage error: taken, the choice is moot and waits on identity", async () => {
  const fixture = materialise(withId(LISTED_ID), { origin: "https://github.com/example/omarchy-plugin-fixture-taken" })
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true })
  assert.equal(result.outcome, "refused")
  assert.deepEqual(result.blocking, ["identity.available"])
  assert.deepEqual(result.unknown, ["submission.category", "submission.tags", "submission.headings", "submission.checklist", "submission.official-parser"])
  for (const id of result.unknown) {
    assert.equal(result.checks.find((entry) => entry.id === id).detail, "not checked: it needs identity.available to pass first")
  }
  assert.match(result.checks.find((entry) => entry.id === "identity.available").remedy[0], /^That id is taken by mtolhuys\/omarchy-disk-lens/)
  assert.equal(result.reproduce, `omakit submit ${fixture.dir} --offline`)
  // The command wraps after 80 columns at a long tmp path; read it unwrapped.
  assert.match(renderSubmit(result, { colour: false }).replace(/ \\\n\s+/g, " "), /Fix it, then run submit again:\n\S omakit submit \S+ --offline$/)
})

test("an own listing without flags is asked for nothing, with or without a chooser, and nothing waits", async () => {
  const fixture = materialise(withId(LISTED_ID), { origin: LISTED_REPO })
  const chooser = async () => { throw new Error("must not ask") }
  for (const options of [{}, { chooser }]) {
    const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true, ...options })
    assert.equal(result.outcome, "listed")
    assert.deepEqual(result.blocking, [])
    assert.deepEqual(result.unknown, [])
  }
})

test("an unlisted plugin without flags and without a chooser is the usage error, unchanged", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  await assert.rejects(
    () => submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true }),
    (error) => error.code === "usage" && error.usage.missing.join(",") === "--category,--tags" && error.usage.categories.length === 9 && error.usage.tags.length === 13 && error.usage.maximumTags === 3,
  )
  await assert.rejects(
    () => submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", offline: true }),
    (error) => error.code === "usage" && error.usage.missing.join(",") === "--tags",
  )
})

test("an unlisted plugin without flags asks the chooser, with the marketplace's own default for the manifest's kinds", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const asked = []
  const chooser = async (question) => {
    asked.push(question)
    return { category: "Widgets", tags: ["Bar", "Quickshell"] }
  }
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true, chooser })
  assert.equal(asked.length, 1, "asked once")
  assert.deepEqual(asked[0].missing, ["--category", "--tags"])
  assert.deepEqual(asked[0].defaults, { category: "Widgets", tags: ["bar-widget"] }, "GOOD declares kinds: [bar-widget]")
  assert.equal(asked[0].contract.categories.length, 9)
  assert.equal(result.ready, true, `blocking: ${result.blocking.join(", ")}`)
  assert.equal(result.reproduce, `omakit submit ${fixture.dir} --category Widgets --tags bar,quickshell --offline`)
  const tail = renderSubmit(result, { colour: false }).split("The same run, without prompting:\n")[1]
  assert.ok(tail, "the report ends with the command line")
  assert.equal(tail.replace(/ \\\n\s+/g, " ").slice(2), result.reproduce, "broken before a flag, and the same command joined back")
  for (const line of tail.split("\n")) assert.ok(line.length <= 80, line)

  // Given flags are never asked for, and the reproduce line carries every flag.
  const given = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "widgets", tags: "bar", notes: "No privileges needed.", pluginName: "Given Name", offline: true, chooser: async () => { throw new Error("must not ask") } })
  assert.equal(given.reproduce, `omakit submit ${fixture.dir} --category Widgets --tags bar --name "Given Name" --notes "No privileges needed." --offline`)
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

test("the offline flag makes the validation-commit check skipped: advisory, never silent, never a pass", async () => {
  // Measured on 0.1.6: this check came out `"verdict": "pass"` under
  // --offline, `unknown` stayed empty, and the report drew `▁ ok` for a
  // comparison that never happened.
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const result = await submitPreflight({
    repoRoot: REPO_ROOT, target: fixture.dir, category: "Other", tags: "system", offline: true,
  })
  const check = result.checks.find((entry) => entry.id === "submission.validation-commit")
  assert.equal(check.severity, "advisory")
  assert.equal(check.verdict, "skipped")
  assert.equal(check.remedy, null)
  assert.match(check.detail, /^not checked \(--offline\)\. Local commit [0-9a-f]{40}\.$/)
  assert.deepEqual(result.skipped, ["submission.validation-commit"], "counted as skipped")
  assert.deepEqual(result.unknown, [], "not as unknown: nothing was waited on")
  assert.deepEqual(result.advisory, [], "not as an advisory failure: nothing failed")
  assert.equal(result.ready, true, "a skipped advisory check does not block READY")
  assert.equal(result.validationCommit.matches, null)
  assert.match(result.validationCommit.note, /watch/)

  const text = renderSubmit(result, { colour: false })
  assert.ok(text.includes(`${STATUS.skipped.glyph} ${STATUS.skipped.word}  submission.validation-commit`), "drawn with the skipped mark")
  assert.ok(!text.includes(`${STATUS.pass.glyph} ${STATUS.pass.word}    submission.validation-commit`), "not drawn as a pass")
  assert.ok(text.includes(`${STATUS.pass.glyph} READY  every blocking check passed. 1 check skipped (--offline).`), "the READY line says so")
})
