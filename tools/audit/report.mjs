import { action, AUDIT_VERDICTS, colourEnabled, field, GUTTER, mark, styler, verdict, wrap } from "../marketplace/style.mjs"

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

/** A terminal report made only from the shared style vocabulary. */
export function renderAudit(document, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("catalog", catalogText(document.catalog), c))
  out.push(...field("installed", `${document.counts.installed.value}`, c))
  out.push(...field("first-party", `${document.counts.firstPartyExcluded.value} left out`, c))
  out.push("")
  for (const row of document.rows) {
    const installed = row.installed?.commit?.value
    const validated = row.matchedValidated?.commit?.value
    const date = row.matchedValidated?.date?.value
    const detail = `${row.state}: ${row.fact}${installed ? `; HEAD ${short(installed)}` : ""}${validated ? `; validated ${short(validated)}${date ? ` on ${date}` : ""}` : ""}${flagText(row.flags)}`
    out.push(`${mark(markFor(row), c)}${c("name", row.id)}`)
    out.push(...wrap(detail, { indent: GUTTER }, c))
    if ((row.state === "ahead" || row.state === "diverged") && validated) {
      out.push(...action(`git -C ${JSON.stringify(row.sourceDir)} checkout ${validated}`, c))
      if (document.updateRoute) out.push(...action(`To validate a newer commit, open ${document.updateRoute.formPath}, ${document.updateRoute.name}, and choose ${JSON.stringify(document.updateRoute.choice)}.`, c))
    }
    out.push("")
  }
  const total = document.counts.audited.value
  const good = document.counts.validated.value
  const drift = document.counts.drift.value
  out.push(...verdict(document.ok ? "pass" : "fail", document.ok ? AUDIT_VERDICTS.validated : AUDIT_VERDICTS.drift, `${good} of ${total} run a commit the marketplace validated; ${drift} run one it never saw.`, c))
  return out.join("\n")
}
