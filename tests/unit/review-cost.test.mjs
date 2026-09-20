import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { compareCommits } from "../../tools/marketplace/github.mjs"
import { docsOnlyFiles, documentationPath, reviewCostVerdict, reviewPolicy, openIssuesForRepository,
  previousValidatedCommit, validatedDocumentationDiff } from "../../tools/marketplace/review-cost.mjs"
import { submitPreflight } from "../../tools/marketplace/submit.mjs"
import { validationWatchAll } from "../../tools/marketplace/watch.mjs"
import { renderWatchAll, renderSubmit } from "../../tools/marketplace/report.mjs"
import { plain, overflows } from "../../tools/marketplace/style.mjs"
import { GOOD, materialise } from "../fixtures/plugins.mjs"
import { REVIEW_CASES, DOCUMENTATION_DIFFS } from "../fixtures/review-cost.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"

const policy = await reviewPolicy(REPO_ROOT)
const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)
const repository = "https://github.com/example/plugin"
const registry = { sources: [{ repo: repository, listingValidatedCommit: A, listingValidatedAt: "2026-09-01T00:00:00Z" }] }
const report = { plugin: { repository }, validated: { commit: B, checkedAt: "2026-09-15T00:00:00Z" } }

for (const fixture of REVIEW_CASES) test(`review.cost fixture: ${fixture.name}`, () => {
  const result = reviewCostVerdict({ baseline: { outcome: fixture.manual ? policy.manual : policy.automated, capabilities: fixture.capabilities },
    policy, openIssues: { count: fixture.count, reason: "fixture discovery" }, why: "M4: 1,215 of 2,916 baselines required review" })
  assert.equal(result.reviewCost.outcome, fixture.name)
  assert.equal(result.check.verdict, fixture.verdict)
  assert.equal(result.check.severity, "advisory")
  assert.deepEqual(result.reviewCost.capabilities, fixture.capabilities)
  assert.equal(result.reviewCost.openIssuesForRepository, fixture.count)
  if (fixture.manual) {
    assert.match(result.check.detail, /Every update of this plugin, including a docs-only one, lands in the manual queue/)
    for (const capability of fixture.capabilities) assert.ok(result.check.detail.includes(capability))
  } else assert.match(result.check.detail, /will not need a human/)
  assert.equal(result.check.remedy, fixture.count > 0 ? "consider batching: close or fold the open one before opening another" : null)
})

test("unknown baseline outcomes never assert automated review, and unavailable discovery remains null", () => {
  for (const baseline of [null, { outcome: "unexpected", capabilities: [] }]) {
    const result = reviewCostVerdict({ baseline, policy, why: "M4: 1,215" })
    assert.equal(result.check.verdict, "unknown")
    assert.equal(result.check.severity, "advisory")
    assert.equal(result.reviewCost.outcome, null)
  }
  const result = reviewCostVerdict({ baseline: { outcome: policy.manual, capabilities: ["installer"] }, policy,
    openIssues: { count: null, reason: "not checked: no credential" }, why: "M4: 1,215" })
  assert.equal(result.reviewCost.outcome, "manual queue")
  assert.equal(result.reviewCost.openIssuesForRepository, null)
  assert.match(result.reviewCost.reason, /no credential/)
  assert.doesNotMatch(result.check.detail, /no credential/)
})

test("repository issue count reuses watch discovery, filters accounts and normalizes the repository", async () => {
  const subject = (number, url = repository, login = "author") => ({ number, state: "open", title: "[Plugin]: Test", user: { login },
    labels: [], body: `### Repository URL\n\n${url}\n\n### Category\n\n` })
  const subjects = [subject(1), subject(2, "https://github.com/EXAMPLE/PLUGIN.git"), subject(3, "https://github.com/other/plugin"),
    subject(4, repository, "other"), { ...subject(5), pull_request: {} }, { ...subject(6), state: "closed" }]
  const calls = []
  const result = await openIssuesForRepository({ repoRoot: REPO_ROOT, repository, github: {
    token: () => "fixture", authenticatedUser: async () => "author", repositoryIssues: async () => subjects,
    issue: async (_, __, number) => { calls.push(number); return subjects.find((subject) => subject.number === number) },
  } })
  assert.equal(result.count, 2)
  assert.deepEqual(calls.sort(), [1, 2, 3])
})

