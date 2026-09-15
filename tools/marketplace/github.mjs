// Read-only GitHub access. GET only, no mutation of any kind, and the
// credential is borrowed, used for GET, and never written anywhere.
//
// Omakit is read-only against omacom/omarchy-plugin-marketplace at all times.
// There is no code path in this repository that issues a POST, PATCH, PUT or
// DELETE, and no code path that creates an issue, comment, label or pull
// request. `omakit submit` prints a body for a person to post; it never posts.

import { execFileSync } from "node:child_process"

export class GitHubError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = "GitHubError"
    this.code = code
    this.status = status
  }
}

const USER_AGENT = "omakit-marketplace-submit (read-only; https://github.com/mtolhuys/omakit)"

/**
 * Where the read-only credential comes from, in order.
 *
 * `gh` is first among the things a person actually has. The audience for this
 * tool is people who submit plugins to a GitHub-hosted marketplace by opening
 * an issue; the overlap between them and people with `gh auth login` already
 * done is most of them. Asking them instead to mint a personal access token,
 * for a tool that only ever issues GET, is a bad trade: it is friction for the
 * honest case and a new long-lived secret on disk for the dishonest one. And
 * `gh` is the only source: it honours GH_TOKEN and GITHUB_TOKEN itself
 * (measured: `gh auth token` prints an environment token straight back), so
 * an agent with a token in its environment is covered through the same one
 * call, and omakit reads no variable of its own.
 *
 * Borrowing `gh`'s credential means borrowing whatever scopes that login has,
 * which is usually enough to write. This repository keeps that safe the only
 * way worth trusting, which is structurally rather than by intention: there is
 * exactly one `fetch` call site in the whole tool, it is in this file, its
 * method is the literal "GET", and tests/unit/read-only.test.mjs fails the
 * suite if a second one appears anywhere, if any file spawns `gh` with
 * arguments other than the four below, or if a credential is ever written to
 * disk.
 */
export const GH_ARGS = Object.freeze(["auth", "token", "--hostname", "github.com"])

/** GitHub's unauthenticated REST allowance, per hour, per IP. */
export const UNAUTHENTICATED_LIMIT = 60

// Long enough for a cold `gh` on a slow disk, short enough that a broken `gh`
// cannot hold up a command that does not need a credential at all.
const GH_TIMEOUT_MS = 4000

// A token shape, not a token: enough to tell a credential from `gh`'s own
// "not logged in" chatter, and it is never logged either way.
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{20,255}$/

/** The credential `gh` holds for github.com, or null if there is not one. */
export function ghCredential({ run = execFileSync } = {}) {
  let printed
  try {
    printed = run("gh", [...GH_ARGS], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GH_TIMEOUT_MS,
    })
  } catch {
    // Not installed, not signed in, or too slow to wait for. All three mean the
    // same thing here, and none of them is an error worth reporting: every
    // command that needs a credential works without one, just rate-limited.
    return null
  }
  const value = String(printed || "").trim()
  return TOKEN_SHAPE.test(value) ? value : null
}

/**
 * @param {{ gh?: () => string|null }} [options]
 * @returns {{ value: string|null, source: "gh"|null, detail: string }}
 */
export function resolveCredential({ gh = ghCredential } = {}) {
  const borrowed = gh()
  if (borrowed) return { value: borrowed, source: "gh", detail: "read from your `gh` login" }
  return {
    value: null,
    source: null,
    detail: `no GitHub login found; GitHub allows ${UNAUTHENTICATED_LIMIT} unauthenticated requests an hour`,
  }
}

let resolved = null

/**
 * The resolved credential, looked up once per process.
 *
 * Cached because resolving it may spawn `gh`, and `watch` asks for it on every
 * request. `refresh` is for the two commands that report the answer to a person
 * rather than use it.
 */
export function credential({ refresh = false } = {}) {
  if (refresh || !resolved) resolved = resolveCredential()
  return resolved
}

export function token() {
  return credential().value
}

/** The one host the borrowed gh credential may be sent to. */
export const CREDENTIAL_HOST = "api.github.com"

async function get(url, { accept, signal } = {}) {
  const { host } = new URL(url)
  // The credential is GitHub's and goes to GitHub's API and nowhere else.
  // Measured before this held: `omakit upgrade` and `doctor` sent the gh
  // token as a bearer to registry.npmjs.org, which answered 401, so both
  // reported "the npm registry did not answer" on every machine with a gh
  // login, and a GitHub credential had left GitHub.
  const authenticated = host === CREDENTIAL_HOST
  const headers = {
    accept: accept || (authenticated ? "application/vnd.github+json" : "application/json"),
    "user-agent": USER_AGENT,
  }
  const auth = authenticated ? token() : null
  if (auth) headers.authorization = `Bearer ${auth}`
  let response
  try {
    response = await fetch(url, { method: "GET", headers, redirect: "follow", ...(signal ? { signal } : {}) })
  } catch (error) {
    // Node reports every transport failure as "fetch failed" with the real
    // reason in `cause`. A person needs the reason, and the CLI keys its
    // remedy on the code, so both are carried out of here.
    const cause = error?.cause?.code || error?.cause?.message || error?.message || "fetch failed"
    const { host, pathname } = new URL(url)
    throw new GitHubError("network-unavailable", `${host} did not answer (${cause}) while reading ${pathname}`)
  }
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining")
    const hint = response.status === 403 && remaining === "0"
      ? (auth
        ? " (GitHub rate limit exhausted even authenticated; it resets within the hour)"
        : ` (GitHub rate limit exhausted at ${UNAUTHENTICATED_LIMIT} requests an hour; \`gh auth login\` raises it, and omakit reads that login read-only)`)
      : ""
    throw new GitHubError(
      response.status === 404 ? "not-found" : "github-unavailable",
      `GET ${url} returned ${response.status}${hint}`,
      response.status,
    )
  }
  return response
}

