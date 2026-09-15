import test from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { repositoryIssues, issueComments } from "../../tools/marketplace/github.mjs"
import { discoverWatchIssues, validationWatchAll, watchIssueTitle } from "../../tools/marketplace/watch.mjs"
import { askWatchIssues } from "../../tools/marketplace/ask.mjs"
import { renderWatchAll, renderWatchList } from "../../tools/marketplace/report.mjs"
import { plain, overflows } from "../../tools/marketplace/style.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const [owner, repository] = new URL(MARKETPLACE_PIN.repository).pathname.slice(1).split("/")
const A = "a".repeat(40)
const B = "b".repeat(40)
const subjects = [1, 2, 3].map((number) => ({
  number, title: `Request ${number}`, state: "open", user: { login: "author" }, labels: [],
}))
const discover = (items = subjects) => discoverWatchIssues({ github: {
  authenticatedUser: async () => "author", repositoryIssues: async () => items,
} })

test("account discovery uses the signed-in account and excludes PRs, closed, foreign and duplicate issues", async () => {
  const calls = []
  const result = await discoverWatchIssues({ github: {
    authenticatedUser: async () => "author",
    repositoryIssues: async (...args) => {
      calls.push(args)
      return [...subjects, subjects[0], { ...subjects[0], number: 4, pull_request: {} },
        { ...subjects[0], number: 5, user: { login: "other" } }, { ...subjects[0], number: 6, state: "closed" }]
    },
  } })
  assert.deepEqual(calls, [[owner.toLowerCase(), repository.toLowerCase(), "author"]])
  assert.equal(result.account, "author")
  assert.deepEqual(result.issues.map((issue) => issue.number), [1, 2, 3])
  assert.equal(result.issues[0].url, `${MARKETPLACE_PIN.repository}/issues/1`)
})

test("an explicit public account needs no login lookup, and account input cannot inject search parameters", async () => {
  const result = await discoverWatchIssues({ user: "author", github: {
    authenticatedUser: async () => { throw new Error("should not read a login") },
    repositoryIssues: async () => subjects,
  } })
  assert.equal(result.issues.length, 3)
  for (const user of ["", "author&state=all", "https://github.com/author", "a b"]) {
    await assert.rejects(discoverWatchIssues({ user }), { code: "usage" })
  }
  await assert.rejects(discoverWatchIssues({ github: {
    authenticatedUser: async () => { throw Object.assign(new Error("sign in"), { code: "login-required" }) },
  } }), { code: "login-required" })
})

test("repository discovery follows every page, even when a full page contains PRs", async () => {
  const urls = []
  const result = await repositoryIssues(owner, repository, "author", { readJson: async (url) => {
    urls.push(new URL(url))
    return urls.length === 1 ? Array.from({ length: 100 }, (_, number) => ({ number, pull_request: {} })) : subjects
  } })
  assert.deepEqual(result, subjects)
  assert.equal(urls.length, 2)
  assert.equal(urls[0].searchParams.get("creator"), "author")
  assert.equal(urls[0].searchParams.get("state"), "open")
  assert.equal(urls[1].searchParams.get("page"), "2")
  await assert.rejects(repositoryIssues(owner, repository, "author", {
    maxPages: 1, readJson: async () => Array.from({ length: 100 }, () => subjects[0]),
  }), { code: "issue-list-incomplete" })
  await assert.rejects(repositoryIssues(owner, repository, "author", { readJson: async () => ({}) }), { code: "github-unavailable" })
})

test("an empty account performs no issue or plugin reads", async () => {
  const discovery = await discover([])
  const result = await validationWatchAll({ repoRoot: REPO_ROOT, discovery, github: {
    issue: async () => { throw new Error("unexpected read") },
  } })
  assert.deepEqual(result.summary, { total: 0, current: 0, stale: 0, unknown: 0 })
  assert.deepEqual(result.issues, [])
})

test("a capped comment history cannot silently compare an old baseline", async () => {
  await assert.rejects(issueComments(owner, repository, 1, 1,
    async () => Array.from({ length: 100 }, () => ({ body: "comment" }))), { code: "comments-incomplete" })
  let pages = 0
  const comments = await issueComments(owner, repository, 1, 10,
    async () => ++pages === 1 ? Array.from({ length: 100 }, () => ({ body: "comment" })) : [{ body: "latest" }])
  assert.equal(comments.length, 101)
  assert.equal(comments.at(-1).body, "latest")
})

