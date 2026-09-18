// `omakit inspect <plugin-dir>`: what a plugin tree does, as observations.
// Resolve the subject the way `submit` does, read its installable tree at
// the commit, run the four extractors over every file inspect reads, run
// the marketplace's own baseline through `verify` for the capabilities,
// and build the document of docs/INSPECT.md. No verdict, and the one score
// a position among listed trees by how much of its function text is in
// long functions, never a grade: every
// row is a fact the text shows, labelled observed, and the document ends
// with what the method cannot see.
//
// Runs nothing from the tree, resolves no host, opens no socket, writes
// nothing into the tree. The one thing it fetches is what `verify` fetches,
// which under the local transport is nothing.

import { join } from "node:path"
import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { marketplaceBaselineSection } from "../marketplace/verify.mjs"
import { consequence } from "../marketplace/preflight.mjs"
import { requirePin } from "../marketplace/pin.mjs"
import { omakitCacheDir } from "../marketplace/paths.mjs"
import { walkSubject } from "./walk.mjs"
import { extractProcesses } from "./processes.mjs"
import { extractHosts } from "./hosts.mjs"
import { extractWrites } from "./writes.mjs"
import { extractTimers } from "./timers.mjs"
import { extractFunctions } from "./functions.mjs"
import { evaluatePatterns, heavyShare, overSize, PATTERNS, rankOf, SIZE, sizeScore } from "./patterns.mjs"
import { recogniseBlockFile, shippedBlocks } from "../blocks/registry.mjs"
import { runStartedHelpers } from "./helpers.mjs"

export const METHOD = "static extraction, regular expressions over qml and shell; observed, not executed"

/**
 * What regular expressions over QML and shell cannot see, printed at the
 * end of every report and carried verbatim in the document. A tree that
 * shows none of the facts is "observed nothing of this kind", never clean,
 * because of this list.
 */
export const NOT_VISIBLE = Object.freeze([
  "commands built at run time",
  "hosts and paths from variables, properties, config or the environment",
  "scripts a command calls that inspect does not follow",
  "components loaded from outside the tree",
  "encoded or obfuscated content, and what a sh -c or eval string runs",
])

/** The failure codes that mean the target could not be read at all: exit 2, the contract's second status. */
export const NOT_READABLE = Object.freeze(["subject-not-found", "not-a-directory", "not-a-git-repository", "commit-not-found", "nothing-to-inspect", "usage"])

/**
 * The omakit blocks in the tree, read from the files' own headers and
 * bodies (tools/blocks/registry.mjs): an unmodified copy of a shipped
 * block is omakit's code, tested in this repository, and its lines are
 * not extracted, so it raises no row of its own; a copy whose body is not
 * one omakit shipped is reported as modified and read like any other file.
 * A block is complete when every file the shipped block has is present.
 *
 * @returns {{ blocks: Array<{ name: string, version: string, shippedVersion: string|null, state: "unmodified"|"modified", complete: boolean, files: Array<{ path: string, state: "unmodified"|"modified", version: string }> }>, skip: Set<string> }}
 */
