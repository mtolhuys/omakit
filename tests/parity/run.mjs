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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runBaseline } from "../../tools/marketplace/run-baseline.mjs"
import { requirePin } from "../../tools/marketplace/pin.mjs"
import { parityCorpus, strataSizes } from "./corpus.mjs"
import { subjectSlug } from "../../tools/subject/resolve.mjs"
import { token } from "../../tools/marketplace/github.mjs"
import { omakitCacheDir } from "../../tools/marketplace/paths.mjs"
import { parityOutput } from "../../tools/marketplace/parity-output.mjs"

function shallowClone(cacheDir, repoUrl, commit) {
  const dir = join(cacheDir, subjectSlug(repoUrl))
  mkdirSync(dir, { recursive: true })
  const run = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    run(["rev-parse", commit + "^{commit}"])
    return dir
  } catch {
    /* not fetched yet */
  }
  // Test for the clone's own .git instead of relying on an outer repository.
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

function generatorIdentity(repoRoot) {
  try {
    return { omakitCommit: execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() }
  } catch {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    return { omakitPackage: `${pkg.name}@${pkg.version}` }
  }
}

/**
 * The parity run. `cli.mjs` calls this with its own root and the flags it
 * parsed; the adapter at the bottom of this file calls it from the command
 * line. Everything the run needs arrives as an argument: omakit reads no
 * environment variable of its own, and this handoff used to be four
 * PARITY_* variables and an OMAKIT_ROOT, which was the one OMAKIT_* name in
 * the tree and needed an exemption in the test that forbids them.
 *
 * @param {{ repoRoot: string, count?: number, offset?: number, out?: string|null, log?: (line: string) => void }} options
 *   `out` is an explicit evidence file; without it the evidence lands in
 *   `docs/evidence/parity/` under a dated name that never overwrites.
 * @returns {Promise<{ summary: object, outFile: string, ok: boolean }>}
 */
export async function runParity({ repoRoot, count = 30, offset = 0, out = null, log = console.log }) {
  const root = resolve(repoRoot)
  const pinDir = requirePin(root).dir
  const cacheDir = omakitCacheDir("parity")
  // Resolved before any fetch, so a packaged read-only install refuses here.
  const output = parityOutput({ repoRoot: root, out })
  const corpus = parityCorpus(pinDir, count, offset)
  const rows = []
  const ruleTotals = {}
  const capabilityTotals = {}
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
      const dir = shallowClone(cacheDir, target.repo, target.commit)
      const local = await runBaseline({
        repoRoot: root,
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
      for (const finding of local.result.findings || []) {
        const id = finding.ruleId || finding.id
        if (id) ruleTotals[id] = (ruleTotals[id] || 0) + 1
      }
      for (const capability of local.result.capabilities || []) {
        if (capability.id) capabilityTotals[capability.id] = (capabilityTotals[capability.id] || 0) + 1
      }
      try {
        const github = await runBaseline({
          repoRoot: root,
          repoUrl: target.repo,
          commitSha: target.commit,
          transport: "github",
          token: token() ?? undefined,
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
    log(
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
    generator: generatorIdentity(root),
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
  const outputIsFile = Boolean(out)
  const outputDir = outputIsFile ? resolve(output, "..") : output
  mkdirSync(outputDir, { recursive: true })
  let outFile = outputIsFile ? output : join(outputDir, `${date}-local-vs-github.json`)
  for (let n = 2; !outputIsFile && existsSync(outFile); n += 1) outFile = join(outputDir, `${date}-local-vs-github-${n}.json`)
  writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n")
  log("\nidentical " + summary.identical + "/" + corpus.length + ", mismatches " + mismatches + ", failures " + failures + " -> " + outFile)
  return { summary, outFile, ok: mismatches === 0 && failures === 0 }
}

// The command-line adapter: `node tests/parity/run.mjs [--count n] [--offset n]
// [--out file]` from the repository root. Thin on purpose; `omakit parity`
// is the same call with cli.mjs's own root.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const { ok } = await runParity({
    repoRoot: process.cwd(),
    count: Number(flag("--count") || 30),
    offset: Number(flag("--offset") || 0),
    out: flag("--out") || null,
  })
  process.exit(ok ? 0 : 1)
}
