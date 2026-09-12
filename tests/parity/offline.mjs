#!/usr/bin/env node
// Proof that a local marketplace run never touches the network.
//
// `omakit verify` runs inside a network namespace with no interfaces
// (`unshare -rn`) against a subject that is already cached, and must still
// produce the official result. If the local transport ever reached out, this
// fails. Writes its evidence under docs/evidence/offline/<date>-<commit>/.
//
// Why this is a committed proof and not a claim: the whole tool rests on running
// the marketplace's own analysis over a local snapshot. "No network during a
// local run" is the property that makes it a preview instead of a second,
// divergent scanner, so it is demonstrated rather than asserted.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const target = process.argv[2]
if (!target || !/^https:\/\/github\.com\/.+@[0-9a-f]{40}$/.test(target)) {
  console.error("usage: offline.mjs https://github.com/owner/repo@<sha>   (the subject must already be cached)")
  process.exit(2)
}

const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" }).trim().length > 0

const checks = []
const record = (id, ok, detail) => {
  checks.push({ id, result: ok ? "pass" : "fail", detail })
  console.log(`${ok ? "ok" : "not ok"} - ${id}: ${detail}`)
}

// 1. The namespace really has no network. /proc/self/net is the calling
//    process's own namespace view, so it must show only `lo`, and a request to
//    api.github.com must fail from inside it.
const probe = spawnSync("unshare", [
  "-rn", "sh", "-c",
  "awk -F: 'NR>2 { gsub(/ /, \"\", $1); print $1 }' /proc/self/net/dev | paste -sd,; curl -s --max-time 3 https://api.github.com/ >/dev/null 2>&1; echo curl=$?",
], { encoding: "utf8" })
const interfaces = probe.stdout.split("\n")[0] || ""
record(
  "namespace.no-network",
  probe.status === 0 && /curl=[1-9]/.test(probe.stdout) && interfaces === "lo",
  `interfaces in the namespace: ${interfaces}; curl to api.github.com ${probe.stdout.match(/curl=\d+/)?.[0]}`,
)

// 2. verify, inside that namespace.
const run = spawnSync("unshare", ["-rn", join(ROOT, "bin/omakit"), "verify", target], { encoding: "utf8", cwd: ROOT })
let document = null
try {
  document = JSON.parse(run.stdout)
} catch {
  document = null
}
const baseline = document?.marketplaceBaseline

record("verify.exit-zero", run.status === 0, `exit ${run.status}${run.stderr ? ` stderr: ${run.stderr.trim().slice(0, 200)}` : ""}`)
record(
  "verify.official-result",
  Boolean(baseline?.invoked) && typeof baseline?.official?.outcome === "string",
  `outcome ${baseline?.official?.outcome} over ${baseline?.transport}`,
)
record(
  "verify.pin-identity",
  baseline?.pin?.commit === MARKETPLACE_PIN.commit && baseline?.pin?.baselineVersion === MARKETPLACE_PIN.baselineVersion,
  `pin ${baseline?.pin?.commit} baseline ${baseline?.pin?.baselineVersion} ${baseline?.pin?.enforcementMode}`,
)
record(
  "verify.checked-at-pinned",
  baseline?.official?.checkedAt === "1970-01-01T00:00:00.000Z",
  "checkedAt is pinned to the epoch, so two runs of the same commit are byte-identical",
)

const result = checks.every((check) => check.result === "pass") ? "pass" : "fail"
const evidence = {
  schemaVersion: 1,
  scenario: "verify-offline",
  subject: target,
  generator: { omakitCommit: commit, dirtyWorktree: dirty },
  environment: { marketplacePin: MARKETPLACE_PIN.commit, isolation: "unshare -rn" },
  result,
  checks,
}

const date = new Date().toISOString().slice(0, 10)
let out = join(ROOT, "docs/evidence/offline", `${date}-${commit.slice(0, 7)}`)
for (let n = 2; existsSync(out); n += 1) out = join(ROOT, "docs/evidence/offline", `${date}-${commit.slice(0, 7)}-${n}`)
mkdirSync(out, { recursive: true })
writeFileSync(join(out, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
writeFileSync(join(out, "verify-output.json"), run.stdout)
console.log(`${result === "pass" ? "ok" : "not ok"} - evidence ${join(out, "evidence.json")}`)
process.exit(result === "pass" ? 0 : 1)
