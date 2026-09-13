// Live registry data, pinned code.
//
// Measured on 2026-09-13 (docs/MEASUREMENTS.md M7): registry.json changed in
// 4,201 of the marketplace's 4,293 commits in the preceding 30 days, about 140
// a day, while the eleven files omakit reads rules and code from changed 1 to 8
// times each. So the registry and the catalog are read from the marketplace's
// current HEAD when the network is there, and everything else stays pinned.
// These tests drive that split with an injected HEAD resolver and an injected
// GET, and prove that the pinned checkout is never written to on the way.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CATALOG_PATH, LIVE_PATHS, REGISTRY_PATH, RegistryError, idUniverse, listingOf, liveCacheDir, liveFileUrl, liveRegistry, registrySourceDetail, sameRepository,
} from "../../tools/marketplace/registry.mjs"
import { SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE } from "../../tools/marketplace/form.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { submitPreflight } from "../../tools/marketplace/submit.mjs"
import { materialise, GOOD } from "../fixtures/plugins.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const HEAD = "d4321b5b".padEnd(40, "0")
const NEWER = "e5432c6c".padEnd(40, "0")
const RAW = "https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace"

/**
 * A registry and catalog that list one id and one repository the pin does
 * not: the fixture's id is taken by another repository, and the fixture's
 * own repository is listed with nothing under it.
 */
const OTHER = "https://github.com/example/omarchy-plugin-fixture-other"
const LIVE = {
  [REGISTRY_PATH]: {
    sources: [
      { repo: "https://github.com/example/omarchy-plugin-fixture-good", plugins: {} },
      { repo: OTHER, plugins: { "omakit-fixture.good": {} } },
    ],
    retiredPluginIds: ["omakit-fixture.retired"],
  },
  [CATALOG_PATH]: { plugins: [{ id: "omakit-fixture.good", repo: OTHER }] },
}

/** The fixture's own listing at HEAD, verified at `commit`, as the catalog records one. */
function ownListing(commit) {
  return {
    [REGISTRY_PATH]: {
      sources: [{ repo: "https://github.com/Example/omarchy-plugin-fixture-good.git", addedAt: "2026-08-31", listingValidatedCommit: commit, plugins: { "omakit-fixture.good": {} } }],
      retiredPluginIds: [],
    },
    [CATALOG_PATH]: {
      plugins: [{
        id: "omakit-fixture.good",
        repo: "https://github.com/Example/omarchy-plugin-fixture-good.git",
        addedAt: "2026-08-31",
        verificationCommit: commit,
        verificationStatus: "verified",
        verificationCheckedAt: "2026-09-10T17:40:18.858Z",
      }],
    },
  }
}

function fakes({ commit = HEAD, files = LIVE, fail = null } = {}) {
  const urls = []
  return {
    urls,
    resolveHead: async () => {
      if (fail === "head") throw Object.assign(new Error("api.github.com did not answer (EAI_AGAIN) while reading /repos/omacom/omarchy-plugin-marketplace/commits.atom"), { code: "network-unavailable" })
      return { commit, branch: "main" }
    },
    fetchJson: async (url) => {
      urls.push(url)
      if (fail === "fetch") throw Object.assign(new Error(`GET ${url} returned 503`), { code: "github-unavailable" })
      const path = LIVE_PATHS.find((candidate) => url.endsWith(`/${commit}/${candidate}`))
      assert.ok(path, `fetched an unexpected URL: ${url}`)
      return files[path]
    },
  }
}

const pinStatus = () => execFileSync("git", ["-C", pinDir, "status", "--porcelain"], { encoding: "utf8" }).trim()

