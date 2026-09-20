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
// Measured reason (docs/MEASUREMENTS.md M6), 2026-09-15: 326 of 519 readable
// author-fixes comparisons were stale (62.8%), with 64 of 583 issues unknown.
// The original 2026-09-12 research sampled 100 of a 464-issue queue: 68 of
// 93 readable pairs were stale (73.1%). It did not measure every queue item.
// Editing the issue body is the action the pinned workflow observes.
//
// This command reads. It never edits the issue, never comments, never labels.
// The action it names is the author's to take.

import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { authenticatedUser, repositoryIssues, defaultBranchHead, issue, issueComments, parseIssueUrl, token, GitHubError } from "./github.mjs"
import { liveRegistry } from "./registry.mjs"
import { reviewPolicy, validatedDocumentationDiff } from "./review-cost.mjs"
import { parseGitHubUrl, resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { omakitCacheDir } from "./paths.mjs"

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
export async function validationWatchAll({ repoRoot, discovery, github = {}, readRegistry = liveRegistry, onPhase = () => {} }) {
  if (discovery.issues.length) requirePin(repoRoot)
  const policy = discovery.issues.length ? await reviewPolicy(repoRoot) : null
  let registry = null
  const reviewCostSummary = { pluginUpdates: 0, manualQueue: 0, docsOnly: 0, compared: 0, skipped: [] }
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
  // M9: count labels on the listed issues, then compare only updates in the manual queue.
  const manual = results.filter((row) => {
    const labels = row.report?.read.labels || row.issue.labels
    if (!labels.includes(policy?.updateLabel)) return false
    reviewCostSummary.pluginUpdates += 1
    return labels.includes(policy.reviewLabel)
  })
  reviewCostSummary.manualQueue = manual.length
  if (manual.length) {
    onPhase("reading the previous validated marketplace snapshots")
    try { registry = await readRegistry({ repoRoot }) } catch (error) { registry = { reason: error.message } }
  }
  let compareNext = 0
  async function compareWorker() {
    while (compareNext < manual.length) {
      const row = manual[compareNext++]
      const diff = row.report
        ? await validatedDocumentationDiff({ report: row.report, registry: registry?.source === "head" ? registry.registry : null,
          catalog: registry?.source === "head" ? registry.catalog : null,
          registryReason: registry?.source === "head" ? null : `previous validated commit unknown: live registry unavailable (${registry?.reason || "unknown"})`, compare: github.compareCommits })
        : { docsOnly: null, reason: `issue unreadable: ${row.error?.message || "unknown"}` }
      row.documentationDiff = diff
      if (diff.docsOnly === null) reviewCostSummary.skipped.push({ issue: row.issue.number, reason: diff.reason })
      else {
        reviewCostSummary.compared += 1
        if (diff.docsOnly) reviewCostSummary.docsOnly += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, manual.length) }, compareWorker))
  reviewCostSummary.skipped.sort((a, b) => a.issue - b.issue)
  return { mode: "all", account: discovery.account, marketplace: discovery.marketplace, summary, reviewCostSummary, issues: results }
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
export async function repositoryFor(pinDir, subject) {
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
 * The origin a watch compares the issue with. A github.com URL is taken as
 * given; a path is a Git checkout whose `origin` is read the way `submit`
 * reads it, and the working tree may be dirty, since only the remote is
 * read. With no argument the current directory is the subject when it is
 * such a checkout, and there is no subject otherwise.
 *
 * @returns {{ origin: string, source: "url"|"path"|"cwd" }|null}
 */
export function resolveWatchSubject(target, { cwd = process.cwd(), cacheRoot = omakitCacheDir() } = {}) {
  if (target !== undefined) {
    const gh = /^(?:https:\/\/|git@)/.test(String(target)) ? parseGitHubUrl(target) : null
    if (gh) return { origin: gh.url, source: "url" }
    if (/^https?:\/\//.test(String(target))) throw new WatchError("usage", `the subject is a github.com repository URL or a local checkout, got ${target}`)
    const subject = resolveSubject(target, { cacheRoot, allowDirty: true })
    if (!subject.repository.url) throw new SubjectError("no-origin", `${subject.dir} has no github.com origin remote, so there is no repository to compare the issue with`)
    return { origin: subject.repository.url, source: "path" }
  }
  try {
    const subject = resolveSubject(cwd, { cacheRoot, allowDirty: true })
    return subject.repository.url ? { origin: subject.repository.url, source: "cwd" } : null
  } catch {
    return null
  }
}

/** Two github.com repository URLs name the same repository: https, no `.git`, no trailing slash, owner and name case-insensitively. */
export function sameRepository(a, b) {
  const left = parseGitHubUrl(a)
  const right = parseGitHubUrl(b)
  if (!left || !right) return null
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.repository.toLowerCase() === right.repository.toLowerCase()
}

/**
 * @param {{ repoRoot: string, issueUrl: string, onPhase?: (name: string) => void,
 *           subject?: { origin: string, source?: string }|null,
 *           github?: { issue?: typeof issue, issueComments?: typeof issueComments, defaultBranchHead?: typeof defaultBranchHead } }} options
 *   `github` is injectable for tests, so the whole path from an issue body to
 *   a verdict can be run on data that never left the machine; the default is
 *   the read-only GitHub access in `github.mjs`. `subject` is the plugin's
 *   own origin, from resolveWatchSubject(); with one, the issue's Repository
 *   URL is compared with it, and without one (`watch --all`) it is not.
 */
export async function validationWatch({ repoRoot, issueUrl, onPhase, github = {}, subject: watchSubject = null }) {
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
  // #7787, 2026-09-20 19:18 UTC: a retry edit typed the Repository URL as
  // mtolhuijs/omacrunch on an issue whose plugin lives at mtolhuys/omacrunch.
  // The marketplace validates the URL in the issue, so it validated a
  // repository that does not exist and refused within 40 seconds. The issue
  // is compared with origin here, so the typo is named as what it is rather
  // than reported as a HEAD that could not be read.
  const origin = watchSubject?.origin || null
  const repositoryMatches = origin && repositoryUrl ? sameRepository(repositoryUrl, origin) : null

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
  let previousValidated = null
  if (validated) {
    // Revalidation on an existing issue may precede the latest marker. Ignore
    // repeated attestations of the same commit, not a different validated tree.
    for (const comment of [...comments].reverse()) {
      try {
        const marker = record.findLatestSecurityBaseline([comment])
        if (marker && marker.commitSha !== validated.commit && Date.parse(marker.checkedAt) <= Date.parse(validated.checkedAt)) {
          previousValidated = { commit: marker.commitSha, checkedAt: marker.checkedAt, source: "security-baseline-marker" }
          break
        }
      } catch { /* An incomplete run is not a previously validated commit. */ }
    }
  }

  const labels = (subject.labels || []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
  const authorComments = comments.filter((comment) => comment?.user?.login === subject.user?.login)
  // The discussion is a person's: the marketplace's own bot and any other
  // automation (GitHub marks an app's account `type: "Bot"`, and names it
  // `<app>[bot]`) is neither a reviewer nor the last human review.
  const isBot = (user) => user?.type === "Bot" || /\[bot\]$/i.test(String(user?.login || ""))
  const maintainerComments = comments.filter(
    (comment) => comment?.user?.login && comment.user.login !== subject.user?.login && !isBot(comment.user),
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
    plugin: { repository: repositoryUrl, repositoryError, form: issueKind, origin, repositoryMatches },
    validated,
    previousValidated,
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
    verdict: validationVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview, repositoryUrl, origin, repositoryMatches }),
  }
}

// `repositoryUrl` has no default on purpose. Measured on 0.1.6: the command
// computed it and then did not pass it, and the parameter defaulted to the
// truthy string "unknown", so an issue whose body named no repository was
// reported as a HEAD that could not be read, and the branch below that names
// the real cause was reachable from the unit test alone.
export function validationVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview, repositoryUrl, origin = null, repositoryMatches = null }) {
  // The state that says the issue itself is wrong comes first: a
  // comparison of commits on the wrong repository describes nothing the
  // marketplace is looking at.
  if (repositoryMatches === false) {
    return {
      state: "wrong-repository",
      summary: `The issue's Repository URL is ${repositoryUrl}, the plugin's origin is ${origin}. The marketplace validates the URL in the issue, so it is validating the wrong repository, or none.`,
      action: `Edit the issue and set the Repository URL field to ${origin}. Change nothing else.`,
    }
  }
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
