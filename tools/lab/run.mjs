// `omakit lab prove <suite>`: one suite in a disposable guest, its document
// written with the identity of the guest it ran on.
//
// The lifecycle, in order, and what each step guarantees:
//
//   1. Preflight, reading only: the base is ready and is the pin's, the
//      host can run a guest, the suite's files are there, the disk has
//      room for one overlay. A missing thing is named with its cost and
//      the one command; nothing is fetched, nothing is created.
//   2. The lock: one directory, made atomically, holding the run id, this
//      pid and the QMP socket. A lock whose QEMU still answers on its
//      socket is held, whatever PID namespace it is in; one whose QEMU is
//      gone and whose holder is gone is stale and is taken over.
//   3. Staging, private to the run: a qcow2 overlay backed by the base
//      (the base opened read-only through the backing chain, and made
//      0444 at promotion), a copy of the base's firmware variables (the
//      template is never opened writable: docs/history/2026-09-18-lab-
//      inventory.md P15), the QMP socket, the serial log.
//   4. QEMU as a child of this process: no daemon, no host directory, no
//      host socket, SSH forwarded on 127.0.0.1 and nothing else.
//   5. The session the way a person gets one: SSH answers, the password
//      is typed at the greeter until a Hyprland owned by the guest user
//      exists, the startup notifications are dismissed.
//   6. The identity, read from inside before anything else: the installed
//      omarchy package, the kernel, whether the session runs from the
//      package or a linked checkout. Skew is printed, never collapsed (P8).
//   7. The suite, through tools/lab/harness.sh, its output streamed to the
//      run's host.log; its document read back and held to the suite's
//      assertion; provenance added to the document (P18).
//   8. The guest powered off, QEMU ended (QMP, then the signal), the
//      overlay measured and removed, the base and the template checked
//      unchanged, the lock released, on the normal path, on failure, and
//      on SIGINT and SIGTERM.
//
// Nothing here touches the host's own session: no hyprctl, no
// omarchy-shell, no shell.json on the host, and tests/unit/lab.test.mjs
// proves it over this file, the harness and the suites.

import { spawn, spawnSync } from "node:child_process"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { bytesBoth, labPin } from "./pin.mjs"
import { allocatedBytes, inLab, labDir, labLayout, readJson, removeFromLab, stampNow, writeJson } from "./paths.mjs"
import { freeBytesAt, guestCpus, probeRunHost } from "./host.mjs"
import { BASE_FILES, inspectBase, inspectLock } from "./inspect.mjs"
import { press, qemuArgs, qmpExecute, startQemu, typeText } from "./qemu.mjs"
import { clearStartupNotifications, establishSession, guestIdentity, SESSION_PREAMBLE, sleep, sshGuest, waitForSsh } from "./guest.mjs"
import { SUITES, suitePreflight } from "./suites.mjs"

export class LabError extends Error {
  constructor(code, message, { remedy = null, missing = [] } = {}) {
    super(message)
    this.name = "LabError"
    this.code = code
    // An interrupt's one action is the lab's, not weigh's (whose
    // `interrupted` remedy in cli.mjs speaks of shell.json).
    this.remedy = remedy || (code === "interrupted" ? "the guest was ended and its overlay removed; run it again when you are ready" : null)
    this.missing = missing
  }
}

