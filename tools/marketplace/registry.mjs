// The plugin-id and repository universe. Like the submission contract, nothing
// here is hardcoded: the reserved namespace is read out of the marketplace's
// own catalog builder, the listed ids out of the published catalog and the
// registry sources, and the retired ids out of `registry.json`.
//
// Measured reason these three checks exist (docs/MEASUREMENTS.md M2): the
// marketplace refuses a submission whose id is already listed
// (`plugin-id-listed`), was used by a previous listing (`plugin-id-retired`),
// or sits in the reserved namespace (`reserved-plugin-id`), and it refuses a
// repository that is already listed (`submission-repository-listed`). Each
// refusal costs the author a full round trip through a human queue whose
// median submission-to-publication time rose sevenfold between 2026-W33 and
// 2026-W36, and it is knowable before submitting from data the marketplace
// publishes.
//
// Two kinds of file, two sources (docs/MEASUREMENTS.md M7). The catalog
// builder is code, and code is only ever read from the pin: it moves a few
// times a month and must never be fetched and executed unreviewed. The
// registry and the catalog are data, and the pin's copy of them is stale
// within hours: registry.json changed in 4,201 of the marketplace's 4,293
// commits in the 30 days to 2026-09-13, about 140 a day. So those two files
// are read from the marketplace's current default-branch HEAD when the network
// is there, at the exact commit `defaultBranchHead()` resolved so they cannot
// disagree with each other, and from the pin when it is not or when the caller
// asks for --offline. Every result says which, with the commit.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { defaultBranchHead, getJson } from "./github.mjs"
import { omakitCacheDir } from "./paths.mjs"

export const CATALOG_PATH = "site/catalog.json"
export const REGISTRY_PATH = "registry.json"
export const CATALOG_BUILDER_PATH = "scripts/build-catalog.mjs"

/** The only two marketplace files ever read from HEAD. Everything else comes from the pin. */
export const LIVE_PATHS = Object.freeze([REGISTRY_PATH, CATALOG_PATH])

export class RegistryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "RegistryError"
    this.code = code
  }
}

function readJson(pinDir, relative) {
  try {
    return JSON.parse(readFileSync(join(pinDir, relative), "utf8"))
  } catch (error) {
    throw new RegistryError("pin-unreadable", `cannot read ${relative} from the pinned checkout: ${error.message}`)
  }
}

/**
 * The reserved namespace as the marketplace states it, read from the pinned
 * `build-catalog.mjs` next to its own `reserved-plugin-id` check. Read, not
 * copied, so a pin update moves it.
 */
