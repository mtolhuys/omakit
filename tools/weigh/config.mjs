// The shell configuration: where it is, the one transform `omakit weigh`
// applies to it, and the backup it restores from. docs/WEIGH.md, "The
// shell.json mutation", is the prose form of `without()` below; the two are
// held together by tests/unit/weigh.test.mjs.
//
// The transform is pure and works on the effective configuration the shell
// reports, not on the file. The file itself is touched in exactly two ways:
// its bytes are read once and written to a timestamped backup beside it, and
// those same bytes are written back over it on the way out. Nothing here
// re-serialises what the user wrote.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Where Omarchy keeps the shell configuration: `~/.config/omarchy/shell.json`, the path the shell itself reads. */
export function configPaths(env = process.env) {
  const dir = join(env.HOME || "", ".config/omarchy")
  return { dir, file: join(dir, "shell.json") }
}

/** The md5 of a buffer, as hex: what is printed before and after, and compared. */
export function md5(bytes) {
  return createHash("md5").update(bytes).digest("hex")
}

/**
 * The effective configuration with a set of plugin ids removed: every bar
 * layout entry with that id, every `plugins[]` entry with that id, and for
 * a first-party id an entry in `disabledPlugins[]`, because a first-party
 * plugin is enabled unless listed there. Nothing else in the document
 * changes, and the input is not mutated.
 *
 * @param {object} config the effective configuration, `listShellConfig`
 * @param {string[]} ids
 * @param {{ id: string, firstParty?: boolean }[]} installed
 */
export function without(config, ids, installed) {
  const remove = new Set(ids)
  const firstParty = new Set(installed.filter((plugin) => plugin.firstParty).map((plugin) => plugin.id))
  const out = structuredClone(config)
  const idOf = (entry) => (entry && typeof entry === "object" ? entry.id : entry)
  if (out.bar && out.bar.layout && typeof out.bar.layout === "object") {
    for (const section of Object.keys(out.bar.layout)) {
      if (Array.isArray(out.bar.layout[section])) {
        out.bar.layout[section] = out.bar.layout[section].filter((entry) => !remove.has(idOf(entry)))
      }
    }
  }
  if (Array.isArray(out.plugins)) out.plugins = out.plugins.filter((entry) => !remove.has(idOf(entry)))
  const disabled = new Set(Array.isArray(out.disabledPlugins) ? out.disabledPlugins : [])
  for (const id of ids) if (firstParty.has(id)) disabled.add(id)
  if (disabled.size) out.disabledPlugins = [...disabled].sort()
  else delete out.disabledPlugins
  return out
}

/**
 * Read the configuration file and write its bytes to a timestamped backup
 * beside it. Returns what the restore needs: the bytes, the backup path and
 * the md5. A missing file is recorded as such and restored by removal.
 *
 * @param {string} configFile
 * @param {string} stamp UTC, `YYYYMMDDHHMMSS`
 */
export function backupConfig(configFile, stamp) {
  let bytes = null
  try {
    bytes = readFileSync(configFile)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const backupFile = `${configFile}.omakit-backup-${stamp}`
  // The same mode as the original: shell.json is 0600 on an Omarchy install,
  // and a copy of a private file is a private file.
  if (bytes !== null) writeFileSync(backupFile, bytes, { mode: statSync(configFile).mode & 0o777 })
  return { configFile, backupFile, bytes, md5Before: bytes === null ? null : md5(bytes) }
}

/**
 * Write one configuration for a run. The document is serialised the way
 * `jq .` would, two-space indented, so the shell reads exactly what the
 * transform produced.
 */
export function writeConfig(configFile, config) {
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Put the user's bytes back. Verification is a separate step, after the
 * shell has been restarted on them: a shell that rewrites the file as it
 * starts is exactly what the md5 has to catch, so it is read after the
 * restart and not before.
 *
 * @param {{ configFile: string, bytes: Buffer|null }} backup
 */
export function restoreConfig(backup) {
  const { configFile, bytes } = backup
  if (bytes === null) {
    try {
      unlinkSync(configFile)
    } catch {
      // It was not there before and is not there now.
    }
    return
  }
  writeFileSync(configFile, bytes)
}

/**
 * Are the user's bytes back: the md5 of what is on disk now against the md5
 * of the backup. The backup is removed only when they are equal; otherwise
 * it stays and the caller says so.
 *
 * @param {{ configFile: string, backupFile: string, bytes: Buffer|null, md5Before: string|null }} backup
 * @returns {{ md5After: string|null, restored: boolean, backupRemoved: boolean }}
 */
export function verifyRestore(backup) {
  const { configFile, backupFile, bytes, md5Before } = backup
  if (bytes === null) return { md5After: null, restored: !existsSync(configFile), backupRemoved: false }
  let md5After = null
  try {
    md5After = md5(readFileSync(configFile))
  } catch {
    md5After = null
  }
  const restored = md5After === md5Before
  if (restored) unlinkSync(backupFile)
  return { md5After, restored, backupRemoved: restored }
}

