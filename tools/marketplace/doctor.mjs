// `omakit doctor`: what is installed, what is pinned, and what has moved.
//
// It reads and it prints. It installs nothing, updates nothing and touches no
// checkout, because the two things a person might want "upgraded" here are not
// the same thing and only one of them may ever move on its own.
//
// The tool version is npm's business: `npm i -g omakit@latest`. A CLI that
// fetches and executes its own replacement is the supply-chain shape this
// repository warns other people about.
//
// The pin must not move by itself. Bumping it changes where the submission
// contract is read from, and the procedure in docs/UPSTREAM_CONTRACT.md requires
// re-proving transport parity and committing the evidence afterwards. An
// `upgrade` that quietly advanced the pin would break the one guarantee this
// tool sells. So doctor reports that the pin is behind and prints the procedure.
//
// That the pin goes stale unnoticed is, of course, exactly the defect class
// `omakit watch` exists to report. It would be poor form not to apply it here.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MARKETPLACE_PIN, marketplacePinDir, pinDiskUsage, pinIsSparse, requirePin } from "./pin.mjs"
import { credential, defaultBranchHead, getJson, UNAUTHENTICATED_LIMIT, GitHubError } from "./github.mjs"

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

async function latestOnRegistry(name) {
  try {
    const meta = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
    return meta?.version || null
  } catch {
    return null
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
  const add = (id, state, detail, action = null) => checks.push({ id, state, detail, action })

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
    add("pin.checkout", "problem", error.message, "omakit pin")
  }

  if (!offline && identity) {
    phase("reading the marketplace's current default-branch HEAD")
    try {
      const head = await defaultBranchHead(MARKETPLACE_PIN.repository)
      const current = head.commit === identity.commit
      add("pin.freshness", current ? "ok" : "advice",
        current
          ? `the pin is the marketplace's current ${head.branch || "default"}-branch HEAD`
          : `the pin is ${identity.commit.slice(0, 7)}; the marketplace's ${head.branch || "default"} branch is now at ${head.commit.slice(0, 7)}`,
        current ? null : "Bumping the pin is a deliberate change: docs/UPSTREAM_CONTRACT.md has the procedure, which ends in re-proving parity and committing its evidence. Nothing here does it for you.")
    } catch (error) {
      add("pin.freshness", "unknown", `could not read the marketplace's HEAD (${error.code || "error"})`,
        error.code === "network-unavailable" ? "Connect to the network, or pass --offline to skip the two checks that need it." : null)
    }

    phase("asking the npm registry for the newest published version")
    const latest = await latestOnRegistry(self.name)
    if (latest) {
      const current = latest === self.version
      add("omakit.latest", current ? "ok" : "advice",
        current ? `${latest} is the newest published version` : `${latest} is published, this is ${self.version}`,
        current ? null : `npm i -g ${self.name}@latest`)
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
      : auth.source
        ? `${auth.source} is set; used read-only and never written to disk`
        : `${auth.detail}. \`submit\` and \`verify\` need none at all; \`watch\` and \`parity\` are capped without one`,
    auth.value
      ? null
      : cli
        ? "`gh auth login` is enough. omakit reads that login for GET requests only and never copies it anywhere."
        : "Install GitHub's `gh` CLI and run `gh auth login`, or set GITHUB_TOKEN. Either is read-only here.")

  return { checks, problems: checks.filter((check) => check.state === "problem").length }
}

export { GitHubError }