test("the two live files are read from HEAD at the exact commit, cached beside the pin, and the pin is untouched", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "omakit-registry-"))
  const before = pinStatus()
  const { urls, resolveHead, fetchJson } = fakes()
  const live = await liveRegistry({ pinDir, cacheRoot, resolveHead, fetchJson, now: () => "2026-09-13T15:00:00.000Z" })

  assert.equal(live.source, "head")
  assert.equal(live.commit, HEAD)
  assert.equal(live.fetchedAt, "2026-09-13T15:00:00.000Z")
  assert.equal(live.reason, null)
  assert.deepEqual(urls, [`${RAW}/${HEAD}/registry.json`, `${RAW}/${HEAD}/site/catalog.json`])
  assert.deepEqual(live.registry, LIVE[REGISTRY_PATH])
  assert.deepEqual(live.catalog, LIVE[CATALOG_PATH])

  const dir = liveCacheDir(HEAD, cacheRoot)
  assert.ok(existsSync(join(dir, "registry.json")) && existsSync(join(dir, "site/catalog.json")), "both files are cached")
  assert.equal(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).fetchedAt, live.fetchedAt)
  assert.ok(!existsSync(join(pinDir, "registry", HEAD)), "nothing was written into the pinned checkout")
  assert.equal(pinStatus(), before, "requirePin's modified-checkout refusal still holds")

  // The universe built from it sees what HEAD lists and what the pin does not.
  const universe = idUniverse({ pinDir, registry: live.registry, catalog: live.catalog })
  assert.ok(universe.listedIds.has("omakit-fixture.good"))
  assert.ok(universe.retiredIds.has("omakit-fixture.retired"))
  assert.ok(universe.listedRepositories.has("example/omarchy-plugin-fixture-good"))
  assert.ok(!idUniverse({ pinDir }).listedIds.has("omakit-fixture.good"), "the pin does not list the fixture")
})

test("a cached commit is not fetched again, and an older commit's cache is dropped when a newer one lands", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "omakit-registry-"))
  const first = fakes()
  const one = await liveRegistry({ pinDir, cacheRoot, ...first, now: () => "2026-09-13T15:00:00.000Z" })
  const again = await liveRegistry({ pinDir, cacheRoot, resolveHead: first.resolveHead, fetchJson: async () => { throw new Error("must not fetch") }, now: () => "2026-09-13T16:00:00.000Z" })
  assert.equal(again.source, "head")
  assert.equal(again.commit, one.commit)
  assert.equal(again.fetchedAt, one.fetchedAt, "the time reported is when the files were actually read")
  assert.deepEqual(again.registry, LIVE[REGISTRY_PATH])

  // meta.json is written last, so a directory without it is a run that died
  // mid-write, and is read again rather than trusted.
  rmSync(join(liveCacheDir(HEAD, cacheRoot), "meta.json"))
  const refetched = fakes()
  await liveRegistry({ pinDir, cacheRoot, ...refetched })
  assert.equal(refetched.urls.length, 2, "a partial cache is refetched")

  const newer = fakes({ commit: NEWER })
  await liveRegistry({ pinDir, cacheRoot, ...newer })
  assert.ok(existsSync(liveCacheDir(NEWER, cacheRoot)))
  assert.ok(!existsSync(liveCacheDir(HEAD, cacheRoot)), "one commit is kept, at 13 MB a run")
})

test("--offline reads the pin and says so; a HEAD that cannot be read falls back to the pin and never throws", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "omakit-registry-"))
  const pinned = JSON.parse(readFileSync(join(pinDir, REGISTRY_PATH), "utf8"))

  const offline = await liveRegistry({ pinDir, cacheRoot, offline: true, ...fakes() })
  assert.equal(offline.source, "pin")
  assert.equal(offline.commit, MARKETPLACE_PIN.commit)
  assert.equal(offline.fetchedAt, null)
  assert.equal(offline.reason, "--offline")
  assert.equal(offline.registry.sources.length, pinned.sources.length)
  assert.equal(registrySourceDetail(offline), "registry at the pin 38060f89 (offline)")

  // The JSON keeps the whole story; the rendered detail is one clause, with
  // the transport's own parenthetical and its "while reading" tail replaced
  // by the failure code. Measured before this: the full text nested three
  // sets of parentheses and wrapped to three lines at 80 columns.
  const noHead = await liveRegistry({ pinDir, cacheRoot, ...fakes({ fail: "head" }) })
  assert.equal(noHead.source, "pin")
  assert.equal(noHead.reason, "HEAD unreadable (network-unavailable): api.github.com did not answer (EAI_AGAIN) while reading /repos/omacom/omarchy-plugin-marketplace/commits.atom")
  assert.equal(registrySourceDetail(noHead), "registry at the pin 38060f89; HEAD unreadable: api.github.com did not answer (network-unavailable)")
  assert.ok(!/\(.*\(/.test(registrySourceDetail(noHead)), "no nested parentheses")

  const noFile = await liveRegistry({ pinDir, cacheRoot, ...fakes({ fail: "fetch" }) })
  assert.equal(noFile.source, "pin")
  assert.match(noFile.reason, new RegExp(`^registry at ${HEAD} unreadable \\(github-unavailable\\): GET ${RAW}/${HEAD}/registry.json returned 503$`))
  assert.equal(registrySourceDetail(noFile), `registry at the pin 38060f89; HEAD ${HEAD.slice(0, 7)} unreadable: GET ${RAW}/${HEAD}/registry.json returned 503 (github-unavailable)`)
  assert.ok(!existsSync(liveCacheDir(HEAD, cacheRoot)), "a failed read caches nothing")

  const atPin = await liveRegistry({ pinDir, cacheRoot, ...fakes({ commit: MARKETPLACE_PIN.commit }), now: () => "2026-09-13T15:00:00.000Z" })
  assert.equal(atPin.source, "head", "when HEAD is the pin, the pin's files are HEAD's files")
  assert.equal(atPin.commit, MARKETPLACE_PIN.commit)
  assert.equal(atPin.fetchedAt, "2026-09-13T15:00:00.000Z")
  assert.equal(registrySourceDetail(atPin), `registry at ${MARKETPLACE_PIN.commit}, read 2026-09-13T15:00:00.000Z`)
})

