// The plugin-id and repository universe, read from the pinned marketplace
// checkout. Like the submission contract, nothing here is hardcoded: the
// reserved namespace is read out of the marketplace's own catalog builder, the
// listed ids out of the published catalog and the registry sources, and the
// retired ids out of `registry.json`.
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

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { requirePin } from "./pin.mjs"

export const CATALOG_PATH = "site/catalog.json"
export const REGISTRY_PATH = "registry.json"
export const CATALOG_BUILDER_PATH = "scripts/build-catalog.mjs"

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

function repositorySlug(value) {
  try {
    return new URL(String(value)).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase()
  } catch {
    return ""
  }
}

/**
 * @param {{ repoRoot?: string, pinDir?: string }} [options]
 * @returns {{ reservedPrefix: string, listedIds: Set<string>, retiredIds: Set<string>,
 *             listedRepositories: Set<string>, counts: object }}
 */
export function idUniverse(options = {}) {
  const pinDir = options.pinDir || requirePin(options.repoRoot).dir
  const catalog = readJson(pinDir, CATALOG_PATH)
  const registry = readJson(pinDir, REGISTRY_PATH)

  const listedIds = new Set()
  for (const plugin of Array.isArray(catalog.plugins) ? catalog.plugins : []) {
    if (typeof plugin?.id === "string" && plugin.id) listedIds.add(plugin.id)
  }
  const catalogIds = listedIds.size

  const sources = Array.isArray(registry.sources) ? registry.sources : Object.values(registry.sources || {})
  const listedRepositories = new Set()
  for (const source of sources) {
    const slug = repositorySlug(source?.repo)
    if (slug) listedRepositories.add(slug)
    if (source?.plugins && typeof source.plugins === "object" && !Array.isArray(source.plugins)) {
      for (const id of Object.keys(source.plugins)) listedIds.add(id)
    }
    if (Array.isArray(source?.plugins)) {
      for (const entry of source.plugins) {
        const id = typeof entry === "string" ? entry : entry?.id
        if (id) listedIds.add(id)
      }
    }
    if (typeof source?.catalog?.id === "string") listedIds.add(source.catalog.id)
    for (const id of source?.automatedSecurityBaseline?.pluginIds || []) {
      if (typeof id === "string") listedIds.add(id)
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
 * @param {{ id: string, repositoryUrl?: string|null }} subject
 * @returns {{ ok: boolean, problems: Array<{ code: string, detail: string }> }}
 */
export function checkIdentity(universe, subject) {
  const problems = []
  const id = String(subject.id || "")
  if (!id) {
    problems.push({ code: "plugin-id-missing", detail: "the root manifest declares no id" })
    return { ok: false, problems }
  }
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
    problems.push({ code: "plugin-id-listed", detail: `"${id}" is already listed` })
  }
  const slug = repositorySlug(subject.repositoryUrl)
  if (slug && universe.listedRepositories.has(slug)) {
    problems.push({ code: "submission-repository-listed", detail: `${slug} is already listed` })
  }
  return { ok: problems.length === 0, problems }
}

export { repositorySlug }
