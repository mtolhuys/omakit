// Release tool: write the checkout's HEAD into tools/blocks/commit.json so
// the packaged omakit names the commit its block files come from. Run by
// .github/workflows/release.yml before `npm pack`, never by a user, and
// never at install time (there is no lifecycle hook; tests/unit/
// self-containment.test.mjs holds package.json to none). Measured on
// 2026-09-19 by a first user of the packaged product: every stamped
// header, the NOTICE and `add`'s output said `commit unknown`, because
// the package has no .git and `npm pack` records no gitHead in the
// tarball's package.json (docs/evidence/ux/2026-09-19-first-user-test.json,
// finding 2).
//
//   node tools/blocks/record-commit.mjs            # writes the checkout's HEAD
//   node tools/blocks/record-commit.mjs --check    # exits 1 when the file names a commit other than HEAD, or none

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const COMMIT_FILE = "tools/blocks/commit.json"

/** The recorded commit in a tree, or null: the file's `commit` when it is a 40-character sha. */
export function recordedCommit(root) {
  try {
    const record = JSON.parse(readFileSync(join(root, COMMIT_FILE), "utf8"))
    return /^[0-9a-f]{40}$/.test(String(record.commit || "")) ? record.commit : null
  } catch {
    return null
  }
}

/** Write `commit` into the tree's record, keeping the file's own explanation. */
export function recordCommit(root, commit, { now = new Date() } = {}) {
  if (!/^[0-9a-f]{40}$/.test(String(commit || ""))) throw new Error(`record-commit: not a 40-character commit: ${commit}`)
  const file = join(root, COMMIT_FILE)
  const record = JSON.parse(readFileSync(file, "utf8"))
  const commitFile = file
  writeFileSync(commitFile, `${JSON.stringify({ ...record, commit, recordedAt: now.toISOString() }, null, 2)}\n`)
  return commit
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  if (process.argv.includes("--check")) {
    const recorded = recordedCommit(root)
    if (recorded !== head) {
      process.stderr.write(`${COMMIT_FILE} names ${recorded || "no commit"}; HEAD is ${head}\n`)
      process.exit(1)
    }
    process.stdout.write(`${COMMIT_FILE} names HEAD ${head}\n`)
  } else {
    process.stdout.write(`recorded ${recordCommit(root, head)} in ${COMMIT_FILE}\n`)
  }
}
