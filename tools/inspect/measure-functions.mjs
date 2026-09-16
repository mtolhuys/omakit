// M12 reproduction: how long a plugin's functions are, in listed trees.
// The selection rule is the record's: the first 50 distinct community
// repositories in the pinned catalog's order, laid out as a root plugin and
// carrying a validated commit, each fetched read-only at that commit in
// reviewer mode through tools/subject/resolve.mjs and read from the Git
// object database through walk.mjs. `extractFunctions` runs over every
// file inspect reads; nothing from a tree is executed. The record carries
// no repository or commit: the rule reproduces the set.
//
// Writes docs/evidence/inspect/<date>-function-lengths.json (or --out FILE)
// and prints the quantiles to stderr. The three p90 quantiles and the three
// histograms replace the constants in patterns.mjs SIZE, and the per-tree
// heavyShare list its SIZE.distribution.heavyShare; tests/unit/submit.test.mjs
// holds them equal to the record.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { requirePin } from "../marketplace/pin.mjs"
import { CATALOG_PATH } from "../marketplace/registry.mjs"
import { omakitCacheDir } from "../marketplace/paths.mjs"
import { resolveSubject } from "../subject/resolve.mjs"
import { walkSubject } from "./walk.mjs"
import { extractFunctions } from "./functions.mjs"

export const TREES = 50
const KINDS = ["qml", "js", "shell", "python"]

/** The nearest-rank quantile of a sorted list: the value at position ceil(p * n). */
export function quantile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

/** Value to count, keys in ascending numeric order. */
export function histogram(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => [String(value), count]))
}

/**
 * The record's selection: catalog order, community listings laid out as a
 * root plugin with a validated commit, one entry per repository, the first
 * `count`.
 */
export function selectTrees(catalog, count = TREES) {
  const seen = new Set()
  const picked = []
  for (const plugin of Array.isArray(catalog.plugins) ? catalog.plugins : []) {
    if (plugin.sourceType !== "community" || plugin.repositoryLayout !== "root-plugin") continue
    if (typeof plugin.repo !== "string" || !/^[0-9a-f]{40}$/i.test(String(plugin.listingValidatedCommit || ""))) continue
    if (seen.has(plugin.repo)) continue
    seen.add(plugin.repo)
    picked.push({ repo: plugin.repo, commit: plugin.listingValidatedCommit.toLowerCase() })
    if (picked.length === count) break
  }
  return picked
}

/** Lines inside functions over any threshold, over lines inside every function; 0 with no function. */
export function heavyLinesOf(functions, thresholds) {
  return functions.filter((row) => row.lines > thresholds.lines || row.branches > thresholds.branches || row.depth > thresholds.depth).reduce((sum, row) => sum + row.lines, 0)
}

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * @param {Array<{ functions: Array, byKind?: object }>} trees the functions of each tree, in selection order
 * @param {{ fetchFailed?: string[], date?: string, previous?: string }} [meta]
 * @returns {object} the record
 */
export function buildRecord(trees, { fetchFailed = [], date = new Date().toISOString().slice(0, 10), previous = null } = {}) {
  const pooled = trees.flatMap((tree) => tree.functions)
  const sorted = (measure) => pooled.map((row) => row[measure]).sort((a, b) => a - b)
  const lines = sorted("lines")
  const depth = sorted("depth")
  const branches = sorted("branches")
  const quantiles = {
    lines: { p50: quantile(lines, 0.5), p75: quantile(lines, 0.75), p90: quantile(lines, 0.9), p95: quantile(lines, 0.95), max: lines.at(-1) ?? null },
    depth: { p50: quantile(depth, 0.5), p90: quantile(depth, 0.9), max: depth.at(-1) ?? null },
    branches: { p50: quantile(branches, 0.5), p90: quantile(branches, 0.9), max: branches.at(-1) ?? null },
  }
  const thresholds = { lines: quantiles.lines.p90, branches: quantiles.branches.p90, depth: quantiles.depth.p90 }
  const rows = trees.map((tree, index) => {
    const functionLines = tree.functions.reduce((sum, row) => sum + row.lines, 0)
    const heavyLines = heavyLinesOf(tree.functions, thresholds)
    return {
      row: index + 1,
      functions: tree.functions.length,
      byKind: Object.fromEntries(KINDS.map((kind) => [kind, tree.byKind?.[kind] ?? 0])),
      longest: tree.functions.length ? Math.max(...tree.functions.map((row) => row.lines)) : 0,
      medianLines: median(tree.functions.map((row) => row.lines)),
      functionLines,
      heavyLines,
      // null, not 0, with no function: a tree with nothing to measure did not measure light.
      heavyShare: functionLines ? Math.round((heavyLines / functionLines) * 10000) / 10000 : null,
    }
  })
  return {
    measurement: "M12",
    date,
    command: "node tools/inspect/measure-functions.mjs",
    method: `extractFunctions from tools/inspect/functions.mjs over the first ${trees.length} distinct repositories in the pinned catalog's order whose listing is community, laid out as a root plugin and carrying a validated commit (the 2026-09-15 inspect record's rule), each fetched read-only at that commit in reviewer mode. A function is a \`function name(\`, a named arrow function (\`const load = (rows) => {\`, \`this.load = rows => {\`), a method shorthand \`load(rows) {\` inside an object literal or a class, or a multi-line \`onSomething: {\` handler in QML and JavaScript; a \`name() {\` or \`function name\` block in shell; a \`def\` in Python. Anonymous callbacks are not counted. Lines are first to last line inclusive; depth is the deepest nesting below the body, the body itself at 0 in every language, a brace that opens an object or array literal or an inline arrow body not a level; branches count if, else if, for, while, switch, case, catch, &&, || and ?: (their shell and Python equivalents). In shell, a `||` or `&&` followed by one flow word (return, exit, continue, break, true, false, :) with an optional status and nothing else on the line is a guard and not a branch; the body of a heredoc and a single-quoted program spanning lines count toward the length and toward nothing else. In Python, a line that starts while a bracket is open is a continuation and never a nesting level. Quantiles are nearest-rank over every function in the sample pooled, not per tree. \`distribution\` is the histogram of each measure over the same functions, value to count, from which a function's percentile rank is read. Per tree, functionLines is the lines inside every function, heavyLines the lines inside functions over any p90 threshold of this record, and heavyShare their ratio, null with no function; the size score of omakit inspect is a tree's position among the non-null heavyShares.`,
    sample: { trees: trees.length, functions: pooled.length, fetchFailed },
    quantiles,
    distribution: { lines: histogram(lines), branches: histogram(branches), depth: histogram(depth) },
    rows,
    notes: `Rows carry no repository or commit; the selection rule reproduces the set. A function count and a longest length per tree are counts of what the extraction saw, not a judgement of any plugin.${previous ? ` ${previous}` : ""}`,
  }
}

