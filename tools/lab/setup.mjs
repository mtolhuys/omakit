// `omakit lab setup`: the only path that may fetch bytes, and the only one
// that builds a base.
//
// One explicit consent, stating the exact size and the destination,
// before the first byte; `--yes` is that consent in the command itself
// for automation, and a pipe without it refuses. The plan is computed
// first and reads only; the disclosure prints it whole; then, in order:
//
//   1. The ISO, into $XDG_CACHE_HOME/omakit/lab/downloads/<sha256>/: a
//      literal GET of the pinned URL to a .part file, resumed by byte
//      range, or a copy of a local file named with --from. Never
//      "latest": the URL, the byte count, the digest and the signer are
//      the pin's.
//   2. Verification, of a downloaded file and of a file already there
//      alike: the byte count, the SHA-256 against the pin, the published
//      sidecar against the pin, the detached signature against the
//      packaged key at the pinned fingerprint. A mismatch fails closed:
//      the file is left as .part, nothing is recorded, nothing boots it.
//   3. The base, built by the pinned omarchy-iso toolchain's console
//      driver from the verified ISO, in a staging directory under the lab
//      (the driver derives its base directory from its own location, so
//      a copy of the one script into staging keeps it out of the
//      checkout: docs/history/2026-09-18-lab-inventory.md P6, P19), then
//      booted once by the lab's own driver to read the installed
//      omarchy package, hashed, made read-only, given its manifest, and
//      promoted with one rename.
//
// Never fetched: the toolchain. It is a git checkout at a pinned commit
// with the packaged patch applied, and the one command that makes it is
// printed; `--toolchain <dir>` records where it is, after hashing its
// harness against the pin.

