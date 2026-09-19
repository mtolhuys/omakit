import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCommit, recordCommit, recordedCommit } from "../../tools/blocks/record-commit.mjs"
import { changedPinPaths, doctor, pinFreshness } from "../../tools/marketplace/doctor.mjs"
import { MARKETPLACE_PIN, PIN_PATHS } from "../../tools/marketplace/pin.mjs"
import { LIVE_PATHS } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinned = { commit: "1".repeat(40) }

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
const issues = "https://github.com/mtolhuys/omakit"

test("only the data files moved, or nothing did: ok, no action, and the detail says they are read live", () => {
  const both = pinFreshness(pinned, head, ["/registry.json", "/site/catalog.json"], { issues })
  assert.equal(both.state, "ok")
  assert.equal(both.action, null)
  assert.equal(both.detail, "pin 1111111; marketplace main at 2222222; only registry.json and site/catalog.json moved, and those are read live")
  assert.deepEqual(both.evidence, {
    pinCommit: pinned.commit, marketplaceHead: head.commit, branch: "main",
    changedPaths: ["/registry.json", "/site/catalog.json"], readLive: ["/registry.json", "/site/catalog.json"], pinned: [],
  })
  assert.deepEqual([...LIVE_PATHS], ["registry.json", "site/catalog.json"], "the split is registry.mjs's list, not a second one")

  const one = pinFreshness(pinned, head, ["/registry.json"], { issues })
  assert.equal(one.state, "ok")
  assert.equal(one.detail, "pin 1111111; marketplace main at 2222222; only registry.json moved, and that is read live")

  const nothing = pinFreshness(pinned, head, [], { issues })
  assert.equal(nothing.state, "ok")
  assert.equal(nothing.action, null)
  assert.equal(nothing.detail, "pin 1111111; marketplace main at 2222222; nothing omakit reads moved")
  assert.deepEqual(nothing.evidence.changedPaths, [])
  assert.deepEqual(nothing.evidence.readLive, [])
  assert.deepEqual(nothing.evidence.pinned, [])

  const current = pinFreshness(pinned, { commit: pinned.commit, branch: "main" }, [], { issues })
  assert.equal(current.state, "ok")
  assert.equal(current.detail, "the pin is the marketplace's current main-branch HEAD")
  assert.deepEqual(current.evidence.changedPaths, [])
})

test("a pinned path moved: note, the paths named, and an action for a user, never the maintainer's procedure", () => {
  const code = pinFreshness(pinned, head, ["/scripts/", "/registry.json"], { issues })
  assert.equal(code.state, "advice")
  assert.equal(code.detail, "pin 1111111; marketplace main at 2222222; changed since the pin: /scripts/ (registry.json moved too, and that is read live)")
  assert.equal(code.action, "A newer omakit may already carry the new pin: run `omakit upgrade`. If it does not, open an issue at https://github.com/mtolhuys/omakit/issues naming the paths above.")
  assert.deepEqual(code.evidence.changedPaths, ["/scripts/", "/registry.json"])
  assert.deepEqual(code.evidence.readLive, ["/registry.json"])
  assert.deepEqual(code.evidence.pinned, ["/scripts/"])
  assert.doesNotMatch(`${code.detail} ${code.action}`, /UPSTREAM_CONTRACT|parity|evidence/, "the procedure is the maintainer's and stays in the docs")

  const forms = pinFreshness(pinned, head, ["/.github/ISSUE_TEMPLATE/"], { issues })
  assert.equal(forms.state, "advice")
  assert.equal(forms.detail, "pin 1111111; marketplace main at 2222222; changed since the pin: /.github/ISSUE_TEMPLATE/")
  assert.deepEqual(forms.evidence.readLive, [])
  assert.deepEqual(forms.evidence.pinned, ["/.github/ISSUE_TEMPLATE/"])

  // Without a repository URL to read, the issue is still asked for, nowhere in particular.
  const nowhere = pinFreshness(pinned, head, ["/scripts/"])
  assert.equal(nowhere.action, "A newer omakit may already carry the new pin: run `omakit upgrade`. If it does not, open an issue naming the paths above.")
})

