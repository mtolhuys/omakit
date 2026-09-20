// The validation watch's verdict logic, offline. The network path is exercised
// separately against a real listed repository and its evidence is committed
// by the two real runs recorded in docs/VALIDATION_WATCH.md.
import test from "node:test"
import assert from "node:assert/strict"
import { validationWatch, validationVerdict, validationCommentCommit, validationComment, submissionFeedback, sameRepository, resolveWatchSubject, subjectApplies, REFRESH_ACTION } from "../../tools/marketplace/watch.mjs"
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
  assert.match(readFileSync(new URL("../../tools/marketplace/watch.mjs", import.meta.url), "utf8"), /pushedAfterReview, repositoryUrl, origin = null, repositoryMatches = null, refusal = null \}\) \{/)
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

// --- the subject, and a failed validation -----------------------------------
//
// omacom/omarchy-plugin-marketplace#7787, 2026-09-20 (UTC). 13:37 opened from
// `omakit submit`, validated. 16:12 body edited by hand to retry, validated
// again, marker checkedAt 16:12. 19:18 body retyped by an agent: the
// Repository URL became mtolhuijs/omacrunch (an existing account, no such
// repository) and the Maintainer notes were wiped. 19:19:13 the marketplace
// edited its validation comment to "Validation failed: The repository could
// not be reached." and labelled needs-fixes. `omakit watch` reported the 404
// as `unknown`, "HEAD could not be read": the symptom, not the cause, because
// it never saw the plugin's origin and never read a failed validation.

const ISSUE_BODY = (url) => `### Repository URL\n\n${url}\n\n### Category\n\nDesktop\n\n### Tags\n\nBar\n\n### Suggest a missing tag\n\n_No response_\n\n### Maintainer notes\n\n_No response_\n\n### Submission checklist\n\n- [X] x\n`

async function markerComment(commit, checkedAt) {
  const pinDir = requirePinForTests()
  const policy = await import(pathToFileURL(join(pinDir, "scripts/security-baseline-policy.mjs")).href)
  const payload = { schemaVersion: 2, baselineVersion: policy.securityBaselineVersion, repository: "mtolhuys/omacrunch", pluginIds: ["io.github.mtolhuys.omacrunch"], commitSha: commit, checkedAt, outcome: "passed", enforcementMode: policy.securityBaselineEnforcementMode, findings: [], capabilities: [] }
  return { user: { login: "github-actions[bot]", type: "Bot" }, body: `validated\n${policy.securityBaselineMarkerPrefix}${Buffer.from(JSON.stringify(payload)).toString("base64url")} -->`, created_at: checkedAt, updated_at: checkedAt }
}

const FAILED_COMMENT = (updatedAt, reason = "The repository could not be reached.", action = "Confirm that it is public and available, then edit the issue to retry.") => ({
  user: { login: "github-actions[bot]", type: "Bot" },
  body: `<!-- marketplace-validation -->\n## Marketplace validation\n\n❌ **Validation failed:** ${reason}\n\n${action}`,
  created_at: "2026-09-20T13:38:35Z", updated_at: updatedAt,
})

async function watch({ issueUrl = "https://github.com/mtolhuys/omacrunch", subject, comments, labels = [], head = { commit: A, branch: "main" }, bodySuffix = "" }) {
  const heads = []
  const report = await validationWatch({
    repoRoot: REPO_ROOT,
    issueUrl: `${MARKETPLACE_PIN.repository}/issues/7787`,
    subject,
    github: {
      issue: async () => ({ title: "[Plugin]: Omacrunch", body: ISSUE_BODY(issueUrl) + bodySuffix, state: "open", user: { login: "mtolhuys" }, labels }),
      issueComments: async () => comments,
      defaultBranchHead: async (url) => { heads.push(url); if (head instanceof Error) throw head; return head },
    },
  })
  return { report, heads }
}

test("two repository URLs are the same repository across https, .git, a trailing slash and case; a different owner is not", () => {
  assert.equal(sameRepository("https://github.com/MTolhuys/Omacrunch.git", "https://github.com/mtolhuys/omacrunch/"), true)
  assert.equal(sameRepository("git@github.com:mtolhuys/omacrunch.git", "https://github.com/mtolhuys/omacrunch"), true)
  assert.equal(sameRepository("https://github.com/mtolhuijs/omacrunch", "https://github.com/mtolhuys/omacrunch"), false)
  assert.equal(sameRepository("not a url", "https://github.com/mtolhuys/omacrunch"), null)
})

