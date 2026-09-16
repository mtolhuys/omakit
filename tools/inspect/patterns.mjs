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

/** The tool a process resolves through PATH: its first non-wrapper word when that word has no slash. */
function pathResolved(process) {
  if (!Array.isArray(process.argv) || !process.argv.length) return null
  const { tool } = toolOf(process.argv)
  if (!tool || tool.includes("/")) return null
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
 * branched or deeper than 90 of 100 functions in the 18 listed trees of
 * docs/evidence/inspect/2026-09-16-function-lengths.json (M12). The numbers
 * are that record's p90 quantiles and tests/unit/submit.test.mjs holds them
 * to it. Length is what the person asked for first, so the default view
 * lists long functions before the review classes and says that this order
 * is a preference and not a share.
 */
export const SIZE = Object.freeze({
  measurement: "M12",
  sample: "18 listed trees, 715 functions",
  functions: 715,
  lines: 18,
  branches: 7,
  depth: 2,
  // The histogram of each measure over the 715 functions, value to count,
  // from which a function's percentile rank among listed functions is read.
  distribution: Object.freeze({
    lines: Object.freeze({ 1: 58, 2: 10, 3: 94, 4: 92, 5: 97, 6: 58, 7: 43, 8: 41, 9: 34, 10: 25, 11: 19, 12: 13, 13: 22, 14: 9, 15: 8, 16: 5, 17: 9, 18: 8, 19: 2, 20: 5, 21: 3, 22: 5, 23: 7, 24: 5, 25: 1, 26: 2, 27: 1, 28: 1, 29: 4, 30: 5, 31: 1, 33: 1, 34: 2, 37: 1, 39: 2, 40: 2, 41: 1, 42: 3, 43: 1, 48: 1, 49: 1, 50: 2, 52: 1, 55: 1, 63: 1, 70: 1, 71: 1, 81: 2, 91: 1, 101: 1, 108: 1, 128: 1 }),
    branches: Object.freeze({ 0: 218, 1: 128, 2: 119, 3: 79, 4: 47, 5: 33, 6: 14, 7: 21, 8: 15, 9: 9, 10: 3, 11: 5, 12: 6, 13: 1, 14: 3, 15: 1, 17: 1, 18: 1, 19: 1, 20: 2, 22: 2, 23: 1, 24: 1, 25: 1, 27: 1, 29: 1, 31: 1 }),
    depth: Object.freeze({ 0: 435, 1: 167, 2: 65, 3: 25, 4: 8, 5: 5, 6: 7, 7: 2, 13: 1 }),
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
 * The size score of a tree: 10 minus the mean rank of its functions among
 * the 715 listed ones, on 0 to 10 with two decimals. A tree of median
 * functions scores 5.00; every function made shorter, flatter or less
 * branched raises it. It says where the tree sits among listed plugins,
 * never whether it is good, and a tree with no function has no score.
 */
export function sizeScore(functions) {
  if (!functions.length) return null
  const mean = functions.reduce((sum, entry) => sum + rankOf(entry), 0) / functions.length
  return Math.round((10 - mean / 10) * 100) / 100
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
      const resolved = processes.map((row) => ({ row, tool: pathResolved(row) })).filter((entry) => entry.tool)
      const curls = hosts.filter((row) => row.tool === "curl" && !hasFlag(row.flags, "q", "--disable"))
      const parts = []
      const names = [...new Set(resolved.map((entry) => entry.tool))]
      const named = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ")
      if (resolved.length) parts.push(`${plural(resolved.length, "tool")} resolved from PATH (${named}; ${sites(resolved.map((entry) => entry.row))})`)
      if (curls.length) parts.push(`curl without -q (${sites(curls)})`)
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
