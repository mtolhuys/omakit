// Text rendering of a submit preflight, a validation watch and a doctor run, for the
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

/** The state a check renders in: an advisory failure is a note, not a FAIL, and a check that waited on another is a question. */
function stateOf(check) {
  if (check.verdict === "pass") return "pass"
  if (check.verdict === "unknown") return "unknown"
  return check.severity === "advisory" ? "advisory" : "fail"
}

/**
 * A check's head line: the mark, the id in bold, and the source in brackets
 * pushed to the right edge, so the sources form a column of their own and the
 * ids form another.
 */
function head(state, id, source, c) {
  const left = `${mark(state, c)}${c("name", id)}`
  const tag = c("punctuation", `[${source}]`)
  const gap = Math.max(2, COLUMNS - width(left) - width(tag))
  return `${left}${" ".repeat(gap)}${tag}`
}

function checkBlock(check, c) {
  const state = stateOf(check)
  const out = [head(state, check.id, check.source, c)]
  if (check.detail) out.push(...wrap(check.detail, { indent: GUTTER }, c))
  if (check.verdict === "fail") {
    // A path is the thing at fault, so it is yellow; its reason wraps under it.
    out.push(...pathLines(check.paths, c))
    for (const remedy of [].concat(check.remedy || [])) out.push(...action(remedy, c))
    // The measured reason is the point of the check, so it is not dimmed: only
    // its label is grey, and on a low-contrast theme the number still reads.
    out.push(...labelled("why", check.why, c))
  }
  return out
}

/**
 * A shell command as an arrow, broken before a flag when it would not fit:
 * a command is not prose, and a line break inside it is only valid with a
 * backslash, the way the issue-creating example at the end of the report
 * is printed.
 */
function commandLines(command, c) {
  // A flag and its value travel together; a quoted value is one word.
  const words = String(command).match(/"(?:[^"\\]|\\.)*"|\S+/g) || []
  const units = []
  for (const word of words) {
    if (units.length && units[units.length - 1].startsWith("--") && !units[units.length - 1].includes(" ") && !word.startsWith("--")) {
      units[units.length - 1] += ` ${word}`
    } else {
      units.push(word)
    }
  }
  const room = COLUMNS - STEP - " \\".length
  const lines = []
  let line = ""
  for (const unit of units) {
    const next = line ? `${line} ${unit}` : unit
    if (line && next.length > room) {
      lines.push(line)
      line = unit
    } else {
      line = next
    }
  }
  lines.push(line)
  const step = " ".repeat(STEP)
  return lines.flatMap((text, index) => (index === 0
    ? action(`${text}${lines.length > 1 ? " \\" : ""}`, c, { indent: 0 })
    : [`${step}${c("typeable", `${text}${index < lines.length - 1 ? " \\" : ""}`)}`]))
}

