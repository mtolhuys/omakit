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
  // To the GiB: the exact figure moves with every write on the filesystem,
  // and doctor's two consecutive runs are held to the same bytes (a tenth
  // of a GiB flipped once while another test packed a tarball beside it).
  add("lab.disk", enough, `${Math.floor(lab.free.bytes / 2 ** 30).toLocaleString("en-US")} GiB free on the lab cache's filesystem; a prepared lab measured ${bytesBoth(lab.pin.measured.preparedLabBytes)} with Omarchy ${lab.pin.measured.release} (M14)`, enough ? null : "omakit lab prune, or free the difference")
  checks.push(releaseCheck(lab))
  const usable = lab.base.state === "ready" || lab.base.state === "outdated"
  // The ISO is what a build needs: with a usable base there it is only
  // advice when a build is ahead, and the release check says when that is.
  const release = lab.pin.release
  checks.push({
    id: "lab.iso",
    state: lab.download.verified ? "ok" : usable ? "info" : "advice",
    detail: release ? `${release.name}, ${lab.download.reason}` : lab.download.reason,
    action: lab.download.verified || usable ? null : "omakit lab setup",
    evidence: { release: release?.name ?? null, sha256: release?.sha256 ?? null, present: lab.download.present, verified: lab.download.verified },
  })
  add("lab.base", usable, `${lab.base.state}: ${lab.base.reason}`, usable ? null : "omakit lab setup", { state: lab.base.state, release: lab.base.manifest?.release?.name ?? null, guestVersion: lab.base.manifest?.guest?.version ?? null, diskSha256: lab.base.manifest?.disk?.sha256 ?? null, allocatedBytes: lab.base.allocatedBytes, lockHeld: lab.lock.held, lockAlive: lab.lock.alive })
  if (lab.lock.held) add("lab.lock", !lab.lock.alive, lab.lock.alive ? `held by run ${lab.lock.record?.runId || "unknown"} (pid ${lab.lock.record?.pid || "?"})` : `a stale lock from ${lab.lock.record?.runId || "an unknown run"}`, lab.lock.alive ? "wait for the run" : "omakit lab prune")
  return checks
}

/**
 * Whether the lab is on the newest Omarchy release, one check: ok when the
 * base is built from it, advice when a newer one is out, info when there
 * is no base yet or the check was skipped (--offline), unknown when the
 * release list could not be read.
 */
export function releaseCheck(lab) {
  const newest = lab.newest || { checked: false, code: "not-asked", reason: "the newest release was not looked up" }
  const evidence = { newest: newest.checked ? newest.release.name : null, tag: newest.checked ? newest.tag : null, base: lab.base.manifest?.release?.name ?? null, code: newest.checked ? null : newest.code }
  if (!newest.checked) {
    return newest.code === "offline"
      ? { id: "lab.release", state: "info", detail: "the newest Omarchy release is not looked up (--offline)", action: null, evidence }
      : { id: "lab.release", state: "unknown", detail: `could not look up the newest Omarchy release: ${newest.reason}`, action: newest.code === "network-unavailable" ? "Connect to the network, or pass --offline to skip the checks that need it." : null, evidence }
  }
  const name = newest.release.name
  if (lab.base.state === "ready") return { id: "lab.release", state: "ok", detail: `Omarchy ${name} is the newest release, and the lab's base is built from it`, action: null, evidence }
  if (lab.base.state === "outdated") return { id: "lab.release", state: "advice", detail: `Omarchy ${name} is the newest release; the lab's base is ${lab.base.manifest.release.name}${lab.base.manifest.release.name === name ? " as first published" : ""}, and a run still uses it`, action: "omakit lab setup", evidence }
  return { id: "lab.release", state: "info", detail: `Omarchy ${name} is the newest release; \`omakit lab setup\` prepares it`, action: null, evidence }
}

