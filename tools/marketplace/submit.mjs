// `omakit submit`: everything that is knowable before a submission is posted,
// with the measured reason for every check stated next to the check.
//
// The command produces an issue title and body. It never posts them. Creating
// the issue happens only after the plugin owner explicitly approves, which is
// also what the marketplace's own agent instructions require.
//
// Two sources of authority, never mixed:
//   source: "marketplace-pin", the rule is the marketplace's, read from the
//           pinned checkout at an exact commit. A pin update can change it.
//   source: "omakit",          the check is Omakit's own, derived from public
//           issue text. It is not marketplace policy and never claims to be.

import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { requirePin } from "./pin.mjs"
import { submissionContract, newerCommitChoice, resolveCategory, resolveTags, tagSlug } from "./form.mjs"
import { idUniverse, checkIdentity, listingOf, baselineFigures, figure, liveRegistry, registrySourceDetail, catalogPresentation, defaultPresentation } from "./registry.mjs"
import { readTree } from "./tree.mjs"
import { inspectTree } from "./plugin.mjs"
import { findAgentControl, REMEDY as AGENT_CONTROL_REMEDY } from "./agent-control.mjs"
import { baselinePreflight } from "./preflight.mjs"
import { renderIssue, verifyAgainstOfficialParser } from "./issue.mjs"
import { defaultBranchHead } from "./github.mjs"
import { REFRESH_ACTION } from "./watch.mjs"
import { omakitCacheDir } from "./paths.mjs"
import { openIssuesForRepository, reviewCostVerdict, reviewPolicy } from "./review-cost.mjs"

/**
 * One arrow per cause, in this order, so a person fixes the thing that is
 * actually wrong. Measured before this: an id listed by its own repository
 * was told to "choose an unused plugin id outside the reserved namespace",
 * which is the remedy for a different failure, and an author who followed
 * it would have renamed a plugin the marketplace already lists. The last
 * arrow is for a listed repository whose manifest carries another id, or
 * one with a second cause beside it; a plugin listed by its own repository
 * with nothing else wrong is not a failure at all (see `listing` below).
 */
function identityRemedies(identity, universe, newerCommit) {
  const remedies = []
  const codes = new Set(identity.problems.map((problem) => problem.code))
  if (codes.has("reserved-plugin-id")) remedies.push(`Choose a plugin id outside the reserved ${universe.reservedPrefix}* namespace.`)
  if (codes.has("plugin-id-retired")) remedies.push("That id was retired by the marketplace and cannot be reused; choose another.")
  const taken = identity.problems.find((problem) => problem.code === "plugin-id-listed" && !problem.sameRepository)
  if (taken) remedies.push(taken.repository ? `That id is taken by ${taken.repository}; choose another.` : "That id is already listed; choose another.")
  if (identity.problems.some((problem) => problem.sameRepository)) {
    remedies.push(`This plugin is already listed, so there is nothing to submit. To get a newer commit listed, use the marketplace's verification form and choose "${newerCommit}"; \`omakit watch <the submission issue>\` shows which commit is listed now.`)
  }
  return remedies
}

export class SubmitError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "SubmitError"
    this.code = code
  }
}

/**
 * A check has four verdicts. `pass` and `fail` are its own. `unknown` is
 * for a check that could not run because one it depends on failed: it is
 * rendered as a question, its detail names what it waited on, and it counts
 * in neither `blocking` nor `advisory`, so a refusal lists root causes only.
 * Measured before this: a run with no --category and no --tags on a listed
 * plugin said "6 blocking checks failed" for two causes, because headings,
 * checklist and official-parser each failed for want of a body nobody could
 * render yet, and the closing refusal listed them with "not rendered" where
 * a remedy goes.
 *
 * `skipped` is for a check that was not made because a flag said not to,
 * independent of `waitedOn`: it never blocks, it counts in `skipped` and
 * not in `unknown`, and its detail says which flag. Measured on 0.1.6:
 * `--offline` handed `verdict: true` to the validation-commit check, so
 * `--json` said `"verdict": "pass"` and the report drew `▁ ok` for a
 * comparison that never happened, and an agent reading `checks` rather than
 * the prose could tell the owner every check passed.
 */
