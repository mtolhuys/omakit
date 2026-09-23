// `omakit lab setup`: the only path that may fetch bytes, and the only one
// that builds a base.
//
// One explicit consent, stating the exact size and the destination,
// before the first byte; `--yes` is that consent in the command itself
// for automation, and a pipe without it refuses. The plan is computed
// first and reads only; the disclosure prints it whole; then, in order:
//
//   0. The newest release, found by release.mjs before the plan is made:
//      the newest at or above the floor whose ISO, checksum and signature
//      are published, signed by the key omakit ships. A setup whose host
//      cannot build is refused before that read.
//   1. The ISO, into $XDG_CACHE_HOME/omakit/lab/downloads/<sha256>/: a
//      literal GET of the release's versioned URL to a .part file, resumed
//      by byte range, or a copy of a local file named with --from.
//   2. Verification, of a downloaded file and of a file already there
//      alike: the byte count and the SHA-256 against what the release
//      publishes, the sidecar fetched now against the digest read at the
//      start, the detached signature against the packaged key at the
//      pinned fingerprint. A mismatch fails closed: the file is left as
//      .part, nothing is recorded, nothing boots it.
//   3. The base, built by the pinned omarchy-iso toolchain's console
//      driver from the verified ISO, in a staging directory under the lab
//      (the driver derives its base directory from its own location, so
//      a copy of the one script into staging keeps it out of the
//      checkout: docs/history/2026-09-18-lab-inventory.md P6, P19), then
//      booted once by the lab's own driver to read the installed
//      omarchy package, hashed, made read-only, given its manifest, and
//      promoted with one rename. The base it replaces, and the downloads
//      of older releases, are removed only after that: until the new base
//      verifies, a run uses the old one.
//
// Never fetched: the toolchain. It is a git checkout at a pinned commit
// with the packaged patch applied, and the one command that makes it is
// printed; `--toolchain <dir>` records where it is, after hashing its
// harness against the pin.

