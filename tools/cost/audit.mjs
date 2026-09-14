// The startup A/B measurement, in two halves.
//
// `planCost()` reads and decides: the shell that runs, whether the session is
// locked, what is installed and enabled, which plugins will be measured, how
// many restarts that is and how long it will take. It writes nothing, so the
// confirmation is made from it and a refusal costs nothing.
//
// `measureCost()` is the half that changes the user's machine, and the only
// one in omakit that does. For every run: write a configuration, restart the
// shell, wait until every installed plugin is reported, settle, sample; then
// the next configuration. The backup is taken before the first write and
// restored in a `finally` that every exit path passes through: a completed
// run, a restart that did not answer, a thrown error, and an interrupt, which
// arrives here as an aborted signal rather than a dead process.
//
// The method is a port of the audit described in docs/COST.md, and that
// document is the contract for what comes out; the bash it was ported from
// is the reference for the behaviour. What differs from it, Pss beside VmRSS
// and a memory trace through the window, and what was tried and measured
// worse (the memory sample at the settle), are named there with the figures.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join, resolve } from "node:path"
import { run } from "./commands.mjs"
import { backupConfig, configPaths, restoreConfig, verifyRestore, without, writeConfig } from "./config.mjs"
import { childTicks, cpuTicks, descendants, PROC, pssKb, rssKb } from "./proc.mjs"
import { median, stats, verdict } from "./stats.mjs"
import { omakitStateDir } from "../marketplace/paths.mjs"

/**
 * The settle is 30 s because the shell is not settled at 8. Measured in the
 * plugin lab on 14 September 2026 with a Pss trace twice a second over 40
 * restarts: after listPlugins answers (0.3 s after the restart) the shell
 * holds a load-time high of 550 to 615 MB Pss and then releases 55 to 65 MB
 * at a moment that varied from 10 to 26 s after ready, settling at 516 to
 * 551 MB. A window that opens at 8 s reads either side of that release,
 * and the baseline spread was 70.3 MB at the settle and 34.6 MB at the end
 * of the window. Thirty seconds puts the whole window after the release.
 */
export const DEFAULTS = Object.freeze({
  runs: 3,
  windowSeconds: 15,
  settleSeconds: 30,
  readyTimeoutSeconds: 45,
  sampleIntervalMs: 500,
})

/**
 * Seconds one restart took in the plugin lab guest, measured over 24
 * restarts on 14 September 2026 (about 25 s each, in a VM with software
 * rendering). The estimate before this machine has a timing of its own.
 */
export const LAB_RESTART_SECONDS = 25

export const METHOD = "startup A/B: the shell is restarted with the enabled set minus every measured plugin (baseline) and with that set plus one plugin; after listPlugins reports every installed plugin and a settle, a window opens in which utime+stime is read from /proc/<pid>/stat at both ends, Pss from /proc/<pid>/smaps_rollup and VmRSS from /proc/<pid>/status are traced twice a second and taken at the end of the window (the same two also recorded at the settle, where they were measured to be 8 times noisier), descendants are sampled twice a second and the CPU of reaped children comes from cutime+cstime of the shell pid; each plugin row is the median over runs of (plus minus baseline, run by run) with the spread (max minus min); a delta whose absolute median is not above the baseline spread is within noise"

export class CostError extends Error {
  constructor(code, message, remedy = null) {
    super(message)
    this.name = "CostError"
    this.code = code
    this.remedy = remedy
  }
}

function utc(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** A file name stamp: `2026-09-14T190225Z`, readable and safe on any filesystem. */
function fileStamp(date = new Date()) {
  return utc(date).replace(/:/g, "")
}

/** Is a command reachable through PATH; a probe by name, not by running it. */
function onPath(command, env) {
  return (env.PATH || "").split(":").some((dir) => dir && existsSync(join(dir, command)))
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new CostError("shell-unreadable", `${what} did not answer with JSON`, "omarchy-restart-shell, then run it again.")
  }
}