test("discovery also finds the author's submission for this plugin by its name or id when the Repository URL does not match", async () => {
  // #7787: the typed URL named a repository that does not exist, so a
  // match on the URL alone made the author's own issue invisible.
  const body = (url, id = "") => `### Repository URL\n\n${url}\n\n### Category\n\nWidgets\n\n### Tags\n\nBar\n\n### Suggest a missing tag\n\n_No response_\n\n### Maintainer notes\n\n${id || "_No response_"}\n\n### Submission checklist\n\n- [X] x\n`
  const subjects = [
    { number: 1, state: "open", title: "[Plugin]: Test", user: { login: "author" }, labels: [], body: body(repository) },
    { number: 2, state: "open", title: "[Plugin]: Test", user: { login: "author" }, labels: [], body: body("https://github.com/exampel/plugin") },
    { number: 3, state: "open", title: "[Plugin]: Other", user: { login: "author" }, labels: [], body: body("https://github.com/other/plugin", "the id io.example.test is mine") },
    { number: 4, state: "open", title: "[Plugin]: Unrelated", user: { login: "author" }, labels: [], body: body("https://github.com/other/unrelated") },
  ]
  const result = await openIssuesForRepository({ repoRoot: REPO_ROOT, repository, pluginName: "test", pluginId: "io.example.test", github: {
    token: () => "fixture", authenticatedUser: async () => "author", repositoryIssues: async () => subjects,
    issue: async (_, __, number) => subjects.find((subject) => subject.number === number),
  } })
  assert.equal(result.count, 3)
  assert.equal(result.account, "author")
  assert.deepEqual(result.issues.map((row) => [row.number, row.sameRepository, row.matchedBy]), [[1, true, "repository"], [2, false, "name"], [3, false, "id"]])
  assert.equal(result.issues[1].repositoryUrl, "https://github.com/exampel/plugin")
  assert.equal(result.issues[1].url, `${MARKETPLACE_PIN.repository}/issues/2`)
  assert.match(result.reason, /3 open issue\(s\) for this plugin, 2 of them naming another repository/)
  // Without a name or an id to match on, the URL is all there is, as before.
  const bare = await openIssuesForRepository({ repoRoot: REPO_ROOT, repository, github: {
    token: () => "fixture", authenticatedUser: async () => "author", repositoryIssues: async () => subjects,
    issue: async (_, __, number) => subjects.find((subject) => subject.number === number),
  } })
  assert.equal(bare.count, 1)
})

test("no credential, offline, network failure and incomplete discovery never become zero open issues", async () => {
  for (const options of [{ offline: true }, { github: { token: () => null } },
    { github: { token: () => "fixture", authenticatedUser: async () => { throw Object.assign(new Error("network down"), { code: "network-unavailable" }) } } },
    { github: { token: () => "fixture", authenticatedUser: async () => "author", repositoryIssues: async () => { throw Object.assign(new Error("capped"), { code: "issue-list-incomplete" }) } } }]) {
    const result = await openIssuesForRepository({ repoRoot: REPO_ROOT, repository, ...options })
    assert.equal(result.count, null)
    assert.match(result.reason, /not checked/)
  }
})

test("review.cost cannot become blocking, including a refused baseline and a queued fixture", async () => {
  for (const files of [GOOD, { ...GOOD, "install.sh": "#!/bin/sh\nsudo true\n" },
    { ...GOOD, "install.sh": "#!/bin/sh\nsudo kill $(cat /tmp/shared.pid)\n" }]) {
    const fixture = materialise(files, { origin: repository })
    const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true, category: "Widgets", tags: "bar" })
    const check = result.checks.find((check) => check.id === "review.cost")
    assert.equal(check.severity, "advisory")
    assert.ok(!result.blocking.includes("review.cost"))
    assert.equal(result.checks[result.checks.findIndex((check) => check.id === "baseline.preflight") + 1], check)
  }
})

