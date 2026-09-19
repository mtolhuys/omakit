// Deterministic parity corpus: listed marketplace repositories at their exact
// listing-validated commits, read from the pinned marketplace registry so the
// set is reproducible and never hand-picked for a favourable result.
//
// The registry records the outcome the marketplace itself computed for each
// listing (`automatedSecurityBaseline.outcome`). The corpus is stratified on
// that outcome so a run always contains repositories whose official result is
// not `passed`: for a corpus of n, ceil(n/8) needs-fixes, ceil(n/4)
// review-required, the rest passed, each stratum sampled by a fixed stride
// over the repositories sorted by URL. `offset` shifts every stratum.

import { readFileSync } from "node:fs"
import { join } from "node:path"

const STRATA = ["needs-fixes", "review-required", "passed"]

function registrySources(pinDir) {
  const registry = JSON.parse(readFileSync(join(pinDir, "registry.json"), "utf8"))
  const list = Array.isArray(registry.sources) ? registry.sources : Object.values(registry.sources)
  return list
    .filter((source) => typeof source?.repo === "string" && /^[a-f0-9]{40}$/i.test(source?.listingValidatedCommit || ""))
    .map((source) => {
      const recorded = source.automatedSecurityBaseline || null
      return {
        repo: source.repo,
        commit: source.listingValidatedCommit.toLowerCase(),
        type: source.type,
        registryOutcome: recorded?.outcome || null,
        registryOutcomeCommit: recorded?.commit ? String(recorded.commit).toLowerCase() : null,
        registryBaselineVersion: recorded?.version || null,
      }
    })
    .sort((a, b) => a.repo.localeCompare(b.repo))
}

export function strataSizes(count) {
  // ceil for the two non-passed strata, so a small corpus still has one of
  // each, and never more repositories than were asked for: at --count 1
  // the two ceilings alone made two (measured on 2026-09-19, "identical
  // 2/2" after --count 1). The 30-repository corpus is unchanged: 4, 8, 18.
  const total = Math.max(0, Math.floor(count))
  const needsFixes = Math.min(Math.ceil(total / 8), total)
  const reviewRequired = Math.min(Math.ceil(total / 4), total - needsFixes)
  return { "needs-fixes": needsFixes, "review-required": reviewRequired, passed: total - needsFixes - reviewRequired }
}

function sample(list, count, offset) {
  if (count <= 0 || list.length === 0) return []
  const step = Math.max(1, Math.floor(list.length / count))
  const picked = []
  for (let i = offset % Math.max(1, list.length); picked.length < count && picked.length < list.length; i = (i + step) % list.length) {
    if (picked.includes(list[i])) break
    picked.push(list[i])
  }
  return picked
}

export function parityCorpus(pinDir, count = 30, offset = 0) {
  const sources = registrySources(pinDir)
  const sizes = strataSizes(count)
  const picked = []
  for (const stratum of STRATA) {
    const pool = sources.filter((s) => s.registryOutcome === stratum)
    picked.push(...sample(pool, sizes[stratum], offset))
  }
  return picked.sort((a, b) => a.repo.localeCompare(b.repo))
}
