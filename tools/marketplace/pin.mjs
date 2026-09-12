// The one home of the marketplace pin (docs/MARKETPLACE.md). The checkout is a
// read-only clone at this exact commit under .cache/marketplace; `omakit pin`
// creates or verifies it.
//
// It fetches only what omakit reads. The marketplace at this commit is 325 MB,
// of which 168 MB is preview imagery and 151 MB is history, and omakit reads
// seven files out of it. A blob-filtered, sparsely checked out fetch of just
// those paths is 16 MB and takes 2 seconds instead of 17. PIN_PATHS below is the
// whole list, and tests/unit/pin.test.mjs fails if any module starts reading a
// path outside it, because on a partial clone such a read would quietly reach
// for the network instead of failing.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const MARKETPLACE_PIN = Object.freeze({
  repository: "https://github.com/omacom/omarchy-plugin-marketplace",
  commit: "38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6",
  commitSubject: "Add Plugin updates plugin (#6374)",
  baselineVersion: "3",
  enforcementMode: "selective",
})

/**
 * Everything omakit reads out of the pinned checkout, as sparse-checkout
 * patterns. Anything not listed here is never fetched.
 *
 *   /scripts/                     the official submission parser, baseline
 *                                 scanner, policy, report and record modules,
 *                                 and build-catalog.mjs read as text for the
 *                                 reserved plugin-id namespace. Taken whole
 *                                 because those modules import each other.
 *   /registry.json                retired plugin ids, listed repositories
 *   /site/catalog.json            listed plugin ids
 *   /.github/ISSUE_TEMPLATE/      the submission form: the whole contract
 */
export const PIN_PATHS = Object.freeze([
  "/scripts/",
  "/registry.json",
  "/site/catalog.json",
  "/.github/ISSUE_TEMPLATE/",
])

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
  // Written as plumbing rather than through `git sparse-checkout`, so the
  // result does not depend on the git version's cone-mode defaults.
  git(dir, ["config", "core.sparseCheckout", "true"])
  mkdirSync(join(dir, ".git/info"), { recursive: true })
  writeFileSync(join(dir, ".git/info/sparse-checkout"), `${PIN_PATHS.join("\n")}\n`)
  git(dir, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", MARKETPLACE_PIN.commit], { stdio: ["ignore", "pipe", "inherit"] })
  git(dir, ["checkout", "-q", "--detach", MARKETPLACE_PIN.commit])
  const identity = readPinIdentity(dir)
  if (identity.commit !== MARKETPLACE_PIN.commit) throw new Error(`marketplace-unavailable: checkout ended at ${identity.commit}`)
  log(`ok - marketplace pin ${identity.commit} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}, ${pinDiskUsage(dir)}`)
  return { dir, identity, fetched: true }
}

/** Human-readable size of the pinned checkout, for `omakit pin` and `omakit doctor`. */
export function pinDiskUsage(dir) {
  try {
    const output = execFileSync("du", ["-sk", dir], { encoding: "utf8" }).split(/\s+/)[0]
    const mib = Number(output) / 1024
    return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB on disk`
  } catch {
    return "size unknown"
  }
}

/** True when the checkout was fetched with only PIN_PATHS, as a fresh one is. */
export function pinIsSparse(dir) {
  try {
    const enabled = execFileSync("git", ["-C", dir, "config", "--get", "core.sparseCheckout"], { encoding: "utf8" }).trim()
    return enabled === "true"
  } catch {
    return false
  }
}