test("submit reports the repeated queue without changing readiness or the body", async () => {
  const fixture = materialise({ ...GOOD, "install.sh": "#!/bin/sh\nsudo true\n" }, { origin: repository })
  const subject = { number: 1, state: "open", title: "[Plugin]: Fixture", labels: [], user: { login: "author" }, body: `### Repository URL\n\n${repository}\n\n### Category\n\n` }
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar",
    readRegistry: async () => ({ source: "pin", commit: MARKETPLACE_PIN.commit,
      registry: JSON.parse(readFileSync(join(requirePinForTests(), "registry.json"))),
      catalog: JSON.parse(readFileSync(join(requirePinForTests(), "site/catalog.json"))) }),
    github: { token: () => "fixture", defaultBranchHead: async () => ({ commit: fixture.commit }),
      authenticatedUser: async () => "author", repositoryIssues: async () => [subject], issue: async () => subject } })
  assert.equal(result.reviewCost.outcome, "manual queue, again")
  assert.equal(result.reviewCost.openIssuesForRepository, 1)
  assert.equal(result.ready, true)
  assert.ok(result.issue.body)
  assert.ok(result.advisory.includes("review.cost"))
  const text = renderSubmit(result, { colour: false })
  assert.match(text, /consider batching: close or fold the open one before opening another/)
  assert.equal(plain(renderSubmit(result, { colour: true })), text)
})

test("docs-only classification includes both rename paths and excludes runtime and empty changes", () => {
  for (const fixture of DOCUMENTATION_DIFFS) assert.equal(docsOnlyFiles(fixture.files), fixture.docsOnly, JSON.stringify(fixture))
  assert.equal(docsOnlyFiles(null), false)
  assert.equal(documentationPath("docs/../install.sh"), false)
})

test("M9 machine-readable evidence carries complete denominators, sources and documented counts", () => {
  const evidence = JSON.parse(readFileSync(join(REPO_ROOT, "docs/evidence/review-cost/2026-09-15.json")))
  const measured = evidence.rows.filter((row) => row.docsOnly !== null)
  assert.equal(evidence.sample, false)
  assert.equal(evidence.rows.length, evidence.manualQueue)
  assert.equal(measured.length, evidence.compared)
  assert.equal(measured.filter((row) => row.docsOnly).length, evidence.docsOnly)
  assert.equal(evidence.rows.filter((row) => row.docsOnly === null).length, evidence.skipped)
  assert.equal(evidence.manualQueueShare, evidence.manualQueue / evidence.pluginUpdates)
  assert.equal(evidence.docsOnlyShareOfCompared, evidence.docsOnly / evidence.compared)
  assert.equal(evidence.docsOnlyShareOfManualQueue, null, "unavailable comparisons cannot claim an exact population share")
  for (const row of measured) {
    assert.ok(row.source.includes(`/compare/${row.previousCommit}...${row.validatedCommit}`))
    assert.ok(Number.isInteger(row.files))
  }
  for (const row of evidence.rows.filter((row) => row.docsOnly === null)) assert.ok(row.reason)
  const docs = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  const machine = JSON.parse(docs.split("## M9.")[1].match(/```json\n([\s\S]*?)\n```/)[1])
  for (const [key, value] of Object.entries(machine)) {
    if (key === "date") assert.ok(evidence.openedAt.startsWith(value))
    else assert.equal(evidence[key], value, key)
  }
})

test("previous validation prefers an attested issue commit, with dated registry and history fallback", () => {
  assert.equal(previousValidatedCommit(registry, report), A)
  assert.equal(previousValidatedCommit(registry, { ...report, previousValidated: { commit: C, checkedAt: "2026-09-14T00:00:00Z" } }), C)
  assert.equal(previousValidatedCommit(registry, report, { plugins: [{ repo: repository, upstreamValidatedCommit: C, upstreamValidatedAt: "2026-09-14T00:00:00Z" }] }), C)
  assert.equal(previousValidatedCommit({ sources: [{ ...registry.sources[0], listingValidatedAt: "2026-09-16T00:00:00Z" }] }, report), null)
  assert.equal(previousValidatedCommit({ sources: [{ ...registry.sources[0], listingValidatedCommit: B,
    listingValidationHistory: [{ commit: C, validatedAt: "2026-08-01T00:00:00Z" }, { commit: A, validatedAt: "2026-09-01T00:00:00Z" }] }] }, report), A)
  assert.equal(previousValidatedCommit({ sources: [{ ...registry.sources[0], repo: "https://github.com/other/plugin" }] }, report), null)
})

