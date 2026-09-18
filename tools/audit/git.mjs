// The local Git facts used by `omakit audit`. Every invocation is read-only,
// has a fixed verb and argument shape, and is passed to Git without a shell.

import { spawnSync } from "node:child_process"

function runGit(sourceDir, args, env = process.env) {
  const result = spawnSync("git", ["-C", sourceDir, ...args], { timeout: 60_000,
    encoding: "utf8",
    env: { ...env, GIT_NO_LAZY_FETCH: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0 || result.error) {
    const detail = (result.stderr || result.error?.message || `git exited ${result.status}`).trim()
    throw new Error(`${args.join(" ")}: ${detail}`)
  }
  return result.stdout.trim()
}

/** Read HEAD, tree state and origin from one checkout. */
export function readCheckout(sourceDir, { env = process.env } = {}) {
  return {
    commit: runGit(sourceDir, ["rev-parse", "HEAD"], env).toLowerCase(),
    status: runGit(sourceDir, ["status", "--porcelain"], env),
    repository: runGit(sourceDir, ["remote", "get-url", "origin"], env),
  }
}

/** A missing object is a local-history fact, not a failed ancestry check. */
export function hasCommit(sourceDir, commit, { env = process.env } = {}) {
  const result = spawnSync("git", ["-C", sourceDir, "cat-file", "-e", commit], { timeout: 60_000,
    encoding: "utf8",
    env: { ...env, GIT_NO_LAZY_FETCH: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error || result.status === null) throw new Error(result.error?.message || "git could not run")
  return result.status === 0
}

export function isShallow(sourceDir, { env = process.env } = {}) {
  const value = runGit(sourceDir, ["rev-parse", "--is-shallow-repository"], env)
  if (!["true", "false"].includes(value)) throw new Error(`rev-parse --is-shallow-repository returned ${JSON.stringify(value)}`)
  return value === "true"
}

/** Is a recorded commit an ancestor of the running checkout? */
export function ancestorOf(sourceDir, commit, { env = process.env } = {}) {
  const result = spawnSync("git", ["-C", sourceDir, "merge-base", "--is-ancestor", commit, "HEAD"], { timeout: 60_000,
    encoding: "utf8",
    env: { ...env, GIT_NO_LAZY_FETCH: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  const detail = (result.stderr || result.error?.message || `git exited ${result.status}`).trim()
  throw new Error(`merge-base --is-ancestor ${commit} HEAD: ${detail}`)
}

/** Count commits after one recorded ancestor. */
export function commitsAfter(sourceDir, commit, { env = process.env } = {}) {
  const value = runGit(sourceDir, ["rev-list", "--count", `${commit}..HEAD`], env)
  if (!/^\d+$/.test(value)) throw new Error(`rev-list --count returned ${JSON.stringify(value)}`)
  return Number(value)
}
