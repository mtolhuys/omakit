import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCommit, recordCommit, recordedCommit } from "../../tools/blocks/record-commit.mjs"
import { comparePin, doctor, pinFreshness } from "../../tools/marketplace/doctor.mjs"
import { MARKETPLACE_PIN, PIN_PATHS, POLICY_MODULE, pinnedReadSet } from "../../tools/marketplace/pin.mjs"
import { LIVE_PATHS } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinned = { commit: "1".repeat(40), baselineVersion: "3", enforcementMode: "selective" }


/** The lab's read of Omarchy's release list, answered without the network: no test here reaches it. */
const unreadReleases = async () => ({ checked: false, code: "network-unavailable", reason: "not read in tests" })

test("freshness JSON carries both full commits without changing the human detail", () => {
  const head = { commit: "2".repeat(40), branch: "main" }
  const check = pinFreshness(pinned, head)

  assert.equal(check.state, "advice", "HEAD moved and the paths were not compared, so it cannot say the pin is fine")
  assert.match(check.detail, /^pin 1111111; marketplace main at 2222222; the paths omakit reads were not compared$/)
  assert.deepEqual(check.evidence, {
    pinCommit: "1".repeat(40),
    marketplaceHead: "2".repeat(40),
    branch: "main",
  })
  assert.doesNotMatch(check.detail, /1{40}|2{40}/)
})

test("a current pin is explicit machine evidence", () => {
  const check = pinFreshness(pinned, { commit: pinned.commit, branch: null })

  assert.equal(check.state, "ok")
  assert.equal(check.action, null)
  assert.deepEqual(check.evidence, {
    pinCommit: pinned.commit,
    marketplaceHead: pinned.commit,
    branch: "default",
  })
})

// --- what moved, split by what omakit reads live ------------------------------
// Measured on 0.1.7: with only /registry.json and /site/catalog.json changed
// since the pin, doctor printed `▓ note pin.freshness` and pointed a user at
// docs/UPSTREAM_CONTRACT.md, a file the npm package does not ship. Those two
// files are read live from HEAD (registry.mjs LIVE_PATHS), so the pin was
// behind in nothing the tool uses. The split below uses that same list.

const head = { commit: "2".repeat(40), branch: "main" }
const same = { baselineVersion: "3", enforcementMode: "selective" }
/** A comparePin() answer: nothing moved unless said. */
const compared = (changedPaths = [], extra = {}) => ({ changedPaths, reads: 16, moved: [], missing: [], policyAtHead: null, ...extra })

test("only the data files moved, or nothing did: ok, no action, and the detail says they are read live", () => {
  const both = pinFreshness(pinned, head, compared(["/registry.json", "/site/catalog.json"]))
  assert.equal(both.state, "ok")
  assert.equal(both.action, null)
  assert.equal(both.detail, "pin 1111111; marketplace main at 2222222; only registry.json and site/catalog.json moved, and those are read live")
  assert.deepEqual(both.evidence, {
    pinCommit: pinned.commit, marketplaceHead: head.commit, branch: "main",
    changedPaths: ["/registry.json", "/site/catalog.json"], readLive: ["/registry.json", "/site/catalog.json"], pinned: [],
    reads: 16, moved: [], verdictMoved: [], missing: [], policy: { pin: same, head: same },
  })
  assert.deepEqual([...LIVE_PATHS], ["registry.json", "site/catalog.json"], "the split is registry.mjs's list, not a second one")

  const one = pinFreshness(pinned, head, compared(["/registry.json"]))
  assert.equal(one.state, "ok")
  assert.equal(one.detail, "pin 1111111; marketplace main at 2222222; only registry.json moved, and that is read live")

  const nothing = pinFreshness(pinned, head, compared())
  assert.equal(nothing.state, "ok")
  assert.equal(nothing.action, null)
  assert.equal(nothing.detail, "pin 1111111; marketplace main at 2222222; nothing omakit reads moved")
  assert.deepEqual(nothing.evidence.changedPaths, [])
  assert.deepEqual(nothing.evidence.readLive, [])
  assert.deepEqual(nothing.evidence.pinned, [])

  const current = pinFreshness(pinned, { commit: pinned.commit, branch: "main" }, compared())
  assert.equal(current.state, "ok")
  assert.equal(current.detail, "the pin is the marketplace's current main-branch HEAD")
  assert.deepEqual(current.evidence.changedPaths, [])
})