/** The first free port on the loopback interface from 2222 up; the toolchain's fixed port is where two runs collided (P7). */
export async function freePort(start = 2222, { attempts = 50 } = {}) {
  for (let port = start; port < start + attempts; port += 1) {
    const free = await new Promise((resolve) => {
      const server = createServer()
      server.once("error", () => resolve(false))
      server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new LabError("no-port", `no free port between ${start} and ${start + attempts - 1} on 127.0.0.1`)
}

/**
 * Take the lab lock or refuse. `holder.json` inside it names the run; a
 * QEMU answering on the recorded socket, or a live holder pid, means
 * held. A stale lock is reported and taken.
 */
export async function acquireLock(layout, record) {
  let stale = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(inLab(layout.cache, "lab.lock"), { recursive: false, mode: 0o700 })
      writeJson(layout.cache, "lab.lock/holder.json", record)
      return { taken: true, stale }
    } catch (error) {
      if (error.code === "ENOENT") {
        labDir(layout.cache)
        continue
      }
      if (error.code !== "EEXIST") throw error
      const held = await inspectLock(layout)
      if (held.alive) {
        throw new LabError("lab-busy", `the lab is in use by run ${held.record?.runId || "unknown"} (pid ${held.record?.pid || "?"}${held.qemuAnswers ? ", its QEMU answers on QMP" : ""}); one run at a time`, { remedy: "wait for it, or `omakit lab inspect` to see it" })
      }
      stale = held.record
      removeFromLab(layout.cache, "lab.lock")
    }
  }
  throw new LabError("lab-busy", "the lock could not be taken")
}

export function releaseLock(layout, runId) {
  const holder = readJson(join(layout.lock, "holder.json"))
  if (holder && holder.runId !== runId) return false
  removeFromLab(layout.cache, "lab.lock")
  return true
}

function identityOf(file) {
  const st = statSync(file)
  return { bytes: st.size, mtimeMs: st.mtimeMs, ino: st.ino }
}

function sameIdentity(a, b) {
  return a.bytes === b.bytes && a.mtimeMs === b.mtimeMs && a.ino === b.ino
}

/**
 * Boot a guest from a base directory, log in, read its identity, hand it
 * to `body`, and end it on every path. The staging directory is the
 * caller's (under the lab cache) and is removed here; the overlay's
 * allocated bytes are measured before removal, which is the per-run disk
 * cost M14 records.
 *
 * @param {{ baseDir: string, stagingName: string, logFile: string, layout: object, pin: object, onPhase?: Function, signal?: AbortSignal }} options
 * @param {(context: { guest: object, paths: object, identity: object, session: object }) => Promise<any>} body
 */
export async function withGuest({ baseDir, stagingName, logFile, layout, pin, onPhase = () => {}, signal }, body) {
  const staging = labDir(layout.cache, "staging", stagingName)
  const paths = { overlay: join(staging, "run.qcow2"), vars: join(staging, "vars.fd"), qmp: join(staging, "qmp.sock"), serial: join(staging, "serial.log"), pid: join(staging, "qemu.pid") }
  const baseDisk = join(baseDir, BASE_FILES.disk)
  const baseVars = join(baseDir, BASE_FILES.vars)
  const before = { disk: identityOf(baseDisk), vars: identityOf(baseVars) }
  const guest = { key: join(baseDir, BASE_FILES.key), port: null, user: pin.guest.user }
  const out = { identity: null, session: null, overlayBytes: null, baseUnchanged: null, result: undefined, sshPort: null, cpus: guestCpus() }
  let qemu = null
  let stopped = false
  const stopGuest = async () => {
    if (stopped) return
    stopped = true
    if (!qemu || qemu.exitCode !== null) return
    onPhase("powering the guest off")
    let off = { status: 1 }
    if (guest.port) off = sshGuest(guest, "sudo -S systemctl poweroff", { input: `${pin.guest.password}\n`, timeoutMs: 15000 })
    if (off.status !== 0) await qmpExecute(paths.qmp, "system_powerdown").catch(() => {})
    for (let waited = 0; waited < 20 && qemu.exitCode === null; waited += 1) await sleep(1000)
    if (qemu.exitCode === null) {
      await qmpExecute(paths.qmp, "quit").catch(() => {})
      await sleep(1000)
    }
    if (qemu.exitCode === null) {
      qemu.kill("SIGTERM")
      await sleep(1000)
    }
    if (qemu.exitCode === null) qemu.kill("SIGKILL")
  }
  const end = async () => {
    await stopGuest()
    if (existsSync(paths.overlay)) out.overlayBytes = allocatedBytes(paths.overlay)
    removeFromLab(layout.cache, `staging/${stagingName}`)
    const after = { disk: identityOf(baseDisk), vars: identityOf(baseVars) }
    out.baseUnchanged = sameIdentity(before.disk, after.disk) && sameIdentity(before.vars, after.vars)
  }
  try {
    onPhase("creating the overlay and the run's firmware variables")
    const created = spawnSync("qemu-img", ["create", "-f", "qcow2", "-b", baseDisk, "-F", "qcow2", paths.overlay], { encoding: "utf8" })
    if (created.status !== 0) throw new LabError("overlay-failed", `qemu-img could not create the overlay: ${(created.stderr || "").trim()}`)
    chmodSync(paths.overlay, 0o600)
    // The base's variables hold the boot entries the install wrote, so a
    // guest boots from them; the run gets its own copy and the template
    // stays as it was (P15).
    writeFileSync(inLab(layout.cache, `staging/${stagingName}/vars.fd`), readFileSync(baseVars), { mode: 0o600 })
    guest.port = await freePort()
    out.sshPort = guest.port
    const args = qemuArgs({ overlay: paths.overlay, vars: paths.vars, memoryMiB: pin.guest.memoryMiB, cpus: out.cpus, sshPort: guest.port, qmpSocket: paths.qmp, serialLog: paths.serial, pidFile: paths.pid })
    const logFd = openSync(logFile, "a", 0o600)
    onPhase(`booting the guest (${pin.guest.memoryMiB} MiB, ${out.cpus} vCPUs, SSH on 127.0.0.1:${guest.port})`)
    qemu = startQemu(args, { log: logFd })
    closeSync(logFd)
    await new Promise((resolvePromise, reject) => {
      qemu.once("spawn", resolvePromise)
      qemu.once("error", (error) => reject(new LabError("qemu-failed", `QEMU did not start: ${error.message}`)))
    })
    // Alive means our child has not exited: it is ours, so its exit code is
    // the whole answer. Measured on the first verification boot: a QMP
    // probe in the first second, before QEMU had created its socket, read
    // as "the guest exited" and the base was never promoted.
    const alive = async () => qemu.exitCode === null
    if (signal?.aborted) throw new LabError("interrupted", "interrupted before the guest booted")
    const sshSeconds = await waitForSsh(guest, { timeoutSeconds: 600, alive, onPhase })
    // Five seconds for the greeter to draw after sshd answers, as the toolchain waited; a keystroke typed before it is lost.
    await sleep(5000)
    if (signal?.aborted) throw new LabError("interrupted", "interrupted while the guest booted")
    const session = await establishSession({ guest, socket: paths.qmp, password: pin.guest.password, typeText, press, onPhase })
    const notifications = await clearStartupNotifications(guest, { onPhase })
    out.session = { sshSeconds, loginRounds: session.rounds, loginSeconds: session.seconds, notificationsCleared: notifications.cleared, notificationsReason: notifications.reason }
    onPhase("reading the guest's identity")
    out.identity = guestIdentity(guest)
    if (signal?.aborted) throw new LabError("interrupted", "interrupted before the suite started")
    out.result = await body({ guest, paths, identity: out.identity, session: out.session })
  } finally {
    await end()
  }
  return out
}

/**
 * Everything a run needs before a guest boots, or a LabError naming what
 * is missing. Reads only.
 */
export function preflightRun({ suiteName, env = process.env, pin = labPin(), repoRoot, options = {} }) {
  const suite = SUITES[suiteName]
  if (!suite) throw new LabError("usage", `no suite named ${JSON.stringify(suiteName)}; the suites are ${Object.keys(SUITES).join(", ")}`, { remedy: `omakit lab prove <${Object.keys(SUITES).join("|")}>` })
  const layout = labLayout(env)
  const missing = []
  const base = inspectBase(layout, pin)
  if (base.state !== "ready") missing.push({ what: `a ready base (${base.state})`, cost: base.reason, command: "omakit lab setup" })
  for (const line of probeRunHost({ pin })) if (line.state !== "ok") missing.push({ what: line.name, cost: line.reason, command: line.remedy })
  missing.push(...suitePreflight(suite, { repoRoot, layout }))
  const free = freeBytesAt(layout.cache)
  if (free.bytes < pin.measured.overlayAfterRunBytes) missing.push({ what: "disk for one overlay", cost: `${bytesBoth(free.bytes)} free at ${free.path}; one run's overlay measured ${bytesBoth(pin.measured.overlayAfterRunBytes)} (M14)`, command: "omakit lab prune" })
  if (missing.length) throw new LabError("lab-not-ready", `\`omakit lab prove ${suiteName}\` cannot start: ${missing.length} thing${missing.length === 1 ? " is" : "s are"} missing`, { missing, remedy: missing[0].command })
  return { suite, layout, base, free }
}

/**
 * Run one suite. `onPhase` gets the progress line, `onLine` every line
 * the harness prints, `signal` aborts (SIGINT and SIGTERM in cli.mjs).
 * Returns the run record; the suite's document is in the run directory,
 * with its provenance.
 */
export async function runSuite({ suiteName, env = process.env, pin = labPin(), repoRoot, options = {}, onPhase = () => {}, onLine = () => {}, signal }) {
  const { suite, layout, base } = preflightRun({ suiteName, env, pin, repoRoot, options })
  const runId = `${stampNow()}-${suite.name}`
  const runDir = labDir(layout.state, "runs", runId)
  const startedAt = new Date()
  const record = {
    schema: 1,
    runId,
    suite: suite.name,
    startedAt: startedAt.toISOString(),
    pin: { release: pin.release.name, isoSha256: pin.release.sha256, expectedGuestVersion: pin.release.expectedGuestVersion },
    base: { dir: base.dir, createdAt: base.manifest.createdAt, allocatedBytes: base.allocatedBytes, diskSha256: base.manifest.disk.sha256, varsSha256: base.manifest.vars.sha256, origin: base.manifest.build?.origin || null },
    guest: null,
    skew: null,
    testedSource: null,
    host: { kernel: spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() || null, qemu: spawnSync("qemu-system-x86_64", ["--version"], { encoding: "utf8" }).stdout?.split("\n")[0] || null, cpus: guestCpus(), memoryMiB: pin.guest.memoryMiB, sshPort: null },
    session: null,
    suiteStatus: null,
    document: null,
    assertion: null,
    overlayBytes: null,
    baseUnchanged: null,
    durationMs: null,
    ok: false,
    runDir,
  }
  const save = () => writeJson(layout.state, `runs/${runId}/run.json`, record)
  await acquireLock(layout, { runId, pid: process.pid, qmpSocket: join(layout.staging, `run-${runId}`, "qmp.sock"), startedAt: record.startedAt })
  save()
  let booted
  try {
    booted = await withGuest({ baseDir: base.dir, stagingName: `run-${runId}`, logFile: join(runDir, "qemu.log"), layout, pin, onPhase, signal }, async ({ guest, paths, identity }) => {
      record.guest = identity
      record.host.sshPort = guest.port
      record.skew = identity.linked || identity.version !== pin.release.expectedGuestVersion
      record.testedSource = identity.testedSource
      save()
      onLine({ state: "info", text: `guest omarchy ${identity.version || "unknown"} on ${identity.kernel || "?"}; tested source ${identity.testedSource}; skew ${record.skew}`, record })
      onPhase(`running ${suite.title}`)
      const status = await runHarness({ suite, runId, runDir, layout, guest, paths, repoRoot, pin, suiteArgs: suite.args(options, layout), timeoutSeconds: suite.timeoutSeconds, onLine, signal })
      record.suiteStatus = status
      // An interrupt during the suite is an interrupt, exit 130, the same as
      // one before it: the guest is ended and the staging removed on the way out.
      if (status === "interrupted") throw new LabError("interrupted", "interrupted during the suite")
      const documentPath = join(runDir, suite.document)
      const document = readJson(documentPath)
      record.document = existsSync(documentPath) ? documentPath : null
      record.assertion = document ? suite.assert(document) : { ok: false, reason: `the suite wrote no ${suite.document}` }
      record.ok = status === 0 && record.assertion.ok
      if (document) {
        // Provenance into the document itself, in the shape the evidence
        // files already carried by hand (`where`), plus the identity a
        // reader can check: run id, guest version, pin, skew.
        document.where = `the ${record.skew ? "linked" : "stock"} Omarchy ${identity.version || "?"} guest of omakit lab, run ${runId}`
        document.lab = { runId, suite: suite.name, guest: identity, skew: record.skew, testedSource: identity.testedSource, pin: record.pin, base: { createdAt: record.base.createdAt, diskSha256: record.base.diskSha256, origin: record.base.origin }, host: record.host, startedAt: record.startedAt }
        writeJson(layout.state, `runs/${runId}/${suite.document}`, document)
      }
    })
  } catch (error) {
    record.error = error?.message || String(error)
    record.errorCode = error?.code || null
    if (signal?.aborted) record.suiteStatus = "interrupted"
    throw error
  } finally {
    if (booted) {
      record.session = booted.session
      record.host.sshPort = booted.sshPort
      record.overlayBytes = booted.overlayBytes
      record.baseUnchanged = booted.baseUnchanged
    }
    releaseLock(layout, runId)
    record.durationMs = Date.now() - startedAt.getTime()
    save()
  }
  return record
}

/** The harness as a child, its lines streamed, its exit status the suite's. `null` for a signal, `"interrupted"` for an abort. */
function runHarness({ suite, runId, runDir, layout, guest, paths, repoRoot, pin, suiteArgs, timeoutSeconds, onLine, signal }) {
  return new Promise((resolvePromise) => {
    const hostLog = openSync(inLab(layout.state, `runs/${runId}/host.log`), "a", 0o600)
    const child = spawn("bash", [join(resolve(repoRoot), "tools/lab/harness.sh"), suite.host, runDir, guest.key, String(guest.port), paths.qmp, resolve(repoRoot), SESSION_PREAMBLE, pin.guest.user, pin.guest.password, ...suiteArgs], { stdio: ["ignore", "pipe", "pipe"] })
    let buffer = ""
    const feed = (chunk, stream) => {
      writeFileSync(hostLog, chunk)
      buffer += chunk.toString("utf8")
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        onLine({ state: /^not ok/.test(line) ? "fail" : /^ok - /.test(line) ? "pass" : /^==> /.test(line) ? "info" : "prose", text: line, stream })
      }
    }
    child.stdout.on("data", (chunk) => feed(chunk, "stdout"))
    child.stderr.on("data", (chunk) => feed(chunk, "stderr"))
    const timer = setTimeout(() => {
      onLine({ state: "fail", text: `the suite ran past ${timeoutSeconds} s and was stopped` })
      child.kill("SIGKILL")
    }, timeoutSeconds * 1000)
    const abort = () => child.kill("SIGTERM")
    signal?.addEventListener("abort", abort, { once: true })
    child.on("close", (code, sig) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (buffer) feed("\n", "stdout")
      closeSync(hostLog)
      resolvePromise(signal?.aborted ? "interrupted" : sig ? null : code)
    })
  })
}
