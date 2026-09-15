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

import { colourEnabled, field, GUTTER, INSPECT_VERDICT, mark, styler, verdict, wrap } from "../marketplace/style.mjs"
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

/** The first few sites, then how many more: a pattern row a person reads names three, `--full` names them all. */
const SHOWN_SITES = 3
function fewerSites(text) {
  return text.replace(/((?:[\w./-]+:\d+, ){3,})[\w./-]+:\d+/g, (whole) => {
    const sites = whole.split(", ")
    return `${sites.slice(0, SHOWN_SITES).join(", ")} and ${sites.length - SHOWN_SITES} more`
  })
}

function compactProcessRow(process, c) {
  if (process.argvForm === "computed") return row("unknown", site(process), `command: ${process.commandText}, not resolvable`, c)
  const absent = []
  if (process.expressions.length) absent.push(`${plural(process.expressions.length, "element")} computed`)
  if (process.shellWrapper) absent.push("shell wrapper, the script inside is not followed")
  if (process.declaredIn === "qml" && !process.detached) {
    if (!process.deadline.observed) absent.push("no deadline observed")
    if (process.output.collector !== "none" && !process.output.capObserved) absent.push(`no cap observed on ${process.output.collector}`)
  }
  return row("info", site(process), `${commandLine(process) || "[] (an empty argv)"}${process.detached ? " (detached)" : ""}`, c, absent.length ? [absent.join("; ")] : [])
}

/** The shell lines of one script as one row: how many, and the tools they run. */
function compactScriptRow(file, rows, c) {
  const tools = [...new Set(rows.map((entry) => (toolOf(entry.argv).tool || entry.argv[0] || "?").split("/").pop()))]
  const named = tools.slice(0, 8).join(", ") + (tools.length > 8 ? ` and ${tools.length - 8} more` : "")
  const absent = []
  const privileged = rows.filter((entry) => entry.argv.some((word) => ["sudo", "pkexec", "doas"].includes(word.split("/").pop()))).length
  if (privileged) absent.push(`${plural(privileged, "line")} through sudo, pkexec or doas`)
  const wrappers = rows.filter((entry) => entry.shellWrapper).length
  if (wrappers) absent.push(`${plural(wrappers, "shell wrapper")}, the script inside is not followed`)
  return row("info", file, `${plural(rows.length, "shell line")}: ${named}`, c, absent.length ? [absent.join("; ")] : [])
}

function compactHostRow(host, c) {
  const absent = []
  if (host.scheme === "http") absent.push("http, not https")
  if (!host.timeout.observed) absent.push("no timeout observed")
  if (!host.sizeCap.observed) absent.push("no size cap observed")
  if (host.tool === "curl" && !host.flags.includes("-q")) absent.push("-q not observed")
  if (host.privateAddress) absent.push("private or loopback address")
  return row("info", host.host, `${host.scheme}${host.tool ? ` via ${host.tool}` : ""}, ${site(host)}`, c, absent.length ? [absent.join("; ")] : [])
}

function compactWriteRow(write, c) {
  const shown = write.canonicalPath ?? write.path
  const absent = []
  if (write.controlledDirectory === "not-observed") absent.push(`not under a directory the plugin controls${write.temp ? ` (${write.canonicalPath.split("/").slice(0, 2).join("/")} is shared)` : ""}`)
  if (write.controlledDirectory === "unknown") absent.push("directory unknown, the path is not one literal prefix")
  if (write.via === "mkdir" && !write.mode) absent.push("no mode observed")
  return row("info", site(write), `${write.via} ${shown}`, c, absent.length ? [absent.join("; ")] : [])
}

