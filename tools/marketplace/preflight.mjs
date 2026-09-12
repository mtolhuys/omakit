// Baseline preflight: the official Omarchy marketplace security baseline, run
// locally over the harvested transport, reported verbatim together with what
// its outcome will cause on submission.
//
// Measured reason this runs before submitting (docs/MEASUREMENTS.md M4): of
// 2,990 listings the recorded baseline produced 1,697 `passed`, 1,226
// `review-required` and 20 `needs-fixes`. `review-required` is not a defect and
// needs no source change, but it does mean a human must look, and it is the
// single largest determinant of whether a submission waits on a person. An
// author who knows which of the seven capabilities triggered it before
// submitting can decide to remove it or to explain it in the maintainer notes
// instead of finding out after the queue.
//
// Everything policy-shaped here is read from the pinned checkout: the outcome
// derivation, the disposition, the blocking rule set and the enforcement mode.
// The two disclaimer sentences are rendered by the marketplace's own report
// builder so they are its words, not Omakit's. The machine-readable baseline
// marker that builder emits is stripped and asserted absent: Omakit must never
// produce something that could be pasted into an issue as the bot's own
// attestation.

import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { requirePin } from "./pin.mjs"
import { marketplaceBaselineSection } from "./verify.mjs"

export class PreflightError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "PreflightError"
    this.code = code
  }
}

async function loadPolicy(pinDir) {
  return import(pathToFileURL(join(pinDir, "scripts/security-baseline-policy.mjs")).href)
}

async function loadReport(pinDir) {
  return import(pathToFileURL(join(pinDir, "scripts/security-baseline-report.mjs")).href)
}

/**
 * The marketplace's own two closing sentences, read out of the source of its
 * own report builder at the pin. They are not written down in Omakit: the
 * baseline result must never be restated as a safety claim, and the least
 * error-prone way to say so is in the marketplace's words.
 */
export async function officialDisclaimers(pinDir) {
  const report = await loadReport(pinDir)
  const source = String(report.buildSecurityBaselineReport)
  const sentences = [...source.matchAll(/"(This [^"]{20,300}\.)"/g)].map((match) => match[1])
  if (sentences.length < 2) {
    throw new PreflightError(
      "disclaimer-unreadable",
      "cannot read the marketplace's baseline disclaimer sentences from the pin; refusing to report a baseline result without them",
    )
  }
  return sentences
}

/**
 * Render the marketplace's own baseline detail section for a local result.
 *
 * `buildSecurityBaselineReport` is deliberately not called: it prepends the
 * machine-readable attestation marker the bot posts, and Omakit must never
 * construct something that could be pasted into an issue as the marketplace's
 * own attestation. Only the detail section is rendered, the official closing
 * sentences are appended, and the absence of either marker is asserted.
 */
export async function officialReportText(pinDir, result) {
  const policy = await loadPolicy(pinDir)
  const report = await loadReport(pinDir)
  const text = [
    "## Automated security baseline",
    "",
    report.buildSecurityBaselineDetails(result),
    "",
    ...(await officialDisclaimers(pinDir)).flatMap((sentence) => [sentence, ""]),
  ].join("\n").trim()
  if (text.includes(policy.securityBaselineMarkerPrefix) || text.includes(policy.securityBaselineErrorMarker)) {
    throw new PreflightError("marker-leak", "refusing to emit a marketplace security-baseline marker")
  }
  return text
}

/**
 * What the outcome will cause on submission, derived from the pinned policy.
 * @param {object} official the verbatim result from the official baseline
 */
export async function consequence(pinDir, official) {
  const policy = await loadPolicy(pinDir)
  const findings = (official?.findings || []).map((finding) => finding.ruleId || finding.id || String(finding))
  const capabilities = (official?.capabilities || []).map((capability) => capability.id || String(capability))
  const blocking = findings.filter((ruleId) => policy.securityBaselineSelectivelyBlockingRules.includes(ruleId))
  const outcome = official?.outcome ?? policy.securityBaselineOutcome(official?.findings || [], official?.capabilities || [])
  const disposition = official?.disposition ?? policy.securityBaselineDisposition(official)
  const blocksApproval = official?.blocksApproval ?? policy.securityBaselineBlocksApproval(official)
  return {
    outcome,
    disposition,
    blocksApproval: Boolean(blocksApproval),
    enforcementMode: official?.enforcementMode || policy.securityBaselineEnforcementMode,
    findings,
    capabilities,
    selectivelyBlockingRules: [...policy.securityBaselineSelectivelyBlockingRules],
    blockingFindings: blocking,
    knownCapabilities: Object.keys(policy.securityBaselineCapabilityCatalog),
    meaning: describe({ outcome, blocksApproval: Boolean(blocksApproval), blocking, capabilities, policy }),
  }
}

function describe({ outcome, blocksApproval, blocking, capabilities, policy }) {
  if (outcome === "passed") {
    return "No findings and no capabilities. Nothing in the baseline holds this submission back."
  }
  if (outcome === "review-required") {
    const names = capabilities.map((id) => policy.securityBaselineCapabilityCatalog[id]?.title || id)
    return `No findings, but ${capabilities.length} of the ${Object.keys(policy.securityBaselineCapabilityCatalog).length} capabilities are present (${names.join("; ")}), so a maintainer must look at this commit before it can be listed.`
  }
  if (outcome === "needs-fixes" && blocksApproval) {
    return `Findings include ${blocking.join(", ")}, which block publication under the ${policy.securityBaselineEnforcementMode} enforcement mode. These must be fixed in a new commit.`
  }
  if (outcome === "needs-fixes") {
    return `Findings are present but none of them is selectively blocking (${policy.securityBaselineSelectivelyBlockingRules.join(", ")}), so the disposition is review-required: a maintainer may accept them for this exact commit.`
  }
  return `Unrecognised outcome ${JSON.stringify(outcome)} from the pinned policy.`
}

/**
 * Run the official baseline over the local transport for one subject.
 * @param {{ repoRoot: string, subject: object }} options
 */
export async function baselinePreflight({ repoRoot, subject }) {
  const { dir: pinDir, identity } = requirePin(repoRoot)
  const section = await marketplaceBaselineSection({ repoRoot, subject })
  if (!section.invoked) {
    return { pin: section.pin, invoked: false, skipReason: section.skipReason, official: null, consequence: null, officialReport: null, statement: section.statement }
  }
  if (section.official?.error) {
    return {
      pin: section.pin,
      invoked: true,
      skipReason: null,
      official: section.official,
      consequence: null,
      officialReport: null,
      statement: section.statement,
      refusal: section.official.error,
    }
  }
  return {
    pin: { ...section.pin, baselineVersion: identity.baselineVersion, enforcementMode: identity.enforcementMode },
    invoked: true,
    skipReason: null,
    transport: section.transport,
    assumedByAdapter: section.assumedByAdapter,
    official: section.official,
    consequence: await consequence(pinDir, section.official),
    officialReport: await officialReportText(pinDir, section.official),
    statement: section.statement,
  }
}
