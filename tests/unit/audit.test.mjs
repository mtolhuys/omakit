import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { auditInstalled } from "../../tools/audit/audit.mjs"
import { renderAudit } from "../../tools/audit/report.mjs"
import { plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)
const D = "d".repeat(40)
const route = {
  formPath: ".github/ISSUE_TEMPLATE/verify-plugin.yml",
  name: "Verify or update a listed plugin",
  choice: "Verify and publish a newer upstream commit",
}

const listing = (id, repo, extra = {}) => ({
  id,
  repo,
  sourceType: "community",
  verificationStatus: "verified",
  listingValidatedCommit: A,
  listingValidatedAt: "2026-08-28T22:57:15.992Z",
  listingValidatedBranch: "main",
  upstreamObservedCommit: A,
  upstreamObservedBranch: "main",
  upstreamCheckedAt: "2026-09-11T09:43:23.063Z",
  upstreamCheckStatus: "passed",
  upstreamValidatedCommit: null,
  upstreamValidatedAt: null,
  ...extra,
})

function fixture({ drift = false, target = null } = {}) {
  const plugins = [
    { id: "p.validated", enabled: true, firstParty: false, sourceDir: "/p/validated" },
    { id: "p.ahead", enabled: true, firstParty: false, sourceDir: "/p/ahead" },
    { id: "p.diverged", enabled: true, firstParty: false, sourceDir: "/p/diverged" },
    { id: "p.unverified", enabled: true, firstParty: false, sourceDir: "/p/unverified" },
    { id: "p.unlisted", enabled: false, firstParty: false, sourceDir: "/p/unlisted" },
    { id: "p.unknown", enabled: true, firstParty: false, sourceDir: "/p/unknown" },
    { id: "p.conflict", enabled: true, firstParty: false, sourceDir: "/p/conflict" },
    { id: "p.builtin", enabled: true, firstParty: false, sourceDir: "/p/builtin" },
    { id: "p.first", enabled: true, firstParty: true, sourceDir: "/p/first" },
  ]
  const catalog = [
    listing("p.validated", "https://github.com/example/validated", { upstreamObservedCommit: D }),
    listing("p.ahead", "https://github.com/example/ahead", { upstreamObservedCommit: D }),
    listing("p.diverged", "https://github.com/example/diverged"),
    listing("p.unverified", "https://github.com/example/unverified", { verificationStatus: "unverified", listingValidatedCommit: null, listingValidatedAt: null }),
    listing("p.by-origin", "https://github.com/example/conflict"),
    listing("p.conflict", "https://github.com/example/other"),
    listing("p.builtin", "https://github.com/example/builtin", { sourceType: "builtin" }),
  ]
  const checkout = (dir) => {
    if (dir === "/p/unknown") throw new Error("not a git repository")
    const id = dir.split("/").pop()
    return {
      commit: id === "validated" ? A : id === "ahead" ? B : C,
      status: id === "validated" ? " M local.qml" : "",
      repository: `https://github.com/example/${id}.git`,
    }
  }
  return auditInstalled({
    drift,
    target,
    installed: () => plugins,
    registry: async () => ({ source: "pin", commit: "3".repeat(40), fetchedAt: null, reason: "--offline", catalog: { plugins: catalog }, registry: {} }),
    checkout,
    ancestor: (dir, sha) => dir === "/p/ahead" && sha === A,
    count: () => 3,
    route: async () => route,
  })
}

test("every primary state and every stacking flag comes from its recorded origin", async () => {
  const document = await fixture()
  assert.deepEqual(document.rows.map((row) => row.state), ["validated", "ahead", "diverged", "unverified", "unlisted", "unknown", "unlisted"])
  assert.deepEqual(document.rows[0].flags, ["modified", "upstream moved"])
  assert.deepEqual(document.rows[1].flags, ["upstream moved"])
  assert.deepEqual(document.rows[4].flags, ["disabled"])
  assert.match(document.rows[6].fact, /matches p\.conflict, but origin matches p\.by-origin; neither listing was used/)
  assert.equal(document.rows[1].aheadBy.value, 3)
  assert.match(document.rows[1].aheadBy.origin, /^git rev-list --count/)
  assert.equal(document.counts.firstPartyExcluded.value, 2)
  assert.equal(document.counts.audited.value, 7)
  assert.equal(document.ok, false)
})

test("--drift filters validated rows without changing the measured verdict", async () => {
  const document = await fixture({ drift: true })
  assert.equal(document.rows.some((row) => row.state === "validated"), false)
  assert.equal(document.counts.audited.value, 7)
  assert.equal(document.counts.drift.value, 6)
  assert.equal(document.ok, false)
})

test("one installed id is selected, and an absent id is refused", async () => {
  const document = await fixture({ target: "p.validated" })
  assert.equal(document.rows.length, 1)
  assert.equal(document.rows[0].state, "validated")
  assert.equal(document.ok, true)
  await assert.rejects(() => fixture({ target: "p.absent" }), { code: "plugin-not-installed" })
})

test("JSON fields and human rendering carry the same audit result", async () => {
  const document = await fixture({ target: "p.validated" })
  const decoded = JSON.parse(JSON.stringify(document))
  assert.deepEqual(Object.keys(decoded.rows[0]).filter((key) => ["state", "flags", "installed", "validated", "upstream", "sourceDir"].includes(key)).sort(), ["flags", "installed", "sourceDir", "state", "upstream", "validated"])
  const uncoloured = renderAudit(document, { colour: false })
  const coloured = renderAudit(document, { colour: true })
  assert.equal(plain(coloured), uncoloured)
  assert.match(uncoloured, /AUDITED/)
})

test("the CLI refuses unknown options and reports an unanswered shell", () => {
  const entry = join(REPO_ROOT, "bin/omakit")
  const unknown = spawnSync(process.execPath, [entry, "audit", "--wat"], { encoding: "utf8", env: { ...process.env, TERM: "dumb" } })
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /--wat is not an option this command knows/)
  assert.equal(unknown.stdout, "")

  const shell = spawnSync(process.execPath, [entry, "audit", "--offline"], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent", TERM: "dumb" } })
  assert.equal(shell.status, 1)
  assert.match(shell.stderr, /NOT AUDITED/)
  assert.equal(shell.stdout, "")
})
