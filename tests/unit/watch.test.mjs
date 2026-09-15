// The validation watch's verdict logic, offline. The network path is exercised
// separately against a real listed repository and its evidence is committed
// by the two real runs recorded in docs/VALIDATION_WATCH.md.
import test from "node:test"
import assert from "node:assert/strict"
import { validationWatch, validationVerdict, validationCommentCommit, REFRESH_ACTION } from "../../tools/marketplace/watch.mjs"
import { parseIssueUrl, GitHubError } from "../../tools/marketplace/github.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
const REPOSITORY = "https://github.com/example/omarchy-plugin-fixture"

test("issue URLs are parsed, and anything else is refused", () => {
  assert.deepEqual(parseIssueUrl("https://github.com/omacom/omarchy-plugin-marketplace/issues/4829"), {
    owner: "omacom", repository: "omarchy-plugin-marketplace", number: 4829,
  })
  assert.deepEqual(parseIssueUrl("https://github.com/o/r/issues/1#issuecomment-2"), { owner: "o", repository: "r", number: 1 })
  for (const bad of ["", "https://github.com/o/r/pull/1", "https://example.com/o/r/issues/1", "omacom/omarchy-plugin-marketplace#1"]) {
    assert.throws(() => parseIssueUrl(bad), GitHubError)
  }
})

