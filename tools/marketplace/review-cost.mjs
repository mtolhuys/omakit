// Review cost is advice, never a marketplace rule. Evidence: MEASUREMENTS.md M4 and M9.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { requirePin } from "./pin.mjs"
import { token, issue, parseIssueUrl, compareCommits } from "./github.mjs"
import { discoverWatchIssues, repositoryFor } from "./watch.mjs"
import { repositorySlug } from "./registry.mjs"
import { submissionContract } from "./form.mjs"

/** Outcome and update label names come from the pin, rather than a second policy. */
export async function reviewPolicy(repoRoot) {
  const { dir } = requirePin(repoRoot)
  const policy = await import(pathToFileURL(join(dir, "scripts/security-baseline-policy.mjs")).href)
  const approval = readFileSync(join(dir, "scripts/approve-plugin-update.mjs"), "utf8")
  const updateLabel = approval.match(/for \(const required of \["([^"]+)"/)?.[1]
  if (!updateLabel) throw new Error("cannot read the update issue label from the pin")
  const manual = policy.currentSecurityBaselinePolicy.maintainerVerificationOutcome
  return { automated: policy.securityBaselineOutcome([], []), manual, updateLabel, reviewLabel: `security-${manual}` }
}

/**
 * The same discovery as watch --all; no credential or incomplete reads are
 * not zero issues. An issue is the author's for this plugin when its
 * Repository URL is the repository, or, for a `[Plugin]:` submission whose
 * URL is another repository, when its title carries the manifest's name or
 * its body names the manifest's id: on #7787 (2026-09-20) the retyped URL
 * made the author's own issue invisible to a match on the URL alone, and
 * the one check that could have named the typo had nothing to look at.
 * Each matched issue is returned with `sameRepository`, so a caller can
 * tell the two apart.
 *
 * @returns {{ count: number|null, reason: string, account?: string, issues?: { number: number, url: string, repositoryUrl: string|null, sameRepository: boolean, matchedBy: "repository"|"name"|"id" }[] }}
 */
export async function openIssuesForRepository({ repoRoot, repository, pluginName = "", pluginId = "", offline = false, github = {} }) {
  if (offline) return { count: null, reason: "not checked (--offline)" }
  if (!(github.token || token)()) return { count: null, reason: "not checked: no GitHub credential" }
  try {
    const discovery = await discoverWatchIssues({ github })
    const { dir } = requirePin(repoRoot)
    const { titleTemplate } = await submissionContract({ pinDir: dir })
    const name = String(pluginName || "").trim().toLowerCase()
    const id = String(pluginId || "").trim()
    const matched = []
    let next = 0
    async function worker() {
      while (next < discovery.issues.length) {
        const entry = discovery.issues[next++]
        const target = parseIssueUrl(entry.url)
        const subject = await (github.issue || issue)(target.owner, target.repository, target.number)
        const parsed = await repositoryFor(dir, subject)
        if (!parsed.url) throw new Error(`repository unknown on issue #${target.number}: ${parsed.error}`)
        const row = { number: target.number, url: entry.url, repositoryUrl: parsed.url, sameRepository: repositorySlug(parsed.url) === repositorySlug(repository), matchedBy: null }
        if (row.sameRepository) row.matchedBy = "repository"
        else if (parsed.kind === "submission" && titleTemplate && String(subject.title || "").startsWith(titleTemplate)) {
          const titled = String(subject.title).slice(titleTemplate.length).trim().toLowerCase()
          if (name && titled === name) row.matchedBy = "name"
          else if (id && String(subject.body || "").includes(id)) row.matchedBy = "id"
        }
        if (row.matchedBy) matched.push(row)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, discovery.issues.length) }, worker))
    matched.sort((a, b) => a.number - b.number)
    const other = matched.filter((row) => !row.sameRepository).length
    return { count: matched.length, account: discovery.account, issues: matched,
      reason: `watch --all discovery: ${matched.length} open issue(s) for this plugin${other ? `, ${other} of them naming another repository` : ""}` }
  } catch (error) {
    return { count: null, reason: `not checked (${error.code || "issue-discovery-unavailable"}): ${error.message}` }
  }
}

