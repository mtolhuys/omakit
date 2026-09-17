// The review patterns of docs/INSPECT.md as data: for each class the
// marketplace's human review raised in the M11 sample, a precondition over
// the observed facts, the measurement it cites and the share it prints. A
// pattern row prints only where the precondition is met, in two lines: the
// observation with its sites, then "about N of every 100 review findings in
// the sample (M11)". Never "missing", "should" or "fix": the row names the
// observation and the frequency and stops. A pattern without a number does
// not ship; tests/unit/submit.test.mjs holds every entry here to a
// measurement that names a section of docs/MEASUREMENTS.md and a numeric
// share, the way it holds every submit check to a why.
//
// The shares are the maintainer's review findings by class in a fixed
// 30-issue sample, one reader's classification, dated 2026-09-12
// (docs/evidence/inspect/2026-09-12-review-classes.json). They say how
// often reviewers raised a class, never how likely this plugin is to be
// blocked, and nothing here turns a share into a verdict.
//
// Nothing here restates a marketplace rule (AGENTS.md, rule 2). The
// `supply-chain` pattern detects nothing itself: it cites the findings the
// pinned baseline recorded and does not list as selectively blocking, which
// at the current pin are its three unpinned-remote-source rules, read
// through verify and the pinned policy rather than named here.

import { basename, blankComments, blocks, lineOf, propertyValue } from "./text.mjs"
import { toolOf } from "./processes.mjs"

