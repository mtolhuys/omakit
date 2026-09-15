// The validation watch. This is the reason the tool exists.
//
// The marketplace validates one exact commit, and the review that follows is
// of that commit. The only action that makes it validate a newer one is
// editing the issue body:
// `route-issue-automation.yml` is the only workflow with a direct `issues`
// trigger (`opened, edited, reopened, labeled, unlabeled`), there is no
// `issue_comment` trigger anywhere in the marketplace, and `refresh-catalog.yml`
// compares branch HEADs only for repositories that are already listed. So
// pushing a fix does nothing, and commenting "fixed in abc123" does nothing.
//
// Measured reason (docs/MEASUREMENTS.md M6): of the 464 submissions parked in
// the author's court, 73% have a default-branch HEAD ahead of the validated
// commit. 47% pushed after the maintainer's review without the marketplace ever
// seeing it, and 82% of those authors also commented, so they are engaged and
// stuck rather than gone. Of 13 open submissions inspected with no labels left,
// 9 had passed validation and passed the automated security baseline with zero
// findings and were blocked solely because their validated commit had fallen
// behind while they waited. 46% of the maintainer's own requests for a fresh validation never
// produced one; in the parked group 77% never did. The instruction that would
// fix this appears 22 times in the failure path of
// `scripts/submission-feedback.mjs` and zero times in the success path of
// `scripts/validate-submission.mjs`, which is the path 97 of 100 parked
// submissions took.
//
// This command reads. It never edits the issue, never comments, never labels.
// The action it names is the author's to take.

import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { authenticatedUser, repositoryIssues, defaultBranchHead, issue, issueComments, parseIssueUrl, token, GitHubError } from "./github.mjs"

export class WatchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "WatchError"
    this.code = code
  }
}

const MARKETPLACE_SLUG = MARKETPLACE_PIN.repository.replace(/^https:\/\/github\.com\//, "").toLowerCase()

/** Text from an issue remains data, including at a terminal. JSON retains the original title. */
export function watchIssueTitle(value) {
  return String(value || "").replace(/[\p{Cc}\p{Cf}]/gu, " ")
}

/** Discover the account's open marketplace issues, without reading every plugin. */
export async function discoverWatchIssues({ user, github = {}, onPhase = () => {} } = {}) {
  const read = { authenticatedUser, repositoryIssues, ...github }
  if (user !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) {
    throw new WatchError("usage", "--user needs a GitHub login, not a URL or search query")
  }
  onPhase("reading the GitHub account")
  const account = user || await read.authenticatedUser()
  const [owner, repository] = MARKETPLACE_SLUG.split("/")
  onPhase(`reading open marketplace issues for ${account}`)
  const subjects = await read.repositoryIssues(owner, repository, account)
  // Check the response as well as the server-side creator filter. Never turn
  // another author's issue, or a PR, into an account-wide watch target.
  const seen = new Set()
  const issues = subjects.filter((subject) => {
    if (subject.pull_request || subject.state !== "open" || subject.user?.login?.toLowerCase() !== account.toLowerCase()) return false
    if (!Number.isSafeInteger(subject.number) || subject.number < 1 || seen.has(subject.number)) return false
    seen.add(subject.number)
    return true
  }).map((subject) => ({
    number: subject.number,
    url: `${MARKETPLACE_PIN.repository}/issues/${subject.number}`,
    title: subject.title,
    state: subject.state,
    labels: (subject.labels || []).map((label) => typeof label === "string" ? label : label?.name).filter(Boolean),
    updatedAt: subject.updated_at || null,
  }))
  return { mode: "list", account, marketplace: MARKETPLACE_PIN.repository, issues }
}

/** A batch keeps independent read failures visible and shares repository HEAD reads. */
export async function validationWatchAll({ repoRoot, discovery, github = {}, onPhase = () => {} }) {
  if (discovery.issues.length) requirePin(repoRoot)
  const heads = new Map()
  const readHead = github.defaultBranchHead || defaultBranchHead
  const shared = { ...github, defaultBranchHead: (url) => {
    if (!heads.has(url)) heads.set(url, Promise.resolve().then(() => readHead(url)))
    return heads.get(url)
  } }
  const results = new Array(discovery.issues.length)
  let next = 0
  async function worker() {
    while (next < discovery.issues.length) {
      const index = next++
      const target = discovery.issues[index]
      onPhase(`checking issue #${target.number} (${index + 1}/${discovery.issues.length})`)
      try {
        results[index] = { issue: target, report: await validationWatch({ repoRoot, issueUrl: target.url, github: shared }), error: null }
      } catch (error) {
        results[index] = { issue: target, report: null, error: { code: error.code || "watch-unavailable", message: error.message } }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, discovery.issues.length) }, worker))
  const summary = { total: results.length, current: 0, stale: 0, unknown: 0 }
  for (const result of results) summary[result.report?.verdict.state || "unknown"] += 1
  return { mode: "all", account: discovery.account, marketplace: discovery.marketplace, summary, issues: results }
}

