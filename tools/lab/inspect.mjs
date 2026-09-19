// `omakit lab inspect`, and the lab lines of `omakit doctor`: what the pin
// advertises, what is on disk, whether it was verified, what the host is
// missing, and what each missing thing costs. Read-only: no directory is
// created, no file is written, nothing is fetched. `--verify` re-hashes
// the ISO and re-checks the signature now instead of reporting the record.

import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { LAB_DIR, bytesBoth, durationWords, labPin } from "./pin.mjs"
import { allocatedBytes, labLayout, readJson } from "./paths.mjs"
import { BUILD_COMMANDS, VERIFY_COMMANDS, freeBytesAt, probeCommands, probeRunHost } from "./host.mjs"
import { judgeRelease, sha256File } from "./verify.mjs"
import { qmpAlive } from "./qemu.mjs"

/** The names the base directory holds; a manifest names the same. */
export const BASE_FILES = Object.freeze({
  disk: "base.qcow2",
  vars: "firmware-vars.template",
  key: "id_ed25519",
  publicKey: "id_ed25519.pub",
  manifest: "manifest.json",
})

/** The verified ISO's place under downloads: by digest, so a second release never shares a directory with the first. */
export function downloadDir(layout, pin = labPin()) {
  return join(layout.downloads, pin.release.sha256)
}

/**
 * The ISO on disk against its verification record. The record is what
 * `setup` wrote after the digest and the signature passed; the file is
 * held to the record by size and mtime, which is what can be read in a
 * millisecond, and `--verify` is the five-second re-hash.
 */
export function inspectDownload(layout, pin = labPin(), { verify = false, stagingRoot = layout.staging, onProgress } = {}) {
  const dir = downloadDir(layout, pin)
  const iso = join(dir, pin.release.fileName)
  const out = { dir, iso, present: false, bytes: null, partial: null, record: readJson(join(dir, "verified.json")), verified: false, reason: null, sidecars: { checksum: existsSync(`${iso}.sha256`), signature: existsSync(`${iso}.sig`) } }
  const part = `${iso}.part`
  if (existsSync(part)) out.partial = statSync(part).size
  if (!existsSync(iso)) {
    out.reason = out.partial !== null ? `not there; a partial download of ${out.partial.toLocaleString("en-US")} of ${pin.release.bytes.toLocaleString("en-US")} B is waiting to resume` : "not there"
    return out
  }
  const st = statSync(iso)
  out.present = true
  out.bytes = st.size
  if (verify) {
    const judged = judgeRelease({ file: iso, signature: out.sidecars.signature ? `${iso}.sig` : null, checksum: out.sidecars.checksum ? `${iso}.sha256` : null, pin, stagingRoot, onProgress })
    out.verified = judged.ok
    out.reason = judged.ok ? `verified now: ${judged.reason}` : `not verified: ${judged.reason}`
    out.judged = judged
    return out
  }
  if (!out.record) {
    out.reason = `${st.size.toLocaleString("en-US")} B on disk with no verification record; \`omakit lab setup\` verifies it, or \`omakit lab inspect --verify\` checks it now`
    return out
  }
  const same = out.record.bytes === st.size && out.record.sha256 === pin.release.sha256 && Math.abs(Number(out.record.mtimeMs) - st.mtimeMs) < 1
  out.verified = same
  out.reason = same
    ? `verified ${out.record.verifiedAt}: sha256 ${out.record.sha256}, signed by ${out.record.fingerprint}; the file's size and mtime still match that record`
    : `the file changed since the record of ${out.record.verifiedAt} (${out.record.bytes === st.size ? "same size, different mtime" : `${st.size.toLocaleString("en-US")} B now, ${Number(out.record.bytes).toLocaleString("en-US")} B then`}); \`omakit lab setup\` verifies it again`
  return out
}

/**
 * The base: missing, ready, mismatch (a base of another release than the
 * pin), or invalid (files without a complete manifest, or a disk whose
 * size is not the recorded one). Never booted here. `allocatedBytes` is
 * `du -B1` over the directory, the figure prune will recover.
 */