test("batch checking bounds concurrent issue reads to four", async () => {
  const many = Array.from({ length: 9 }, (_, index) => ({ ...subjects[0], number: index + 1 }))
  let active = 0
  let peak = 0
  const result = await validationWatchAll({ repoRoot: REPO_ROOT, discovery: await discover(many), github: {
    issue: async (_, __, number) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return { ...many[number - 1], body: "" }
    },
    issueComments: async () => [],
  } })
  assert.equal(peak, 4)
  assert.equal(result.summary.unknown, 9)
})

test("batch watches retain failures, preserve discovery order, and share HEAD reads across issues", async () => {
  const policy = await import(pathToFileURL(join(requirePinForTests(), "scripts/security-baseline-policy.mjs")).href)
  // Compose the pin's marker only in an in-memory fixture, as in watch.test.mjs.
  const marker = (commitSha) => `${policy.securityBaselineMarkerPrefix}${Buffer.from(JSON.stringify({
    schemaVersion: 2, baselineVersion: policy.securityBaselineVersion,
    repository: "example/plugin", pluginIds: ["io.example.fixture"], commitSha,
    checkedAt: "2026-09-15T00:00:00Z", outcome: "passed", enforcementMode: policy.securityBaselineEnforcementMode,
    findings: [], capabilities: [],
  })).toString("base64url")} -->`
  let heads = 0
  const result = await validationWatchAll({ repoRoot: REPO_ROOT, discovery: await discover(), github: {
    issue: async (_, __, number) => ({ ...subjects[number - 1], body: "### Repository URL\n\nhttps://github.com/example/plugin\n\n### Category\n\n" }),
    issueComments: async (_, __, number) => {
      if (number === 2) throw Object.assign(new Error("GitHub rate limit exhausted"), { code: "github-unavailable" })
      return [{ user: { login: "github-actions[bot]" }, body: marker(number === 1 ? A : B), created_at: "2026-09-15T00:00:00Z" },
        { user: { login: "reviewer" }, body: "Please inspect the installer", html_url: "https://github.com/example/review", created_at: "2026-09-15T01:00:00Z" }]
    },
    defaultBranchHead: async () => { heads += 1; return { commit: A, branch: "main" } },
  } })
  assert.equal(heads, 1)
  assert.deepEqual(result.summary, { total: 3, current: 1, stale: 1, unknown: 1 })
  assert.deepEqual(result.issues.map((row) => row.issue.number), [1, 2, 3])
  assert.equal(result.issues[1].error.code, "github-unavailable")
  assert.equal(result.issues[0].report.discussion.body, "Please inspect the installer")
})

function terminal(answer) {
  const input = new PassThrough()
  const written = []
  input.end(answer)
  return { input, output: { write: (text) => written.push(text) }, text: () => written.join("") }
}

test("the picker selects multiple issues, retries invalid choices, and handles all, cancellation and EOF", async () => {
  const issues = (await discover()).issues
  const picked = terminal("0\n2,1,2\n")
  assert.deepEqual(await askWatchIssues({ issues, ...picked, colour: false }), [issues[1], issues[0]])
  assert.match(picked.text(), /Answer with list numbers/)
  assert.deepEqual(await askWatchIssues({ issues, ...terminal("all\n"), colour: false }), issues)
  assert.deepEqual(await askWatchIssues({ issues, ...terminal("q\n"), colour: false }), [])
  await assert.rejects(askWatchIssues({ issues, ...terminal(""), colour: false }), { code: "usage" })
})

test("batch and list reports share colour/plain output, wrap titles, and keep issue text inert", async () => {
  const discovery = await discover([{ ...subjects[0], title: `Long ${"word ".repeat(60)}` }])
  const batch = { ...discovery, mode: "all", summary: { total: 1, current: 0, stale: 0, unknown: 1 },
    issues: [{ issue: discovery.issues[0], report: null, error: { message: "network unavailable" } }],
  }
  for (const [render, value] of [[renderWatchList, discovery], [renderWatchAll, batch]]) {
    const text = render(value, { colour: false })
    assert.equal(plain(render(value, { colour: true })), text)
    assert.deepEqual(text.split("\n").filter((line) => overflows(line)), [])
    assert.ok(text.includes(discovery.issues[0].url))
  }
  assert.equal(watchIssueTitle("title\nnext\rline"), "title next line")
  assert.match(renderWatchAll(batch, { colour: false }), /does not mean review,\s+approval or publication/)
})

test("ambiguous watch modes and noninteractive pickers fail before any network access", () => {
  for (const args of [["--all", "--list"], [`${MARKETPLACE_PIN.repository}/issues/1`, "--all"],
    [`${MARKETPLACE_PIN.repository}/issues/1`, "--user", "author"], ["--json"], ["--out", "/tmp/unused-watch-result"]]) {
    const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), "watch", ...args], { encoding: "utf8" })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /usage/)
    assert.equal(result.stdout, "")
  }
})
