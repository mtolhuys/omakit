// Text rendering of a cost document and of the confirmation that precedes
// it, for the person whose shell is about to be restarted and the agent
// reading over their shoulder. Drawn with style.mjs and nothing of its own:
// the same marks, columns and rule every other command uses.
//
// The noise floor is printed once, in the header, before any plugin row, and
// every row says "within noise" in words where its median delta does not
// clear that floor. A row is `ok` when both figures are within noise, `note`
// when either is above it, and `?` when no run of it completed. None of that
// is a judgement about whether a cost is acceptable; the number is the
// author's to read.

import { action, colourEnabled, field, GUTTER, labelled, section, STEP, styler, wrap } from "../marketplace/style.mjs"
import { head } from "../marketplace/report.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"
import { figure } from "./stats.mjs"

/** The mark a row gets from its two verdicts. */
export function rowState(plugin) {
  const { memory, cpu } = plugin.verdict
  if (memory === "unknown" || cpu === "unknown") return "unknown"
  return memory === "within-noise" && cpu === "within-noise" ? "pass" : "advisory"
}

/** A figure with its spread, and the words when it is within noise. */
function measured(stat, unit, within) {
  if (stat.median === null) return "no completed run"
  const value = unit === "%" ? `${figure(stat.median)}%` : `${figure(stat.median)} ${unit}`
  return `${value} (spread ${figure(stat.spread)})${within ? ", within noise" : ""}`
}

/**
 * The confirmation, as lines: what will be restarted, how often, and for how
 * long, from the plan and nothing else. Printed before the question, and
 * printed the same way under --yes so the record says what was agreed to.
 */
export function renderPlan(plan, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  const names = plan.audited.map((plugin) => plugin.id)
  out.push(...field("measuring", names.join(", "), c))
  out.push(...field("shell", `${plan.shellVersion} at ${withHomeAbbreviated(plan.omarchyPath, env)}`, c))
  out.push(...field("restarts", `${plan.restarts}: (1 baseline + ${plan.audited.length} plugin${plan.audited.length === 1 ? "" : "s"}) × ${plan.runs} run${plan.runs === 1 ? "" : "s"}`, c))
  out.push(...field("estimate", `about ${plan.estimatedMinutes} minute${plan.estimatedMinutes === 1 ? "" : "s"}: ${figure(plan.timing.seconds, 1)} s per restart (${plan.timing.source}), plus a ${plan.settleSeconds} s settle and a ${plan.windowSeconds} s window each`, c))
  out.push(...field("shell.json", `backed up beside itself and restored on every exit path; the md5 is printed before and after`, c))
  out.push(...field("writes", withHomeAbbreviated(plan.out, env), c))
  return out
}

/**
 * @param {object} document the cost document, docs/COST.md
 * @param {{ colour?: boolean, env?: object }} [options] `env` is where `$HOME` is read from for `~/` in paths; the document keeps them absolute.
 */
export function renderCost(document, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  const { settings, baseline, noiseFloor, config } = document
  const baseRuns = baseline.pssMb.runs.length
  out.push(...field("shell", `${document.shell.version} at ${withHomeAbbreviated(document.shell.omarchyPath, env)}, ${document.started}`, c))
  out.push(...field("method", `startup A/B, ${settings.runs} run${settings.runs === 1 ? "" : "s"}, a ${settings.windowSeconds} s window after a settle of ${settings.settleSeconds} s; Pss from /proc/<pid>/smaps_rollup at the fixed event, CPU from /proc/<pid>/stat over the window, children from a /proc walk every ${settings.sampleIntervalMs} ms`, c))
  out.push(...field("noise floor", noiseFloor.pssMb === null
    ? "unknown: no baseline run completed"
    : `${figure(noiseFloor.pssMb)} MB and ${figure(noiseFloor.cpuPercent)}% CPU, the spread of ${baseRuns} baseline run${baseRuns === 1 ? "" : "s"}; a delta inside it is within noise. The same runs read as VmRSS at the end of the window spread ${figure(noiseFloor.rssMbWindowEnd)} MB`, c))
  if (baseline.pssMb.median !== null) {
    out.push(...field("baseline", `${figure(baseline.pssMb.median, 1)} MB Pss and ${figure(baseline.cpuPercent.median)}% CPU, the median of ${baseRuns} run${baseRuns === 1 ? "" : "s"} without ${document.audited.length === 1 ? "the plugin" : `the ${document.audited.length} plugins`}`, c))
  }
  const restored = config.restored ? "restored and verified, backup removed" : c("fail", `differs from the backup, which is kept at ${withHomeAbbreviated(config.backup, env)}`)
  out.push(...field("shell.json", `md5 ${config.md5Before} before, ${config.md5After} after: ${restored}`, c))
  if (config.shellAnsweredAfterRestore === false) out.push(...action("The shell did not answer after the restore: run omarchy-restart-shell.", c))
  if (document.failedRuns?.length) {
    out.push(...field("incomplete", document.failedRuns.map((failed) => `run ${failed.run} of ${failed.label}: ${failed.reason}`).join("; "), c))
  }
  out.push("")

  for (const [index, plugin] of document.plugins.entries()) {
    if (index > 0) out.push("")
    const state = rowState(plugin)
    out.push(head(state, plugin.id, plugin.kinds.join(", ") || "no kinds", c))
    out.push(...wrap(`${plugin.name === plugin.id ? "" : `${plugin.name}: `}${plugin.verdict.summary}${plugin.runsCompleted < settings.runs ? ` (${plugin.runsCompleted} of ${settings.runs} runs completed)` : ""}`, { indent: GUTTER }, c))
    out.push(...labelled("memory", measured(plugin.shellPssMb, "MB", plugin.withinNoise.pss), c))
    out.push(...labelled("cpu", measured(plugin.shellCpuPercent, "%", plugin.withinNoise.cpu), c))
    const spawns = plugin.childSpawns.median
    out.push(...labelled("children", spawns === null
      ? "no completed run"
      : spawns === 0
        ? "none attributed"
        : `${figure(plugin.childRssMb.median)} MB and ${figure(plugin.childCpuPercent.median)}% CPU outside the shell, ${figure(spawns, 0)} process${spawns === 1 ? "" : "es"} per window`, c))
  }
  out.push("")
  out.push(...wrap(`Every figure is the median over ${settings.runs} run${settings.runs === 1 ? "" : "s"} of (with the plugin minus without it) with its spread, and carries its origin in the document under \`origin\`.`, {}, c))

  // Last, because it is what an author came for: the sentence to paste, and
  // the document that is its evidence.
  const written = document.plugins.filter((plugin) => plugin.readme)
  if (written.length) {
    out.push("")
    out.push(...section("for the README", c))
    for (const plugin of written) {
      out.push(`${" ".repeat(STEP)}${c("name", plugin.id)}`)
      out.push(...wrap(plugin.readme, { indent: GUTTER }, c))
      out.push(...labelled("evidence", withHomeAbbreviated(document.out, env), c))
    }
  }
  return out.join("\n")
}
