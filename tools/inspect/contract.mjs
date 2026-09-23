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
const DEADLINE_VIA = new Set(["timer-kill", "timeout-argv", "destruction", "block-run", null])
const COLLECTORS = new Set(["StdioCollector", "SplitParser", "Run", "none", "unknown"])
const BLOCK_STATES = new Set(["unmodified", "modified"])
const CONTROLLED = new Set(["observed", "not-observed", "variable", "unknown"])
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
  for (const key of ["running", "detached", "shellWrapper", "closedEnvironment"]) if (!isBool(row[key])) problems.push(`${at}.${key} is not a boolean`)
  if (row.closedEnvironment && row.declaredIn !== "shell") problems.push(`${at}.closedEnvironment is set on a site that is not a shell line`)
  const deadline = row.deadline || {}
  if (!isBool(deadline.observed)) problems.push(`${at}.deadline.observed is not a boolean`)
  if (!DEADLINE_VIA.has(deadline.via)) problems.push(`${at}.deadline.via is not timer-kill, timeout-argv, destruction, block-run or null`)
  if ((deadline.via === "block-run") !== (row.block === "run")) problems.push(`${at}.deadline.via block-run and block: "run" go together`)
  if (row.block === "run" && !nullOr(isString)(row.helper)) problems.push(`${at}.helper is neither a tree path nor null`)
  if (row.block !== "run" && row.helper !== undefined) problems.push(`${at}.helper is only for a Run site`)
  if (deadline.observed !== (deadline.via !== null)) problems.push(`${at}.deadline.observed disagrees with deadline.via`)
  if (!nullOr(isInt)(deadline.ms)) problems.push(`${at}.deadline.ms is neither an integer nor null`)
  const output = row.output || {}
  if (!COLLECTORS.has(output.collector)) problems.push(`${at}.output.collector is not StdioCollector, SplitParser, Run, none or unknown`)
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
  if (!CONTROLLED.has(row.controlledDirectory)) problems.push(`${at}.controlledDirectory is not observed, not-observed, variable or unknown`)
  if ((row.controlledDirectory === "observed") !== isString(row.controlledBy)) problems.push(`${at}.controlledBy names a directory exactly when controlledDirectory is observed`)
  if (row.canonicalPath === null && row.controlledDirectory !== "unknown") problems.push(`${at}.controlledDirectory is decided for a path that could not be read`)
  if (row.controlledDirectory === "variable" && !/^\$(?:[A-Za-z_]\w*|\d)\/?$/.test(row.canonicalPath ?? "")) problems.push(`${at}.controlledDirectory is variable for a path that is not one variable`)
  if (!isBool(row.temp)) problems.push(`${at}.temp is not a boolean`)
  if (!nullOr(isString)(row.mode)) problems.push(`${at}.mode is neither a string nor null`)
  if ((row.via === "block-store") !== (row.block === "store")) problems.push(`${at}.via block-store and block: "store" go together`)
}

