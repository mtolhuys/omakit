// M6 reproduction: open author-fixes issues, bot marker against commits.atom.
// All remote reads use the existing GET-only client. Unknowns stay unknown.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { repositoryIssues, getText } from "./github.mjs"
import { validationWatch } from "./watch.mjs"

export function atomHead(feed, source) {
  const commit = feed.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/i)?.[1]
    || feed.match(/\/commit\/([0-9a-f]{40})/i)?.[1]
  if (!commit) throw new Error("No full HEAD commit in commits.atom")
  return { source, commit: commit.toLowerCase(), branch: null,
    committedAt: feed.match(/<updated>([^<]+)<\/updated>/)?.[1] || null }
}

export function stalenessCounts(rows) {
  const stale = rows.filter((row) => row.verdict === "stale").length
  const current = rows.filter((row) => row.verdict === "current").length
  const compared = stale + current
  return { total: rows.length, compared, stale, current, unknown: rows.length - compared,
    staleShareOfCompared: compared ? stale / compared : null,
    staleShareOfPopulation: compared === rows.length && rows.length ? stale / rows.length : null }
}

export async function measureStaleness(repoRoot, { discover = repositoryIssues, watch = validationWatch, readText = getText } = {}) {
  const openedAt = new Date().toISOString()
  const [owner, repository] = new URL(MARKETPLACE_PIN.repository).pathname.slice(1).split("/")
  const batches = await Promise.all(["needs-fixes", "security-needs-fixes"].map((labels) => discover(owner, repository, undefined, { labels })))
  const subjects = [...new Map(batches.flat().map((subject) => [subject.number, subject])).values()]
    .filter((subject) => subject.state === "open" && !subject.pull_request)
    .sort((a, b) => a.number - b.number)
  const heads = new Map()
  function readHead(url) {
    if (!heads.has(url)) {
      const source = `${url.replace(/\/$/, "")}/commits.atom`
      heads.set(url, Promise.resolve().then(async () => atomHead(await readText(source, "application/atom+xml"), source)))
    }
    return heads.get(url)
  }
  const rows = new Array(subjects.length)
  let next = 0
  async function worker() {
    while (next < subjects.length) {
      const index = next++
      const subject = subjects[index]
      const issueUrl = `${MARKETPLACE_PIN.repository}/issues/${subject.number}`
      const observedAt = new Date().toISOString()
      try {
        const report = await watch({ repoRoot, issueUrl, github: { issue: async () => subject, defaultBranchHead: readHead } })
        rows[index] = { issue: subject.number, issueUrl, observedAt, completedAt: new Date().toISOString(),
          repository: report.plugin.repository, validatedCommit: report.validated?.commit || null,
          validationSource: report.validated?.source || null, validatedAt: report.validated?.checkedAt || null,
          validationCommentsSource: `https://api.github.com/repos/${owner}/${repository}/issues/${subject.number}/comments`,
          defaultBranchHead: report.head?.commit || null, headSource: report.head?.source || null,
          verdict: report.verdict.state,
          reason: report.verdict.state === "unknown" ? report.verdict.summary : null }
      } catch (error) {
        rows[index] = { issue: subject.number, issueUrl, observedAt, completedAt: new Date().toISOString(),
          repository: null, validatedCommit: null, defaultBranchHead: null, verdict: "unknown",
          reason: `${error.code || "read-unavailable"}: ${error.message}` }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, subjects.length) }, worker))
  return { measurement: "M6", date: openedAt.slice(0, 10), openedAt, completedAt: new Date().toISOString(),
    marketplace: MARKETPLACE_PIN.repository, marketplacePin: MARKETPLACE_PIN.commit,
    command: "node tools/marketplace/measure-staleness.mjs", sample: false,
    population: "All open non-PR marketplace issues labelled needs-fixes or security-needs-fixes at discovery",
    method: "Latest bot security-baseline full commit against default-branch commits.atom HEAD; missing full markers or feeds are unknown; unequal commits are stale, without a claim about ancestry",
    ...stalenessCounts(rows), rows }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await measureStaleness(resolve(process.cwd())), null, 2)}\n`)
}
