import { action, AUDIT_VERDICTS, colourEnabled, field, GUTTER, mark, styler, verdict, wrap } from "../marketplace/style.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"

/** The checkout directory as a shell takes it: `~/...` when it has no whitespace, quoted and absolute otherwise, the way every other command prints a path under the home directory. */
const shellPath = (dir) => (/\s/.test(dir) ? JSON.stringify(dir) : withHomeAbbreviated(dir))

const short = (value) => value ? String(value).slice(0, 8) : "unrecorded"
const flagText = (flags) => flags.length ? `; ${flags.join(", ")}` : ""
const markFor = (row) => {
  if (row.flags.includes("modified")) return "advisory"
  if (row.state === "validated") return "pass"
  if (["ahead", "diverged", "unverified"].includes(row.state)) return "advisory"
  if (row.state === "unlisted") return "info"
  if (row.flags.includes("disabled")) return "info"
  return "unknown"
}

function catalogText(catalog) {
  if (catalog.source === "head") return `live HEAD ${short(catalog.commit.value)} at ${catalog.readAt?.value || "an unrecorded time"}`
  return `pin ${short(catalog.commit.value)}${catalog.offline ? " (offline)" : ""}`
}

/**
 * The closing sentence, the same one the envelope carries as the error's
 * message when the exit is 1: what was compared and found validated, what
 * was compared and found off (drift), and what could not be compared, with
 * why, each clause only when its count is not zero. A row that could not
 * be compared is never said to run a commit the marketplace "never saw".
 */
export function auditSummary(document) {
  const total = document.counts.audited.value
  const good = document.counts.validated.value
  const drift = document.counts.drift.value
  const unknown = document.counts.unknown?.value ?? 0
  if (total === 0) return "no third-party plugin to audit."
  const parts = [`${good} of ${total} run a commit the marketplace validated`]
  if (drift) parts.push(`${drift} run one it never saw`)
  if (unknown) parts.push(`${unknown} could not be compared (${(document.unknownReasons || []).join("; ") || "the source directory could not be read"})`)
  return `${parts.join("; ")}.`
}

/** The closing word: AUDITED when every row was compared and validated, DRIFT when a compared row is off, NOT AUDITED when rows could not be compared and none drifted. */
export function auditVerdict(document) {
  if (document.ok) return AUDIT_VERDICTS.validated
  return document.counts.drift.value > 0 ? AUDIT_VERDICTS.drift : AUDIT_VERDICTS.unavailable
}

/** A terminal report made only from the shared style vocabulary. */
export function renderAudit(document, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("catalog", catalogText(document.catalog), c))
  out.push(...field("installed", `${document.counts.installed.value}`, c))
  out.push(...field("first-party", `${document.counts.firstPartyExcluded.value} left out`, c))
  out.push(...field("audited", `${document.counts.audited.value}`, c))
  out.push("")
  for (const row of document.rows) {
    const installed = row.installed?.commit?.value
    const validated = row.matchedValidated?.commit?.value
    const date = row.matchedValidated?.date?.value
    const detail = ["validated", "ahead"].includes(row.state)
      ? `${row.fact}${flagText(row.flags)}`
      : `${row.state}: ${row.fact}${installed ? `; HEAD ${short(installed)}` : ""}${validated ? `; validated ${short(validated)}${date ? ` on ${date}` : ""}` : ""}${flagText(row.flags)}`
    out.push(`${mark(markFor(row), c)}${c("name", row.id)}`)
    out.push(...wrap(detail, { indent: GUTTER }, c))
    if ((row.state === "ahead" || row.state === "diverged") && validated) {
      out.push(...action(`git -C ${shellPath(row.sourceDir)} checkout ${validated}`, c))
    }
    out.push("")
  }
  if (document.updateRoute) {
    out.push(...action(`To validate a newer commit: ${document.updateRoute.url}`, c))
    out.push(...wrap(`${document.updateRoute.name}; choose ${JSON.stringify(document.updateRoute.choice)}.`, { indent: GUTTER }, c))
    out.push("")
  }
  if (document.updateRouteError) {
    out.push(...wrap(`Verification route unavailable: ${document.updateRouteError}; run omakit pin.`, { indent: GUTTER }, c))
    out.push("")
  }
  out.push(...verdict(document.ok ? "pass" : "fail", auditVerdict(document), auditSummary(document), c))
  return out.join("\n")
}
