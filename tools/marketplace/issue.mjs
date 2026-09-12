// Render the submission issue exactly as GitHub's own issue form would render
// it, from the contract read at the pin, and then prove the result by running
// the marketplace's own parser over it.
//
// Measured reason the rendering is generated rather than hand-written
// (docs/MEASUREMENTS.md M2): 39 submissions failed on the title prefix alone
// and 11 open submissions are malformed in the body, one of them by the single
// word "Suggested" instead of "Suggest". Hand-typing six headings is how that
// happens. Generating them from the form and then parsing the result with
// `parseCurrentSubmission` from the same commit removes the class entirely: if
// the marketplace's parser accepts the body here, it accepts it there.

export const NO_RESPONSE = "_No response_"

export class IssueRenderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "IssueRenderError"
    this.code = code
  }
}

function heading(text) {
  return `### ${text}`
}

/**
 * @param {object} contract from submissionContract()
 * @param {{ pluginName: string, repositoryUrl: string, category: string,
 *           tags: string[], suggestedTag?: string, notes?: string }} input
 */
export function renderIssue(contract, input) {
  const name = String(input.pluginName || "").trim()
  if (!name) throw new IssueRenderError("plugin-name-missing", "the issue title needs the plugin name")
  const title = `${contract.titleTemplate}${name}`

  const values = new Map([
    [contract.headingFor.repository, String(input.repositoryUrl || "").trim()],
    [contract.headingFor.category, String(input.category || "").trim()],
    [contract.headingFor.tags, (input.tags || []).join(", ")],
  ])

  const checklistBlock = contract.checklist.map((item) => `- [X] ${item.label}`).join("\n")

  // Optional free-text fields keyed by heading, so a renamed or reordered form
  // field cannot silently drop the author's text.
  const optional = new Map()
  for (const field of contract.fields) {
    if (values.has(field.label) || field.label === contract.headingFor.checklist) continue
    if (field.type === "input") optional.set(field.label, String(input.suggestedTag || "").trim())
    else optional.set(field.label, String(input.notes || "").trim())
  }

  const sections = []
  for (const label of contract.headings) {
    let body
    if (label === contract.headingFor.checklist) body = checklistBlock
    else if (values.has(label)) body = values.get(label)
    else body = optional.get(label) ?? ""
    sections.push(`${heading(label)}\n\n${body || NO_RESPONSE}`)
  }

  return { title, body: `${sections.join("\n\n")}\n` }
}

/**
 * Run the marketplace's own submission parser over a rendered issue. The
 * parser comes from the pinned checkout, so this is the marketplace accepting
 * or refusing the body, not Omakit's opinion of it.
 *
 * @returns {{ ok: true, submission: object } | { ok: false, code: string, message: string }}
 */
export function verifyAgainstOfficialParser(contract, issue) {
  try {
    const submission = contract.parseCurrentSubmission({ title: issue.title, body: issue.body })
    return { ok: true, submission }
  } catch (error) {
    return { ok: false, code: error.code || "submission-invalid", message: error.message }
  }
}
