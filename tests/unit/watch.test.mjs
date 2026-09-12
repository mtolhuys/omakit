// The pin watch's verdict logic, offline. The network path is exercised
// separately against a real listed repository and its evidence is committed
// under docs/evidence/pin-watch/.
import test from "node:test"
import assert from "node:assert/strict"
import { pinVerdict, validationCommentCommit, REFRESH_ACTION } from "../../tools/marketplace/watch.mjs"
import { parseIssueUrl, GitHubError } from "../../tools/marketplace/github.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)

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
  const verdict = pinVerdict({
    comparable: true, stale: false, validated: { commit: A }, head: { commit: A, branch: "main" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(verdict.state, "current")
  assert.equal(verdict.action, null)
  assert.match(verdict.summary, /current main-branch HEAD/)
})

test("a stale pin names both commits and the one action that moves it", () => {
  const verdict = pinVerdict({
    comparable: true, stale: true, validated: { commit: A }, head: { commit: B, branch: "master" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(verdict.state, "stale")
  assert.ok(verdict.summary.includes(A))
  assert.ok(verdict.summary.includes(B))
  assert.match(verdict.summary, /Pushing it did not tell the marketplace, and neither did any comment/)
  assert.equal(verdict.action, REFRESH_ACTION)
  assert.match(verdict.action, /Edit the issue body/)
})

test("a push after the last human review comment is called out", () => {
  const verdict = pinVerdict({
    comparable: true, stale: true, validated: { commit: A }, head: { commit: B, branch: "main" },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: true,
  })
  assert.match(verdict.summary, /after the last human review comment/)
})

test("no validated commit is 'unknown', never 'current'", () => {
  const none = pinVerdict({
    comparable: false, stale: null, validated: null, head: { commit: B },
    fallback: null, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(none.state, "unknown")
  assert.match(none.summary, /no pinned commit/)

  const short = pinVerdict({
    comparable: false, stale: null, validated: null, head: { commit: B },
    fallback: { short: "abc1234" }, baselineError: null, headError: null, pushedAfterReview: false,
  })
  assert.equal(short.state, "unknown")
  assert.match(short.summary, /too short to compare/)
  assert.equal(short.action, REFRESH_ACTION)
})

test("an incomplete baseline and an unreadable HEAD are both 'unknown'", () => {
  const baseline = pinVerdict({
    comparable: false, stale: null, validated: null, head: null, fallback: null,
    baselineError: { code: "approval-security-baseline-missing" }, headError: null, pushedAfterReview: false,
  })
  assert.equal(baseline.state, "unknown")
  assert.match(baseline.summary, /did not complete/)

  const head = pinVerdict({
    comparable: false, stale: null, validated: { commit: A }, head: null, fallback: null,
    baselineError: null, headError: { code: "not-found" }, pushedAfterReview: false,
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
