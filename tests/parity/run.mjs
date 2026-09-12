// Parity: the pinned official baseline over the GitHub transport must equal the
// same code over Omakit's local Git transport, for real listed plugin
// repositories at their exact commits. Read-only: clones and GET requests only.
//
// The committed evidence records, per repository, a digest of each transport's
// comparable result rather than the results themselves. Two reasons. Equal
// digests are the whole parity claim, and anyone can recompute them from the
// repository, the commit and the pin. And findings about a specific third-party
// plugin are not this project's to publish: the aggregate rule distribution in
// the summary carries no repository names, and the per-repository rows carry no
// findings, no capabilities, no file paths and no source snippets.

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { runBaseline } from "../../tools/marketplace/run-baseline.mjs"
import { requirePin } from "../../tools/marketplace/pin.mjs"
import { parityCorpus, strataSizes } from "./corpus.mjs"
import { subjectSlug } from "../../tools/subject/resolve.mjs"

const repoRoot = resolve(process.env.OMAKIT_ROOT || process.cwd())
const pinDir = requirePin(repoRoot).dir
const cacheDir = join(repoRoot, ".cache/parity")
const count = Number(process.env.PARITY_COUNT || 30)
const offset = Number(process.env.PARITY_OFFSET || 0)

function shallowClone(repoUrl, commit) {
  const dir = join(cacheDir, subjectSlug(repoUrl))
  mkdirSync(dir, { recursive: true })
  const run = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    run(["rev-parse", commit + "^{commit}"])
    return dir
  } catch {
    /* not fetched yet */
  }
  // .cache/parity lives inside the Omakit repository, so `rev-parse` would
  // find the outer repository; test for the clone's own .git instead.
  if (!existsSync(join(dir, ".git"))) {
    execFileSync("git", ["init", "-q", dir], { encoding: "utf8" })
    run(["remote", "add", "origin", repoUrl])
  }
  run(["fetch", "-q", "--depth", "1", "origin", commit])
  return dir
}

function comparable(result) {
  return JSON.stringify({
    outcome: result.outcome,
    disposition: result.disposition,
    blocksApproval: result.blocksApproval,
    findings: result.findings,
    capabilities: result.capabilities,
  })
}

/** A digest of the comparable payload: proves equality without publishing it. */
function digest(result) {
  return createHash("sha256").update(comparable(result)).digest("hex").slice(0, 32)
}

function pinCommit(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

const corpus = parityCorpus(pinDir, count, offset)
const rows = []
const ruleTotals = {}
const capabilityTotals = {}
let localRuleIds = []
let localCapabilityIds = []
let mismatches = 0
let failures = 0

for (const target of corpus) {
  const row = {
    repo: target.repo,
    commit: target.commit,
    type: target.type,
    registryOutcome: target.registryOutcome,
    registryOutcomeAtSameCommit: target.registryOutcomeCommit === target.commit,
  }
  try {
    const dir = shallowClone(target.repo, target.commit)
    const local = await runBaseline({
      repoRoot,
      repoUrl: target.repo,
      commitSha: target.commit,
      transport: "local",
      repoDir: dir,
    })
    row.localOutcome = local.result.outcome
    row.requests = local.adapter.requests
    row.localDigest = digest(local.result)
    // Rule and capability ids are counted in the summary, unattributed; they are
    // deliberately not recorded against this repository.
    localRuleIds = (local.result.findings || []).map((finding) => finding.ruleId || finding.id).filter(Boolean)
    localCapabilityIds = (local.result.capabilities || []).map((capability) => capability.id).filter(Boolean)
    for (const id of localRuleIds) ruleTotals[id] = (ruleTotals[id] || 0) + 1
    for (const id of localCapabilityIds) capabilityTotals[id] = (capabilityTotals[id] || 0) + 1
    try {
      const github = await runBaseline({
        repoRoot,
        repoUrl: target.repo,
        commitSha: target.commit,
        transport: "github",
        token: process.env.GITHUB_TOKEN,
      })
      row.githubOutcome = github.result.outcome
      row.githubDigest = digest(github.result)
      row.identical = row.localDigest === row.githubDigest
      if (!row.identical) {
        mismatches += 1
        // A mismatch is the one case worth describing, and it is described as a
        // difference between two transports of the same code, not as a finding
        // about the plugin: which keys differ, never their contents.
        const localPayload = JSON.parse(comparable(local.result))
        const githubPayload = JSON.parse(comparable(github.result))
        row.differingKeys = Object.keys(localPayload).filter(
          (key) => JSON.stringify(localPayload[key]) !== JSON.stringify(githubPayload[key]),
        )
      }
    } catch (error) {
      row.githubError = (error.code || "error") + ": " + error.message
      failures += 1
    }
  } catch (error) {
    row.localError = (error.code || "error") + ": " + error.message
    failures += 1
  }
  rows.push(row)
  console.log(
    [
      row.identical === true ? "ok  " : row.identical === false ? "DIFF" : "??  ",
      target.repo.replace("https://github.com/", "").padEnd(44),
      "local=" + (row.localOutcome || row.localError || "-"),
      "github=" + (row.githubOutcome || row.githubError || "-"),
      "registry=" + (row.registryOutcome || "-"),
    ].join(" "),
  )
}

const summary = {
  generator: { omakitCommit: execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() },
  pinnedMarketplaceCommit: pinCommit(pinDir),
  corpusSize: corpus.length,
  requestedCount: count,
  offset,
  strata: strataSizes(count),
  outcomes: rows.reduce((acc, row) => {
    const key = row.localOutcome || "error"
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  identical: rows.filter((row) => row.identical === true).length,
  mismatches,
  failures,
  // Unattributed aggregates. No repository name is attached to any rule.
  ruleTotals,
  capabilityTotals,
  publication: {
    perRepositoryDetail: "omitted",
    reason: "Findings about a specific third-party plugin are not published. Equality is evidenced by the sha256 digests below, which anyone can recompute from the repository, the commit and the pinned marketplace commit.",
    digest: "sha256 of {outcome, disposition, blocksApproval, findings, capabilities}, first 32 hex characters",
  },
  rows,
}
const date = new Date().toISOString().slice(0, 10)
mkdirSync(join(repoRoot, "docs/evidence/parity"), { recursive: true })
let outFile = join(repoRoot, "docs/evidence/parity", `${date}-local-vs-github.json`)
for (let n = 2; existsSync(outFile); n += 1) outFile = join(repoRoot, "docs/evidence/parity", `${date}-local-vs-github-${n}.json`)
writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n")
console.log("\nidentical " + summary.identical + "/" + corpus.length + ", mismatches " + mismatches + ", failures " + failures + " -> " + outFile)
process.exit(mismatches === 0 && failures === 0 ? 0 : 1)
