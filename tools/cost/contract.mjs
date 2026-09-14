// The JSON contract of docs/COST.md, executable. `validateCostDocument()`
// returns every way a document departs from it, as sentences, and an empty
// list when it does not. tests/unit/cost.test.mjs holds every produced
// document to it, and the lab scenario runs it over the document a real
// shell produced, so the prose and the code cannot drift apart unnoticed.
//
// Run as a program: `node tools/cost/contract.mjs <document.json>` prints
// the problems and exits 1 on any.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { verdict as verdictOf } from "./stats.mjs"

const VERDICTS = new Set(["within-noise", "above-noise", "unknown"])

function isStats(value, at, problems) {
  if (!value || typeof value !== "object") {
    problems.push(`${at} is not a stats object`)
    return
  }
  for (const key of ["median", "spread", "min", "max"]) {
    if (!(key in value) || (value[key] !== null && typeof value[key] !== "number")) problems.push(`${at}.${key} is neither a number nor null`)
  }
  if (!Array.isArray(value.runs) || value.runs.some((run) => typeof run !== "number")) problems.push(`${at}.runs is not a list of numbers`)
  if (Array.isArray(value.runs) && value.runs.length === 0 && value.median !== null) problems.push(`${at} has no runs but a median`)
}

function isSample(sample, at, problems) {
  for (const key of ["label", "started", "ended"]) if (typeof sample[key] !== "string") problems.push(`${at}.${key} is not a string`)
  for (const key of ["run", "shellPid", "readyAfterSeconds", "windowSeconds"]) if (typeof sample[key] !== "number") problems.push(`${at}.${key} is not a number`)
  const shell = sample.shell
  if (!shell || typeof shell !== "object") {
    problems.push(`${at}.shell is missing`)
    return
  }
  for (const key of ["pssKb", "rssKb", "pssKbSettled", "rssKbSettled"]) if (shell[key] !== null && typeof shell[key] !== "number") problems.push(`${at}.shell.${key} is neither a number nor null`)
  if (shell.memoryAt !== "window-end") problems.push(`${at}.shell.memoryAt is not "window-end"`)
  if (!Array.isArray(shell.trace)) problems.push(`${at}.shell.trace is not a list`)
  else for (const [index, point] of shell.trace.entries()) {
    if (typeof point.t !== "number") problems.push(`${at}.shell.trace[${index}].t is not a number`)
    for (const key of ["pssKb", "rssKb"]) if (point[key] !== null && typeof point[key] !== "number") problems.push(`${at}.shell.trace[${index}].${key} is neither a number nor null`)
  }
  for (const key of ["cpuTicksStart", "cpuTicksEnd", "cpuSeconds", "cpuPercent", "reapedChildTicksStart", "reapedChildTicksEnd", "reapedChildCpuSeconds", "reapedChildCpuPercent"]) {
    if (typeof shell[key] !== "number") problems.push(`${at}.shell.${key} is not a number`)
  }
  if (!Array.isArray(sample.children)) {
    problems.push(`${at}.children is not a list`)
    return
  }
  for (const [index, child] of sample.children.entries()) {
    for (const key of ["pid", "firstSeen", "lastSeen", "cpuFirst", "cpuLast", "rssLast", "samples"]) if (typeof child[key] !== "number") problems.push(`${at}.children[${index}].${key} is not a number`)
    for (const key of ["comm", "arg0"]) if (typeof child[key] !== "string") problems.push(`${at}.children[${index}].${key} is not a string`)
    if (typeof child.arg0 === "string" && child.arg0.length > 80) problems.push(`${at}.children[${index}].arg0 is longer than 80 characters`)
    if ("key" in child) problems.push(`${at}.children[${index}] carries the full command line, which never reaches the file`)
  }
}

/**
 * @param {object} document
 * @returns {string[]} problems; empty when the document follows the contract
 */
