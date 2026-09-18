import { existsSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { marketplacePinDir } from "../../tools/marketplace/pin.mjs"

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export function requirePinForTests() {
  const dir = marketplacePinDir(REPO_ROOT)
  if (!existsSync(join(dir, "scripts/security-baseline-policy.mjs"))) {
    throw new Error(`no pinned marketplace checkout at ${dir}. Run ./bin/omakit pin first.`)
  }
  return dir
}

/**
 * Every file in the working tree, as a path relative to the root, with
 * .git, the pin cache and node_modules skipped. The filesystem, not
 * `git ls-files`: an untracked file can still be executed, so it is held
 * to the same rules. Four tests walked the tree with their own copy of
 * this before 0.6.0.
 */
export function repositoryFiles(root = REPO_ROOT) {
  const skip = new Set([".git", ".cache", "node_modules"])
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path))
    }
  }
  walk(root)
  return out
}
