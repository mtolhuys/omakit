// The report for a person, drawn only with the shared vocabulary of
// style.mjs: `░ info` for a fact, `▒ ?` for a fact the extraction could
// not read, `▓ note` for a pattern row, `▔ skip` for the baseline under
// --offline, and the one closing word INSPECTED. It never draws `▁ ok` or
// `█ FAIL`, because it has no verdict to attach them to. Every section
// line says what was observed, and a section with nothing in it says
// "observed nothing of this kind", never "clean".
//
// Two views of one document. The default is an overview a person reads in
// one screen and never scrolls: the subject, the files and the baseline
// outcome, then one line per kind of fact with its count and the ratios a
// reviewer asks about (deadline 2 of 6, output cap 3 of 6, timeout 0 of 2,
// writes under a controlled directory 3), then the review classes this
// tree shows with their share and how many sites show each. No site is
// named. Measured before this: a listed tree with four shell scripts
// printed 372 process rows of two lines each, and the two pattern rows a
// reviewer would act on sat under 750 lines of argv. `--full` is the
// exhaustive view, every site with every qualifier and the whole not
// observed and not visible lists; `--json` is the document itself, which
// carries everything either view shows.

import { colourEnabled, field, GUTTER, INSPECT_VERDICT, LABEL, mark, styler, verdict, wrap } from "../marketplace/style.mjs"
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

/**
 * A stats line: the label in the label column, the count right-aligned in
 * a column as wide as the widest count, then the ratios and the split as
 * one phrase, wrapped under the phrase. Numbers are counts of what the
 * extraction saw; "2 of 6" is two rows out of six that show the thing.
 */
function statLine(label, count, phrase, countWidth, c) {
  const head = `${c("label", label.padEnd(LABEL))}${String(count).padStart(countWidth)}  `
  const indent = LABEL + countWidth + 2
  const lines = phrase ? wrap(phrase, { indent }, c) : [""]
  return [`${head}${lines[0].trimStart()}`, ...lines.slice(1)]
}

const of = (part, whole) => `${part} of ${whole}`

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
 *   exhaustive view behind `--full`; the default is the overview.
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
  const { processes, hosts, writes, timers } = document.observed
  out.push(...field("subject", `${withHomeAbbreviated(document.subject.dir)} at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "no commit"}`, c))
  out.push(...field("files", `${total} read${kinds.length ? `: ${kinds.join(", ")}` : ""}`, c))
  out.push(...field("baseline", baselineText(document.marketplaceBaseline), c))
  out.push("")

  // One line per kind: the count, then the ratios that a reviewer asks about.
  const qml = processes.filter((entry) => entry.declaredIn === "qml" && !entry.detached)
  const detached = processes.filter((entry) => entry.detached).length
  const collectors = qml.filter((entry) => entry.output.collector === "StdioCollector" || entry.output.collector === "SplitParser")
  const computed = processes.filter((entry) => entry.argvForm === "computed").length
  const expressions = processes.filter((entry) => entry.expressions.length).length
  const processPhrase = counts.processes.qml
    ? [
      qml.length ? `deadline ${of(qml.filter((entry) => entry.deadline.observed).length, qml.length)}` : null,
      collectors.length ? `output cap ${of(collectors.filter((entry) => entry.output.capObserved).length, collectors.length)}` : null,
      detached ? `detached ${detached}` : null,
      expressions ? `computed argv element ${expressions}` : null,
      computed ? `not resolvable ${computed}` : null,
    ].filter(Boolean).join(", ")
    : "none observed"
  const scripts = new Set(processes.filter((entry) => entry.declaredIn === "shell").map((entry) => entry.file)).size
  const shellPhrase = counts.processes.shell ? `in ${plural(scripts, "script")}: ${scriptsByDirectory(processes)}` : "none observed"
  const curls = hosts.filter((entry) => entry.tool === "curl")
  const hostPhrase = hosts.length
    ? [
      `https ${of(hosts.filter((entry) => entry.scheme === "https").length, hosts.length)}`,
      `timeout ${of(hosts.filter((entry) => entry.timeout.observed).length, hosts.length)}`,
      `size cap ${of(hosts.filter((entry) => entry.sizeCap.observed).length, hosts.length)}`,
      curls.length ? `curl -q ${of(curls.filter((entry) => entry.flags.includes("-q")).length, curls.length)}` : null,
      hosts.some((entry) => entry.privateAddress) ? `private address ${hosts.filter((entry) => entry.privateAddress).length}` : null,
    ].filter(Boolean).join(", ")
    : "none observed"
  const under = writes.filter((entry) => entry.controlledDirectory === "observed").length
  const outside = writes.filter((entry) => entry.controlledDirectory === "not-observed").length
  const variable = writes.length - under - outside
  const writePhrase = writes.length
    ? [under ? `under a controlled directory ${under}` : null, outside ? `outside one ${outside}` : null, variable ? `path from a variable ${variable}` : null].filter(Boolean).join(", ")
    : "none observed"
  const intervals = timers.map((entry) => entry.intervalMs).filter((value) => value !== null)
  const timerPhrase = timers.length
    ? [
      `repeating ${of(timers.filter((entry) => entry.repeat === true).length, timers.length)}`,
      intervals.length ? (intervals.length === 1 ? `interval ${intervals[0]} ms` : `intervals ${Math.min(...intervals)} to ${Math.max(...intervals)} ms`) : null,
      timers.length - intervals.length ? `interval not resolvable ${timers.length - intervals.length}` : null,
    ].filter(Boolean).join(", ")
    : "none observed"
  const rows = [
    ["processes", counts.processes.qml, processPhrase],
    ["shell lines", counts.processes.shell, shellPhrase],
    ["hosts", hosts.length, hostPhrase],
    ["writes", writes.length, writePhrase],
    ["timers", timers.length, timerPhrase],
  ]
  const countWidth = Math.max(...rows.map(([, count]) => String(count).length))
  for (const [label, count, phrase] of rows) out.push(...statLine(label, count, phrase, countWidth, c))
  out.push("")

  // The review classes: what reviewers raise, how often, and how many sites show it here.
  if (PATTERNS.length) {
    out.push(...field("review", document.patterns.length
      ? `${of(document.patterns.length, PATTERNS.length)} classes reviewers raise show here; their share of review findings (${PATTERNS[0].measurement}, a ${PATTERNS[0].sample}), and the sites here`
      : `none of the ${PATTERNS.length} classes reviewers raise shows here (${PATTERNS[0].measurement})`, c))
    const labelWidth = Math.max(...PATTERNS.map((pattern) => pattern.label.length))
    for (const entry of document.patterns) {
      const pattern = PATTERNS.find((candidate) => candidate.id === entry.id)
      out.push(`${mark("advisory", c)}${c("name", pattern.label.padEnd(labelWidth))}  ${String(Math.round(entry.share * 100)).padStart(2)}%  ${plural(entry.observedCount, "site")}`)
    }
    const lookedFor = document.lookedFor.map((id) => PATTERNS.find((pattern) => pattern.id === id)?.label || id)
    if (lookedFor.length && document.patterns.length) out.push(...field("not shown", lookedFor.join(", "), c))
    out.push("")
  }
  out.push(...verdict("info", INSPECT_VERDICT, "static reading, so run-time commands and values from variables are not seen; --full for every site, --json for the document", c))
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
