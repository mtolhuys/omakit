// The report for a person, drawn only with the shared vocabulary of
// style.mjs: `░ info` for a fact, `▒ ?` for a fact the extraction could
// not read, `▓ note` for a pattern row, `▔ skip` for the baseline under
// --offline, and the one closing word INSPECTED. It never draws `▁ ok` or
// `█ FAIL`, because it has no verdict to attach them to. Every section
// line says what was observed, and a section with nothing in it says
// "observed nothing of this kind", never "clean".
//
// Two views of one document. The default is for a person: a summary block,
// one line per fact with the command as a command line rather than a JSON
// array, a second line only where something is absent (no deadline, no cap,
// no timeout, a write outside a controlled directory), the shell lines of
// a script grouped under the script with the tools they run, the pattern
// rows with their first few sites, and short closing lines. Measured before
// this: a listed tree with four shell scripts printed 372 process rows of
// two lines each, and the two pattern rows a reviewer would act on sat
// under 750 lines of argv. `--full` is the exhaustive view, every site with
// every qualifier and the whole not observed and not visible lists; `--json`
// is the document itself, which carries everything either view shows.

import { colourEnabled, field, GUTTER, INSPECT_VERDICT, mark, outputColumns, styler, verdict, wrap } from "../marketplace/style.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"
import { PATTERNS } from "./patterns.mjs"
import { toolOf } from "./processes.mjs"

const NOTHING = "observed nothing of this kind"

const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`
const site = (row) => `${row.file}:${row.line}`

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

/** A shell word for the eye: quoted only when it holds a space or a quote, an expression element as its source text. */
function commandLine(process) {
  const computed = new Set(process.expressions.map((entry) => entry.index))
  return process.argv.map((word, index) => (computed.has(index) || !/[\s"'`]/.test(word) ? word : JSON.stringify(word))).join(" ")
}

/**
 * Directories a person reads separately: tests, fixtures, documentation
 * and lab scripts are in the tree and are counted, but they are not what
 * runs on the desktop.
 */
const AUXILIARY = /^(tests?|specs?|docs?|examples?|fixtures?|lab)\//

/**
 * A table row: a mark, the first cell padded to the column, the main cell,
 * and the status cell on the same line when it fits and under the gutter
 * when it does not. The mark is `▓ note` for a row a review class cites,
 * so the eye finds the rows the reviewer would, and `░ info` otherwise.
 */
function cells(state, first, main, status, width, c, mainWidth = 0) {
  const head = `${mark(state, c)}${c("name", first.padEnd(width))}  `
  const room = outputColumns() - GUTTER - width - 2
  const tail = status ? `  ${status}` : ""
  const padded = mainWidth && mainWidth + tail.length <= room ? main.padEnd(mainWidth) : main
  if (padded.length + tail.length <= room) return [`${head}${padded}${status ? `  ${c("label", status)}` : ""}`]
  const lines = wrap(main, { indent: GUTTER, first: GUTTER + width + 2 }, c)
  const out = [`${head}${lines[0].trimStart()}`, ...lines.slice(1)]
  if (status) out.push(...wrap(status, { indent: GUTTER }).map((line) => c("label", line)))
  return out
}

/** The sites every review class cites, so a fact row can be marked as one a reviewer would raise. */
function citedSites(document) {
  return new Set(document.patterns.flatMap((entry) => entry.sites.map((entry_) => `${entry_.file}:${entry_.line}`)))
}

function processStatus(process) {
  const absent = []
  if (process.argvForm === "computed") return "not resolvable"
  if (process.expressions.length) absent.push(`${plural(process.expressions.length, "computed element")}`)
  if (process.shellWrapper) absent.push("shell wrapper")
  if (process.detached) absent.push("detached")
  else if (process.declaredIn === "qml") {
    if (!process.deadline.observed) absent.push("no deadline")
    if (process.output.collector !== "none" && !process.output.capObserved) absent.push("no cap")
  }
  return absent.join(", ")
}

