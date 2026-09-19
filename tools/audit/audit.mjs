// Compare installed third-party checkouts with commits recorded by the live
// marketplace catalog. Nothing here fetches or changes a checkout.

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { newerCommitChoice } from "../marketplace/form.mjs"
import { liveRegistry, sameRepository } from "../marketplace/registry.mjs"
import { installedPlugins } from "../weigh/list.mjs"
import { ancestorOf, commitsAfter, hasCommit, isShallow, readCheckout } from "./git.mjs"

export class AuditError extends Error {
  constructor(code, message, remedy = null) {
    super(message)
    this.name = "AuditError"
    this.code = code
    this.remedy = remedy
  }
}

const text = (value) => (typeof value === "string" && value ? value : null)
const lower = (value) => text(value)?.toLowerCase() || null
const figure = (value, origin) => (value === null || value === undefined ? null : { value, origin })
const catalogFigure = (listing, name) => figure(text(listing?.[name]), `site/catalog.json ${name}`)
const short = (value) => value.slice(0, 8)
const ROW_ORDER = ["diverged", "ahead", "modified", "unverified", "unlisted", "unknown", "validated"]
const rowRank = (row) => ROW_ORDER.indexOf(["diverged", "ahead"].includes(row.state) ? row.state : row.flags.includes("modified") ? "modified" : row.state)

function targetId(target) {
  if (!target || !existsSync(target)) return target || null
  try {
    return text(JSON.parse(readFileSync(resolve(target, "manifest.json"), "utf8"))?.id)
  } catch {
    return null
  }
}

function chooseListing(plugin, checkout, listings) {
  const byId = listings.find((entry) => entry?.id === plugin.id) || null
  const byOrigin = listings.find((entry) => sameRepository(entry?.repo, checkout.repository)) || null
  if (byId && byOrigin && byId !== byOrigin) {
    return { listing: null, conflict: `manifest id matches ${byId.id}, but origin matches ${byOrigin.id}; neither listing was used` }
  }
  return { listing: byId || byOrigin, conflict: null }
}

function validatedFigures(listing) {
  const figures = []
  const add = (prefix) => {
    const commit = lower(listing?.[`${prefix}ValidatedCommit`])
    if (!commit || figures.some((entry) => entry.commit.value === commit)) return
    figures.push({
      kind: prefix,
      commit: figure(commit, `site/catalog.json ${prefix}ValidatedCommit`),
      date: catalogFigure(listing, `${prefix}ValidatedAt`),
      branch: catalogFigure(listing, prefix === "listing" ? "listingValidatedBranch" : "upstreamObservedBranch"),
    })
  }
  add("upstream")
  add("listing")
  return figures
}

