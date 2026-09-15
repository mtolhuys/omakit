// The JSON contract of docs/INSPECT.md, executable. `validateInspectDocument()`
// returns every way a document departs from it, as sentences, and an empty
// list when it does not. tests/unit/inspect.test.mjs holds every produced
// document to it, so the prose and the code cannot drift apart unnoticed.
//
// Run as a program: `node tools/inspect/contract.mjs <document.json>` prints
// the problems and exits 1 on any.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const ARGV_FORMS = new Set(["array", "string", "computed"])
const DEADLINE_VIA = new Set(["timer-kill", "timeout-argv", "destruction", null])
const COLLECTORS = new Set(["StdioCollector", "SplitParser", "none", "unknown"])
const CONTROLLED = new Set(["observed", "not-observed", "unknown"])
const DECLARED_IN = new Set(["qml", "shell"])
const FILE_KINDS = ["qml", "js", "shell", "python", "other"]

const isString = (value) => typeof value === "string"
const isBool = (value) => typeof value === "boolean"
const isInt = (value) => Number.isInteger(value)
const nullOr = (test) => (value) => value === null || test(value)

function site(value, at, problems) {
  if (!value || typeof value !== "object") {
    problems.push(`${at} is not a site`)
    return
  }
  if (!isString(value.file)) problems.push(`${at}.file is not a string`)
  if (!isInt(value.line) || value.line < 1) problems.push(`${at}.line is not a positive integer`)
}

function processRow(row, at, problems) {
  site(row, at, problems)
  if (!DECLARED_IN.has(row.declaredIn)) problems.push(`${at}.declaredIn is neither qml nor shell`)
  if (!nullOr(isString)(row.id)) problems.push(`${at}.id is neither a string nor null`)
  if (!ARGV_FORMS.has(row.argvForm)) problems.push(`${at}.argvForm is not array, string or computed`)
  if (row.argvForm === "computed") {
    if (row.argv !== null) problems.push(`${at}.argv is not null for a computed command`)
    if (!isString(row.commandText)) problems.push(`${at}.commandText is not the expression text of a computed command`)
  } else if (!Array.isArray(row.argv) || row.argv.some((word) => !isString(word))) problems.push(`${at}.argv is not a list of strings`)
  if (!Array.isArray(row.expressions) || row.expressions.some((entry) => !isInt(entry?.index) || !isString(entry?.text))) problems.push(`${at}.expressions is not a list of { index, text }`)
  if (row.argvForm === "array" && Array.isArray(row.argv)) {
    for (const entry of row.expressions || []) if (row.argv[entry.index] !== entry.text) problems.push(`${at}.expressions[${entry.index}] does not name the argv element it stands for`)
  }
  for (const key of ["running", "detached", "shellWrapper"]) if (!isBool(row[key])) problems.push(`${at}.${key} is not a boolean`)
  const deadline = row.deadline || {}
  if (!isBool(deadline.observed)) problems.push(`${at}.deadline.observed is not a boolean`)
  if (!DEADLINE_VIA.has(deadline.via)) problems.push(`${at}.deadline.via is not timer-kill, timeout-argv, destruction or null`)
  if (deadline.observed !== (deadline.via !== null)) problems.push(`${at}.deadline.observed disagrees with deadline.via`)
  if (!nullOr(isInt)(deadline.ms)) problems.push(`${at}.deadline.ms is neither an integer nor null`)
  const output = row.output || {}
  if (!COLLECTORS.has(output.collector)) problems.push(`${at}.output.collector is not StdioCollector, SplitParser, none or unknown`)
  if (!isBool(output.capObserved)) problems.push(`${at}.output.capObserved is not a boolean`)
  if (!nullOr(isString)(output.via)) problems.push(`${at}.output.via is neither a string nor null`)
  if (output.capObserved !== (output.via !== null)) problems.push(`${at}.output.capObserved disagrees with output.via`)
  if (row.pipedFrom !== null && (!isInt(row.pipedFrom?.line) || !isString(row.pipedFrom?.argv0))) problems.push(`${at}.pipedFrom is neither null nor { line, argv0 }`)
}

function host(row, at, problems) {
  site(row, at, problems)
  if (!isString(row.host) || !row.host) problems.push(`${at}.host is not a host name`)
  if (row.scheme !== "http" && row.scheme !== "https") problems.push(`${at}.scheme is neither http nor https`)
  if (!nullOr(isString)(row.tool)) problems.push(`${at}.tool is neither a string nor null`)
  for (const key of ["timeout", "sizeCap"]) {
    const flag = row[key] || {}
    if (!isBool(flag.observed)) problems.push(`${at}.${key}.observed is not a boolean`)
    if (!nullOr(isString)(flag.via)) problems.push(`${at}.${key}.via is neither a string nor null`)
    if (flag.observed !== (flag.via !== null)) problems.push(`${at}.${key}.observed disagrees with ${key}.via`)
  }
  if (!Array.isArray(row.flags) || row.flags.some((flag) => !isString(flag))) problems.push(`${at}.flags is not a list of strings`)
  if (!isBool(row.privateAddress)) problems.push(`${at}.privateAddress is not a boolean`)
}