// The one action that re-runs validation, in the register the marketplace itself
// uses in its own failure feedback.
export const REFRESH_ACTION =
  "Edit the issue body. That is the only action that re-runs validation and the security baseline against a new commit: a push does not, and a comment does not."

async function loadRecord(pinDir) {
  return import(pathToFileURL(join(pinDir, "scripts/security-baseline-record.mjs")).href)
}

async function loadSubmission(pinDir) {
  return import(pathToFileURL(join(pinDir, "scripts/submission.mjs")).href)
}

async function loadVerification(pinDir) {
  return import(pathToFileURL(join(pinDir, "scripts/plugin-verification-request.mjs")).href)
}

/**
 * Which repository an issue is about.
 *
 * The marketplace has two issue forms and they are not interchangeable. A
 * `[Plugin]:` submission is read by `extractRepositoryUrl`; a `[Verify]:` update
 * request has its own headings, and feeding it to the submission parser fails
 * in a misleading way, because "Repository URL" is a heading both forms use and
 * the submission parser then runs the section on until the next heading it
 * happens to recognise. So each form is read by the parser the marketplace
 * itself uses for it, and the issue says which one it is.
 */
async function repositoryFor(pinDir, subject) {
  const submission = await loadSubmission(pinDir)
  const verification = await loadVerification(pinDir)
  const title = String(subject.title || "")
  const attempts = title.startsWith("[Verify]")
    ? [
      ["verify", () => verification.parsePluginVerificationIssue(subject.body).repoUrl],
      ["verify-legacy", () => verification.parseLegacyListedSnapshotVerificationIssue(subject.body).repoUrl],
      ["submission", () => submission.extractRepositoryUrl(subject.body)],
    ]
    : [
      ["submission", () => submission.extractRepositoryUrl(subject.body)],
      ["verify", () => verification.parsePluginVerificationIssue(subject.body).repoUrl],
    ]
  const errors = []
  for (const [kind, read] of attempts) {
    try {
      const url = read()
      if (url) return { url, kind, error: null }
    } catch (error) {
      errors.push(`${kind}: ${error.message}`)
    }
  }
  return { url: null, kind: null, error: errors.join("; ") }
}

/** The short commit the validation comment reports, as a fallback when no baseline marker exists. */
export function validationCommentCommit(comments) {
  const validation = (comments || [])
    .filter((comment) => String(comment.body || "").includes("<!-- marketplace-validation -->"))
    .at(-1)
  if (!validation) return null
  const short = String(validation.body).match(/passed at commit `([0-9a-f]{7,40})`/i)?.[1]
  return short ? { short: short.toLowerCase(), createdAt: validation.created_at || null } : null
}

/**
 * @param {{ repoRoot: string, issueUrl: string, onPhase?: (name: string) => void,
 *           github?: { issue?: typeof issue, issueComments?: typeof issueComments, defaultBranchHead?: typeof defaultBranchHead } }} options
 *   `github` is injectable for tests, so the whole path from an issue body to
 *   a verdict can be run on data that never left the machine; the default is
 *   the read-only GitHub access in `github.mjs`.
 */