import { spawn, spawnSync } from "node:child_process"
import { chmodSync, closeSync, createWriteStream, existsSync, fsyncSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { getStream, GitHubError } from "../marketplace/github.mjs"
import { LAB_DIR, bytesBoth, durationWords, labPin } from "./pin.mjs"
import { allocatedBytes, copyIntoLab, inLab, labDir, labLayout, moveIntoLab, readJson, removeFromLab, stampNow, writeJson } from "./paths.mjs"
import { BUILD_COMMANDS, VERIFY_COMMANDS, freeBytesAt, probeCommands, probeRunHost } from "./host.mjs"
import { judgeRelease, packagedKey, sha256File } from "./verify.mjs"
import { BASE_FILES, downloadDir, inspectBase, inspectDownload, inspectToolchain, toolchainCommand } from "./inspect.mjs"
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

/**
 * The plan, reading only: what setup would do on this host, with every
 * size and the destination. `steps` is what the consent covers.
 */
export function planSetup({ env = process.env, pin = labPin(), from = null, plugins = false, repoRoot } = {}) {
  const layout = labLayout(env)
  const download = inspectDownload(layout, pin)
  const base = inspectBase(layout, pin)
  const toolchain = inspectToolchain(layout, pin)
  const free = freeBytesAt(layout.cache)
  const steps = []
  const blockers = []
  for (const line of probeCommands(VERIFY_COMMANDS)) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
  if (!download.verified) {
    if (from) {
      const source = resolve(from)
      if (!existsSync(source)) blockers.push({ what: `the file named by --from`, cost: `${source} is not there`, command: "omakit lab setup --from <path to omarchy-4.0.3.iso>" })
      else steps.push({ kind: "import", from: source, bytes: statSync(source).size, to: join(download.dir, pin.release.fileName), sidecars: { checksum: existsSync(`${source}.sha256`) ? `${source}.sha256` : null, signature: existsSync(`${source}.sig`) ? `${source}.sig` : null } })
    } else if (download.present) {
      steps.push({ kind: "verify", file: download.iso, bytes: download.bytes })
    } else {
      steps.push({ kind: "download", url: pin.release.isoUrl, bytes: pin.release.bytes, resumeFrom: download.partial || 0, to: join(download.dir, pin.release.fileName) })
    }
    steps.push({ kind: "sidecars", bytes: 203, urls: [pin.release.checksumUrl, pin.release.signatureUrl], to: download.dir })
  }
  if (base.state !== "ready") {
    for (const line of probeRunHost({ pin })) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
    // A base the toolchain built but a verification boot never promoted
    // (an interrupted or failed setup) is verified and promoted, not
    // rebuilt: six minutes and six gigabytes are not spent twice.
    const staged = stagedBases(layout)
    if (staged.length) {
      steps.push({ kind: "promote", staged: staged.at(-1), to: layout.base, replacing: base.state === "missing" ? null : base })
    } else {
      for (const line of probeCommands(BUILD_COMMANDS)) if (line.state !== "ok") blockers.push({ what: line.name, cost: line.reason, command: line.remedy })
      if (toolchain.state !== "ready") blockers.push({ what: "the toolchain", cost: toolchain.reason, command: toolchain.state === "unpatched" ? `git -C ${toolchain.dir} apply ${join(LAB_DIR, pin.toolchain.patch)} && omakit lab setup --toolchain ${toolchain.dir}` : toolchainCommand(pin) })
      steps.push({ kind: "build", toolchain: toolchain.harness, to: layout.base, replacing: base.state === "missing" ? null : base, bytes: pin.measured.baseDirectoryBytes, milliseconds: pin.measured.buildMilliseconds })
    }
  }
  if (plugins) {
    const pinDir = marketplacePinDir(repoRoot)
    const wanted = []
    for (const id of WEIGH_LISTED) {
      const listing = listedPlugin(pinDir, id)
      if (!listing.ok) blockers.push({ what: `${id} in the pinned catalog`, cost: listing.reason, command: "omakit pin" })
      else wanted.push({ id, repo: listing.repo, commit: listing.commit, to: join(layout.plugins, id) })
    }
    if (wanted.length) steps.push({ kind: "plugins", plugins: wanted, to: layout.plugins, bytes: pin.measured.pluginsBytes || null })
  }
  const needed = steps.reduce((sum, step) => sum + (step.kind === "download" ? step.bytes - (step.resumeFrom || 0) : step.kind === "import" ? step.bytes : step.kind === "build" ? step.bytes : 0), 0)
  if (steps.length && free.bytes < needed) blockers.push({ what: "disk", cost: `${bytesBoth(free.bytes)} free at ${free.path}; this setup needs ${bytesBoth(needed)}`, command: "omakit lab prune" })
  return { layout, pin, download, base, toolchain, free, steps, blockers, needed, afterBytes: pin.measured.preparedLabBytes }
}

/** Staged bases awaiting verification: `staging/base-*` with the four files and no manifest, oldest first. */
export function stagedBases(layout) {
  if (!existsSync(layout.staging)) return []
  return readdirSync(layout.staging).filter((name) => /^base-\d{8}-\d{6}$/.test(name)).sort()
    .map((name) => join(layout.staging, name))
    .filter((dir) => [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key, BASE_FILES.publicKey].every((file) => existsSync(join(dir, file))) && !existsSync(join(dir, BASE_FILES.manifest)))
}

/** The lines of the disclosure, exactly as the contract in docs/LAB.md shows them; the consent question follows them. */
export function disclosureLines(plan) {
  const { pin } = plan
  const lines = []
  const download = plan.steps.find((step) => step.kind === "download")
  const imported = plan.steps.find((step) => step.kind === "import")
  const build = plan.steps.find((step) => step.kind === "build")
  const plugins = plan.steps.find((step) => step.kind === "plugins")
  lines.push(["Omarchy", `release ${pin.release.name}; installed guest expected ${pin.release.expectedGuestVersion}`])
  if (download) lines.push(["download", `${bytesBoth(download.bytes - download.resumeFrom)}${download.resumeFrom ? ` (resuming at ${download.resumeFrom.toLocaleString("en-US")} of ${download.bytes.toLocaleString("en-US")} B)` : ""}`], ["from", download.url])
  else if (imported) lines.push(["download", "0 B: the file named by --from is copied and verified"], ["from", imported.from])
  else lines.push(["download", "0 B: the ISO on disk is verified"])
  lines.push(["verify", `pinned SHA-256 ${pin.release.sha256} and the Omarchy signature ${pin.release.signingFingerprint}`])
  lines.push(["store", plan.layout.cache])
  const promote = plan.steps.find((step) => step.kind === "promote")
  if (build) {
    lines.push(["build", `${durationWords(build.milliseconds)} on the reference host (M14); download excluded`])
    if (build.replacing) lines.push(["replacing", `the ${build.replacing.state} base there (${bytesBoth(build.replacing.allocatedBytes)}), removed after the new one verifies`])
  }
  if (promote) {
    lines.push(["build", `none: the base the toolchain built at ${promote.staged} is booted once, verified and promoted`])
    if (promote.replacing) lines.push(["replacing", `the ${promote.replacing.state} base there (${bytesBoth(promote.replacing.allocatedBytes)}), removed after the staged one verifies`])
  }
  if (plugins) lines.push(["plugins", `${plugins.plugins.length} listed plugins at their validated commits, shallow, into ${plugins.to}`])
  lines.push(["afterwards", "verified ISO, one immutable base, and manifests"])
  lines.push(["on disk", `${bytesBoth(plan.afterBytes)} (M14), before evidence; ${bytesBoth(plan.free.bytes)} free now`])
  return lines
}

/** The one question. */
export const CONSENT_QUESTION = "Acquire and build this verified base now?"

/**
 * A resumable literal GET of the pinned object to `<to>.part`. The byte
 * count is checked against the pin as it arrives and at the end; a
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
    if (error instanceof GitHubError) throw new LabError(error.code, error.message, { remedy: "check the network, then run `omakit lab setup` again; the download resumes" })
    throw error
  }
  const append = response.status === 206 && have > 0
  const expected = append ? bytes - have : bytes
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > 0 && length !== expected) {
    throw new LabError("size-mismatch", `${url} announces ${length.toLocaleString("en-US")} B where the pin expects ${expected.toLocaleString("en-US")}; the object at the versioned URL is not the pinned release`)
  }
  const out = createWriteStream(part, { flags: append ? "a" : "w", mode: 0o600 })
  let written = append ? have : 0
  const started = Date.now()
  try {
    for await (const chunk of response.body) {
      if (signal?.aborted) throw new LabError("interrupted", "interrupted; the partial download stays and resumes next time")
      written += chunk.length
      if (written > bytes) throw new LabError("size-mismatch", `${url} sent more than the pinned ${bytes.toLocaleString("en-US")} B`)
      if (!out.write(chunk)) await new Promise((resolvePromise) => out.once("drain", resolvePromise))
      onProgress(written, bytes, Date.now() - started)
    }
  } finally {
    await new Promise((resolvePromise) => out.end(resolvePromise))
  }
  if (written !== bytes) throw new LabError("size-mismatch", `${url} ended at ${written.toLocaleString("en-US")} of the pinned ${bytes.toLocaleString("en-US")} B; run setup again to resume`)
  return { part, bytes: written, milliseconds: Date.now() - started }
}

/** The two sidecars, small, to the download directory; the signature is required, the checksum compared. */
async function fetchSidecars({ pin, dir, layout, fetchStream = getStream, signal }) {
  for (const [url, name] of [[pin.release.checksumUrl, `${pin.release.fileName}.sha256`], [pin.release.signatureUrl, `${pin.release.fileName}.sig`]]) {
    const response = await fetchStream(url, { signal })
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > 4096) throw new LabError("sidecar-mismatch", `${url} answered ${body.length} B; a sidecar is a few dozen`)
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
    throw new LabError("iso-mismatch", `the file at ${candidate} is not the pinned release: ${judged.reason}; it stays where it is and nothing will boot it`, { remedy: "remove it with `omakit lab prune`, then `omakit lab setup` again" })
  }
  if (judged.sidecarMatch === false) throw new LabError("sidecar-mismatch", `the published checksum sidecar names ${judged.sidecarSha256}, the pin ${pin.release.sha256}: the object at the versioned URL was replaced, and this file, which matches the pin, is not what the site publishes now`, { remedy: "a pin update is a reviewed change; docs/LAB.md says how" })
  if (candidate !== to) await moveIntoLab(layout.cache, candidate, `downloads/${pin.release.sha256}/${pin.release.fileName}`)
  chmodSync(to, 0o444)
  const st = statSync(to)
  writeJson(layout.cache, `downloads/${pin.release.sha256}/verified.json`, { schema: 1, sha256: judged.sha256, bytes: st.size, mtimeMs: st.mtimeMs, fingerprint: judged.signature.fingerprint, signer: judged.signature.detail, sidecarSha256: judged.sidecarSha256, verifiedAt: new Date().toISOString() })
  return { file: to, judged, dir }
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
  writeJson(layout.cache, `staging/${baseId}/build/lab-build.json`, { buildMilliseconds, harnessSha256: sha256, iso, builtAt: new Date().toISOString() })
  return { staged, baseId, buildMilliseconds, harnessSha256: sha256, origin: `built ${new Date().toISOString()} by the pinned toolchain harness ${sha256.slice(0, 12)} from the verified ISO` }
}