function hostStatus(host) {
  const absent = []
  if (host.scheme === "http") absent.push("http")
  if (host.privateAddress) absent.push("private address")
  if (!host.timeout.observed) absent.push("no timeout")
  if (!host.sizeCap.observed) absent.push("no size cap")
  if (host.tool === "curl" && !host.flags.includes("-q")) absent.push("no -q")
  return absent.join(", ")
}

function writeStatus(write) {
  if (write.controlledDirectory === "observed") return `under ${write.controlledBy}`
  if (write.controlledDirectory === "not-observed") return write.temp ? `shared ${write.canonicalPath.split("/").slice(0, 2).join("/")}` : "outside a controlled directory"
  return "path from a variable"
}

function timerText(timer) {
  if (timer.intervalMs === null) return `interval ${timer.intervalText ?? "not declared"}, not resolvable`
  const parts = [`${timer.intervalMs} ms`, timer.repeat === true ? "repeat" : timer.repeat === false ? "once" : "repeat bound to an expression"]
  if (timer.running === true) parts.push("running")
  if (timer.triggeredOnStart === true) parts.push("triggeredOnStart")
  if (timer.startedBy) parts.push(`started by ${timer.startedBy}`)
  return parts.join(", ")
}

/** The shell scripts counted by top-level directory: `scripts/ 5, bin/ 2, tests/ 23`. */
function scriptsByDirectory(processes) {
  const byDirectory = new Map()
  for (const file of new Set(processes.filter((entry) => entry.declaredIn === "shell").map((entry) => entry.file))) {
    const directory = file.includes("/") ? `${file.split("/")[0]}/` : ""
    byDirectory.set(directory, (byDirectory.get(directory) || 0) + 1)
  }
  return [...byDirectory.entries()].map(([directory, count]) => (directory ? `${directory} ${count}` : `${count} at the root`)).join(", ")
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
 *   exhaustive view behind `--full`; the default is the one a person reads.
 * @returns {string}
 */
export function renderInspect(document, { colour = colourEnabled(), full = false } = {}) {
  if (full) return renderFull(document, { colour })
  const c = styler(colour)
  const out = []
  const read = document.subject.filesRead
  const kinds = Object.entries(read).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`)
  const total = Object.values(read).reduce((sum, count) => sum + count, 0)
  const counts = document.counts
  const cited = citedSites(document)
  const state = (row_) => (cited.has(site(row_)) ? "advisory" : "info")
  // A cited row whose own cells show nothing absent names the classes that cite it.
  const classesCiting = (row_) => document.patterns
    .filter((entry) => entry.sites.some((entry_) => `${entry_.file}:${entry_.line}` === site(row_)))
    .map((entry) => PATTERNS.find((pattern) => pattern.id === entry.id)?.label || entry.id).join(", ")
  const status = (row_, own) => own || (cited.has(site(row_)) ? classesCiting(row_) : "")
  out.push(...field("subject", `${withHomeAbbreviated(document.subject.dir)} at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "no commit"}, ${plural(total, "file")}${kinds.length ? ` (${kinds.join(", ")})` : ""}`, c))
  out.push(...field("baseline", baselineText(document.marketplaceBaseline), c))
  out.push("")

  // Processes: every QML site as a row, the shell scripts as one counted line.
  const qml = document.observed.processes.filter((entry) => entry.declaredIn === "qml")
  const shell = counts.processes.shell
  const scripts = new Set(document.observed.processes.filter((entry) => entry.declaredIn === "shell").map((entry) => entry.file)).size
  const heading = qml.length || shell
    ? [qml.length ? `${plural(qml.length, "process", "processes")} in qml` : "no process in qml", shell ? `${plural(shell, "shell line")} in ${plural(scripts, "script")} (${scriptsByDirectory(document.observed.processes)})` : null].filter(Boolean).join("; ")
    : NOTHING
  out.push(...field("processes", heading, c))
  const width = Math.max(0, ...qml.map((entry) => site(entry).length))
  for (const entry of qml) {
    const main = entry.argvForm === "computed" ? `command: ${entry.commandText}` : commandLine(entry) || "[] (an empty argv)"
    out.push(...cells(entry.argvForm === "computed" ? "unknown" : state(entry), site(entry), main, status(entry, processStatus(entry)), width, c))
  }
  out.push("")

  // Hosts: every literal, with what is absent beside it.
  out.push(...field("hosts", document.observed.hosts.length ? `${document.observed.hosts.length}` : NOTHING, c))
  const hostWidth = Math.max(0, ...document.observed.hosts.map((entry) => entry.host.length))
  for (const entry of document.observed.hosts) {
    out.push(...cells(state(entry), entry.host, `${entry.scheme}${entry.tool ? ` via ${entry.tool}` : ""}, ${site(entry)}`, status(entry, hostStatus(entry)), hostWidth, c))
  }
  out.push("")

  // Writes: every literal path as a row, the variable paths as one counted line.
  const literal = document.observed.writes.filter((entry) => entry.controlledDirectory !== "unknown" && !AUXILIARY.test(entry.file))
  const rest = document.observed.writes.length - literal.length
  const under = document.observed.writes.filter((entry) => entry.controlledDirectory === "observed").length
  const outside = document.observed.writes.filter((entry) => entry.controlledDirectory === "not-observed").length
  const variable = document.observed.writes.length - under - outside
  const summary = [under ? `${under} under a controlled directory` : null, outside ? `${outside} outside one` : null, variable ? `${variable} to paths from variables` : null].filter(Boolean).join(", ")
  out.push(...field("writes", document.observed.writes.length ? `${document.observed.writes.length}${summary ? `: ${summary}` : ""}` : NOTHING, c))
  const writeWidth = Math.max(0, ...literal.map((entry) => site(entry).length))
  for (const entry of literal) out.push(...cells(state(entry), site(entry), `${entry.via} ${entry.canonicalPath ?? entry.path}`, status(entry, writeStatus(entry)), writeWidth, c))
  if (rest) out.push(...wrap(`${rest} not listed: paths from variables, or under a tests directory; --full lists them`, { indent: GUTTER }, c).map((line) => c("label", line)))
  out.push("")

  // Timers: every block as a row.
  out.push(...field("timers", document.observed.timers.length ? `${document.observed.timers.length}` : NOTHING, c))
  const timerWidth = Math.max(0, ...document.observed.timers.map((entry) => site(entry).length))
  for (const entry of document.observed.timers) out.push(...cells(entry.intervalMs === null ? "unknown" : "info", site(entry), timerText(entry), "", timerWidth, c))
  out.push("")

  // The review table: class, share, what this tree shows; the sites are the marked rows above.
  if (PATTERNS.length) {
    out.push(...field("review", document.patterns.length
      ? `${document.patterns.length} of the ${PATTERNS.length} classes the marketplace's human review raised (${PATTERNS[0].measurement}, a ${PATTERNS[0].sample}); the marked rows above are the sites`
      : `none of the ${PATTERNS.length} classes the marketplace's human review raised shows here (${PATTERNS[0].measurement})`, c))
    const labelWidth = Math.max(...PATTERNS.map((pattern) => pattern.label.length))
    // The share column aligns across the rows whose summary fits on one line.
    const room = outputColumns() - GUTTER - labelWidth - 2 - "  20 of 100".length
    const summaryWidth = Math.max(0, ...document.patterns.map((entry) => entry.summary.length).filter((length) => length <= room))
    for (const entry of document.patterns) {
      const pattern = PATTERNS.find((candidate) => candidate.id === entry.id)
      out.push(...cells("advisory", pattern.label, entry.summary, `${String(Math.round(entry.share * 100)).padStart(2)} of 100`, labelWidth, c, summaryWidth))
    }
    out.push("")
  }
  out.push(...field("not visible", "run-time commands, values from variables or config, components outside the tree", c))
  out.push("")
  const processes = `${plural(counts.processes.total, "process", "processes")}${counts.processes.total ? ` (${split(counts.processes)})` : ""}`
  out.push(...verdict("info", INSPECT_VERDICT, `${processes}, ${plural(counts.hosts, "host")}, ${plural(counts.writes, "write")}, ${plural(counts.timers, "timer")}; static; --full for every site, --json for the document`, c))
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
