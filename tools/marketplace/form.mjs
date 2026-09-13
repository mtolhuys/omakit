// The submission contract, read from the pinned marketplace checkout.
//
// Nothing about the submission format is written down in Omakit. The title
// prefix, the field order, the controlled category and tag lists and the exact
// checklist text all come from the form an author actually fills in,
// `.github/ISSUE_TEMPLATE/submit-plugin.yml`, at the pinned commit. Updating
// the pin changes the contract; no Omakit source changes.
//
// Measured reason this is derived rather than copied (docs/MEASUREMENTS.md M2):
// 39 submissions fell out on the title prefix alone, 14 of them still open and
// 7 rescued by hand; 11 more open submissions are malformed in the body and get
// "The validation result could not be published to the issue. A maintainer must
// review the workflow.", which blames the maintainer for the author's mistake.
// One of those 11 differs from a valid submission by the single word
// "Suggested" instead of "Suggest". A contract that drifts from the form by one
// word reproduces exactly that failure, so the form is the only source.
//
// The derived contract is then cross-checked against the marketplace's own
// constants in `scripts/submission.mjs` at the same commit. Both halves must
// agree; divergence is a loud failure, never a silent guess.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseYaml } from "./yaml.mjs"
import { requirePin } from "./pin.mjs"

export const SUBMIT_FORM_PATH = ".github/ISSUE_TEMPLATE/submit-plugin.yml"
export const OFFICIAL_SUBMISSION_MODULE = "scripts/submission.mjs"
export const VERIFY_FORM_PATH = ".github/ISSUE_TEMPLATE/verify-plugin.yml"
export const OFFICIAL_VERIFICATION_MODULE = "scripts/plugin-verification-request.mjs"

export class ContractError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "ContractError"
    this.code = code
  }
}

/**
 * The marketplace lowercases a submitted tag and joins words with a hyphen
 * (`normalizeTag` in scripts/submission.mjs). Omakit does not assume that
 * mapping: every label it derives is checked against the official
 * `allowedTags` below, so a form label that stops mapping is an error.
 */
export function tagSlug(label) {
  return String(label).trim().toLowerCase().replace(/\s+/g, "-")
}

function loadOfficial(pinDir) {
  return import(pathToFileURL(join(pinDir, OFFICIAL_SUBMISSION_MODULE)).href)
}

function fieldsOf(form, formPath = SUBMIT_FORM_PATH) {
  if (!Array.isArray(form?.body)) throw new ContractError("form-unreadable", `${formPath} has no body`)
  return form.body
    .filter((item) => item && item.type !== "markdown")
    .map((item) => ({
      id: item.id || "",
      type: item.type || "",
      label: item.attributes?.label || "",
      description: item.attributes?.description || "",
      options: Array.isArray(item.attributes?.options) ? item.attributes.options : null,
      multiple: item.attributes?.multiple === true,
      required: item.validations?.required === true,
    }))
}

function only(fields, predicate, what, formPath = SUBMIT_FORM_PATH) {
  const found = fields.filter(predicate)
  if (found.length !== 1) {
    throw new ContractError(
      "form-shape-changed",
      `${formPath} no longer has exactly one ${what} (found ${found.length}); the pin changed shape and the submission contract must be re-read before anything is generated`,
    )
  }
  return found[0]
}

/**
 * Read the submission contract from the pinned checkout.
 * @param {{ repoRoot?: string, pinDir?: string }} [options]
 */
export async function submissionContract(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const raw = readFileSync(join(pinDir, SUBMIT_FORM_PATH), "utf8")
  const form = parseYaml(raw)
  const fields = fieldsOf(form)

  const titleTemplate = typeof form.title === "string" ? form.title : ""
  if (!titleTemplate.trim()) throw new ContractError("form-shape-changed", `${SUBMIT_FORM_PATH} has no title template`)

  const repository = only(fields, (f) => f.type === "input" && f.required, "required repository input")
  const category = only(fields, (f) => f.type === "dropdown" && !f.multiple, "single-select dropdown (category)")
  const tags = only(fields, (f) => f.type === "dropdown" && f.multiple, "multi-select dropdown (tags)")
  const checklist = only(fields, (f) => f.type === "checkboxes", "checkboxes group (submission checklist)")

  const official = await loadOfficial(pinDir)

  const headings = fields.map((field) => field.label)
  if (headings.some((heading) => !heading)) throw new ContractError("form-shape-changed", `${SUBMIT_FORM_PATH} has a field without a label`)

  const checklistItems = (checklist.options || []).map((option) =>
    typeof option === "string" ? { label: option, required: false } : { label: option.label, required: option.required === true },
  )

  const contract = {
    formPath: SUBMIT_FORM_PATH,
    titleTemplate,
    titlePrefix: titleTemplate.trimEnd(),
    labels: Array.isArray(form.labels) ? [...form.labels] : [],
    headings,
    fields,
    headingFor: {
      repository: repository.label,
      category: category.label,
      tags: tags.label,
      checklist: checklist.label,
    },
    categories: [...(category.options || [])],
    tagLabels: [...(tags.options || [])],
    checklist: checklistItems,
    maximumTags: official.maximumSubmissionTags,
    official: {
      titlePrefix: official.submissionTitlePrefix,
      allowedCategories: [...official.allowedCategories],
      allowedTags: [...official.allowedTags],
      maximumSubmissionTags: official.maximumSubmissionTags,
      checklist: [...official.submissionChecklist],
    },
    parseCurrentSubmission: official.parseCurrentSubmission,
    extractRepositoryUrl: official.extractRepositoryUrl,
  }

  assertContractAgrees(contract)
  return contract
}