function check(id, fields) {
  const waitedOn = (fields.waitedOn || []).filter(Boolean)
  const skipped = fields.skipped === true
  return {
    id,
    source: fields.source,
    why: fields.why,
    severity: fields.severity || "blocking",
    verdict: skipped ? "skipped" : waitedOn.length ? "unknown" : fields.verdict ? "pass" : "fail",
    detail: !skipped && waitedOn.length ? `not checked: it needs ${waitedOn.join(" and ")} to pass first` : fields.detail || "",
    paths: fields.paths || [],
    // One arrow, or one per cause in the order they should be read.
    remedy: skipped || waitedOn.length ? null : Array.isArray(fields.remedy) ? (fields.remedy.length ? fields.remedy : null) : fields.remedy || null,
  }
}

/**
 * What `submit` needs on the command line, decided before any check runs:
 * the category and the tags are editorial choices nobody else can make, and
 * a run without them has nothing to render. The controlled values come from
 * the form at the pin, so the usage message lists exactly what the form
 * accepts. Null when nothing is missing.
 *
 * @returns {{ missing: string[], categories: string[], tags: string[], maximumTags: number }|null}
 */
export function missingSubmitFlags(contract, { category, tags } = {}) {
  const missing = []
  if (!String(category ?? "").trim()) missing.push("--category")
  if (!(Array.isArray(tags) ? tags : String(tags ?? "").split(",")).some((value) => String(value).trim())) missing.push("--tags")
  if (!missing.length) return null
  return { missing, categories: [...contract.categories], tags: [...contract.tagLabels], maximumTags: contract.maximumTags }
}

/** A shell word: quoted when it holds anything a shell would read. */
function shellWord(value) {
  const text = String(value)
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(text) ? text : `"${text.replace(/(["\\$`])/g, "\\$1")}"`
}

/**
 * The command line that repeats this run without asking anything: the target
 * as given, the category and tags the run used wherever they came from, and
 * every other flag that was given. Printed at the end of the report and
 * carried in --json as `reproduce`, so the next run needs no prompt.
 */
export function reproduceCommand({ target, category, tags, pluginName, notes, suggestedTag, allowDirty, offline }) {
  const parts = ["omakit", "submit", shellWord(target)]
  if (category) parts.push("--category", shellWord(category))
  if (tags?.length) parts.push("--tags", shellWord(tags.map(tagSlug).join(",")))
  if (pluginName) parts.push("--name", shellWord(pluginName))
  if (notes) parts.push("--notes", shellWord(notes))
  if (suggestedTag) parts.push("--suggest-tag", shellWord(suggestedTag))
  if (allowDirty) parts.push("--allow-dirty")
  if (offline) parts.push("--offline")
  return parts.join(" ")
}

/**
 * @param {{ repoRoot: string, target: string, category?: string, tags?: string|string[],
 *           notes?: string, suggestedTag?: string, pluginName?: string,
 *           allowDirty?: boolean, offline?: boolean,
 *           github?: object,
 *           readRegistry?: typeof liveRegistry,
 *           chooser?: (question: { contract: object, defaults: object, missing: string[] }) => Promise<{ category?: string, tags?: string[] }> }} options
 *   `readRegistry` is injectable for tests; the default reads the marketplace's
 *   current HEAD, or the pin with `offline`. `chooser` answers for a missing
 *   --category or --tags on an unlisted plugin; without one, that is a usage
 *   error (SubmitError "usage", with the form's lists under `usage`), decided
 *   after the registry so a listed plugin is never asked for a choice that
 *   does not matter.
 */
