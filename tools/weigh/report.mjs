// Text rendering of a weigh document and of the confirmation that precedes
// it, for the person whose shell is about to be restarted and the agent
// reading over their shoulder. Drawn with style.mjs and nothing of its own:
// the same marks, columns and rule every other command uses.
//
// The noise floor is printed once, in the header, before any plugin row, and
// every row says "within noise" in words where its median delta does not
// clear that floor. A row is `ok` when both figures are within noise, `note`
// when either is above it, and `?` when no run of it completed. None of that
// is a judgement about whether a weight is acceptable; the number is the
// author's to read.

import { action, colourEnabled, field, GUTTER, labelled, section, STEP, styler, verdict, wrap } from "../marketplace/style.mjs"
import { head } from "../marketplace/report.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"
import { figure } from "./stats.mjs"
import { stockShellPath } from "./audit.mjs"
import { ARG0_CHARS } from "./proc.mjs"

/**
 * A redacted command for a row. The document carries comm and a first
 * argument cut to 80 characters (docs/WEIGH.md), which can end mid-word
 * (`.../helper/sideca`); a person reads better when the cut falls at the
 * last path separator, with an ellipsis saying it was cut. Nothing is
 * added back: the row shows less than the document, never more.
 */
export function redactedCommand(command, limit = ARG0_CHARS) {
  const [comm, ...rest] = String(command).split(" ")
  const arg0 = rest.join(" ")
  if (arg0.length < limit) return command
  const cut = arg0.lastIndexOf("/")
  return cut > 0 ? `${comm} ${arg0.slice(0, cut + 1)}...` : `${comm} ${arg0}...`
}

/** The version alone on a stock install; the path beside it only when the running shell is somewhere else. */
function shellLine(version, omarchyPath, env) {
  return omarchyPath === stockShellPath(env) ? version : `${version} at ${withHomeAbbreviated(omarchyPath, env)}`
}

/**
 * The mark a row gets: from its CPU verdict. Memory is a fact about the
 * shell's start until its two resting levels are understood (C1 and C2),
 * so it is printed with its figure and never turns a row into a note.
 */
export function rowState(plugin) {
  const { memory, cpu } = plugin.verdict
  if (memory === "unknown" || cpu === "unknown") return "unknown"
  return cpu === "within-noise" ? "pass" : "advisory"
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
  out.push(...field("weighing", names.join(", "), c))
  out.push(...field("shell", shellLine(plan.shellVersion, plan.omarchyPath, env), c))
  out.push(...field("restarts", `${plan.restarts}: (1 baseline + ${plan.audited.length} plugin${plan.audited.length === 1 ? "" : "s"}) × ${plan.runs} run${plan.runs === 1 ? "" : "s"}`, c))
  out.push(...field("estimate", `about ${plan.estimatedMinutes} minute${plan.estimatedMinutes === 1 ? "" : "s"}, ${figure(plan.perRestartSeconds, 0)} s per restart: ${figure(plan.timing.seconds, 1)} s for the shell to come back (${plan.timing.source}), then the ${plan.settleSeconds} s settle and the ${plan.windowSeconds} s window`, c))
  out.push(...field("shell.json", `backed up beside itself and restored on every exit path; the md5 is printed before and after`, c))
  out.push(...field("writes", withHomeAbbreviated(plan.out, env), c))
  return out
}

/**
 * The one question, from the plan: the count, the minutes, and the knob
 * that sets both, so a person who wants a quick look knows what to type
 * before the shell goes down once.
 */
export function confirmationQuestion(plan) {
  const knob = plan.runs === 1 ? "(--runs 1: a quick look, no spread and no verdict)" : `(--runs ${plan.runs}; --runs 1 for a quick look without a spread)`
  return `Restart the shell ${plan.restarts} times now, about ${plan.estimatedMinutes} minute${plan.estimatedMinutes === 1 ? "" : "s"}? ${knob}`
}

/**
 * @param {object} document the weigh document, docs/WEIGH.md
 * @param {{ colour?: boolean, env?: object }} [options] `env` is where `$HOME` is read from for `~/` in paths; the document keeps them absolute.
 */
