// The report for a person, drawn only with the shared vocabulary of
// style.mjs: `░ info` for a fact, `▒ ?` for a fact the extraction could
// not read, `▓ note` for a pattern row, `▔ skip` for the baseline under
// --offline, and the one closing word INSPECTED. It never draws `▁ ok` or
// `█ FAIL`, because it has no verdict to attach them to. Every section
// line says what was observed, and a section with nothing in it says
// "observed nothing of this kind", never "clean".
//
// Two views of one document. The default is what needs attention, biggest
// first: one block per review class this tree shows, ordered by the
// class's share of review findings in the M11 sample, which is the one
// measured number that says how much reviewers care; under each, up to
// five sites with the fact at each in one line; classes under five percent
// counted on one line. Measured before this: a listed tree with four shell
// scripts printed 372 process rows of two lines each, and the two rows a
// reviewer would act on sat under 750 lines of argv. `--full` is the
// exhaustive view, every site of every kind with every qualifier; `--json`
// is the document itself, which carries everything either view shows.

import { colourEnabled, field, GUTTER, INSPECT_VERDICT, mark, outputColumns, styler, verdict, wrap } from "../marketplace/style.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"
import { PATTERNS, SIZE } from "./patterns.mjs"
import { toolOf } from "./processes.mjs"

const NOTHING = "observed nothing of this kind"