import { spawn, spawnSync } from "node:child_process"
import { chmodSync, closeSync, createWriteStream, existsSync, fsyncSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { getStream, GitHubError } from "../marketplace/github.mjs"
import { LAB_DIR, bytesBoth, compareVersions, durationWords, guestIsRelease, labPin, releaseOf, withRelease } from "./pin.mjs"
import { allocatedBytes, copyIntoLab, inLab, labDir, labLayout, moveIntoLab, readJson, removeFromLab, stampNow, writeJson } from "./paths.mjs"
import { BUILD_COMMANDS, VERIFY_COMMANDS, freeBytesAt, probeCommands, probeRunHost } from "./host.mjs"
import { judgeRelease, packagedKey, sha256File, signatureIssuers, signedByPinned } from "./verify.mjs"
import { sidecarDigest, smallBody } from "./release.mjs"
import { BASE_FILES, baseRelease, buildGuests, downloadDir, downloadEntry, inspectBase, inspectDownload, inspectToolchain, toolchainCommand } from "./inspect.mjs"
import { LabError, acquireLock, freePort, releaseLock, withGuest } from "./run.mjs"
import { WEIGH_LISTED, listedPlugin } from "./suites.mjs"
import { marketplacePinDir } from "../marketplace/pin.mjs"

/** Record the toolchain checkout after hashing its harness against the pin; the only write `--toolchain` makes. */
export function recordToolchain({ dir, env = process.env, pin = labPin() }) {
  const layout = labLayout(env)
  const checkout = resolve(dir)
  const harness = join(checkout, pin.toolchain.harness)
  if (!existsSync(harness)) throw new LabError("toolchain-missing", `${harness} is not there; --toolchain names a checkout of ${pin.toolchain.repository}`, { remedy: toolchainCommand(pin, checkout) })
  const { sha256 } = sha256File(harness)
  if (sha256 !== pin.toolchain.patchedHarnessSha256) {
    const unpatched = sha256 === pin.toolchain.upstreamHarnessSha256
    throw new LabError("toolchain-mismatch", unpatched
      ? `${harness} is the upstream harness at ${pin.toolchain.commit.slice(0, 12)} without the lab patch`
      : `${harness} hashes to ${sha256}; the pinned patched harness is ${pin.toolchain.patchedHarnessSha256} (omarchy-iso ${pin.toolchain.commit.slice(0, 12)} with ${pin.toolchain.patch})`,
    { remedy: unpatched ? `git -C ${checkout} apply ${join(LAB_DIR, pin.toolchain.patch)} && omakit lab setup --toolchain ${checkout}` : toolchainCommand(pin, checkout) })
  }
  labDir(layout.cache)
  writeJson(layout.cache, "toolchain.json", { dir: checkout, harnessSha256: sha256, commit: pin.toolchain.commit, recordedAt: new Date().toISOString() })
  return { dir: checkout, sha256 }
}

/** The newest release, not looked up yet: what the first, network-free plan is made with. */
export const NOT_ASKED = Object.freeze({ checked: false, code: "not-asked", reason: "the newest release was not looked up" })

/**
 * The release a local file names when the release list cannot be read:
 * `omarchy-<version>.iso`, with its `.sha256` and `.sig` beside it, at or
 * above the floor, signed (by the packet's own word) by the key omakit
 * ships. Verification still hashes it and runs gpg before anything boots
 * it; this only names what it claims to be. `{ release }` or `{ blocker }`.
 */
export function localRelease(pin, file) {
  const source = resolve(file)
  const name = source.split("/").at(-1).match(/^omarchy-(\d+\.\d+\.\d+)\.iso$/)?.[1]
  const command = "omakit lab setup --from <omarchy-X.Y.Z.iso> with its .sha256 and .sig beside it, or with the network, omakit lab setup"
  if (!existsSync(source)) return { blocker: { what: "the file named by --from", cost: `${source} is not there`, command } }
  if (!name) return { blocker: { what: "the file named by --from", cost: `${source} is not named omarchy-<version>.iso, so it names no release; without the network there is nothing else to name one`, command } }
  if (compareVersions(name, pin.releases.floor) < 0) return { blocker: { what: "the file named by --from", cost: `Omarchy ${name} is older than ${pin.releases.floor}, the oldest release the lab takes`, command } }
  let sha256 = null
  try {
    sha256 = sidecarDigest(readFileSync(`${source}.sha256`, "utf8"), source.split("/").at(-1))
  } catch {
    sha256 = null
  }
  if (!sha256) return { blocker: { what: "the checksum beside --from", cost: `${source}.sha256 is missing or does not name the file with a SHA-256`, command } }
  let signers = null
  try {
    signers = signatureIssuers(readFileSync(`${source}.sig`))
  } catch {
    return { blocker: { what: "the signature beside --from", cost: `${source}.sig is not there; nothing boots a release whose signature was not checked`, command } }
  }
  if (signedByPinned(signers, pin.releases.signingFingerprint) === false) return { blocker: { what: "the signature beside --from", cost: `${source}.sig is by ${signers.map((signer) => signer.fingerprint || `key ${signer.keyId}`).join(" and ")}, not the key omakit ships (${pin.releases.signingFingerprint})`, command: "omakit upgrade" } }
  return { release: releaseOf(pin, { name, bytes: statSync(source).size, sha256 }) }
}

/**
 * Download directories a new base supersedes, removed once it verifies:
 * every one but the release's own, except a newer release's. Never going
 * back a release holds for the downloads too: with no base, a newer ISO
 * verified by an earlier setup stays when this one builds an older
 * release (its checksum was being republished when the search ran).
 */
function supersededDownloads(layout, release) {
  if (!existsSync(layout.downloads)) return []
  return readdirSync(layout.downloads)
    .filter((digest) => /^[0-9a-f]{64}$/.test(digest) && digest !== release.sha256)
    .map((digest) => ({ digest, relative: `downloads/${digest}`, name: downloadEntry(join(layout.downloads, digest), digest).name, bytes: allocatedBytes(join(layout.downloads, digest)) }))
    .filter((entry) => !entry.name || compareVersions(entry.name, release.name) <= 0)
}

/**
 * The plan, reading only: what setup would do on this host, with every
 * size and the destination. `steps` is what the consent covers.
 *
 * `newest` is release.mjs's check. With NOT_ASKED the plan holds only what
 * no release changes (the commands verification needs, and, when there is
 * no usable base, what a build needs), so a setup that cannot start says
 * so without a network read. With the newest release found, the plan
 * prepares it; with the lookup failed, a usable base on disk is left as it
 * is and the plan says the newest was not checked, and with none there,
 * that is the blocker.
 */
export function planSetup({ env = process.env, pin = labPin(), newest = NOT_ASKED, from = null, plugins = false, repoRoot } = {}) {
  const layout = labLayout(env)
  const toolchain = inspectToolchain(layout, pin)
  const free = freeBytesAt(layout.cache)
  const steps = []
  const blockers = []
  const buildBlockers = (withBuild) => {
    for (const line of probeRunHost({ pin, env })) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
    if (!withBuild) return
    for (const line of probeCommands(BUILD_COMMANDS, { env })) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
    if (toolchain.state !== "ready") blockers.push({ what: "the toolchain", cost: toolchain.reason, command: toolchain.state === "unpatched" ? `git -C ${toolchain.dir} apply ${join(LAB_DIR, pin.toolchain.patch)} && omakit lab setup --toolchain ${toolchain.dir}` : toolchainCommand(pin, join(layout.cache, "toolchain/omarchy-iso")) })
  }
  for (const line of probeCommands(VERIFY_COMMANDS, { env })) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
  // The base against its own release: whether a run can use what is there.
  const own = baseRelease(layout, pin)
  const current = inspectBase(layout, withRelease(pin, own))
  const usable = current.state === "ready"
  // The listed plugins are asked for whatever the base does: a base kept
  // as it is (the newest not looked up, or one newer than the newest) is
  // no reason to leave `prove weigh-evidence` without them.
  let pluginsPlanned = false
  const addPlugins = () => {
    if (!plugins || pluginsPlanned) return
    pluginsPlanned = true
    const pinDir = marketplacePinDir(repoRoot)
    const wanted = []
    for (const id of WEIGH_LISTED) {
      const listing = listedPlugin(pinDir, id)
      if (!listing.ok) blockers.push({ what: `${id} in the pinned catalog`, cost: listing.reason, command: "omakit pin" })
      else wanted.push({ id, repo: listing.repo, commit: listing.commit, to: join(layout.plugins, id) })
    }
    if (wanted.length) steps.push({ kind: "plugins", plugins: wanted, to: layout.plugins, bytes: pin.measured.pluginsBytes || null })
  }
  const done = (release, extra = {}) => ({ layout, pin: withRelease(pin, release), newest, download: null, base: current, toolchain, free, steps, blockers, needed: 0, afterBytes: 0, ...extra })
  if (!newest.checked && newest.code === "not-asked") {
    // Whatever the newest release turns out to be, a host with no usable
    // base builds one: those blockers are known before the network.
    if (!usable) buildBlockers(stagedBases(layout).length === 0)
    return done(own, { asked: false })
  }
  let release = newest.checked ? newest.release : null
  if (from && newest.checked) {
    const named = resolve(from).split("/").at(-1).match(/^omarchy-(\d+\.\d+\.\d+)\.iso$/)?.[1]
    if (named && named !== release.name) blockers.push({ what: "the file named by --from", cost: `${resolve(from)} is Omarchy ${named}; the newest release is ${release.name}, and setup prepares the newest`, command: `omakit lab setup --from <path to ${release.fileName}>, or without --from to download it` })
  } else if (from) {
    const local = localRelease(pin, from)
    if (local.blocker) blockers.push(local.blocker)
    release = local.release || null
  }
  if (!release) {
    // The newest could not be looked up. A usable base stays as it is and
    // the plan says what was not checked; with none, that is the blocker.
    if (usable) {
      addPlugins()
      return done(own, { stale: { base: own.name, reason: newest.reason, code: newest.code } })
    }
    if (!from) blockers.push({ what: "the newest Omarchy release", cost: `it could not be looked up: ${newest.reason}`, command: "connect to the network and run omakit lab setup again, or omakit lab setup --from <omarchy-X.Y.Z.iso> with its .sha256 and .sig beside it" })
    return done(null)
  }
  pin = withRelease(pin, release)
  const download = inspectDownload(layout, pin)
  const base = inspectBase(layout, pin)
  // A good base newer than the release in hand is kept: the lab never goes
  // back a release on its own (inspect.mjs, `ahead`), and nothing older is
  // fetched or built over it.
  if (base.state === "ahead") {
    addPlugins()
    return done(release, { download, base, ahead: { base: base.manifest.release.name, release: release.name, from: newest.checked ? "newest" : "from" } })
  }
  if (!download.verified) {
    if (from) {
      const source = resolve(from)
      if (!existsSync(source)) blockers.push({ what: `the file named by --from`, cost: `${source} is not there`, command: `omakit lab setup --from <path to ${release.fileName}>` })
      else steps.push({ kind: "import", from: source, bytes: statSync(source).size, to: join(download.dir, release.fileName), sidecars: { checksum: existsSync(`${source}.sha256`) ? `${source}.sha256` : null, signature: existsSync(`${source}.sig`) ? `${source}.sig` : null } })
    } else if (download.present) {
      steps.push({ kind: "verify", file: download.iso, bytes: download.bytes })
    } else {
      steps.push({ kind: "download", url: release.isoUrl, bytes: release.bytes, resumeFrom: download.partial || 0, to: join(download.dir, release.fileName) })
    }
    steps.push({ kind: "sidecars", bytes: 203, urls: [release.checksumUrl, release.signatureUrl], to: download.dir })
  }
  if (base.state !== "ready") {
    // A base the toolchain built for this release but a verification boot
    // never promoted (an interrupted or failed setup) is verified and
    // promoted, not rebuilt: six minutes and six gigabytes are not spent
    // twice. One built from another release is left for prune.
    const staged = stagedBases(layout, release)
    buildBlockers(staged.length === 0)
    const replacing = base.state === "missing" ? null : base
    const superseded = supersededDownloads(layout, release)
    if (staged.length) {
      steps.push({ kind: "promote", staged: staged.at(-1), to: layout.base, replacing, superseded })
    } else {
      steps.push({ kind: "build", toolchain: toolchain.harness, to: layout.base, replacing, superseded, bytes: pin.measured.baseDirectoryBytes, milliseconds: pin.measured.buildMilliseconds })
    }
  }
  addPlugins()
  const needed = steps.reduce((sum, step) => sum + (step.kind === "download" ? step.bytes - (step.resumeFrom || 0) : step.kind === "import" ? step.bytes : step.kind === "build" ? step.bytes : 0), 0)
  if (steps.length && free.bytes < needed) blockers.push({ what: "disk", cost: `${bytesBoth(free.bytes)} free at ${free.path}; this setup needs ${bytesBoth(needed)}`, command: "omakit lab prune" })
  // Afterwards: this ISO and a base the size the measured release's was.
  return { layout, pin, newest, download, base, toolchain, free, steps, blockers, needed, afterBytes: release.bytes + pin.measured.baseDirectoryBytes }
}

/**
 * Staged bases awaiting verification: `staging/base-*` with the four files
 * and no manifest, oldest first. With a release, only the ones built from
 * its ISO: the build record names the ISO it was built from, and a base of
 * another release would never pass the verification boot's guest check.
 */
export function stagedBases(layout, release = null) {
  if (!existsSync(layout.staging)) return []
  return readdirSync(layout.staging).filter((name) => /^base-\d{8}-\d{6}$/.test(name)).sort()
    .map((name) => join(layout.staging, name))
    .filter((dir) => [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key, BASE_FILES.publicKey].every((file) => existsSync(join(dir, file))) && !existsSync(join(dir, BASE_FILES.manifest)))
    .filter((dir) => {
      if (!release) return true
      const record = readJson(join(dir, "build", "lab-build.json"))
      return record?.release?.sha256 === release.sha256 || String(record?.iso || "").includes(`/downloads/${release.sha256}/`)
    })
}

/** The lines of the disclosure, exactly as the contract in docs/LAB.md shows them; the consent question follows them. */
export function disclosureLines(plan) {
  const { pin } = plan
  const lines = []
  const download = plan.steps.find((step) => step.kind === "download")
  const imported = plan.steps.find((step) => step.kind === "import")
  const build = plan.steps.find((step) => step.kind === "build")
  const plugins = plan.steps.find((step) => step.kind === "plugins")
  // Plugins alone: the base stays as it is, and the lines say why.
  if (!plan.steps.some((step) => ["download", "import", "verify", "sidecars", "build", "promote"].includes(step.kind))) {
    const baseName = plan.base?.manifest?.release?.name
    lines.push(["Omarchy", plan.stale
      ? `the base there, Omarchy ${plan.stale.base}, left as it is: the newest release could not be looked up (${plan.stale.reason})`
      : plan.ahead
        ? `the base there, Omarchy ${plan.ahead.base}, kept: newer than ${plan.ahead.release}`
        : `the base there, Omarchy ${baseName || pin.release?.name}, ${plan.newest?.checked ? "the newest release" : "left as it is"}`])
    if (plugins) lines.push(["plugins", `${plugins.plugins.length} listed plugins at their validated commits, shallow, into ${plugins.to}`])
    lines.push(["store", plan.layout.cache])
    lines.push(["on disk", `${bytesBoth(plan.free.bytes)} free now`])
    return lines
  }
  const found = plan.newest?.checked
    ? `the newest published (${plan.newest.tag}${plan.newest.publishedAt ? `, ${plan.newest.publishedAt.slice(0, 10)}` : ""}, found now in ${plan.newest.list.replace(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases.*$/, "github.com/$1")})`
    : `from the file named by --from; the newest could not be looked up (${plan.newest?.reason || "not asked"})`
  lines.push(["Omarchy", `release ${pin.release.name}, ${found}; the guest will run omarchy ${pin.release.name}`])
  for (const skipped of plan.newest?.skipped || []) lines.push(["newer", `${skipped.name} is tagged and passed over: ${skipped.reason}`])
  if (download) lines.push(["download", `${bytesBoth(download.bytes - download.resumeFrom)}${download.resumeFrom ? ` (resuming at ${download.resumeFrom.toLocaleString("en-US")} of ${download.bytes.toLocaleString("en-US")} B)` : ""}`], ["from", download.url])
  else if (imported) lines.push(["download", "0 B: the file named by --from is copied and verified"], ["from", imported.from])
  else lines.push(["download", "0 B: the ISO on disk is verified"])
  lines.push(["verify", `SHA-256 ${pin.release.sha256} as published beside it, and the Omarchy signature ${pin.release.signingFingerprint}, the key omakit ships`])
  lines.push(["store", plan.layout.cache])
  const promote = plan.steps.find((step) => step.kind === "promote")
  const replacing = (step, what) => {
    const parts = []
    if (step.replacing) parts.push(`the ${step.replacing.state} base there${step.replacing.manifest ? ` (Omarchy ${step.replacing.manifest.release.name}, ${bytesBoth(step.replacing.allocatedBytes)})` : ` (${bytesBoth(step.replacing.allocatedBytes)})`}`)
    const older = step.superseded || []
    if (older.length) parts.push(`${older.length === 1 ? "one older download" : `${older.length} older downloads`}${older.some((entry) => entry.name) ? ` (${older.map((entry) => entry.name || entry.digest.slice(0, 12)).join(", ")})` : ""}, ${bytesBoth(older.reduce((sum, entry) => sum + entry.bytes, 0))}`)
    if (parts.length) lines.push(["replacing", `${parts.join(", and ")}, removed after ${what} verifies; until then a run uses what is there`])
  }
  if (build) {
    lines.push(["build", `${durationWords(build.milliseconds)} measured with Omarchy ${pin.measured.release} on the reference host (M14); download excluded`])
    replacing(build, "the new base")
  }
  if (promote) {
    lines.push(["build", `none: the base the toolchain built at ${promote.staged} is booted once, verified and promoted`])
    replacing(promote, "the staged base")
  }
  if (plugins) lines.push(["plugins", `${plugins.plugins.length} listed plugins at their validated commits, shallow, into ${plugins.to}`])
  lines.push(["afterwards", "verified ISO, one immutable base, and manifests"])
  lines.push(["on disk", `about ${bytesBoth(plan.afterBytes)}: this ISO and a base the size Omarchy ${pin.measured.release}'s measured (M14), before evidence; ${bytesBoth(plan.free.bytes)} free now`])
  return lines
}

/** The one question. */
export const CONSENT_QUESTION = "Acquire and build this verified base now?"

/**
 * A resumable literal GET of the release's ISO to `<to>.part`. The byte
 * count is checked against the release's as it arrives and at the end; a
 * server that answers 200 to a range request restarts the file.
 */
export async function downloadRelease({ url, to, bytes, onProgress = () => {}, signal, fetchStream = getStream }) {
  const part = `${to}.part`
  let have = existsSync(part) ? statSync(part).size : 0
  if (have > bytes) {
    removeFromLab(resolve(to, ".."), `${to.split("/").at(-1)}.part`)
    have = 0
  }
  let response
  try {
    response = await fetchStream(url, { rangeFrom: have, signal })
  } catch (error) {
    if (error?.code === "interrupted") throw new LabError("interrupted", "interrupted; the partial download stays and resumes next time", { remedy: "omakit lab setup: the download resumes where it stopped" })
    if (error instanceof GitHubError) throw new LabError(error.code, error.message, { remedy: "check the network, then run `omakit lab setup` again; the download resumes" })
    throw error
  }
  const append = response.status === 206 && have > 0
  const expected = append ? bytes - have : bytes
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > 0 && length !== expected) {
    throw new LabError("size-mismatch", `${url} announces ${length.toLocaleString("en-US")} B where ${expected.toLocaleString("en-US")} were expected; the object at the versioned URL changed since the release was read`, { remedy: "omakit lab setup: the release is read again" })
  }
  const out = createWriteStream(part, { flags: append ? "a" : "w", mode: 0o600 })
  let written = append ? have : 0
  const started = Date.now()
  const interrupted = () => new LabError("interrupted", "interrupted; the partial download stays and resumes next time", { remedy: "omakit lab setup: the download resumes where it stopped" })
  try {
    for await (const chunk of response.body) {
      if (signal?.aborted) throw interrupted()
      written += chunk.length
      if (written > bytes) throw new LabError("size-mismatch", `${url} sent more than the ${bytes.toLocaleString("en-US")} B it announced`)
      if (!out.write(chunk)) await new Promise((resolvePromise) => out.once("drain", resolvePromise))
      onProgress(written, bytes, Date.now() - started)
    }
  } catch (error) {
    // An abort while the body streams ends the loop with the abort's own
    // reason ("SIGINT", a bare string), not with the check above: it is an
    // interrupt, said as one, with the exit status the signal gives.
    if (signal?.aborted && !(error instanceof LabError)) throw interrupted()
    throw error
  } finally {
    await new Promise((resolvePromise) => out.end(resolvePromise))
  }
  if (written !== bytes) throw new LabError("size-mismatch", `${url} ended at ${written.toLocaleString("en-US")} of ${bytes.toLocaleString("en-US")} B; run setup again to resume`)
  return { part, bytes: written, milliseconds: Date.now() - started }
}