function rowFact(plugin, checkout, listing, conflict, git, env) {
  const flags = []
  if (checkout.status) flags.push("modified")
  if (plugin.enabled !== true) flags.push("disabled")
  const validated = validatedFigures(listing)
  const observed = lower(listing?.upstreamObservedCommit)
  if (observed && observed !== checkout.commit && !validated.some((entry) => entry.commit.value === observed)) flags.push("upstream moved")

  const common = {
    id: plugin.id,
    flags,
    installed: {
      commit: figure(checkout.commit, "git rev-parse HEAD"),
      enabled: figure(plugin.enabled === true, "omarchy plugin list --json enabled"),
      modified: figure(Boolean(checkout.status), "git status --porcelain"),
      repository: figure(checkout.repository, "git remote get-url origin"),
    },
    validated,
    upstream: {
      observedCommit: catalogFigure(listing, "upstreamObservedCommit"),
      observedBranch: catalogFigure(listing, "upstreamObservedBranch"),
      checkedAt: catalogFigure(listing, "upstreamCheckedAt"),
      checkStatus: catalogFigure(listing, "upstreamCheckStatus"),
    },
    sourceDir: plugin.sourceDir,
    listing: listing ? { id: listing.id, repository: listing.repo } : null,
  }

  if (!listing) return { ...common, state: "unlisted", fact: conflict || "manifest id and origin match no marketplace listing", aheadBy: null, matchedValidated: null }
  if (validated.some((entry) => entry.commit.value === checkout.commit)) {
    const matched = validated.find((entry) => entry.commit.value === checkout.commit)
    return { ...common, state: "validated", fact: `validated ${short(matched.commit.value)} on ${matched.date?.value || "an unrecorded date"}`, aheadBy: null, matchedValidated: matched }
  }
  if (!validated.length) {
    return { ...common, state: "unverified", fact: `listed with verificationStatus ${listing.verificationStatus || "unrecorded"}, and no validated commit`, aheadBy: null, matchedValidated: null }
  }
  const missing = []
  for (const candidate of validated) {
    if (!git.hasCommit(plugin.sourceDir, candidate.commit.value, { env })) {
      missing.push(candidate)
      continue
    }
    if (git.ancestor(plugin.sourceDir, candidate.commit.value, { env })) {
      const count = git.count(plugin.sourceDir, candidate.commit.value, { env })
      return { ...common, state: "ahead", fact: `${count} commit${count === 1 ? "" : "s"} ahead of validated ${short(candidate.commit.value)} (${candidate.date?.value || "unrecorded date"}); HEAD ${short(checkout.commit)}`, aheadBy: figure(count, `git rev-list --count ${candidate.commit.value}..HEAD`), matchedValidated: candidate }
    }
  }
  if (missing.length) {
    const shallow = figure(git.shallow(plugin.sourceDir, { env }), "git rev-parse --is-shallow-repository")
    return { ...common, state: "diverged", fact: `validated commit not in local history; shallow clone: ${shallow.value}`, shallow, aheadBy: null, matchedValidated: missing[0] }
  }
  const moved = sameRepository(checkout.repository, listing.repo)
  return { ...common, state: "diverged", fact: moved ? "installed commit does not descend from a validated commit" : `origin does not match ${listing.repo}`, aheadBy: null, matchedValidated: validated[0] }
}

/**
 * Audit the installed third-party plugin set, or one target from that set.
 * All external readers are injectable so tests establish every state without
 * touching the person's shell or plugin directories.
 */
