// Maintainer's tool: rewrite the `Body sha256` line of every shipped block
// file to its body's digest and regenerate blocks/<name>/NOTICE, so the
// header a plugin author reads and the hash inspect recognises are one
// number. Run after editing a block:
//
//   node tools/blocks/stamp.mjs          # writes; prints what changed
//   node tools/blocks/stamp.mjs --check  # exits 1 when a header is stale
//
// Writes only under this checkout's blocks/ directory, never into a
// plugin tree; tests/unit/self-containment.test.mjs holds it to that.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BLOCKS_DIR, renderNotice, shippedBlocks, shippedHistory, withBodySha256 } from "./registry.mjs"

const check = process.argv.includes("--check")
let stale = 0
for (const block of shippedBlocks()) {
  for (const entry of block.files) {
    const stamped = withBodySha256(entry.text, entry.sha256)
    if (stamped !== entry.text) {
      stale += 1
      process.stdout.write(`${check ? "stale" : "stamped"} blocks/${block.name}/${entry.file} ${entry.sha256}\n`)
      const blockFile = join(block.dir, entry.file)
      if (!check) writeFileSync(blockFile, stamped)
    }
  }
  const notice = renderNotice([block], "unstamped")
  let current = null
  try {
    current = readFileSync(join(block.dir, "NOTICE"), "utf8")
  } catch {
    current = null
  }
  if (current !== notice) {
    stale += 1
    process.stdout.write(`${check ? "stale" : "written"} blocks/${block.name}/NOTICE\n`)
    const blockFile = join(block.dir, "NOTICE")
    if (!check) writeFileSync(blockFile, notice)
  }
}
// history.json: every (block, version, file, sha256) ever shipped, so
// `add --update` can tell an older copy from a modified one. Append-only.
{
  const rows = shippedHistory()
  const text = `${JSON.stringify(rows, null, 1)}\n`
  let current = null
  try {
    current = readFileSync(join(BLOCKS_DIR, "history.json"), "utf8")
  } catch {
    current = null
  }
  if (current !== text) {
    stale += 1
    process.stdout.write(`${check ? "stale" : "written"} blocks/history.json (${rows.length} shipped file versions)\n`)
    const blockFile = join(BLOCKS_DIR, "history.json")
    if (!check) writeFileSync(blockFile, text)
  }
}
if (!stale) process.stdout.write("every block header carries its body's sha256 and every NOTICE is current\n")
process.exitCode = check && stale ? 1 : 0