/** The two sidecars, small, to the download directory; the signature is required, the checksum compared. */
async function fetchSidecars({ pin, dir, layout, fetchStream = getStream, signal }) {
  for (const [url, name] of [[pin.release.checksumUrl, `${pin.release.fileName}.sha256`], [pin.release.signatureUrl, `${pin.release.fileName}.sig`]]) {
    let response
    try {
      response = await fetchStream(url, { signal })
    } catch (error) {
      if (error?.code === "interrupted") throw new LabError("interrupted", "interrupted while fetching the checksum and signature; what was downloaded stays", { remedy: "omakit lab setup: it picks up where it stopped" })
      if (error instanceof GitHubError) throw new LabError(error.code, error.message, { remedy: "check the network, then run `omakit lab setup` again" })
      throw error
    }
    let body
    try {
      body = await smallBody(response, url, "sidecar-mismatch")
    } catch (error) {
      if (signal?.aborted && !(error instanceof LabError)) throw new LabError("interrupted", "interrupted while fetching the checksum and signature; what was downloaded stays", { remedy: "omakit lab setup: it picks up where it stopped" })
      throw error
    }
    writeFileSync(inLab(layout.cache, `downloads/${pin.release.sha256}/${name}`), body, { mode: 0o600 })
  }
}

/** Verify the file at `<to>.part` (or an import copy) and promote it to `to`, recording the verification. */
async function verifyAndPromote({ candidate, to, pin, layout, stagingRoot, onProgress }) {
  const dir = resolve(to, "..")
  const signature = `${to}.sig`
  const checksum = `${to}.sha256`
  const judged = judgeRelease({ file: candidate, signature: existsSync(signature) ? signature : null, checksum: existsSync(checksum) ? checksum : null, pin, stagingRoot, onProgress })
  if (!judged.ok) {
    throw new LabError("iso-mismatch", `the file at ${candidate} is not Omarchy ${pin.release.name} as published: ${judged.reason}; it stays where it is and nothing will boot it`, { remedy: "remove it with `omakit lab prune`, then `omakit lab setup` again" })
  }
  if (judged.sidecarMatch === false) throw new LabError("sidecar-mismatch", `the checksum published now names ${judged.sidecarSha256}, and ${pin.release.sha256} when setup read the release: Omarchy republished ${pin.release.fileName} while setup ran, and this file is the earlier one`, { remedy: "omakit lab setup: it reads the release again and fetches what is published now" })
  if (candidate !== to) await moveIntoLab(layout.cache, candidate, `downloads/${pin.release.sha256}/${pin.release.fileName}`)
  chmodSync(to, 0o444)
  const st = statSync(to)
  writeJson(layout.cache, `downloads/${pin.release.sha256}/verified.json`, { schema: 1, name: pin.release.name, fileName: pin.release.fileName, sha256: judged.sha256, bytes: st.size, mtimeMs: st.mtimeMs, fingerprint: judged.signature.fingerprint, signer: judged.signature.detail, sidecarSha256: judged.sidecarSha256, verifiedAt: new Date().toISOString() })
  return { file: to, judged, dir }
}

