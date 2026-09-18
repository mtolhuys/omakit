// Where the lab keeps its bytes, and the one guard every write goes
// through.
//
// Heavy files (the verified ISO, the base disk, a run's overlay) live
// under the user cache, $XDG_CACHE_HOME/omakit/lab or ~/.cache/omakit/lab;
// compact run records under the user state, $XDG_STATE_HOME/omakit/lab or
// ~/.local/state/omakit/lab. Nothing is written anywhere else: every path
// the lab writes to is built by `inLab`, which refuses a path outside the
// resolved root, and tests/unit/self-containment.test.mjs holds every
// write under tools/lab/ to that builder. Measured before this
// (docs/history/2026-09-18-lab-inventory.md P6): the base, the firmware
// variables and the SSH key lived inside the omarchy-iso checkout, named
// by the ISO's file name.

import { closeSync, createReadStream, createWriteStream, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { pipeline } from "node:stream/promises"
import { join, resolve, sep } from "node:path"
import { omakitCacheDir, omakitStateDir } from "../marketplace/paths.mjs"

/** The cache root: downloads, base, staging, the lock. */
export function labCacheDir(env = process.env) {
  return omakitCacheDir("lab", env)
}

/** The state root: run records, one directory per run id. */
export function labStateDir(env = process.env) {
  return omakitStateDir("lab", env)
}

/**
 * The layout under the cache root. One base, not one per release
 * (packaging/LAB_PLAN.md, the one-base rule): a pin update replaces it.
 */
export function labLayout(env = process.env) {
  const cache = labCacheDir(env)
  const state = labStateDir(env)
  return Object.freeze({
    cache,
    state,
    downloads: join(cache, "downloads"),
    base: join(cache, "base"),
    staging: join(cache, "staging"),
    plugins: join(cache, "plugins"),
    lock: join(cache, "lab.lock"),
    toolchain: join(cache, "toolchain.json"),
    runs: join(state, "runs"),
  })
}

/**
 * A path under one of the two lab roots, or a throw. Every write in
 * tools/lab/ names its target through this, so a target outside the lab
 * is a bug that fails before a byte moves, not a file somewhere else.
 */
export function inLab(root, ...parts) {
  const target = resolve(root, ...parts)
  const roots = [resolve(root)]
  if (!roots.some((allowed) => target === allowed || target.startsWith(`${allowed}${sep}`))) {
    throw new Error(`lab: ${target} is outside ${root}`)
  }
  return target
}

/** A directory under the lab, created private (0700) with its parents. */
export function labDir(root, ...parts) {
  const dir = inLab(root, ...parts)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** JSON written whole and fsynced, so a manifest is either there or not. */
export function writeJson(root, relative, value) {
  const file = inLab(root, relative)
  const fd = openSync(file, "w", 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return file
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/**
 * Move a file or directory within the lab: a rename when the two are on
 * one filesystem, and for a file on another one a streamed copy followed
 * by the removal of the source. The destination must not exist. This is
 * the one place the lab renames anything, and tests/unit/self-containment
 * holds the tree to it.
 */
export async function moveIntoLab(root, from, relative) {
  const to = inLab(root, relative)
  try {
    statSync(to)
    throw new Error(`lab: ${to} exists; nothing is moved over it`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  try {
    renameSync(from, to)
    return to
  } catch (error) {
    if (error.code !== "EXDEV") throw error
  }
  const source = statSync(from)
  if (!source.isFile()) throw new Error(`lab: ${from} is on another filesystem and is not a file; move it by hand`)
  await copyIntoLab(root, from, relative)
  unlinkSync(from)
  return to
}

/** A streamed copy of one file into the lab, mode 0600, fsynced. The destination must not exist. */
export async function copyIntoLab(root, from, relative) {
  const to = inLab(root, relative)
  try {
    statSync(to)
    throw new Error(`lab: ${to} exists; nothing is copied over it`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const out = createWriteStream(to, { mode: 0o600, flags: "wx" })
  await pipeline(createReadStream(from), out)
  const fd = openSync(to, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return to
}

/** Remove something under the lab, and nothing outside it. */
export function removeFromLab(root, relative) {
  rmSync(inLab(root, relative), { recursive: true, force: true })
}

/** `20260918-150245`, the run id shape the toolchain used, kept so a run directory sorts by time. */
export function stampNow(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Allocated bytes of a path, like `du -B1`: blocks times 512, so a sparse qcow2 is measured by what it takes. */
export function allocatedBytes(path) {
  const walk = (p) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return 0
    }
    let total = st.blocks * 512
    if (st.isDirectory()) {
      let entries = []
      try {
        entries = readdirSync(p)
      } catch {
        return total
      }
      for (const entry of entries) total += walk(join(p, entry))
    }
    return total
  }
  return walk(path)
}