export function reservedNamespace(pinDir) {
  const source = readFileSync(join(pinDir, CATALOG_BUILDER_PATH), "utf8")
  const match = source.match(/startsWith\("([A-Za-z0-9.\-_]+\.)"\)\s*\)\s*\{\s*\n\s*checkError\("reserved-plugin-id"/)
    || source.match(/checkError\("reserved-plugin-id",\s*`[^`]*\$\{[^}]*\}:\s*the ([A-Za-z0-9.\-_]+)\.\*\s+namespace is reserved`/)
  if (!match) {
    throw new RegistryError(
      "pin-unreadable",
      `cannot read the reserved plugin-id namespace from ${CATALOG_BUILDER_PATH} at the pin; refusing to guess it`,
    )
  }
  return match[1].endsWith(".") ? match[1] : `${match[1]}.`
}

/**
 * How the marketplace itself presents a plugin it lists, read out of the
 * pinned `build-catalog.mjs` rather than copied: `categoryFor(kinds)` maps the
 * manifest's kinds to a category in order of its `if` lines, with a fallback,
 * and the tags are the first three kinds lowercased. `omakit submit` offers
 * these as the default answer when it has to ask for a category and tags, so
 * the default is the marketplace's own choice; a mapping that cannot be read
 * offers no default. tests/unit/registry-figures.test.mjs pins what the
 * mapping is at this commit, so a marketplace that changes it fails the suite
 * until the docs follow.
 *
 * @returns {{ rules: Array<{ kinds: string[], category: string }>, fallback: string|null, tagsFromKinds: boolean }}
 */
export function catalogPresentation(pinDir) {
  const source = readFileSync(join(pinDir, CATALOG_BUILDER_PATH), "utf8")
  const body = source.match(/function categoryFor\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || ""
  const rules = [...body.matchAll(/if \(((?:kinds\.includes\("[^"]+"\)(?:\s*\|\|\s*)?)+)\) return "([^"]+)";/g)]
    .map((match) => ({ kinds: [...match[1].matchAll(/"([^"]+)"/g)].map((kind) => kind[1]), category: match[2] }))
  const fallback = body.match(/\n\s*return "([^"]+)";\s*$/)?.[1] || null
  const tagsFromKinds = /tags:\s*kinds\.slice\(0,\s*3\)\.map\(\(kind\) => kind\.toLowerCase\(\)\)/.test(source)
  return { rules, fallback, tagsFromKinds }
}

/**
 * The marketplace's own presentation for a manifest's kinds: the category its
 * rules pick and the tags it would derive. Null where the mapping was not
 * readable, so nothing is offered rather than something guessed.
 */
export function defaultPresentation(presentation, kinds = []) {
  const list = Array.isArray(kinds) ? kinds.filter((kind) => typeof kind === "string") : []
  const rule = presentation.rules.find((candidate) => candidate.kinds.some((kind) => list.includes(kind)))
  const category = presentation.rules.length && presentation.fallback ? (rule ? rule.category : presentation.fallback) : null
  const tags = presentation.tagsFromKinds ? list.slice(0, 3).map((kind) => kind.toLowerCase()) : null
  return { category, tags }
}

function repositorySlug(value) {
  try {
    return new URL(String(value)).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase()
  } catch {
    return ""
  }
}

/**
 * The one URL shape a live registry file is read from: one of LIVE_PATHS at
 * one explicit 40-character commit on the marketplace's raw file host. Never
 * a branch name, so the two files always come from the same commit and the
 * commit named in the output is the one they came from; never a path outside
 * LIVE_PATHS, so nothing executable can arrive this way.
 */
export function liveFileUrl(commit, path) {
  if (!/^[0-9a-f]{40}$/.test(String(commit))) {
    throw new RegistryError("usage", `a live registry file is read at a 40-character commit, not "${commit}"`)
  }
  if (!LIVE_PATHS.includes(path)) {
    throw new RegistryError("usage", `${path} is never read from HEAD; only ${LIVE_PATHS.join(" and ")} are`)
  }
  const raw = MARKETPLACE_PIN.repository.replace(/^https:\/\/github\.com\//, "https://raw.githubusercontent.com/")
  return `${raw}/${commit}/${path}`
}

/** Where the live files for one commit are kept: beside the pin, never inside it. */
export function liveCacheDir(commit, cacheRoot = omakitCacheDir("registry")) {
  return join(cacheRoot, commit)
}

/** A cached commit is one whose meta.json, written last, names every file present. */
function readCached(liveCache) {
  try {
    const meta = JSON.parse(readFileSync(join(liveCache, "meta.json"), "utf8"))
    if (typeof meta.fetchedAt !== "string" || JSON.stringify(meta.paths) !== JSON.stringify(LIVE_PATHS)) return null
    const files = {}
    for (const path of LIVE_PATHS) files[path] = JSON.parse(readFileSync(join(liveCache, path), "utf8"))
    return { fetchedAt: meta.fetchedAt, files }
  } catch {
    return null
  }
}

/**
 * One directory per commit, the files first and meta.json last, so a run that
 * dies mid-write leaves a directory readCached() does not accept. Older
 * commits are removed: at about 140 registry commits a day, keeping every one
 * would grow the cache by the measured 13 MB per run.
 */
function writeCached(cacheRoot, commit, fetchedAt, files) {
  const liveCache = liveCacheDir(commit, cacheRoot)
  rmSync(liveCache, { recursive: true, force: true })
  for (const path of LIVE_PATHS) {
    mkdirSync(dirname(join(liveCache, path)), { recursive: true })
    writeFileSync(join(liveCache, path), JSON.stringify(files[path]))
  }
  writeFileSync(join(liveCache, "meta.json"), `${JSON.stringify({ commit, fetchedAt, paths: LIVE_PATHS }, null, 2)}\n`)
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== commit) rmSync(join(cacheRoot, entry.name), { recursive: true, force: true })
  }
}

/**
 * The registry and the catalog, from the marketplace's current default-branch
 * HEAD when the network is there and from the pin when it is not. Never
 * throws for a network reason: a HEAD that cannot be read falls back to the pin
 * and says so in `reason`. The pinned checkout is never written to; a fetched
 * pair is cached under `cacheRoot/<commit>/`.
 *
 * `resolveHead`, `fetchJson`, `cacheRoot` and `now` are injectable for tests;
 * the defaults are the tool's one HEAD resolver and its one GET call site.
 *
 * @param {{ repoRoot?: string, pinDir?: string, offline?: boolean,
 *           resolveHead?: (url: string) => Promise<{ commit: string }>,
 *           fetchJson?: (url: string) => Promise<object>, cacheRoot?: string,
 *           now?: () => string }} [options]
 * @returns {Promise<{ source: "head"|"pin", commit: string, fetchedAt: string|null,
 *                     reason: string|null, fallback: { what: string, code: string, message: string }|null,
 *                     registry: object, catalog: object }>}
 *   `reason` is the whole story, for `--json`; `fallback` is its parts, for
 *   the one line a person reads (registrySourceDetail).
 */
export async function liveRegistry(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const resolveHead = options.resolveHead || defaultBranchHead
  const fetchJson = options.fetchJson || getJson
  const cacheRoot = options.cacheRoot || omakitCacheDir("registry")
  const now = options.now || (() => new Date().toISOString())
  const fromPin = (reason, fallback = null) => ({
    source: "pin",
    commit: MARKETPLACE_PIN.commit,
    fetchedAt: null,
    reason,
    fallback,
    registry: readJson(pinDir, REGISTRY_PATH),
    catalog: readJson(pinDir, CATALOG_PATH),
  })
  const failed = (what, error) => {
    const code = error?.code || "error"
    const message = String(error?.message || error)
    return fromPin(`${what} (${code}): ${message}`, { what, code, message })
  }
  if (options.offline) return fromPin("--offline")

  let commit
  try {
    commit = String((await resolveHead(MARKETPLACE_PIN.repository)).commit).toLowerCase()
  } catch (error) {
    return failed("HEAD unreadable", error)
  }
  if (commit === MARKETPLACE_PIN.commit) {
    // HEAD is the pin, so the pin's files are HEAD's files: nothing to fetch.
    return { ...fromPin(null), source: "head", fetchedAt: now() }
  }

  const cached = readCached(liveCacheDir(commit, cacheRoot))
  if (cached) {
    return { source: "head", commit, fetchedAt: cached.fetchedAt, reason: null, fallback: null, registry: cached.files[REGISTRY_PATH], catalog: cached.files[CATALOG_PATH] }
  }

  const files = {}
  try {
    for (const path of LIVE_PATHS) files[path] = await fetchJson(liveFileUrl(commit, path))
  } catch (error) {
    return failed(`registry at ${commit} unreadable`, error)
  }
  const fetchedAt = now()
  try {
    mkdirSync(cacheRoot, { recursive: true })
    writeCached(cacheRoot, commit, fetchedAt, files)
  } catch {
    // A cache that cannot be written costs the next run a refetch, nothing else.
  }
  return { source: "head", commit, fetchedAt, reason: null, fallback: null, registry: files[REGISTRY_PATH], catalog: files[CATALOG_PATH] }
}

/**
 * How a check names where its registry data came from. Short hash for the
 * pin, which the docs name that way; the full commit for HEAD, which nothing
 * else names.
 *
 * A fallback is one clause, not the whole story: the transport error's own
 * parenthetical and its "while reading <path>" tail are dropped and the
 * failure code takes their place, so the person reads
 * "registry at the pin 38060f89; HEAD unreadable: github.com did not answer
 * (network-unavailable)" on one line. Measured before this: the full text
 * nested three sets of parentheses and wrapped to three lines at 80 columns.
 * `--json` keeps the whole text under `registry.reason`.
 */
export function registrySourceDetail(live) {
  if (live.source === "head") return `registry at ${live.commit}, read ${live.fetchedAt}`
  const pin = `registry at the pin ${live.commit.slice(0, 8)}`
  if (!live.fallback) return live.reason === "--offline" ? `${pin} (offline)` : pin
  const { what, code, message } = live.fallback
  const clause = message.replace(/ while reading .*$/, "").replace(/\s*\([^()]*\)\s*$/, "").trim()
  const short = what.replace(/^registry at ([0-9a-f]{40}) unreadable$/, (_, sha) => `HEAD ${sha.slice(0, 7)} unreadable`)
  return `${pin}; ${short}: ${clause} (${code})`
}

/**
 * @param {{ repoRoot?: string, pinDir?: string, registry?: object, catalog?: object }} [options]
 *   `registry` and `catalog` are the parsed files from liveRegistry(); without
 *   them the pin's copies are read.
 * @returns {{ reservedPrefix: string, listedIds: Set<string>, retiredIds: Set<string>,
 *             listedRepositories: Set<string>, listedBy: Map<string, string>, counts: object }}
 *   `listedBy` names the repository slug that lists each id, where the
 *   registry or catalog says which, so a taken id can be blamed on a
 *   repository and told apart from the subject's own listing.
 */
export function idUniverse(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const catalog = options.catalog || readJson(pinDir, CATALOG_PATH)
  const registry = options.registry || readJson(pinDir, REGISTRY_PATH)

  const listedIds = new Set()
  const listedBy = new Map()
  const listed = (id, repo) => {
    listedIds.add(id)
    const slug = repositorySlug(repo)
    if (slug && !listedBy.has(id)) listedBy.set(id, slug)
  }
  for (const plugin of Array.isArray(catalog.plugins) ? catalog.plugins : []) {
    if (typeof plugin?.id === "string" && plugin.id) listed(plugin.id, plugin.repo)
  }
  const catalogIds = listedIds.size

  const sources = Array.isArray(registry.sources) ? registry.sources : Object.values(registry.sources || {})
  const listedRepositories = new Set()
  for (const source of sources) {
    const slug = repositorySlug(source?.repo)
    if (slug) listedRepositories.add(slug)
    if (source?.plugins && typeof source.plugins === "object" && !Array.isArray(source.plugins)) {
      for (const id of Object.keys(source.plugins)) listed(id, source.repo)
    }
    if (Array.isArray(source?.plugins)) {
      for (const entry of source.plugins) {
        const id = typeof entry === "string" ? entry : entry?.id
        if (id) listed(id, source.repo)
      }
    }
    if (typeof source?.catalog?.id === "string") listed(source.catalog.id, source.repo)
    for (const id of source?.automatedSecurityBaseline?.pluginIds || []) {
      if (typeof id === "string") listed(id, source.repo)
    }
  }

  const retiredIds = new Set((registry.retiredPluginIds || []).filter((id) => typeof id === "string"))

  if (!listedIds.size || !listedRepositories.size) {
    throw new RegistryError("pin-unreadable", "the pinned catalog and registry produced no listed ids or repositories")
  }

  return {
    pinDir,
    reservedPrefix: reservedNamespace(pinDir),
    listedIds,
    retiredIds,
    listedRepositories,
    listedBy,
    counts: {
      catalogPlugins: catalogIds,
      registrySources: sources.length,
      listedIds: listedIds.size,
      retiredIds: retiredIds.size,
      listedRepositories: listedRepositories.size,
    },
  }
}

/**
 * The recorded baseline over every listed source, counted from registry.json at
 * the pin. This is the one place the figures cited by `baseline.preflight` and
 * docs/MEASUREMENTS.md M4 come from; tests/unit/registry-figures.test.mjs pins
 * the values, so a pin bump changes the printed number rather than leaving a
 * stale literal behind.
 *
 * @param {{ repoRoot?: string, pinDir?: string }} [options]
 * @returns {{ sources: number, withBaseline: number, outcomes: Record<string, number>,
 *             capabilities: Record<string, number>, findings: Record<string, number>,
 *             findingsTotal: number, superseded: { sources: number, commits: number, most: number },
 *             retiredIds: number, catalogPlugins: number }}
 */
export function baselineFigures(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const registry = readJson(pinDir, REGISTRY_PATH)
  const catalog = readJson(pinDir, CATALOG_PATH)
  const sources = Array.isArray(registry.sources) ? registry.sources : Object.values(registry.sources || {})
  const count = (table, key) => { table[key] = (table[key] || 0) + 1 }
  const outcomes = {}
  const capabilities = {}
  const findings = {}
  let withBaseline = 0
  let findingsTotal = 0
  let supersededSources = 0
  let supersededCommits = 0
  let most = 0
  for (const source of sources) {
    const baseline = source?.automatedSecurityBaseline
    if (baseline && typeof baseline.outcome === "string") {
      withBaseline += 1
      count(outcomes, baseline.outcome)
      for (const capability of baseline.capabilities || []) count(capabilities, typeof capability === "string" ? capability : capability?.id)
      for (const finding of baseline.findings || []) {
        count(findings, typeof finding === "string" ? finding : finding?.rule || finding?.id)
        findingsTotal += 1
      }
    }
    const history = Array.isArray(source?.listingValidationHistory) ? source.listingValidationHistory.length : 0
    if (history > 0) supersededSources += 1
    supersededCommits += history
    if (history > most) most = history
  }
  return {
    sources: sources.length,
    withBaseline,
    outcomes,
    capabilities,
    findings,
    findingsTotal,
    superseded: { sources: supersededSources, commits: supersededCommits, most },
    retiredIds: (registry.retiredPluginIds || []).length,
    catalogPlugins: Array.isArray(catalog.plugins) ? catalog.plugins.length : 0,
  }
}

/** 1681 -> "1,681", the way the docs print figures. */
export function figure(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * @param {{ id: string, repositoryUrl?: string|null }} subject
 * @returns {{ ok: boolean, problems: Array<{ code: string, detail: string, repository?: string|null, sameRepository?: boolean }> }}
 *   A `plugin-id-listed` problem names the repository that lists the id
 *   (`repository`, a slug, or null when the registry does not say) and
 *   whether that is the subject's own (`sameRepository`), because the two
 *   have different remedies: another id, or nothing to submit at all.
 */
export function checkIdentity(universe, subject) {
  const problems = []
  const id = String(subject.id || "")
  if (!id) {
    problems.push({ code: "plugin-id-missing", detail: "the root manifest declares no id" })
    return { ok: false, problems }
  }
  const slug = repositorySlug(subject.repositoryUrl)
  if (id.toLowerCase().startsWith(universe.reservedPrefix)) {
    problems.push({
      code: "reserved-plugin-id",
      detail: `"${id}" is inside the reserved ${universe.reservedPrefix}* namespace`,
    })
  }
  if (universe.retiredIds.has(id)) {
    problems.push({ code: "plugin-id-retired", detail: `"${id}" was used by a previous listing (registry.json retiredPluginIds)` })
  }
  if (universe.listedIds.has(id)) {
    const repository = universe.listedBy?.get(id) || null
    const sameRepository = Boolean(repository && slug && repository === slug)
    problems.push({
      code: "plugin-id-listed",
      detail: `"${id}" is already listed${repository ? ` by ${repository}` : ""}`,
      repository,
      sameRepository,
    })
  }
  if (slug && universe.listedRepositories.has(slug)) {
    problems.push({ code: "submission-repository-listed", detail: `${slug} is already listed`, repository: slug, sameRepository: true })
  }
  return { ok: problems.length === 0, problems }
}

export { repositorySlug }
