// `omakit doctor`: what is installed, what is pinned, and what has moved.
//
// It reads and it prints. It installs nothing, updates nothing and touches no
// checkout, because the two things a person might want "upgraded" here are not
// the same thing and only one of them may ever move on its own.
//
// The tool version belongs to the installer: `omakit upgrade` hands it to Git
// for a checkout and to npm for its package, and names pacman for a distro
// package. A CLI that fetches and executes its own replacement is the
// supply-chain shape this repository warns about.
//
// The pin must not move by itself. Bumping it changes where the submission
// contract is read from, and the procedure in docs/UPSTREAM_CONTRACT.md requires
// re-proving transport parity and committing the evidence afterwards. An
// `upgrade` that quietly advanced the pin would break the one guarantee this
// tool sells. So doctor reports that the pin is behind, and that is all it
// does: the procedure is the maintainer's, it lives in that document and in
// this comment, and it is never printed, because the person running doctor
// is a user of a package that does not even ship docs/. What a user can do
// is run `omakit upgrade`, since a newer omakit may already carry the new
// pin, and otherwise open an issue naming the paths that moved.
//
// That the pin goes stale unnoticed is, of course, exactly the defect class
// `omakit watch` exists to report. It would be poor form not to apply it here.
//
// And "behind" is not the same as "behind in something omakit reads". Measured
// on 2026-09-13 (docs/MEASUREMENTS.md M7): 4,201 of the marketplace's 4,293
// commits in 30 days touched only registry.json, which omakit reads live,
// while nothing under scripts/ or .github/ISSUE_TEMPLATE/ changed since the
// pin. A doctor that only said "behind" would say it about every run. So it
// compares each path in PIN_PATHS between the pin and HEAD, by tree or blob
// id, and splits the ones that moved by the same list registry.mjs reads
// live from: the two data files, which a moved HEAD cannot make stale, and
// everything else, which only a new pin can carry. Measured on 0.1.7: with
// only registry.json and site/catalog.json moved, doctor said `note` and
// pointed a user at docs/UPSTREAM_CONTRACT.md, though the pin was behind in
// nothing the tool uses.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MARKETPLACE_PIN, PIN_PATHS, marketplacePinDir, pinDiskUsage, pinIsSparse, requirePin } from "./pin.mjs"
import { LIVE_PATHS } from "./registry.mjs"
import { credential, defaultBranchHead, getJson, UNAUTHENTICATED_LIMIT, GitHubError } from "./github.mjs"
import { latestOnRegistry, upgradeCommand } from "./upgrade.mjs"
import { pathHint } from "./path-hint.mjs"

/** "git+https://github.com/owner/name.git" in package.json -> "https://github.com/owner/name", or null. */
function repositoryPage(repository) {
  const url = typeof repository === "string" ? repository : repository?.url
  const match = String(url || "").match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return match ? `https://github.com/${match[1]}/${match[2]}` : null
}

function tool(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    return { name: pkg.name, version: pkg.version, engines: pkg.engines?.node || null, repository: repositoryPage(pkg.repository) }
  } catch {
    return { name: "omakit", version: "unknown", engines: null, repository: null }
  }
}

function version(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]
  } catch {
    return null
  }
}

/** The object id a path has at a commit in the pinned checkout: a tree id for a directory, a blob id for a file. Local; a blob-filtered clone still has every tree. */
function pinObjectId(pinDir, commit, path) {
  return execFileSync("git", ["-C", pinDir, "rev-parse", `${commit}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/**
 * Which of PIN_PATHS differ between the pin and `headCommit`. The pin side is
 * read from the local checkout; the HEAD side walks the git-trees API from the
 * exact commit, one read per tree on the way (three for PIN_PATHS as it
 * stands), so a directory compares by its tree id and a file by its blob id,
 * which is what "the blob at HEAD versus the blob at the pin" means for a
 * directory that omakit reads whole. A path missing at HEAD counts as changed.
 *
 * `fetchJson` is injectable for tests; the default is the one GET call site.
 */
export async function changedPinPaths({ pinDir, headCommit, pinCommit = MARKETPLACE_PIN.commit, fetchJson = getJson }) {
  const match = MARKETPLACE_PIN.repository.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/)
  const trees = new Map()
  const tree = async (sha) => {
    if (!trees.has(sha)) {
      const read = await fetchJson(`https://api.github.com/repos/${match[1]}/${match[2]}/git/trees/${sha}`)
      if (!Array.isArray(read?.tree)) throw new GitHubError("head-unreadable", `the tree ${sha} at the marketplace's HEAD did not read as a tree`)
      trees.set(sha, read.tree)
    }
    return trees.get(sha)
  }
  const headObjectId = async (path) => {
    const segments = path.split("/")
    let entries = await tree(headCommit)
    let id = null
    for (const [index, segment] of segments.entries()) {
      const entry = entries.find((candidate) => candidate.path === segment)
      if (!entry) return null
      id = entry.sha
      // Descend only on the way to a deeper segment: the path's own tree id
      // is the comparison, and its contents need no read.
      if (index < segments.length - 1) {
        if (entry.type !== "tree") return null
        entries = await tree(entry.sha)
      }
    }
    return id
  }
  const changed = []
  for (const pattern of PIN_PATHS) {
    const path = pattern.replace(/^\/|\/$/g, "")
    if (pinObjectId(pinDir, pinCommit, path) !== await headObjectId(path)) changed.push(pattern)
  }
  return changed
}