test("doctor reads the issues URL from package.json and HEAD unreadable stays unknown", async () => {
  // The URL is read, never typed: package.json's repository field is the one home.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  assert.match(pkg.repository.url, /github\.com\/mtolhuys\/omakit/)
  const source = readFileSync(join(REPO_ROOT, "tools/marketplace/doctor.mjs"), "utf8")
  assert.doesNotMatch(source, /github\.com\/mtolhuys/, "doctor.mjs does not type the repository")

  // Unreachable HEAD: unknown, as before, and no paths are named.
  const result = await doctor({ repoRoot: REPO_ROOT, onPhase: () => {}, env: { ...process.env, XDG_CACHE_HOME: undefined }, resolveHead: async () => { throw Object.assign(new Error("no route"), { code: "network-unavailable" }) }, latest: async () => ({ version: null, error: { code: "network-unavailable", message: "no route" } }) })
  const check = result.checks.find((entry) => entry.id === "pin.freshness")
  assert.equal(check.state, "unknown")
  assert.match(check.detail, /could not read the marketplace's HEAD \(network-unavailable\)/)
  assert.deepEqual(check.evidence, { pinCommit: MARKETPLACE_PIN.commit, marketplaceHead: null, branch: null })
})

/** The pin's own object ids, read the way doctor reads them. */
function pinId(pinDir, path) {
  return execFileSync("git", ["-C", pinDir, "rev-parse", `${MARKETPLACE_PIN.commit}:${path}`], { timeout: 120_000, encoding: "utf8" }).trim()
}

test("each path in PIN_PATHS is compared by object id between the pin and HEAD, through the trees API at the exact commit", async () => {
  const pinDir = requirePinForTests()
  const HEAD = "d4321b5b".padEnd(40, "0")
  const OTHER = "f".repeat(40)
  const SITE = "5".repeat(40)
  const GITHUB = "6".repeat(40)
  const urls = []
  // HEAD's trees: scripts and registry.json moved; site/catalog.json and
  // .github/ISSUE_TEMPLATE carry the pin's own ids, so they did not.
  const trees = {
    [HEAD]: [
      { path: "scripts", type: "tree", sha: OTHER },
      { path: "registry.json", type: "blob", sha: OTHER },
      { path: "site", type: "tree", sha: SITE },
      { path: ".github", type: "tree", sha: GITHUB },
      { path: "README.md", type: "blob", sha: OTHER },
    ],
    [SITE]: [{ path: "catalog.json", type: "blob", sha: pinId(pinDir, "site/catalog.json") }],
    [GITHUB]: [{ path: "ISSUE_TEMPLATE", type: "tree", sha: pinId(pinDir, ".github/ISSUE_TEMPLATE") }, { path: "workflows", type: "tree", sha: OTHER }],
  }
  const fetchJson = async (url) => {
    urls.push(url)
    const sha = url.split("/git/trees/")[1]
    assert.ok(trees[sha], `read an unexpected tree: ${url}`)
    return { sha, tree: trees[sha], truncated: false }
  }

  const changed = await changedPinPaths({ pinDir, headCommit: HEAD, fetchJson })
  assert.deepEqual(changed, ["/scripts/", "/registry.json"])
  assert.deepEqual(urls, [
    `https://api.github.com/repos/omacom/omarchy-plugin-marketplace/git/trees/${HEAD}`,
    `https://api.github.com/repos/omacom/omarchy-plugin-marketplace/git/trees/${SITE}`,
    `https://api.github.com/repos/omacom/omarchy-plugin-marketplace/git/trees/${GITHUB}`,
  ], "one read per tree on the way, at the exact commit, never at a branch")
  assert.ok(changed.every((path) => PIN_PATHS.includes(path)))

  // HEAD identical to the pin in every path omakit reads: nothing moved.
  const same = Object.fromEntries(PIN_PATHS.map((pattern) => [pattern, pattern.replace(/^\/|\/$/g, "")]))
  const identical = {
    [HEAD]: [
      { path: "scripts", type: "tree", sha: pinId(pinDir, same["/scripts/"]) },
      { path: "registry.json", type: "blob", sha: pinId(pinDir, same["/registry.json"]) },
      { path: "site", type: "tree", sha: SITE },
      { path: ".github", type: "tree", sha: GITHUB },
    ],
    [SITE]: trees[SITE],
    [GITHUB]: trees[GITHUB],
  }
  assert.deepEqual(await changedPinPaths({ pinDir, headCommit: HEAD, fetchJson: async (url) => ({ tree: identical[url.split("/git/trees/")[1]] }) }), [])

  // A path that HEAD no longer has counts as changed, and a HEAD that does not
  // read as a tree is an error for doctor to report as unknown.
  const gone = { ...identical, [SITE]: [] }
  assert.deepEqual(await changedPinPaths({ pinDir, headCommit: HEAD, fetchJson: async (url) => ({ tree: gone[url.split("/git/trees/")[1]] }) }), ["/site/catalog.json"])
  await assert.rejects(() => changedPinPaths({ pinDir, headCommit: HEAD, fetchJson: async () => ({ message: "Not Found" }) }), /did not read as a tree/)
  await assert.rejects(() => changedPinPaths({ pinDir, headCommit: HEAD, fetchJson: async () => { throw Object.assign(new Error("no"), { code: "network-unavailable" }) } }), /no/)
})

// --- one version check ----------------------------------------------------------
// Measured on 0.1.8: `omakit.version` said "omakit 0.1.8" as information and
// `omakit.latest` said "0.1.8 is the newest published version" six lines
// later; one question, two answers. Now it is one check with both facts.

const REGISTRY = "https://registry.npmjs.org"
const installed = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version
const quiet = { onPhase: () => {}, env: { ...process.env }, resolveHead: async () => ({ commit: MARKETPLACE_PIN.commit, branch: "main" }) }
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
