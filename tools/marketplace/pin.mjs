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
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
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
  commit: "b7b2965431c52fc6311fdb389bd9f0d6275235c4",
  commitSubject: "Add OmaStudio plugin (#6843)",
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
  return execFileSync("git", ["-C", dir, ...args], { timeout: 300_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options })
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

/** Is a process alive: signal 0 asks without sending; EPERM means it is there and somebody else's. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** How long a second first run waits for the first to finish fetching before it gives up: the fetch is about 2 s on the reference network, so this is generous. */
export const PIN_WAIT_MS = 300_000

/**
 * The lock beside the pin, `<dir>.lock/`, made atomically: `mkdir` without
 * `recursive` fails with EEXIST when it is there, so exactly one process
 * holds it. The holder writes its pid into it; a lock whose pid is gone is
 * stale and is taken over. Returns `release()`, or null when another live
 * process holds it.
 */
function claimLock(lockDir) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, "holder.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
      return () => rmSync(lockDir, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      let holder = null
      try {
        holder = JSON.parse(readFileSync(join(lockDir, "holder.json"), "utf8")).pid
      } catch {
        holder = null
      }
      // A lock without a holder file yet is one being written this instant; a lock whose holder is dead is stale.
      if (holder !== null && !alive(holder)) {
        rmSync(lockDir, { recursive: true, force: true })
        continue
      }
      return null
    }
  }
  return null
}

/**
 * Fetch the pinned commit into a staging directory beside the pin, sparse
 * and blob-filtered, and check it out detached. Written as plumbing rather
 * than through `git sparse-checkout`, so the result does not depend on the
 * git version's cone-mode defaults. `dir` here is the staging directory,
 * and the sparse-checkout file is the one write beside the pin.
 */
function populatePin(dir, log) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execFileSync("git", ["init", "-q", dir], { timeout: 60_000, encoding: "utf8" })
  git(dir, ["remote", "add", "origin", MARKETPLACE_PIN.repository])
  log({ state: "fetching", text: `fetching the pinned marketplace checkout, ${MARKETPLACE_PIN.commit.slice(0, 7)}, about 15 MB` })
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
  return identity
}

/**
 * Reproducible setup: fetch exactly the pinned commit (depth 1) into
 * the XDG cache and check it out detached. Idempotent; never rewrites
 * an existing checkout that already sits at the pin.
 *
 * Two first runs against one cache are serialised: the fetch goes into a
 * staging directory (`<dir>.staging-<pid>`) under a lock (`<dir>.lock/`,
 * made atomically), and the finished checkout is renamed into place, so
 * the pin is either absent or whole and never a directory two `git init`s
 * are racing in. A process that finds the lock held waits for the holder
 * and then verifies what it left. Measured on 2026-09-19: two `omakit pin`
 * against one empty cache ran `git init` in the same directory, and one
 * died on "cannot copy .git/description: File exists"
 * (docs/evidence/ux/2026-09-19-acceptance.json, finding 6).
 *
 * `log` is told what is happening as `{ state, text }`: a `pass` or `info`
 * line to keep, or `fetching` for the slow step about to start, which the CLI
 * draws as a progress line rather than a line of output. `populate` is the
 * fetch step, injectable for the tests that prove the serialisation without
 * a network.
 */