/**
 * The route for a plugin that is already listed: the marketplace's other
 * form, and the one choice on it that lists a newer commit. Both read from
 * the pin. The choice text is the option as the form spells it, found by the
 * name the marketplace's own verification module gives that action; the two
 * must agree, the way the submission form and `scripts/submission.mjs` must,
 * because a choice retyped here would drift by a word and send a person to
 * pick something the form no longer offers.
 *
 * @param {{ repoRoot?: string, pinDir?: string }} [options]
 * @returns {Promise<{ formPath: string, name: string, choice: string }>}
 */
export async function newerCommitChoice(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const form = parseYaml(readFileSync(join(pinDir, VERIFY_FORM_PATH), "utf8"))
  const fields = fieldsOf(form, VERIFY_FORM_PATH)
  const action = only(fields, (f) => f.type === "dropdown" && !f.multiple && f.required, "required single-select dropdown (verification action)", VERIFY_FORM_PATH)
  const official = await import(pathToFileURL(join(pinDir, OFFICIAL_VERIFICATION_MODULE)).href)
  const choice = (action.options || []).find((option) => option === official.upstreamUpdateVerificationAction)
  if (!choice) {
    throw new ContractError(
      "form-shape-changed",
      `${VERIFY_FORM_PATH} offers no "${official.upstreamUpdateVerificationAction}" under ${action.label}; the form and ${OFFICIAL_VERIFICATION_MODULE} at the pin disagree, and nobody is sent to a choice that is not there`,
    )
  }
  const name = typeof form.name === "string" ? form.name.trim() : ""
  if (!name) throw new ContractError("form-shape-changed", `${VERIFY_FORM_PATH} has no name`)
  return { formPath: VERIFY_FORM_PATH, name, choice }
}

/**
 * The form and the marketplace's own constants must describe the same
 * submission. Anything else means the pin is internally inconsistent, and
 * generating a body from half of it would produce the malformed submissions
 * this tool exists to prevent.
 */
export function assertContractAgrees(contract) {
  const divergence = []
  if (!contract.titlePrefix.startsWith(contract.official.titlePrefix)) {
    divergence.push(`form title ${JSON.stringify(contract.titleTemplate)} does not start with the official prefix ${JSON.stringify(contract.official.titlePrefix)}`)
  }
  const categories = contract.categories.join("|")
  const officialCategories = contract.official.allowedCategories.join("|")
  if (categories !== officialCategories) {
    divergence.push(`form categories [${categories}] differ from allowedCategories [${officialCategories}]`)
  }
  const slugs = contract.tagLabels.map(tagSlug)
  const unmapped = slugs.filter((slug) => !contract.official.allowedTags.includes(slug))
  if (unmapped.length) {
    divergence.push(`form tags do not map onto allowedTags: ${unmapped.join(", ")}`)
  }
  const checklist = contract.checklist.map((item) => item.label).join("\n")
  const officialChecklist = contract.official.checklist.join("\n")
  if (checklist !== officialChecklist) {
    divergence.push("form checklist text differs from submissionChecklist")
  }
  if (!Number.isInteger(contract.maximumTags) || contract.maximumTags < 1) {
    divergence.push(`maximumSubmissionTags is not a positive integer: ${contract.maximumTags}`)
  }
  if (divergence.length) {
    throw new ContractError(
      "contract-divergent",
      `the pinned marketplace commit is internally inconsistent, so no submission is generated:\n  - ${divergence.join("\n  - ")}`,
    )
  }
}

/** Resolve one author-supplied category against the form's controlled list. */
export function resolveCategory(contract, value) {
  const text = String(value ?? "").trim()
  if (!text) return { ok: false, reason: "no category given" }
  const exact = contract.categories.find((option) => option === text)
  if (exact) return { ok: true, value: exact }
  const loose = contract.categories.find((option) => option.toLowerCase() === text.toLowerCase())
  if (loose) return { ok: true, value: loose }
  return { ok: false, reason: `"${text}" is not one of the form's categories` }
}

/**
 * Resolve author-supplied tags against the form's controlled list, accepting
 * either the form's display labels or the marketplace's normalised slugs, and
 * always emitting the display labels the form itself would write.
 */
export function resolveTags(contract, values) {
  const given = (Array.isArray(values) ? values : String(values ?? "").split(","))
    .map((value) => String(value).trim())
    .filter(Boolean)
  if (!given.length) return { ok: false, reason: "no tags given", unknown: [] }
  const bySlug = new Map(contract.tagLabels.map((label) => [tagSlug(label), label]))
  const resolved = []
  const unknown = []
  for (const value of given) {
    const label = bySlug.get(tagSlug(value))
    if (!label) unknown.push(value)
    else if (!resolved.includes(label)) resolved.push(label)
  }
  if (unknown.length) return { ok: false, reason: `not on the form's tag list: ${unknown.join(", ")}`, unknown }
  if (resolved.length < 1 || resolved.length > contract.maximumTags) {
    return { ok: false, reason: `the form takes 1 to ${contract.maximumTags} tags, got ${resolved.length}`, unknown: [] }
  }
  return { ok: true, value: resolved, unknown: [] }
}
