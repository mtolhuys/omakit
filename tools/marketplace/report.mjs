// Text rendering of a submit preflight and a pin watch, for the agent that
// runs this tool. Every check prints its verdict, its source and the measured
// reason it exists; a failing check prints its paths and its remedy.
//
// Colour is added only when a person is looking at a terminal; see style.mjs.
// The text itself is identical either way, so a piped run and a watched run say
// exactly the same thing.

import { colourEnabled, styler } from "./style.mjs"

const MARK = { pass: "ok  ", fail: "FAIL" }

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ""
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.map((entry) => `${indent}${entry}`).join("\n")
}

export function renderSubmit(result, { width = 78, colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(`${c("grey", "subject     ")} ${result.subject.repository || result.subject.directory}`)
  out.push(`${c("grey", "commit      ")} ${result.subject.commit}${result.subject.cleanTree ? "" : c("yellow", "  (dirty worktree)")}`)
  out.push(`${c("grey", "marketplace ")} pin ${result.pin.commit} (baseline ${result.pin.baselineVersion}, ${result.pin.enforcementMode})`)
  out.push("")

  for (const check of result.checks) {
    const severity = check.severity === "advisory" && check.verdict === "fail" ? " (advisory)" : ""
    const mark = check.verdict === "pass" ? c("green", MARK.pass) : c("red.bold", MARK.fail)
    out.push(`${mark} ${c("bold", check.id)}${severity ? c("yellow", severity) : ""}  ${c("grey", `[${check.source}]`)}`)
    if (check.detail) out.push(wrap(check.detail, width, "       "))
    if (check.verdict === "fail") {
      for (const path of check.paths) out.push(`       ${c("red", "-")} ${c("yellow", path)}`)
      if (check.remedy) out.push(c("cyan", wrap(`remedy: ${check.remedy}`, width, "       ")))
      out.push(c("grey", wrap(`why this check exists: ${check.why}`, width, "       ")))
    }
    out.push("")
  }

  if (result.baseline?.officialReport) {
    out.push(c("grey", "--- the marketplace's own baseline report for this commit ---"))
    out.push("")
    out.push(result.baseline.officialReport)
    out.push("")
    out.push(wrap(result.baseline.statement, width, ""))
    out.push("")
  }

  if (!result.ready) {
    out.push(c("red.bold", `REFUSED: ${result.blocking.length} blocking check(s) failed: ${result.blocking.join(", ")}`))
    out.push("No submission body is produced. Fix the failures above and run submit again.")
    return out.join("\n")
  }

  out.push(`Pinned commit: ${result.pinnedCommit.local}`)
  if (result.pinnedCommit.defaultBranchHead) {
    out.push(`  = ${result.pinnedCommit.branch || "default"}-branch HEAD (${result.pinnedCommit.defaultBranchHead})`)
  }
  out.push("")
  out.push(c("grey", "--- issue title ---"))
  out.push(c("bold", result.issue.title))
  out.push("")
  out.push(c("grey", "--- issue body ---"))
  out.push(result.issue.body.trimEnd())
  out.push("")
  out.push("This is not posted. Ask the plugin owner to approve it, then create the")
  out.push("issue yourself, for example:")
  out.push("")
  out.push("  gh issue create --repo omacom/omarchy-plugin-marketplace \\")
  out.push(`    --title ${JSON.stringify(result.issue.title)} \\`)
  out.push("    --body-file <the body above>")
  out.push("")
  out.push(wrap(`After it is created: ${result.afterSubmitting}`, width, ""))
  return out.join("\n")
}

export function renderWatch(result, { width = 78, colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(`${c("grey", "issue       ")} ${result.read.issue}  (${result.read.state})`)
  out.push(`${c("grey", "title       ")} ${result.read.title}`)
  if (result.read.labels.length) out.push(`${c("grey", "labels      ")} ${result.read.labels.join(", ")}`)
  out.push(`${c("grey", "plugin repo ")} ${result.plugin.repository || `unreadable: ${result.plugin.repositoryError}`}`)
  out.push("")
  if (result.validated) {
    out.push(`${c("grey", "validated   ")} ${c("bold", result.validated.commit)}`)
    out.push(`             outcome ${result.validated.outcome}, ${result.validated.findings.length} finding(s), ${result.validated.capabilities.length} capability/ies, checked ${result.validated.checkedAt}`)
  } else if (result.validationCommentFallback) {
    out.push(`${c("grey", "validated   ")} ${result.validationCommentFallback.short} (short form, from the validation comment)`)
  } else {
    out.push(`${c("grey", "validated   ")} none`)
  }
  if (result.head) {
    const sha = result.verdict.state === "stale" ? c("red.bold", result.head.commit) : c("bold", result.head.commit)
    out.push(`${c("grey", "current HEAD")} ${sha}  (${result.head.branch || "default"} branch, via ${result.head.source}${result.head.committedAt ? `, ${result.head.committedAt}` : ""})`)
  } else if (result.headError) {
    out.push(`${c("grey", "current HEAD")} unreadable: ${result.headError.message}`)
  }
  out.push("")
  const badge = { current: "green.bold", stale: "red.bold", unknown: "yellow.bold" }[result.verdict.state] || "bold"
  out.push(c(badge, `PIN ${result.verdict.state.toUpperCase()}`))
  out.push(wrap(result.verdict.summary, width, "  "))
  if (result.verdict.action) {
    out.push("")
    out.push(c("cyan", wrap(result.verdict.action, width, "  ")))
  }
  out.push("")
  out.push(c("grey", wrap(
    `Read-only. This command did not comment, label or edit anything. Comments on the issue: ${result.read.comments} (${result.read.authorComments} from the author, ${result.read.maintainerComments} from a reviewer).`,
    width,
    "",
  )))
  return out.join("\n")
}

const DOCTOR_MARK = { ok: "ok    ", advice: "note  ", problem: "PROBLEM", info: "      ", unknown: "?     " }

export function renderDoctor(result, { width = 78, colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  for (const check of result.checks) {
    const tint = { ok: "green", advice: "yellow", problem: "red.bold", unknown: "yellow", info: "grey" }[check.state] || "grey"
    out.push(`${c(tint, DOCTOR_MARK[check.state] || "      ")} ${c("bold", check.id)}`)
    out.push(wrap(check.detail, width, "        "))
    if (check.action) out.push(c("cyan", wrap(check.action, width, "        ")))
    out.push("")
  }
  out.push(result.problems
    ? c("red.bold", `${result.problems} problem(s) to fix before omakit can run.`)
    : c("green", "Ready."))
  return out.join("\n")
}
