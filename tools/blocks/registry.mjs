// The blocks omakit ships, read from blocks/<name>/ in this checkout or
// package: which files each has, their headers, and the sha256 of every
// file's body, which is what `omakit add` writes, what it refuses to
// overwrite when it differs, and what `omakit inspect` recognises an
// unmodified copy by. Nothing here is a marketplace rule (AGENTS.md, rule
// 2): a block is behaviour measured from public review comments (M13,
// docs/BLOCKS.md), and this module only knows the block's own files.
//
// A file's header is its leading comment lines up to and including the
// line `end of omakit block header`; the body is everything after that
// line. The header names the block and its version, the licence, the
// copyright, where the file came from (the commit is stamped by `add`,
// so it is the one line a copy may differ from the shipped file in) and
// the body's sha256, so a person can check a copy with sha256sum alone.

import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const BLOCKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../blocks")

export const HEADER_END = "end of omakit block header"

/**
 * A block that uses another block's files from the same omakit/ directory:
 * `omakit add` writes the required block too, and inspect reads the
 * requirement when it says whether a block is complete.
 */
export const REQUIRES = Object.freeze({ store: Object.freeze(["run"]) })

/** The blocks to add for one name: its requirements first, then itself, each once. */
export function blockClosure(name) {
  const names = []
  for (const required of REQUIRES[name] || []) for (const entry of blockClosure(required)) if (!names.includes(entry)) names.push(entry)
  if (!names.includes(name)) names.push(name)
  return names
}

/**
 * Split a block file's text into its header lines and its body. Null when
 * the text has no block header, which is how a plugin's own file reads.
 *
 * @param {string} text
 * @returns {{ header: string[], body: string, name: string, version: string, sha256: string|null } | null}
 */