const PREVIOUS = "Re-measured on 2026-09-16 after three extraction fixes, so the quantiles are not comparable with the 0.4.3 record (this file at commit 6619c26: 50 trees, 6040 functions, p90 22 lines, 6 branches, nesting 3; and before it 18 trees, 715 functions, p90 18 lines, 7 branches, nesting 2): a Python body now starts at depth 0 the way a brace body does, where it started at 1; a brace that opens an object or array literal is no longer a nesting level; and a named arrow function or a method shorthand is a function, where only `function name(` and `onSomething: {` were. Re-measured again for 0.5.1 after four more (the 0.5.0 record is this file at commit 7df451a: 6041 functions, p90 22 lines, 6 branches, nesting 2, six heavyShares of 0 among 50): a Python continuation line inside an open bracket no longer counts as nesting; a shell heredoc body and a single-quoted program spanning lines are no longer read as shell; a shell guard (`|| return 1`) is no longer a branch; and a tree with no function carries heavyShare null instead of 0, so it no longer lifts every other tree's rank."

export async function measureFunctions(repoRoot, { count = TREES, cacheRoot = omakitCacheDir(), log = () => {} } = {}) {
  const pin = requirePin(repoRoot)
  const catalog = JSON.parse(readFileSync(join(pin.dir, CATALOG_PATH), "utf8"))
  const selected = selectTrees(catalog, count)
  const trees = []
  const fetchFailed = []
  for (const [index, entry] of selected.entries()) {
    log(`${index + 1}/${selected.length} ${entry.repo}@${entry.commit.slice(0, 8)}`)
    let subject
    try {
      subject = resolveSubject(`${entry.repo}@${entry.commit}`, { cacheRoot })
    } catch (error) {
      fetchFailed.push(`row ${index + 1}: ${error.code || "error"}`)
      continue
    }
    const tree = walkSubject(subject)
    const functions = tree.files.flatMap((file) => extractFunctions(file).map((row) => ({ ...row, fileKind: file.kind })))
    const byKind = Object.fromEntries(KINDS.map((kind) => [kind, functions.filter((row) => row.fileKind === kind).length]))
    trees.push({ functions, byKind })
  }
  return buildRecord(trees, { fetchFailed, previous: PREVIOUS })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repoRoot = resolve(process.cwd())
  const record = await measureFunctions(repoRoot, { log: (text) => process.stderr.write(`${text}\n`) })
  const at = process.argv.indexOf("--out")
  const evidencePath = resolve(at > 0 && process.argv[at + 1] ? process.argv[at + 1] : join(repoRoot, "docs/evidence/inspect", `${record.date}-function-lengths.json`))
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`)
  process.stderr.write(`${record.sample.trees} trees, ${record.sample.functions} functions; p90 ${record.quantiles.lines.p90} lines, ${record.quantiles.branches.p90} branches, nesting ${record.quantiles.depth.p90}; ${record.sample.fetchFailed.length} fetch failures\n${evidencePath}\n`)
}