export function renderSubmit(result, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("subject", result.subject.repository || result.subject.directory, c, { wrapValue: false }))
  out.push(...field("commit", `${result.subject.commit}${result.subject.cleanTree ? "" : c("advisory", " (dirty worktree)")}`, c, { wrapValue: false }))
  out.push(...field("marketplace", `${result.pin.commit}, baseline ${result.pin.baselineVersion}, ${result.pin.enforcementMode}`, c))
  out.push("")

  // Passing checks run together, and so does a check that waited on another:
  // both are two quiet lines. Anything else gets a blank line on each side,
  // collapsed where two blocks meet.
  const quiet = (state) => state === "pass" || state === "unknown"
  let previous = "pass"
  for (const [index, check] of result.checks.entries()) {
    const state = stateOf(check)
    if (index > 0 && (!quiet(state) || !quiet(previous))) out.push("")
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

  if (result.outcome === "listed") {
    // The third outcome. Nothing was refused and nothing is wrong: the plugin
    // is listed by this repository, so there is no body and no reproduce
    // line, and the route to a newer commit is the marketplace's other form.
    // Measured on 0.1.6: this state was drawn as FAIL and REFUSED, and closed
    // with "Fix it, then run submit again" under a remedy that said there was
    // nothing to submit.
    const listing = result.listing
    out.push(...verdict("pass", "LISTED", `${listing.id} is already listed by this repository, so the submission form is not the route.`, c))
    out.push("")
    out.push(...field("listed", listing.verificationCommit ? c("name", listing.verificationCommit) : "no verification commit recorded", c, { wrapValue: false }))
    out.push(...continuation(`${listing.verificationStatus || "status unrecorded"}, checked ${listing.verificationCheckedAt || "at an unrecorded time"}, read from the ${listing.source === "head" ? "marketplace's current HEAD" : "pin"}`, c))
    out.push(...field("local HEAD", c("name", listing.localCommit), c, { wrapValue: false }))
    out.push(...continuation(listing.sameCommit ? "the same commit" : "not the listed commit", c))
    out.push("")
    out.push(...wrap(`${listing.sameCommit ? "To get a newer commit listed later" : "To get it listed"}, open the marketplace's "${listing.updateRoute.form}" form and choose "${listing.updateRoute.choice}". \`omakit watch <the submission issue>\` shows which commit is listed now.`, {}, c))
    return out.join("\n")
  }

  if (result.outcome === "refused") {
    // Root causes only: a check that waited on a failed one is not listed,
    // and the count says how many waited.
    const failed = result.checks.filter((check) => result.blocking.includes(check.id))
    const waited = result.checks.filter((check) => check.verdict === "unknown").length
    const count = failed.length === 1 ? "1 blocking check" : `${failed.length} blocking checks`
    const waiting = waited ? ` ${waited === 1 ? "1 check" : `${waited} checks`} could not run until ${failed.length === 1 ? "it passes" : "they pass"}.` : ""
    out.push(...verdict("fail", "REFUSED", `${count} failed, so no submission body is produced.${waiting}`, c))
    out.push("")
    for (const check of failed) {
      out.push(`${body}${c("name", check.id)}`)
      if (check.remedy) for (const remedy of [].concat(check.remedy)) out.push(...action(remedy, c))
      else out.push(...wrap(check.detail, { indent: GUTTER }, c))
      out.push("")
    }
    if (result.reproduce) {
      out.push(failed.length === 1 ? "Fix it, then run submit again:" : "Fix them, then run submit again:")
      out.push(...commandLines(result.reproduce, c))
    } else {
      out.push(failed.length === 1 ? "Fix it, then run submit again." : "Fix them, then run submit again.")
    }
    return out.join("\n")
  }

  const validation = result.validationCommit.defaultBranchHead
    ? `${result.validationCommit.local} is the ${result.validationCommit.branch || "default"}-branch HEAD, so it is the commit the marketplace will validate.`
    : `${result.validationCommit.local} is the local commit; the marketplace validates the default-branch HEAD it resolves when the issue is opened.`
  out.push(...verdict("pass", "READY", `every blocking check passed. ${validation}`, c))
  out.push("")
  out.push(...section("issue title", c))
  out.push(c("heading", result.issue.title))
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
  out.push(`${step}${c("typeable", `--title ${JSON.stringify(result.issue.title)} \\`)}`)
  out.push(`${step}${c("typeable", "--body-file <the body above>")}`)
  out.push("")
  out.push(...wrap(`After it is created: ${result.afterSubmitting}`, {}, c))
  if (result.reproduce) {
    out.push("")
    out.push("The same run, without prompting:")
    out.push(...commandLines(result.reproduce, c))
  }
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
    out.push(...field("validated", c("name", result.validated.commit), c, { wrapValue: false }))
    out.push(...continuation(`outcome ${result.validated.outcome}, ${result.validated.findings.length} finding(s), ${result.validated.capabilities.length} capability/ies, checked ${result.validated.checkedAt}`, c))
  } else if (result.validationCommentFallback) {
    out.push(...field("validated", `${result.validationCommentFallback.short} (short form, from the validation comment)`, c))
  } else {
    out.push(...field("validated", "none", c))
  }
  if (result.head) {
    const sha = result.verdict.state === "stale" ? c("fail", result.head.commit) : c("name", result.head.commit)
    out.push(...field("current HEAD", sha, c, { wrapValue: false }))
    out.push(...continuation(`${result.head.branch || "default"} branch, via ${result.head.source}${result.head.committedAt ? `, ${result.head.committedAt}` : ""}`, c))
  } else if (result.headError) {
    out.push(...field("current HEAD", `unreadable: ${result.headError.message}`, c))
  }
  out.push("")
  const state = { current: "pass", stale: "fail", unknown: "unknown" }[result.verdict.state] || "unknown"
  out.push(...verdict(state, `VALIDATION ${result.verdict.state.toUpperCase()}`, result.verdict.summary, c))
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

