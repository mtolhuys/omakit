import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { auditInstalled } from "../../tools/audit/audit.mjs"
import { renderAudit } from "../../tools/audit/report.mjs"
import { plain } from "../../tools/marketplace/style.mjs"
import { newerCommitChoice } from "../../tools/marketplace/form.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)
const D = "d".repeat(40)
const route = {
  formPath: ".github/ISSUE_TEMPLATE/verify-plugin.yml",
  name: "Verify or update a listed plugin",
  choice: "Verify and publish a newer upstream commit",
  url: "https://github.com/example/marketplace/issues/new?template=verify-plugin.yml",
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
    hasCommit: () => true,
    ancestor: (dir, sha) => dir === "/p/ahead" && sha === A,
    count: () => 3,
    route: async () => route,
  })
}

test("every primary state and every stacking flag comes from its recorded origin", async () => {
  const document = await fixture()
  assert.deepEqual(document.rows.map((row) => row.id), ["p.diverged", "p.ahead", "p.validated", "p.unverified", "p.unlisted", "p.conflict", "p.unknown"])
  const byId = Object.fromEntries(document.rows.map((row) => [row.id, row]))
  assert.deepEqual(byId["p.validated"].flags, ["modified", "upstream moved"])
  assert.deepEqual(byId["p.ahead"].flags, ["upstream moved"])
  assert.deepEqual(byId["p.unlisted"].flags, ["disabled"])
  assert.match(byId["p.conflict"].fact, /matches p\.conflict, but origin matches p\.by-origin; neither listing was used/)
  assert.equal(byId["p.ahead"].aheadBy.value, 3)
  assert.match(byId["p.ahead"].aheadBy.origin, /^git rev-list --count/)
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
  assert.deepEqual(document.rows.map((row) => row.id), (await fixture()).rows.filter((row) => row.state !== "validated").map((row) => row.id))
  assert.match(renderAudit(document, { colour: false }), /audited +7/)
})