// --- graded by what the difference can do to a verdict ---------------------------
// Measured on 2026-09-21 (docs/MEASUREMENTS.md M7): of the three marketplace
// commits that touched scripts/ since the first pin 38060f89, 5e401552
// changed only repository-identity.mjs, which nothing omakit reads reaches,
// and the tree comparison graded it advice; the pin moved for a verdict
// that could not change. Under scripts/ the comparison is now by blob over
// the files pinnedReadSet() names, and the grade says what the difference
// can do: ok, info (verdicts unchanged), advice (a verdict may differ).

test("scripts/ moved in a file omakit does not read: ok, and the detail says how many it does read", () => {
  const outside = pinFreshness(pinned, head, compared(["/scripts/", "/registry.json"]))
  assert.equal(outside.state, "ok")
  assert.equal(outside.action, null)
  assert.equal(outside.detail, "pin 1111111; marketplace main at 2222222; scripts/ moved in none of the 16 files omakit reads (registry.json moved too, and that is read live)")
  assert.deepEqual(outside.evidence.pinned, ["/scripts/"], "the tree-level answer stays in the evidence")
  assert.deepEqual(outside.evidence.moved, [])
})

test("only wording files moved: info, the files named as wording only, what omakit decides cannot differ, nothing to do", () => {
  const moved = pinFreshness(pinned, head, compared(["/scripts/"], { moved: ["scripts/approve-submission.mjs", "scripts/submission-feedback.mjs"] }))
  assert.equal(moved.state, "info")
  assert.equal(moved.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/approve-submission.mjs and scripts/submission-feedback.mjs (wording and labels only); baseline 3 (selective) at both")
  assert.equal(moved.action, "Those files are read for wording and labels, not for a pass or a refusal; what omakit prints may differ at HEAD, what it decides cannot. A newer omakit will carry the pin; nothing to do.")
  assert.deepEqual(moved.evidence.moved, ["scripts/approve-submission.mjs", "scripts/submission-feedback.mjs"])
  assert.deepEqual(moved.evidence.verdictMoved, [])
  assert.deepEqual(moved.evidence.policy, { pin: same, head: same })
  assert.doesNotMatch(`${moved.detail} ${moved.action}`, /issue|UPSTREAM_CONTRACT|parity|evidence|verdicts are unchanged/i, "no issue to open, and no claim beyond what was measured")

  const one = pinFreshness(pinned, head, compared(["/scripts/", "/registry.json"], { moved: ["scripts/security-baseline-report.mjs"] }))
  assert.equal(one.state, "info")
  assert.match(one.action, /^That file is read for wording and labels/)
  assert.equal(one.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/security-baseline-report.mjs (wording and labels only); baseline 3 (selective) at both (registry.json moved too, and that is read live)")
})

test("a file omakit executes or reads a rule from moved: advice, even with both policy constants the same, since a rule can change without its version", () => {
  // 40315f2 as measured: the policy module gained a function, its two
  // constants unchanged. The baseline it exports may still differ.
  const policy = pinFreshness(pinned, head, compared(["/scripts/", "/registry.json"], { moved: [POLICY_MODULE], policyAtHead: { ...same } }))
  assert.equal(policy.state, "advice")
  assert.equal(policy.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/security-baseline-policy.mjs; baseline 3 (selective) at both (registry.json moved too, and that is read live)")
  assert.equal(policy.action, "The maintainer is notified by the weekly pin-freshness run; a newer omakit will carry the pin. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts.")
  assert.deepEqual(policy.evidence.verdictMoved, [POLICY_MODULE])

  // A wording file and a parser moved together: the parser decides the grade.
  const mixed = pinFreshness(pinned, head, compared(["/scripts/"], { moved: ["scripts/github-repository.mjs", "scripts/submission-feedback.mjs"] }))
  assert.equal(mixed.state, "advice")
  assert.equal(mixed.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/github-repository.mjs and scripts/submission-feedback.mjs; baseline 3 (selective) at both")
  assert.deepEqual(mixed.evidence.verdictMoved, ["scripts/github-repository.mjs"])
})

test("a policy constant differs, a read file is gone, or the form moved: advice, and the action is upgrade or that the maintainer is notified", () => {
  const version = pinFreshness(pinned, head, compared(["/scripts/"], { moved: [POLICY_MODULE], policyAtHead: { baselineVersion: "4", enforcementMode: "selective" } }))
  assert.equal(version.state, "advice")
  assert.equal(version.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/security-baseline-policy.mjs; baseline 3 (selective) at the pin, baseline 4 (selective) at HEAD")
  assert.equal(version.action, "The maintainer is notified by the weekly pin-freshness run; a newer omakit will carry the pin. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts.")
  assert.deepEqual(version.evidence.policy, { pin: same, head: { baselineVersion: "4", enforcementMode: "selective" } })

  const mode = pinFreshness(pinned, head, compared(["/scripts/"], { moved: [POLICY_MODULE], policyAtHead: { baselineVersion: "3", enforcementMode: "strict" } }))
  assert.equal(mode.state, "advice")
  assert.match(mode.detail, /baseline 3 \(selective\) at the pin, baseline 3 \(strict\) at HEAD$/)

  const gone = pinFreshness(pinned, head, compared(["/scripts/"], { missing: ["scripts/submission-feedback.mjs"] }))
  assert.equal(gone.state, "advice")
  assert.equal(gone.detail, "pin 1111111; marketplace main at 2222222; gone at HEAD: scripts/submission-feedback.mjs; baseline 3 (selective) at both")
  assert.deepEqual(gone.evidence.missing, ["scripts/submission-feedback.mjs"])

  const forms = pinFreshness(pinned, head, compared(["/.github/ISSUE_TEMPLATE/"]))
  assert.equal(forms.state, "advice")
  assert.equal(forms.detail, "pin 1111111; marketplace main at 2222222; the form moved (.github/ISSUE_TEMPLATE/); baseline 3 (selective) at both")
  assert.deepEqual(forms.evidence.readLive, [])
  assert.deepEqual(forms.evidence.pinned, ["/.github/ISSUE_TEMPLATE/"])

  // 70dcc454 against 38060f89 as measured: submission.mjs and the policy
  // module moved, the form moved, the constants read the same. Advice, for
  // the form; and with a newer omakit published, the action is the upgrade.
  const upgrade = pinFreshness(pinned, head, compared(["/scripts/", "/registry.json", "/site/catalog.json", "/.github/ISSUE_TEMPLATE/"], { moved: [POLICY_MODULE, "scripts/submission.mjs"], policyAtHead: { ...same } }), { upgrade: "omakit upgrade" })
  assert.equal(upgrade.state, "advice")
  assert.equal(upgrade.detail, "pin 1111111; marketplace main at 2222222; moved since the pin: scripts/security-baseline-policy.mjs and scripts/submission.mjs; the form moved (.github/ISSUE_TEMPLATE/); baseline 3 (selective) at both (registry.json and site/catalog.json moved too, and those are read live)")
  assert.equal(upgrade.action, "A newer omakit is published and may carry the pin: run `omakit upgrade`. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts.")
  for (const check of [version, mode, gone, forms, upgrade]) {
    assert.doesNotMatch(`${check.detail} ${check.action}`, /open an issue|UPSTREAM_CONTRACT|parity|evidence/, "no issue to open: the weekly run opens the one there is")
  }
})

test("doctor passes the upgrade it found to pin.freshness, and HEAD unreadable stays unknown", async () => {
  const source = readFileSync(join(REPO_ROOT, "tools/marketplace/doctor.mjs"), "utf8")
  assert.doesNotMatch(source, /github\.com\/mtolhuys/, "doctor.mjs does not type the repository")
  assert.doesNotMatch(source, /open an issue/i, "doctor never asks a user to open an issue; pin-freshness.yml does that")

  // The form moved and 9.9.9 is published: the version check's upgrade
  // command is pin.freshness's action too. With nothing newer, the
  // maintainer is named instead.
  const freshness = async (latest) => (await doctor({
    repoRoot: REPO_ROOT, onPhase: () => {}, env: { ...process.env },
    resolveHead: async () => ({ commit: "2".repeat(40), branch: "main" }),
    compare: async () => compared(["/.github/ISSUE_TEMPLATE/"]),
    newestRelease: unreadReleases,
    latest: async () => ({ version: latest, error: null }),
  })).checks.find((entry) => entry.id === "pin.freshness")
  const newer = await freshness("9.9.9")
  assert.equal(newer.state, "advice")
  assert.equal(newer.action, "A newer omakit is published and may carry the pin: run `omakit upgrade`. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts.")
  const newest = await freshness(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version)
  assert.equal(newest.state, "advice")
  assert.match(newest.action, /^The maintainer is notified by the weekly pin-freshness run/)

  // Unreachable HEAD: unknown, as before, and no paths are named.
  const result = await doctor({ repoRoot: REPO_ROOT, onPhase: () => {}, env: { ...process.env, XDG_CACHE_HOME: undefined }, resolveHead: async () => { throw Object.assign(new Error("no route"), { code: "network-unavailable" }) }, latest: async () => ({ version: null, error: { code: "network-unavailable", message: "no route" } }), newestRelease: unreadReleases })
  const check = result.checks.find((entry) => entry.id === "pin.freshness")
  assert.equal(check.state, "unknown")
  assert.match(check.detail, /could not read the marketplace's HEAD \(network-unavailable\)/)
  assert.deepEqual(check.evidence, { pinCommit: MARKETPLACE_PIN.commit, marketplaceHead: null, branch: null })
})

/** The pin's own object ids, read the way doctor reads them. */
function pinId(pinDir, path) {
  return execFileSync("git", ["-C", pinDir, "rev-parse", `${MARKETPLACE_PIN.commit}:${path}`], { timeout: 120_000, encoding: "utf8" }).trim()
}

test("each path in PIN_PATHS is compared by object id, and each file omakit reads by blob id, through the trees API at the exact commit", async () => {
  const pinDir = requirePinForTests()
  const reads = pinnedReadSet(pinDir)
  const HEAD = "d4321b5b".padEnd(40, "0")
  const OTHER = "f".repeat(40)
  const SCRIPTS = "4".repeat(40)
  const SITE = "5".repeat(40)
  const GITHUB = "6".repeat(40)
  const API = "https://api.github.com/repos/omacom/omarchy-plugin-marketplace/git/trees"
  const RAW = "https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace"
  const urls = []
  // HEAD's trees: scripts and registry.json moved; site/catalog.json and
  // .github/ISSUE_TEMPLATE carry the pin's own ids, so they did not. Under
  // scripts/, submission.mjs and the policy module carry other blobs,
  // submission-feedback.mjs is gone, and every other read file is the pin's.
  const scripts = reads
    .filter((read) => read.path !== "scripts/submission-feedback.mjs")
    .map((read) => ({ path: read.path.slice("scripts/".length), type: "blob", sha: ["scripts/submission.mjs", POLICY_MODULE].includes(read.path) ? OTHER : pinId(pinDir, read.path) }))
  const trees = {
    [HEAD]: [
      { path: "scripts", type: "tree", sha: SCRIPTS },
      { path: "registry.json", type: "blob", sha: OTHER },
      { path: "site", type: "tree", sha: SITE },
      { path: ".github", type: "tree", sha: GITHUB },
      { path: "README.md", type: "blob", sha: OTHER },
    ],
    [SCRIPTS]: [...scripts, { path: "repository-identity.mjs", type: "blob", sha: OTHER }],
    [SITE]: [{ path: "catalog.json", type: "blob", sha: pinId(pinDir, "site/catalog.json") }],
    [GITHUB]: [{ path: "ISSUE_TEMPLATE", type: "tree", sha: pinId(pinDir, ".github/ISSUE_TEMPLATE") }, { path: "workflows", type: "tree", sha: OTHER }],
  }
  const fetchJson = async (url) => {
    urls.push(url)
    const sha = url.split("/git/trees/")[1]
    assert.ok(trees[sha], `read an unexpected tree: ${url}`)
    return { sha, tree: trees[sha], truncated: false }
  }
  const fetchText = async (url) => {
    urls.push(url)
    return 'export const securityBaselineVersion = 4;\nexport const securityBaselineEnforcementMode = "selective";\n'
  }

  const result = await comparePin({ pinDir, headCommit: HEAD, fetchJson, fetchText })
  assert.deepEqual(result, {
    changedPaths: ["/scripts/", "/registry.json"],
    reads: 16,
    moved: [POLICY_MODULE, "scripts/submission.mjs"],
    missing: ["scripts/submission-feedback.mjs"],
    policyAtHead: { baselineVersion: "4", enforcementMode: "selective" },
  })
  assert.deepEqual(urls, [
    `${API}/${HEAD}`,
    `${API}/${SITE}`,
    `${API}/${GITHUB}`,
    `${API}/${SCRIPTS}`,
    `${RAW}/${HEAD}/${POLICY_MODULE}`,
  ], "one read per tree on the way, the scripts tree once its id moved, the policy text once its blob moved; at the exact commit, never at a branch")
  assert.ok(result.changedPaths.every((path) => PIN_PATHS.includes(path)))

  // The scripts tree moved in a file omakit does not read: one more tree
  // read, no blob moved, no text read.
  const sameBlobs = { ...trees, [SCRIPTS]: [...reads.map((read) => ({ path: read.path.slice("scripts/".length), type: "blob", sha: pinId(pinDir, read.path) })), { path: "repository-identity.mjs", type: "blob", sha: OTHER }] }
  urls.length = 0
  const outside = await comparePin({ pinDir, headCommit: HEAD, fetchJson: async (url) => { urls.push(url); return { tree: sameBlobs[url.split("/git/trees/")[1]] } }, fetchText: async () => { throw new Error("no policy read when its blob is the pin's") } })
  assert.deepEqual(outside, { changedPaths: ["/scripts/", "/registry.json"], reads: 16, moved: [], missing: [], policyAtHead: null })
  assert.equal(urls.length, 4)

  // HEAD identical to the pin in every path omakit reads: nothing moved, and
  // the scripts tree is not read at all.
  const asPath = Object.fromEntries(PIN_PATHS.map((pattern) => [pattern, pattern.replace(/^\/|\/$/g, "")]))
  const identical = {
    [HEAD]: [
      { path: "scripts", type: "tree", sha: pinId(pinDir, asPath["/scripts/"]) },
      { path: "registry.json", type: "blob", sha: pinId(pinDir, asPath["/registry.json"]) },
      { path: "site", type: "tree", sha: SITE },
      { path: ".github", type: "tree", sha: GITHUB },
    ],
    [SITE]: trees[SITE],
    [GITHUB]: trees[GITHUB],
  }
  urls.length = 0
  assert.deepEqual(await comparePin({ pinDir, headCommit: HEAD, fetchJson: async (url) => { urls.push(url); return { tree: identical[url.split("/git/trees/")[1]] } } }), { changedPaths: [], reads: 16, moved: [], missing: [], policyAtHead: null })
  assert.equal(urls.length, 3, "three reads for PIN_PATHS as it stands")

  // A path that HEAD no longer has counts as changed, and a HEAD that does not
  // read as a tree is an error for doctor to report as unknown.
  const gone = { ...identical, [SITE]: [] }
  assert.deepEqual((await comparePin({ pinDir, headCommit: HEAD, fetchJson: async (url) => ({ tree: gone[url.split("/git/trees/")[1]] }) })).changedPaths, ["/site/catalog.json"])
  await assert.rejects(() => comparePin({ pinDir, headCommit: HEAD, fetchJson: async () => ({ message: "Not Found" }) }), /did not read as a tree/)
  await assert.rejects(() => comparePin({ pinDir, headCommit: HEAD, fetchJson: async () => { throw Object.assign(new Error("no"), { code: "network-unavailable" }) } }), /no/)
})

// --- one version check ----------------------------------------------------------
// Measured on 0.1.8: `omakit.version` said "omakit 0.1.8" as information and
// `omakit.latest` said "0.1.8 is the newest published version" six lines
// later; one question, two answers. Now it is one check with both facts.

const REGISTRY = "https://registry.npmjs.org"
const installed = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version
const quiet = { onPhase: () => {}, env: { ...process.env }, resolveHead: async () => ({ commit: MARKETPLACE_PIN.commit, branch: "main" }), newestRelease: unreadReleases }
const versionCheck = async (latest) => (await doctor({ repoRoot: REPO_ROOT, ...quiet, latest })).checks.find((check) => check.id === "omakit.version")

test("omakit.source: a checkout names HEAD, a stamped package names its record, an unstamped package is advice that names the release step", async () => {
  const checks = (await doctor({ repoRoot: REPO_ROOT, ...quiet, offline: true })).checks
  const source = checks.find((check) => check.id === "omakit.source")
  const checkoutHead = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  const head = checkoutHead.status === 0 ? checkoutHead.stdout.trim() : recordedCommit(REPO_ROOT)
  assert.equal(source.state, "ok")
  if (checkoutHead.status === 0) {
    assert.equal(source.detail, `a checkout at ${head.slice(0, 7)}; add stamps that commit`)
    assert.deepEqual(source.evidence, { origin: "checkout", commit: head })
  } else {
    assert.equal(source.detail, `a package the release step stamped with commit ${head.slice(0, 7)}; add stamps that commit`)
    assert.deepEqual(source.evidence, { origin: "package", commit: head })
  }
  // A package: bin, tools and package.json with no .git; unstamped first, then stamped.
  const root = mkdtempSync(join(tmpdir(), "omakit-doctor-source-"))
  try {
    for (const entry of ["bin", "tools", "package.json"]) cpSync(join(REPO_ROOT, entry), join(root, entry), { recursive: true })
    clearCommit(root)
    const unstamped = (await doctor({ repoRoot: root, ...quiet, offline: true })).checks.find((check) => check.id === "omakit.source")
    assert.equal(unstamped.state, "advice")
    assert.match(unstamped.detail, /packed without the release step: it names no source commit, so `omakit add` refuses/)
    assert.match(unstamped.action, /npm run pack:release/)
    assert.deepEqual(unstamped.evidence, { origin: "unstamped", commit: null })
    recordCommit(root, head)
    const stamped = (await doctor({ repoRoot: root, ...quiet, offline: true })).checks.find((check) => check.id === "omakit.source")
    assert.equal(stamped.state, "ok")
    assert.equal(stamped.detail, `a package the release step stamped with commit ${head.slice(0, 7)}; add stamps that commit`)
    assert.deepEqual(stamped.evidence, { origin: "package", commit: head })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("omakit.version: current and newest is ok, behind is a note with the upgrade, unreachable is unknown, and both facts are in the JSON", async () => {
  const current = await versionCheck(async () => ({ version: installed, error: null }))
  assert.equal(current.state, "ok")
  assert.equal(current.detail, `${installed}, the newest published version`)
  assert.equal(current.action, null)
  assert.deepEqual(current.evidence, { installed, latest: installed, source: REGISTRY })

  const behind = await versionCheck(async () => ({ version: "9.9.9", error: null }))
  assert.equal(behind.state, "advice")
  assert.equal(behind.detail, `${installed}; 9.9.9 is published`)
  assert.equal(behind.action, "run `omakit upgrade`")
  assert.deepEqual(behind.evidence, { installed, latest: "9.9.9", source: REGISTRY })

  const ahead = await versionCheck(async () => ({ version: "0.0.1", error: null }))
  assert.equal(ahead.state, "ok")
  assert.match(ahead.detail, /ahead of the newest published version 0\.0\.1/)
  assert.equal(ahead.action, null)

  const unreachable = await versionCheck(async () => ({ version: null, error: { code: "network-unavailable", message: "no route" } }))
  assert.equal(unreachable.state, "unknown")
  assert.equal(unreachable.detail, `${installed}; could not read the npm registry (network-unavailable)`)
  assert.equal(unreachable.action, null)
  assert.deepEqual(unreachable.evidence, { installed, latest: null, source: null })

  const offline = (await doctor({ repoRoot: REPO_ROOT, ...quiet, offline: true, latest: async () => { throw new Error("must not read the registry offline") } })).checks
  assert.equal(offline[0].id, "omakit.version", "first, offline or not")
  assert.equal(offline[0].state, "info")
  assert.equal(offline[0].detail, `${installed}; the newest published version is not checked (--offline)`)
  assert.deepEqual(offline[0].evidence, { installed, latest: null, source: null })
  assert.ok(!offline.some((check) => check.id === "omakit.latest"), "there is no second version check")
})

test("the registry read keeps the failure code for doctor, and upgrade still gets only the version", async () => {
  // The GET call site's own code, not a guess: an unpublished name is
  // not-found, no network is network-unavailable.
  const { registryLatest, latestOnRegistry } = await import("../../tools/marketplace/upgrade.mjs")
  assert.equal(typeof registryLatest, "function")
  assert.equal(typeof latestOnRegistry, "function")
  const source = readFileSync(join(REPO_ROOT, "tools/marketplace/upgrade.mjs"), "utf8")
  assert.match(source, /return \(await registryLatest\(name\)\)\.version/, "one read, two callers")
})

test("blocks.python: the blocks' interpreter is checked at /usr/bin/python3, the absolute path Run.qml starts, as advice when absent", async () => {
  // Measured: a stock Omarchy 4.0.3 has /usr/bin/python3 as a dependency of
  // its desktop packages, and Run.qml reports python-missing without it;
  // nothing omakit itself runs needs it, so an absent one is advice.
  const report = await doctor({ repoRoot: REPO_ROOT, ...quiet, offline: true })
  const row = report.checks.find((check) => check.id === "blocks.python")
  assert.ok(row, "the row is there")
  const ids = report.checks.map((check) => check.id)
  assert.ok(ids.indexOf("blocks.python") > ids.indexOf("git"), "after git, before the pin")
  assert.ok(ids.indexOf("blocks.python") < ids.indexOf("pin.checkout"))
  if (existsSync("/usr/bin/python3")) {
    assert.equal(row.state, "ok")
    assert.match(row.detail, /^Python 3\.\d+\.\d+ at \/usr\/bin\/python3, where the Run and Store blocks start it$/)
    assert.equal(row.action, null)
  } else {
    assert.equal(row.state, "advice")
    assert.match(row.detail, /python-missing/)
    assert.match(row.action, /absolute path/)
  }
})
