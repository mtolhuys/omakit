// What the lab commands print for a person: palette roles only, the
// shared marks, fields and actions from style.mjs, every path under the
// home directory abbreviated the way a shell takes it. The documents
// themselves (`--json`) keep every path absolute.

import { action, colourEnabled, field, GUTTER, labelled, mark, section, styler, verdict, wrap } from "../marketplace/style.mjs"
import { withHomeAbbreviated } from "../marketplace/paths.mjs"
import { bytesBoth, durationWords, gbBoth, shortId } from "./pin.mjs"
import { disclosureLines } from "./setup.mjs"

const state = (ok) => (ok ? "pass" : "advisory")

/** The lab's lines for `omakit doctor`, in doctor's check shape; every one advice, never a problem, because the lab is optional. */
export function labDoctorChecks(lab) {
  const checks = []
  const add = (id, ok, detail, remedy = null, evidence = null) => checks.push({ id, state: ok ? "ok" : "advice", detail, action: ok ? null : remedy, ...(evidence ? { evidence } : {}) })
  for (const line of lab.host.run) {
    if (line.name === "cpus" || line.name === "memory") continue
    add(`lab.${line.name}`, line.state === "ok", line.reason, line.remedy)
  }
  // MemTotal alone: MemAvailable moves between two runs of doctor, and
  // doctor's bytes are held to being the same twice (tests/unit/cli.test.mjs).
  const memory = lab.host.run.find((line) => line.name === "memory")
  if (memory) add("lab.memory", memory.state === "ok", memory.reason.replace(/, \d+ MiB available/, ""), memory.remedy)
  for (const line of lab.host.verify) add(`lab.${line.name}`, line.state === "ok", line.reason, line.remedy)
  const enough = lab.free.bytes >= lab.pin.measured.preparedLabBytes
  // The free figure alone, no path: the lab cache's path can be wider than
  // a terminal, and doctor's one wide line is the pin's; `omakit lab
  // inspect` prints the path and the cache's own size.
  // To a tenth of a GiB: the exact figure moves with every write on the
  // filesystem, and doctor's two consecutive runs are held to the same bytes.
  add("lab.disk", enough, `${(lab.free.bytes / 2 ** 30).toFixed(1)} GiB free on the lab cache's filesystem; a prepared lab measured ${bytesBoth(lab.pin.measured.preparedLabBytes)} (M14)`, enough ? null : "omakit lab prune, or free the difference")
  add("lab.iso", lab.download.verified, `${lab.pin.release.name}, ${lab.download.reason}`, lab.download.verified ? null : "omakit lab setup", { sha256: lab.pin.release.sha256, present: lab.download.present, verified: lab.download.verified })
  add("lab.base", lab.base.state === "ready", `${lab.base.state}: ${lab.base.reason}`, lab.base.state === "ready" ? null : "omakit lab setup", { state: lab.base.state, release: lab.base.manifest?.release?.name ?? null, guestVersion: lab.base.manifest?.guest?.version ?? null, diskSha256: lab.base.manifest?.disk?.sha256 ?? null, allocatedBytes: lab.base.allocatedBytes, lockHeld: lab.lock.held, lockAlive: lab.lock.alive })
  if (lab.lock.held) add("lab.lock", !lab.lock.alive, lab.lock.alive ? `held by run ${lab.lock.record?.runId || "unknown"} (pid ${lab.lock.record?.pid || "?"})` : `a stale lock from ${lab.lock.record?.runId || "an unknown run"}`, lab.lock.alive ? "wait for the run" : "omakit lab prune")
  return checks
}

