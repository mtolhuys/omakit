// The pin watch. This is the reason the tool exists.
//
// After a submission is validated, the review is pinned to one exact commit.
// The only action that moves that pin is editing the issue body:
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
// findings and were blocked solely because the pin had gone stale while they
// waited. 46% of the maintainer's own requests for a fresh validation never
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
import { defaultBranchHead, issue, issueComments, parseIssueUrl, token, GitHubError } from "./github.mjs"

export class WatchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "WatchError"
    this.code = code
  }
}

const MARKETPLACE_SLUG = MARKETPLACE_PIN.repository.replace(/^https:\/\/github\.com\//, "").toLowerCase()

// The one action that refreshes the pin, in the register the marketplace itself
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
 * @param {{ repoRoot: string, issueUrl: string }} options
 */
export async function pinWatch({ repoRoot, issueUrl }) {
  const { dir: pinDir } = requirePin(repoRoot)
  const target = parseIssueUrl(issueUrl)
  if (`${target.owner}/${target.repository}`.toLowerCase() !== MARKETPLACE_SLUG) {
    throw new WatchError(
      "usage",
      `the watch only reads ${MARKETPLACE_PIN.repository} submissions, got ${target.owner}/${target.repository}`,
    )
  }

  const record = await loadRecord(pinDir)

  const subject = await issue(target.owner, target.repository, target.number)
  const comments = await issueComments(target.owner, target.repository, target.number)

  const read = await repositoryFor(pinDir, subject)
  const repositoryUrl = read.url
  const repositoryError = read.error
  const issueKind = read.kind

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
    try {
      head = await defaultBranchHead(repositoryUrl)
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
    verdict: pinVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview }),
  }
}

export function pinVerdict({ comparable, stale, validated, head, fallback, baselineError, headError, pushedAfterReview, repositoryUrl = "unknown" }) {
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
        : "No automated validation or security baseline has run on this issue yet, so there is no pinned commit.",
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
    return { state: "unknown", summary: "Not enough information to compare the pin.", action: null }
  }
  if (!stale) {
    return {
      state: "current",
      summary: `The review is pinned to ${validated.commit}, which is the current ${head.branch || "default"}-branch HEAD. Nothing needs refreshing.`,
      action: null,
    }
  }
  return {
    state: "stale",
    summary: [
      `The review is pinned to ${validated.commit}.`,
      `The repository's current ${head.branch || "default"}-branch HEAD is ${head.commit}.`,
      "The marketplace has not seen the newer commit. Pushing it did not tell the marketplace, and neither did any comment.",
      pushedAfterReview ? "The newer commit landed after the last human review comment on this issue." : null,
    ].filter(Boolean).join(" "),
    action: REFRESH_ACTION,
  }
}

export { GitHubError }
