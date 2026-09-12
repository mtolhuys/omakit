// The one home of the marketplace pin (ADR-021, docs/MARKETPLACE.md rule 1).
// The checkout is a read-only clone at this exact commit under
// .cache/marketplace; `omakit marketplace-pin` creates or verifies it.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

export const MARKETPLACE_PIN = Object.freeze({
  repository: "https://github.com/omacom/omarchy-plugin-marketplace",
  commit: "38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6",
  commitSubject: "Add Plugin updates plugin (#6374)",
  baselineVersion: "3",
  enforcementMode: "selective",
})

export function marketplacePinDir(repoRoot) {
  const configured = process.env.OMAKIT_MARKETPLACE_PIN
  return configured ? resolve(configured) : join(resolve(repoRoot), ".cache/marketplace")
}

function git(dir, args, options = {}) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options })
}

/** Identity of the checkout at `dir`: commit plus the policy constants read from the pinned source. */
function readPinIdentity(dir) {
  const commit = git(dir, ["rev-parse", "HEAD"]).trim()
  const policy = git(dir, ["show", `${commit}:scripts/security-baseline-policy.mjs`])
  const version = policy.match(/securityBaselineVersion\s*=\s*"?([^";\s]+)"?/)?.[1] || "unknown"
  const mode = policy.match(/securityBaselineEnforcementMode\s*=\s*"([^"]+)"/)?.[1] || "unknown"
  const dirty = git(dir, ["status", "--porcelain"]).trim().length > 0
  return { commit, baselineVersion: version, enforcementMode: mode, dirty }
}

/**
 * Verify the pinned checkout without touching the network. Throws with a
 * stable message when it is missing, at another commit, or modified.
 */
export function requirePin(repoRoot) {
  const dir = marketplacePinDir(repoRoot)
  if (!existsSync(join(dir, "scripts/security-baseline-scanner.mjs"))) {
    throw new Error(`marketplace-unavailable: no pinned marketplace checkout at ${dir}; run ./bin/omakit marketplace-pin`)
  }
  const identity = readPinIdentity(dir)
  if (identity.commit !== MARKETPLACE_PIN.commit) {
    throw new Error(`marketplace-unavailable: ${dir} is at ${identity.commit}, expected pin ${MARKETPLACE_PIN.commit}`)
  }
  if (identity.dirty) {
    throw new Error(`marketplace-unavailable: ${dir} has local modifications; the pin must stay unmodified`)
  }
  return { dir, identity }
}

/**
 * Reproducible setup: fetch exactly the pinned commit (depth 1) into
 * .cache/marketplace and check it out detached. Idempotent; never rewrites
 * an existing checkout that already sits at the pin.
 */
export function ensurePin(repoRoot, log = () => {}) {
  const dir = marketplacePinDir(repoRoot)
  if (existsSync(join(dir, ".git"))) {
    const identity = readPinIdentity(dir)
    if (identity.commit === MARKETPLACE_PIN.commit && !identity.dirty) {
      log(`ok - marketplace pin present at ${dir} (${identity.commit})`)
      return { dir, identity, fetched: false }
    }
    if (identity.dirty) throw new Error(`marketplace-unavailable: ${dir} has local modifications; remove the directory and run again`)
    log(`fetch - ${dir} is at ${identity.commit}; fetching ${MARKETPLACE_PIN.commit}`)
  } else {
    mkdirSync(dir, { recursive: true })
    execFileSync("git", ["init", "-q", dir], { encoding: "utf8" })
    git(dir, ["remote", "add", "origin", MARKETPLACE_PIN.repository])
    log(`clone - ${MARKETPLACE_PIN.repository} @ ${MARKETPLACE_PIN.commit} into ${dir}`)
  }
  git(dir, ["fetch", "-q", "--depth", "1", "origin", MARKETPLACE_PIN.commit], { stdio: ["ignore", "pipe", "inherit"] })
  git(dir, ["checkout", "-q", "--detach", MARKETPLACE_PIN.commit])
  const identity = readPinIdentity(dir)
  if (identity.commit !== MARKETPLACE_PIN.commit) throw new Error(`marketplace-unavailable: checkout ended at ${identity.commit}`)
  log(`ok - marketplace pin ${identity.commit} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}`)
  return { dir, identity, fetched: true }
}
