// Local Git transport for the official Omarchy marketplace security baseline.
//
// The official snapshot resolver (scripts/security-baseline-scope.mjs at the
// pinned marketplace commit) takes an injectable `fetchImpl` and asks for:
//
//   GET https://api.github.com/repos/{owner}/{repo}
//   GET https://api.github.com/repos/{owner}/{repo}/commits/{sha}
//   GET https://api.github.com/repos/{owner}/{repo}/git/trees/{treeSha}?recursive=1
//   GET https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}   (also ranged)
//
// This transport answers exactly those requests from a local clone at the exact
// commit. Nothing is invented beyond repository metadata that cannot be known
// locally, which the caller records as `assumedByAdapter`. No network, no
// credentials, no writes.

import { execFileSync } from "node:child_process"

export const ADAPTER_VERSION = 1

export const ASSUMED_BY_ADAPTER = Object.freeze([
  "repository.private=false",
  "repository.disabled=false",
  "repository.archived=false",
  "tree.truncated=false (the local tree is always complete)",
])

function git(repoDir, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function parseRepoUrl(repoUrl) {
  const url = new URL(repoUrl)
  const [owner, repository] = url.pathname.replace(/^\/|\/$/g, "").split("/")
  return { owner, repository: repository.replace(/\.git$/, "") }
}

function readTree(repoDir, commitSha) {
  const raw = git(repoDir, ["ls-tree", "-r", "-t", "-l", commitSha])
  const entries = []
  for (const line of raw.split("\n")) {
    if (!line) continue
    const tab = line.indexOf("\t")
    const [mode, type, sha, size] = line.slice(0, tab).split(/\s+/)
    const path = line.slice(tab + 1)
    const entry = { path, mode, type, sha }
    if (type === "blob") entry.size = Number(size)
    entries.push(entry)
  }
  return entries
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function notFound(what) {
  return new Response(JSON.stringify({ message: `local transport: ${what}` }), {
    status: 404,
    headers: { "content-type": "application/json" },
  })
}

function fileResponse(buffer, range) {
  if (!range) {
    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(buffer.length),
      },
    })
  }
  const match = String(range).match(/^bytes=0-(\d+)$/)
  if (!match) return new Response("", { status: 416 })
  const end = Math.min(Number(match[1]), buffer.length - 1)
  const slice = buffer.subarray(0, end + 1)
  return new Response(slice, {
    status: 206,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(slice.length),
      "content-range": `bytes 0-${end}/${buffer.length}`,
    },
  })
}

/**
 * @param {{ repoDir: string, repoUrl: string, commitSha: string, defaultBranch?: string }} options
 * @returns {{ fetchImpl: Function, stats: { api: number, raw: number } }}
 */
export function createLocalTransport({ repoDir, repoUrl, commitSha, defaultBranch }) {
  const { owner, repository } = parseRepoUrl(repoUrl)
  let commit = ""
  try {
    commit = git(repoDir, ["rev-parse", "--verify", "-q", `${commitSha}^{commit}`]).trim()
  } catch {
    commit = ""
  }
  if (commit.toLowerCase() !== String(commitSha).toLowerCase()) {
    throw new Error(`local transport: ${repoDir} does not contain commit ${commitSha}`)
  }
  const treeSha = git(repoDir, ["rev-parse", `${commit}^{tree}`]).trim()
  const tree = readTree(repoDir, commit)
  const byPath = new Map(tree.map((entry) => [entry.path, entry]))
  const branch = defaultBranch
    || (() => {
      try {
        return git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()
      } catch {
        return "main"
      }
    })()

  const stats = { api: 0, raw: 0 }
  const apiBase = `https://api.github.com/repos/${owner}/${repository}`
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repository}/${commit}/`

  async function fetchImpl(url, options = {}) {
    const target = String(url)
    if (target.startsWith("https://api.github.com/")) {
      stats.api += 1
      if (target === apiBase) {
        return jsonResponse({
          full_name: `${owner}/${repository}`,
          private: false,
          disabled: false,
          archived: false,
          default_branch: branch,
        })
      }
      if (target === `${apiBase}/commits/${commit}`) {
        return jsonResponse({ sha: commit, commit: { tree: { sha: treeSha } } })
      }
      if (target === `${apiBase}/git/trees/${treeSha}?recursive=1`) {
        return jsonResponse({ sha: treeSha, truncated: false, tree })
      }
      return notFound(`unexpected API request ${target}`)
    }
    if (target.startsWith(rawBase)) {
      stats.raw += 1
      const path = target
        .slice(rawBase.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/")
      const entry = byPath.get(path)
      if (!entry || entry.type !== "blob") return notFound(`no blob at ${path}`)
      const buffer = git(repoDir, ["cat-file", "blob", entry.sha], "buffer")
      return fileResponse(buffer, options.headers?.Range || options.headers?.range)
    }
    return notFound(`unsupported host for ${target}`)
  }

  return { fetchImpl, stats, commit, treeSha, tree }
}