function fn(row, at, problems) {
  site(row, at, problems)
  if (!isString(row.name) || !row.name) problems.push(`${at}.name is not a name`)
  if (row.kind !== "function" && row.kind !== "handler") problems.push(`${at}.kind is neither function nor handler`)
  for (const key of ["lines", "depth", "branches"]) if (!isInt(row[key]) || row[key] < 0) problems.push(`${at}.${key} is not a count`)
  if (isInt(row.lines) && row.lines < 1) problems.push(`${at}.lines is under one`)
  if (typeof row.percentile !== "number" || row.percentile < 0 || row.percentile > 100) problems.push(`${at}.percentile is not a rank between 0 and 100`)
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
  if (!isInt(subject.uncommittedFiles) || subject.uncommittedFiles < 0) problems.push("subject.uncommittedFiles is not a count")

  const observed = document.observed || {}
  for (const [key, check] of [["processes", processRow], ["hosts", host], ["writes", write], ["timers", timer], ["functions", fn]]) {
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
  for (const key of ["hosts", "writes", "timers", "functions"]) {
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

  const size = document.size
  if (!size || typeof size !== "object") problems.push("size is missing")
  else {
    if (!isString(size.measurement) || !/^M\d+$/.test(size.measurement)) problems.push("size.measurement is not a measurement id")
    for (const key of ["lines", "branches", "depth"]) if (!isInt(size.thresholds?.[key]) || size.thresholds[key] < 1) problems.push(`size.thresholds.${key} is not a count`)
    const shares = size.sample?.heavyShares
    if (!size.sample || !isInt(size.sample.trees) || !isInt(size.sample.functions)) problems.push("size.sample is not { trees, functions, heavyShares }")
    else if (!Array.isArray(shares) || !shares.length || shares.length > size.sample.trees || !shares.every((share) => typeof share === "number" && share >= 0 && share <= 1)) problems.push("size.sample.heavyShares is not one share from 0 to 1 per listed tree with a function")
    const scorable = Array.isArray(observed.functions) && observed.functions.length > 0
    if (typeof size.heavyShare !== "number" || size.heavyShare < 0 || size.heavyShare > 1) problems.push("size.heavyShare is not a share from 0 to 1")
    else if (Array.isArray(observed.functions) && size.thresholds) {
      const total = observed.functions.reduce((sum, row) => sum + row.lines, 0)
      const heavy = observed.functions.filter((row) => row.lines > size.thresholds.lines || row.branches > size.thresholds.branches || row.depth > size.thresholds.depth).reduce((sum, row) => sum + row.lines, 0)
      const expected = total ? heavy / total : 0
      if (Math.abs(expected - size.heavyShare) > 0.00011) problems.push(`size.heavyShare is ${size.heavyShare}; the function lines over the thresholds say ${expected}`)
    }
    if (size.score === null) {
      if (scorable) problems.push("size.score is null for a tree with functions")
    } else if (typeof size.score !== "number" || size.score < 0 || size.score > 10 || Math.abs(Math.round(size.score * 100) - size.score * 100) > 1e-6) problems.push("size.score is not a number from 0 to 10 with two decimals")
    else if (!scorable) problems.push("size.score is set for a tree with no function")
    else if (Array.isArray(shares) && shares.length && typeof size.heavyShare === "number") {
      const rank = (shares.filter((share) => share < size.heavyShare).length / shares.length) * 100
      const expected = Math.round((10 - rank / 10) * 100) / 100
      if (Math.abs(expected - size.score) > 0.011) problems.push(`size.score is ${size.score}; the tree's rank among the listed shares says ${expected}`)
    }
    if (!Array.isArray(size.over)) problems.push("size.over is not a list")
    else {
      for (const [index, row] of size.over.entries()) {
        fn(row, `size.over[${index}]`, problems)
        if (size.thresholds && !(row.lines > size.thresholds.lines || row.branches > size.thresholds.branches || row.depth > size.thresholds.depth)) problems.push(`size.over[${index}] is under every threshold`)
        if (index && size.over[index - 1].lines < row.lines) problems.push(`size.over[${index}] is longer than the one before it; the list is longest first`)
      }
      if (Array.isArray(observed.functions)) {
        const listed = new Set(size.over.map((row) => `${row.file}:${row.line}`))
        for (const row of observed.functions) {
          const over = row.lines > size.thresholds?.lines || row.branches > size.thresholds?.branches || row.depth > size.thresholds?.depth
          if (over && !listed.has(`${row.file}:${row.line}`)) problems.push(`observed.functions at ${row.file}:${row.line} is over a threshold but not under size.over`)
        }
      }
    }
  }
  if (!Array.isArray(document.blocks)) problems.push("blocks is not a list")
  else for (const [index, row] of document.blocks.entries()) {
    const at = `blocks[${index}]`
    if (!isString(row.name) || !/^[a-z][a-z0-9-]*$/.test(row.name)) problems.push(`${at}.name is not a block name`)
    if (!isString(row.version)) problems.push(`${at}.version is not a string`)
    if (!nullOr(isString)(row.shippedVersion)) problems.push(`${at}.shippedVersion is neither a string nor null`)
    if (!BLOCK_STATES.has(row.state)) problems.push(`${at}.state is not unmodified or modified`)
    if (!isBool(row.complete)) problems.push(`${at}.complete is not a boolean`)
    if (!Array.isArray(row.files) || !row.files.length) problems.push(`${at}.files is not a non-empty list`)
    else {
      for (const [fileIndex, file] of row.files.entries()) {
        if (!isString(file.path)) problems.push(`${at}.files[${fileIndex}].path is not a string`)
        if (!BLOCK_STATES.has(file.state)) problems.push(`${at}.files[${fileIndex}].state is not unmodified or modified`)
        if (!isString(file.version)) problems.push(`${at}.files[${fileIndex}].version is not a string`)
      }
      if ((row.state === "unmodified") !== row.files.every((file) => file.state === "unmodified")) problems.push(`${at}.state disagrees with its files`)
      // An unmodified block's files were not read: no row of any kind at them.
      if (row.state === "unmodified" && observed) {
        const paths = new Set(row.files.map((file) => file.path))
        for (const key of ["processes", "hosts", "writes", "timers", "functions"]) {
          for (const fact of Array.isArray(observed[key]) ? observed[key] : []) if (paths.has(fact.file)) problems.push(`observed.${key} has a row at ${fact.file}:${fact.line}, a file of unmodified block ${row.name}`)
        }
      }
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
