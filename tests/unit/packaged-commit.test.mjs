// The packaged product names the commit its block files come from.
// Measured on 2026-09-19 by a first user: an npm-installed omakit stamped
// `commit unknown` into every header, the NOTICE and `add`'s output,
// because a package has no Git checkout and `npm pack` records no gitHead
// in the tarball (docs/evidence/ux/2026-09-19-first-user-test.json,
// finding 2). Now the release workflow records HEAD in
// tools/blocks/commit.json before it packs, `sourceCommit` reads it when
// there is no .git, and a package with no record refuses to stamp a header
// it cannot name. This test proves it from an installed tarball: the tree
// packed as the workflow packs it, extracted, and its own bin/omakit run.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"
import { clearCommit, COMMIT_FILE, recordCommit, recordedCommit } from "../../tools/blocks/record-commit.mjs"
import { sourceCommit } from "../../tools/blocks/add.mjs"
import { SUITES, suitePreflight } from "../../tools/lab/suites.mjs"
import { labLayout } from "../../tools/lab/paths.mjs"

const checkoutHead = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
const HEAD = checkoutHead.status === 0 ? checkoutHead.stdout.trim() : recordedCommit(REPO_ROOT)

test("a checkout names HEAD, while a release-shaped archive names its recorded commit", () => {
  assert.match(HEAD || "", /^[0-9a-f]{40}$/, "the source under test names one commit")
  assert.equal(sourceCommit(REPO_ROOT), HEAD)
  if (checkoutHead.status !== 0) {
    assert.equal(recordedCommit(REPO_ROOT), HEAD, "an archive has no Git metadata, so the release record is its source")
    return
  }
  assert.equal(recordedCommit(REPO_ROOT), null, "the checkout's tools/blocks/commit.json is null; the workflow fills it at pack time")
  // The release step by hand: `npm run pack:release` records, checks, packs and clears, in that order, and the clear runs whatever pack did.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  assert.equal(pkg.scripts["pack:release"], "node tools/blocks/record-commit.mjs && node tools/blocks/record-commit.mjs --check && npm pack --ignore-scripts; node tools/blocks/record-commit.mjs --clear")
  assert.equal(pkg.version, "0.6.7", "the release branch names the release it makes")
  // --clear on a copy: the record is null again, the explanation kept.
  const copy = mkdtempSync(join(tmpdir(), "omakit-record-"))
  try {
    mkdirSync(join(copy, "tools/blocks"), { recursive: true })
    writeFileSync(join(copy, COMMIT_FILE), readFileSync(join(REPO_ROOT, COMMIT_FILE)))
    recordCommit(copy, HEAD)
    assert.equal(recordedCommit(copy), HEAD)
    clearCommit(copy)
    assert.equal(recordedCommit(copy), null)
    const record = JSON.parse(readFileSync(join(copy, COMMIT_FILE), "utf8"))
    assert.equal(record.recordedAt, null)
    assert.match(record.how, /release workflow/)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8")
  const record = workflow.indexOf("node tools/blocks/record-commit.mjs\n")
  const pack = workflow.indexOf("npm pack --ignore-scripts")
  assert.ok(record > 0 && pack > record, "the workflow records the commit before it packs")
  assert.match(workflow, /node tools\/blocks\/record-commit\.mjs --check/, "and checks the record names the tagged HEAD")
})

test("an installed tarball with the record stamps the commit into the header, the NOTICE and add's output; one without it refuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-packaged-"))
  try {
    // Pack the tree as the workflow does, but into a temporary directory, and extract it.
    const packed = JSON.parse(spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], { timeout: 120_000, cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout)
    const tarball = join(dir, packed[0].filename)
    assert.equal(spawnSync("tar", ["-xzf", tarball, "-C", dir], { timeout: 120_000 }).status, 0)
    const installed = join(dir, "package")
    assert.ok(!readdirSync(installed).includes(".git"), "an installed package has no checkout")
    // The lab's suite inputs ship: an installed omakit's preflight finds every file each suite stages (finding 5).
    for (const suite of Object.values(SUITES)) {
      const missing = suitePreflight({ ...suite, plugins: undefined }, { repoRoot: installed, layout: labLayout({ HOME: dir, XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state") }) })
      assert.deepEqual(missing, [], `${suite.name}: every file ships`)
    }
    const plugin = join(dir, "plugin")
    mkdirSync(plugin)
    writeFileSync(join(plugin, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, id: "fixture.packaged", name: "packaged", version: "0.0.1" })}\n`)
    const run = (args) => spawnSync(process.execPath, [join(installed, "bin/omakit"), ...args], { timeout: 120_000, encoding: "utf8", env: { ...process.env, TERM: "dumb" } })
    // Without the record: a refusal, no file written, the cause named.
    clearCommit(installed)
    const refused = run(["add", "run", plugin])
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /no-source-commit/)
    assert.match(refused.stderr, /names no source commit/)
    assert.ok(!readdirSync(plugin).includes("omakit"), "nothing was written")
    // With the record the workflow writes: the commit in every place.
    recordCommit(installed, HEAD)
    const added = run(["add", "run", plugin])
    assert.equal(added.status, 0, added.stderr)
    assert.match(added.stdout, new RegExp(`from omakit commit\\s+${HEAD}`))
    assert.match(readFileSync(join(plugin, "omakit/Run.qml"), "utf8"), new RegExp(`^// Source: omakit blocks/run/Run\\.qml, commit ${HEAD}$`, "m"))
    assert.match(readFileSync(join(plugin, "omakit/run-supervisor.py"), "utf8"), new RegExp(`^# Source: omakit blocks/run/run-supervisor\\.py, commit ${HEAD}$`, "m"))
    assert.match(readFileSync(join(plugin, "omakit/NOTICE"), "utf8"), new RegExp(`block run [0-9.]+, from omakit commit ${HEAD}`))
    assert.doesNotMatch(added.stdout + readFileSync(join(plugin, "omakit/NOTICE"), "utf8"), /unknown/)
    assert.equal(recordedCommit(installed), HEAD)
    assert.ok(readFileSync(join(installed, COMMIT_FILE), "utf8").includes("recordedAt"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