/** A list of paths at fault, the way a failing check prints them: a tinted dash, the path in the placeholder tint. */
function pathLines(paths, c, dash = "fail") {
  return paths.flatMap((path) => wrap(`- ${path}`, { indent: GUTTER + STEP, first: GUTTER })
    .map((line, index) => (index === 0
      ? `${body}${c(dash, "-")} ${c("placeholder", line.trimStart().slice(2))}`
      : `${" ".repeat(GUTTER + STEP)}${c("placeholder", line.trimStart())}`)))
}

/**
 * `omakit verify` for a person: the subject, the pin, the transport and its
 * assumptions, then the official result in the register submit uses for its
 * checks, and the statement last. Nothing here is Omakit's judgement: the
 * outcome, the disposition, each finding's title, reason and actions, and a
 * refusal's message are the marketplace's own text verbatim; the one thing
 * added is the tag on each finding, blocks publication or review-required,
 * which is read from the pinned policy's selectively blocking rules
 * (`blockingRules`). `--json` prints the document itself.
 */
export function renderVerify(document, { colour = colourEnabled(), blockingRules = [] } = {}) {
  const c = styler(colour)
  const out = []
  const { subject, marketplaceBaseline: section } = document
  const tree = subject.cleanTree?.clean
    ? `clean tree, proof ${subject.cleanTree.proof}`
    : c("advisory", "dirty worktree")
  out.push(...field("subject", subject.repository?.url || "no declared GitHub repository URL", c, { wrapValue: false }))
  out.push(...field("commit", subject.commit, c, { wrapValue: false }))
  out.push(...continuation(`${tree}, ${subject.mode} mode`, c))
  out.push(...field("marketplace", `${section.pin.commit}, baseline ${section.pin.baselineVersion}, ${section.pin.enforcementMode}`, c))
  out.push(...field("transport", section.transport, c))
  if (section.assumedByAdapter?.length) out.push(...field("assumed", section.assumedByAdapter.join(", "), c))
  out.push("")

  const official = section.official
  if (!section.invoked) {
    out.push(`${head("unknown", "not run", "marketplace-pin", c)}`)
    out.push(...wrap(section.skipReason || "the official baseline was not invoked", { indent: GUTTER }, c))
  } else if (official?.error) {
    // The official code refused the snapshot: that refusal is the result.
    out.push(`${head("fail", official.error.code, "marketplace-pin", c)}`)
    out.push(...wrap(official.error.message, { indent: GUTTER }, c))
    for (const [key, value] of Object.entries(official.error)) {
      if (key === "code" || key === "message") continue
      out.push(...wrap(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`, { indent: GUTTER + STEP, first: GUTTER }, c))
    }
  } else {
    const findings = official.findings || []
    const capabilities = official.capabilities || []
    const state = official.outcome === "passed" ? "pass" : official.blocksApproval ? "fail" : "advisory"
    out.push(`${head(state, official.outcome, "marketplace-pin", c)}`)
    out.push(...wrap(official.outcome === "passed"
      ? "no findings and no capabilities"
      : `disposition ${official.disposition}, enforcement ${official.enforcementMode}, blocksApproval ${official.blocksApproval}`, { indent: GUTTER }, c))
    for (const finding of findings) {
      const blocks = blockingRules.includes(finding.ruleId)
      out.push("")
      out.push(head(blocks ? "fail" : "advisory", finding.ruleId, blocks ? "blocks publication" : "review-required", c))
      out.push(...wrap([finding.title, finding.why].filter(Boolean).join(". ").replace(/\.\.\s/g, ". "), { indent: GUTTER }, c))
      out.push(...pathLines((finding.evidence || []).map((entry) => `${entry.path}:${entry.line}`), c, blocks ? "fail" : "advisory"))
      for (const remedy of finding.actions || []) out.push(...action(remedy, c))
    }
    for (const capability of capabilities) {
      out.push("")
      out.push(head("info", capability.id, "capability", c))
      out.push(...wrap([capability.title, capability.why].filter(Boolean).join(". ").replace(/\.\.\s/g, ". "), { indent: GUTTER }, c))
      out.push(...pathLines((capability.evidence || []).map((entry) => `${entry.path}:${entry.line}`), c, "info"))
    }
  }
  out.push("")
  out.push(...wrap(section.statement, {}, c))
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
    out.push(`${mark(state, c)}${c("name", check.id)}`)
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
