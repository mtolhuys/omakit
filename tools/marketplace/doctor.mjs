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
// tool sells. So doctor reports that the pin is behind and prints the procedure.
//
// That the pin goes stale unnoticed is, of course, exactly the defect class
// `omakit watch` exists to report. It would be poor form not to apply it here.
//
// And "behind" is not the same as "behind in something omakit reads". Measured
// on 2026-09-13 (docs/MEASUREMENTS.md M7): 4,201 of the marketplace's 4,293
// commits in 30 days touched only registry.json, which omakit now reads live,
// while nothing under scripts/ or .github/ISSUE_TEMPLATE/ changed since the
// pin. A doctor that only said "behind" would say it about every run. So it
// compares each path in PIN_PATHS between the pin and HEAD, by tree or blob
// id, and names the ones that moved.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MARKETPLACE_PIN, PIN_PATHS, marketplacePinDir, pinDiskUsage, pinIsSparse, requirePin } from "./pin.mjs"
import { credential, defaultBranchHead, getJson, UNAUTHENTICATED_LIMIT, GitHubError } from "./github.mjs"
import { latestOnRegistry, upgradeCommand } from "./upgrade.mjs"

function tool(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    return { name: pkg.name, version: pkg.version, engines: pkg.engines?.node || null }
  } catch {
    return { name: "omakit", version: "unknown", engines: null }
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

/**
 * Full pin evidence for machines; human output deliberately keeps short
 * hashes. `changedPaths` is the answer from changedPinPaths(); null when the
 * comparison was not made, and then the detail says only that HEAD moved.
 */
export function pinFreshness(identity, head, changedPaths = null) {
  const current = head.commit === identity.commit
  const branch = head.branch || "default"
  const moved = changedPaths === null
    ? ""
    : changedPaths.length
      ? `; changed since the pin: ${changedPaths.join(", ")}`
      : "; every path omakit reads is unchanged since the pin"
  return {
    id: "pin.freshness",
    state: current ? "ok" : "advice",
    detail: current
      ? `the pin is the marketplace's current ${branch}-branch HEAD`
      : `the pin is ${identity.commit.slice(0, 7)}; the marketplace's ${branch} branch is now at ${head.commit.slice(0, 7)}${moved}`,
    action: current ? null : "Bumping the pin is a deliberate change: docs/UPSTREAM_CONTRACT.md has the procedure, which ends in re-proving parity and committing its evidence. Nothing here does it for you.",
    evidence: {
      pinCommit: identity.commit,
      marketplaceHead: head.commit,
      branch,
      ...(changedPaths === null ? {} : { changedPaths: current ? [] : changedPaths }),
    },
  }
}

/**
 * @param {{ repoRoot: string, offline?: boolean }} options
 */
export async function doctor({ repoRoot, offline = false, onPhase }) {
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
      const head = await defaultBranchHead(MARKETPLACE_PIN.repository)
      let changedPaths = []
      if (head.commit !== identity.commit) {
        phase("comparing each path omakit reads between the pin and HEAD")
        changedPaths = await changedPinPaths({ pinDir: dir, headCommit: head.commit, pinCommit: identity.commit })
      }
      checks.push(pinFreshness(identity, head, changedPaths))
    } catch (error) {
      add("pin.freshness", "unknown", `could not read the marketplace's HEAD (${error.code || "error"})`,
        error.code === "network-unavailable" ? "Connect to the network, or pass --offline to skip the two checks that need it." : null,
        { pinCommit: identity.commit, marketplaceHead: null, branch: null })
    }

    phase("asking the npm registry for the newest published version")
    const latest = await latestOnRegistry(self.name)
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