test("a live file is only ever one of the two data files, at a 40-character commit, never a branch", () => {
  assert.equal(liveFileUrl(HEAD, REGISTRY_PATH), `${RAW}/${HEAD}/registry.json`)
  assert.equal(liveFileUrl(HEAD, CATALOG_PATH), `${RAW}/${HEAD}/site/catalog.json`)
  assert.throws(() => liveFileUrl("main", REGISTRY_PATH), (error) => error instanceof RegistryError && /40-character/.test(error.message))
  assert.throws(() => liveFileUrl(HEAD.slice(0, 7), REGISTRY_PATH), RegistryError)
  for (const code of [SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE, "scripts/build-catalog.mjs", "scripts/security-baseline-policy.mjs"]) {
    assert.throws(() => liveFileUrl(HEAD, code), (error) => error instanceof RegistryError && /never read from HEAD/.test(error.message), code)
  }
  assert.deepEqual([...LIVE_PATHS], ["registry.json", "site/catalog.json"])
})

test("identity.available judges against HEAD's registry and names it; the pin's figures stay the pin's", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  // The injected reader answers as HEAD whatever the flag says, so the one
  // check that would otherwise reach the network (the subject's own HEAD)
  // stays off it.
  const readRegistry = async (options) => liveRegistry({ ...options, offline: false, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-registry-")), ...fakes(), now: () => "2026-09-13T15:00:00.000Z" })
  const result = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar", offline: true, readRegistry })

  assert.deepEqual(result.registry, { source: "head", commit: HEAD, fetchedAt: "2026-09-13T15:00:00.000Z", reason: null })
  const identity = result.checks.find((check) => check.id === "identity.available")
  assert.equal(identity.verdict, "fail", "HEAD lists the fixture id under another repository, and the fixture repository; the pin does neither")
  assert.equal(result.outcome, "refused")
  assert.match(identity.detail, /plugin-id-listed: "omakit-fixture\.good" is already listed by example\/omarchy-plugin-fixture-other/)
  assert.match(identity.detail, /submission-repository-listed/)
  assert.ok(identity.detail.endsWith(`; registry at ${HEAD}, read 2026-09-13T15:00:00.000Z`), identity.detail)
  assert.match(identity.why, /4,201 of the marketplace's 4,293 commits/)
  assert.match(identity.why, /MEASUREMENTS\.md M7/)
  const baseline = result.checks.find((check) => check.id === "baseline.preflight")
  assert.match(baseline.why, /2,916 listed sources/, "the documented figure is the pin's by design")

  const offline = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, category: "Widgets", tags: "bar", offline: true })
  assert.deepEqual(offline.registry, { source: "pin", commit: MARKETPLACE_PIN.commit, fetchedAt: null, reason: "--offline" })
  const pinned = offline.checks.find((check) => check.id === "identity.available")
  assert.equal(pinned.verdict, "pass")
  assert.ok(pinned.detail.endsWith("; registry at the pin 38060f89 (offline)"), pinned.detail)
})

// --- the subject's own listing -------------------------------------------------
// Measured on 0.1.6: `omakit submit` on the author's own listed plugin (the
// registry names the subject's declared repository, the catalog carries the
// manifest id) printed FAIL identity.available and REFUSED, and closed with
// "Fix it, then run submit again" under a remedy that said there was nothing
// to submit. The rule for "the same repository" is one function, tested here.