/** OMARCHY_PATH as the running session has it, the way omarchy-restart-shell reads it; the process environment is the fallback. */
function sessionOmarchyPath(env) {
  const session = run("sessionEnvironment", { env })
  const line = session.ok ? session.stdout.split("\n").filter((entry) => entry.startsWith("OMARCHY_PATH=")).at(-1) : null
  return (line ? line.slice("OMARCHY_PATH=".length) : env.OMARCHY_PATH) || null
}

/** The per-restart timing stored by the previous run on this machine, or the lab's figure. */
export function restartTiming(stateDir) {
  const timingFile = join(stateDir, "timing.json")
  try {
    const stored = JSON.parse(readFileSync(timingFile, "utf8"))
    if (Number.isFinite(stored.restartSeconds) && stored.restartSeconds > 0) {
      return { seconds: stored.restartSeconds, source: `stored from ${stored.restarts} restart(s) on this machine at ${stored.measuredAt}`, file: timingFile }
    }
  } catch {
    // No timing yet: the first run on this machine.
  }
  return { seconds: LAB_RESTART_SECONDS, source: "the plugin lab's figure, before any run on this machine", file: timingFile }
}

/**
 * Everything that has to be known before a shell is restarted. Reads only.
 *
 * @param {{ target?: string, all?: boolean, runs?: number, windowSeconds?: number, settleSeconds?: number,
 *           out?: string, env?: NodeJS.ProcessEnv, now?: Date }} options
 */
