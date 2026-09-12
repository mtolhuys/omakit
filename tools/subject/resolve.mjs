// Subject resolution. A subject is a plugin repository at an exact commit:
//   author mode   - a local Git repository path (HEAD, clean unless allowed)
//   reviewer mode - <https url>@<40-char sha>, fetched read-only into
//                   .cache/subjects/<owner>__<repo>/ and never executed.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

export class SubjectError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** "https://github.com/owner/repo(.git)" -> { owner, repository, url } or null. */
export function parseGitHubUrl(value) {
  const text = String(value || "").trim()
  const m = text.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (!m) return null
  return { owner: m[1], repository: m[2], url: `https://github.com/${m[1]}/${m[2]}` }
}

/** "https://github.com/owner/repo" -> "owner__repo", the cache directory name. */
export function subjectSlug(repoUrl) {
  return String(repoUrl).replace(/^https:\/\/github\.com\//, "").replace(/\//g, "__")
}

export function parseTarget(target) {
  const text = String(target || "")
  const m = text.match(/^(https:\/\/[^@\s]+)@([0-9a-fA-F]{40})$/)
  if (m) return { mode: "reviewer", url: m[1], commit: m[2].toLowerCase() }
  if (/^https?:\/\//.test(text)) throw new SubjectError("usage", "reviewer targets are <https url>@<40-char sha>")
  return { mode: "author", path: resolve(text) }
}

/**
 * @param {string} target
 * @param {{ cacheRoot: string, allowDirty?: boolean }} options
 * @returns {{ mode, dir, commit, clean, repository: { kind: "git", url: string|null, declared: boolean } }}
 */
export function resolveSubject(target, options) {
  const parsed = parseTarget(target)
  if (parsed.mode === "author") {
    if (!existsSync(parsed.path)) throw new SubjectError("subject-not-found", `no such directory: ${parsed.path}`)
    let top
    try {
      top = git(parsed.path, ["rev-parse", "--show-toplevel"]).trim()
    } catch {
      throw new SubjectError("not-a-git-repository", `${parsed.path} is not inside a Git repository`)
    }
    let commit
    try {
      commit = git(top, ["rev-parse", "HEAD"]).trim()
    } catch {
      throw new SubjectError("commit-not-found", `${top} has no commit yet`)
    }
    const clean = git(top, ["status", "--porcelain"]).trim().length === 0
    if (!clean && !options.allowDirty) throw new SubjectError("dirty-worktree", `${top} has uncommitted changes; commit them or pass --allow-dirty`)
    let originUrl = null
    try {
      originUrl = git(top, ["remote", "get-url", "origin"]).trim()
    } catch {
      originUrl = null
    }
    const gh = parseGitHubUrl(originUrl)
    return {
      mode: "author",
      dir: top,
      subdir: resolve(parsed.path) === top ? "" : resolve(parsed.path).slice(top.length + 1),
      commit,
      clean,
      repository: { kind: "git", url: gh ? gh.url : null, declared: Boolean(gh) },
    }
  }
  const gh = parseGitHubUrl(parsed.url)
  if (!gh) throw new SubjectError("usage", `reviewer mode needs a github.com repository URL, got ${parsed.url}`)
  const dir = join(resolve(options.cacheRoot), "subjects", `${gh.owner}__${gh.repository}`)
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true })
    execFileSync("git", ["init", "-q", dir], { encoding: "utf8" })
    git(dir, ["remote", "add", "origin", gh.url])
  }
  let present = false
  try {
    git(dir, ["cat-file", "-e", `${parsed.commit}^{commit}`])
    present = true
  } catch {
    present = false
  }
  if (!present) {
    try {
      git(dir, ["fetch", "-q", "--depth", "1", "origin", parsed.commit])
    } catch (e) {
      throw new SubjectError("commit-not-found", `${gh.url} does not offer commit ${parsed.commit}: ${String(e.stderr || e.message).trim().split("\n").pop()}`)
    }
  }
  return {
    mode: "reviewer",
    dir,
    subdir: "",
    commit: parsed.commit,
    clean: true,
    repository: { kind: "git", url: gh.url, declared: true },
  }
}