export function validateCostDocument(document) {
  const problems = []
  if (!document || typeof document !== "object") return ["the document is not an object"]
  if (typeof document.omakit !== "string") problems.push("omakit is not a string")
  if (document.command !== "cost") problems.push('command is not "cost"')
  for (const key of ["method", "started", "ended", "host", "out"]) if (typeof document[key] !== "string") problems.push(`${key} is not a string`)
  if (!document.shell || typeof document.shell.version !== "string" || typeof document.shell.omarchyPath !== "string") problems.push("shell lacks version and omarchyPath")
  const settings = document.settings || {}
  for (const key of ["runs", "windowSeconds", "settleSeconds", "readyTimeoutSeconds", "sampleIntervalMs", "clockTicksPerSecond"]) {
    if (typeof settings[key] !== "number") problems.push(`settings.${key} is not a number`)
  }
  const config = document.config || {}
  for (const key of ["path", "backup"]) if (typeof config[key] !== "string") problems.push(`config.${key} is not a string`)
  for (const key of ["md5Before", "md5After"]) if (config[key] !== null && !/^[0-9a-f]{32}$/.test(String(config[key]))) problems.push(`config.${key} is not an md5`)
  if (typeof config.restored !== "boolean") problems.push("config.restored is not a boolean")
  if (config.restored !== (config.md5After === config.md5Before)) problems.push("config.restored disagrees with the two md5s")
  if (!Array.isArray(document.audited) || document.audited.some((id) => typeof id !== "string")) problems.push("audited is not a list of ids")
  if (!Array.isArray(document.failedRuns)) problems.push("failedRuns is not a list")

  const baseline = document.baseline
  if (!baseline || typeof baseline !== "object") {
    problems.push("baseline is missing")
  } else {
    if (!baseline.config || typeof baseline.config !== "object") problems.push("baseline.config is not the configuration the baseline ran with")
    for (const key of ["pssMb", "rssMb", "pssMbSettled", "rssMbSettled", "cpuPercent", "childRssMb"]) isStats(baseline[key], `baseline.${key}`, problems)
    if (!Array.isArray(baseline.runs)) problems.push("baseline.runs is not a list")
    else for (const [index, sample] of baseline.runs.entries()) isSample(sample, `baseline.runs[${index}]`, problems)
  }
  const floor = document.noiseFloor
  if (!floor || typeof floor !== "object") {
    problems.push("noiseFloor is missing")
  } else {
    for (const key of ["pssMb", "rssMb", "pssMbSettled", "rssMbSettled", "cpuPercent"]) if (floor[key] !== null && typeof floor[key] !== "number") problems.push(`noiseFloor.${key} is neither a number nor null`)
    if (typeof floor.origin !== "string") problems.push("noiseFloor.origin is not a string")
    if (baseline?.pssMb && floor.pssMb !== baseline.pssMb.spread) problems.push("noiseFloor.pssMb is not the baseline Pss spread")
    if (baseline?.cpuPercent && floor.cpuPercent !== baseline.cpuPercent.spread) problems.push("noiseFloor.cpuPercent is not the baseline CPU spread")
  }

  if (!Array.isArray(document.plugins)) {
    problems.push("plugins is not a list")
    return problems
  }
  if (Array.isArray(document.audited) && document.plugins.length !== document.audited.length) problems.push("plugins has a row count other than audited")
  for (const [index, plugin] of document.plugins.entries()) {
    const at = `plugins[${index}]`
    for (const key of ["id", "name", "origin"]) if (typeof plugin[key] !== "string") problems.push(`${at}.${key} is not a string`)
    if (!Array.isArray(plugin.kinds)) problems.push(`${at}.kinds is not a list`)
    if (typeof plugin.firstParty !== "boolean") problems.push(`${at}.firstParty is not a boolean`)
    if (typeof plugin.runsCompleted !== "number") problems.push(`${at}.runsCompleted is not a number`)
    for (const key of ["shellPssMb", "shellRssMb", "shellPssMbSettled", "shellCpuPercent", "childRssMb", "childCpuPercent", "childSpawns"]) isStats(plugin[key], `${at}.${key}`, problems)
    for (const key of ["totalMb", "totalCpuPercent"]) if (plugin[key] !== null && typeof plugin[key] !== "number") problems.push(`${at}.${key} is neither a number nor null`)
    const verdict = plugin.verdict || {}
    for (const key of ["memory", "cpu"]) if (!VERDICTS.has(verdict[key])) problems.push(`${at}.verdict.${key} is not a verdict`)
    if (typeof verdict.summary !== "string") problems.push(`${at}.verdict.summary is not a string`)
    if (plugin.shellPssMb?.median !== undefined && floor?.pssMb !== undefined) {
      const expected = verdictOf(plugin.shellPssMb.median, floor.pssMb)
      if (verdict.memory !== expected) problems.push(`${at}.verdict.memory is ${verdict.memory}; the median and the floor say ${expected}`)
    }
    if (plugin.shellCpuPercent?.median !== undefined && floor?.cpuPercent !== undefined) {
      const expected = verdictOf(plugin.shellCpuPercent.median, floor.cpuPercent)
      if (verdict.cpu !== expected) problems.push(`${at}.verdict.cpu is ${verdict.cpu}; the median and the floor say ${expected}`)
    }
    const within = plugin.withinNoise || {}
    for (const key of ["pss", "rss", "cpu", "ownPss", "ownCpu"]) if (within[key] !== null && typeof within[key] !== "boolean") problems.push(`${at}.withinNoise.${key} is neither a boolean nor null`)
    for (const key of ["baselinePssSpreadMb", "baselineCpuSpreadPercent"]) if (within[key] !== null && typeof within[key] !== "number") problems.push(`${at}.withinNoise.${key} is neither a number nor null`)
    if (typeof within.note !== "string") problems.push(`${at}.withinNoise.note is not a string`)
    if (plugin.readme !== null && typeof plugin.readme !== "string") problems.push(`${at}.readme is neither a string nor null`)
    if (typeof plugin.readme === "string" && !/^Costs (?:[\d.]+ MB|under [\d.?]+ MB) and (?:[\d.]+% CPU|under [\d.?]+% CPU) on Omarchy .+, measured with omakit cost on \d{4}-\d{2}-\d{2}$/.test(plugin.readme)) {
      problems.push(`${at}.readme is not the README sentence: ${plugin.readme}`)
    }
    if ((verdict.memory === "unknown" || verdict.cpu === "unknown") !== (plugin.readme === null)) problems.push(`${at}.readme is ${plugin.readme === null ? "null with a verdict" : "present without one"}`)
    if (!Array.isArray(plugin.deltas)) {
      problems.push(`${at}.deltas is not a list`)
    } else {
      if (plugin.deltas.length !== plugin.runsCompleted) problems.push(`${at}.deltas has ${plugin.deltas.length} entries for ${plugin.runsCompleted} completed runs`)
      for (const [run, delta] of plugin.deltas.entries()) {
        for (const key of ["run", "shellPssMb", "shellRssMb", "shellCpuPercent", "childRssMb", "childCpuPercent", "reapedChildCpuPercent", "childSpawns"]) {
          if (typeof delta[key] !== "number") problems.push(`${at}.deltas[${run}].${key} is not a number`)
        }
        if (!Array.isArray(delta.children)) problems.push(`${at}.deltas[${run}].children is not a list`)
      }
    }
    if (!Array.isArray(plugin.runs)) problems.push(`${at}.runs is not a list`)
    else for (const [run, sample] of plugin.runs.entries()) isSample(sample, `${at}.runs[${run}]`, problems)
  }
  return problems
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  const input = process.argv[2]
  if (!input) throw new Error("usage: node tools/cost/contract.mjs <document.json>")
  const problems = validateCostDocument(JSON.parse(readFileSync(resolve(input), "utf8")))
  for (const problem of problems) process.stdout.write(`${problem}\n`)
  process.stdout.write(problems.length ? `${problems.length} problem(s)\n` : "ok: the document follows the contract in docs/COST.md\n")
  process.exit(problems.length ? 1 : 0)
}
