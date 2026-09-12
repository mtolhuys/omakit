// The installable tree of a plugin repository at one exact commit, read from
// the local Git object database. Read-only: `git ls-tree` and `git cat-file`,
// never a working-tree walk, so what is inspected is exactly what the
// marketplace would fetch for that commit and nothing the author left
// untracked.

import { execFileSync } from "node:child_process"

function git(dir, args, encoding = "utf8") {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/**
 * @param {string} dir
 * @param {string} commit
 * @returns {Array<{ path: string, mode: string, type: string, sha: string, size?: number }>}
 */
export function readTree(dir, commit) {
  const raw = git(dir, ["ls-tree", "-r", "-t", "-l", commit])
  const entries = []
  for (const line of raw.split("\n")) {
    if (!line) continue
    const tab = line.indexOf("\t")
    const [mode, type, sha, size] = line.slice(0, tab).split(/\s+/)
    const entry = { path: line.slice(tab + 1), mode, type, sha }
    if (type === "blob") entry.size = Number(size)
    entries.push(entry)
  }
  return entries
}

export function readBlob(dir, sha) {
  return git(dir, ["cat-file", "blob", sha], "buffer")
}

export function readText(dir, sha, limit = 1024 * 1024) {
  return readBlob(dir, sha).subarray(0, limit).toString("utf8")
}

export function isBlob(entry) {
  return entry?.type === "blob" && entry.mode !== "120000"
}

export function rootEntries(entries) {
  return entries.filter((entry) => !entry.path.includes("/"))
}
