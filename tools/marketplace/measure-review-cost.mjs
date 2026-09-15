// Reproduce M9 with GET-only issue discovery and compare reads. No sampling.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { repositoryIssues } from "./github.mjs"
import { liveRegistry } from "./registry.mjs"
import { reviewPolicy } from "./review-cost.mjs"
import { validationWatchAll } from "./watch.mjs"

export async function measureReviewCost(repoRoot) {
  const policy = await reviewPolicy(repoRoot)
  const registry = await liveRegistry({ repoRoot })
  if (registry.source !== "head") throw new Error(`cannot measure at HEAD: ${registry.reason}`)
  const [owner, repository] = new URL(MARKETPLACE_PIN.repository).pathname.slice(1).split("/")
  const openedAt = new Date().toISOString()
  const subjects = await repositoryIssues(owner, repository, undefined, { labels: policy.updateLabel })
  const issues = subjects.filter((subject) => subject.state === "open" && !subject.pull_request).map((subject) => ({
    number: subject.number, url: `${MARKETPLACE_PIN.repository}/issues/${subject.number}`, title: subject.title,
    state: subject.state, labels: subject.labels.map((label) => typeof label === "string" ? label : label.name),
  }))
  // Only the manual-review subset needs comment reads and comparisons. No plugin HEAD reads.
  const manual = issues.filter((subject) => subject.labels.includes(policy.reviewLabel))
  const batch = await validationWatchAll({ repoRoot, discovery: { account: null, marketplace: MARKETPLACE_PIN.repository, issues: manual },
    readRegistry: async () => registry, github: { defaultBranchHead: async () => null } })
  const counts = batch.reviewCostSummary
  return {
    measurement: "M9", openedAt, completedAt: new Date().toISOString(), marketplace: MARKETPLACE_PIN.repository,
    marketplaceHead: registry.commit, command: "node tools/marketplace/measure-review-cost.mjs", sample: false,
    pluginUpdates: issues.length, manualQueue: manual.length, manualQueueShare: issues.length ? manual.length / issues.length : null,
    docsOnly: counts.docsOnly, compared: counts.compared, skipped: counts.skipped.length,
    docsOnlyShareOfCompared: counts.compared ? counts.docsOnly / counts.compared : null,
    docsOnlyShareOfManualQueue: counts.skipped.length || !manual.length ? null : counts.docsOnly / manual.length,
    rows: batch.issues.map((row) => ({ issue: row.issue.number, ...row.documentationDiff })),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await measureReviewCost(resolve(process.cwd())), null, 2)}\n`)
}