export function recogniseBlocks(files) {
  const shipped = shippedBlocks()
  const found = new Map()
  for (const file of files) {
    const base = file.path.split("/").pop()
    const seen = recogniseBlockFile(base, file.text, shipped)
    if (!seen) continue
    if (!found.has(seen.name)) found.set(seen.name, { name: seen.name, shippedVersion: seen.shippedVersion, files: [] })
    found.get(seen.name).files.push({ path: file.path, state: seen.state, version: seen.version })
  }
  const blocks = []
  const skip = new Set()
  for (const entry of [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const expected = shipped.find((block) => block.name === entry.name)?.files.map((file) => file.file) || []
    const complete = expected.length > 0 && expected.every((name) => entry.files.some((file) => file.path.split("/").pop() === name))
    const state = entry.files.every((file) => file.state === "unmodified") ? "unmodified" : "modified"
    const versions = [...new Set(entry.files.map((file) => file.version))]
    for (const file of entry.files) if (file.state === "unmodified") skip.add(file.path)
    blocks.push({ name: entry.name, version: versions.length === 1 ? versions[0] : versions.join(", "), shippedVersion: entry.shippedVersion, state, complete, files: entry.files.sort((a, b) => (a.path < b.path ? -1 : 1)) })
  }
  return { blocks, skip }
}

export class InspectError extends Error {
  constructor(code, message, remedy = null) {
    super(message)
    this.name = "InspectError"
    this.code = code
    this.remedy = remedy
  }
}

/**
 * @param {{ repoRoot: string, target: string, offline?: boolean, allowDirty?: boolean, omakitVersion: string, onPhase?: (text: string) => void, cacheRoot?: string }} options
 * @returns {Promise<object>} the document of docs/INSPECT.md
 */
export async function inspectPlugin({ repoRoot, target, offline = false, allowDirty = false, omakitVersion, onPhase = () => {}, cacheRoot = omakitCacheDir() }) {
  let subject
  try {
    subject = resolveSubject(target, { cacheRoot, allowDirty })
  } catch (error) {
    if (error instanceof SubjectError && error.code === "dirty-worktree") {
      throw new InspectError(error.code, error.message.replace("read HEAD as committed", "inspect HEAD as committed"), "Commit them, or pass --allow-dirty to inspect HEAD as committed; uncommitted edits are not read.")
    }
    if (error instanceof SubjectError) throw new InspectError(error.code, error.message)
    throw error
  }
  onPhase("reading the installable tree")
  const tree = walkSubject(subject)
  const dir = subject.subdir ? join(subject.dir, subject.subdir) : subject.dir
  if (!tree.manifest && !tree.manifestError) {
    throw new InspectError("nothing-to-inspect", `no manifest.json at the root of ${dir}, so there is no plugin to inspect`, "Pass the directory that holds the plugin's manifest.json.")
  }
  const pluginId = typeof tree.manifest?.id === "string" ? tree.manifest.id.trim() : null

  onPhase("reading processes, hosts, writes and timers")
  const { blocks, skip } = recogniseBlocks(tree.files)
  // A `Run {` site is a process only where the tree carries the run block
  // whole and unmodified; otherwise the name is the plugin's own.
  const runBlock = blocks.some((block) => block.name === "run" && block.state === "unmodified" && block.complete)
  const storeBlock = runBlock && blocks.some((block) => block.name === "store" && block.state === "unmodified" && block.complete)
  const processes = []
  const hosts = []
  const writes = []
  const timers = []
  const functions = []
  const notResolvable = []
  for (const file of tree.files) {
    if (skip.has(file.path)) continue
    // Each function carries its rank among the listed ones (M12).
    functions.push(...extractFunctions(file).map((entry) => ({ ...entry, percentile: rankOf(entry) })))
    const rows = extractProcesses(file, { runBlock })
    processes.push(...rows)
    for (const row of rows) {
      if (row.argvForm === "computed") notResolvable.push({ file: row.file, line: row.line, kind: "command", text: `command: ${row.commandText}` })
    }
    const found = extractHosts(file, rows)
    hosts.push(...found.hosts)
    notResolvable.push(...found.notResolvable)
    writes.push(...extractWrites(file, { pluginId, storeBlock }))
    const ticking = extractTimers(file)
    timers.push(...ticking.timers)
    notResolvable.push(...ticking.notResolvable)
  }

  // A helper the QML starts through Run runs in the block's closed
  // environment (PATH=/usr/bin and the named variables, docs/BLOCKS.md),
  // so a bare tool name inside it is not an ambient PATH lookup. A helper
  // is one a Run site's argv[0] resolves to through the text
  // (helpers.mjs): a path the text does not show marks nothing, and only
  // when every QML process site of the tree is a Run site are its shell
  // lines marked closedEnvironment. The hook Omarchy runs, a test script,
  // a helper reached through a value the text does not show: ambient.
  const qmlSites = processes.filter((row) => row.declaredIn === "qml")
  const allRun = qmlSites.length > 0 && qmlSites.every((row) => row.block === "run")
  const started = runStartedHelpers(tree.files, processes)
  const closed = allRun ? started.helpers : new Set()
  for (const row of processes) {
    row.closedEnvironment = row.declaredIn === "shell" && closed.has(row.file)
    if (row.block === "run") {
      const value = started.resolved.get(`${row.file}:${row.line}`)
      row.helper = value && value.startsWith("@/") && started.helpers.has(value.slice(2)) ? value.slice(2) : null
    }
  }

  let marketplaceBaseline
  let blockingRules = []
  if (offline) {
    marketplaceBaseline = { skipped: true, reason: "--offline" }
  } else {
    onPhase("running the official security baseline over a local snapshot")
    // The baseline sees the plugin's tree and nothing around it: for a plugin
    // kept below the root of a larger repository, the local transport serves
    // that directory's tree as the whole tree. Without this the baseline
    // scanned the repository root and reported the root's evidence as the
    // plugin's, which is the 0.1 Passport's first failure.
    marketplaceBaseline = await marketplaceBaselineSection({ repoRoot, subject, subdir: subject.subdir })
    if (marketplaceBaseline.invoked && marketplaceBaseline.official && !marketplaceBaseline.official.error) {
      blockingRules = (await consequence(requirePin(repoRoot).dir, marketplaceBaseline.official)).selectivelyBlockingRules
    }
  }

  const facts = { processes, hosts, writes, timers, notResolvable, files: tree.files, readme: tree.readme, baseline: marketplaceBaseline, blockingRules }
  const { patterns, lookedFor } = evaluatePatterns(facts)

  return {
    omakit: omakitVersion,
    command: "inspect",
    method: METHOD,
    subject: {
      dir,
      commit: subject.commit,
      repository: { url: subject.repository.url },
      mode: subject.mode,
      pluginId,
      filesRead: tree.filesRead,
      // Paths `git status` lists at the checkout, under --allow-dirty: the
      // tree was read at the commit, so these were not inspected. 0 for a
      // clean checkout and for a fetched commit.
      uncommittedFiles: subject.uncommittedFiles,
    },
    observed: { processes, hosts, writes, timers, functions },
    // The omakit blocks in the tree, by their headers and body hashes: an
    // unmodified block's files were not read for facts (they are omakit's,
    // tested here), a modified one's were.
    blocks,
    // Size: the functions over the M12 thresholds, longest first. A count of
    // lines, branches and nesting over the text, compared with what 90 of
    // 100 functions in listed trees stay under; never a judgement.
    size: {
      measurement: SIZE.measurement,
      // The listed trees' own heavy shares, in the record's row order and
      // only for the trees with a function, so the score can be read from
      // the document alone.
      sample: { trees: SIZE.trees, functions: SIZE.functions, heavyShares: [...SIZE.distribution.heavyShare] },
      thresholds: { lines: SIZE.lines, branches: SIZE.branches, depth: SIZE.depth },
      // The share of this tree's function lines inside functions over the
      // thresholds, and 10 minus its rank among the listed trees' shares:
      // where the tree sits, never whether it is good; null with no
      // function to rank.
      heavyShare: Math.round(heavyShare(functions) * 10000) / 10000,
      score: sizeScore(functions),
      over: overSize(functions),
    },
    // The headline split: a shell script contributes one site per command
    // segment, so a tree with a few scripts carries hundreds of process
    // sites beside a handful of QML Process blocks, and the two are said
    // apart wherever the count is printed.
    counts: {
      processes: {
        total: processes.length,
        qml: processes.filter((row) => row.declaredIn === "qml").length,
        shell: processes.filter((row) => row.declaredIn === "shell").length,
      },
      hosts: hosts.length,
      writes: writes.length,
      timers: timers.length,
      functions: functions.length,
      notResolvable: notResolvable.length,
    },
    notResolvable,
    patterns,
    lookedFor,
    notVisible: [...NOT_VISIBLE],
    marketplaceBaseline,
  }
}

export { PATTERNS }