export function inspectBase(layout, pin = labPin()) {
  const dir = layout.base
  const out = { dir, state: "missing", reason: "no base; run `omakit lab setup`", manifest: null, allocatedBytes: 0, disk: join(dir, BASE_FILES.disk) }
  if (!existsSync(dir)) return out
  out.allocatedBytes = allocatedBytes(dir)
  const manifest = readJson(join(dir, BASE_FILES.manifest))
  const diskThere = existsSync(out.disk)
  if (!manifest || manifest.state !== "ready" || !manifest.release || !manifest.guest || !manifest.disk) {
    out.state = "invalid"
    out.reason = diskThere ? `${BASE_FILES.disk} is there (${bytesBoth(out.allocatedBytes)}) but ${BASE_FILES.manifest} is ${manifest ? "incomplete" : "missing"}; it will not be booted` : `a base directory with no disk and ${manifest ? "an incomplete" : "no"} manifest; \`omakit lab prune\` removes it`
    return out
  }
  out.manifest = manifest
  if (!diskThere) {
    out.state = "invalid"
    out.reason = `the manifest names ${BASE_FILES.disk} and it is not there; it will not be booted`
    return out
  }
  const size = statSync(out.disk).size
  if (size !== manifest.disk.bytes) {
    out.state = "invalid"
    out.reason = `${BASE_FILES.disk} is ${size.toLocaleString("en-US")} B and the manifest recorded ${Number(manifest.disk.bytes).toLocaleString("en-US")} B; it will not be booted`
    return out
  }
  for (const name of [BASE_FILES.vars, BASE_FILES.key]) {
    if (!existsSync(join(dir, name))) {
      out.state = "invalid"
      out.reason = `${name} is missing from the base directory; it will not be booted`
      return out
    }
  }
  if (manifest.release.sha256 !== pin.release.sha256 || manifest.guest.version !== pin.release.expectedGuestVersion) {
    out.state = "mismatch"
    out.reason = `cached Omarchy ${manifest.release.name} (guest ${manifest.guest.version}, iso ${manifest.release.sha256}); required ${pin.release.name} (guest ${pin.release.expectedGuestVersion}, iso ${pin.release.sha256}); \`omakit lab setup\` replaces it`
    return out
  }
  out.state = "ready"
  out.reason = `Omarchy ${manifest.release.name}, guest omarchy ${manifest.guest.version}; ${bytesBoth(out.allocatedBytes)}; created ${manifest.createdAt}`
  return out
}

/**
 * The toolchain: the omarchy-iso checkout `setup --toolchain` recorded,
 * whose harness must hash to the pinned patched digest before setup runs
 * it. What is checked is the file, not git state: a harness that hashes
 * to the pin is the pinned commit with the patch applied, whatever else
 * the checkout holds.
 */
export function inspectToolchain(layout, pin = labPin()) {
  const record = readJson(layout.toolchain)
  const out = { record, dir: record?.dir || null, harness: null, sha256: null, state: "missing", reason: null }
  if (!record?.dir) {
    out.reason = "no toolchain recorded; `omakit lab setup --toolchain <omarchy-iso checkout>` records one"
    return out
  }
  out.harness = join(record.dir, pin.toolchain.harness)
  if (!existsSync(out.harness)) {
    out.reason = `${out.harness} is not there (the recorded checkout moved or was removed)`
    return out
  }
  out.sha256 = sha256File(out.harness).sha256
  if (out.sha256 === pin.toolchain.patchedHarnessSha256) {
    out.state = "ready"
    out.reason = `${out.harness} hashes to the pinned patched harness (omarchy-iso ${pin.toolchain.commit.slice(0, 12)} with ${pin.toolchain.patch})`
  } else if (out.sha256 === pin.toolchain.upstreamHarnessSha256) {
    out.state = "unpatched"
    out.reason = `${out.harness} is the upstream harness at ${pin.toolchain.commit.slice(0, 12)} without the patch; \`git -C ${record.dir} apply ${join(LAB_DIR, pin.toolchain.patch)}\``
  } else {
    out.state = "unknown"
    out.reason = `${out.harness} hashes to ${out.sha256}, neither the pinned patched harness nor the upstream one at ${pin.toolchain.commit.slice(0, 12)}`
  }
  return out
}

/**
 * The one command that prepares a toolchain checkout, printed whole so it
 * can be run as it stands. `dir` is under the resolved lab cache: with
 * XDG_CACHE_HOME set, the remedy names that root, not ~/.cache (measured
 * on 2026-09-19 by a first user under XDG_CACHE_HOME=/tmp/empty-cache,
 * whose `lab inspect` printed clone and setup commands into ~/.cache;
 * docs/evidence/ux/2026-09-19-first-user-test.json, finding 6).
 */
export function toolchainCommand(pin = labPin(), dir = join(labLayout().cache, "toolchain/omarchy-iso")) {
  return `git clone ${pin.toolchain.repository} ${dir} && git -C ${dir} checkout --detach ${pin.toolchain.commit} && git -C ${dir} apply ${join(LAB_DIR, pin.toolchain.patch)} && omakit lab setup --toolchain ${dir}`
}