export function ensurePin(repoRoot, log = () => {}, env = process.env, { populate = populatePin, waitMs = PIN_WAIT_MS } = {}) {
  const migration = pinMigration(repoRoot, env)
  if (migration) throw migration
  const dir = marketplacePinDir(repoRoot, env)
  const present = () => {
    if (!existsSync(join(dir, ".git")) || !hasCommit(dir)) return null
    const identity = readPinIdentity(dir)
    if (identity.dirty) throw new PinError(`${dir} has local modifications; remove the directory and run again`)
    return identity
  }
  const found = present()
  if (found && found.commit === MARKETPLACE_PIN.commit) {
    log({ state: "pass", text: `marketplace pin ${found.commit.slice(0, 7)} present at ${dir}` })
    return { dir, identity: found, fetched: false }
  }
  if (found) log({ state: "info", text: `${dir} is at ${found.commit}, not the pin` })
  mkdirSync(dirname(dir), { recursive: true })
  const lockDir = `${dir}.lock`
  let release = claimLock(lockDir)
  if (!release) {
    // Another first run holds the lock: wait for it, then read what it left.
    log({ state: "info", text: `another omakit is fetching the pin at ${dir}; waiting for it` })
    const deadline = Date.now() + waitMs
    while (existsSync(lockDir) && Date.now() < deadline) {
      sleepMs(200)
      // A holder that died mid-fetch leaves its lock; take it over.
      release = claimLock(lockDir)
      if (release) break
    }
    if (!release) {
      const after = present()
      if (after && after.commit === MARKETPLACE_PIN.commit) {
        log({ state: "pass", text: `marketplace pin ${after.commit.slice(0, 7)} present at ${dir}, fetched by the other omakit` })
        return { dir, identity: after, fetched: false, waited: true }
      }
      if (existsSync(lockDir)) throw new PinError(`another omakit has held the pin's lock at ${lockDir} for ${Math.round(waitMs / 1000)} s; if it is gone, remove the lock directory and run again`)
      throw new PinError(`the other omakit left no pin at ${dir}; run \`omakit pin\` again`)
    }
  }
  try {
    // The lock is ours; the pin may have appeared while we waited for it.
    const meanwhile = present()
    if (meanwhile && meanwhile.commit === MARKETPLACE_PIN.commit) {
      log({ state: "pass", text: `marketplace pin ${meanwhile.commit.slice(0, 7)} present at ${dir}, fetched by the other omakit` })
      return { dir, identity: meanwhile, fetched: false, waited: true }
    }
    const staging = `${dir}.staging-${process.pid}`
    try {
      const identity = populate(staging, log)
      // Into place in one rename; a checkout at another commit, or one that
      // never got its HEAD, is moved aside first and removed after.
      const aside = `${dir}.replaced-${process.pid}`
      if (existsSync(dir)) renameSync(dir, aside)
      renameSync(staging, dir)
      rmSync(aside, { recursive: true, force: true })
      log({ state: "pass", text: `marketplace pin ${identity.commit.slice(0, 7)} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}, ${pinDiskUsage(dir)}` })
      return { dir, identity, fetched: true }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  } finally {
    release()
  }
}

/**
 * Human-readable size of the pinned checkout, for `omakit pin` and `omakit
 * doctor`. `env` is the environment `du` is found in; injectable for tests.
 */
export function pinDiskUsage(dir, env = process.env) {
  // -H follows a symlink given on the command line (POSIX; GNU's -D). Measured
  // without it: a checkout reached through a symlink reported 0.0 MB, the size
  // of the link, while the directory behind it was 15 MB.
  //
  // The total is read whether or not du exited 0. du exits 1 when a file it
  // listed is gone by the time it reaches it, and still prints the total.
  // Measured: with `git status` running on the pin in parallel, 1 of 40 runs
  // warned "cannot access '.git/index.lock'" over its momentary lock file
  // and exited 1, so doctor said "size unknown" for a checkout it had the
  // size of. Only a run that printed no total is unknown.
  const result = spawnSync("du", ["-skH", dir], { timeout: 60_000, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] })
  const output = String(result.stdout || "").trim().split(/\s+/)[0]
  if (result.error || !/^\d+$/.test(output)) return "size unknown"
  const mib = Number(output) / 1024
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB on disk`
}

/** True when the checkout was fetched with only PIN_PATHS, as a fresh one is. */
/**
 * Whether the checkout is the sparse one `omakit pin` fetches: judged by
 * what is on disk, the top-level entries being the pinned paths and
 * nothing else, not by a git setting. Measured on 2026-09-19 by a first
 * user whose freshly fetched pin was told it "predates the sparse fetch"
 * and should be removed, because the answer came from `git config
 * core.sparseCheckout` and that read failed on their machine while the
 * tree itself was exactly the four pinned paths (docs/evidence/ux/
 * 2026-09-19-first-user-test.json, finding 9). Returns the entries beyond
 * the pin too, so doctor can name what a full checkout carries.
 *
 * @returns {{ sparse: boolean, extra: string[], sparseCheckoutConfig: boolean|null }}
 */
export function pinShape(dir) {
  const pinned = new Set(PIN_PATHS.map((pattern) => pattern.replace(/^\//, "").split("/")[0]))
  let entries = []
  try {
    entries = readdirSync(dir).filter((name) => name !== ".git")
  } catch {
    return { sparse: false, extra: [], sparseCheckoutConfig: null }
  }
  const extra = entries.filter((name) => !pinned.has(name)).sort()
  let sparseCheckoutConfig = null
  try {
    sparseCheckoutConfig = execFileSync("git", ["-C", dir, "config", "--get", "core.sparseCheckout"], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true"
  } catch {
    sparseCheckoutConfig = null
  }
  return { sparse: entries.length > 0 && extra.length === 0, extra, sparseCheckoutConfig }
}

export function pinIsSparse(dir) {
  return pinShape(dir).sparse
}