function compactBaseline(section) {
  if (section.skipped) return { state: "skipped", text: `marketplace baseline skipped (${section.reason})` }
  if (!section.invoked) return { state: "unknown", text: `marketplace baseline not run: ${section.skipReason}` }
  const official = section.official
  if (official?.error) return { state: "unknown", text: `marketplace baseline refused the snapshot: ${official.error.code}` }
  const capabilities = (official.capabilities || []).map((entry) => entry.id)
  const findings = (official.findings || []).map((entry) => entry.ruleId)
  const files = [...new Set([...(official.capabilities || []), ...(official.findings || [])].flatMap((entry) => (entry.evidence || []).map((site_) => site_.path)))]
  const parts = [`marketplace baseline ${official.outcome} at pin ${section.pin.commit.slice(0, 8)}`]
  if (capabilities.length) parts.push(`capabilities ${capabilities.join(", ")}`)
  if (findings.length) parts.push(`${plural(findings.length, "finding")} ${findings.join(", ")}`)
  if (files.length) parts.push(`in ${files.join(", ")}`)
  return { state: "info", text: parts.join("; ") }
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
  const processes = `${plural(counts.processes.total, "process", "processes")}${counts.processes.total ? ` (${split(counts.processes)})` : ""}`
  out.push(...field("subject", `${withHomeAbbreviated(document.subject.dir)} at ${document.subject.commit ? document.subject.commit.slice(0, 8) : "no commit"}, ${plural(total, "file")}${kinds.length ? ` (${kinds.join(", ")})` : ""}`, c))
  out.push(...field("observed", `${processes}, ${plural(counts.hosts, "host")}, ${plural(counts.writes, "write")}, ${plural(counts.timers, "timer")}${counts.notResolvable ? `; ${plural(counts.notResolvable, "site")} not resolvable` : ""}`, c))
  const baseline = compactBaseline(document.marketplaceBaseline)
  out.push(`${mark(baseline.state, c)}${wrap(baseline.text, { indent: GUTTER }, c).join("\n").trimStart()}`)
  out.push("")

  const qml = document.observed.processes.filter((entry) => entry.declaredIn === "qml")
  const scripts = new Map()
  for (const entry of document.observed.processes.filter((row_) => row_.declaredIn === "shell")) scripts.set(entry.file, [...(scripts.get(entry.file) || []), entry])
  const sections = [
    ["processes", document.observed.processes.length, () => [...qml.flatMap((entry) => compactProcessRow(entry, c)), ...[...scripts.entries()].flatMap(([file, rows]) => compactScriptRow(file, rows, c))], `, ${split(counts.processes)}`],
    ["hosts", document.observed.hosts.length, () => document.observed.hosts.flatMap((entry) => compactHostRow(entry, c)), ""],
    ["writes", document.observed.writes.length, () => document.observed.writes.flatMap((entry) => compactWriteRow(entry, c)), ""],
    ["timers", document.observed.timers.length, () => document.observed.timers.flatMap((entry) => timerRow(entry, c)), ""],
  ]
  for (const [name, count, render, suffix] of sections) {
    out.push(...field(name, count ? `observed ${count}${suffix}` : NOTHING, c))
    if (count) out.push(...render())
    out.push("")
  }

  if (PATTERNS.length) {
    const width = Math.max(...PATTERNS.map((pattern) => pattern.label.length)) + 1
    out.push(...field("patterns", document.patterns.length
      ? `${document.patterns.length} of the ${PATTERNS.length} classes the marketplace's human review raised, each with its share of review findings in a ${PATTERNS[0].sample} (${PATTERNS[0].measurement})`
      : `none of the ${PATTERNS.length} classes the marketplace's human review raised shows its precondition here (${PATTERNS[0].measurement})`, c))
    for (const entry of document.patterns) {
      const pattern = PATTERNS.find((candidate) => candidate.id === entry.id)
      const label = pattern.label.padEnd(width)
      const lines = wrap(fewerSites(entry.observation), { indent: GUTTER, first: GUTTER + label.length + 1 }, c)
      out.push(`${mark("advisory", c)}${c("name", label)} ${lines[0].trimStart()}`, ...lines.slice(1))
      out.push(...wrap(`about ${Math.round(entry.share * 100)} of every 100 review findings in the sample`, { indent: GUTTER }, c))
    }
    out.push("")
    const lookedFor = document.lookedFor.map((id) => PATTERNS.find((pattern) => pattern.id === id)?.label || id)
    // Named only beside observed rows: with none, the patterns line already says so.
    if (lookedFor.length && document.patterns.length) out.push(...field("not observed", lookedFor.join(", "), c))
  }
  out.push(...field("not visible", "commands built at run time, values from variables or config, components outside the tree, obfuscated content; --full names every site and --json is the document", c))
  out.push("")
  out.push(...verdict("info", INSPECT_VERDICT, `${processes}, ${plural(counts.hosts, "host")}, ${plural(counts.writes, "write")}, ${plural(counts.timers, "timer")}; static, see docs/INSPECT.md`, c))
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
