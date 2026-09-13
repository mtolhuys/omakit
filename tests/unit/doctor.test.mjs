import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { changedPinPaths, pinFreshness } from "../../tools/marketplace/doctor.mjs"
import { MARKETPLACE_PIN, PIN_PATHS } from "../../tools/marketplace/pin.mjs"
import { requirePinForTests } from "./helpers.mjs"

const pinned = { commit: "1".repeat(40) }

test("freshness JSON carries both full commits without changing the human detail", () => {
  const head = { commit: "2".repeat(40), branch: "main" }
  const check = pinFreshness(pinned, head)

  assert.equal(check.state, "advice")
  assert.match(check.detail, /the pin is 1111111;.*main branch is now at 2222222/)
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

test("a pin that is behind names what moved, not only that something did", () => {
  // Measured 2026-09-13 (docs/MEASUREMENTS.md M7): 4,201 of 4,293 commits in
  // 30 days touched only registry.json, so "behind" alone is true of every
  // run and says nothing about whether the code or the rules moved.
  const head = { commit: "2".repeat(40), branch: "main" }
  const moved = pinFreshness(pinned, head, ["/registry.json", "/site/catalog.json"])
  assert.equal(moved.state, "advice")
  assert.match(moved.detail, /the pin is 1111111;.*main branch is now at 2222222; changed since the pin: \/registry\.json, \/site\/catalog\.json$/)
  assert.deepEqual(moved.evidence.changedPaths, ["/registry.json", "/site/catalog.json"])
  assert.match(moved.action, /docs\/UPSTREAM_CONTRACT\.md has the procedure/, "the remedy line stays what it is")

  const same = pinFreshness(pinned, head, [])
  assert.equal(same.state, "advice")
  assert.match(same.detail, /now at 2222222; every path omakit reads is unchanged since the pin$/)
  assert.deepEqual(same.evidence.changedPaths, [])

  const current = pinFreshness(pinned, { commit: pinned.commit, branch: "main" }, [])
  assert.equal(current.state, "ok")
  assert.deepEqual(current.evidence.changedPaths, [])
})

/** The pin's own object ids, read the way doctor reads them. */
function pinId(pinDir, path) {
  return execFileSync("git", ["-C", pinDir, "rev-parse", `${MARKETPLACE_PIN.commit}:${path}`], { encoding: "utf8" }).trim()
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
