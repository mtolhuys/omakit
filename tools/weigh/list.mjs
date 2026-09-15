// `omakit weigh --list`: every installed plugin, and when it was last
// weighed. Read-only: `listPlugins` answering is the only preflight, no
// shell is restarted, nothing is written, and the documents under
// `$XDG_STATE_HOME/omakit/weigh/` are read for the last sentence per id.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { run } from "./commands.mjs"
import { WeighError } from "./audit.mjs"
import { omakitStateDir } from "../marketplace/paths.mjs"

/**
 * The last weighing of each plugin id, from the documents in the state
 * directory: the newest `started` wins. A document that cannot be read or
 * parsed is skipped; `timing.json` is not a document.
 *
 * @returns {Map<string, { date: string, started: string, readme: string|null, summary: string, document: string }>}
 */
export function lastWeighings(stateDir) {
  const latest = new Map()
  let names = []
  try {
    names = readdirSync(stateDir).filter((name) => name.endsWith(".json") && name !== "timing.json")
  } catch {
    return latest
  }
  for (const name of names) {
    const file = join(stateDir, name)
    let document
    try {
      document = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    if (document?.command !== "weigh" || !Array.isArray(document.plugins) || typeof document.started !== "string") continue
    for (const row of document.plugins) {
      const known = latest.get(row.id)
      if (known && known.started >= document.started) continue
      latest.set(row.id, { date: document.started.slice(0, 10), started: document.started, readme: row.readme ?? null, summary: row.verdict?.summary ?? "", document: file })
    }
  }
  return latest
}

/**
 * The installed-plugin list joined to the manifest catalog by id. This is the
 * one join used by both `weigh --list` and `audit`, so a source directory has
 * one authority throughout the tool.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function installedPlugins({ env = process.env } = {}) {
  const listed = run("listPlugins", { env })
  if (!listed.ok) throw new WeighError("shell-not-running", "omarchy plugin list did not answer, and the list is what the shell has installed", "omarchy-restart-shell")
  let installed
  try {
    installed = JSON.parse(listed.stdout)
  } catch {
    throw new WeighError("shell-unreadable", "omarchy plugin list did not answer with JSON", "omarchy-restart-shell, then run it again.")
  }
  if (!Array.isArray(installed)) throw new WeighError("shell-unreadable", "omarchy plugin list did not answer with a JSON array", "omarchy-restart-shell, then run it again.")
  const catalogRun = run("catalog", { env })
  let catalog = []
  try {
    catalog = catalogRun.ok ? JSON.parse(catalogRun.stdout) : []
  } catch {
    catalog = []
  }
  const sourceDirOf = (id) => catalog.find((entry) => entry.id === id)?.sourceDir || null
  return installed.map((plugin) => ({ ...plugin, sourceDir: sourceDirOf(plugin.id) }))
}

/**
 * One row per installed plugin, sorted: enabled and not weighed first (by
 * id), then enabled and weighed, oldest weighing first, then disabled.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function listWeighings({ env = process.env } = {}) {
  const installed = installedPlugins({ env })
  const stateDir = omakitStateDir("weigh", env)
  const latest = lastWeighings(stateDir)
  const rows = installed.map((plugin) => {
    const kinds = plugin.kinds || []
    const last = latest.get(plugin.id) || null
    return {
      id: plugin.id,
      name: plugin.name || plugin.id,
      kinds,
      enabled: plugin.enabled === true,
      firstParty: plugin.firstParty === true,
      sourceDir: plugin.sourceDir,
      weighable: !kinds.includes("bar"),
      lastWeighed: last ? { date: last.date, readme: last.readme, summary: last.summary, document: last.document } : null,
      enable: plugin.enabled === true ? null : `omarchy plugin enable ${plugin.id}`,
    }
  })
  const rank = (row) => (row.enabled ? (row.lastWeighed ? 1 : 0) : 2)
  rows.sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 1 ? a.lastWeighed.date.localeCompare(b.lastWeighed.date) : 0)
    || a.id.localeCompare(b.id))
  return { stateDir, rows }
}
