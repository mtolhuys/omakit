// Read-only GitHub access. GET only, no mutation of any kind, and the token is
// read from the environment and never written anywhere.
//
// Omakit is read-only against omacom/omarchy-plugin-marketplace at all times.
// There is no code path in this repository that issues a POST, PATCH, PUT or
// DELETE, and no code path that creates an issue, comment, label or pull
// request. `omakit submit` prints a body for a person to post; it never posts.

export class GitHubError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = "GitHubError"
    this.code = code
    this.status = status
  }
}

const USER_AGENT = "omakit-marketplace-submit (read-only; https://github.com/mtolhuys/omakit)"

export function token() {
  const value = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ""
  return value.trim() || null
}

async function get(url, { accept = "application/vnd.github+json" } = {}) {
  const headers = { accept, "user-agent": USER_AGENT }
  const auth = token()
  if (auth) headers.authorization = `Bearer ${auth}`
  const response = await fetch(url, { method: "GET", headers, redirect: "follow" })
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining")
    const hint = response.status === 403 && remaining === "0"
      ? " (GitHub rate limit exhausted; set GITHUB_TOKEN for read-only requests)"
      : ""
    throw new GitHubError(
      response.status === 404 ? "not-found" : "github-unavailable",
      `GET ${url} returned ${response.status}${hint}`,
      response.status,
    )
  }
  return response
}

export async function getJson(url) {
  return (await get(url)).json()
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

export async function issueComments(owner, repository, number, maxPages = 10) {
  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await getJson(
      `https://api.github.com/repos/${owner}/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
    )
    if (!Array.isArray(batch) || !batch.length) break
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
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