const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`
const site = (row) => `${row.file}:${row.line}`

/** A share as a whole percentage; one that would round to 0 or 100 says so instead of rounding past the truth. */
function percent(share) {
  const rounded = Math.round(share * 100)
  if (share > 0 && rounded === 0) return "under 1%"
  if (share < 1 && rounded === 100) return "over 99%"
  return `${rounded}%`
}

/**
 * The score sentence after the number: the share, then the position among
 * the listed trees the document itself carries. The rank counts the listed
 * trees with a strictly smaller share, so the tree is "no heavier than"
 * the rest: a tie is level, not lighter.
 */
function scoreText(size) {
  const shares = size.sample.heavyShares
  if (!shares.length) return `${percent(size.heavyShare)} of its function lines sit in functions over the measured size; no listed tree to place it among (${size.measurement})`
  const lighter = shares.filter((share) => share < size.heavyShare).length
  return `${percent(size.heavyShare)} of its function lines sit in functions over the measured size, no heavier than ${shares.length - lighter} of ${shares.length} listed trees (${size.measurement})`
}

/** Under --allow-dirty: what the checkout holds that the tree at the commit does not. */
function uncommittedLine(document, c) {
  const count = document.subject.uncommittedFiles
  if (!count) return []
  return field("uncommitted", `${plural(count, "file")} differ${count === 1 ? "s" : ""} from HEAD and ${count === 1 ? "was" : "were"} not inspected; the tree at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "the commit"} is what was read`, c)
}

/** A row: a mark, the site in bold, then the text, wrapped under the gutter. */
function row(state, head, text, c, extra = []) {
  const lines = wrap(text || "(nothing)", { indent: GUTTER, first: GUTTER + head.length + 2 }, c)
  const out = [`${mark(state, c)}${c("name", head)}  ${lines[0].trimStart()}`, ...lines.slice(1)]
  for (const line of extra) out.push(...wrap(line, { indent: GUTTER }, c))
  return out
}

function processRow(process, c) {
  if (process.argvForm === "computed") {
    return row("unknown", site(process), `command: ${process.commandText}`, c, ["argv not resolvable statically"])
  }
  const notes = []
  notes.push(`argv ${process.argvForm}${process.declaredIn === "shell" ? " (shell line)" : ""}${process.detached ? ", detached" : ""}`)
  if (process.expressions.length) notes.push(`${plural(process.expressions.length, "element")} computed (${process.expressions.map((entry) => entry.text).join(", ")})`)
  if (process.shellWrapper) notes.push("shell wrapper, the script inside is not followed")
  if (process.pipedFrom) notes.push(`piped from ${process.pipedFrom.argv0} on line ${process.pipedFrom.line}`)
  if (process.declaredIn === "qml" && !process.detached) {
    const deadline = process.deadline
    notes.push(deadline.observed
      ? `deadline observed (${deadline.via}${deadline.ms !== null ? ` ${deadline.ms} ms` : ""})`
      : "no deadline observed")
    const output = process.output
    if (output.collector === "none") notes.push("no collector")
    else notes.push(`output through ${output.collector}, ${output.capObserved ? `cap observed (${output.via})` : "no cap observed"}`)
  } else if (process.deadline.observed) notes.push(`deadline observed (${process.deadline.via}${process.deadline.ms !== null ? ` ${process.deadline.ms} ms` : ""})`)
  return row("info", site(process), argvText(process), c, [notes.join("; ")])
}

/** The argv as a list: literals quoted, a computed element as the source text it was read from. */
function argvText(process) {
  const computed = new Set(process.expressions.map((entry) => entry.index))
  return `[${process.argv.map((word, index) => (computed.has(index) ? word : JSON.stringify(word))).join(", ")}]`
}

function hostRow(host, c) {
  const via = host.tool ? `via ${host.tool}` : "no tool observed on the line"
  const notes = [
    host.timeout.observed ? `timeout observed (${host.timeout.via})` : "no timeout observed",
    host.sizeCap.observed ? `size cap observed (${host.sizeCap.via})` : "no size cap observed",
  ]
  if (host.tool === "curl") {
    notes.push(host.flags.includes("-q") ? "-q observed" : "-q not observed")
    notes.push(host.flags.includes("-L") || host.flags.includes("--location") ? "-L observed" : "-L not observed")
  } else if (host.flags.length) notes.push(`flags ${host.flags.join(" ")}`)
  if (host.privateAddress) notes.push("private or loopback address")
  const lines = wrap(`${host.scheme}  ${site(host)} ${via}`, { indent: GUTTER, first: GUTTER + host.host.length + 2 }, c)
  return [`${mark("info", c)}${c("name", host.host)}  ${lines[0].trimStart()}`, ...lines.slice(1), ...wrap(notes.join("; "), { indent: GUTTER }, c)]
}

function writeRow(write, c) {
  const what = write.via === "FileView" ? `FileView path: ${write.path}` : `${write.via} ${write.path}`
  const where = write.controlledDirectory === "observed"
    ? `observed (${write.controlledBy})`
    : write.controlledDirectory === "not-observed"
      ? `not observed${write.temp ? ` (${write.canonicalPath.split("/").slice(0, 2).join("/")} is shared)` : ""}`
      : "unknown (path not readable as a literal prefix)"
  const notes = [`under a directory the plugin controls: ${where}`]
  if (write.mode) notes.push(`mode ${write.mode}`)
  return row("info", site(write), what, c, [notes.join("; ")])
}

function timerRow(timer, c) {
  if (timer.intervalMs === null) {
    return row("unknown", site(timer), `interval: ${timer.intervalText ?? "not declared"}`, c, ["interval not resolvable statically"])
  }
  const parts = [`interval ${timer.intervalMs} ms`]
  parts.push(timer.repeat === true ? "repeat" : timer.repeat === false ? "single shot" : "repeat bound to an expression")
  if (timer.running === true) parts.push("running")
  else if (timer.running === null) parts.push("running bound to an expression")
  if (timer.triggeredOnStart === true) parts.push("triggeredOnStart")
  if (timer.startedBy) parts.push(`started by ${timer.startedBy}`)
  else if (timer.running === false) parts.push("no start observed")
  return row("info", site(timer), parts.join(", "), c)
}

function baselineLines(section, c) {
  const out = []
  if (section.skipped) {
    out.push(...field("capabilities", "marketplace baseline not run", c))
    out.push(`${mark("skipped", c)}${wrap(`skipped (${section.reason})`, { indent: GUTTER }, c)[0].trimStart()}`)
    return out
  }
  out.push(...field("capabilities", `marketplace baseline at pin ${section.pin.commit.slice(0, 8)}, ${section.transport === "local-git" ? "local transport" : `transport ${section.transport}`}`, c))
  if (!section.invoked) {
    out.push(`${mark("unknown", c)}${wrap(`not run: ${section.skipReason}`, { indent: GUTTER }, c)[0].trimStart()}`)
    return out
  }
  const official = section.official
  if (official?.error) {
    out.push(...row("unknown", official.error.code, official.error.message, c))
    return out
  }
  const capabilities = official.capabilities || []
  const findings = official.findings || []
  const evidence = (entries) => entries.flatMap((entry) => entry.evidence || [])
  const files = (entries) => [...new Set(evidence(entries).map((entry) => entry.path))]
  if (capabilities.length) {
    const sites = evidence(capabilities)
    out.push(...wrap(`observed: ${capabilities.map((entry) => entry.id).join(", ")} (${plural(sites.length, "evidence site")}, ${files(capabilities).join(", ")})`, { indent: GUTTER, first: 0 }, c)
      .map((line, index) => (index === 0 ? `${mark("info", c)}${line}` : line)))
  } else {
    out.push(`${mark("info", c)}observed: no capability recorded`)
  }
  for (const finding of findings) {
    const sites = (finding.evidence || []).map((entry) => `${entry.path}:${entry.line}`)
    out.push(...wrap(`observed: finding ${finding.ruleId} (${sites.join(", ")})`, { indent: GUTTER, first: 0 }, c)
      .map((line, index) => (index === 0 ? `${mark("info", c)}${line}` : line)))
  }
  out.push(...wrap(`official result: ${official.outcome} (verbatim in --json under marketplaceBaseline)`, { indent: GUTTER }, c))
  return out
}

function patternLines(document, c) {
  if (!PATTERNS.length) return []
  const out = []
  const width = Math.max(...PATTERNS.map((pattern) => pattern.label.length)) + 1
  out.push(...field("patterns", document.patterns.length
    ? `of what the marketplace's human review raised, in a ${PATTERNS[0].sample} (${PATTERNS[0].measurement})`
    : `none of the ${PATTERNS.length} classes the marketplace's human review raised, in a ${PATTERNS[0].sample} (${PATTERNS[0].measurement}), shows its precondition here`, c))
  for (const entry of document.patterns) {
    const pattern = PATTERNS.find((candidate) => candidate.id === entry.id)
    const label = pattern.label.padEnd(width)
    const lines = wrap(entry.observation, { indent: GUTTER, first: GUTTER + label.length + 1 }, c)
    out.push(`${mark("advisory", c)}${c("name", label)} ${lines[0].trimStart()}`, ...lines.slice(1))
    out.push(...wrap(`about ${Math.round(entry.share * 100)} of every 100 review findings in the sample (${entry.measurement})`, { indent: GUTTER }, c))
  }
  out.push("")
  const lookedFor = document.lookedFor.map((id) => PATTERNS.find((pattern) => pattern.id === id)?.notObserved || id)
  out.push(...field("not observed", lookedFor.length ? lookedFor.join(", ") : "every pattern's precondition was observed", c))
  return out
}

