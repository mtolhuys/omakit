// M15 reproduction: open submission issues whose Repository URL names an
// owner other than the issue's author. All remote reads use the existing
// GET-only client; an issue whose body yields no repository is counted as
// unreadable, never as a match or a mismatch.
//
// The case behind it: omacom/omarchy-plugin-marketplace#7787, 2026-09-20. A
// retry edit typed by an agent put `mtolhuijs` where origin says `mtolhuys`,
// and the marketplace refused it as `repository-unreachable` 40 seconds after
// the edit event. A URL whose owner is not the author is not wrong by itself
// (organisations, forks and co-maintainers exist), so the count is the size
// of the population this check has to tell a typo apart from, not a count of
// typos.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { repositoryIssues } from "./github.mjs"
import { repositoryFor } from "./watch.mjs"
import { parseGitHubUrl } from "../subject/resolve.mjs"

export function ownerCounts(rows) {
  const readable = rows.filter((row) => row.owner !== null)
  const differs = readable.filter((row) => row.ownerDiffers).length
  return { total: rows.length, readable: readable.length, unreadable: rows.length - readable.length,
    ownerDiffers: differs, ownerMatches: readable.length - differs,
    differsShareOfReadable: readable.length ? differs / readable.length : null }
}

export async function measureRepositoryOwner(repoRoot, { discover = repositoryIssues, label = "submission" } = {}) {
  const openedAt = new Date().toISOString()
  const { dir: pinDir } = requirePin(repoRoot)
  const [owner, repository] = new URL(MARKETPLACE_PIN.repository).pathname.slice(1).split("/")
  const subjects = (await discover(owner, repository, undefined, { labels: label }))
    .filter((subject) => subject.state === "open" && !subject.pull_request)
    .sort((a, b) => a.number - b.number)
  const rows = []
  for (const subject of subjects) {
    const author = String(subject.user?.login || "")
    const parsed = await repositoryFor(pinDir, subject)
    const gh = parsed.url ? parseGitHubUrl(parsed.url) : null
    rows.push({ issue: subject.number, issueUrl: `${MARKETPLACE_PIN.repository}/issues/${subject.number}`, author,
      labels: (subject.labels || []).map((entry) => (typeof entry === "string" ? entry : entry?.name)).filter(Boolean),
      repository: gh?.url || null, owner: gh?.owner || null,
      ownerDiffers: gh ? gh.owner.toLowerCase() !== author.toLowerCase() : null,
      reason: gh ? null : parsed.error || "no github.com repository URL in the body" })
  }
  return { measurement: "M15", date: openedAt.slice(0, 10), openedAt, completedAt: new Date().toISOString(),
    marketplace: MARKETPLACE_PIN.repository, marketplacePin: MARKETPLACE_PIN.commit,
    command: "node tools/marketplace/measure-repository-owner.mjs", sample: false,
    population: `All open non-PR marketplace issues labelled ${label} at discovery`,
    method: "Repository URL read from each issue body with the pinned submission parser; its owner compared case-insensitively with the issue author's login; a body without a readable github.com URL is unreadable",
    ...ownerCounts(rows), rows }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await measureRepositoryOwner(resolve(process.cwd())), null, 2)}\n`)
}