export async function submitPreflight(options) {
  const { repoRoot } = options
  // Optional: called with the name of the step about to run, so a terminal can
  // say what is happening. Never affects what is produced.
  const phase = options.onPhase || (() => {})

  phase("verifying the pinned marketplace checkout")
  const { dir: pinDir, identity: pinIdentity } = requirePin(repoRoot)
  phase("reading the submission contract from the pin")
  const contract = await submissionContract({ repoRoot })
  phase(options.offline ? "reading the listed and retired plugin ids from the pin" : "reading the marketplace's current registry")
  const live = await (options.readRegistry || liveRegistry)({ repoRoot, offline: options.offline === true })
  const universe = idUniverse({ repoRoot, registry: live.registry, catalog: live.catalog })
  // The documented figures are the pin's by design: they are cited in prose
  // that a test holds to the pin, so they never move between two runs.
  const figures = baselineFigures({ repoRoot })

  phase("resolving the subject commit")
  let subject
  try {
    subject = resolveSubject(options.target, {
      cacheRoot: omakitCacheDir(),
      allowDirty: options.allowDirty === true,
    })
  } catch (error) {
    if (error instanceof SubjectError) throw new SubmitError(error.code, error.message)
    throw error
  }

  phase("reading the installable tree at that commit")
  const entries = readTree(subject.dir, subject.commit)
  const tree = inspectTree({ dir: subject.dir, entries })
  const checks = []

  // --- the installable tree -------------------------------------------------

  checks.push(check("plugin.root-manifest", {
    source: "marketplace-pin",
    why: "The marketplace refuses a submission that is not exactly one manifest at the repository root: \"New submissions require exactly one plugin manifest at the repository root\" (scripts/build-catalog.mjs at the pin). A layout failure costs a full round trip through a queue whose median submission-to-publication time rose sevenfold between 2026-W33 and 2026-W36.",
    verdict: tree.manifestPaths.length === 1 && tree.rootManifestPath === "manifest.json" && !tree.manifestError && Boolean(tree.pluginId),
    detail: tree.manifestError
      ? `manifest.json is not valid JSON: ${tree.manifestError}`
      : tree.manifestPaths.length === 1 && tree.rootManifestPath
        ? `manifest.json declares id "${tree.pluginId}"${tree.pluginName ? ` and name "${tree.pluginName}"` : ""}`
        : `found ${tree.manifestPaths.length} manifest(s): ${tree.manifestPaths.join(", ") || "none"}`,
    paths: tree.manifestPaths,
    remedy: "Keep exactly one manifest.json, at the repository root.",
  }))

  checks.push(check("plugin.root-readme", {
    source: "marketplace-pin",
    why: "`validateRepositoryDocs` at the pin fails a submission with `readme-missing` when no root README exists. A deterministic failure like this one returns the submission to the author's own court, and that court is where submissions die: of the 464 parked there the median item has not moved in 5.6 days, and 77% never produce the fresh validation that would revive them. Knowable here in one read of the tree.",
    verdict: Boolean(tree.readme),
    detail: tree.readme ? `root README: ${tree.readme}` : "no root README",
    remedy: "Add a README at the repository root.",
  }))

  checks.push(check("plugin.root-license", {
    source: "marketplace-pin",
    why: "`validateRepositoryDocs` at the pin fails a submission with `license-missing` when no root license or COPYING file exists. Same cost as a missing README: all 2,963 listed sources in the pinned registry satisfied this rule before they were listed, so it is absolute, and it is knowable here in one read of the tree.",
    verdict: Boolean(tree.license),
    detail: tree.license ? `root license: ${tree.license}` : "no root license or COPYING file",
    remedy: "Add a LICENSE (or COPYING) file at the repository root.",
  }))

  checks.push(check("plugin.readme-install-removal", {
    source: "omakit",
    why: "Checklist item 1 of the form is a statement the author signs: \"The repository is public and contains installation and removal instructions.\" Omakit generates that checklist pre-checked, so it refuses to sign a claim it cannot see evidence for. This is a keyword probe on the README text, not a reading of it, and it is not a marketplace rule.",
    verdict: tree.readmeMentionsInstall && tree.readmeMentionsRemoval,
    detail: tree.readme
      ? `README mentions installation: ${tree.readmeMentionsInstall ? "yes" : "no"}; removal or uninstall: ${tree.readmeMentionsRemoval ? "yes" : "no"}`
      : "no root README to read",
    paths: tree.readme ? [tree.readme] : [],
    remedy: "Document both installing and removing the plugin in the root README, or submit by hand without the generated checklist.",
  }))

  // --- the agent-control warning --------------------------------------------
  // Advisory, not blocking: the marketplace lists plugins that ship these files
  // (docs/MEASUREMENTS.md M3), so a refusal here would refuse what it accepts.

  const agentControl = findAgentControl(entries)
  checks.push(check("tree.agent-control", {
    source: "omakit",
    severity: "advisory",
    why: "103 marketplace issues mention agent-control files, and 24 of 328 sampled maintainer review comments are about them, so an instruction file inside an installed plugin draws review attention and can cost a round. It is not a listing rule: at their listed commits, 6 of 34 listed plugins inspected on 2026-09-13 ship one, so this is a review-cost warning derived from public issue text, labelled `omakit` for that reason. Nothing in the marketplace's automated baseline reports them.",
    verdict: agentControl.length === 0,
    detail: agentControl.length
      ? `${agentControl.length} agent-control file(s) in the installable tree`
      : "no agent-control files in the installable tree",
    paths: agentControl.map((hit) => `${hit.path}: ${hit.reason}`),
    remedy: AGENT_CONTROL_REMEDY.join(" "),
  }))

  // --- identity -------------------------------------------------------------

  const identity = checkIdentity(universe, { id: tree.pluginId, repositoryUrl: subject.repository.url })
  const update = await newerCommitChoice({ pinDir })
  const identityRemedy = identity.ok || identity.own ? null : identityRemedies(identity, universe, update.choice)
  const listed = identity.problems.some((problem) => problem.code === "plugin-id-listed" || problem.code === "submission-repository-listed")

  // The subject's own listing is the third outcome of a run, not a failed
  // check. Measured on 0.1.6: `omakit submit` on the author's own listed
  // plugin printed FAIL identity.available and REFUSED, closed with "Fix it,
  // then run submit again", and the remedy under it said there was nothing to
  // submit. A healthy state was drawn as a failure and the closing line
  // contradicted the remedy. Now the check passes with what the marketplace
  // records about the listing, and the run ends in LISTED.
  const listing = identity.own
    ? (() => {
      const record = listingOf(live, tree.pluginId) || { repository: subject.repository.url, id: tree.pluginId, addedAt: null, verificationCommit: null, verificationStatus: null, verificationCheckedAt: null }
      return {
        ...record,
        localCommit: subject.commit,
        sameCommit: Boolean(record.verificationCommit) && record.verificationCommit === subject.commit.toLowerCase(),
        source: live.source,
        updateRoute: { form: update.name, choice: update.choice },
      }
    })()
    : null

  // The category and the tags are decided here, after the registry. Measured
  // before this: a listed plugin was asked for both and then told there was
  // nothing to submit. A listed plugin needs neither; an unlisted plugin with
  // either missing is asked through `chooser` when there is one, and is a
  // usage error otherwise. The default offered is the marketplace's own
  // presentation for the manifest's kinds, read from the pinned catalog
  // builder.
  let chosenCategory = options.category
  let chosenTags = options.tags
  const missing = missingSubmitFlags(contract, { category: chosenCategory, tags: chosenTags })
  const moot = Boolean(missing) && listed
  if (missing && !listed) {
    if (!options.chooser) {
      const error = new SubmitError("usage", `submit needs ${missing.missing.join(" and ")}`)
      error.usage = missing
      throw error
    }
    const defaults = defaultPresentation(catalogPresentation(pinDir), tree.manifest?.kinds)
    const answers = await options.chooser({ contract, defaults, missing: missing.missing })
    if (answers?.category) chosenCategory = answers.category
    if (answers?.tags) chosenTags = answers.tags
  }
  checks.push(check("identity.available", {
    source: "marketplace-pin",
    why: `The marketplace refuses \`plugin-id-listed\`, \`plugin-id-retired\`, \`reserved-plugin-id\` and \`submission-repository-listed\`. Checked here against ${figure(universe.counts.listedIds)} listed ids, ${figure(universe.counts.retiredIds)} retired ids and ${figure(universe.counts.listedRepositories)} listed repositories from the registry and catalog at the commit the detail names, and the reserved namespace from the pinned catalog builder. The registry is read from the marketplace's current HEAD when the network is there because the pin's copy is stale within hours: registry.json changed in 4,201 of the marketplace's 4,293 commits in the 30 days to 2026-09-13, about 140 a day (docs/MEASUREMENTS.md M7). Code and the form are only ever read from the pin. A plugin listed by its own repository (owner and name, case-insensitively, a trailing .git ignored) is not refused: it is listed, and this check says since when and at which commit.`,
    verdict: identity.ok || identity.own,
    detail: `${identity.ok
      ? `id "${tree.pluginId}" is unused, outside the reserved ${universe.reservedPrefix}* namespace, and the repository is not listed`
      : listing
        ? `listed by this repository since ${listing.addedAt || "an unrecorded date"}, verification commit ${listing.verificationCommit || "unrecorded"} (${listing.verificationStatus || "status unrecorded"}, checked ${listing.verificationCheckedAt || "at an unrecorded time"})`
        : identity.problems.map((problem) => `${problem.code}: ${problem.detail}`).join("; ")}; ${registrySourceDetail(live)}`,
    remedy: identityRemedy,
  }))

  // --- the submission itself ------------------------------------------------

  const pluginName = String(options.pluginName || tree.pluginName || "").trim()
  const category = resolveCategory(contract, chosenCategory)
  const tags = resolveTags(contract, chosenTags)
  // For a listed plugin the editorial choice is moot: these wait on the
  // identity check rather than failing for a flag nobody needed to give.
  const mootWaitsOn = moot ? ["identity.available"] : []

  checks.push(check("submission.title", {
    source: "marketplace-pin",
    why: "39 submissions fell out on the title prefix alone: 14 of them are still open and 7 had to be rescued by hand. The prefix and the requirement that a plugin name follow it are read from the form's own title template at the pin.",
    verdict: Boolean(pluginName),
    detail: pluginName
      ? `title will be "${contract.titleTemplate}${pluginName}"`
      : "no plugin name: manifest.json declares none and --name was not given",
    remedy: "Give the plugin a name in manifest.json, or pass --name.",
  }))

  // On the subject's own listing no body is rendered, on purpose: the
  // submission form is not the route. The five checks that exist only for the
  // body are omitted rather than drawn as questions waiting on identity,
  // because identity did not fail.
  if (!listing) checks.push(check("submission.category", {
    source: "marketplace-pin",
    why: `Exactly one category from the form's controlled list; the marketplace refuses \`submission-category-invalid\` otherwise. The list (${contract.categories.length} options) is read from ${contract.formPath} at the pin.`,
    verdict: category.ok,
    detail: category.ok ? `category: ${category.value}` : `${category.reason}. Choose one of: ${contract.categories.join(", ")}`,
    remedy: category.ok ? null : "Pass --category with one of the listed values.",
    waitedOn: mootWaitsOn,
  }))

  if (!listing) checks.push(check("submission.tags", {
    source: "marketplace-pin",
    why: `1 to ${contract.maximumTags} tags from the form's controlled list; the marketplace refuses \`submission-tag-count-invalid\` and \`submission-tags-invalid\` otherwise. The list (${contract.tagLabels.length} options) and the maximum are read from the pin.`,
    verdict: tags.ok,
    detail: tags.ok ? `tags: ${tags.value.join(", ")}` : `${tags.reason}. Choose from: ${contract.tagLabels.join(", ")}`,
    remedy: tags.ok ? null : "Pass --tags with 1 to 3 comma-separated values from the list.",
    waitedOn: mootWaitsOn,
  }))

  // The body needs every field above and the repository URL below; the three
  // checks that read it wait on whichever of those failed.
  const bodyWaitsOn = moot ? mootWaitsOn : [
    !pluginName && "submission.title",
    !category.ok && "submission.category",
    !tags.ok && "submission.tags",
    !subject.repository.url && "submission.repository-url",
  ].filter(Boolean)
  let issue = null
  let parsed = null
  if (!bodyWaitsOn.length && !listing) {
    issue = renderIssue(contract, {
      pluginName,
      repositoryUrl: subject.repository.url,
      category: category.value,
      tags: tags.value,
      suggestedTag: options.suggestedTag,
      notes: options.notes,
    })
    parsed = verifyAgainstOfficialParser(contract, issue)
  }

  checks.push(check("submission.repository-url", {
    source: "marketplace-pin",
    why: "The marketplace refuses `submission-repository-invalid` unless the Repository URL field is a public GitHub repository root URL, and it is the field every later step depends on: all 2,963 listed sources in the pinned registry are identified by exactly that URL. Taken from the subject's `origin`, never invented, because a URL typed by hand is a URL that can point at the wrong repository.",
    verdict: Boolean(subject.repository.url),
    detail: subject.repository.url || "the subject has no github.com origin, so no repository URL can be declared",
    remedy: subject.repository.url ? null : "Give the repository a github.com origin remote.",
  }))

  if (!listing) checks.push(check("submission.headings", {
    source: "marketplace-pin",
    why: `The six form headings must appear in exact order: ${contract.headings.join(", ")}. 11 open submissions are malformed in the body and receive "The validation result could not be published to the issue. A maintainer must review the workflow.", which blames the maintainer for the author's mistake; one of them differs from a valid submission by the single word "Suggested" instead of "Suggest". The headings are rendered from the form at the pin, never typed.`,
    verdict: Boolean(issue),
    detail: issue ? `${contract.headings.length} headings rendered in form order` : "not rendered",
    waitedOn: bodyWaitsOn,
  }))

  if (!listing) checks.push(check("submission.checklist", {
    source: "marketplace-pin",
    why: `All ${contract.checklist.length} checklist items must be present with their exact text and checked; the marketplace refuses \`submission-checklist-unconfirmed\` otherwise. The text is read from the form at the pin, character for character.`,
    verdict: Boolean(issue),
    detail: issue ? `${contract.checklist.length} items rendered with the form's exact text, all checked` : "not rendered",
    waitedOn: bodyWaitsOn,
  }))

  if (!listing) checks.push(check("submission.official-parser", {
    source: "marketplace-pin",
    why: "The strongest available proof that the body is well formed: the marketplace's own `parseCurrentSubmission` from the pinned commit is run over the rendered title and body. If it accepts them here it accepts them there, and 0 of the marketplace's heading, tag and checklist rules are duplicated in Omakit, so none of them can drift. This is the check that closes all 50 measured title-and-body failures at once: 39 on the title prefix plus 11 malformed bodies.",
    verdict: Boolean(parsed?.ok),
    detail: parsed
      ? parsed.ok
        ? `accepted: repo ${parsed.submission.repo}, category ${parsed.submission.category}, tags ${parsed.submission.tags.join(", ")}`
        : `refused by the marketplace's own parser: ${parsed.code}, ${parsed.message}`
      : "not run: no body was rendered",
    waitedOn: bodyWaitsOn,
  }))

  // --- the commit the marketplace will actually validate ---------------------

  let head = null
  let headError = null
  if (!options.offline && subject.repository.url) {
    phase("reading the repository's default-branch HEAD")
    try {
      head = await (options.github?.defaultBranchHead || defaultBranchHead)(subject.repository.url)
    } catch (error) {
      headError = { code: error.code || "head-unreadable", message: error.message }
    }
  }
  const validationMatches = head ? head.commit === subject.commit.toLowerCase() : null
  checks.push(check("submission.validation-commit", {
    source: "omakit",
    why: "The marketplace validates the default-branch HEAD it resolves when the issue is opened or edited, not the commit checked here. M6 on 2026-09-15 found 326/519 readable author-fixes comparisons stale (62.8%), with 64 of 583 issues unknown, so a preflight against a commit that is not the pushed HEAD describes a tree nobody will review. Not a marketplace rule; an Omakit refusal to report on the wrong tree.",
    severity: options.offline ? "advisory" : "blocking",
    skipped: options.offline === true,
    // No origin, no URL to read a HEAD from: the check waits on the one that
    // says so. Measured on 0.4.1: it failed as a second root cause with
    // "could not read the default-branch HEAD (unknown): " for a read that
    // was never attempted.
    waitedOn: [!options.offline && !subject.repository.url && "submission.repository-url"],
    verdict: validationMatches === true,
    detail: options.offline
      ? `not checked (--offline). Local commit ${subject.commit}.`
      : head
        ? validationMatches
          ? `local commit ${subject.commit} is the current ${head.branch || "default"}-branch HEAD`
          : `local commit ${subject.commit} is not the current ${head.branch || "default"}-branch HEAD (${head.commit})`
        : `could not read the default-branch HEAD (${headError?.code || "unknown"}): ${headError?.message || ""}`,
    remedy: validationMatches === false
      ? "Push this commit to the default branch before submitting, then run submit again."
      : headError
        ? "Connect to the network and run submit again, or pass --offline to skip this one check."
        : null,
  }))

  // --- the author's own open issue --------------------------------------------
  // Discovered once, here, for two readers: the check below, and review.cost.
  // On the subject's own listing the check is omitted with the other body
  // checks: there is no submission to retry.

  if (!options.offline) phase("reading your open marketplace issues")
  const openIssues = await openIssuesForRepository({ repoRoot, repository: subject.repository.url, pluginName, pluginId: tree.pluginId,
    offline: options.offline === true, github: options.github })
  const ownIssues = openIssues.issues || []
  const mismatched = ownIssues.filter((row) => !row.sameRepository)
  const originForIssue = subject.repository.url || "the plugin's origin"
  if (!listing) checks.push(check("submission.issue-repository-url", {
    source: "omakit",
    why: "The marketplace validates the Repository URL in the issue, and a retry is an edit to that issue. On omacom/omarchy-plugin-marketplace#7787 (2026-09-20, 19:18 UTC) a retry edit typed by hand put mtolhuijs where origin says mtolhuys, and the marketplace refused it as repository-unreachable 40 seconds after the edit event. M15, measured 2026-09-20 over all 651 open submission issues: 27 of the 646 with a readable URL name an owner other than the issue's author, so the URL is compared with the plugin's own origin, never with the author's login. Not a marketplace rule; an Omakit check that the issue says what origin says.",
    severity: "blocking",
    skipped: openIssues.count === null || ownIssues.length === 0,
    verdict: mismatched.length === 0,
    detail: openIssues.count === null
      ? openIssues.reason
      : ownIssues.length === 0
        ? `no open submission issue by ${openIssues.account} for this plugin`
        : mismatched.length
          ? mismatched.map((row) => `issue #${row.number} says ${row.repositoryUrl}, origin says ${originForIssue}`).join("; ")
          : ownIssues.map((row) => `issue #${row.number} matches origin`).join("; "),
    remedy: mismatched.length ? mismatched.map((row) => `Edit issue #${row.number} and set the Repository URL field to ${originForIssue}. Change nothing else.`) : null,
  }))

  // --- the baseline preflight ----------------------------------------------

  phase("running the official security baseline over a local snapshot")
  const preflight = await baselinePreflight({ repoRoot, subject })
  phase("assembling the submission")
  const consequence = preflight.consequence
  const baselineBlocking = Boolean(consequence?.blocksApproval) || Boolean(preflight.refusal)
  checks.push(check("baseline.preflight", {
    source: "marketplace-pin",
    why: `The official baseline decides whether a human has to look at all: of the ${figure(figures.withBaseline)} listed sources with a recorded baseline at the pin, it produced ${figure(figures.outcomes.passed || 0)} \`passed\`, ${figure(figures.outcomes["review-required"] || 0)} \`review-required\` and ${figure(figures.outcomes["needs-fixes"] || 0)} \`needs-fixes\`. It is the pinned marketplace code itself, run over a local snapshot; Omakit adds no rule and renames no outcome.`,
    severity: baselineBlocking ? "blocking" : "advisory",
    // `passed` and `review-required` are both acceptable submission states:
    // review-required means a maintainer must look, not that anything is wrong.
    // `needs-fixes` is reported as a failure either way; it is only blocking
    // when one of the two selectively blocking rules fired.
    verdict: consequence?.outcome === "passed" || consequence?.outcome === "review-required",
    detail: preflight.refusal
      ? `the official code refused the snapshot: ${preflight.refusal.code}, ${preflight.refusal.message}`
      : preflight.invoked
        ? `${consequence.outcome} (disposition ${consequence.disposition}, enforcement ${consequence.enforcementMode}, blocksApproval ${consequence.blocksApproval}). ${consequence.meaning}`
        : `not run: ${preflight.skipReason}`,
    paths: (preflight.official?.findings || []).flatMap((finding) =>
      (finding.evidence || []).map((entry) => `${finding.ruleId}: ${entry.path}:${entry.line}`),
    ),
    remedy: consequence?.blocksApproval
      ? "Fix every selectively blocking finding in a new commit before submitting."
      : consequence?.outcome === "needs-fixes"
        ? "These findings do not block publication under the current enforcement mode, but a maintainer must accept them for this exact commit. Fixing them first avoids that round."
        : null,
  }))

  const policy = await reviewPolicy(repoRoot)
  const review = reviewCostVerdict({ baseline: consequence, policy,
    openIssues: consequence?.outcome === policy.manual ? openIssues : { count: null, reason: consequence?.outcome === policy.automated ? "open issue count not checked: automated baseline" : preflight.skipReason || preflight.refusal?.message || "baseline outcome needs findings resolved" },
    why: `MEASUREMENTS.md M4: ${figure(figures.outcomes[policy.manual] || 0)} of ${figure(figures.withBaseline)} recorded listing baselines required review at the pin. M9: on 2026-09-15, 140 of 307 open update issues carried the manual-review label; 4 of 139 compared validated diffs were docs-only, with 1 unavailable. The baseline scans the whole snapshot, not the update diff, so unchanged capabilities also require another review. Sources and exact marketplace HEAD are recorded in MEASUREMENTS.md.`,
  })
  checks.push(review.check)

  const blocking = checks.filter((entry) => entry.severity === "blocking" && entry.verdict === "fail")
  const advisory = checks.filter((entry) => entry.severity === "advisory" && entry.verdict === "fail")
  const unknown = checks.filter((entry) => entry.verdict === "unknown")
  const skipped = checks.filter((entry) => entry.verdict === "skipped")
  // Three outcomes. `refused`: a blocking check failed and no body exists.
  // `listed`: nothing failed and the plugin is already listed by this
  // repository, so there is no body either, and nothing is wrong. `ready`:
  // the body. `ready` the boolean stays what it was, true for the third only.
  const outcome = blocking.length ? "refused" : listing ? "listed" : "ready"
  const ready = outcome === "ready"

  return {
    pin: {
      repository: preflight.pin?.repository || null,
      commit: pinIdentity.commit,
      baselineVersion: pinIdentity.baselineVersion,
      enforcementMode: pinIdentity.enforcementMode,
    },
    subject: {
      mode: subject.mode,
      directory: subject.dir,
      repository: subject.repository.url,
      commit: subject.commit,
      cleanTree: subject.clean,
    },
    registry: {
      source: live.source,
      commit: live.commit,
      fetchedAt: live.fetchedAt,
      reason: live.reason,
    },
    validationCommit: {
      local: subject.commit,
      defaultBranchHead: head?.commit || null,
      branch: head?.branch || null,
      matches: validationMatches,
      note: "The marketplace validates the default-branch HEAD it resolves when the issue is opened or edited. After submitting, use `omakit watch <issue-url>` to see whether that validated commit has fallen behind.",
    },
    plugin: { id: tree.pluginId, name: pluginName },
    reproduce: reproduceCommand({
      target: options.target,
      category: category.ok ? category.value : null,
      tags: tags.ok ? tags.value : null,
      pluginName: options.pluginName,
      notes: options.notes,
      suggestedTag: options.suggestedTag,
      allowDirty: options.allowDirty === true,
      offline: options.offline === true,
    }),
    checks,
    reviewCost: review.reviewCost,
    outcome,
    ready,
    listing,
    blocking: blocking.map((entry) => entry.id),
    advisory: advisory.map((entry) => entry.id),
    unknown: unknown.map((entry) => entry.id),
    skipped: skipped.map((entry) => entry.id),
    issue: ready ? issue : null,
    baseline: preflight.invoked
      ? {
        transport: preflight.transport,
        assumedByAdapter: preflight.assumedByAdapter,
        official: preflight.official,
        consequence,
        officialReport: preflight.officialReport,
        statement: preflight.statement,
      }
      : { invoked: false, skipReason: preflight.skipReason, statement: preflight.statement },
    afterSubmitting: REFRESH_ACTION,
  }
}