export function planCost({ target, all = false, runs = DEFAULTS.runs, windowSeconds = DEFAULTS.windowSeconds, settleSeconds = DEFAULTS.settleSeconds, out, env = process.env, now = new Date() } = {}) {
  if (!target && !all) throw new CostError("usage", "cost needs a plugin: `omakit cost <plugin-id-or-dir>`, or `omakit cost --all` for every enabled third-party plugin")
  for (const command of ["omarchy-shell", "omarchy-restart-shell", "omarchy", "qs"]) {
    if (!onPath(command, env)) throw new CostError("command-missing", `${command} is not on PATH; cost measures a running Omarchy shell through its own commands`, "Run it on an Omarchy machine, from a shell that has $OMARCHY_PATH/bin on PATH.")
  }
  const omarchyPath = sessionOmarchyPath(env)
  if (!omarchyPath || !existsSync(join(omarchyPath, "shell/shell.qml"))) {
    throw new CostError("omarchy-path", `OMARCHY_PATH ${omarchyPath ? `(${omarchyPath}) ` : ""}does not point at a shell: no shell/shell.qml under it`, "Log in to an Omarchy session; the shell is read from the session's OMARCHY_PATH.")
  }
  // Every Omarchy command from here on sees the session's OMARCHY_PATH, the
  // way it would from a terminal in that session.
  env = { ...env, OMARCHY_PATH: omarchyPath }
  const locked = run("sessionLocked", { env })
  if (locked.status === 0) throw new CostError("session-locked", "the session is locked, so the shell is not restarted; this is the same check omarchy-restart-shell makes", "Unlock the session, then run it again.")
  if (!run("ping", { env }).ok) throw new CostError("shell-not-running", "the shell is not running, and cost measures a running shell", "omarchy-restart-shell")

  const listed = run("listPlugins", { env })
  if (!listed.ok) throw new CostError("shell-unreadable", "listPlugins failed", "omarchy-restart-shell, then run it again.")
  const installed = parseJson(listed.stdout, "listPlugins")
  const effectiveRun = run("listShellConfig", { env })
  if (!effectiveRun.ok) throw new CostError("shell-unreadable", "listShellConfig failed", "omarchy-restart-shell, then run it again.")
  const effective = parseJson(effectiveRun.stdout, "listShellConfig")
  const catalogRun = run("catalog", { env })
  const catalog = catalogRun.ok ? parseJson(catalogRun.stdout, "omarchy-plugin-catalog") : []
  const sourceDirOf = (id) => catalog.find((entry) => entry.id === id)?.sourceDir || null

  let audited
  if (all) {
    audited = installed.filter((plugin) => plugin.enabled === true && plugin.firstParty === false && !(plugin.kinds || []).includes("bar"))
    if (!audited.length) throw new CostError("nothing-to-measure", "no enabled third-party plugin is installed; --all measures every enabled plugin that is not first-party and not a whole bar")
  } else {
    let id = target
    const manifest = join(resolve(target), "manifest.json")
    if (existsSync(manifest)) {
      const declared = parseJson(readFileSync(manifest, "utf8"), manifest).id
      if (!declared) throw new CostError("plugin-unknown", `${manifest} declares no id`)
      id = declared
    } else if (target.includes("/") || target === "." || target === "..") {
      throw new CostError("plugin-unknown", `${resolve(target)} has no manifest.json, and ${target} is not an installed plugin id`, "Pass the plugin's id from `omarchy plugin list`, or the directory its manifest.json is in.")
    }
    const plugin = installed.find((entry) => entry.id === id)
    if (!plugin) throw new CostError("plugin-unknown", `${id} is not an installed plugin; cost measures a plugin the shell can load`, "omarchy plugin list, then pass one of its ids, or install the plugin first.")
    if ((plugin.kinds || []).includes("bar")) throw new CostError("plugin-is-bar", `${id} is a whole bar, and replacing the bar is not a cost`)
    if (plugin.enabled !== true) throw new CostError("plugin-disabled", `${id} is not enabled, so there is no place in the layout to put it back into`, `omarchy plugin enable ${id}, then run it again.`)
    audited = [plugin]
  }
  audited = audited.map((plugin) => ({ id: plugin.id, name: plugin.name || plugin.id, kinds: plugin.kinds || [], firstParty: plugin.firstParty === true, sourceDir: sourceDirOf(plugin.id) }))

  const { file: configFile } = configPaths(env)
  const stateDir = omakitStateDir("cost", env)
  const timing = restartTiming(stateDir)
  const restarts = (1 + audited.length) * runs
  const perRun = timing.seconds + settleSeconds + windowSeconds
  const estimatedMinutes = Math.ceil((restarts * perRun) / 60)
  let shellVersion = "unknown"
  try {
    shellVersion = readFileSync(join(omarchyPath, "version"), "utf8").trim() || "unknown"
  } catch {
    // A shell without a version file is still a shell.
  }
  const ticks = run("clockTicks", { env })
  const clockTicksPerSecond = ticks.ok && /^\d+$/.test(ticks.stdout.trim()) ? Number(ticks.stdout.trim()) : 100

  return {
    env,
    omarchyPath,
    shellVersion,
    installed,
    effective,
    audited,
    runs,
    windowSeconds,
    settleSeconds,
    readyTimeoutSeconds: DEFAULTS.readyTimeoutSeconds,
    sampleIntervalMs: DEFAULTS.sampleIntervalMs,
    clockTicksPerSecond,
    restarts,
    timing,
    estimatedMinutes,
    configFile,
    stateDir,
    out: out ? resolve(out) : join(stateDir, `${fileStamp(now)}.json`),
    started: utc(now),
  }
}

function sleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) {
      reject(new CostError("interrupted", "interrupted"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolveSleep()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new CostError("interrupted", "interrupted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function checkAbort(signal) {
  if (signal?.aborted) throw new CostError("interrupted", "interrupted")
}

/** Wait until listPlugins reports every installed plugin, polling once a second; null when it does not within the timeout. */
async function waitReady(expectedCount, { env, timeoutSeconds, signal }) {
  const startedAt = Date.now()
  for (;;) {
    checkAbort(signal)
    const listed = run("listPlugins", { env, timeoutMs: 10_000 })
    if (listed.ok) {
      try {
        if (JSON.parse(listed.stdout).length === expectedCount) return (Date.now() - startedAt) / 1000
      } catch {
        // Not JSON yet: the shell is still coming up.
      }
    }
    if ((Date.now() - startedAt) / 1000 >= timeoutSeconds) return null
    await sleep(1000, signal)
  }
}

function shellPid(omarchyPath, env) {
  const listed = run("shellPid", { env, extra: [join(omarchyPath, "shell"), "--json"] })
  if (!listed.ok) return null
  try {
    const pid = JSON.parse(listed.stdout)?.[0]?.pid
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * One configuration, one run: write, restart, wait, settle, sample. Returns
 * the sample, or `{ failed }` with the reason when the shell did not come
 * back or did not report every plugin; nothing is estimated in its place.
 */
async function sampleConfig({ label, runIndex, config, plan, env, procRoot, signal, onPhase, restartTimes }) {
  const { configFile, omarchyPath, windowSeconds, settleSeconds, readyTimeoutSeconds, sampleIntervalMs, clockTicksPerSecond: clk } = plan
  const expectedCount = plan.installed.length
  onPhase(`run ${runIndex} of ${plan.runs}: ${label}, restarting the shell`)
  writeConfig(configFile, config)
  const restartStarted = Date.now()
  const restart = run("restartShell", { env, timeoutMs: 120_000 })
  if (!restart.ok) return { label, run: runIndex, failed: "the shell did not answer after the restart" }
  const readyAfterSeconds = await waitReady(expectedCount, { env, timeoutSeconds: readyTimeoutSeconds, signal })
  if (readyAfterSeconds === null) return { label, run: runIndex, failed: `listPlugins did not reach ${expectedCount} plugins in ${readyTimeoutSeconds}s` }
  restartTimes.push((Date.now() - restartStarted) / 1000)
  onPhase(`run ${runIndex} of ${plan.runs}: ${label}, settling for ${settleSeconds}s`)
  await sleep(settleSeconds * 1000, signal)
  const pid = shellPid(omarchyPath, env)
  if (pid === null) return { label, run: runIndex, failed: "no shell pid" }

  // Memory at the settle, kept as raw data, and a trace through the window:
  // the shell releases 55 to 65 MB at a variable moment after loading
  // (docs/MEASUREMENTS.md C1), and the trace is how a reader sees whether
  // this machine's settle was long enough. The headline is read at the end
  // of the window, the latest point of the run.
  const settled = { pssKbSettled: pssKb(procRoot, pid), rssKbSettled: rssKb(procRoot, pid) }
  onPhase(`run ${runIndex} of ${plan.runs}: ${label}, sampling for ${windowSeconds}s`)
  const started = utc()
  const t0 = Date.now()
  const cpu0 = cpuTicks(procRoot, pid) ?? 0
  const child0 = childTicks(procRoot, pid) ?? 0
  const rows = []
  const trace = []
  let elapsed = 0
  for (;;) {
    trace.push({ t: Number(elapsed.toFixed(3)), pssKb: pssKb(procRoot, pid), rssKb: rssKb(procRoot, pid) })
    for (const entry of descendants(procRoot, pid)) rows.push({ t: elapsed, ...entry })
    elapsed = (Date.now() - t0) / 1000
    if (elapsed >= windowSeconds) break
    await sleep(Math.min(sampleIntervalMs, Math.max(1, (windowSeconds - elapsed) * 1000)), signal)
    elapsed = (Date.now() - t0) / 1000
  }
  const t1 = Date.now()
  const cpu1 = cpuTicks(procRoot, pid) ?? cpu0
  const child1 = childTicks(procRoot, pid) ?? child0
  const memory = { pssKb: pssKb(procRoot, pid), rssKb: rssKb(procRoot, pid), memoryAt: "window-end", ...settled, trace }
  const seconds = (t1 - t0) / 1000
  const byPid = new Map()
  for (const row of rows) {
    const child = byPid.get(row.pid)
    if (!child) {
      byPid.set(row.pid, { pid: row.pid, comm: row.comm, arg0: row.arg0, key: row.key, firstSeen: row.t, lastSeen: row.t, cpuFirst: row.cpu, cpuLast: row.cpu, rssLast: row.rss, samples: 1 })
    } else {
      child.lastSeen = row.t
      child.cpuLast = row.cpu
      child.rssLast = row.rss
      child.samples += 1
    }
  }
  return {
    label,
    run: runIndex,
    shellPid: pid,
    started,
    ended: utc(),
    readyAfterSeconds,
    windowSeconds: Number(seconds.toFixed(3)),
    shell: {
      ...memory,
      cpuTicksStart: cpu0,
      cpuTicksEnd: cpu1,
      cpuSeconds: (cpu1 - cpu0) / clk,
      cpuPercent: ((cpu1 - cpu0) / clk / seconds) * 100,
      reapedChildTicksStart: child0,
      reapedChildTicksEnd: child1,
      reapedChildCpuSeconds: (child1 - child0) / clk,
      reapedChildCpuPercent: ((child1 - child0) / clk / seconds) * 100,
    },
    children: [...byPid.values()].map((child) => ({ ...child, firstSeen: Number(child.firstSeen.toFixed(3)), lastSeen: Number(child.lastSeen.toFixed(3)) })),
  }
}

const KB = 1024

/** The sentence for a plugin's README: the totals when they are above noise, the floor when they are not, nothing when no run completed. */
export function readmeSentence({ totalMb, totalCpuPercent, memoryVerdict, cpuVerdict, floorMb, floorCpu, shellVersion, date }) {
  if (memoryVerdict === "unknown" || cpuVerdict === "unknown") return null
  const mb = memoryVerdict === "above-noise" ? `${totalMb.toFixed(1)} MB` : `under ${floorMb === null ? "?" : floorMb.toFixed(1)} MB`
  const cpu = cpuVerdict === "above-noise" ? `${totalCpuPercent.toFixed(1)}% CPU` : `under ${floorCpu === null ? "?" : floorCpu.toFixed(2)}% CPU`
  return `Costs ${mb} and ${cpu} on Omarchy ${shellVersion}, measured with omakit cost on ${date}`
}

/** The row's one-line verdict, the same words the report prints and `verdict.summary` carries. */
export function summaryOf(memoryVerdict, cpuVerdict) {
  if (memoryVerdict === "unknown" || cpuVerdict === "unknown") return "no completed run, so nothing is claimed"
  if (memoryVerdict === "within-noise" && cpuVerdict === "within-noise") return "within noise on memory and CPU"
  if (memoryVerdict === "above-noise" && cpuVerdict === "above-noise") return "above noise on memory and CPU"
  return memoryVerdict === "above-noise" ? "above noise on memory, within noise on CPU" : "above noise on CPU, within noise on memory"
}

/** The samples of every run, into the document docs/COST.md describes. */
export function buildDocument(plan, samples, { started, ended, config, host = hostname(), omakitVersion }) {
  const clk = plan.clockTicksPerSecond
  const completed = samples.filter((sample) => !sample.failed)
  const failed = samples.filter((sample) => sample.failed).map(({ label, run: runIndex, failed: reason }) => ({ label, run: runIndex, reason }))
  const strip = (sample) => ({ ...sample, children: sample.children.map(({ key, ...child }) => child) })
  const base = completed.filter((sample) => sample.label === "baseline").sort((a, b) => a.run - b.run)
  const baseKeys = new Set(base.flatMap((sample) => sample.children.map((child) => child.key)))
  const baseline = {
    config: plan.baselineConfig,
    pssMb: stats(base.map((sample) => (sample.shell.pssKb ?? 0) / KB)),
    rssMb: stats(base.map((sample) => (sample.shell.rssKb ?? 0) / KB)),
    pssMbSettled: stats(base.map((sample) => (sample.shell.pssKbSettled ?? 0) / KB)),
    rssMbSettled: stats(base.map((sample) => (sample.shell.rssKbSettled ?? 0) / KB)),
    cpuPercent: stats(base.map((sample) => sample.shell.cpuPercent)),
    childRssMb: stats(base.map((sample) => sample.children.reduce((sum, child) => sum + child.rssLast, 0) / KB)),
    runs: base.map(strip),
  }
  const noiseFloor = {
    pssMb: baseline.pssMb.spread,
    rssMb: baseline.rssMb.spread,
    pssMbSettled: baseline.pssMbSettled.spread,
    rssMbSettled: baseline.rssMbSettled.spread,
    cpuPercent: baseline.cpuPercent.spread,
    origin: `the spread (max minus min) of the ${base.length} baseline run(s): Pss and VmRSS at the end of the window (the headline), the same two at the settle, and CPU percent over the window`,
  }
  const date = started.slice(0, 10)
  const plugins = plan.audited.map((plugin) => {
    const plus = completed.filter((sample) => sample.label === plugin.id).sort((a, b) => a.run - b.run)
    const deltas = []
    for (const sample of plus) {
      const pair = base.find((candidate) => candidate.run === sample.run)
      if (!pair) continue
      const own = sample.children.filter((child) => !baseKeys.has(child.key))
      const ownCpuSeconds = own.reduce((sum, child) => sum + (child.cpuLast - child.cpuFirst), 0) / clk
      const reaped = sample.shell.reapedChildCpuPercent - pair.shell.reapedChildCpuPercent
      deltas.push({
        run: sample.run,
        shellPssMb: ((sample.shell.pssKb ?? 0) - (pair.shell.pssKb ?? 0)) / KB,
        shellRssMb: ((sample.shell.rssKb ?? 0) - (pair.shell.rssKb ?? 0)) / KB,
        shellPssMbSettled: ((sample.shell.pssKbSettled ?? 0) - (pair.shell.pssKbSettled ?? 0)) / KB,
        shellCpuPercent: sample.shell.cpuPercent - pair.shell.cpuPercent,
        childRssMb: own.reduce((sum, child) => sum + child.rssLast, 0) / KB,
        childCpuPercent: (ownCpuSeconds / sample.windowSeconds) * 100 + reaped,
        reapedChildCpuPercent: reaped,
        childSpawns: own.length,
        children: own.map((child) => ({ comm: child.comm, arg0: child.arg0, rssKb: child.rssLast, cpuSeconds: (child.cpuLast - child.cpuFirst) / clk, firstSeen: child.firstSeen, lastSeen: child.lastSeen })),
      })
    }
    const pss = stats(deltas.map((delta) => delta.shellPssMb))
    const rss = stats(deltas.map((delta) => delta.shellRssMb))
    const pssSettled = stats(deltas.map((delta) => delta.shellPssMbSettled))
    const cpu = stats(deltas.map((delta) => delta.shellCpuPercent))
    const childRss = stats(deltas.map((delta) => delta.childRssMb))
    const childCpu = stats(deltas.map((delta) => delta.childCpuPercent))
    const memoryVerdict = verdict(pss.median, noiseFloor.pssMb)
    const cpuVerdict = verdict(cpu.median, noiseFloor.cpuPercent)
    const totalMb = pss.median === null ? null : pss.median + (childRss.median ?? 0)
    const totalCpuPercent = cpu.median === null ? null : cpu.median + (childCpu.median ?? 0)
    return {
      id: plugin.id,
      name: plugin.name,
      kinds: plugin.kinds,
      firstParty: plugin.firstParty,
      sourceDir: plugin.sourceDir,
      runsCompleted: deltas.length,
      shellPssMb: pss,
      shellRssMb: rss,
      shellPssMbSettled: pssSettled,
      shellCpuPercent: cpu,
      childRssMb: childRss,
      childCpuPercent: childCpu,
      childSpawns: stats(deltas.map((delta) => delta.childSpawns)),
      totalMb,
      totalCpuPercent,
      verdict: { memory: memoryVerdict, cpu: cpuVerdict, summary: summaryOf(memoryVerdict, cpuVerdict) },
      withinNoise: {
        pss: pss.median === null ? null : memoryVerdict === "within-noise",
        rss: rss.median === null ? null : verdict(rss.median, noiseFloor.rssMb) === "within-noise",
        cpu: cpu.median === null ? null : cpuVerdict === "within-noise",
        ownPss: pss.median === null ? null : verdict(pss.median, pss.spread) === "within-noise",
        ownCpu: cpu.median === null ? null : verdict(cpu.median, cpu.spread) === "within-noise",
        baselinePssSpreadMb: noiseFloor.pssMb,
        baselineCpuSpreadPercent: noiseFloor.cpuPercent,
        note: "pss, rss and cpu compare the median delta with the baseline spread; ownPss and ownCpu compare it with the spread of the row's own deltas",
      },
      origin: `plus minus baseline per run over ${deltas.length} run(s): Pss from /proc/<shell pid>/smaps_rollup and VmRSS from /proc/<shell pid>/status at the end of a ${plan.windowSeconds}s window that opens ${plan.settleSeconds}s after listPlugins reports every plugin (the same two at the settle under Settled); utime+stime from /proc/<shell pid>/stat over that window; children from a /proc descendant walk every ${plan.sampleIntervalMs}ms, attributed by a command line absent from every baseline run, plus cutime+cstime of the shell pid`,
      readme: readmeSentence({ totalMb, totalCpuPercent, memoryVerdict, cpuVerdict, floorMb: noiseFloor.pssMb, floorCpu: noiseFloor.cpuPercent, shellVersion: plan.shellVersion, date }),
      deltas,
      runs: plus.map(strip),
    }
  }).sort((a, b) => (b.totalMb ?? -Infinity) - (a.totalMb ?? -Infinity))
  return {
    omakit: omakitVersion,
    command: "cost",
    method: METHOD,
    started,
    ended,
    host,
    shell: { version: plan.shellVersion, omarchyPath: plan.omarchyPath },
    settings: {
      runs: plan.runs,
      windowSeconds: plan.windowSeconds,
      settleSeconds: plan.settleSeconds,
      readyTimeoutSeconds: plan.readyTimeoutSeconds,
      sampleIntervalMs: plan.sampleIntervalMs,
      clockTicksPerSecond: clk,
    },
    config,
    audited: plan.audited.map((plugin) => plugin.id),
    failedRuns: failed,
    baseline,
    noiseFloor,
    plugins,
    out: plan.out,
  }
}

/**
 * The half that changes the machine. Every exit path restores `shell.json`
 * from the backup taken here and restarts the shell once more so it runs
 * the user's own configuration; the document records the md5 before and
 * after and whether they matched.
 *
 * @param {ReturnType<typeof planCost>} plan
 * @param {{ env?: NodeJS.ProcessEnv, procRoot?: string, signal?: AbortSignal, omakitVersion?: string,
 *           onPhase?: (text: string) => void, onLine?: (line: { state: string, text: string }) => void }} [options]
 */
export async function measureCost(plan, { env = plan.env || process.env, procRoot = PROC, signal, omakitVersion = "unknown", onPhase = () => {}, onLine = () => {} } = {}) {
  const stamp = fileStamp().replace(/[-T]/g, "").replace(/Z$/, "")
  const ids = plan.audited.map((plugin) => plugin.id)
  plan.baselineConfig = without(plan.effective, ids, plan.installed)
  const configs = [{ label: "baseline", config: plan.baselineConfig }]
  for (const plugin of plan.audited) {
    configs.push({ label: plugin.id, config: without(plan.effective, ids.filter((id) => id !== plugin.id), plan.installed) })
  }
  mkdirSync(dirname(plan.configFile), { recursive: true })
  const backup = backupConfig(plan.configFile, stamp)
  onLine({ state: "info", text: backup.bytes === null
    ? `${plan.configFile} does not exist; it will be removed again afterwards`
    : `${plan.configFile} backed up to ${backup.backupFile}, md5 ${backup.md5Before}` })
  const samples = []
  const restartTimes = []
  let restore = null
  let restoreProblem = null
  let comeBack = null
  try {
    for (let runIndex = 1; runIndex <= plan.runs; runIndex += 1) {
      for (const { label, config } of configs) {
        checkAbort(signal)
        const sample = await sampleConfig({ label, runIndex, config, plan, env, procRoot, signal, onPhase, restartTimes })
        // One line per configuration, on the record: a forty-restart run
        // in a pipe would otherwise be silent for half an hour, and the
        // figures here are the raw samples a reader can check the medians
        // against.
        if (sample.failed) onLine({ state: "advisory", text: `run ${runIndex} of ${plan.runs}, ${label}: ${sample.failed}; no sample` })
        else onLine({ state: "info", text: `run ${runIndex} of ${plan.runs}, ${label}: ${((sample.shell.pssKb ?? 0) / KB).toFixed(1)} MB Pss, ${sample.shell.cpuPercent.toFixed(2)}% CPU, ${sample.children.length} child process${sample.children.length === 1 ? "" : "es"}, ready after ${sample.readyAfterSeconds.toFixed(1)} s` })
        samples.push(sample)
      }
    }
  } finally {
    onPhase("restoring shell.json and restarting the shell")
    try {
      // Bytes back, the shell restarted on them, and only then the md5: a
      // shell that rewrote the file as it started would pass a check made
      // before the restart and fail the one made after, and the second is
      // the one that describes the file the user is left with.
      restoreConfig(backup)
      comeBack = run("restartShell", { env, timeoutMs: 120_000 })
      if (!comeBack.ok) onLine({ state: "advisory", text: "the shell did not answer after the restore; run omarchy-restart-shell" })
      restore = verifyRestore(backup)
      if (restore.restored) {
        onLine({ state: "pass", text: backup.bytes === null
          ? `${plan.configFile} removed again, as it was`
          : `${plan.configFile} restored and verified, md5 ${restore.md5After} (before: ${backup.md5Before}); the backup is removed` })
      } else {
        onLine({ state: "fail", text: `${plan.configFile} differs from the backup after the restore (md5 ${restore.md5After}, before ${backup.md5Before}); the backup ${backup.backupFile} is kept` })
      }
    } catch (error) {
      restoreProblem = error
      onLine({ state: "fail", text: `the restore failed: ${error.message}; the backup is ${backup.backupFile}` })
    }
  }
  if (restoreProblem) throw new CostError("restore-failed", `shell.json could not be restored from ${backup.backupFile}: ${restoreProblem.message}`, `Copy ${backup.backupFile} over ${plan.configFile} yourself, then run omarchy-restart-shell.`)
  const ended = utc()
  const config = {
    path: plan.configFile,
    backup: backup.backupFile,
    md5Before: backup.md5Before,
    md5After: restore.md5After,
    restored: restore.restored,
    shellAnsweredAfterRestore: comeBack ? comeBack.ok : null,
  }
  const document = buildDocument(plan, samples, { started: plan.started, ended, config, omakitVersion })
  mkdirSync(dirname(plan.out), { recursive: true })
  const out = plan.out
  writeFileSync(resolve(out), `${JSON.stringify(document, null, 2)}\n`)
  if (restartTimes.length) {
    mkdirSync(plan.stateDir, { recursive: true })
    const timingFile = plan.timing.file
    writeFileSync(timingFile, `${JSON.stringify({ restartSeconds: Number(median(restartTimes).toFixed(1)), restarts: restartTimes.length, measuredAt: ended }, null, 2)}\n`)
  }
  if (!restore.restored) throw new CostError("restore-unverified", `shell.json differs from the backup after the restore; the backup ${backup.backupFile} is kept and the document is at ${out}`, `Compare ${backup.backupFile} with ${plan.configFile} and copy it over if the difference is not yours.`)
  return document
}
