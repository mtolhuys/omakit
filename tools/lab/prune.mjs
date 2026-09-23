// `omakit lab prune`: the explicit owner of lab-cache deletion. It
// inventories what the lab owns under its own roots, prints each target
// with its allocated bytes and the exact total, asks once (or takes
// --yes), refuses while a run holds the lab or a QEMU still answers on a
// staged socket, and afterwards reports what was recovered and what
// remains. It never follows a symlink out of the lab, never touches the
// marketplace pin or a checkout, and leaves run records alone unless
// --runs names them.

import { existsSync, lstatSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { bytesBoth, labPin, withRelease } from "./pin.mjs"
import { allocatedBytes, labLayout, removeFromLab } from "./paths.mjs"
import { baseRelease, downloadEntry, inspectBase, inspectLock, inspectStaging } from "./inspect.mjs"
import { LabError } from "./run.mjs"

/**
 * What prune would remove. `keepIso` leaves the verified download (the
 * expensive fetch); `runs` adds the run records under the state root.
 */
export async function planPrune({ env = process.env, pin = labPin(), keepIso = false, runs = false } = {}) {
  const layout = labLayout(env)
  const targets = []
  const add = (root, relative, what) => {
    const path = join(root, relative)
    if (!existsSync(path)) return
    if (lstatSync(path).isSymbolicLink()) throw new LabError("prune-refused", `${path} is a symbolic link; the lab wrote none, so nothing under it is removed`)
    targets.push({ root, relative, path, what, bytes: allocatedBytes(path) })
  }
  const lock = await inspectLock(layout)
  const staging = await inspectStaging(layout)
  const active = staging.filter((entry) => entry.alive)
  const blockers = []
  if (lock.held && lock.alive) blockers.push(`run ${lock.record?.runId || "unknown"} holds the lab (pid ${lock.record?.pid || "?"}${lock.qemuAnswers ? ", its QEMU answers on QMP" : ""})`)
  for (const entry of active) blockers.push(`a QEMU still answers on ${entry.socket}`)
  if (existsSync(layout.downloads)) {
    for (const digest of readdirSync(layout.downloads)) {
      // Each download directory says what it holds: its verification
      // record names the release (a record written before 0.6.9 names only
      // the digest, and the ISO is the one .iso file in the directory).
      const dir = join(layout.downloads, digest)
      const { name, fileName, verified } = lstatSync(dir).isDirectory() ? downloadEntry(dir, digest) : { name: null, fileName: null, verified: false }
      if (verified && keepIso) {
        add(layout.cache, `downloads/${digest}/${fileName}.part`, "a partial download beside the verified ISO")
        continue
      }
      add(layout.cache, `downloads/${digest}`, verified ? `the verified ISO of ${name ? `Omarchy ${name}` : digest.slice(0, 12)} and its record` : `an unverified or partial download${name ? ` of Omarchy ${name}` : ` (${digest.slice(0, 12)})`}`)
    }
  }
  const base = inspectBase(layout, withRelease(pin, baseRelease(layout, pin)))
  if (base.state !== "missing") add(layout.cache, "base", `the ${base.state} base${base.manifest ? ` (Omarchy ${base.manifest.release.name}, guest ${base.manifest.guest.version})` : ""}`)
  for (const entry of staging) if (!entry.alive) add(layout.cache, `staging/${entry.name}`, `staging left by ${entry.name}`)
  if (existsSync(layout.plugins)) add(layout.cache, "plugins", "the listed plugins cached for the weigh evidence gate")
  if (lock.held && !lock.alive) add(layout.cache, "lab.lock", `a stale lock from ${lock.record?.runId || "an unknown run"}`)
  if (runs && existsSync(layout.runs)) add(layout.state, "runs", "every run record and document under the state root")
  const total = targets.reduce((sum, target) => sum + target.bytes, 0)
  return { layout, targets, total, blockers, remaining: { cache: existsSync(layout.cache) ? allocatedBytes(layout.cache) : 0, runs: existsSync(layout.runs) ? allocatedBytes(layout.runs) : 0 } }
}

/** Remove exactly the plan's targets, after the caller's consent; report recovered and remaining bytes. */
export function prune(plan) {
  if (plan.blockers.length) throw new LabError("lab-busy", `prune refuses while ${plan.blockers.join("; ")}`, { remedy: "wait for the run, or `omakit lab inspect` to see it" })
  const removed = []
  for (const target of plan.targets) {
    removeFromLab(target.root, target.relative)
    removed.push(target)
  }
  const recovered = removed.reduce((sum, target) => sum + target.bytes, 0)
  const remaining = { cache: existsSync(plan.layout.cache) ? allocatedBytes(plan.layout.cache) : 0, runs: existsSync(plan.layout.runs) ? allocatedBytes(plan.layout.runs) : 0 }
  return { removed, recovered, remaining, words: `recovered ${bytesBoth(recovered)}; ${bytesBoth(remaining.cache)} remain in the lab cache and ${bytesBoth(remaining.runs)} in run records` }
}