function write(row, at, problems) {
  site(row, at, problems)
  if (!isString(row.path)) problems.push(`${at}.path is not a string`)
  if (!nullOr(isString)(row.canonicalPath)) problems.push(`${at}.canonicalPath is neither a string nor null`)
  if (!isString(row.via)) problems.push(`${at}.via is not a string`)
  if (!CONTROLLED.has(row.controlledDirectory)) problems.push(`${at}.controlledDirectory is not observed, not-observed or unknown`)
  if ((row.controlledDirectory === "observed") !== isString(row.controlledBy)) problems.push(`${at}.controlledBy names a directory exactly when controlledDirectory is observed`)
  if (row.canonicalPath === null && row.controlledDirectory !== "unknown") problems.push(`${at}.controlledDirectory is decided for a path that could not be read`)
  if (!isBool(row.temp)) problems.push(`${at}.temp is not a boolean`)
  if (!nullOr(isString)(row.mode)) problems.push(`${at}.mode is neither a string nor null`)
}

function timer(row, at, problems) {
  site(row, at, problems)
  if (!nullOr(isString)(row.id)) problems.push(`${at}.id is neither a string nor null`)
  if (!nullOr(isInt)(row.intervalMs)) problems.push(`${at}.intervalMs is neither an integer nor null`)
  if (!nullOr(isString)(row.intervalText)) problems.push(`${at}.intervalText is neither a string nor null`)
  if (row.intervalMs !== null && row.intervalText !== null) problems.push(`${at} has both an interval and an interval expression`)
  for (const key of ["repeat", "running", "triggeredOnStart"]) if (!nullOr(isBool)(row[key])) problems.push(`${at}.${key} is neither a boolean nor null`)
  if (!nullOr(isString)(row.startedBy)) problems.push(`${at}.startedBy is neither a string nor null`)
}

/**
 * @param {object} document
 * @param {{ patternIds?: string[], notVisible?: string[] }} [known] the ids
 *   patterns.mjs defines and the fixed blind-spot list, when the caller has
 *   them, so a pattern id the code does not define and a rewritten blind
 *   spot are both problems.
 * @returns {string[]} problems; empty when the document follows the contract
 */