/** Staging directories, each with whether a QEMU still answers on its socket (the cross-namespace liveness question). */
export async function inspectStaging(layout) {
  if (!existsSync(layout.staging)) return []
  const entries = []
  for (const name of readdirSync(layout.staging).sort()) {
    const dir = join(layout.staging, name)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const socket = join(dir, "qmp.sock")
    const alive = existsSync(socket) ? (await qmpAlive(socket)).alive : false
    entries.push({ name, dir, allocatedBytes: allocatedBytes(dir), alive, socket: existsSync(socket) ? socket : null })
  }
  return entries
}

/** The lock: a directory with a record of the run holding it, and whether that run's QEMU still answers. */
export async function inspectLock(layout) {
  const record = readJson(join(layout.lock, "holder.json"))
  if (!existsSync(layout.lock)) return { held: false, record: null, alive: false }
  const alive = record?.qmpSocket ? (await qmpAlive(record.qmpSocket)).alive : false
  let pidAlive = false
  try {
    if (record?.pid) {
      process.kill(record.pid, 0)
      pidAlive = true
    }
  } catch {
    pidAlive = false
  }
  return { held: true, record, alive: alive || pidAlive, qemuAnswers: alive, holderPidAlive: pidAlive }
}

/**
 * Everything `inspect` and `doctor` print, as one document. `host` is the
 * run probes plus what acquisition and a build need; `missing` is the list
 * of what stands between this host and a run, each with its cost and the
 * one command.
 */
export async function inspectLab({ env = process.env, pin = labPin(), verify = false, onProgress, run } = {}) {
  const layout = labLayout(env)
  const download = inspectDownload(layout, pin, { verify, onProgress })
  const base = inspectBase(layout, pin)
  const toolchain = inspectToolchain(layout, pin)
  const staging = await inspectStaging(layout)
  const lock = await inspectLock(layout)
  const host = { run: probeRunHost({ pin, run, env }), verify: probeCommands(VERIFY_COMMANDS, { run, env }), build: probeCommands(BUILD_COMMANDS, { run, env }) }
  const free = freeBytesAt(layout.cache)
  const runs = existsSync(layout.runs) ? readdirSync(layout.runs).filter((name) => /^\d{8}-\d{6}/.test(name)).sort() : []
  const totals = {
    cacheBytes: existsSync(layout.cache) ? allocatedBytes(layout.cache) : 0,
    downloadsBytes: existsSync(layout.downloads) ? allocatedBytes(layout.downloads) : 0,
    baseBytes: base.allocatedBytes,
    stagingBytes: staging.reduce((sum, entry) => sum + entry.allocatedBytes, 0),
    pluginsBytes: existsSync(layout.plugins) ? allocatedBytes(layout.plugins) : 0,
    runsBytes: existsSync(layout.runs) ? allocatedBytes(layout.runs) : 0,
  }
  const missing = []
  for (const line of host.run) if (line.state !== "ok") missing.push({ what: line.name, cost: line.reason, command: line.remedy })
  if (!download.verified) {
    missing.push({
      what: "the verified ISO",
      cost: download.present ? `verification of the ${bytesBoth(download.bytes)} on disk (about ${durationWords(5215 + 9430)} on the reference host: the hash and the signature check)` : `a download of ${bytesBoth(pin.release.bytes)} from ${pin.release.isoUrl}, verified against the pinned sha256 and the Omarchy signature, into ${download.dir}`,
      command: "omakit lab setup",
    })
  }
  if (toolchain.state !== "ready" && base.state !== "ready") {
    missing.push({ what: "the toolchain", cost: `a checkout of omarchy-iso at ${pin.toolchain.commit.slice(0, 12)} with ${pin.toolchain.patch} applied; it drives the installer once, to build the base`, command: toolchainCommand(pin, join(layout.cache, "toolchain/omarchy-iso")) })
  }
  if (base.state !== "ready") {
    missing.push({
      what: base.state === "missing" ? "a prepared base" : `a usable base (the one there is ${base.state})`,
      cost: `${bytesBoth(pin.measured.baseDirectoryBytes)} on disk, ${durationWords(pin.measured.buildMilliseconds)} to build on the reference host (M14), plus one verification boot`,
      command: "omakit lab setup",
    })
  }
  return { pin: { release: pin.release, toolchain: pin.toolchain, guest: pin.guest, measured: pin.measured }, layout, download, base, toolchain, staging, lock, host, free, runs, totals, missing }
}