/**
 * Stop what a build left running under `stagingDir` (inspect.mjs
 * buildGuests): SIGTERM, which QEMU takes as a clean shutdown, then SIGKILL
 * after fifteen seconds. Runs after the driver exits for any reason, an
 * interrupt included, so no guest outlives the setup that started it.
 */
export async function stopBuildGuests(stagingDir, onLine = () => {}) {
  for (const guest of buildGuests(stagingDir)) {
    try {
      process.kill(guest.pid, "SIGTERM")
    } catch {
      continue
    }
    const deadline = Date.now() + 15_000
    let alive = true
    while (alive && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
      try {
        process.kill(guest.pid, 0)
      } catch {
        alive = false
      }
    }
    if (alive) {
      try {
        process.kill(guest.pid, "SIGKILL")
      } catch {
        // Gone between the last check and this one.
      }
    }
    onLine({ state: "info", text: `stopped the build's QEMU (pid ${guest.pid}), which the driver left running` })
  }
}

/**
 * Build the base with the toolchain's console driver, verify it by
 * booting it, and promote it. The driver runs from a copy under staging,
 * so its `test-runs/` lands there and never in the checkout.
 */
async function buildBase({ pin, layout, toolchainHarness, iso, onPhase, onLine, signal, repoRoot }) {
  const buildId = `build-${stampNow()}`
  const stagingDir = labDir(layout.cache, "staging", buildId)
  labDir(layout.cache, "staging", buildId, "bin")
  const harnessCopy = await copyIntoLab(layout.cache, toolchainHarness, `staging/${buildId}/bin/omarchy-iso-test`)
  const { sha256 } = sha256File(harnessCopy)
  if (sha256 !== pin.toolchain.patchedHarnessSha256) throw new LabError("toolchain-mismatch", `the harness changed between the check and the copy (${sha256})`)
  chmodSync(harnessCopy, 0o700)
  const port = await freePort(2322)
  const started = Date.now()
  onPhase(`building the base with the toolchain (about ${durationWords(pin.measured.buildMilliseconds)} on the reference host)`)
  const log = openSync(inLab(layout.cache, `staging/${buildId}/build.log`), "a", 0o600)
  const status = await new Promise((resolvePromise) => {
    const child = spawn("bash", [harnessCopy, iso, "--install-only", "--memory", String(pin.guest.memoryMiB), "--port", String(port), "--no-preview"], { cwd: stagingDir, stdio: ["ignore", "pipe", "pipe"] })
    let buffer = ""
    const feed = (chunk) => {
      writeFileSync(log, chunk)
      buffer += chunk.toString("utf8")
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        // The toolchain paints its log lines; the escape is stripped so the
        // lab's stdout stays its own.
        const line = buffer.slice(0, index).replace(/\[[0-9;]*m/g, "")
        buffer = buffer.slice(index + 1)
        if (line.trim()) onLine({ state: /^==> /.test(line) ? "info" : "prose", text: line })
      }
    }
    child.stdout.on("data", feed)
    child.stderr.on("data", feed)
    const abort = () => child.kill("SIGTERM")
    signal?.addEventListener("abort", abort, { once: true })
    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", abort)
      closeSync(log)
      resolvePromise(sig ? null : code)
    })
  })
  const buildMilliseconds = Date.now() - started
  await stopBuildGuests(stagingDir, onLine)
  if (status !== 0) throw new LabError(signal?.aborted ? "interrupted" : "build-failed", `the toolchain's install driver exited ${status === null ? "on a signal" : status} after ${durationWords(buildMilliseconds)}; its log is ${join(stagingDir, "build.log")}, and nothing was promoted`, { remedy: "read the log, then `omakit lab prune` to remove the staging directory and `omakit lab setup` to build again" })
  const built = join(stagingDir, "test-runs", pin.release.fileName.replace(/\.iso$/, ""))
  for (const name of ["base.qcow2", "OVMF_VARS.4m.fd", "id_ed25519", "id_ed25519.pub"]) {
    if (!existsSync(join(built, name))) throw new LabError("build-failed", `the driver exited 0 but ${join(built, name)} is not there`)
  }
  const baseId = `base-${stampNow()}`
  const staged = labDir(layout.cache, "staging", baseId)
  await moveIntoLab(layout.cache, join(built, "base.qcow2"), `staging/${baseId}/${BASE_FILES.disk}`)
  await moveIntoLab(layout.cache, join(built, "OVMF_VARS.4m.fd"), `staging/${baseId}/${BASE_FILES.vars}`)
  await moveIntoLab(layout.cache, join(built, "id_ed25519"), `staging/${baseId}/${BASE_FILES.key}`)
  await moveIntoLab(layout.cache, join(built, "id_ed25519.pub"), `staging/${baseId}/${BASE_FILES.publicKey}`)
  const runs = existsSync(join(built, "runs")) ? readdirSync(join(built, "runs")).sort() : []
  if (runs.length) await moveIntoLab(layout.cache, join(built, "runs", runs.at(-1)), `staging/${baseId}/build`)
  removeFromLab(layout.cache, `staging/${buildId}`)
  // The measured duration travels with the staged base, so a promotion
  // after an interrupted setup still records it.
  writeJson(layout.cache, `staging/${baseId}/build/lab-build.json`, { buildMilliseconds, harnessSha256: sha256, iso, release: { name: pin.release.name, sha256: pin.release.sha256 }, builtAt: new Date().toISOString() })
  return { staged, baseId, buildMilliseconds, harnessSha256: sha256, origin: `built ${new Date().toISOString()} by the pinned toolchain harness ${sha256.slice(0, 12)} from the verified ISO` }
}