test("the subject is a github.com URL as given, or the origin of a checkout, and nothing when there is neither", () => {
  assert.deepEqual(resolveWatchSubject("https://github.com/mtolhuys/omacrunch.git"), { origin: "https://github.com/mtolhuys/omacrunch", source: "url" })
  assert.deepEqual(resolveWatchSubject(REPO_ROOT), { origin: "https://github.com/mtolhuys/omakit", source: "path" })
  assert.equal(resolveWatchSubject(undefined, { cwd: "/" }), null, "a directory that is no checkout is no subject")
  assert.throws(() => resolveWatchSubject("https://example.com/x/y"), /github\.com repository URL or a local checkout/)
  // The current directory carries its manifest, or null when it has none:
  // this repository is a checkout without a plugin manifest.
  assert.deepEqual(resolveWatchSubject(undefined, { cwd: REPO_ROOT }), { origin: "https://github.com/mtolhuys/omakit", source: "cwd", manifest: null })
})

test("an implicit subject applies only when the issue is that plugin, by title name or body id; an explicit one always does", () => {
  // Found in review: run from the omakit checkout, `omakit watch <omacrunch
  // issue>` compared the issue with omakit's origin and told the reader to
  // put omakit's URL into omacrunch's issue.
  const issue = { title: "[Plugin]: Omacrunch", body: ISSUE_BODY("https://github.com/mtolhuys/omacrunch") + "\nio.github.mtolhuys.omacrunch" }
  const cwd = (manifest) => ({ origin: "https://github.com/mtolhuys/omakit", source: "cwd", manifest })
  assert.equal(subjectApplies(cwd(null), issue, "[Plugin]: "), false, "no manifest, no comparison")
  assert.equal(subjectApplies(cwd({ name: "Omakit", id: "io.github.mtolhuys.omakit" }), issue, "[Plugin]: "), false, "another plugin's checkout")
  assert.equal(subjectApplies(cwd({ name: "omacrunch", id: "" }), issue, "[Plugin]: "), true, "same name, case aside")
  assert.equal(subjectApplies(cwd({ name: "Other", id: "io.github.mtolhuys.omacrunch" }), issue, "[Plugin]: "), true, "same id in the body")
  assert.equal(subjectApplies(cwd({ name: "Omacrunch", id: "" }), { ...issue, title: "[Verify]: Omacrunch" }, "[Plugin]: "), false, "a name match needs the submission title")
  assert.equal(subjectApplies({ origin: "https://github.com/mtolhuys/omakit", source: "path" }, issue, "[Plugin]: "), true, "an explicit path is asserted")
  assert.equal(subjectApplies({ origin: "https://github.com/mtolhuys/omakit", source: "url" }, issue, "[Plugin]: "), true, "an explicit URL is asserted")
  assert.equal(subjectApplies(null, issue, "[Plugin]: "), false)
})

test("the current directory being another plugin's checkout is not compared: the verdict stands, the report says why", async () => {
  const elsewhere = { origin: "https://github.com/mtolhuys/omakit", source: "cwd", manifest: { name: "Omakit", id: "io.github.mtolhuys.omakit" } }
  const { report } = await watch({ subject: elsewhere, comments: [await markerComment(A, "2026-09-20T16:12:00Z")] })
  assert.equal(report.plugin.origin, null)
  assert.equal(report.plugin.repositoryMatches, null)
  assert.equal(report.verdict.state, "current", "a correct issue stays current")
  assert.equal(report.plugin.subjectSkipped.origin, "https://github.com/mtolhuys/omakit")
  assert.match(report.plugin.subjectSkipped.reason, /the current directory is https:\/\/github\.com\/mtolhuys\/omakit, not this plugin; pass the plugin checkout or URL as the second argument/)
  // The same directory as the same plugin, by name, with the #7787 typo in the issue: wrong-repository.
  const same = { origin: "https://github.com/mtolhuys/omacrunch", source: "cwd", manifest: { name: "omacrunch", id: "" } }
  const typo = await watch({ issueUrl: "https://github.com/mtolhuijs/omacrunch", subject: same, comments: [await markerComment(A, "2026-09-20T16:12:00Z")] })
  assert.equal(typo.report.verdict.state, "wrong-repository")
  assert.equal(typo.report.plugin.subjectSkipped, null)
  // And by id alone, when the title does not carry the name.
  const byId = { origin: "https://github.com/mtolhuys/omacrunch", source: "cwd", manifest: { name: "Something Else", id: "io.github.mtolhuys.omacrunch" } }
  const idMatch = await watch({ issueUrl: "https://github.com/mtolhuijs/omacrunch", subject: byId, comments: [await markerComment(A, "2026-09-20T16:12:00Z")], bodySuffix: "\nPlugin id: io.github.mtolhuys.omacrunch\n" })
  assert.equal(idMatch.report.verdict.state, "wrong-repository")
  // An explicit path to another plugin is asserted, and compared.
  const asserted = await watch({ subject: { origin: "https://github.com/mtolhuys/omakit", source: "path" }, comments: [await markerComment(A, "2026-09-20T16:12:00Z")] })
  assert.equal(asserted.report.verdict.state, "wrong-repository")
})

