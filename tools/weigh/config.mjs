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
//
// Nothing here writes without a lease, and a lease is opened only with the
// person's consent in hand: `backupConfig()` refuses `consented: true`
// absent, and the two writes that follow take the lease it returned, so
// there is no order of calls in which a measurement configuration reaches
// shell.json before its backup exists or before anyone agreed. Measured on
// 2026-09-19: two omakit backups appeared beside a person's shell.json in a
// window when they had authorised no weighing on their own machine; the
// writes came from consented runs in another session, but the code allowed
// a write with nothing but a path (docs/evidence/ux/2026-09-19-acceptance.json,
// finding 1). Every write is a whole file renamed into place, so a process
// killed mid-write leaves the old file whole, never a truncated one.

import { createHash } from "node:crypto"
import { closeSync, existsSync, fsyncSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** Where Omarchy keeps the shell configuration: `~/.config/omarchy/shell.json`, the path the shell itself reads. */
export function configPaths(env = process.env) {
  const dir = join(env.HOME || "", ".config/omarchy")
  return { dir, file: join(dir, "shell.json") }
}

/** The md5 of a buffer, as hex: what is printed before and after, and compared. */
export function md5(bytes) {
  return createHash("md5").update(bytes).digest("hex")
}

/** The name every backup carries: `shell.json.omakit-backup-<UTC stamp, YYYYMMDDHHMMSS>`, the second the measurement began. */
export const BACKUP_SUFFIX = ".omakit-backup-"
const BACKUP_NAME = /\.omakit-backup-(\d{14})$/

/**
 * The backups already beside the configuration, oldest first: each one is
 * a measurement that did not reach its verification, or one whose restore
 * did not verify, and `planWeigh` refuses to start another until the
 * person has looked at it (docs/WEIGH.md).
 *
 * @returns {{ file: string, stamp: string, startedAt: string }[]}
 */
export function backupsBeside(configFile) {
  const dir = dirname(configFile)
  const name = basename(configFile)
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.startsWith(`${name}${BACKUP_SUFFIX}`) && BACKUP_NAME.test(entry))
    .sort()
    .map((entry) => {
      const stamp = entry.match(BACKUP_NAME)[1]
      return { file: join(dir, entry), stamp, startedAt: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z` }
    })
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

/** A refusal from this module: no lease, or a lease nobody consented to. */
export class ConsentError extends Error {
  constructor(message) {
    super(message)
    this.name = "ConsentError"
    this.code = "not-confirmed"
  }
}

function requireLease(lease, what) {
  if (!lease || lease.consented !== true || typeof lease.configFile !== "string" || typeof lease.backupFile !== "string") {
    throw new ConsentError(`${what} needs the lease backupConfig() returns after consent; nothing was written`)
  }
}

/**
 * The whole file, then the name: written to `<target>.part` beside its
 * target, fsynced, and renamed into place, so at every instant the target
 * is either the old file or the new one. The mode is set on the part file
 * before the rename, so a 0600 shell.json stays 0600.
 */
function writeWhole(target, bytes, mode) {
  const part = `${target}.part`
  const fd = openSync(part, "w", mode)
  try {
    writeFileSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(part, target)
}

/**
 * Read the configuration file and write its bytes to a timestamped backup
 * beside it. Returns the lease every later write needs: the bytes, the
 * backup path, the md5 and the mode. A missing file is recorded as such
 * and restored by removal. Refuses without `consented: true`.
 *
 * @param {string} configFile
 * @param {string} stamp UTC, `YYYYMMDDHHMMSS`
 * @param {{ consented: boolean }} consent
 */
export function backupConfig(configFile, stamp, { consented = false } = {}) {
  if (consented !== true) throw new ConsentError("a backup of shell.json is the first write of a measurement, and no measurement was consented to; nothing was written")
  let bytes = null
  let mode = 0o600
  try {
    bytes = readFileSync(configFile)
    // The same mode as the original: shell.json is 0600 on an Omarchy
    // install, and a copy of a private file is a private file.
    mode = statSync(configFile).mode & 0o777
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const backupFile = `${configFile}${BACKUP_SUFFIX}${stamp}`
  if (bytes !== null) writeWhole(backupFile, bytes, mode)
  return { configFile, backupFile, bytes, mode, md5Before: bytes === null ? null : md5(bytes), consented: true }
}

/**
 * Write one configuration for a run. The document is serialised the way
 * `jq .` would, two-space indented, so the shell reads exactly what the
 * transform produced. Takes the lease, never a bare path.
 */
export function writeConfig(lease, config) {
  requireLease(lease, "writing a measurement configuration")
  writeWhole(lease.configFile, Buffer.from(`${JSON.stringify(config, null, 2)}\n`), lease.mode)
}

/**
 * Put the user's bytes back, whole. Verification is a separate step, after
 * the shell has been restarted on them: a shell that rewrites the file as
 * it starts is exactly what the md5 has to catch, so it is read after the
 * restart and not before.
 *
 * @param {{ configFile: string, bytes: Buffer|null, mode: number, consented: true }} lease
 */
export function restoreConfig(lease) {
  requireLease(lease, "restoring shell.json")
  const { configFile, bytes, mode } = lease
  if (bytes === null) {
    try {
      unlinkSync(configFile)
    } catch {
      // It was not there before and is not there now.
    }
    return
  }
  writeWhole(configFile, bytes, mode)
}

/**
 * Are the user's bytes back: the md5 of what is on disk now against the md5
 * of the backup. The backup is removed only when they are equal; otherwise
 * it stays and the caller says so.
 *
 * @param {{ configFile: string, backupFile: string, bytes: Buffer|null, md5Before: string|null }} lease
 * @returns {{ md5After: string|null, restored: boolean, backupRemoved: boolean }}
 */
export function verifyRestore(lease) {
  const { configFile, backupFile, bytes, md5Before } = lease
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