test("clean validated rows come last while modified remains a stacking flag", async () => {
  const ids = ["clean", "unknown", "unlisted", "unverified", "modified", "ahead", "diverged"]
  const document = await auditInstalled({
    installed: () => ids.map((id) => ({ id, enabled: true, sourceDir: `/p/${id}` })),
    registry: async () => ({ source: "pin", commit: B, catalog: { plugins: ids.filter((id) => id !== "unlisted").map((id) => listing(id, `https://github.com/example/${id}`, id === "unverified" ? { listingValidatedCommit: null } : {})) } }),
    checkout: (dir) => {
      const id = dir.split("/").pop()
      if (id === "unknown") throw new Error("not a git repository")
      return { commit: ["clean", "modified"].includes(id) ? A : C, status: id === "modified" ? " M file" : "", repository: `https://github.com/example/${id}` }
    },
    hasCommit: () => true,
    ancestor: (dir) => dir.endsWith("/ahead"),
    count: () => 1,
    route: async () => route,
  })
  assert.deepEqual(document.rows.map((row) => row.id), ["diverged", "ahead", "modified", "unverified", "unlisted", "unknown", "clean"])
  assert.equal(document.rows[2].state, "validated")
  assert.deepEqual(document.rows[2].flags, ["modified"])
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

test("validated and ahead fact lines state the commit and date without repeating HEAD", async () => {
  const clean = await fixture({ target: "p.validated" })
  assert.equal(clean.rows[0].fact, "validated aaaaaaaa on 2026-08-28T22:57:15.992Z")
  const cleanText = renderAudit(clean, { colour: false }).replace(/\s+/g, " ")
  assert.match(cleanText, /validated aaaaaaaa on 2026-08-28T22:57:15\.992Z; modified, upstream moved/)
  assert.doesNotMatch(cleanText, /HEAD/)
  const ahead = await fixture({ target: "p.ahead" })
  assert.equal(ahead.rows[0].fact, "3 commits ahead of validated aaaaaaaa (2026-08-28T22:57:15.992Z); HEAD bbbbbbbb")
  const aheadText = renderAudit(ahead, { colour: false }).replace(/\s+/g, " ")
  assert.match(aheadText, /HEAD bbbbbbbb; upstream moved/)
  assert.equal(aheadText.split("HEAD").length - 1, 1)
  const divergedText = renderAudit(await fixture({ target: "p.diverged" }), { colour: false }).replace(/\s+/g, " ")
  assert.match(divergedText, /installed commit does not descend from a validated commit; HEAD cccccccc/)
  assert.equal(divergedText.split("HEAD").length - 1, 1)
})

test("completed audits distinguish validated from drift without claiming they were not audited", async () => {
  const clean = renderAudit(await fixture({ target: "p.validated" }), { colour: false })
  const drift = renderAudit(await fixture(), { colour: false })
  assert.match(clean, /AUDITED  /)
  assert.match(drift, /DRIFT  /)
  assert.doesNotMatch(drift, /NOT AUDITED/)
  assert.match(drift.replace(/\s+/g, " "), /1 of 7 run a commit the marketplace validated; 6 run one it never saw\./)
})

test("the verification form URL and pin choice appear once in the footer, after checkout actions", async () => {
  const document = await fixture()
  const output = renderAudit(document, { colour: false }).replace(/\s+/g, " ")
  assert.equal(output.split(route.url).length - 1, 1)
  assert.equal(output.split(route.choice).length - 1, 1)
  assert.equal(output.split("git -C").length - 1, 2)
  assert.ok(output.lastIndexOf("git -C") < output.indexOf(route.url))
  const pinned = await newerCommitChoice({ repoRoot: REPO_ROOT })
  assert.equal(pinned.url, `${MARKETPLACE_PIN.repository}/issues/new?template=verify-plugin.yml`)
  assert.ok(pinned.choice)
})

test("an unreadable verification form does not erase a completed audit", async () => {
  const document = await auditInstalled({
    installed: () => [{ id: "p.ahead", enabled: true, sourceDir: "/p/ahead" }],
    registry: async () => ({ source: "pin", commit: B, catalog: { plugins: [listing("p.ahead", "https://github.com/example/ahead")] } }),
    checkout: () => ({ commit: C, status: "", repository: "https://github.com/example/ahead" }),
    hasCommit: () => true,
    ancestor: () => true,
    count: () => 1,
    route: async () => { throw new Error("form could not be read") },
  })
  assert.equal(document.rows[0].state, "ahead")
  assert.equal(document.updateRouteError, "form could not be read")
  const output = renderAudit(document, { colour: false })
  assert.match(output, /DRIFT/)
  assert.doesNotMatch(output, /NOT AUDITED/)
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

test("the CLI JSON, output file, drift view and exit codes use stubbed shell and Git answers", (t) => {
  const root = mkdtempSync(join(tmpdir(), "omakit-audit-cli-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = join(root, "bin")
  const sourceDir = join(root, "plugin")
  writeFileSync(join(root, "keep"), "")
  const makeDir = spawnSync("mkdir", ["-p", bin, sourceDir])
  assert.equal(makeDir.status, 0)

  const pinDir = requirePinForTests()
  const catalog = JSON.parse(readFileSync(join(pinDir, "site/catalog.json"), "utf8"))
  const entry = catalog.plugins.find((plugin) => plugin.sourceType !== "builtin" && (plugin.upstreamValidatedCommit || plugin.listingValidatedCommit))
  const validated = (entry.upstreamValidatedCommit || entry.listingValidatedCommit).toLowerCase()
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim()

  const script = (name, text) => {
    const file = join(bin, name)
    writeFileSync(file, `#!/bin/sh\n${text}\n`)
    chmodSync(file, 0o755)
  }
  script("omarchy", "printf '%s\\n' \"$AUDIT_INSTALLED_JSON\"")
  script("omarchy-plugin-catalog", "printf '%s\\n' \"$AUDIT_SHELL_CATALOG\"")
  script("git", [
    'if [ "$1" = "-C" ] && [ "$2" = "$AUDIT_SOURCE_DIR" ]; then',
    '  case "$3 $4 $5" in',
    '    "rev-parse HEAD ") printf "%s\\n" "$AUDIT_HEAD"; exit 0 ;;',
    '    "status --porcelain ") exit 0 ;;',
    '    "remote get-url origin") printf "%s\\n" "$AUDIT_REPOSITORY"; exit 0 ;;',
    '    "cat-file -e "*) exit 0 ;;',
    '    "merge-base --is-ancestor"*) exit 0 ;;',
    '    "rev-list --count "*) printf "2\\n"; exit 0 ;;',
    "  esac",
    "fi",
    'exec "$AUDIT_REAL_GIT" "$@"',
  ].join("\n"))

  const installed = JSON.stringify([{ id: entry.id, name: entry.name, kinds: entry.kinds || [], enabled: true, firstParty: false }])
  const shellCatalog = JSON.stringify([{ id: entry.id, sourceDir }])
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TERM: "dumb",
    AUDIT_INSTALLED_JSON: installed,
    AUDIT_SHELL_CATALOG: shellCatalog,
    AUDIT_SOURCE_DIR: sourceDir,
    AUDIT_REPOSITORY: entry.repo,
    AUDIT_REAL_GIT: realGit,
  }
  const run = (args, head) => spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), "audit", ...args], { encoding: "utf8", env: { ...env, AUDIT_HEAD: head } })

  const clean = run(["--offline", "--json"], validated)
  assert.equal(clean.status, 0)
  assert.equal(clean.stderr, "")
  const cleanDocument = JSON.parse(clean.stdout)
  assert.equal(cleanDocument.rows[0].state, "validated")

  const out = join(root, "audit.json")
  const written = run(["--offline", "--out", out], validated)
  assert.equal(written.status, 0)
  assert.match(written.stdout, /AUDITED/)
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), cleanDocument)

  const drift = run(["--offline", "--drift", "--json"], "f".repeat(40))
  assert.equal(drift.status, 1)
  assert.equal(drift.stderr, "")
  const driftDocument = JSON.parse(drift.stdout)
  assert.equal(driftDocument.rows.length, 1)
  assert.equal(driftDocument.rows[0].state, "ahead")
  assert.equal(driftDocument.rows[0].aheadBy.value, 2)
})