test("a pin that equals the current HEAD needs nothing", () => {
  const verdict = validationVerdict({
    comparable: true, stale: false, validated: { commit: A }, head: { commit: A, branch: "main" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false, repositoryUrl: REPOSITORY,
  })
  assert.equal(verdict.state, "current")
  assert.equal(verdict.action, null)
  assert.match(verdict.summary, /current main-branch HEAD/)
})

test("a stale validation names both commits and the one action that moves it", () => {
  const verdict = validationVerdict({
    comparable: true, stale: true, validated: { commit: A }, head: { commit: B, branch: "master" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false, repositoryUrl: REPOSITORY,
  })
  assert.equal(verdict.state, "stale")
  assert.ok(verdict.summary.includes(A))
  assert.ok(verdict.summary.includes(B))
  assert.match(verdict.summary, /Pushing it did not tell the marketplace, and neither did any comment/)
  assert.equal(verdict.action, REFRESH_ACTION)
  assert.match(verdict.action, /Edit the issue body/)
})

test("a push after the last human review comment is called out", () => {
  const verdict = validationVerdict({
    comparable: true, stale: true, validated: { commit: A }, head: { commit: B, branch: "main" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: true, repositoryUrl: REPOSITORY,
  })
  assert.match(verdict.summary, /after the last human review comment/)
})

test("no validated commit is 'unknown', never 'current'", () => {
  const none = validationVerdict({
    comparable: false, stale: null, validated: null, head: { commit: B },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(none.state, "unknown")
  assert.match(none.summary, /no validated commit/)

  const short = validationVerdict({
    comparable: false, stale: null, validated: null, head: { commit: B },
    fallback: { short: "abc1234" }, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(short.state, "unknown")
  assert.match(short.summary, /too short to compare/)
  assert.equal(short.action, REFRESH_ACTION)
})

test("an incomplete baseline and an unreadable HEAD are both 'unknown'", () => {
  const baseline = validationVerdict({
    comparable: false, stale: null, validated: null, head: null, fallback: null,
    baselineError: { code: "approval-security-baseline-missing" }, headError: null, pushedAfterReview: false,
  })
  assert.equal(baseline.state, "unknown")
  assert.match(baseline.summary, /did not complete/)

  const head = validationVerdict({
    comparable: false, stale: null, validated: { commit: A }, head: null, fallback: null,
    baselineError: null, headError: { code: "not-found" }, pushedAfterReview: false, repositoryUrl: REPOSITORY,
  })
  assert.equal(head.state, "unknown")
  assert.match(head.summary, /could not be read \(not-found\)/)
})

test("the short commit is read out of the validation comment as a fallback", () => {
  const comments = [
    { body: "hello", user: { login: "someone" } },
    { body: "<!-- marketplace-validation -->\n✅ Quattro compatibility passed at commit `f16bb9b`\n", created_at: "2026-09-01T00:00:00Z" },
  ]
  assert.deepEqual(validationCommentCommit(comments), { short: "f16bb9b", createdAt: "2026-09-01T00:00:00Z" })
  assert.equal(validationCommentCommit([{ body: "no marker" }]), null)
  assert.equal(validationCommentCommit([]), null)
})

test("a missing repository URL is reported as that, not as an unreadable HEAD", () => {
  const verdict = validationVerdict({
    comparable: false, stale: null, validated: { commit: A }, head: null, fallback: null,
    baselineError: null, headError: null, pushedAfterReview: false, repositoryUrl: null,
  })
  assert.equal(verdict.state, "unknown")
  assert.match(verdict.summary, /no plugin repository could be read from this issue/)
  assert.doesNotMatch(verdict.summary, /HEAD could not be read/)
})

test("the command path reaches the missing-repository verdict, not only the helper", async () => {
  // Measured on 0.1.6: `validationWatch` computed the repository URL and then
  // did not pass it to `validationVerdict`, whose parameter defaulted to the
  // truthy string "unknown". An issue whose body named no repository was
  // therefore diagnosed as a HEAD that could not be read, which sends the
  // author to troubleshoot GitHub instead of the issue. The unit test above
  // proved the branch in isolation; this one runs the command's own path on
  // injected issue data and asserts the verdict that comes out of it.
  //
  // The validated commit comes from the marketplace's own baseline marker on
  // a bot comment. Omakit never emits one (tests/unit/read-only.test.mjs
  // forbids the serializer and the literal in every source, this file
  // included), so this test composes one from the pinned policy's prefix
  // constant, for a comment that exists in memory only and is never posted.
  const pinDir = requirePinForTests()
  const policy = await import(pathToFileURL(join(pinDir, "scripts/security-baseline-policy.mjs")).href)
  const payload = {
    // `securityBaselineMarkerSchemaVersion` in scripts/security-baseline-record.mjs
    // at the pin, which does not export it.
    schemaVersion: 2,
    baselineVersion: policy.securityBaselineVersion,
    repository: "example/omarchy-plugin-fixture",
    pluginIds: ["io.example.fixture"],
    commitSha: A,
    checkedAt: "2026-09-01T00:00:00Z",
    outcome: "passed",
    enforcementMode: policy.securityBaselineEnforcementMode,
    findings: [],
    capabilities: [],
  }
  const marker = `${policy.securityBaselineMarkerPrefix}${Buffer.from(JSON.stringify(payload)).toString("base64url")} -->`
  const heads = []
  const result = await validationWatch({
    repoRoot: REPO_ROOT,
    issueUrl: `${MARKETPLACE_PIN.repository}/issues/1`,
    github: {
      issue: async () => ({ title: "[Plugin]: fixture", body: "A body with no Repository URL heading at all.", state: "open", user: { login: "author" }, labels: [] }),
      issueComments: async () => [{ user: { login: "github-actions[bot]" }, body: `validated
${marker}`, created_at: "2026-09-01T00:00:00Z" }],
      defaultBranchHead: async (url) => { heads.push(url); return { commit: B, branch: "main" } },
    },
  })
  assert.equal(result.plugin.repository, null)
  assert.deepEqual(heads, [], "no repository, so no HEAD is read")
  assert.equal(result.validated.commit, A)
  assert.equal(result.verdict.state, "unknown")
  assert.match(result.verdict.summary, /no plugin repository could be read from this issue/)
  assert.doesNotMatch(result.verdict.summary, /HEAD could not be read/)
  // The helper has no truthy default to fall back on: called the way the
  // command calls it, with the URL left out, it does not invent one.
  assert.match(readFileSync(new URL("../../tools/marketplace/watch.mjs", import.meta.url), "utf8"), /pushedAfterReview, repositoryUrl \}\) \{/)
})

test("the two marketplace issue forms are read by their own parser", () => {
  // `[Verify]:` update requests share the "Repository URL" heading with the
  // submission form but not the rest, so the submission parser runs that section
  // on until the next heading it recognises and rejects the result. Measured on
  // two real open update requests, which reported VALIDATION UNKNOWN until each form
  // was read with the parser the marketplace uses for it.
  const source = readFileSync(new URL("../../tools/marketplace/watch.mjs", import.meta.url), "utf8")
  assert.match(source, /parsePluginVerificationIssue/)
  assert.match(source, /parseLegacyListedSnapshotVerificationIssue/)
  assert.match(source, /extractRepositoryUrl/)
  // And the form actually used is reported, so nobody has to guess which parser won.
  assert.match(source, /form: issueKind/)
})

test("a bot account's comment is neither the discussion nor a reviewer, and does not date the last human review", async () => {
  // The report says "the latest human discussion other than the author's"
  // and counts comments "from a reviewer". Measured on 0.4.1: any login other
  // than the author's and github-actions[bot] counted, so a second automation
  // (a dependabot-style app, `user.type` Bot) was rendered as the discussion
  // and dated the "after the last human review comment" clause.
  const pinDir = requirePinForTests()
  const policy = await import(pathToFileURL(join(pinDir, "scripts/security-baseline-policy.mjs")).href)
  const payload = { schemaVersion: 2, baselineVersion: policy.securityBaselineVersion, repository: "example/omarchy-plugin-fixture", pluginIds: ["io.example.fixture"], commitSha: A, checkedAt: "2026-09-01T00:00:00Z", outcome: "passed", enforcementMode: policy.securityBaselineEnforcementMode, findings: [], capabilities: [] }
  const marker = `${policy.securityBaselineMarkerPrefix}${Buffer.from(JSON.stringify(payload)).toString("base64url")} -->`
  const comments = [
    { user: { login: "github-actions[bot]", type: "Bot" }, body: `validated\n${marker}`, created_at: "2026-09-01T00:00:00Z" },
    { user: { login: "reviewer", type: "User" }, body: "Please rename the id.", html_url: "https://github.com/x/1#c1", created_at: "2026-09-02T00:00:00Z" },
    { user: { login: "author", type: "User" }, body: "Done.", created_at: "2026-09-03T00:00:00Z" },
    { user: { login: "some-app[bot]", type: "Bot" }, body: "Automated notice.", html_url: "https://github.com/x/1#c4", created_at: "2026-09-05T00:00:00Z" },
    { user: { login: "another-app", type: "Bot" }, body: "Another automated notice.", html_url: "https://github.com/x/1#c5", created_at: "2026-09-06T00:00:00Z" },
  ]
  const result = await validationWatch({
    repoRoot: REPO_ROOT,
    issueUrl: `${MARKETPLACE_PIN.repository}/issues/1`,
    github: {
      issue: async () => ({ title: "[Plugin]: fixture", body: "### Repository URL\n\nhttps://github.com/example/omarchy-plugin-fixture\n\n### Category\n\n", state: "open", user: { login: "author" }, labels: [] }),
      issueComments: async () => comments,
      defaultBranchHead: async () => ({ commit: B, branch: "main", committedAt: "2026-09-04T00:00:00Z" }),
    },
  })
  assert.equal(result.read.maintainerComments, 1)
  assert.equal(result.read.lastMaintainerCommentAt, "2026-09-02T00:00:00Z")
  assert.equal(result.discussion.body, "Please rename the id.")
  assert.equal(result.verdict.state, "stale")
  assert.match(result.verdict.summary, /after the last human review comment/)
})