/** Boot the staged base once, read the installed package, hash, seal, manifest, promote. */
async function verifyAndPromoteBase({ staged, baseId, pin, layout, buildMilliseconds, origin, harnessSha256, iso, onPhase, signal }) {
  onPhase("booting the staged base once to read the installed omarchy package")
  const booted = await withGuest({ baseDir: staged, stagingName: `${baseId}-verify`, logFile: join(staged, "verify-boot.log"), layout, pin, onPhase, signal }, async () => null)
  const version = booted.identity?.version
  if (!guestIsRelease(version, pin.release)) {
    throw new LabError("guest-mismatch", `the staged base runs omarchy ${version || "unknown"} (${booted.identity?.omarchyPackage || "no package read"}), not Omarchy ${pin.release.name}'s package; the base stays in staging and is not promoted`, { remedy: "`omakit lab prune` removes it; an ISO that installs another release's package is not used as that release" })
  }
  if (booted.identity.linked) throw new LabError("guest-mismatch", `the staged base is dev-linked to ${booted.identity.omarchyPath}; a base runs the installed package`)
  onPhase("hashing the base disk and the firmware template")
  const disk = join(staged, BASE_FILES.disk)
  const vars = join(staged, BASE_FILES.vars)
  const diskHash = sha256File(disk)
  const varsHash = sha256File(vars)
  const info = spawnSync("qemu-img", ["info", "--output=json", disk], { timeout: 60_000, encoding: "utf8" })
  const qemuInfo = info.status === 0 ? JSON.parse(info.stdout) : null
  chmodSync(disk, 0o444)
  chmodSync(vars, 0o444)
  const manifest = {
    schema: 1,
    state: "ready",
    release: { name: pin.release.name, sha256: pin.release.sha256, bytes: pin.release.bytes, isoUrl: pin.release.isoUrl, iso },
    signature: { fingerprint: pin.release.signingFingerprint },
    guest: { version, omarchyPackage: booted.identity.omarchyPackage, kernel: booted.identity.kernel, hostname: booted.identity.hostname, readBy: "pacman -Q omarchy over SSH in the verification boot" },
    disk: { file: BASE_FILES.disk, bytes: diskHash.bytes, sha256: diskHash.sha256, virtualBytes: qemuInfo?.["virtual-size"] ?? null, allocatedBytes: allocatedBytes(disk), format: qemuInfo?.format ?? null },
    vars: { file: BASE_FILES.vars, bytes: varsHash.bytes, sha256: varsHash.sha256 },
    key: { file: BASE_FILES.key },
    build: { milliseconds: buildMilliseconds, harnessSha256, toolchainCommit: pin.toolchain.commit, origin, verificationBoot: booted.session },
    createdAt: new Date().toISOString(),
    createdBy: { omakit: readJson(join(LAB_DIR, "../../package.json"))?.version || null, kernel: spawnSync("uname", ["-r"], { timeout: 60_000, encoding: "utf8" }).stdout?.trim() || null, qemu: spawnSync("qemu-system-x86_64", ["--version"], { timeout: 60_000, encoding: "utf8" }).stdout?.split("\n")[0] || null },
  }
  writeJson(layout.cache, `staging/${baseId}/${BASE_FILES.manifest}`, manifest)
  const fd = openSync(staged, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  onPhase("promoting the base")
  const superseded = existsSync(layout.base) ? `staging/superseded-${baseId}` : null
  if (superseded) await moveIntoLab(layout.cache, layout.base, superseded)
  await moveIntoLab(layout.cache, staged, "base")
  if (superseded) removeFromLab(layout.cache, superseded)
  return { manifest, dir: layout.base, supersededRemoved: Boolean(superseded) }
}

/** The listed plugins at their validated commits, shallow, into the lab's plugin cache; idempotent per commit. */
function fetchPlugins({ plugins, layout, onPhase }) {
  const fetched = []
  for (const plugin of plugins) {
    const dir = join(layout.plugins, plugin.id)
    const head = existsSync(join(dir, ".git")) ? spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 60_000, encoding: "utf8" }).stdout.trim() : null
    const clean = head === plugin.commit && spawnSync("git", ["-C", dir, "status", "--porcelain"], { timeout: 60_000, encoding: "utf8" }).stdout.trim() === ""
    if (clean) {
      fetched.push({ id: plugin.id, commit: plugin.commit, state: "present" })
      continue
    }
    onPhase(`fetching ${plugin.id} at ${plugin.commit.slice(0, 12)}`)
    removeFromLab(layout.cache, `plugins/${plugin.id}`)
    labDir(layout.cache, "plugins", plugin.id)
    const steps = [["init", "-q", dir], ["-C", dir, "remote", "add", "origin", plugin.repo], ["-C", dir, "fetch", "-q", "--depth", "1", "origin", plugin.commit], ["-C", dir, "checkout", "-q", "--detach", plugin.commit]]
    for (const args of steps) {
      const result = spawnSync("git", args, { timeout: 300_000, encoding: "utf8" })
      if (result.status !== 0) throw new LabError("plugin-fetch-failed", `could not fetch ${plugin.id} at ${plugin.commit} from ${plugin.repo}: ${(result.stderr || "").trim()}`)
    }
    fetched.push({ id: plugin.id, commit: plugin.commit, state: "fetched", bytes: allocatedBytes(dir) })
  }
  return fetched
}