export function parseHeader(text) {
  const lines = String(text).split("\n")
  const end = lines.findIndex((line) => line.replace(/^(?:\/\/|#)\s*/, "").trim() === HEADER_END)
  if (end < 0 || end > 12) return null
  const header = lines.slice(0, end + 1)
  const strip = (line) => line.replace(/^(?:\/\/|#)\s?/, "")
  const named = header.map(strip).find((line) => /^omakit block: /.test(line))
  if (!named) return null
  const match = named.match(/^omakit block: ([a-z][a-z0-9-]*) (\d+\.\d+\.\d+)$/)
  if (!match) return null
  const sha = header.map(strip).find((line) => /^Body sha256: /.test(line))?.slice("Body sha256: ".length).trim() || null
  return { header, body: lines.slice(end + 1).join("\n"), name: match[1], version: match[2], sha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null }
}

export function bodySha256(body) {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

/**
 * Every shipped block: its name, version, and files with their parsed
 * headers and body hashes, from blocks/<name>/ (NOTICE is the listing, not
 * a block file, and has no header).
 *
 * @param {string} [dir]
 * @returns {Array<{ name: string, version: string, dir: string, files: Array<{ file: string, text: string, header: string[], body: string, sha256: string, headerSha256: string|null }>, notice: string }>}
 */
export function shippedBlocks(dir = BLOCKS_DIR) {
  const blocks = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue
    const blockDir = join(dir, entry.name)
    const files = []
    let notice = ""
    for (const file of readdirSync(blockDir).sort()) {
      const text = readFileSync(join(blockDir, file), "utf8")
      if (file === "NOTICE") {
        notice = text
        continue
      }
      const parsed = parseHeader(text)
      if (!parsed) throw new Error(`blocks/${entry.name}/${file} has no block header`)
      if (parsed.name !== entry.name) throw new Error(`blocks/${entry.name}/${file} names block ${parsed.name}`)
      files.push({ file, text, header: parsed.header, body: parsed.body, sha256: bodySha256(parsed.body), headerSha256: parsed.sha256, version: parsed.version })
    }
    if (!files.length) continue
    const versions = new Set(files.map((file) => file.version))
    if (versions.size !== 1) throw new Error(`blocks/${entry.name} carries ${versions.size} versions`)
    blocks.push({ name: entry.name, version: files[0].version, dir: blockDir, files, notice })
  }
  return blocks
}

/** One shipped block by name, or null. */
export function shippedBlock(name, dir = BLOCKS_DIR) {
  return shippedBlocks(dir).find((block) => block.name === name) || null
}

/**
 * What a file found in a plugin tree is, judged by its header and body
 * alone: `unmodified` when a block header names a shipped block and the
 * body's sha256 is that block's for that file; `modified` when it carries
 * a block header but the body is not one this omakit ships; null when it
 * has no block header at all.
 *
 * @param {string} file the base name, e.g. Run.qml
 * @param {string} text
 * @param {ReturnType<typeof shippedBlocks>} [blocks]
 * An older shipped body (blocks/history.json) is unmodified at its own
 * version, which the row names beside the shipped one.
 *
 * @returns {{ name: string, version: string, state: "unmodified"|"modified", shippedVersion: string|null } | null}
 */
export function recogniseBlockFile(file, text, blocks = shippedBlocks(), history = shippedHistory()) {
  const parsed = parseHeader(text)
  if (!parsed) return null
  const shipped = blocks.find((block) => block.name === parsed.name)
  const sha = bodySha256(parsed.body)
  const known = shipped?.files.find((entry) => entry.file === file)
  const older = !known || known.sha256 !== sha ? history.find((row) => row.block === parsed.name && row.file === file && row.sha256 === sha) : null
  const state = known && known.sha256 === sha ? "unmodified" : older ? "unmodified" : "modified"
  return { name: parsed.name, version: older ? older.version : parsed.version, state, shippedVersion: shipped ? shipped.version : null }
}

/** The header line that carries the body hash, rewritten to the given digest. */
export function withBodySha256(text, sha256) {
  return String(text).replace(/^((?:\/\/|#) ?Body sha256: )[0-9a-f]{64}$/m, `$1${sha256}`)
}

/** The header's source line with the commit stamped in. */
export function withSourceCommit(text, commit) {
  return String(text).replace(/^((?:\/\/|#) ?Source: omakit [^,\n]+, commit )\S+$/m, `$1${commit}`)
}

/**
 * The NOTICE for a set of blocks in one `omakit/` directory: per file the
 * block, version, licence, copyright, source path and commit, and the
 * body sha256, so the review's vendored-code expectation (record the
 * upstream, keep the licence, disclose modifications) is met by one file.
 *
 * @param {Array<{ name: string, version: string, files: Array<{ file: string, sha256: string }> }>} blocks
 * @param {string} commit the omakit commit the files came from, or "unstamped"
 */
export function renderNotice(blocks, commit) {
  const lines = [
    "omakit blocks in this directory",
    "",
    "Each file below was copied from omakit (https://github.com/mtolhuys/omakit),",
    "MIT licence, Copyright (c) 2026 Maarten Tolhuijs, by `omakit add`. The body",
    "sha256 is over everything after the file's header line",
    `\`${HEADER_END}\`; \`omakit inspect\` reports a file whose body differs as`,
    "modified, and `omakit add --update` refuses to overwrite one. Modifications",
    "are to be listed here by the plugin's author.",
    "",
  ]
  for (const block of blocks) {
    lines.push(`block ${block.name} ${block.version}, from omakit commit ${commit}`)
    for (const file of block.files) lines.push(`  ${file.file}  sha256 ${file.sha256}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`.replace(/\n\n$/, "\n")
}

/**
 * Every body sha256 omakit ever shipped for a block file, from
 * blocks/history.json (appended by tools/blocks/stamp.mjs at every block
 * change, never pruned) plus the current files: what `omakit add --update`
 * may replace, and what `inspect` names as an older unmodified copy.
 *
 * @returns {Array<{ block: string, version: string, file: string, sha256: string }>}
 */
export function shippedHistory(dir = BLOCKS_DIR) {
  let history = []
  try {
    history = JSON.parse(readFileSync(join(dir, "history.json"), "utf8"))
  } catch {
    history = []
  }
  const rows = [...history]
  for (const block of shippedBlocks(dir)) {
    for (const entry of block.files) {
      if (!rows.some((row) => row.block === block.name && row.file === entry.file && row.sha256 === entry.sha256)) rows.push({ block: block.name, version: block.version, file: entry.file, sha256: entry.sha256 })
    }
  }
  return rows
}
