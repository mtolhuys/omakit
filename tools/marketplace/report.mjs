// Text rendering of a submit preflight and a pin watch, for the agent that
// runs this tool. Every check prints its verdict, its source and the measured
// reason it exists; a failing check prints its paths and its remedy.

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

export function renderSubmit(result, { width = 78 } = {}) {
  const out = []
  out.push(`subject      ${result.subject.repository || result.subject.directory}`)
  out.push(`commit       ${result.subject.commit}${result.subject.cleanTree ? "" : "  (dirty worktree)"}`)
  out.push(`marketplace  pin ${result.pin.commit} (baseline ${result.pin.baselineVersion}, ${result.pin.enforcementMode})`)
  out.push("")

  for (const check of result.checks) {
    const severity = check.severity === "advisory" && check.verdict === "fail" ? " (advisory)" : ""
    out.push(`${MARK[check.verdict]} ${check.id}${severity}  [${check.source}]`)
    if (check.detail) out.push(wrap(check.detail, width, "       "))
    if (check.verdict === "fail") {
      for (const path of check.paths) out.push(`       - ${path}`)
      if (check.remedy) out.push(wrap(`remedy: ${check.remedy}`, width, "       "))
      out.push(wrap(`why this check exists: ${check.why}`, width, "       "))
    }
    out.push("")
  }

  if (result.baseline?.officialReport) {
    out.push("--- the marketplace's own baseline report for this commit ---")
    out.push("")
    out.push(result.baseline.officialReport)
    out.push("")
    out.push(wrap(result.baseline.statement, width, ""))
    out.push("")
  }

  if (!result.ready) {
    out.push(`REFUSED: ${result.blocking.length} blocking check(s) failed: ${result.blocking.join(", ")}`)
    out.push("No submission body is produced. Fix the failures above and run submit again.")
    return out.join("\n")
  }

  out.push(`Pinned commit: ${result.pinnedCommit.local}`)
  if (result.pinnedCommit.defaultBranchHead) {
    out.push(`  = ${result.pinnedCommit.branch || "default"}-branch HEAD (${result.pinnedCommit.defaultBranchHead})`)
  }
  out.push("")
  out.push("--- issue title ---")
  out.push(result.issue.title)
  out.push("")
  out.push("--- issue body ---")
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

export function renderWatch(result, { width = 78 } = {}) {
  const out = []
  out.push(`issue        ${result.read.issue}  (${result.read.state})`)
  out.push(`title        ${result.read.title}`)
  out.push(`author       ${result.read.author}`)
  if (result.read.labels.length) out.push(`labels       ${result.read.labels.join(", ")}`)
  out.push(`plugin repo  ${result.plugin.repository || `unreadable: ${result.plugin.repositoryError}`}`)
  out.push("")
  if (result.validated) {
    out.push(`validated    ${result.validated.commit}`)
    out.push(`             outcome ${result.validated.outcome}, ${result.validated.findings.length} finding(s), ${result.validated.capabilities.length} capability/ies, checked ${result.validated.checkedAt}`)
  } else if (result.validationCommentFallback) {
    out.push(`validated    ${result.validationCommentFallback.short} (short form, from the validation comment)`)
  } else {
    out.push("validated    none")
  }
  if (result.head) {
    out.push(`current HEAD ${result.head.commit}  (${result.head.branch || "default"} branch, via ${result.head.source}${result.head.committedAt ? `, ${result.head.committedAt}` : ""})`)
  } else if (result.headError) {
    out.push(`current HEAD unreadable: ${result.headError.message}`)
  }
  out.push("")
  out.push(`PIN ${result.verdict.state.toUpperCase()}`)
  out.push(wrap(result.verdict.summary, width, "  "))
  if (result.verdict.action) {
    out.push("")
    out.push(wrap(result.verdict.action, width, "  "))
  }
  out.push("")
  out.push(wrap(
    `Read-only. This command did not comment, label or edit anything. Comments on the issue: ${result.read.comments} (${result.read.authorComments} from the author, ${result.read.maintainerComments} from a reviewer).`,
    width,
    "",
  ))
  return out.join("\n")
}