/**
 * The default view: what needs attention, biggest first. One block per
 * review class this tree shows, ordered by the class's share of review
 * findings in the M11 sample, which is the one measured number that says
 * how much reviewers care; under each, the sites that show it, up to
 * SHOWN_SITES, with the fact at each site in one line. Classes under
 * MIN_SHARE are counted on one line and not listed. Nothing else is
 * printed: the counts of what was observed go in the closing line, and
 * `--full` has every site of every kind.
 */
const MIN_SHARE = 0.05
const SHOWN_SITES = 5

/** A shell word for the eye: quoted only when it holds a space or a quote, an expression element as its source text. */
function commandLine(process) {
  const computed = new Set(process.expressions.map((entry) => entry.index))
  return process.argv.map((word, index) => (computed.has(index) || !/[\s"'`]/.test(word) ? word : JSON.stringify(word))).join(" ")
}

/**
 * The fact at a site, in one line: the write there for the file class, the
 * host there for the egress class, otherwise the command, then the host,
 * then the write, whichever the site has.
 */
function factAt(document, at, patternId) {
  const same = (row) => `${row.file}:${row.line}` === at
  const process = () => {
    const row = document.observed.processes.find(same)
    return row ? (row.argvForm === "computed" ? `command: ${row.commandText}` : commandLine(row) || "[] (an empty argv)") : ""
  }
  const host = () => {
    const row = document.observed.hosts.find(same)
    return row ? `${row.scheme}://${row.host}${row.tool ? ` via ${row.tool}` : ""}` : ""
  }
  const write = () => {
    const row = document.observed.writes.find(same)
    return row ? `${row.via} ${row.canonicalPath ?? row.path}` : ""
  }
  const order = patternId === "file-and-state-boundary" ? [write, process, host] : patternId === "network-egress" ? [host, process, write] : [process, host, write]
  for (const fact of order) {
    const text = fact()
    if (text) return text
  }
  return ""
}

/** Text cut to a width with three dots, for a command a person only needs to recognise; --full has it whole. */
function cut(text, width) {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`
}

function baselineText(section) {
  if (section.skipped) return `skipped (${section.reason})`
  if (!section.invoked) return `not run: ${section.skipReason}`
  const official = section.official
  if (official?.error) return `the official code refused the snapshot: ${official.error.code}`
  const names = [...(official.capabilities || []).map((entry) => entry.id), ...(official.findings || []).map((entry) => entry.ruleId)]
  return `${official.outcome} at pin ${section.pin.commit.slice(0, 8)}${names.length ? `: ${names.join(", ")}` : ""}`
}

/**
 * @param {object} document the document of docs/INSPECT.md
 * @param {{ colour?: boolean, full?: boolean }} [options] `full` is the
 *   exhaustive view behind `--full`; the default is what needs attention,
 *   biggest first.
 * @returns {string}
 */
export function renderInspect(document, { colour = colourEnabled(), full = false } = {}) {
  if (full) return renderFull(document, { colour })
  const c = styler(colour)
  const out = []
  const counts = document.counts
  out.push(...field("subject", `${withHomeAbbreviated(document.subject.dir)} at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "no commit"}`, c))
  out.push(...uncommittedLine(document, c))
  out.push(...field("baseline", baselineText(document.marketplaceBaseline), c))
  const score = document.size.score
  out.push(...field("size score", score === null
    ? `none: no function to rank`
    : `${score.toFixed(2)} of 10; ${scoreText(document.size)}`, c))
  out.push("")

  const ranked = [...document.patterns].sort((a, b) => b.share - a.share)
  const shown = ranked.filter((entry) => entry.share >= MIN_SHARE)
  const below = ranked.filter((entry) => entry.share < MIN_SHARE)
  const width = outputColumns()
  const over = document.size.over
  if (!ranked.length && !over.length) {
    out.push(...field("attention", `nothing: no function over the size of ${SIZE.sample} (${SIZE.measurement}), and none of the ${PATTERNS.length} classes reviewers raise shows in this tree (${PATTERNS[0]?.measurement || "M11"})`, c))
  } else {
    const classes = shown.length
      ? `${plural(shown.length, "class", "classes")} reviewers raise, biggest first by share of review findings (${PATTERNS[0].measurement}); up to ${SHOWN_SITES} sites each`
      : below.length
        ? `only classes under ${Math.round(MIN_SHARE * 100)}% of review findings show (${PATTERNS[0].measurement}), counted below`
        : `none of the classes reviewers raise shows in this tree (${PATTERNS[0].measurement})`
    out.push(...field("attention", `${over.length ? `long functions first, by length${shown.length ? ", then " : "; "}` : ""}${classes}`, c))
  }
  // Long functions first: what the person asked about, so the order is a
  // preference and the heading says whose thresholds it uses.
  if (over.length) {
    out.push("")
    const thresholds = `${SIZE.lines} lines, ${SIZE.branches} branches or nesting ${SIZE.depth}`
    const heading = wrap(`${plural(over.length, "function")} over what 90 of 100 functions in ${SIZE.sample} stay under: ${thresholds} (${SIZE.measurement}); rank is the share of listed functions smaller than it`, { indent: GUTTER, first: GUTTER + "long functions".length + 2 }, c)
    out.push(`${mark("advisory", c)}${c("name", "long functions")}  ${heading[0].trimStart()}`, ...heading.slice(1))
    const top = over.slice(0, SHOWN_SITES)
    const siteWidth = Math.max(...top.map((entry) => `${entry.file}:${entry.line}`.length))
    const nameWidth = Math.max(...top.map((entry) => entry.name.length))
    for (const entry of top) {
      const at = `${entry.file}:${entry.line}`
      out.push(`${" ".repeat(GUTTER)}${c("name", at.padEnd(siteWidth))}  ${entry.name.padEnd(nameWidth)}  ${entry.lines} lines, ${entry.branches} branches, nesting ${entry.depth}, ${c("label", `rank ${Math.round(entry.percentile)}`)}`)
    }
    if (over.length > SHOWN_SITES) out.push(...wrap(`and ${over.length - SHOWN_SITES} more (--full)`, { indent: GUTTER }).map((line) => c("label", line)))
  }
  for (const entry of shown) {
    const pattern = PATTERNS.find((candidate) => candidate.id === entry.id)
    out.push("")
    const share = `${Math.round(entry.share * 100)} of 100 findings`
    const heading = wrap(entry.summary, { indent: GUTTER, first: GUTTER + pattern.label.length + 2 + share.length + 2 }, c)
    out.push(`${mark("advisory", c)}${c("name", pattern.label)}  ${c("label", share)}  ${heading[0].trimStart()}`, ...heading.slice(1))
    // A site cited twice by one class (curl from PATH and curl without -q) is one line.
    const sites = [...new Set(entry.sites.map((site_) => `${site_.file}:${site_.line}`))]
    const siteWidth = Math.max(...sites.slice(0, SHOWN_SITES).map((at) => at.length))
    for (const at of sites.slice(0, SHOWN_SITES)) {
      const fact = factAt(document, at, entry.id)
      const room = width - GUTTER - siteWidth - 2
      out.push(`${" ".repeat(GUTTER)}${c("name", at.padEnd(siteWidth))}${fact ? `  ${cut(fact, room)}` : ""}`)
    }
    if (sites.length > SHOWN_SITES) out.push(...wrap(`and ${sites.length - SHOWN_SITES} more (--full)`, { indent: GUTTER }).map((line) => c("label", line)))
  }
  if (below.length) {
    out.push("")
    out.push(...field(`under ${Math.round(MIN_SHARE * 100)}%`, below.map((entry) => `${PATTERNS.find((candidate) => candidate.id === entry.id)?.label || entry.id} (${plural(entry.observedCount, "site")})`).join(", "), c))
  }
  out.push("")
  const processes = `${plural(counts.processes.total, "process", "processes")}${counts.processes.total ? ` (${split(counts.processes)})` : ""}`
  out.push(...verdict("info", INSPECT_VERDICT, `${processes}, ${plural(counts.hosts, "host")}, ${plural(counts.writes, "write")}, ${plural(counts.timers, "timer")} observed; static; --full for every site, --json for the document`, c))
  return out.join("\n")
}

/** The exhaustive view: every site, every qualifier, the whole not observed and not visible lists. */
function renderFull(document, { colour }) {
  const c = styler(colour)
  const out = []
  const read = document.subject.filesRead
  const kinds = Object.entries(read).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`)
  const total = Object.values(read).reduce((sum, count) => sum + count, 0)
  out.push(...field("subject", `${withHomeAbbreviated(document.subject.dir)} at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "no commit"}, ${plural(total, "file")} read${kinds.length ? ` (${kinds.join(", ")})` : ""}`, c))
  out.push(...uncommittedLine(document, c))
  out.push(...field("method", document.method, c))
  out.push("")

  const sections = [
    ["processes", document.observed.processes, processRow],
    ["hosts", document.observed.hosts, hostRow],
    ["writes", document.observed.writes, writeRow],
    ["timers", document.observed.timers, timerRow],
  ]
  for (const [name, rows, render] of sections) {
    out.push(...field(name, rows.length ? `observed ${rows.length}${name === "processes" ? `, ${split(document.counts.processes)}` : ""}` : NOTHING, c))
    for (const entry of rows) out.push(...render(entry, c))
    out.push("")
  }
  const functions = document.observed.functions
  const over = document.size.over
  out.push(...field("functions", functions.length
    ? `observed ${functions.length}, ${over.length} over what 90 of 100 functions in ${SIZE.sample} stay under (${SIZE.lines} lines, ${SIZE.branches} branches or nesting ${SIZE.depth}; ${SIZE.measurement}), longest first`
    : NOTHING, c))
  for (const entry of over) out.push(...row("info", `${entry.file}:${entry.line}`, `${entry.name}, ${plural(entry.lines, "line")}, ${plural(entry.branches, "branch", "branches")}, nesting ${entry.depth}, over ${entry.percentile} of 100 listed`, c))
  if (functions.length) out.push(...wrap(`size score ${document.size.score.toFixed(2)} of 10: ${scoreText(document.size)}`, { indent: GUTTER }, c))
  out.push("")
  out.push(...baselineLines(document.marketplaceBaseline, c))
  out.push("")
  const patterns = patternLines(document, c)
  if (patterns.length) out.push(...patterns)
  out.push(...field("not visible", document.notVisible.join(", "), c))
  out.push("")
  const counts = document.counts
  const processes = `${plural(counts.processes.total, "process", "processes")}${counts.processes.total ? ` (${split(counts.processes)})` : ""}`
  out.push(...verdict("info", INSPECT_VERDICT, `${processes}, ${plural(counts.hosts, "host")}, ${plural(counts.writes, "write")}, ${plural(counts.timers, "timer")}; static, see docs/INSPECT.md`, c))
  return out.join("\n")
}

/** The process split in words: how many are QML Process sites and how many are shell lines. */
function split({ qml, shell }) {
  if (!shell) return qml === 1 ? "in qml" : "all in qml"
  if (!qml) return shell === 1 ? "a shell line" : "all shell lines"
  return `${qml} in qml, ${plural(shell, "shell line")}`
}