const SAMPLE = "30-issue sample"
const site = (row) => ({ file: row.file, line: row.line })
const sites = (rows) => rows.map((row) => `${row.file}:${row.line}`).join(", ")
const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`

/** A short flag, alone or inside a cluster: `-q`, `-fsq`; or its long form. */
function hasFlag(flags, letter, long = null) {
  return flags.some((flag) => flag === `-${letter}` || (long && (flag === long || flag.startsWith(`${long}=`))) || (/^-[A-Za-z]+$/.test(flag) && flag.includes(letter)))
}

/**
 * The tool a process resolves through PATH: its first non-wrapper word
 * when that word is a literal with no slash. A word that is an expression
 * (`[script, name]`, `[root.helperPath("x.sh")]`) is not a name looked up
 * in PATH; it is a value the text does not show, and the argument-grammar
 * class already names the site. Measured on the Theme Manager port
 * (2026-09-17): 12 of its 24 Run sites read as "resolved from PATH" with
 * the tool `script`, an absolute path at run time.
 */
function pathResolved(process) {
  if (!Array.isArray(process.argv) || !process.argv.length) return null
  const { tool, index } = toolOf(process.argv)
  if (!tool || tool.includes("/")) return null
  if ((process.expressions || []).some((entry) => entry.index === index)) return null
  return tool
}

const SECRET = /authorization|bearer|token=|api[_-]?key|password|secret=/i
const PRIVILEGED = new Set(["sudo", "pkexec", "doas", "docker"])

/**
 * `Text` blocks whose `text:` binds to a collector's `.text` and whose
 * `textFormat` is not `Text.PlainText`, over the QML files.
 */
function richTextSinks(files) {
  const found = []
  for (const file of files.filter((entry) => entry.kind === "qml")) {
    const text = blankComments(file.text)
    const collectors = [...blocks(text, "StdioCollector"), ...blocks(text, "SplitParser")].map((block) => block.id).filter(Boolean)
    if (!collectors.length) continue
    for (const block of [...blocks(text, "Text"), ...blocks(text, "Label"), ...blocks(text, "TextEdit")]) {
      const bound = propertyValue(block.body, "text")
      if (!bound || !collectors.some((id) => new RegExp(`(?<![\\w.])${id}\\.(?:text|data)\\b`).test(bound.text))) continue
      const format = propertyValue(block.body, "textFormat")?.text
      if (format === "Text.PlainText") continue
      found.push({ file: file.path, line: lineOf(text, block.open + 1 + bound.offset) })
    }
  }
  return found
}

/** `console.log(...)` and `console.warn(...)` lines whose argument text is secret-shaped, over QML and JavaScript. */
function secretLogs(files) {
  const found = []
  for (const file of files.filter((entry) => entry.kind === "qml" || entry.kind === "js")) {
    const text = blankComments(file.text)
    for (const match of text.matchAll(/console\.(?:log|warn|error|info|debug)\s*\(([^\n]*)/g)) {
      if (SECRET.test(match[1])) found.push({ file: file.path, line: lineOf(text, match.index) })
    }
  }
  return found
}

/**
 * The size thresholds: a function is listed as long when it is longer, more
 * branched or deeper than 90 of 100 functions in the 50 listed trees of
 * docs/evidence/inspect/2026-09-16-function-lengths.json (M12). The numbers
 * are that record's p90 quantiles and tests/unit/submit.test.mjs holds them
 * to it. Length is what the person asked for first, so the default view
 * lists long functions before the review classes and says that this order
 * is a preference and not a share.
 */
export const SIZE = Object.freeze({
  measurement: "M12",
  sample: "50 listed trees, 6034 functions",
  trees: 50,
  functions: 6034,
  lines: 25,
  branches: 6,
  depth: 2,
  // The histogram of each measure over the 6034 functions, value to count,
  // from which a function's percentile rank among listed functions is read;
  // and each listed tree's heavyShare, the share of its function lines in
  // functions over the thresholds, in the record's row order and only for
  // the trees with a function (a tree with nothing to measure has no
  // share), from which a tree's position among listed trees is read.
  distribution: Object.freeze({
    lines: Object.freeze({ 1: 330, 2: 157, 3: 667, 4: 620, 5: 584, 6: 508, 7: 413, 8: 337, 9: 301, 10: 238, 11: 195, 12: 138, 13: 152, 14: 131, 15: 106, 16: 75, 17: 86, 18: 62, 19: 71, 20: 57, 21: 51, 22: 56, 23: 47, 24: 44, 25: 33, 26: 28, 27: 24, 28: 26, 29: 27, 30: 17, 31: 21, 32: 22, 33: 18, 34: 23, 35: 11, 36: 5, 37: 16, 38: 13, 39: 13, 40: 9, 41: 13, 42: 12, 43: 11, 44: 9, 45: 8, 46: 14, 47: 8, 48: 11, 49: 7, 50: 6, 51: 1, 52: 2, 53: 6, 54: 3, 55: 7, 56: 4, 57: 3, 58: 5, 59: 3, 60: 8, 61: 5, 62: 3, 63: 6, 64: 2, 65: 3, 66: 1, 67: 3, 68: 4, 69: 9, 70: 7, 71: 7, 72: 3, 73: 3, 74: 3, 75: 1, 76: 1, 77: 2, 78: 2, 79: 3, 80: 3, 81: 4, 82: 3, 83: 1, 85: 1, 86: 3, 87: 3, 88: 1, 89: 1, 90: 3, 91: 2, 92: 2, 93: 2, 94: 1, 96: 3, 97: 2, 98: 1, 99: 1, 100: 1, 101: 3, 102: 2, 104: 2, 107: 2, 108: 1, 109: 2, 110: 2, 111: 2, 112: 2, 113: 2, 115: 3, 116: 1, 117: 2, 119: 1, 120: 1, 121: 1, 125: 1, 126: 1, 128: 2, 129: 1, 133: 1, 134: 1, 142: 1, 144: 1, 145: 1, 154: 1, 155: 1, 161: 2, 173: 1, 217: 2, 253: 1, 272: 1, 277: 1, 290: 1, 292: 1, 298: 1, 325: 1, 365: 1, 495: 1 }),
    branches: Object.freeze({ 0: 2302, 1: 1130, 2: 828, 3: 457, 4: 344, 5: 221, 6: 180, 7: 127, 8: 83, 9: 70, 10: 48, 11: 48, 12: 24, 13: 30, 14: 20, 15: 10, 16: 14, 17: 10, 18: 12, 19: 8, 20: 6, 21: 4, 22: 5, 23: 5, 24: 7, 25: 4, 26: 2, 27: 7, 28: 5, 29: 2, 31: 1, 32: 2, 33: 2, 35: 1, 36: 3, 38: 1, 39: 1, 40: 1, 41: 1, 43: 1, 45: 2, 55: 1, 64: 1, 75: 1, 78: 1, 85: 1 }),
    depth: Object.freeze({ 0: 3854, 1: 1478, 2: 482, 3: 140, 4: 47, 5: 27, 6: 5, 7: 1 }),
    heavyShare: Object.freeze([0.421, 0.3361, 0.4049, 0, 0.2979, 0.3647, 0.4107, 0.6167, 0.2635, 0.8434, 0, 0, 0.193, 0.6399, 0.4063, 0.4769, 0.4322, 0.5337, 0.3628, 0.6626, 0.0554, 0.7775, 0.3548, 0.3285, 0, 0.6801, 0.2222, 0.3084, 0.3705, 0.6468, 0.3928, 0.6786, 0.3247, 0.5225, 0, 0.1462, 0, 0.5817, 0.5891, 0.3835, 0.2491, 0.5627, 0.2439, 0.3643, 0.6719, 0.6525, 0.4385, 0.565, 0.5672]),
  }),
})


/**
 * Where a value sits among the sample's: the share of listed functions
 * with a smaller value, as a percentage, so the smallest listed value ranks
 * 0 and a value over every listed one ranks 100. A function's rank is the
 * largest of its three, since one long measure is what a reader sees.
 */
export function percentile(measure, value) {
  const histogram = SIZE.distribution[measure]
  let below = 0
  for (const [key, count] of Object.entries(histogram)) if (Number(key) < value) below += count
  return Math.round((below / SIZE.functions) * 1000) / 10
}

export function rankOf(entry) {
  return Math.max(percentile("lines", entry.lines), percentile("branches", entry.branches), percentile("depth", entry.depth))
}

/**
 * The share of a tree's function lines that sit in functions over any of
 * the M12 thresholds: lines inside `overSize` functions over lines inside
 * every function, 0 with no function. Line-weighted on purpose: splitting
 * one long function into short ones moves its lines out of the heavy set,
 * and padding a tree with small functions barely moves the ratio.
 */
export function heavyShare(functions) {
  const total = functions.reduce((sum, entry) => sum + entry.lines, 0)
  if (!total) return 0
  const heavy = overSize(functions).reduce((sum, entry) => sum + entry.lines, 0)
  return heavy / total
}

/**
 * The share of listed trees whose heavyShare is strictly smaller than this
 * one, as a percentage over the listed trees that have a share: 0 for a
 * tree with no function over the thresholds, 100 for one heavier than
 * every listed tree.
 */
export function treeRank(share) {
  const shares = SIZE.distribution.heavyShare
  const below = shares.filter((listed) => listed < share).length
  return Math.round((below / shares.length) * 1000) / 10
}

/**
 * The size score of a tree: 10 minus its rank among the listed trees
 * divided by 10, on 0 to 10 with two decimals. A tree with no function
 * over the thresholds scores 10.00, a tree heavier than every listed tree
 * 0.00. It says where the tree sits among listed plugins by how much of
 * its function text is in long functions, never whether it is good, and a
 * tree with no function has no score.
 */
export function sizeScore(functions) {
  if (!functions.length) return null
  return Math.round((10 - treeRank(heavyShare(functions)) / 10) * 100) / 100
}

/** The functions over any of the thresholds, longest first, then most branched. */
export function overSize(functions) {
  return functions
    .filter((entry) => entry.lines > SIZE.lines || entry.branches > SIZE.branches || entry.depth > SIZE.depth)
    .sort((a, b) => b.lines - a.lines || b.branches - a.branches || b.depth - a.depth || a.file.localeCompare(b.file) || a.line - b.line)
}

export const PATTERNS = Object.freeze([
  {
    id: "process-lifecycle",
    label: "process lifecycle",
    notObserved: "no process without a deadline",
    measurement: "M11",
    share: 0.20,
    sample: SAMPLE,
    precondition: ({ processes }) => {
      const rows = processes.filter((row) => row.declaredIn === "qml" && !row.detached && !row.deadline.observed)
      return { sites: rows.map(site), observation: `observed ${plural(rows.length, "process", "processes")} with no deadline (${sites(rows)})` }
    },
  },
  {
    id: "unbounded-buffering",
    label: "unbounded buffering",
    notObserved: "no collector without a cap",
    measurement: "M11",
    share: 0.19,
    sample: SAMPLE,
    precondition: ({ processes }) => {
      const rows = processes.filter((row) => (row.output.collector === "StdioCollector" || row.output.collector === "SplitParser") && !row.output.capObserved)
      return { sites: rows.map(site), observation: `observed ${plural(rows.length, "collector")} with no cap (${sites(rows)})` }
    },
  },
  {
    id: "file-and-state-boundary",
    label: "file and state boundary",
    notObserved: "no write outside a controlled directory",
    measurement: "M11",
    share: 0.15,
    sample: SAMPLE,
    precondition: ({ writes }) => {
      const outside = writes.filter((row) => row.controlledDirectory === "not-observed" && row.via !== "mktemp")
      const unmoded = writes.filter((row) => row.via === "mkdir" && row.mode === null)
      const parts = []
      if (outside.length) parts.push(`${plural(outside.length, "write")} outside a controlled directory (${sites(outside)})`)
      if (unmoded.length) parts.push(`${plural(unmoded.length, "mkdir")} with no mode (${sites(unmoded)})`)
      return { sites: [...outside, ...unmoded].map(site), observation: `observed ${parts.join("; ")}` }
    },
  },
  {
    id: "environment-trust",
    label: "environment trust",
    notObserved: "no tool resolved from PATH, no curl without -q",
    measurement: "M11",
    share: 0.07,
    sample: SAMPLE,
    precondition: ({ processes, hosts }) => {
      // A line of a helper started through Run resolves its tools in the
      // block's closed PATH (docs/BLOCKS.md); it is counted apart, never as
      // an ambient lookup.
      const ambient = processes.filter((row) => !row.closedEnvironment)
      const resolved = ambient.map((row) => ({ row, tool: pathResolved(row) })).filter((entry) => entry.tool)
      const closed = processes.filter((row) => row.closedEnvironment && pathResolved(row))
      const curls = hosts.filter((row) => row.tool === "curl" && !hasFlag(row.flags, "q", "--disable"))
      const parts = []
      const names = [...new Set(resolved.map((entry) => entry.tool))]
      const named = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ")
      if (resolved.length) parts.push(`${plural(resolved.length, "tool")} resolved from PATH (${named}; ${sites(resolved.map((entry) => entry.row))})`)
      if (curls.length) parts.push(`curl without -q (${sites(curls)})`)
      if (closed.length) parts.push(`${plural(closed.length, "tool name")} in ${plural(new Set(closed.map((row) => row.file)).size, "helper")} started through Run, resolved in the block's closed PATH and not counted`)
      return { sites: [...resolved.map((entry) => entry.row), ...curls].map(site), observation: `observed ${parts.join("; ")}` }
    },
  },
  {
    id: "secrets",
    label: "secrets",
    notObserved: "no secret-shaped argv or log line",
    measurement: "M11",
    share: 0.07,
    sample: SAMPLE,
    precondition: ({ processes, files }) => {
      const argv = processes.filter((row) => Array.isArray(row.argv) && row.argv.some((word) => SECRET.test(word)))
      const copies = processes.filter((row) => Array.isArray(row.argv) && basename(toolOf(row.argv).tool || "") === "wl-copy" && row.expressions.length > 0)
      const logs = secretLogs(files)
      const parts = []
      if (argv.length) parts.push(`secret-shaped argv (${sites(argv)})`)
      if (logs.length) parts.push(`secret-shaped log line (${sites(logs)})`)
      if (copies.length) parts.push(`wl-copy with a computed value (${sites(copies)})`)
      return { sites: [...argv, ...logs, ...copies].map(site), observation: `observed ${parts.join("; ")}` }
    },
  },
  {
    id: "supply-chain",
    label: "supply chain",
    notObserved: "no unpinned remote source in the baseline",
    measurement: "M11",
    also: ["M4"],
    share: 0.07,
    sample: SAMPLE,
    precondition: ({ baseline, blockingRules }) => {
      const findings = (baseline?.official?.findings || []).filter((finding) => !blockingRules.includes(finding.ruleId))
      const evidence = findings.flatMap((finding) => (finding.evidence || []).map((entry) => ({ file: entry.path, line: entry.line })))
      return {
        sites: evidence,
        observation: `observed ${plural(findings.length, "baseline finding")} the pin does not block on (${findings.map((finding) => finding.ruleId).join(", ")}; ${sites(evidence)})`,
      }
    },
  },
  {
    id: "network-egress",
    label: "network egress",
    notObserved: "no http scheme, no -L without --proto, no private address",
    measurement: "M11",
    share: 0.05,
    sample: SAMPLE,
    precondition: ({ hosts }) => {
      const plain = hosts.filter((row) => row.scheme === "http")
      const redirects = hosts.filter((row) => row.tool === "curl" && hasFlag(row.flags, "L", "--location") && !row.flags.some((flag) => flag.startsWith("--proto")))
      const local = hosts.filter((row) => row.privateAddress)
      const parts = []
      if (plain.length) parts.push(`http scheme (${sites(plain)})`)
      if (redirects.length) parts.push(`curl -L without --proto (${sites(redirects)})`)
      if (local.length) parts.push(`private or loopback address (${sites(local)})`)
      return { sites: [...plain, ...redirects, ...local].map(site), observation: `observed ${parts.join("; ")}` }
    },
  },
  {
    id: "untrusted-text-to-display",
    label: "untrusted text to display",
    notObserved: "no Text bound to output without Text.PlainText",
    measurement: "M11",
    share: 0.05,
    sample: SAMPLE,
    precondition: ({ files }) => {
      const found = richTextSinks(files)
      return { sites: found, observation: `observed ${plural(found.length, "Text")} bound to a collector's output without Text.PlainText (${sites(found)})` }
    },
  },
  {
    id: "argument-grammar",
    label: "argument grammar",
    notObserved: "no expression inside an argv element",
    measurement: "M11",
    share: 0.04,
    sample: SAMPLE,
    precondition: ({ processes }) => {
      const rows = processes.filter((row) => row.expressions.length > 0)
      return { sites: rows.map(site), observation: `observed ${plural(rows.length, "argv")} with a computed element (${sites(rows)})` }
    },
  },
  {
    id: "privilege-disclosure",
    label: "privilege disclosure",
    notObserved: "no sudo, pkexec, docker or /dev/input in argv",
    measurement: "M11",
    also: ["M4"],
    share: 0.03,
    sample: SAMPLE,
    precondition: ({ processes, readme }) => {
      const found = []
      for (const row of processes) {
        if (!Array.isArray(row.argv)) continue
        const names = [...new Set(row.argv.flatMap((word) => (PRIVILEGED.has(basename(word)) ? [basename(word)] : word.includes("/dev/input") ? ["/dev/input"] : [])))]
        if (names.length) found.push({ row, names })
      }
      const names = [...new Set(found.flatMap((entry) => entry.names))]
      const named = names.filter((name) => readme && new RegExp(name.replace(/[/]/g, "\\/"), "i").test(readme))
      const readmeNote = readme === null ? "no README to name it" : named.length === names.length ? "named in the README: observed" : `named in the README: not observed for ${names.filter((name) => !named.includes(name)).join(", ")}`
      return { sites: found.map((entry) => site(entry.row)), observation: `observed ${names.join(", ")} in argv (${sites(found.map((entry) => entry.row))}); ${readmeNote}` }
    },
  },
])

/** The observation without its site lists and without the leading word, for a row whose sites are marked elsewhere. */
export function summaryOf(observation) {
  const SITE = "[\\w./-]+:\\d+"
  return observation
    .replace(new RegExp(`;\\s*${SITE}(?:, ${SITE})*(?=\\))`, "g"), "")
    .replace(new RegExp(`\\s*\\(${SITE}(?:, ${SITE})*\\)`, "g"), "")
    .replace(/^observed /, "")
}

/**
 * @param {{ processes, hosts, writes, timers, files, readme, baseline, blockingRules }} facts the observed facts of one document
 * @returns {{ patterns: Array, lookedFor: string[] }}
 */
export function evaluatePatterns(facts) {
  const patterns = []
  const lookedFor = []
  for (const pattern of PATTERNS) {
    const found = pattern.precondition(facts)
    if (found.sites.length) patterns.push({ id: pattern.id, observedCount: found.sites.length, sites: found.sites, observation: found.observation, summary: summaryOf(found.observation), measurement: pattern.measurement, share: pattern.share })
    else lookedFor.push(pattern.id)
  }
  return { patterns, lookedFor }
}
