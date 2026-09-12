// Text rendering of a submit preflight, a pin watch and a doctor run, for the
// agent that runs this tool and the person reading over its shoulder. Every
// check prints its verdict, its source and the measured reason it exists; a
// failing check prints its paths and the one action that clears it.
//
// Everything here is drawn with style.mjs and nothing of its own: the marks,
// the columns, the arrow and the rule are the same ones every other command
// uses. Colour is added only when a person is looking at a terminal. The text
// itself is identical either way, so a piped run and a watched run say exactly
// the same thing.
//
// Two decisions are about scanning rather than reading. Passing checks are
// dense, two lines each with nothing between them, and a failing check is a
// block with a blank line on either side, so on a monochrome theme the
// failures are still the things with air around them. And a refusal ends with
// the failing checks and their actions again, because after fifteen checks and
// the marketplace's forty-line report the fail blocks are off the top of the
// screen, and the last screen is the one a person is looking at.

import {
  action, colourEnabled, COLUMNS, continuation, field, GUTTER, labelled, mark, section, STEP, styler, verdict, width, wrap,
} from "./style.mjs"

const body = " ".repeat(GUTTER)

/** The state a check renders in: an advisory failure is a note, not a FAIL. */
function stateOf(check) {
  if (check.verdict === "pass") return "pass"
  return check.severity === "advisory" ? "advisory" : "fail"
}

/**
 * A check's head line: the mark, the id in bold, and the source in brackets
 * pushed to the right edge, so the sources form a column of their own and the
 * ids form another.
 */
function head(state, id, source, c) {
  const left = `${mark(state, c)}${c("bold", id)}`
  const tag = c("grey", `[${source}]`)
  const gap = Math.max(2, COLUMNS - width(left) - width(tag))
  return `${left}${" ".repeat(gap)}${tag}`
}

function checkBlock(check, c) {
  const state = stateOf(check)
  const out = [head(state, check.id, check.source, c)]
  if (check.detail) out.push(...wrap(check.detail, { indent: GUTTER }, c))
  if (check.verdict === "fail") {
    // A path is the thing at fault, so it is yellow; its reason wraps under it.
    for (const path of check.paths) {
      out.push(...wrap(`- ${path}`, { indent: GUTTER + STEP, first: GUTTER })
        .map((line, index) => (index === 0
          ? `${body}${c("red", "-")} ${c("yellow", line.trimStart().slice(2))}`
          : `${" ".repeat(GUTTER + STEP)}${c("yellow", line.trimStart())}`)))
    }
    if (check.remedy) out.push(...action(check.remedy, c))
    // The measured reason is the point of the check, so it is not dimmed: only
    // its label is grey, and on a low-contrast theme the number still reads.
    out.push(...labelled("why", check.why, c))
  }
  return out
}

export function renderSubmit(result, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("subject", result.subject.repository || result.subject.directory, c, { wrapValue: false }))
  out.push(...field("commit", `${result.subject.commit}${result.subject.cleanTree ? "" : c("yellow", " (dirty worktree)")}`, c, { wrapValue: false }))
  out.push(...field("marketplace", `${result.pin.commit}, baseline ${result.pin.baselineVersion}, ${result.pin.enforcementMode}`, c))
  out.push("")

  // Passing checks run together; anything else gets a blank line on each side,
  // collapsed where two blocks meet.
  let previous = "pass"
  for (const [index, check] of result.checks.entries()) {
    const state = stateOf(check)
    if (index > 0 && (state !== "pass" || previous !== "pass")) out.push("")
    out.push(...checkBlock(check, c))
    previous = state
  }
  out.push("")

  if (result.baseline?.officialReport) {
    out.push(...section("the marketplace's own baseline report for this commit", c))
    out.push(result.baseline.officialReport)
    out.push("")
    out.push(...wrap(result.baseline.statement, {}, c))
    out.push("")
  }

  if (!result.ready) {
    const failed = result.checks.filter((check) => result.blocking.includes(check.id))
    const count = failed.length === 1 ? "1 blocking check" : `${failed.length} blocking checks`
    out.push(...verdict("fail", "REFUSED", `${count} failed, so no submission body is produced.`, c))
    out.push("")
    for (const check of failed) {
      out.push(`${body}${c("bold", check.id)}`)
      if (check.remedy) out.push(...action(check.remedy, c))
      else out.push(...wrap(check.detail, { indent: GUTTER }, c))
      out.push("")
    }
    out.push(failed.length === 1 ? "Fix it, then run submit again." : "Fix them, then run submit again.")
    return out.join("\n")
  }

  const pinned = result.pinnedCommit.defaultBranchHead
    ? `${result.pinnedCommit.local} is the ${result.pinnedCommit.branch || "default"}-branch HEAD, so it is the commit the review will be pinned to.`
    : `${result.pinnedCommit.local} is the local commit; the review is pinned to the default-branch HEAD at validation time.`
  out.push(...verdict("pass", "READY", `every blocking check passed. ${pinned}`, c))
  out.push("")
  out.push(...section("issue title", c))
  out.push(c("bold", result.issue.title))
  out.push("")
  out.push(...section("issue body", c))
  out.push(result.issue.body.trimEnd())
  out.push("")
  out.push(...wrap("This is not posted. Ask the plugin owner to approve it, then create the issue yourself, for example:", {}, c))
  out.push("")
  // The one action, as a command a person runs. It is not wrapped as prose
  // because a shell command breaks on its backslashes, not on its spaces.
  const step = " ".repeat(STEP)
  out.push(...action("gh issue create --repo omacom/omarchy-plugin-marketplace \\", c, { indent: 0 }))
  out.push(`${step}${c("cyan", `--title ${JSON.stringify(result.issue.title)} \\`)}`)
  out.push(`${step}${c("cyan", "--body-file <the body above>")}`)
  out.push("")
  out.push(...wrap(`After it is created: ${result.afterSubmitting}`, {}, c))
  return out.join("\n")
}