/**
 * After a new base is promoted: the downloads of older releases the plan
 * named, each checked again against the release's own digest so the one
 * just verified is never among them. Nothing is removed before the
 * promotion, so a build that fails leaves the old release usable.
 */
export function removeSuperseded({ layout, pin, step, onLine = () => {} }) {
  const removed = []
  for (const entry of step.superseded || []) {
    if (entry.digest === pin.release.sha256 || !existsSync(join(layout.cache, entry.relative))) continue
    removeFromLab(layout.cache, entry.relative)
    removed.push(entry)
  }
  if (removed.length) onLine({ state: "pass", text: `removed ${removed.length === 1 ? "the older download" : `${removed.length} older downloads`} (${removed.map((entry) => entry.name || entry.digest.slice(0, 12)).join(", ")}), ${bytesBoth(removed.reduce((sum, entry) => sum + entry.bytes, 0))}` })
  return removed
}

/**
 * Execute a plan after consent. `consented` is the caller's statement
 * that the disclosure was shown and answered yes, or that --yes was
 * passed; without it, a plan with steps refuses.
 */
export async function setupLab({ plan, consented, onPhase = () => {}, onLine = () => {}, onProgress = () => {}, signal, fetchStream = getStream, repoRoot }) {
  const { pin, layout } = plan
  if (plan.blockers.length) throw new LabError("lab-not-ready", `\`omakit lab setup\` cannot start: ${plan.blockers.length} thing${plan.blockers.length === 1 ? " is" : "s are"} missing`, { missing: plan.blockers, remedy: plan.blockers[0].command })
  if (!plan.steps.length) return { done: [], nothingToDo: true }
  if (!consented) throw new LabError("not-confirmed", "not confirmed; nothing was fetched, nothing was built", { remedy: "omakit lab setup --yes" })
  packagedKey(pin)
  const done = []
  await acquireLock(layout, { runId: `setup-${stampNow()}`, pid: process.pid, qmpSocket: null, startedAt: new Date().toISOString() })
  const lockId = readJson(join(layout.lock, "holder.json"))?.runId
  try {
    // With the lock held, no other setup is building, so a build QEMU still
    // running under staging belongs to one that was killed before it could
    // stop it (SIGKILL, a crash): an orphan, stopped here before anything else.
    if (existsSync(layout.staging)) {
      for (const name of readdirSync(layout.staging).filter((entry) => /^build-\d{8}-\d{6}$/.test(entry)).sort()) await stopBuildGuests(join(layout.staging, name), onLine)
    }
    // A download directory only for a plan that fetches or imports: a
    // plugins-only plan over a kept base leaves none behind for a release
    // it never fetched.
    if (plan.steps.some((step) => ["download", "import", "sidecars"].includes(step.kind))) labDir(layout.cache, "downloads", pin.release.sha256)
    labDir(layout.cache, "staging")
    const target = pin.release ? join(downloadDir(layout, pin), pin.release.fileName) : null
    for (const step of plan.steps) {
      if (signal?.aborted) throw new LabError("interrupted", "interrupted; what was verified stays verified, what was not stays unverified")
      if (step.kind === "download") {
        onPhase(`downloading ${bytesBoth(step.bytes - step.resumeFrom)} from ${step.url}`)
        const got = await downloadRelease({ url: step.url, to: target, bytes: step.bytes, onProgress, signal, fetchStream })
        done.push({ kind: "download", bytes: got.bytes, milliseconds: got.milliseconds, to: got.part })
      } else if (step.kind === "import") {
        onPhase(`copying ${bytesBoth(step.bytes)} from ${step.from}`)
        const started = Date.now()
        removeFromLab(layout.cache, `downloads/${pin.release.sha256}/${pin.release.fileName}.part`)
        await copyIntoLab(layout.cache, step.from, `downloads/${pin.release.sha256}/${pin.release.fileName}.part`)
        for (const [side, name] of [[step.sidecars.checksum, `${pin.release.fileName}.sha256`], [step.sidecars.signature, `${pin.release.fileName}.sig`]]) {
          if (side && !existsSync(join(downloadDir(layout, pin), name))) await copyIntoLab(layout.cache, side, `downloads/${pin.release.sha256}/${name}`)
        }
        done.push({ kind: "import", bytes: step.bytes, milliseconds: Date.now() - started, from: step.from })
      } else if (step.kind === "sidecars") {
        const have = existsSync(`${target}.sig`) && existsSync(`${target}.sha256`)
        if (!have) {
          onPhase("fetching the checksum and signature sidecars")
          await fetchSidecars({ pin, dir: step.to, layout, fetchStream, signal })
          done.push({ kind: "sidecars", to: step.to })
        }
        // Verification runs here, once the sidecars are in place, for a
        // download, an import and a file already on disk alike.
        onPhase("verifying the ISO: byte count, SHA-256, sidecar, signature")
        const candidate = existsSync(`${target}.part`) ? `${target}.part` : target
        const verified = await verifyAndPromote({ candidate, to: target, pin, layout, stagingRoot: layout.staging, onProgress })
        done.push({ kind: "verify", file: verified.file, reason: verified.judged.reason })
        onLine({ state: "pass", text: `verified ${verified.file}: ${verified.judged.reason}` })
      } else if (step.kind === "build") {
        const built = await buildBase({ pin, layout, toolchainHarness: step.toolchain, iso: target, onPhase, onLine, signal, repoRoot })
        onLine({ state: "pass", text: `the toolchain built a base in ${durationWords(built.buildMilliseconds)}` })
        const promoted = await verifyAndPromoteBase({ ...built, pin, layout, iso: target, onPhase, signal })
        done.push({ kind: "build", milliseconds: built.buildMilliseconds, dir: promoted.dir, guest: promoted.manifest.guest, diskSha256: promoted.manifest.disk.sha256, allocatedBytes: promoted.manifest.disk.allocatedBytes, release: pin.release.name })
        onLine({ state: "pass", text: `promoted ${promoted.dir}: guest omarchy ${promoted.manifest.guest.version}, disk sha256 ${promoted.manifest.disk.sha256}` })
        done.push({ kind: "superseded", removed: removeSuperseded({ layout, pin, step, onLine }) })
      } else if (step.kind === "promote") {
        const baseId = step.staged.split("/").at(-1)
        const buildRecord = readJson(join(step.staged, "build", "lab-build.json"))
        const promoted = await verifyAndPromoteBase({ staged: step.staged, baseId, pin, layout, buildMilliseconds: buildRecord?.buildMilliseconds ?? null, origin: `built ${buildRecord?.builtAt || "earlier"} by the pinned toolchain harness ${(buildRecord?.harnessSha256 || pin.toolchain.patchedHarnessSha256).slice(0, 12)} from the verified ISO, promoted ${new Date().toISOString()} after a verification boot`, harnessSha256: buildRecord?.harnessSha256 || pin.toolchain.patchedHarnessSha256, iso: target, onPhase, signal })
        done.push({ kind: "build", milliseconds: buildRecord?.buildMilliseconds ?? 0, dir: promoted.dir, guest: promoted.manifest.guest, diskSha256: promoted.manifest.disk.sha256, allocatedBytes: promoted.manifest.disk.allocatedBytes, release: pin.release.name })
        onLine({ state: "pass", text: `promoted ${promoted.dir}: guest omarchy ${promoted.manifest.guest.version}, disk sha256 ${promoted.manifest.disk.sha256}` })
        done.push({ kind: "superseded", removed: removeSuperseded({ layout, pin, step, onLine }) })
      } else if (step.kind === "plugins") {
        const fetched = fetchPlugins({ plugins: step.plugins, layout, onPhase })
        done.push({ kind: "plugins", fetched })
      }
    }
  } finally {
    if (lockId) releaseLock(layout, lockId)
  }
  return { done, nothingToDo: false }
}