export async function validationWatch({ repoRoot, issueUrl, onPhase, github = {} }) {
  // Optional: told the name of the step about to run, so a terminal can say
  // what is happening while the network answers. Never affects the result.
  const phase = onPhase || (() => {})
  const read = { issue, issueComments, defaultBranchHead, ...github }
  const { dir: pinDir } = requirePin(repoRoot)
  const target = parseIssueUrl(issueUrl)
  if (`${target.owner}/${target.repository}`.toLowerCase() !== MARKETPLACE_SLUG) {
    throw new WatchError(
      "usage",
      `the watch only reads ${MARKETPLACE_PIN.repository} submissions, got ${target.owner}/${target.repository}`,
    )
  }

  const record = await loadRecord(pinDir)

  phase(`reading issue #${target.number}`)
  const subject = await read.issue(target.owner, target.repository, target.number)
  phase(`reading the comments on issue #${target.number}`)
  const comments = await read.issueComments(target.owner, target.repository, target.number)

  const repository = await repositoryFor(pinDir, subject)
  const repositoryUrl = repository.url
  const repositoryError = repository.error
  const issueKind = repository.kind

  let validated = null
  let baselineError = null
  try {
    const marker = record.findLatestSecurityBaseline(comments)
    if (marker) {
      validated = {
        commit: marker.commitSha,
        source: "security-baseline-marker",
        outcome: marker.outcome,
        findings: marker.findings,
        capabilities: marker.capabilities,
        checkedAt: marker.checkedAt,
        pluginIds: [...marker.pluginIds],
      }
    }
  } catch (error) {
    baselineError = { code: error.code || "baseline-unreadable", message: error.message }
  }
  const fallback = validated ? null : validationCommentCommit(comments)

  const labels = (subject.labels || []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
  const authorComments = comments.filter((comment) => comment?.user?.login === subject.user?.login)
  const maintainerComments = comments.filter(
    (comment) => comment?.user?.login && comment.user.login !== subject.user?.login && comment.user.login !== "github-actions[bot]",
  )

  let head = null
  let headError = null
  if (repositoryUrl) {
    phase("reading the plugin repository's default-branch HEAD")
    try {
      head = await read.defaultBranchHead(repositoryUrl)
    } catch (error) {
      headError = { code: error.code || "head-unreadable", message: error.message }
    }
  }

  const comparable = Boolean(validated?.commit && head?.commit)
  const stale = comparable ? validated.commit !== head.commit : null
  const lastReviewAt = Date.parse(maintainerComments.at(-1)?.created_at || "")
  const headAt = Date.parse(head?.committedAt || "")
  const pushedAfterReview = Boolean(
    stale && Number.isFinite(lastReviewAt) && Number.isFinite(headAt) && headAt > lastReviewAt,
  )

  return {
    read: {
      issue: `${MARKETPLACE_PIN.repository}/issues/${target.number}`,
      state: subject.state,
      title: subject.title,
      // Kept in the JSON for callers that need it, not printed: the text
      // rendering ends up pasted into issues, reports and screenshots.
      author: subject.user?.login || null,
      labels,
      createdAt: subject.created_at,
      updatedAt: subject.updated_at,
      bodyEditedAt: subject.body_edited_at || null,
      comments: comments.length,
      authorComments: authorComments.length,
      maintainerComments: maintainerComments.length,
      lastMaintainerCommentAt: maintainerComments.at(-1)?.created_at || null,
      authenticated: Boolean(token()),
    },
    plugin: { repository: repositoryUrl, repositoryError, form: issueKind },
    validated,
    validationCommentFallback: fallback,
    baselineError,
    head,
    headError,
    discussion: maintainerComments.length ? {
      body: maintainerComments.at(-1).body || "",
      url: maintainerComments.at(-1).html_url || null,
      createdAt: maintainerComments.at(-1).created_at || null,
      authorAssociation: maintainerComments.at(-1).author_association || null,
    } : null,
    verdict: validationVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview, repositoryUrl }),
  }
}

// `repositoryUrl` has no default on purpose. Measured on 0.1.6: the command
// computed it and then did not pass it, and the parameter defaulted to the
// truthy string "unknown", so an issue whose body named no repository was
// reported as a HEAD that could not be read, and the branch below that names
// the real cause was reachable from the unit test alone.
export function validationVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview, repositoryUrl }) {
  if (baselineError) {
    return {
      state: "unknown",
      summary: `The latest automated baseline on this issue did not complete (${baselineError.code}), so there is no validated commit to compare.`,
      action: REFRESH_ACTION,
    }
  }
  if (!validated) {
    return {
      state: "unknown",
      summary: fallback
        ? `No security-baseline marker on this issue. Validation reported commit ${fallback.short}, which is too short to compare reliably.`
        : "No automated validation or security baseline has run on this issue yet, so there is no validated commit.",
      action: fallback ? REFRESH_ACTION : "Wait for the automated validation to run, or edit the issue body to trigger it.",
    }
  }
  if (!repositoryUrl) {
    return {
      state: "unknown",
      summary: `The validated commit is ${validated.commit}, but no plugin repository could be read from this issue, so there is nothing to compare it with.`,
      action: null,
    }
  }
  if (headError || !head) {
    return {
      state: "unknown",
      summary: `The validated commit is ${validated.commit}, but the repository's current default-branch HEAD could not be read (${headError?.code || "unknown"}).`,
      action: null,
    }
  }
  if (!comparable) {
    return { state: "unknown", summary: "Not enough information to compare the validated commit.", action: null }
  }
  if (!stale) {
    return {
      state: "current",
      summary: `The validated commit is ${validated.commit}, which is the current ${head.branch || "default"}-branch HEAD. Nothing needs refreshing.`,
      action: null,
    }
  }
  return {
    state: "stale",
    summary: [
      `The validated commit is ${validated.commit}.`,
      `The repository's current ${head.branch || "default"}-branch HEAD is ${head.commit}.`,
      "The marketplace has not seen the newer commit. Pushing it did not tell the marketplace, and neither did any comment.",
      pushedAfterReview ? "The newer commit landed after the last human review comment on this issue." : null,
    ].filter(Boolean).join(" "),
    action: REFRESH_ACTION,
  }
}

export { GitHubError }