export async function getJson(url, options) {
  return (await get(url, options)).json()
}

export async function getText(url, accept) {
  return (await get(url, { accept })).text()
}

/** Parse a marketplace issue URL into its parts. */
export function parseIssueUrl(value) {
  const match = String(value || "").trim().match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)(?:[?#].*)?$/,
  )
  if (!match) throw new GitHubError("usage", `not a GitHub issue URL: ${value}`)
  return { owner: match[1], repository: match[2], number: Number(match[3]) }
}

export async function issue(owner, repository, number) {
  return getJson(`https://api.github.com/repos/${owner}/${repository}/issues/${number}`)
}

/** Resolve the account whose credential gh lent us; never persist it. */
export async function authenticatedUser() {
  if (!token()) throw new GitHubError("login-required", "Account-wide watch needs your GitHub login. Run `gh auth login`, or pass --user <login> to read a public account.")
  const user = await getJson("https://api.github.com/user")
  if (!user?.login) throw new GitHubError("github-unavailable", "GitHub did not return the signed-in account's login")
  return user.login
}

/** Repository issues by their creator. PRs are excluded; pagination never silently truncates. */
export async function repositoryIssues(owner, repository, creator, { readJson = getJson, maxPages = 100, labels } = {}) {
  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({ ...(creator ? { creator } : {}), ...(labels ? { labels } : {}), state: "open", sort: "updated", direction: "desc", per_page: "100", page: String(page) })
    const batch = await readJson(`https://api.github.com/repos/${owner}/${repository}/issues?${query}`)
    if (!Array.isArray(batch)) throw new GitHubError("github-unavailable", "GitHub did not return an issue list")
    all.push(...batch.filter((item) => !item.pull_request))
    if (batch.length < 100) return all
  }
  throw new GitHubError("issue-list-incomplete", `The issue list exceeded ${maxPages} pages; no complete account-wide result is available`)
}

export async function issueComments(owner, repository, number, maxPages = 10, readJson = getJson) {
  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await readJson(
      `https://api.github.com/repos/${owner}/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
    )
    if (!Array.isArray(batch)) throw new GitHubError("github-unavailable", "GitHub did not return issue comments")
    all.push(...batch)
    if (batch.length < 100) return all
  }
  throw new GitHubError("comments-incomplete", `Issue #${number} exceeded ${maxPages} comment pages; its latest baseline cannot be determined`)
}

/** Compare exact validated snapshots. The API caps its file list at 300: never classify a truncated diff. */
export async function compareCommits(repositoryUrl, previous, validated, { readJson = getJson } = {}) {
  const match = String(repositoryUrl).match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (!match || ![previous, validated].every((commit) => /^[a-f0-9]{40}$/i.test(commit))) throw new GitHubError("usage", "compare needs a repository and two full commit identifiers")
  const url = `https://api.github.com/repos/${match[1]}/${match[2]}/compare/${previous}...${validated}?per_page=1`
  const result = await readJson(url)
  if (!["ahead", "identical"].includes(result?.status)) throw new GitHubError("compare-not-forward", "validated snapshots are not a forward comparison")
  if (!Array.isArray(result.files) || result.files.length >= 300) throw new GitHubError("compare-incomplete", "compare file list unavailable or at the 300-file API limit")
  return { url, files: result.files }
}

/**
 * The current default-branch HEAD of a repository.
 *
 * With a token this uses the REST API, which names the default branch
 * explicitly. Without one it falls back to the repository's commit feed, the
 * same unauthenticated source the underlying measurement used, because that
 * feed does not consume the 60-requests-per-hour API allowance.
 */
export async function defaultBranchHead(repositoryUrl) {
  const match = String(repositoryUrl).match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (!match) throw new GitHubError("usage", `not a GitHub repository URL: ${repositoryUrl}`)
  const [, owner, repository] = match
  if (token()) {
    const meta = await getJson(`https://api.github.com/repos/${owner}/${repository}`)
    const branch = meta.default_branch
    const head = await getJson(`https://api.github.com/repos/${owner}/${repository}/commits/${encodeURIComponent(branch)}`)
    return {
      source: "api",
      branch,
      commit: String(head.sha).toLowerCase(),
      committedAt: head.commit?.committer?.date || head.commit?.author?.date || null,
      archived: meta.archived === true,
      private: meta.private === true,
    }
  }
  const feed = await getText(`https://github.com/${owner}/${repository}/commits.atom`, "application/atom+xml")
  const commit = feed.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/i)?.[1]
    || feed.match(/\/commit\/([0-9a-f]{40})/i)?.[1]
  if (!commit) throw new GitHubError("head-unreadable", `cannot read a commit from the commit feed of ${repositoryUrl}`)
  const branch = feed.match(/<title>Recent Commits to [^:]+:(.+?)<\/title>/)?.[1] || null
  const committedAt = feed.match(/<updated>([^<]+)<\/updated>/)?.[1] || null
  return { source: "commits.atom", branch, commit: commit.toLowerCase(), committedAt, archived: null, private: null }
}