export async function auditInstalled(options = {}) {
  const env = options.env || process.env
  const readers = {
    installed: options.installed || ((args) => installedPlugins(args)),
    registry: options.registry || ((args) => liveRegistry(args)),
    checkout: options.checkout || ((dir, args) => readCheckout(dir, args)),
    hasCommit: options.hasCommit || ((dir, sha, args) => hasCommit(dir, sha, args)),
    shallow: options.shallow || ((dir, args) => isShallow(dir, args)),
    ancestor: options.ancestor || ((dir, sha, args) => ancestorOf(dir, sha, args)),
    count: options.count || ((dir, sha, args) => commitsAfter(dir, sha, args)),
    route: options.route || ((args) => newerCommitChoice(args)),
  }
  let installed
  try {
    installed = readers.installed({ env })
  } catch (error) {
    throw new AuditError(error?.code || "shell-not-running", error?.message || String(error), error?.remedy || null)
  }
  let live
  try {
    live = await readers.registry({ repoRoot: options.repoRoot, offline: options.offline })
  } catch (error) {
    throw new AuditError(error?.code || "marketplace-unavailable", error?.message || String(error), error?.remedy || "omakit pin")
  }
  const listings = Array.isArray(live.catalog?.plugins) ? live.catalog.plugins : null
  if (!listings) throw new AuditError("catalog-unreadable", "the marketplace catalog has no plugins array", "omakit pin")

  const wanted = targetId(options.target)
  let selected = installed
  if (options.target) {
    const path = existsSync(options.target) ? resolve(options.target) : null
    selected = installed.filter((plugin) => plugin.id === wanted || (path && plugin.sourceDir && resolve(plugin.sourceDir) === path))
    if (!selected.length) throw new AuditError("plugin-not-installed", `${JSON.stringify(options.target)} is not an installed plugin`, "omakit audit")
  }

  let firstPartyCount = 0
  const rows = []
  for (const plugin of selected) {
    const idListing = listings.find((entry) => entry?.id === plugin.id)
    if (plugin.firstParty === true || idListing?.sourceType === "builtin") {
      firstPartyCount += 1
      continue
    }
    if (!plugin.sourceDir) {
      rows.push({ id: plugin.id, state: "unknown", flags: plugin.enabled === true ? [] : ["disabled"], installed: { enabled: figure(plugin.enabled === true, "omarchy plugin list --json enabled") }, validated: [], upstream: {}, sourceDir: null, listing: idListing ? { id: idListing.id, repository: idListing.repo } : null, fact: "omarchy-plugin-catalog records no source directory", error: "source directory unavailable", aheadBy: null, matchedValidated: null })
      continue
    }
    let checkout
    try {
      checkout = readers.checkout(plugin.sourceDir, { env })
    } catch (error) {
      rows.push({ id: plugin.id, state: "unknown", flags: plugin.enabled === true ? [] : ["disabled"], installed: { enabled: figure(plugin.enabled === true, "omarchy plugin list --json enabled") }, validated: [], upstream: {}, sourceDir: plugin.sourceDir, listing: idListing ? { id: idListing.id, repository: idListing.repo } : null, fact: `git failed: ${error.message}`, error: error.message, aheadBy: null, matchedValidated: null })
      continue
    }
    try {
      const { listing, conflict } = chooseListing(plugin, checkout, listings)
      if (listing?.sourceType === "builtin") {
        firstPartyCount += 1
        continue
      }
      rows.push(rowFact(plugin, checkout, listing, conflict, readers, env))
    } catch (error) {
      rows.push({ id: plugin.id, state: "unknown", flags: [checkout.status ? "modified" : null, plugin.enabled === true ? null : "disabled"].filter(Boolean), installed: { commit: figure(checkout.commit, "git rev-parse HEAD"), enabled: figure(plugin.enabled === true, "omarchy plugin list --json enabled"), modified: figure(Boolean(checkout.status), "git status --porcelain"), repository: figure(checkout.repository, "git remote get-url origin") }, validated: validatedFigures(idListing), upstream: {}, sourceDir: plugin.sourceDir, listing: idListing ? { id: idListing.id, repository: idListing.repo } : null, fact: `git failed: ${error.message}`, error: error.message, aheadBy: null, matchedValidated: null })
    }
  }

  rows.sort((a, b) => rowRank(a) - rowRank(b))
  const needsAction = rows.some((row) => row.state === "ahead" || row.state === "diverged")
  let updateRoute = null
  let updateRouteError = null
  if (needsAction) {
    try {
      updateRoute = await readers.route({ repoRoot: options.repoRoot })
    } catch (error) {
      updateRouteError = error?.message || String(error)
    }
  }
  // Three kinds of row: validated, drift (a comparison that was made and
  // found the installed commit off the validated one, or a listing without
  // one to compare against, or no listing), and unknown (a comparison that
  // could not be made: no source directory, not a checkout, a Git question
  // that failed). Unknown is never counted as drift and never said to be.
  // Measured on 2026-09-19: every one of 19 rows was unknown because the
  // catalog named no source directory, and the close said all 19 "run one
  // it never saw" (docs/evidence/ux/2026-09-19-acceptance.json, finding 4).
  const drift = rows.filter((row) => row.state !== "validated" && row.state !== "unknown")
  const unknown = rows.filter((row) => row.state === "unknown")
  return {
    command: "audit",
    catalog: {
      source: live.source,
      commit: figure(live.commit, live.source === "head" ? "marketplace default-branch HEAD" : "marketplace pin"),
      readAt: figure(live.fetchedAt, live.source === "head" ? "liveRegistry fetchedAt" : "--offline or liveRegistry fallback"),
      offline: options.offline === true,
      reason: live.reason,
    },
    counts: {
      installed: figure(installed.length, "omarchy plugin list --json length"),
      selected: figure(selected.length, options.target ? "target selection" : "omarchy plugin list --json length"),
      firstPartyExcluded: figure(firstPartyCount, "sourceType builtin or omarchy plugin list --json firstParty"),
      audited: figure(rows.length, "audited row count"),
      validated: figure(rows.length - drift.length - unknown.length, "rows whose state is validated"),
      drift: figure(drift.length, "rows whose state is ahead, diverged, unverified or unlisted"),
      unknown: figure(unknown.length, "rows whose state is unknown: a comparison that could not be made"),
    },
    unknownReasons: [...new Set(unknown.map((row) => row.fact))],
    rows: options.drift ? rows.filter((row) => row.state !== "validated") : rows,
    updateRoute,
    updateRouteError,
    ok: drift.length === 0 && unknown.length === 0,
  }
}