/** A PIN_PATHS pattern as a path: "/site/catalog.json" -> "site/catalog.json". */
const asPath = (pattern) => pattern.replace(/^\/|\/$/g, "")

/** "a", "a and b", "a, b and c". */
function list(items) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/**
 * The pin against the marketplace's HEAD, for a user. `changedPaths` is the
 * answer from changedPinPaths(), split by LIVE_PATHS into `readLive`, the
 * data files a moved HEAD cannot make stale because registry.mjs reads them
 * from HEAD, and `pinned`, everything only a new pin can carry. Only the
 * second set is worth a note; the action for it is a user's, not the
 * maintainer's. Null when the comparison was not made, and then the detail
 * says only that HEAD moved. Full commits in the evidence; short ones in
 * the detail. `issues` is where a user reports a pinned path that moved,
 * read from package.json by the caller.
 */
export function pinFreshness(identity, head, changedPaths = null, { issues = null } = {}) {
  const current = head.commit === identity.commit
  const branch = head.branch || "default"
  const changed = current ? [] : changedPaths || []
  const readLive = changed.filter((pattern) => LIVE_PATHS.includes(asPath(pattern)))
  const pinned = changed.filter((pattern) => !LIVE_PATHS.includes(asPath(pattern)))
  const where = `pin ${identity.commit.slice(0, 7)}; marketplace ${branch} at ${head.commit.slice(0, 7)}`
  const moved = changedPaths === null
    ? "; the paths omakit reads were not compared"
    : pinned.length
      ? `; changed since the pin: ${pinned.join(", ")}${readLive.length ? ` (${list(readLive.map(asPath))} moved too, and ${readLive.length === 1 ? "that is" : "those are"} read live)` : ""}`
      : readLive.length
        ? `; only ${list(readLive.map(asPath))} moved, and ${readLive.length === 1 ? "that is" : "those are"} read live`
        : "; nothing omakit reads moved"
  const stale = !current && (changedPaths === null || pinned.length > 0)
  return {
    id: "pin.freshness",
    state: stale ? "advice" : "ok",
    detail: current ? `the pin is the marketplace's current ${branch}-branch HEAD` : `${where}${moved}`,
    action: stale
      ? `A newer omakit may already carry the new pin: run \`omakit upgrade\`. If it does not, open an issue${issues ? ` at ${issues}/issues` : ""} naming the paths above.`
      : null,
    evidence: {
      pinCommit: identity.commit,
      marketplaceHead: head.commit,
      branch,
      ...(changedPaths === null ? {} : { changedPaths: changed, readLive, pinned }),
    },
  }
}

/**
 * @param {{ repoRoot: string, offline?: boolean, env?: object, npmPrefix?: () => string|null,
 *           resolveHead?: typeof defaultBranchHead, latest?: typeof latestOnRegistry }} options
 *   `env` and `npmPrefix` are injectable for tests of the PATH check;
 *   `resolveHead` and `latest` for tests of the two checks that read the
 *   network, whose defaults are the tool's one HEAD resolver and its one
 *   registry read.
 */
