// The one home of the marketplace pin (docs/MARKETPLACE.md). The checkout is a
// read-only clone at this exact commit in the user's XDG cache; `omakit pin`
// creates or verifies it.
//
// It fetches only what omakit reads. The marketplace at this commit is 325 MB,
// of which 168 MB is preview imagery and 151 MB is history, and omakit reads
// seven files out of it. A blob-filtered, sparsely checked out fetch of just
// those paths is 15 MB and takes 2 seconds instead of 17. PIN_PATHS below is the
// whole list, and tests/unit/pin.test.mjs fails if any module starts reading a
// path outside it, because on a partial clone such a read would quietly reach
// for the network instead of failing.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { omakitCacheDir } from "./paths.mjs"

/** Raised for every way the pin can be missing or wrong; the code is what the CLI keys its remedy on. */
export class PinError extends Error {
  constructor(message, { code = "marketplace-unavailable", remedy = null } = {}) {
    super(message)
    this.name = "PinError"
    this.code = code
    this.remedy = remedy
  }
}

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

/**
 * The user-writable pin location: `$XDG_CACHE_HOME/omakit/marketplace`, or
 * `~/.cache/omakit/marketplace`. omakit reads no variable of its own; a test or
 * an unusual install that wants the pin elsewhere sets XDG_CACHE_HOME, which is
 * the same switch every user has.
 */
export function marketplacePinDir(_repoRoot, env = process.env) {
  return omakitCacheDir("marketplace", env)
}

/** The location used before 0.1.0 packaging made the tool installable read-only. */
export function legacyMarketplacePinDir(repoRoot) {
  return join(resolve(repoRoot), ".cache/marketplace")
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function pinMigration(repoRoot, env = process.env) {
  const oldDir = legacyMarketplacePinDir(repoRoot)
  const newDir = marketplacePinDir(repoRoot, env)
  if (!existsSync(join(oldDir, ".git")) || existsSync(newDir)) return null
  const remedy = `mkdir -p -- ${shellQuote(dirname(newDir))} && mv -- ${shellQuote(oldDir)} ${shellQuote(newDir)}`
  return new PinError(
    `the marketplace pin is still at the old in-repository location ${oldDir}; the user-writable location ${newDir} does not exist. Omakit will not move the measured 15 MB checkout without you.`,
    { code: "marketplace-pin-migration-required", remedy },
  )
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
export function requirePin(repoRoot, env = process.env) {
  const migration = pinMigration(repoRoot, env)
  if (migration) throw migration
  const dir = marketplacePinDir(repoRoot, env)
  if (!existsSync(join(dir, "scripts/security-baseline-scanner.mjs"))) {
    throw new PinError(`no pinned marketplace checkout at ${dir}. Every rule omakit checks is read from that checkout, so nothing can run without it.`)
  }
  const identity = readPinIdentity(dir)
  if (identity.commit !== MARKETPLACE_PIN.commit) {
    throw new PinError(`${dir} is at ${identity.commit}, expected pin ${MARKETPLACE_PIN.commit}`)
  }
  if (identity.dirty) {
    throw new PinError(`${dir} has local modifications; the pin must stay unmodified`)
  }
  return { dir, identity }
}

/** A checkout that was initialised but never fetched (a run that lost the network) has a .git and no HEAD. */
function hasCommit(dir) {
  try {
    git(dir, ["rev-parse", "--verify", "-q", "HEAD"])
    return true
  } catch {
    return false
  }
}

/**
 * Reproducible setup: fetch exactly the pinned commit (depth 1) into
 * the XDG cache and check it out detached. Idempotent; never rewrites
 * an existing checkout that already sits at the pin.
 *
 * `log` is told what is happening as `{ state, text }`: a `pass` or `info`
 * line to keep, or `fetching` for the slow step about to start, which the CLI
 * draws as a progress line rather than a line of output.
 */
export function ensurePin(repoRoot, log = () => {}, env = process.env) {
  const migration = pinMigration(repoRoot, env)
  if (migration) throw migration
  const dir = marketplacePinDir(repoRoot, env)
  if (existsSync(join(dir, ".git")) && hasCommit(dir)) {
    const identity = readPinIdentity(dir)
    if (identity.commit === MARKETPLACE_PIN.commit && !identity.dirty) {
      log({ state: "pass", text: `marketplace pin ${identity.commit.slice(0, 7)} present at ${dir}` })
      return { dir, identity, fetched: false }
    }
    if (identity.dirty) throw new PinError(`${dir} has local modifications; remove the directory and run again`)
    log({ state: "info", text: `${dir} is at ${identity.commit}, not the pin` })
  } else if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true })
    execFileSync("git", ["init", "-q", dir], { encoding: "utf8" })
    git(dir, ["remote", "add", "origin", MARKETPLACE_PIN.repository])
  }
  log({ state: "fetching", text: `fetching the pinned marketplace checkout, ${MARKETPLACE_PIN.commit.slice(0, 7)}, about 15 MB` })
  // Written as plumbing rather than through `git sparse-checkout`, so the
  // result does not depend on the git version's cone-mode defaults.
  git(dir, ["config", "core.sparseCheckout", "true"])
  mkdirSync(join(dir, ".git/info"), { recursive: true })
  writeFileSync(join(dir, ".git/info/sparse-checkout"), `${PIN_PATHS.join("\n")}\n`)
  try {
    // git's own stderr is captured, not inherited: a network failure ends up
    // as one failure state in the tool's register, not two voices on stderr.
    git(dir, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", MARKETPLACE_PIN.commit])
  } catch (error) {
    const reason = String(error?.stderr || error?.message || "").trim().split("\n").filter((line) => /^fatal:/.test(line)).pop()
      || String(error?.message || "git fetch failed").trim().split("\n")[0]
    const offline = /unable to access|Could not resolve|Could not connect|Connection refused|Network is unreachable/i.test(reason)
    const failure = new PinError(`the pinned marketplace checkout could not be fetched: ${reason.replace(/^fatal:\s*/, "")}`)
    if (offline) failure.code = "network-unavailable"
    throw failure
  }
  git(dir, ["checkout", "-q", "--detach", MARKETPLACE_PIN.commit])
  const identity = readPinIdentity(dir)
  if (identity.commit !== MARKETPLACE_PIN.commit) throw new PinError(`checkout ended at ${identity.commit}`)
  log({ state: "pass", text: `marketplace pin ${identity.commit.slice(0, 7)} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}, ${pinDiskUsage(dir)}` })
  return { dir, identity, fetched: true }
}

/** Human-readable size of the pinned checkout, for `omakit pin` and `omakit doctor`. */
export function pinDiskUsage(dir) {
  // -H follows a symlink given on the command line (POSIX; GNU's -D). Measured
  // without it: a checkout reached through a symlink reported 0.0 MB, the size
  // of the link, while the directory behind it was 15 MB.
  try {
    const output = execFileSync("du", ["-skH", dir], { encoding: "utf8" }).split(/\s+/)[0]
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