/** `omakit lab inspect`. */
export function renderLab(lab, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const home = (text) => withHomeAbbreviated(text, env)
  const out = []
  const { release } = lab.pin
  out.push(...section("the release the lab is pinned to", c))
  out.push(...field("release", `Omarchy ${release.name}; guest package expected ${release.expectedGuestVersion}; ISO build ${release.embeddedBuild}, volume ${release.volume}`, c))
  out.push(...field("iso", release.isoUrl, c))
  out.push(...field("size", bytesBoth(release.bytes), c))
  out.push(...field("sha256", release.sha256, c, { wrapValue: false }))
  out.push(...field("signed by", `${release.signingFingerprint} (Omarchy <pkgs@omarchy.org>, the packaged key)`, c))
  out.push(...field("toolchain", `omarchy-iso ${lab.pin.toolchain.commit.slice(0, 12)} with ${lab.pin.toolchain.patch}; harness sha256 ${shortId(lab.pin.toolchain.patchedHarnessSha256)}`, c))
  out.push("")
  out.push(...section("on disk", c))
  out.push(`${mark(state(lab.download.verified), c)}${c("name", "iso")}`)
  out.push(...wrap(home(`${lab.download.present ? `${bytesBoth(lab.download.bytes)} at ${lab.download.iso}: ` : ""}${lab.download.reason}`), { indent: GUTTER }, c))
  out.push(`${mark(state(lab.base.state === "ready"), c)}${c("name", `base (${lab.base.state})`)}`)
  out.push(...wrap(home(lab.base.reason), { indent: GUTTER }, c))
  if (lab.base.manifest) out.push(...labelled("disk sha256", lab.base.manifest.disk.sha256, c), ...labelled("origin", home(lab.base.manifest.build?.origin || "unknown"), c))
  out.push(`${mark(state(lab.toolchain.state === "ready"), c)}${c("name", `toolchain (${lab.toolchain.state})`)}`)
  out.push(...wrap(home(lab.toolchain.reason), { indent: GUTTER }, c))
  if (lab.staging.length) {
    out.push(`${mark(lab.staging.some((entry) => entry.alive) ? "info" : "advisory", c)}${c("name", "staging")}`)
    for (const entry of lab.staging) out.push(...wrap(home(`${entry.name}: ${bytesBoth(entry.allocatedBytes)}${entry.alive ? ", a QEMU answers on its socket" : ", inactive"}`), { indent: GUTTER }, c))
  }
  if (lab.lock.held) {
    out.push(`${mark(lab.lock.alive ? "info" : "advisory", c)}${c("name", "lock")}`)
    out.push(...wrap(lab.lock.alive ? `held by run ${lab.lock.record?.runId || "unknown"} (pid ${lab.lock.record?.pid || "?"})` : `stale, from ${lab.lock.record?.runId || "an unknown run"}`, { indent: GUTTER }, c))
  }
  out.push(...field("lab cache", `${bytesBoth(lab.totals.cacheBytes)} at ${home(lab.layout.cache)}: downloads ${gbBoth(lab.totals.downloadsBytes)}, base ${gbBoth(lab.totals.baseBytes)}, staging ${gbBoth(lab.totals.stagingBytes)}, plugins ${gbBoth(lab.totals.pluginsBytes)}`, c))
  out.push(...field("runs", `${lab.runs.length} record${lab.runs.length === 1 ? "" : "s"}, ${bytesBoth(lab.totals.runsBytes)} at ${home(lab.layout.runs)}${lab.runs.length ? `; newest ${lab.runs.at(-1)}` : ""}`, c))
  out.push(...field("free", `${bytesBoth(lab.free.bytes)} at ${home(lab.free.path)}`, c))
  out.push("")
  out.push(...section("the host", c))
  for (const line of [...lab.host.run, ...lab.host.verify, ...lab.host.build]) {
    out.push(`${mark(state(line.state === "ok"), c)}${c("name", line.name)}`)
    out.push(...wrap(line.reason, { indent: GUTTER }, c))
  }
  out.push("")
  if (lab.missing.length) {
    out.push(...section(`missing for \`omakit lab run\`: ${lab.missing.length}`, c))
    for (const item of lab.missing) {
      out.push(`${mark("advisory", c)}${c("name", item.what)}`)
      out.push(...labelled("costs", home(item.cost), c))
      if (item.command) out.push(...action(home(item.command), c))
    }
    out.push("")
    out.push(...verdict("advisory", "NOT PREPARED", `${lab.missing.length} thing${lab.missing.length === 1 ? "" : "s"} before a run; nothing was fetched or written.`, c))
  } else {
    out.push(...verdict("pass", "PREPARED", `verified ${release.name}, a ready base, the host can run it; nothing was fetched or written.`, c))
  }
  return out.join("\n")
}

/** The setup disclosure, and what happened. */
export function renderSetupPlan(plan, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  if (plan.blockers.length) {
    out.push(...section(`\`omakit lab setup\` cannot start: ${plan.blockers.length} missing`, c))
    for (const item of plan.blockers) {
      out.push(`${mark("fail", c)}${c("name", item.what)}`)
      out.push(...labelled("costs", withHomeAbbreviated(item.cost, env), c))
      if (item.command) out.push(...action(withHomeAbbreviated(item.command, env), c))
    }
    return out.join("\n")
  }
  if (!plan.steps.length) {
    out.push(...verdict("pass", "PREPARED", "the verified ISO and a ready base are there; nothing to acquire.", c))
    return out.join("\n")
  }
  out.push(...section("what setup will do, once you say yes", c))
  for (const [key, value] of disclosureLines(plan)) out.push(...field(key, withHomeAbbreviated(value, env), c))
  return out.join("\n")
}