export function renderWeigh(document, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  const { settings, baseline, noiseFloor, config } = document
  const baseRuns = baseline.pssMb.runs.length
  out.push(...field("shell", `${shellLine(document.shell.version, document.shell.omarchyPath, env)}, ${document.started}`, c))
  out.push(...field("method", `startup A/B, ${settings.runs} run${settings.runs === 1 ? "" : "s"}, a ${settings.windowSeconds} s window after a settle of ${settings.settleSeconds} s; Pss from /proc/<pid>/smaps_rollup at the end of the window, CPU from /proc/<pid>/stat over the window, children from a /proc walk every ${settings.sampleIntervalMs} ms`, c))
  out.push(...field("noise floor", noiseFloor.cpuPercent === null
    ? (baseRuns === 1 ? "none: one run has no spread, so no verdict is given (--runs 3 gives a floor)" : "unknown: no baseline run completed")
    : `${figure(noiseFloor.cpuPercent)}% CPU, the spread of ${baseRuns} baseline run${baseRuns === 1 ? "" : "s"}; a CPU delta inside it is within noise`, c))
  out.push(...field("memory", noiseFloor.pssMb === null
    ? (baseRuns === 1 ? `${figure(baseline.pssMb.median, 1)} MB Pss in the one baseline run; no spread, so no variance to state` : "unknown: no baseline run completed")
    : `within the shell's own startup variance (${figure(noiseFloor.pssMb)} MB over ${baseRuns} baseline run${baseRuns === 1 ? "" : "s"}, ${figure(noiseFloor.pssMbSettled)} MB at the settle): a fact about the shell's start, not a plugin's weight, until its two resting levels are understood (docs/MEASUREMENTS.md C1, C2)`, c))
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
    out.push(...labelled("memory", measured(plugin.shellPssMb, "MB", false), c))
    out.push(...labelled("cpu", measured(plugin.shellCpuPercent, "%", plugin.withinNoise.cpu), c))
    const spawns = plugin.childSpawns.median
    // Unattributed extras in every run are stated as a count; extras seen
    // in some runs only are stated with how many runs, so a difference in
    // one run of three is never rounded away by the median.
    const extras = plugin.unattributedChildren?.runs || []
    const runsWithExtras = extras.filter((count) => count > 0).length
    const extra = plugin.unattributedChildren?.median || 0
    const commands = `(commands: ${(plugin.unattributedCommands || []).map((command) => withHomeAbbreviated(redactedCommand(command), env)).join("; ")})`
    const unattributed = extra > 0
      ? `${figure(extra, 0)} unattributed child process${extra === 1 ? "" : "es"} ${commands}`
      : runsWithExtras > 0
        ? `up to ${figure(Math.max(...extras), 0)} unattributed child process${Math.max(...extras) === 1 ? "" : "es"} in ${runsWithExtras} of ${extras.length} runs ${commands}`
        : ""
    out.push(...labelled("children", spawns === null
      ? "no completed run"
      : spawns === 0
        ? (unattributed || "none attributed")
        : `${figure(plugin.childRssMb.median)} MB and ${figure(plugin.childCpuPercent.median)}% CPU outside the shell, ${figure(spawns, 0)} process${spawns === 1 ? "" : "es"} per window${unattributed ? `; ${unattributed}` : ""}`, c))
  }
  out.push("")
  out.push(...wrap(`Every figure is the median over ${settings.runs} run${settings.runs === 1 ? "" : "s"} of (with the plugin minus without it) with its spread, and carries its origin in the document under \`origin\`.`, {}, c))
  out.push("")
  // The closing word: weighed when every row has a verdict, a question
  // otherwise, and the file the person is left with either way.
  const unknown = document.plugins.filter((plugin) => rowState(plugin) === "unknown").length
  const count = `${document.plugins.length} plugin${document.plugins.length === 1 ? "" : "s"} over ${settings.runs} run${settings.runs === 1 ? "" : "s"}`
  const kept = config.restored ? "shell.json restored and verified." : `shell.json differs from the backup, which is kept at ${withHomeAbbreviated(config.backup, env)}.`
  out.push(...(unknown
    ? verdict("unknown", "WEIGHED", `${count}, ${unknown === document.plugins.length ? "with no verdict" : `${unknown} without a verdict`}: ${document.plugins.find((plugin) => rowState(plugin) === "unknown").verdict.summary}. ${kept}`, c)
    : verdict("pass", "WEIGHED", `${count}. ${kept}`, c)))

  // Last, because it is what an author came for: the sentence to paste, and
  // the document that is its evidence. CPU and child processes only; the
  // memory figures above are the shell's until C2 is understood.
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
