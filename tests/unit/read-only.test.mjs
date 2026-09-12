// Read-only against omacom/omarchy-plugin-marketplace at all times.
//
// This test reads every source file in the repository and proves that no
// mutation path exists: no HTTP method other than GET, no GitHub CLI, no push,
// and no code that creates an issue, comment, label or pull request. `submit`
// prints a body; a person posts it.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

// The filesystem, not `git ls-files`: an untracked file in the working tree can
// still be executed, so it is held to the same rule.
const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(?:mjs|js|cjs|sh)$/.test(entry.name) || entry.name === "omakit") out.push(path)
  }
  return out
}

// This file necessarily contains the patterns it forbids, so it excludes itself
// and is instead held to the rule by review.
const SELF = "tests/unit/read-only.test.mjs"

const sources = walk(REPO_ROOT)
  .map((path) => ({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") }))
  .filter((source) => source.path !== SELF)

test("the repository has source files to check", () => {
  assert.ok(sources.length >= 10, `only found ${sources.length} tracked sources`)
})

test("no HTTP method other than GET", () => {
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/method\s*:\s*["'`]([A-Za-z]+)["'`]/g)) {
      assert.equal(match[1].toUpperCase(), "GET", `${path} uses method ${match[1]}`)
    }
    assert.doesNotMatch(text, /-X\s+(POST|PUT|PATCH|DELETE)/, `${path} shells out a mutating request`)
  }
})

test("no process ever spawns the GitHub CLI", () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(
      text,
      /(?:execFile|execFileSync|spawn|spawnSync|exec|execSync)\s*\(\s*["'`]gh["'`]/,
      `${path} spawns gh`,
    )
  }
})

test("no git verb that writes to a remote", () => {
  // Every git invocation's first verb must be one of these. `fetch`, `init`,
  // `remote add` and `checkout` are how the pinned checkout and a reviewer-mode
  // subject are created inside .cache; nothing reaches out and writes.
  const ALLOWED = new Set([
    "-C", "init", "remote", "fetch", "checkout", "rev-parse", "rev-list", "status",
    "ls-tree", "ls-files", "cat-file", "show", "log", "config", "add", "commit",
    // `omakit upgrade` fast-forwards the tool's own checkout. Local only: it
    // reads the remote and moves a local branch, and never writes to a remote.
    "merge", "merge-base",
  ])
  for (const { path, text } of sources) {
    for (const token of ["push", "send-pack", "request-pull", "am", "apply"]) {
      assert.ok(
        !new RegExp(`["'\`]${token}["'\`]`).test(text),
        `${path} mentions the git verb "${token}"`,
      )
    }
    // Staging and committing belong to the throwaway fixture repositories only.
    const allowed = path.startsWith("tests/") ? ALLOWED : new Set([...ALLOWED].filter((verb) => verb !== "add" && verb !== "commit"))
    for (const match of text.matchAll(/\bgit\w*\s*\(\s*[^,()]+,\s*\[\s*(?:\.\.\.[^,\]]+,\s*)?["'`]([\w-]+)["'`]/g)) {
      assert.ok(allowed.has(match[1]), `${path} calls git ${match[1]}`)
    }
  }
})

test("nothing creates an issue, comment, label or pull request", () => {
  for (const { path, text } of sources) {
    for (const pattern of [
      /\/issues\/\d*\/comments["'`]\s*,\s*\{[^}]*method/i,
      /issues\/\{[^}]*\}\/labels/i,
      /\/pulls["'`]\s*,\s*\{[^}]*method/i,
    ]) {
      assert.doesNotMatch(text, pattern, `${path} looks like a write to the issue tracker`)
    }
  }
})

test("the token is only ever read from the environment", () => {
  const github = sources.find((source) => source.path === "tools/marketplace/github.mjs")
  assert.ok(github)
  assert.match(github.text, /process\.env\.GITHUB_TOKEN/)
  for (const { path, text } of sources) {
    assert.doesNotMatch(
      text,
      /writeFileSync\([^)]*(?:GITHUB_TOKEN|GH_TOKEN|token\(\))/,
      `${path} looks like it writes a token to disk`,
    )
  }
})

test("no marketplace security-baseline marker can be emitted", () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /marketplace-security-baseline:v/, `${path} contains a baseline marker literal`)
    assert.doesNotMatch(text, /serializeSecurityBaselineMarker/, `${path} constructs a baseline marker`)
  }
})
