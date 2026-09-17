// `omakit add <block> [plugin-dir] [--update]`: copy a shipped block's
// files into <plugin-dir>/omakit/ and write omakit/NOTICE, and nothing
// else. This is the one code path in omakit that writes into a plugin
// tree, so it is held tighter than the rest (tests/unit/self-containment
// .test.mjs and tests/unit/blocks.test.mjs): the file names come from the
// block registry and are checked against the agent-control list before a
// byte is written; an existing file is never overwritten without --update;
// with --update a copy whose body is not one omakit shipped is refused,
// before anything is written, because a modified block is the author's;
// and every decision is made over every file first, so a refusal leaves
// the directory as it was.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { findAgentControl } from "../marketplace/agent-control.mjs"
import { blockClosure, bodySha256, parseHeader, renderNotice, shippedBlock, shippedBlocks, shippedHistory, withBodySha256, withSourceCommit } from "./registry.mjs"

export class AddError extends Error {
  constructor(code, message, remedy = null) {
    super(message)
    this.name = "AddError"
    this.code = code
    this.remedy = remedy
  }
}

/** The directory a block lands in, inside the plugin. */
export const BLOCK_DIR = "omakit"

/**
 * The omakit commit the files come from: the checkout's HEAD when omakit
 * runs from a Git checkout, else the commit npm recorded at publish
 * (`gitHead` in the packaged package.json), else "unknown".
 */
export function sourceCommit(repoRoot) {
  if (existsSync(join(repoRoot, ".git"))) {
    try {
      return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    } catch {
      // fall through to the package's record
    }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    if (/^[0-9a-f]{40}$/.test(String(pkg.gitHead || ""))) return pkg.gitHead
  } catch {
    // no package.json to read
  }
  return "unknown"
}

/** The text `add` writes for one shipped file: the header stamped with the commit, the body untouched. */
export function stampedText(entry, commit) {
  return withSourceCommit(withBodySha256(entry.text, entry.sha256), commit)
}

/**
 * What would happen to one file: `write` when it is not there, `current`
 * when it is there with the shipped body, `update` when it is there with
 * a body omakit shipped before (any version) and --update was passed, and
 * a refusal otherwise.
 */
function decide(target, entry, { update }) {
  if (!existsSync(target)) return { state: "write" }
  if (!statSync(target).isFile()) throw new AddError("not-a-file", `${target} exists and is not a regular file`, "Move it out of the way; omakit does not replace directories or links.")
  const existing = readFileSync(target, "utf8")
  const parsed = parseHeader(existing)
  if (parsed && bodySha256(parsed.body) === entry.sha256) return { state: "current", version: parsed.version }
  if (!update) throw new AddError("exists", `${target} is already there; pass --update to replace an unmodified copy`, "omakit add <block> [plugin-dir] --update")
  if (!parsed) throw new AddError("modified", `${target} is not an omakit block file (no block header), so it is the plugin's own and is not replaced`, "Move or rename the file, then run add again.")
  const older = shippedHistory().find((row) => row.block === entry.block && row.file === entry.file && row.sha256 === bodySha256(parsed.body))
  if (!older) throw new AddError("modified", `${target} carries a block header but its body is not one omakit shipped, so it was modified and is the plugin's own; it is not replaced`, "Keep your copy, or move it aside and run add again; omakit/NOTICE is where modifications are listed.")
  return { state: "update", version: older.version }
}

/**
 * @param {{ repoRoot: string, block: string, dir?: string, update?: boolean, cwd?: string }} options
 * @returns {{ block: string, version: string, dir: string, commit: string, files: Array<{ path: string, state: "written"|"updated"|"current", sha256: string, from: string|null }>, notice: { path: string, state: "written"|"updated"|"current" } }}
 */
export function addBlock({ repoRoot, block, dir = ".", update = false, cwd = process.cwd() }) {
  const shipped = shippedBlock(block)
  if (!shipped) throw new AddError("unknown-block", `${block} is not a block omakit ships; it ships ${shippedBlocks().map((entry) => entry.name).join(", ")}`, "omakit add run [plugin-dir], or omakit add store [plugin-dir]")
  // A block that uses another one (store uses run) brings it along: the
  // required block's files first, then its own, one decision list.
  const closure = blockClosure(block).map((name) => shippedBlock(name))
  const pluginDir = resolve(cwd, dir)
  if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) throw new AddError("plugin-dir-not-found", `${pluginDir} is not a directory`, "Pass the plugin's directory, the one with its manifest.json.")
  if (!existsSync(join(pluginDir, "manifest.json"))) throw new AddError("not-a-plugin", `${pluginDir} has no manifest.json, so it is not a plugin directory`, "Pass the plugin's directory, the one with its manifest.json.")
  // The names that will be written, checked against the agent-control list
  // before any decision: a block can never carry an instruction file along.
  const control = findAgentControl([...closure.flatMap((entry) => entry.files), { file: "NOTICE" }].map((entry) => ({ path: `${BLOCK_DIR}/${entry.file}`, type: "blob" })))
  if (control.length) throw new AddError("agent-control", `${control.map((entry) => entry.path).join(", ")}: an agent-control file is never written into a plugin`)
  const blockDir = join(pluginDir, BLOCK_DIR)
  // Every decision first; the first refusal stops everything, unwritten.
  const decisions = closure.flatMap((one) => one.files.map((entry) => ({ entry: { ...entry, block: one.name }, target: join(blockDir, entry.file), ...decide(join(blockDir, entry.file), { ...entry, block: one.name }, { update }) })))
  const commit = sourceCommit(repoRoot)
  mkdirSync(blockDir, { recursive: true })
  const files = []
  for (const { entry, target, state, version } of decisions) {
    if (state !== "current") {
      const blockFile = target
      writeFileSync(blockFile, stampedText(entry, commit))
    }
    files.push({ path: join(BLOCK_DIR, entry.file), block: entry.block, state: state === "write" ? "written" : state === "update" ? "updated" : "current", sha256: entry.sha256, from: version && version !== shippedBlock(entry.block).version ? version : null })
  }
  // NOTICE lists every block present in omakit/ after the write, recognised
  // by the headers of the files that are there.
  const present = shippedBlocks().filter((candidate) => candidate.files.every((entry) => existsSync(join(blockDir, entry.file)) && parseHeader(readFileSync(join(blockDir, entry.file), "utf8"))?.name === candidate.name))
  const noticeText = renderNotice(present, commit)
  const noticePath = join(blockDir, "NOTICE")
  const noticeBefore = existsSync(noticePath) ? readFileSync(noticePath, "utf8") : null
  let noticeState = "current"
  // A NOTICE already there stays when nothing was written: the commit it
  // names is the one the files came from, not the one add ran at.
  const untouched = files.every((entry) => entry.state === "current") && noticeBefore !== null
  if (!untouched && noticeBefore !== noticeText) {
    const blockFile = noticePath
    writeFileSync(blockFile, noticeText)
    noticeState = noticeBefore === null ? "written" : "updated"
  }
  return { block: shipped.name, version: shipped.version, requires: closure.filter((one) => one.name !== shipped.name).map((one) => `${one.name} ${one.version}`), dir: pluginDir, commit, files, notice: { path: join(BLOCK_DIR, "NOTICE"), state: noticeState } }
}