test("an issue whose Repository URL names another owner than the plugin's origin is wrong-repository, over every other state", async () => {
  // #7787 at 19:19: the issue said mtolhuijs, origin said mtolhuys, the
  // marketplace's 404 came back as "HEAD could not be read (not-found)".
  const notFound = Object.assign(new GitHubError("not-found", "GET ... returned 404"), {})
  const { report } = await watch({ issueUrl: "https://github.com/mtolhuijs/omacrunch", subject: { origin: "https://github.com/mtolhuys/omacrunch" },
    comments: [await markerComment(A, "2026-09-20T16:12:00Z")], head: notFound })
  assert.equal(report.plugin.origin, "https://github.com/mtolhuys/omacrunch")
  assert.equal(report.plugin.repositoryMatches, false)
  assert.equal(report.verdict.state, "wrong-repository")
  assert.match(report.verdict.summary, /Repository URL is https:\/\/github\.com\/mtolhuijs\/omacrunch, the plugin's origin is https:\/\/github\.com\/mtolhuys\/omacrunch/)
  assert.match(report.verdict.summary, /validating the wrong repository, or none/)
  assert.equal(report.verdict.action, "Edit the issue and set the Repository URL field to https://github.com/mtolhuys/omacrunch. Change nothing else.")
  assert.doesNotMatch(report.verdict.summary, /HEAD could not be read/)
  // And it wins over a refusal on the same issue.
  const refused = await watch({ issueUrl: "https://github.com/mtolhuijs/omacrunch", subject: { origin: "https://github.com/mtolhuys/omacrunch" },
    comments: [await markerComment(A, "2026-09-20T16:12:00Z"), FAILED_COMMENT("2026-09-20T19:19:13Z")], head: notFound })
  assert.equal(refused.report.verdict.state, "wrong-repository")
  assert.equal(refused.report.refusal.code, "repository-unreachable", "the refusal is still in the document")
})

test("a .git suffix and a case difference are the same repository: the issue matches, and the verdict is the commit comparison", async () => {
  const { report } = await watch({ issueUrl: "https://github.com/MTolhuys/Omacrunch.git", subject: { origin: "https://github.com/mtolhuys/omacrunch" },
    comments: [await markerComment(A, "2026-09-20T16:12:00Z")] })
  assert.equal(report.plugin.repositoryMatches, true)
  assert.equal(report.verdict.state, "current")
})

test("without a subject nothing is compared: repositoryMatches is null and the verdict is what it was", async () => {
  const { report } = await watch({ issueUrl: "https://github.com/mtolhuijs/omacrunch", comments: [await markerComment(A, "2026-09-20T16:12:00Z")] })
  assert.equal(report.plugin.origin, null)
  assert.equal(report.plugin.repositoryMatches, null)
  assert.equal(report.verdict.state, "current")
})

test("a failed validation comment is mapped back to the marketplace's own code through the pinned feedback table", async () => {
  const feedback = await submissionFeedback(requirePinForTests())
  assert.ok(feedback.length >= 30, "the pinned table has its codes")
  const read = validationComment([FAILED_COMMENT("2026-09-20T19:19:13Z")], feedback)
  assert.equal(read.kind, "failed")
  assert.equal(read.code, "repository-unreachable")
  assert.equal(read.reason, "The repository could not be reached.")
  assert.equal(read.action, "Confirm that it is public and available, then edit the issue to retry.")
  assert.equal(read.at, "2026-09-20T19:19:13Z", "the time of a refusal is updated_at: the marketplace edits its comment in place")
  // Without the bold markers, as the incident report quoted it, the same.
  const plain = validationComment([{ body: "<!-- marketplace-validation -->\n❌ Validation failed: The repository could not be reached\n\nConfirm that it is public and available, then edit the issue to retry.", created_at: "2026-09-20T13:38:35Z", updated_at: "2026-09-20T19:19:13Z" }], feedback)
  assert.equal(plain.code, "repository-unreachable")
  // A passed comment is the passed kind, with the short commit.
  const passed = validationComment([{ body: "<!-- marketplace-validation -->\n✅ Quattro compatibility passed at commit `0bb9beb`\n", created_at: "2026-09-20T13:38:35Z", updated_at: "2026-09-20T19:41:00Z" }], feedback)
  assert.deepEqual(passed, { kind: "passed", short: "0bb9beb", at: "2026-09-20T19:41:00Z", createdAt: "2026-09-20T13:38:35Z" })
  assert.equal(validationComment([{ body: "no marker" }], feedback), null)
})

test("a reason the pinned table does not know is reported verbatim with code unrecognised", async () => {
  const feedback = await submissionFeedback(requirePinForTests())
  const read = validationComment([FAILED_COMMENT("2026-09-20T19:19:13Z", "A reason nobody wrote down.", "Do the one thing.")], feedback)
  assert.equal(read.code, "unrecognised")
  assert.equal(read.reason, "A reason nobody wrote down.")
  assert.equal(read.action, "Do the one thing.")
  const { report } = await watch({ subject: { origin: "https://github.com/mtolhuys/omacrunch" }, comments: [read && FAILED_COMMENT("2026-09-20T19:19:13Z", "A reason nobody wrote down.", "Do the one thing.")] })
  assert.equal(report.verdict.state, "refused")
  assert.match(report.verdict.summary, /unrecognised, A reason nobody wrote down\./)
  assert.equal(report.verdict.action, "Do the one thing.")
})

test("a refusal newer than the baseline marker is the current state, and carries the marketplace's own action", async () => {
  // #7787: marker checkedAt 16:12, validation comment updated 19:19:13.
  const { report } = await watch({ subject: { origin: "https://github.com/mtolhuys/omacrunch" }, labels: ["submission", "needs-fixes"],
    comments: [await markerComment(A, "2026-09-20T16:12:00Z"), FAILED_COMMENT("2026-09-20T19:19:13Z")] })
  assert.equal(report.plugin.repositoryMatches, true)
  assert.deepEqual(report.refusal, { code: "repository-unreachable", reason: "The repository could not be reached.", action: "Confirm that it is public and available, then edit the issue to retry.", at: "2026-09-20T19:19:13Z" })
  assert.deepEqual(report.labelState, { blocking: ["needs-fixes"], validated: false, reviewRequired: false })
  assert.equal(report.verdict.state, "refused")
  assert.equal(report.verdict.summary, "The marketplace refused this issue at 2026-09-20T19:19:13Z: repository-unreachable, The repository could not be reached. Confirm that it is public and available, then edit the issue to retry.")
  assert.equal(report.verdict.action, "Confirm that it is public and available, then edit the issue to retry.")
  assert.equal(report.validated.commit, A, "the stale marker is still reported")
  // With no marker at all, the refusal is the state as well.
  const bare = await watch({ subject: { origin: "https://github.com/mtolhuys/omacrunch" }, comments: [FAILED_COMMENT("2026-09-20T19:19:13Z")] })
  assert.equal(bare.report.verdict.state, "refused")
})

test("a baseline marker newer than the refusal wins: the refusal is history, and the commits are compared", async () => {
  // #7787 at 19:34:52: the corrected retry validated, and the marker moved
  // past the 19:19:13 refusal; the validation comment was rewritten too,
  // but a comment that still read "failed" with an older updated_at would
  // not be the state either.
  const { report } = await watch({ subject: { origin: "https://github.com/mtolhuys/omacrunch" }, labels: ["submission", "validated"],
    comments: [FAILED_COMMENT("2026-09-20T19:19:13Z"), await markerComment(A, "2026-09-20T19:34:52.537Z")] })
  assert.equal(report.refusal, null)
  assert.equal(report.validationComment.kind, "failed", "the comment is still read")
  assert.deepEqual(report.labelState, { blocking: [], validated: true, reviewRequired: false })
  assert.equal(report.verdict.state, "current")
})

test("the verdict order is wrong-repository, refused, then the rest", () => {
  const base = { comparable: true, stale: false, validated: { commit: A }, head: { commit: A, branch: "main" }, fallback: null, baselineError: null, headError: null, pushedAfterReview: false, repositoryUrl: REPOSITORY }
  const refusal = { code: "readme-missing", reason: "A README file is required in the repository root.", action: "Add the root README and edit the issue to retry.", at: "2026-09-20T19:19:13Z" }
  assert.equal(validationVerdict({ ...base, origin: "https://github.com/other/repo", repositoryMatches: false, refusal }).state, "wrong-repository")
  assert.equal(validationVerdict({ ...base, refusal, baselineError: { code: "x" } }).state, "refused")
  assert.equal(validationVerdict({ ...base, refusal }).action, refusal.action)
  assert.equal(validationVerdict({ ...base, repositoryMatches: true }).state, "current")
  assert.equal(validationVerdict({ ...base }).state, "current")
})