/** `omakit lab inspect`. */
export function renderLab(lab, { colour = colourEnabled(), env = process.env } = {}) {
  const c = styler(colour)
  const home = (text) => withHomeAbbreviated(text, env)
  const out = []
  const { release } = lab.pin
  const newest = lab.newest || { checked: false, reason: "the newest release was not looked up" }
  out.push(...section("the newest release", c))
  if (newest.checked) {
    out.push(...field("release", `Omarchy ${release.name} (${newest.tag}${newest.publishedAt ? `, published ${newest.publishedAt.slice(0, 10)}` : ""}), the newest in ${newest.list.replace(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases.*$/, "github.com/$1")} with its ISO, checksum and signature published`, c))
    for (const skipped of newest.skipped || []) out.push(...field("passed over", `${skipped.name}: ${skipped.reason}`, c))
  } else {
    out.push(...field("release", `not looked up: ${newest.reason}${release ? `; the lab is held to its base's release, Omarchy ${release.name}` : ""}`, c))
  }
  if (release) {
    out.push(...field("iso", release.isoUrl, c))
    out.push(...field("size", bytesBoth(release.bytes), c))
    out.push(...field("sha256", release.sha256, c, { wrapValue: false }))
  }
  out.push(...field("signed by", `${lab.pin.releases.signingFingerprint} (Omarchy <pkgs@omarchy.org>, the key omakit ships); every release must carry it`, c))
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
  // Behind is said whether or not something else is missing: a host that
  // is fixed next still has an older base, and hears it here first.
  if (lab.behind) {
    out.push(...field("behind", `Omarchy ${lab.behind.newest} is out and the base is ${lab.behind.base}: ${lab.behind.cost}`, c))
    out.push(...action(lab.behind.command, c))
    out.push("")
  }
  if (lab.missing.length) {
    out.push(...section(`missing for \`omakit lab prove\`: ${lab.missing.length}`, c))
    for (const item of lab.missing) {
      out.push(`${mark("advisory", c)}${c("name", item.what)}`)
      out.push(...labelled("costs", home(item.cost), c))
      if (item.command) out.push(...action(home(item.command), c))
    }
    out.push("")
    out.push(...verdict("advisory", "NOT PREPARED", `${lab.missing.length} thing${lab.missing.length === 1 ? "" : "s"} before a run; ${lab.newest?.checked ? "only the release list was read" : "nothing was fetched or written"}.`, c))
  } else if (lab.behind) {
    out.push(...verdict("advisory", "PREPARED", `on Omarchy ${lab.behind.base}, which a run uses; Omarchy ${lab.behind.newest} is the newest, and \`omakit lab setup\` builds it. Only the release list was read.`, c))
  } else {
    const on = lab.base.manifest?.release?.name
    out.push(...verdict("pass", "PREPARED", `${on ? `Omarchy ${on}, ` : ""}a ready base the host can run${newest.checked ? ", the newest release" : `; the newest release was not looked up (${newest.reason})`}. ${newest.checked ? "Only the release list was read." : "Nothing was fetched or written."}`, c))
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
    if (plan.stale) out.push(...verdict("advisory", "PREPARED", `the base on disk is Omarchy ${plan.stale.base}, left as it is: the newest release could not be looked up (${plan.stale.reason}). Run \`omakit lab setup\` again with the network.`, c))
    else out.push(...verdict("pass", "PREPARED", `Omarchy ${plan.pin.release.name}, the newest release: the verified ISO and a ready base are there; nothing to acquire.`, c))
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
    else if (step.kind === "build") out.push(`${mark("pass", c)}built and promoted the Omarchy ${step.release} base in ${durationWords(step.milliseconds)}: guest omarchy ${step.guest.version}, ${bytesBoth(step.allocatedBytes)} allocated, disk sha256 ${step.diskSha256}`)
    else if (step.kind === "superseded" && step.removed.length) out.push(`${mark("pass", c)}removed ${step.removed.length === 1 ? "the older download" : `${step.removed.length} older downloads`} (${step.removed.map((entry) => entry.name || entry.digest.slice(0, 12)).join(", ")}), ${bytesBoth(step.removed.reduce((sum, entry) => sum + entry.bytes, 0))}`)
    else if (step.kind === "plugins") out.push(`${mark("pass", c)}${step.fetched.length} listed plugins in the lab cache: ${step.fetched.map((row) => `${row.id} ${row.state}`).join(", ")}`)
  }
  out.push("")
  const built = result.done.find((step) => step.kind === "build")
  out.push(...verdict("pass", "PREPARED", `the lab is ready${built ? ` on Omarchy ${built.release}` : ""}; \`omakit lab prove <suite>\` boots it.`, c))
  return out.join("\n")
}

/** The identity block before a suite, and the verdict after. */
export function renderRunIdentity(record, { colour = colourEnabled() } = {}) {
  const c = styler(colour)
  const out = []
  out.push(...field("run", record.runId, c))
  out.push(...field("release", `Omarchy ${record.pin.release}`, c))
  const newest = record.newest || { release: null, reason: "not looked up" }
  out.push(...field("newest", record.behind
    ? `Omarchy ${newest.release} is out and this base is ${record.pin.release}: the run uses the base there; \`omakit lab setup\` builds ${newest.release}`
    : newest.release ? `this is the newest release (${newest.tag}, checked ${String(newest.checkedAt).slice(0, 10)})` : `not looked up: ${newest.reason}`, c))
  out.push(...field("guest", record.guest ? `omarchy ${record.guest.version || "unknown"} on ${record.guest.kernel || "?"}` : "not read", c))
  out.push(...field("iso sha256", record.pin.isoSha256, c, { wrapValue: false }))
  out.push(...field("base", `created ${record.base.createdAt}; ${bytesBoth(record.base.allocatedBytes)}; disk sha256 ${shortId(record.base.diskSha256)}`, c))
  out.push(...field("tested", record.testedSource || "unknown", c))
  out.push(...field("skew", record.skew === null ? "unknown" : record.skew ? `true: the guest is ${record.guest?.linked ? "linked to a checkout" : `omarchy ${record.guest?.version}`}, the base was built with ${record.pin.expectedGuestVersion}` : `false: the installed package is the base's ${record.pin.expectedGuestVersion}`, c))
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
  if (record.ok) out.push(...verdict("pass", "PROVED", `${record.suite}: ${record.assertion?.reason || "ok"}; guest omarchy ${record.guest?.version}, skew ${record.skew}${record.behind ? `; Omarchy ${record.newest.release} is out, and \`omakit lab setup\` builds it` : ""}.`, c))
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
  if (!plan.targets.length) return verdict("pass", "NOTHING TO PRUNE", `the lab cache holds ${bytesBoth(plan.remaining.cache)} and every byte of it is in use or kept; run records ${bytesBoth(plan.remaining.runs)} (--records removes them).`, c).join("\n")
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