test("the same repository is owner and name, case-insensitively, with a trailing .git ignored", () => {
  const url = "https://github.com/example/omarchy-plugin-fixture-good"
  assert.equal(sameRepository(url, url), true)
  assert.equal(sameRepository(url, "https://github.com/Example/Omarchy-Plugin-Fixture-Good"), true, "case")
  assert.equal(sameRepository(url, `${url}.git`), true, ".git")
  assert.equal(sameRepository(url, `${url}.GIT/`), true, ".git in any case, and a trailing slash")
  assert.equal(sameRepository(url, "example/omarchy-plugin-fixture-good"), true, "a URL against the slug the universe stores")
  assert.equal(sameRepository("EXAMPLE/OMARCHY-PLUGIN-FIXTURE-GOOD", `${url}.git`), true)
  assert.equal(sameRepository(url, "https://github.com/example/omarchy-plugin-fixture-good-2"), false, "a longer name")
  assert.equal(sameRepository(url, "https://github.com/other/omarchy-plugin-fixture-good"), false, "another owner")
  assert.equal(sameRepository(url, "https://gitlab.com/example/omarchy-plugin-fixture-good"), true, "the host is not part of the rule; the subject is always github.com")
  assert.equal(sameRepository(url, null), false)
  assert.equal(sameRepository("", ""), false, "nothing is not the same as nothing")
  assert.equal(sameRepository("not a repository", "not a repository"), false)
})

test("a plugin listed by its own repository at HEAD is the listed outcome, at the listed commit or ahead of it", async () => {
  const fixture = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  const read = (files) => async (options) => liveRegistry({ ...options, offline: false, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-registry-")), ...fakes({ files }), now: () => "2026-09-13T15:00:00.000Z" })

  // At the listed commit: the catalog names the very commit that is checked out.
  const same = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true, readRegistry: read(ownListing(fixture.commit)) })
  assert.equal(same.outcome, "listed")
  assert.equal(same.ready, false)
  assert.deepEqual(same.blocking, [])
  assert.deepEqual(same.unknown, [], "nothing waited: the body checks are omitted, not drawn as questions")
  assert.equal(same.issue, null)
  assert.deepEqual(same.listing, {
    repository: "https://github.com/Example/omarchy-plugin-fixture-good.git",
    id: "omakit-fixture.good",
    addedAt: "2026-08-31",
    verificationCommit: fixture.commit,
    verificationStatus: "verified",
    verificationCheckedAt: "2026-09-10T17:40:18.858Z",
    localCommit: fixture.commit,
    sameCommit: true,
    source: "head",
    updateRoute: { form: "Verify or update a listed plugin", choice: "Verify and publish a newer upstream commit" },
  })
  const identity = same.checks.find((check) => check.id === "identity.available")
  assert.equal(identity.verdict, "pass")
  assert.equal(identity.remedy, null)
  assert.equal(identity.detail, `listed by this repository since 2026-08-31, verification commit ${fixture.commit} (verified, checked 2026-09-10T17:40:18.858Z); registry at ${HEAD}, read 2026-09-13T15:00:00.000Z`)
  assert.deepEqual(same.checks.map((check) => check.id), [
    "plugin.root-manifest", "plugin.root-readme", "plugin.root-license", "plugin.readme-install-removal", "tree.agent-control",
    "identity.available", "submission.title", "submission.repository-url", "submission.validation-commit", "baseline.preflight",
  ], "category, tags, headings, checklist and the official parser are not run")

  // Ahead of it: the same outcome, and the listing says which commit is listed.
  const listedCommit = "5b98b315cf1bf8ab1a8b5250a0c493dda8b6fa4b"
  const ahead = await submitPreflight({ repoRoot: REPO_ROOT, target: fixture.dir, offline: true, readRegistry: read(ownListing(listedCommit)) })
  assert.equal(ahead.outcome, "listed")
  assert.equal(ahead.listing.verificationCommit, listedCommit)
  assert.equal(ahead.listing.localCommit, fixture.commit)
  assert.equal(ahead.listing.sameCommit, false)
  assert.equal(ahead.listing.source, "head")

  // The listing the check reads is the catalog's entry, by id.
  const live = await read(ownListing(listedCommit))({ pinDir })
  assert.equal(listingOf(live, "omakit-fixture.good").verificationCommit, listedCommit)
  assert.equal(listingOf(live, "omakit-fixture.nobody"), null)
})