export function validateInspectDocument(document, known = {}) {
  const problems = []
  if (!document || typeof document !== "object") return ["the document is not an object"]
  if (!isString(document.omakit)) problems.push("omakit is not a string")
  if (document.command !== "inspect") problems.push('command is not "inspect"')
  if (!isString(document.method) || !/observed/.test(document.method)) problems.push("method is not the one sentence that says observed")
  const subject = document.subject || {}
  if (!isString(subject.dir)) problems.push("subject.dir is not a string")
  if (!nullOr((value) => /^[0-9a-f]{40}$/.test(value))(subject.commit)) problems.push("subject.commit is neither a 40-character sha nor null")
  if (!subject.repository || !nullOr(isString)(subject.repository.url)) problems.push("subject.repository.url is neither a string nor null")
  const filesRead = subject.filesRead || {}
  for (const kind of FILE_KINDS) if (!isInt(filesRead[kind]) || filesRead[kind] < 0) problems.push(`subject.filesRead.${kind} is not a count`)
  for (const key of Object.keys(filesRead)) if (!FILE_KINDS.includes(key)) problems.push(`subject.filesRead.${key} is not a kind inspect reads`)

  const observed = document.observed || {}
  for (const [key, check] of [["processes", processRow], ["hosts", host], ["writes", write], ["timers", timer]]) {
    if (!Array.isArray(observed[key])) {
      problems.push(`observed.${key} is not a list`)
      continue
    }
    for (const [index, row] of observed[key].entries()) check(row, `observed.${key}[${index}]`, problems)
  }
  const counts = document.counts || {}
  if (!counts.processes || typeof counts.processes !== "object") problems.push("counts.processes is not the qml and shell split")
  else {
    for (const key of ["total", "qml", "shell"]) if (!isInt(counts.processes[key]) || counts.processes[key] < 0) problems.push(`counts.processes.${key} is not a count`)
    if (counts.processes.total !== counts.processes.qml + counts.processes.shell) problems.push("counts.processes.total is not qml plus shell")
    if (Array.isArray(observed.processes)) {
      if (counts.processes.total !== observed.processes.length) problems.push("counts.processes.total is not the number of process rows")
      if (counts.processes.qml !== observed.processes.filter((row) => row.declaredIn === "qml").length) problems.push("counts.processes.qml is not the number of qml process rows")
    }
  }
  for (const key of ["hosts", "writes", "timers"]) {
    if (!isInt(counts[key]) || counts[key] < 0) problems.push(`counts.${key} is not a count`)
    else if (Array.isArray(observed[key]) && counts[key] !== observed[key].length) problems.push(`counts.${key} is not the number of ${key} rows`)
  }
  if (!isInt(counts.notResolvable) || (Array.isArray(document.notResolvable) && counts.notResolvable !== document.notResolvable.length)) problems.push("counts.notResolvable is not the number of notResolvable rows")
  if (!Array.isArray(document.notResolvable)) problems.push("notResolvable is not a list")
  else for (const [index, row] of document.notResolvable.entries()) {
    site(row, `notResolvable[${index}]`, problems)
    if (!isString(row.kind) || !isString(row.text)) problems.push(`notResolvable[${index}] lacks kind and text`)
  }
  // Every computed command is also a site the extraction could not read.
  for (const row of Array.isArray(observed.processes) ? observed.processes : []) {
    if (row.argvForm === "computed" && !(document.notResolvable || []).some((entry) => entry.kind === "command" && entry.file === row.file && entry.line === row.line)) {
      problems.push(`observed.processes at ${row.file}:${row.line} is computed but not listed under notResolvable`)
    }
  }

  if (!Array.isArray(document.patterns)) problems.push("patterns is not a list")
  else for (const [index, row] of document.patterns.entries()) {
    const at = `patterns[${index}]`
    if (!isString(row.id)) problems.push(`${at}.id is not a string`)
    else if (known.patternIds && !known.patternIds.includes(row.id)) problems.push(`${at}.id ${row.id} is not a pattern patterns.mjs defines`)
    if (!isInt(row.observedCount) || row.observedCount < 1) problems.push(`${at}.observedCount is not a positive count: a pattern is listed only where its precondition was observed`)
    if (!Array.isArray(row.sites) || row.sites.length === 0) problems.push(`${at}.sites is not a non-empty list`)
    else for (const [n, entry] of row.sites.entries()) site(entry, `${at}.sites[${n}]`, problems)
    if (!isString(row.measurement) || !/^M\d+$/.test(row.measurement)) problems.push(`${at}.measurement is not a measurement id`)
    if (typeof row.share !== "number" || !(row.share > 0 && row.share < 1)) problems.push(`${at}.share is not a share between 0 and 1`)
    if (!isString(row.observation) || !/^observed /.test(row.observation)) problems.push(`${at}.observation does not start with the word observed`)
    if (!isString(row.summary) || !row.summary || /\w:\d+/.test(row.summary)) problems.push(`${at}.summary is not the observation without its sites`)
    if (/\b(?:missing|should|fix)\b/i.test(String(row.observation))) problems.push(`${at}.observation reads as a verdict`)
  }
  if (!Array.isArray(document.lookedFor) || document.lookedFor.some((id) => !isString(id))) problems.push("lookedFor is not a list of pattern ids")
  else {
    const listed = new Set((document.patterns || []).map((row) => row.id))
    for (const id of document.lookedFor) {
      if (listed.has(id)) problems.push(`lookedFor names ${id}, which is also under patterns`)
      if (known.patternIds && !known.patternIds.includes(id)) problems.push(`lookedFor names ${id}, which patterns.mjs does not define`)
    }
    if (known.patternIds) {
      for (const id of known.patternIds) if (!listed.has(id) && !document.lookedFor.includes(id)) problems.push(`pattern ${id} is neither under patterns nor under lookedFor`)
    }
  }
  if (!Array.isArray(document.notVisible) || document.notVisible.some((line) => !isString(line))) problems.push("notVisible is not a list of sentences")
  else if (known.notVisible && JSON.stringify(document.notVisible) !== JSON.stringify(known.notVisible)) problems.push("notVisible is not the fixed blind-spot list, verbatim")

  const baseline = document.marketplaceBaseline
  if (!baseline || typeof baseline !== "object") problems.push("marketplaceBaseline is missing")
  else if (baseline.skipped === true) {
    if (!isString(baseline.reason)) problems.push("marketplaceBaseline.reason is not a string")
  } else {
    if (!baseline.pin || !isString(baseline.pin.commit)) problems.push("marketplaceBaseline.pin.commit is not a string")
    if (!isString(baseline.transport)) problems.push("marketplaceBaseline.transport is not a string")
    if (!isBool(baseline.invoked)) problems.push("marketplaceBaseline.invoked is not a boolean")
    if (!isString(baseline.statement)) problems.push("marketplaceBaseline.statement is not a string")
    if (baseline.invoked && (!baseline.official || typeof baseline.official !== "object")) problems.push("marketplaceBaseline.official is missing for an invoked baseline")
  }
  return problems
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  const input = process.argv[2]
  if (!input) throw new Error("usage: node tools/inspect/contract.mjs <document.json>")
  const problems = validateInspectDocument(JSON.parse(readFileSync(resolve(input), "utf8")))
  for (const problem of problems) process.stdout.write(`${problem}\n`)
  process.stdout.write(problems.length ? `${problems.length} problem(s)\n` : "ok: the document follows the contract in docs/INSPECT.md\n")
  process.exit(problems.length ? 1 : 0)
}