export function renderSetupResult(result, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  if (result.nothingToDo) return verdict("pass", "PREPARED", "nothing to acquire; the lab was already prepared.", c).join("\n")
  for (const step of result.done) {
    if (step.kind === "download") out.push(`${mark("pass", c)}downloaded ${bytesBoth(step.bytes)} in ${durationWords(step.milliseconds)}`)
    else if (step.kind === "import") out.push(`${mark("pass", c)}copied ${bytesBoth(step.bytes)} from ${withHomeAbbreviated(step.from, env)} in ${durationWords(step.milliseconds)}`)
    else if (step.kind === "sidecars") out.push(`${mark("pass", c)}fetched the checksum and signature sidecars into ${withHomeAbbreviated(step.to, env)}`)
    else if (step.kind === "verify") out.push(`${mark("pass", c)}verified ${withHomeAbbreviated(step.file, env)}`, ...wrap(step.reason, { indent: GUTTER }, c))
    else if (step.kind === "build") out.push(`${mark("pass", c)}built and promoted the base in ${durationWords(step.milliseconds)}: guest omarchy ${step.guest.version}, ${bytesBoth(step.allocatedBytes)} allocated, disk sha256 ${step.diskSha256}`)
    else if (step.kind === "plugins") out.push(`${mark("pass", c)}${step.fetched.length} listed plugins in the lab cache: ${step.fetched.map((row) => `${row.id} ${row.state}`).join(", ")}`)
  }
  out.push("")
  out.push(...verdict("pass", "PREPARED", "the lab is ready; `omakit lab run <suite>` boots it.", c))
  return out.join("\n")
}

/** The identity block before a suite, and the verdict after. */
export function renderRunIdentity(record, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("run", record.runId, c))
  out.push(...field("release", record.pin.release, c))
  out.push(...field("guest", record.guest ? `omarchy ${record.guest.version || "unknown"} on ${record.guest.kernel || "?"}` : "not read", c))
  out.push(...field("iso sha256", record.pin.isoSha256, c, { wrapValue: false }))
  out.push(...field("base", `created ${record.base.createdAt}; ${bytesBoth(record.base.allocatedBytes)}; disk sha256 ${shortId(record.base.diskSha256)}`, c))
  out.push(...field("tested", record.testedSource || "unknown", c))
  out.push(...field("skew", record.skew === null ? "unknown" : record.skew ? `true: the guest is ${record.guest?.linked ? "linked to a checkout" : `omarchy ${record.guest?.version}`}, the pin expects ${record.pin.expectedGuestVersion}` : `false: the installed package is the pinned ${record.pin.expectedGuestVersion}`, c))
  return out.join("\n")
}

export function renderRunResult(record, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("duration", durationWords(record.durationMs || 0), c))
  if (record.overlayBytes !== null) out.push(...field("overlay", `${bytesBoth(record.overlayBytes)} allocated by the run, removed`, c))
  out.push(...field("base", record.baseUnchanged ? "unchanged (size, mtime and inode of the disk and the template)" : "CHANGED: the base or its template differs from before the run", c))
  if (record.document) out.push(...field("document", withHomeAbbreviated(record.document, env), c))
  out.push(...field("record", withHomeAbbreviated(`${record.runDir}/run.json`, env), c))
  out.push("")
  if (record.ok) out.push(...verdict("pass", "PROVED", `${record.suite}: ${record.assertion?.reason || "ok"}; guest omarchy ${record.guest?.version}, skew ${record.skew}.`, c))
  else out.push(...verdict("fail", "NOT PROVED", `${record.suite}: ${record.assertion?.reason || record.error || `the suite exited ${record.suiteStatus}`}.`, c))
  return out.join("\n")
}

/** `omakit lab prune`: the targets, the total, the question's subject. */
export function renderPrunePlan(plan, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const out = []
  if (plan.blockers.length) {
    for (const line of plan.blockers) out.push(`${mark("fail", c)}${line}`)
    return out.join("\n")
  }
  if (!plan.targets.length) return verdict("pass", "NOTHING TO PRUNE", `the lab cache holds ${bytesBoth(plan.remaining.cache)} and every byte of it is in use or kept; run records ${bytesBoth(plan.remaining.runs)} (--runs removes them).`, c).join("\n")
  out.push(...section("what prune removes", c))
  for (const target of plan.targets) {
    out.push(`${mark("advisory", c)}${c("name", withHomeAbbreviated(target.path, env))}`)
    out.push(...wrap(`${bytesBoth(target.bytes)}: ${target.what}`, { indent: GUTTER }, c))
  }
  out.push(...field("total", bytesBoth(plan.total), c))
  return out.join("\n")
}

export function renderPruneResult(result, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  return verdict("pass", "PRUNED", `${result.words}.`, c).join("\n")
}