export function renderWatch(result, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("issue", result.read.issue, c, { wrapValue: false }))
  out.push(...field("state", `${result.read.state}${result.read.labels.length ? `; labels ${result.read.labels.join(", ")}` : ""}`, c))
  out.push(...field("title", result.read.title, c))
  out.push(...field("plugin repo", result.plugin.repository || `unreadable: ${result.plugin.repositoryError}`, c, { wrapValue: false }))
  if (result.plugin.form === "verify" || result.plugin.form === "verify-legacy") {
    out.push(...field("form", "plugin update request, read with the marketplace's verification parser", c))
  }
  out.push("")
  if (result.validated) {
    out.push(...field("validated", c("bold", result.validated.commit), c, { wrapValue: false }))
    out.push(...continuation(`outcome ${result.validated.outcome}, ${result.validated.findings.length} finding(s), ${result.validated.capabilities.length} capability/ies, checked ${result.validated.checkedAt}`, c))
  } else if (result.validationCommentFallback) {
    out.push(...field("validated", `${result.validationCommentFallback.short} (short form, from the validation comment)`, c))
  } else {
    out.push(...field("validated", "none", c))
  }
  if (result.head) {
    const sha = result.verdict.state === "stale" ? c("red.bold", result.head.commit) : c("bold", result.head.commit)
    out.push(...field("current HEAD", sha, c, { wrapValue: false }))
    out.push(...continuation(`${result.head.branch || "default"} branch, via ${result.head.source}${result.head.committedAt ? `, ${result.head.committedAt}` : ""}`, c))
  } else if (result.headError) {
    out.push(...field("current HEAD", `unreadable: ${result.headError.message}`, c))
  }
  out.push("")
  const state = { current: "pass", stale: "fail", unknown: "unknown" }[result.verdict.state] || "unknown"
  out.push(...verdict(state, `PIN ${result.verdict.state.toUpperCase()}`, result.verdict.summary, c))
  if (result.verdict.action) {
    out.push("")
    out.push(...action(result.verdict.action, c, { indent: 0 }))
  }
  out.push("")
  out.push(...wrap(
    `Read-only. This command did not comment, label or edit anything. Comments on the issue: ${result.read.comments} (${result.read.authorComments} from the author, ${result.read.maintainerComments} from a reviewer).`,
    {},
    c,
  ))
  return out.join("\n")
}

const DOCTOR_STATE = { ok: "pass", advice: "advisory", problem: "fail", info: "info", unknown: "unknown" }

export function renderDoctor(result, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  let previous = false
  for (const [index, check] of result.checks.entries()) {
    const state = DOCTOR_STATE[check.state] || "unknown"
    const loud = state === "fail" || state === "advisory"
    if (index > 0 && (loud || previous)) out.push("")
    out.push(`${mark(state, c)}${c("bold", check.id)}`)
    out.push(...wrap(check.detail, { indent: GUTTER }, c))
    if (check.action) out.push(...action(check.action, c))
    previous = loud
  }
  out.push("")
  out.push(...(result.problems
    ? verdict("fail", "NOT READY", `${result.problems === 1 ? "1 problem" : `${result.problems} problems`} to fix before omakit can run.`, c)
    : verdict("pass", "READY", "nothing to fix.", c)))
  return out.join("\n")
}