/** Boot the staged base once, read the installed package, hash, seal, manifest, promote. */
async function verifyAndPromoteBase({ staged, baseId, pin, layout, buildMilliseconds, origin, harnessSha256, iso, onPhase, signal }) {
  onPhase("booting the staged base once to read the installed omarchy package")
  const booted = await withGuest({ baseDir: staged, stagingName: `${baseId}-verify`, logFile: join(staged, "verify-boot.log"), layout, pin, onPhase, signal }, async () => null)
  const version = booted.identity?.version
  if (version !== pin.release.expectedGuestVersion) {
    throw new LabError("guest-mismatch", `the staged base runs omarchy ${version || "unknown"} (${booted.identity?.omarchyPackage || "no package read"}); the pin expects ${pin.release.expectedGuestVersion}; the base stays in staging and is not promoted`, { remedy: "`omakit lab prune` removes it; a pin update is a reviewed change, docs/LAB.md says how" })
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
    release: { name: pin.release.name, sha256: pin.release.sha256, bytes: pin.release.bytes, isoUrl: pin.release.isoUrl, embeddedBuild: pin.release.embeddedBuild, volume: pin.release.volume, iso },
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
    labDir(layout.cache, "downloads", pin.release.sha256)
    labDir(layout.cache, "staging")
    const target = join(downloadDir(layout, pin), pin.release.fileName)
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
        done.push({ kind: "build", milliseconds: built.buildMilliseconds, dir: promoted.dir, guest: promoted.manifest.guest, diskSha256: promoted.manifest.disk.sha256, allocatedBytes: promoted.manifest.disk.allocatedBytes })
        onLine({ state: "pass", text: `promoted ${promoted.dir}: guest omarchy ${promoted.manifest.guest.version}, disk sha256 ${promoted.manifest.disk.sha256}` })
      } else if (step.kind === "promote") {
        const baseId = step.staged.split("/").at(-1)
        const buildRecord = readJson(join(step.staged, "build", "lab-build.json"))
        const promoted = await verifyAndPromoteBase({ staged: step.staged, baseId, pin, layout, buildMilliseconds: buildRecord?.buildMilliseconds ?? null, origin: `built ${buildRecord?.builtAt || "earlier"} by the pinned toolchain harness ${(buildRecord?.harnessSha256 || pin.toolchain.patchedHarnessSha256).slice(0, 12)} from the verified ISO, promoted ${new Date().toISOString()} after a verification boot`, harnessSha256: buildRecord?.harnessSha256 || pin.toolchain.patchedHarnessSha256, iso: target, onPhase, signal })
        done.push({ kind: "build", milliseconds: buildRecord?.buildMilliseconds ?? 0, dir: promoted.dir, guest: promoted.manifest.guest, diskSha256: promoted.manifest.disk.sha256, allocatedBytes: promoted.manifest.disk.allocatedBytes })
        onLine({ state: "pass", text: `promoted ${promoted.dir}: guest omarchy ${promoted.manifest.guest.version}, disk sha256 ${promoted.manifest.disk.sha256}` })
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