test("a missing validated object is diverged in full and shallow local clones", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "omakit-audit-history-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, "source")
  const git = (...args) => {
    const result = spawnSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test" } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", source)
  writeFileSync(join(source, "file"), "first")
  git("-C", source, "add", "file")
  git("-C", source, "commit", "-m", "first")
  const first = git("-C", source, "rev-parse", "HEAD")
  writeFileSync(join(source, "file"), "second")
  git("-C", source, "commit", "-am", "second")
  const shallow = join(root, "shallow")
  git("clone", "--depth", "1", `file://${source}`, shallow)
  const repository = "https://github.com/example/history"
  git("-C", source, "remote", "add", "origin", repository)
  git("-C", shallow, "remote", "set-url", "origin", repository)
  for (const [sourceDir, commit, expectedShallow] of [[source, A, false], [shallow, first, true]]) {
    let ancestryCalled = false
    const document = await auditInstalled({
      installed: () => [{ id: "p.history", enabled: true, sourceDir }],
      registry: async () => ({ source: "pin", commit: B, catalog: { plugins: [listing("p.history", repository, { listingValidatedCommit: commit })] } }),
      ancestor: () => { ancestryCalled = true; throw new Error("missing object reached merge-base") },
      route: async () => route,
    })
    assert.equal(ancestryCalled, false)
    assert.equal(document.rows[0].state, "diverged")
    assert.equal(document.rows[0].fact, `validated commit not in local history; shallow clone: ${expectedShallow}`)
    assert.deepEqual(document.rows[0].shallow, { value: expectedShallow, origin: "git rev-parse --is-shallow-repository" })
    assert.equal(document.ok, false)
  }
})

test("a listing without a validated commit is unverified even when its status says verified", async () => {
  const document = await auditInstalled({
    installed: () => [{ id: "p.empty", enabled: true, sourceDir: "/p/empty" }],
    registry: async () => ({ source: "pin", commit: B, catalog: { plugins: [listing("p.empty", "https://github.com/example/empty", { listingValidatedCommit: null })] } }),
    checkout: () => ({ commit: C, status: "", repository: "https://github.com/example/empty" }),
  })
  assert.equal(document.rows[0].state, "unverified")
})