export async function doctor({ repoRoot, offline = false, onPhase, env = process.env, npmPrefix, resolveHead = defaultBranchHead, latest: latestVersion = latestOnRegistry }) {
  // Optional: told what is being read while the network answers. Never
  // affects the result.
  const phase = onPhase || (() => {})
  const checks = []
  const add = (id, state, detail, action = null, evidence = null) => checks.push({
    id,
    state,
    detail,
    action,
    ...(evidence ? { evidence } : {}),
  })

  const self = tool(repoRoot)
  add("omakit.version", "info", `${self.name} ${self.version}`)

  // Reachable as a bare command, or the one line that makes it so for this
  // install (path-hint.mjs). Measured: an npm prefix whose bin is not on PATH
  // installs a command nobody can run, and nothing said so.
  const reach = pathHint({ repoRoot, entryPoint: join(repoRoot, "bin/omakit"), env, ...(npmPrefix ? { npmPrefix } : {}) })
  add("omakit.path", reach.reachable ? "ok" : "advice",
    reach.reachable
      ? `\`omakit\` is reachable as a command from PATH (${reach.kind} install)`
      : `${reach.reason}${reach.where ? ` Keep the line below in ${reach.where}.` : ""}`,
    reach.reachable ? null : reach.line)

  const node = process.versions.node
  const major = Number(node.split(".")[0])
  add("node", major >= 22 ? "ok" : "problem", `node ${node}${self.engines ? ` (needs ${self.engines})` : ""}`,
    major >= 22 ? null : "Install Node 22 or newer.")

  const git = version("git")
  add("git", git ? "ok" : "problem", git || "git was not found on PATH", git ? null : "Install git.")

  const dir = marketplacePinDir(repoRoot)
  let identity = null
  try {
    identity = requirePin(repoRoot).identity
    add("pin.checkout", "ok",
      `${identity.commit} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}`)
    const sparse = pinIsSparse(dir)
    add("pin.size", sparse ? "ok" : "advice", `${pinDiskUsage(dir)}${sparse ? ", sparse" : ", full checkout"}`,
      sparse ? null : `This checkout predates the sparse fetch and is far larger than it needs to be. Remove ${dir} and run \`omakit pin\` to refetch only what omakit reads.`)
  } catch (error) {
    add("pin.checkout", "problem", error.message, error.remedy || "omakit pin")
  }

  if (!offline && identity) {
    phase("reading the marketplace's current default-branch HEAD")
    try {
      const head = await resolveHead(MARKETPLACE_PIN.repository)
      let changedPaths = []
      if (head.commit !== identity.commit) {
        phase("comparing each path omakit reads between the pin and HEAD")
        changedPaths = await changedPinPaths({ pinDir: dir, headCommit: head.commit, pinCommit: identity.commit })
      }
      checks.push(pinFreshness(identity, head, changedPaths, { issues: self.repository }))
    } catch (error) {
      add("pin.freshness", "unknown", `could not read the marketplace's HEAD (${error.code || "error"})`,
        error.code === "network-unavailable" ? "Connect to the network, or pass --offline to skip the two checks that need it." : null,
        { pinCommit: identity.commit, marketplaceHead: null, branch: null })
    }

    phase("asking the npm registry for the newest published version")
    const latest = await latestVersion(self.name)
    if (latest) {
      const current = latest === self.version
      add("omakit.latest", current ? "ok" : "advice",
        current ? `${latest} is the newest published version` : `${latest} is published, this is ${self.version}`,
        current ? null : upgradeCommand(repoRoot, self.name))
    } else {
      add("omakit.latest", "unknown", "the npm registry did not answer, or this version is unpublished")
    }
  }

  // Where the credential comes from, said out loud. Borrowing someone's `gh`
  // login is the right default and a bad secret: a tool that quietly picks up a
  // credential is a tool you cannot audit by reading its help text, so doctor
  // names the source every time.
  // Just "gh version 2.62.0": the build date gh prints after it would nest a
  // second parenthetical inside this line.
  phase("reading the GitHub credential from gh")
  const cli = version("gh")?.replace(/\s*\(.*\)\s*$/, "") || null
  const auth = credential({ refresh: true })
  add("github.auth", auth.value ? "ok" : "info",
    auth.source === "gh"
      ? `read-only, from your \`gh\` login${cli ? ` (${cli})` : ""}; omakit stores nothing`
      : `${auth.detail}. \`submit\` and \`verify\` need none at all; \`watch\` and \`parity\` are capped without one`,
    auth.value
      ? null
      : cli
        ? "`gh auth login` is enough. omakit reads that login for GET requests only and never copies it anywhere."
        : "Install GitHub's `gh` CLI and run `gh auth login`. omakit reads that login for GET requests only.")

  return { checks, problems: checks.filter((check) => check.state === "problem").length }
}

export { GitHubError }