test("compare reads report exact sources and skip unknown, unavailable, non-forward and capped diffs", async () => {
  let calls = 0
  const diff = await validatedDocumentationDiff({ report, registry, compare: async (url, from, to) => {
    calls += 1
    assert.deepEqual([url, from, to], [repository, A, B])
    return { url: "fixture compare source", files: [{ filename: "README.md" }] }
  } })
  assert.equal(diff.docsOnly, true)
  assert.equal(diff.source, "fixture compare source")
  const skipped = await validatedDocumentationDiff({ report, registry: null, compare: async () => { calls += 1 } })
  assert.equal(skipped.docsOnly, null)
  assert.match(skipped.reason, /previous validated commit unknown/)
  assert.equal(calls, 1)
  for (const result of [{ status: "ahead", files: new Array(300).fill({ filename: "README.md" }) }, { status: "ahead" }, { status: "diverged", files: [] }]) {
    const diff = await validatedDocumentationDiff({ report, registry, compare: (...args) => compareCommits(...args, { readJson: async () => result }) })
    assert.equal(diff.docsOnly, null)
    assert.ok(diff.reason)
  }
})

test("batch summary measures manual update labels and prior validated diffs with explicit skips", async () => {
  const pinPolicy = await import(pathToFileURL(join(requirePinForTests(), "scripts/security-baseline-policy.mjs")).href)
  const marker = (commitSha) => `${pinPolicy.securityBaselineMarkerPrefix}${Buffer.from(JSON.stringify({
    schemaVersion: 2, baselineVersion: pinPolicy.securityBaselineVersion, repository: "example/plugin", pluginIds: ["io.example.fixture"],
    commitSha, checkedAt: "2026-09-15T00:00:00Z", outcome: policy.manual, enforcementMode: pinPolicy.securityBaselineEnforcementMode,
    findings: [], capabilities: ["installer"],
  })).toString("base64url")} -->`
  const issues = [1, 2, 3, 4, 5].map((number) => ({ number, url: `${MARKETPLACE_PIN.repository}/issues/${number}`, title: `Request ${number}`,
    labels: number === 4 ? [policy.updateLabel] : number === 5 ? [policy.reviewLabel] : [policy.updateLabel, policy.reviewLabel] }))
  let registryReads = 0
  const result = await validationWatchAll({ repoRoot: REPO_ROOT, discovery: { account: "author", issues },
    readRegistry: async () => { registryReads += 1; return { source: "head", registry } }, github: {
      issue: async (_, __, number) => ({ ...issues[number - 1], state: "open", user: { login: "author" },
        body: `### Repository URL\n\n${number === 3 ? "https://github.com/other/plugin" : repository}\n\n### Category\n\n` }),
      issueComments: async (_, __, number) => (number === 1 ? [A, B] : [B]).map((commit) => ({ user: { login: "github-actions[bot]" }, body: marker(commit) })),
      defaultBranchHead: async () => ({ commit: B }),
      compareCommits: async (_, from) => ({ url: "fixture compare source", files: [{ filename: from === A ? "README.md" : "Widget.qml" }] }),
    } })
  assert.equal(registryReads, 1)
  assert.deepEqual(result.reviewCostSummary, { pluginUpdates: 4, manualQueue: 3, docsOnly: 2, compared: 2,
    skipped: [{ issue: 3, reason: "previous validated commit unknown in the marketplace registry" }] })
  assert.equal(result.issues[0].report.previousValidated.commit, A)
  const text = renderWatchAll(result, { colour: false })
  assert.match(text, /3 of 4 plugin-update issue\(s\) on security-review-required/)
  assert.match(text, /2\s+docs-only validated diff\(s\) of 2 compared/)
  assert.match(text, /diff\(s\) skipped/)
  assert.equal(plain(renderWatchAll(result, { colour: true })), text)
  assert.deepEqual(text.split("\n").filter((line) => overflows(line)), [])
})
