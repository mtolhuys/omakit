// `omakit inspect <plugin-dir>`: what a plugin tree does, as observations.
// Resolve the subject the way `submit` does, read its installable tree at
// the commit, run the four extractors over every file inspect reads, run
// the marketplace's own baseline through `verify` for the capabilities,
// and build the document of docs/INSPECT.md. No verdict, no score: every
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
import { evaluatePatterns, overSize, PATTERNS, SIZE } from "./patterns.mjs"

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
export const NOT_READABLE = Object.freeze(["subject-not-found", "not-a-git-repository", "commit-not-found", "nothing-to-inspect", "usage"])

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
  const processes = []
  const hosts = []
  const writes = []
  const timers = []
  const functions = []
  const notResolvable = []
  for (const file of tree.files) {
    functions.push(...extractFunctions(file))
    const rows = extractProcesses(file)
    processes.push(...rows)
    for (const row of rows) {
      if (row.argvForm === "computed") notResolvable.push({ file: row.file, line: row.line, kind: "command", text: `command: ${row.commandText}` })
    }
    const found = extractHosts(file, rows)
    hosts.push(...found.hosts)
    notResolvable.push(...found.notResolvable)
    writes.push(...extractWrites(file, { pluginId }))
    const ticking = extractTimers(file)
    timers.push(...ticking.timers)
    notResolvable.push(...ticking.notResolvable)
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
    },
    observed: { processes, hosts, writes, timers, functions },
    // Size: the functions over the M12 thresholds, longest first. A count of
    // lines, branches and nesting over the text, compared with what 90 of
    // 100 functions in listed trees stay under; never a judgement.
    size: { measurement: SIZE.measurement, thresholds: { lines: SIZE.lines, branches: SIZE.branches, depth: SIZE.depth }, over: overSize(functions) },
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