export function reviewCostVerdict({ baseline, policy, openIssues = { count: null, reason: "not checked" }, why }) {
  const capabilities = [...(baseline?.capabilities || [])]
  const manual = baseline?.outcome === policy.manual
  const automated = baseline?.outcome === policy.automated
  const outcome = manual ? openIssues.count > 0 ? "manual queue, again" : "manual queue" : automated ? "automated" : null
  const detail = manual
    ? `${outcome}: capabilities ${capabilities.join(", ") || "none"}. Every update of this plugin, including a docs-only one, lands in the manual queue.${openIssues.count > 0 ? ` You already have ${openIssues.count} open issue(s) for this repository.` : ""}`
    : automated ? "automated: this update will not need a human for the security baseline." : "not checked: baseline.preflight has no passed or review-required outcome"
  return {
    reviewCost: { outcome, capabilities, openIssuesForRepository: openIssues.count, reason: `${detail} ${openIssues.reason}` },
    check: {
      id: "review.cost", source: "omakit", severity: "advisory", verdict: manual ? "fail" : automated ? "pass" : "unknown",
      why, detail, paths: [],
      remedy: manual && openIssues.count > 0 ? "consider batching: close or fold the open one before opening another" : null,
    },
  }
}

/** A rename must be documentation at both ends; an empty diff is not a docs-only update. */
export function documentationPath(path) {
  return typeof path === "string" && !path.split("/").some((part) => part === "..") &&
    (/^docs\//i.test(path) || /\.md$/i.test(path) || /(?:^|\/)LICENSE$/i.test(path) || /\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|tiff?)$/i.test(path))
}

export function docsOnlyFiles(files) {
  return Array.isArray(files) && files.length > 0 && files.every((file) =>
    documentationPath(file.filename) && (!file.previous_filename || documentationPath(file.previous_filename)))
}

/** Select a dated validation record, never a parent guessed from Git history. */
export function previousValidatedCommit(registry, report, catalog = null) {
  if (!repositorySlug(report.plugin.repository)) return null
  const sources = Array.isArray(registry?.sources) ? registry.sources : Object.values(registry?.sources || {})
  const source = sources.find((entry) => repositorySlug(entry.repo) === repositorySlug(report.plugin.repository))
  if (!report.validated?.commit) return null
  const target = report.validated.commit
  const checkedAt = Date.parse(report.validated.checkedAt)
  const candidates = [...(Array.isArray(source?.listingValidationHistory) ? source.listingValidationHistory : []), {
    commit: source?.listingValidatedCommit, validatedAt: source?.listingValidatedAt,
  }, { commit: report.previousValidated?.commit, validatedAt: report.previousValidated?.checkedAt }]
  // The catalog also records successful upstream validation before an update
  // is promoted to the listing. This is validation evidence, not branch HEAD.
  for (const plugin of Array.isArray(catalog?.plugins) ? catalog.plugins : []) {
    if (repositorySlug(plugin.repo) === repositorySlug(report.plugin.repository)) {
      candidates.push({ commit: plugin.upstreamValidatedCommit, validatedAt: plugin.upstreamValidatedAt })
    }
  }
  return candidates.filter((entry) => /^[a-f0-9]{40}$/i.test(entry.commit || "") && entry.commit.toLowerCase() !== target.toLowerCase() &&
    Number.isFinite(Date.parse(entry.validatedAt)) && Date.parse(entry.validatedAt) <= checkedAt)
    .sort((a, b) => Date.parse(a.validatedAt) - Date.parse(b.validatedAt)).at(-1)?.commit.toLowerCase() || null
}

export async function validatedDocumentationDiff({ report, registry, catalog, registryReason = null, compare = compareCommits }) {
  const previous = previousValidatedCommit(registry, report, catalog)
  if (!previous) return { previousCommit: null, validatedCommit: report.validated?.commit || null, docsOnly: null, files: null, source: null, reason: registryReason || "previous validated commit unknown in the marketplace registry" }
  try {
    const diff = await compare(report.plugin.repository, previous, report.validated.commit)
    return { previousCommit: previous, validatedCommit: report.validated.commit, docsOnly: docsOnlyFiles(diff.files), files: diff.files.length, source: diff.url, reason: null }
  } catch (error) {
    return { previousCommit: previous, validatedCommit: report.validated.commit, docsOnly: null, files: null, source: null, reason: `${error.code || "compare-unavailable"}: ${error.message}` }
  }
}
