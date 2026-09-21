// The sparse pin is only safe while PIN_PATHS covers every path omakit reads.
//
// On a blob-filtered partial clone, reading a path outside the sparse set does
// not fail: git quietly fetches it over the network. That would turn a local,
// offline, reproducible run into one that silently depends on GitHub being up
// and on the token in the environment. So the path constants in the source are
// checked against PIN_PATHS here, and adding a new read without adding its path
// fails this test.
import test from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { ensurePin, PIN_PATHS, PIN_READS, POLICY_MODULE, WORDING_READS, UNFOLLOWED_IMPORTS, MARKETPLACE_PIN, pinDiskUsage, pinIsSparse, pinShape, pinnedReadSet, policyConstants, unfollowedImports, marketplacePinDir } from "../../tools/marketplace/pin.mjs"
import { spawn, spawnSync } from "node:child_process"
import { SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE } from "../../tools/marketplace/form.mjs"
import { CATALOG_PATH, REGISTRY_PATH, CATALOG_BUILDER_PATH } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

function covered(path) {
  return PIN_PATHS.some((pattern) =>
    pattern.endsWith("/") ? path.startsWith(pattern.slice(1)) : path === pattern.slice(1),
  )
}

test("every path constant in the source is inside the sparse set", () => {
  for (const path of [SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE, CATALOG_PATH, REGISTRY_PATH, CATALOG_BUILDER_PATH]) {
    assert.ok(covered(path), `${path} is read from the pin but is not covered by PIN_PATHS`)
  }
})

test("no source file reads a pinned path that the sparse set misses", () => {
  // A second, cruder net: any string in the sources that looks like a path into
  // the marketplace checkout must be covered too.
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".cache", "node_modules"].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".mjs")) sources.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") })
    }
  }
  walk(join(REPO_ROOT, "tools"))

  const PINNED_PREFIX = /"((?:scripts|site|worker|test|\.github)\/[A-Za-z0-9_./-]+)"/g
  for (const { path, text } of sources) {
    for (const match of text.matchAll(PINNED_PREFIX)) {
      assert.ok(covered(match[1]), `${path} reads ${match[1]} from the pin, which PIN_PATHS does not fetch`)
    }
  }
})

// --- the read set ---------------------------------------------------------------
// PIN_PATHS fetches scripts/ whole; PIN_READS says which files in it omakit
// opens, and how, so `omakit doctor` can compare those blobs against HEAD
// instead of the directory's tree id. Measured on 2026-09-21 (M7): of the
// three marketplace commits that touched scripts/ since the first pin,
// one changed only repository-identity.mjs, which nothing here reaches,
// and the tree comparison graded it advice. The list is derived from the
// sources here, so a new read is a visible diff in PIN_READS, and the
// resolved set at this pin is pinned below, so a new import upstream is a
// visible diff after a pin bump.

/** Every scripts/ file the sources open out of the pin, and whether any opens it with import(). */
function readsInSources() {
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".cache", "node_modules"].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".mjs")) sources.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") })
    }
  }
  walk(join(REPO_ROOT, "tools"))
  const constants = new Map()
  for (const { text } of sources) {
    for (const match of text.matchAll(/^(?:export )?const ([A-Z_]+) = "(scripts\/[^"]+)"/gm)) constants.set(match[1], match[2])
  }
  const reads = new Map()
  const note = (path, imported) => reads.set(path, Boolean(reads.get(path)) || imported)
  for (const { text } of sources) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const line of code.split("\n")) {
      // A path handed to join() as a literal or a constant, or a git object
      // named as `<commit>:scripts/...` in a template.
      const named = [
        ...[...line.matchAll(/join\(\s*[\w.]+\s*,\s*"(scripts\/[^"]+)"\s*\)/g)].map((match) => match[1]),
        ...[...line.matchAll(/join\(\s*[\w.]+\s*,\s*([A-Z_]+)\s*\)/g)].map((match) => constants.get(match[1])).filter(Boolean),
        ...[...line.matchAll(/:(scripts\/[\w./-]+)`/g)].map((match) => match[1]),
        ...[...line.matchAll(/:\$\{([A-Z_]+)\}`/g)].map((match) => constants.get(match[1])).filter(Boolean),
      ]
      if (!named.length) continue
      // Opened with import() on this line, or assigned to a name that a
      // later import() takes; anything else is a text read.
      const assigned = line.match(/^\s*const (\w+) = /)?.[1]
      const imported = /\bimport\(/.test(line) || Boolean(assigned && new RegExp(`import\\((?:pathToFileURL\\()?${assigned}\\b`).test(code))
      for (const path of named) note(path, imported)
    }
  }
  return reads
}

test("PIN_READS is what the sources open out of scripts/, each the way it is opened", () => {
  const derived = readsInSources()
  const listed = new Map(PIN_READS.map((read) => [read.path, read.imported]))
  assert.deepEqual([...derived.keys()].sort(), [...listed.keys()].sort(), "a scripts/ file the sources open is in PIN_READS, and nothing else is")
  for (const [path, imported] of derived) {
    assert.equal(listed.get(path), imported, `${path} is ${imported ? "imported" : "read as text"} by the sources and listed the other way`)
  }
  assert.equal(listed.get(POLICY_MODULE), true, "the policy module is imported, and its constants are read from its text")
  assert.equal(derived.size, 10, "ten files opened by omakit at this pin")
})

test("pinnedReadSet at this pin is exactly these files: a new read or a new upstream import is a visible diff here", () => {
  const dir = requirePinForTests()
  const set = pinnedReadSet(dir)
  assert.deepEqual(set, [
    { path: "scripts/approve-plugin-update.mjs", imported: false, via: null },
    { path: "scripts/approve-submission.mjs", imported: false, via: null },
    { path: "scripts/build-catalog.mjs", imported: false, via: null },
    { path: "scripts/github-repository.mjs", imported: true, via: "scripts/submission.mjs" },
    { path: "scripts/plugin-verification-request.mjs", imported: true, via: null },
    { path: "scripts/security-baseline-analysis.mjs", imported: true, via: "scripts/security-baseline-scanner.mjs" },
    { path: "scripts/security-baseline-error.mjs", imported: true, via: "scripts/security-baseline-scanner.mjs" },
    { path: "scripts/security-baseline-limits.mjs", imported: true, via: "scripts/security-baseline-analysis.mjs" },
    { path: "scripts/security-baseline-policy.mjs", imported: true, via: null },
    { path: "scripts/security-baseline-record.mjs", imported: true, via: null },
    { path: "scripts/security-baseline-report.mjs", imported: true, via: null },
    { path: "scripts/security-baseline-scanner.mjs", imported: true, via: null },
    { path: "scripts/security-baseline-scope.mjs", imported: true, via: "scripts/security-baseline-scanner.mjs" },
    { path: "scripts/security-github-snapshot.mjs", imported: true, via: "scripts/security-baseline-analysis.mjs" },
    { path: "scripts/submission-feedback.mjs", imported: true, via: null },
    { path: "scripts/submission.mjs", imported: true, via: null },
  ])
  assert.equal(set.length, 16, "16 of the 34 files under scripts/ at pin b7b29654")
  assert.equal(readdirSync(join(dir, "scripts")).filter((name) => name.endsWith(".mjs")).length, 34)
  assert.ok(set.every((read) => covered(read.path)), "every one is inside the sparse set")
  assert.ok(!set.some((read) => read.path === "scripts/repository-identity.mjs"), "5e401552 changed a file nothing here reaches")
})

test("pinnedReadSet follows `from` specifiers by text, inside scripts/ only, and never loads a module", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-read-set-"))
  try {
    mkdirSync(join(root, "scripts"))
    // a imports b and re-exports c, names a package and a file outside
    // scripts/, and would throw if it were ever loaded; b and c import each
    // other; t is read as text and its own import is not followed.
    writeFileSync(join(root, "scripts/a.mjs"), 'import { b } from "./b.mjs"\nexport * from "./c.mjs"\nimport sharp from "sharp"\nimport { t } from "../site/assets/js/taxonomy.js"\nthrow new Error("loaded")\n')
    writeFileSync(join(root, "scripts/b.mjs"), "import { c } from './c.mjs'\nexport const b = 1\n")
    writeFileSync(join(root, "scripts/c.mjs"), 'import {\n  b,\n} from "./b.mjs"\nexport const c = 1\n')
    writeFileSync(join(root, "scripts/t.mjs"), 'import { d } from "./d.mjs"\nexport const label = "x"\n')
    const reads = [{ path: "scripts/a.mjs", imported: true }, { path: "scripts/t.mjs", imported: false }]
    assert.deepEqual(pinnedReadSet(root, reads), [
      { path: "scripts/a.mjs", imported: true, via: null },
      { path: "scripts/b.mjs", imported: true, via: "scripts/a.mjs" },
      { path: "scripts/c.mjs", imported: true, via: "scripts/a.mjs" },
      { path: "scripts/t.mjs", imported: false, via: null },
    ])
    assert.throws(() => pinnedReadSet(root, [{ path: "scripts/missing.mjs", imported: true }]), (error) => error.name === "PinError" && /cannot read scripts\/missing\.mjs/.test(error.message))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the closure is complete at this pin: no executed read file carries an import form pinnedReadSet does not follow", () => {
  // The one way the read set could miss a file is an import the regex does
  // not see. Measured at pin b7b29654: 0 of the 13 executed files use a
  // dynamic import(), a side-effect import, require() or
  // import.meta.resolve(). A marketplace
  // commit that introduces one fails here, by file and line, at the next
  // pin bump, instead of doctor staying quiet about a file it does not see.
  const dir = requirePinForTests()
  const set = pinnedReadSet(dir)
  assert.equal(set.filter((read) => read.imported).length, 13)
  assert.deepEqual(unfollowedImports(dir, set), [], "an import form the closure does not follow appeared in a read file")
  assert.equal(UNFOLLOWED_IMPORTS.length, 4)
})

test("unfollowedImports names each unfollowed form by file and line, and scans only executed files", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-unfollowed-"))
  try {
    mkdirSync(join(root, "scripts"))
    writeFileSync(join(root, "scripts/a.mjs"), 'import { b } from "./b.mjs"\nconst m = await import("./late.mjs")\nimport "./side.mjs"\nconst r = require("./cjs.cjs")\nconst u = import.meta.resolve("./x.mjs")\nconst dir = import.meta.dirname\n')
    writeFileSync(join(root, "scripts/b.mjs"), "export const b = 1\n")
    writeFileSync(join(root, "scripts/t.mjs"), 'const m = await import("./never-loaded.mjs")\n')
    const reads = [{ path: "scripts/a.mjs", imported: true }, { path: "scripts/t.mjs", imported: false }]
    const found = unfollowedImports(root, pinnedReadSet(root, reads))
    assert.deepEqual(found.map((hit) => [hit.path, hit.line, hit.form]), [
      ["scripts/a.mjs", 2, "dynamic import()"],
      ["scripts/a.mjs", 3, "side-effect import"],
      ["scripts/a.mjs", 4, "require()"],
      ["scripts/a.mjs", 5, "import.meta.resolve()"],
    ], "import.meta.dirname is not an import, and t.mjs is read as text so its import() is not scanned")
    assert.deepEqual(unfollowedImports(root, pinnedReadSet(root, [{ path: "scripts/b.mjs", imported: true }])), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("WORDING_READS is a subset of the read set, each file one omakit takes only wording or a label from", () => {
  const set = pinnedReadSet(requirePinForTests()).map((read) => read.path)
  for (const path of WORDING_READS) assert.ok(set.includes(path), `${path} is in the read set`)
  assert.deepEqual([...WORDING_READS], ["scripts/security-baseline-report.mjs", "scripts/submission-feedback.mjs", "scripts/approve-submission.mjs", "scripts/approve-plugin-update.mjs"])
  // The verdict-bearing remainder is the default: 12 of 16 at pin b7b29654,
  // every file omakit executes for an outcome or reads a rule, a limit, a
  // constant or a parser from.
  assert.equal(set.filter((path) => !WORDING_READS.includes(path)).length, 12)
})

test("the two policy constants are read out of text, the same way for the pin and for HEAD", () => {
  const dir = requirePinForTests()
  const atPin = policyConstants(readFileSync(join(dir, POLICY_MODULE), "utf8"))
  assert.deepEqual(atPin, { baselineVersion: MARKETPLACE_PIN.baselineVersion, enforcementMode: MARKETPLACE_PIN.enforcementMode })
  assert.deepEqual(policyConstants('export const securityBaselineVersion = 4;\nexport const securityBaselineEnforcementMode = "strict";'), { baselineVersion: "4", enforcementMode: "strict" })
  assert.deepEqual(policyConstants("nothing here"), { baselineVersion: "unknown", enforcementMode: "unknown" })
  assert.deepEqual(policyConstants(null), { baselineVersion: "unknown", enforcementMode: "unknown" })
})

test("the sparse set is minimal: nothing in it is unused", () => {
  const text = ["form.mjs", "registry.mjs", "pin.mjs", "preflight.mjs", "run-baseline.mjs", "watch.mjs"]
    .map((name) => readFileSync(join(REPO_ROOT, "tools/marketplace", name), "utf8"))
    .join("\n")
  for (const pattern of PIN_PATHS) {
    const stem = pattern.slice(1).replace(/\/$/, "")
    assert.ok(text.includes(stem), `PIN_PATHS fetches ${pattern} but no module mentions ${stem}`)
  }
})

test("a freshly fetched pin is sparse, and the pin identity still reads", () => {
  const dir = requirePinForTests()
  // An older full checkout is still valid, so this only asserts the mechanism
  // exists and reports honestly.
  assert.equal(typeof pinIsSparse(dir), "boolean")
  assert.equal(marketplacePinDir(REPO_ROOT), dir)
  assert.match(MARKETPLACE_PIN.commit, /^[0-9a-f]{40}$/)
})

test("sparse is judged by the tree, the pinned paths and nothing else, never by a git setting alone", () => {
  // Finding 9 of the first-user test: a fresh pin was told it predates the
  // sparse fetch because `git config core.sparseCheckout` could not be
  // read on that machine, while the tree was exactly the four pinned paths.
  const root = mkdtempSync(join(tmpdir(), "omakit-pin-shape-"))
  try {
    const sparse = join(root, "sparse")
    for (const path of ["scripts/x.mjs", "site/catalog.json", ".github/ISSUE_TEMPLATE/a.yml"]) {
      mkdirSync(dirname(join(sparse, path)), { recursive: true })
      writeFileSync(join(sparse, path), "")
    }
    writeFileSync(join(sparse, "registry.json"), "{}")
    mkdirSync(join(sparse, ".git"))
    const shape = pinShape(sparse)
    assert.equal(shape.sparse, true, "no git config at all, and still sparse: the tree says so")
    assert.deepEqual(shape.extra, [])
    assert.equal(shape.sparseCheckoutConfig, null)
    const full = join(root, "full")
    for (const path of ["scripts/x.mjs", "registry.json", "README.md", "plugins/one/manifest.json", "package.json"]) {
      mkdirSync(dirname(join(full, path)), { recursive: true })
      writeFileSync(join(full, path), "")
    }
    const fullShape = pinShape(full)
    assert.equal(fullShape.sparse, false)
    assert.deepEqual(fullShape.extra, ["README.md", "package.json", "plugins"])
    assert.equal(pinShape(join(root, "nowhere")).sparse, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the pin follows XDG and falls back to ~/.cache; omakit has no variable of its own", () => {
  assert.equal(marketplacePinDir(REPO_ROOT, { HOME: "/home/a", XDG_CACHE_HOME: "/cache/a" }), "/cache/a/omakit/marketplace")
  assert.equal(marketplacePinDir(REPO_ROOT, { HOME: "/home/a" }), "/home/a/.cache/omakit/marketplace")
  assert.equal(marketplacePinDir(REPO_ROOT, { HOME: "/home/a", OMAKIT_MARKETPLACE_PIN: "/chosen/pin" }), "/home/a/.cache/omakit/marketplace", "a variable named after the tool does nothing")
})

test("an old in-repository pin is named and never moved silently", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-old-pin-"))
  const old = join(root, ".cache/marketplace")
  mkdirSync(join(old, ".git"), { recursive: true })
  const env = { HOME: join(root, "home") }
  assert.throws(
    () => ensurePin(root, () => {}, env),
    (error) => error.code === "marketplace-pin-migration-required"
      && error.message.includes("15 MB")
      && error.remedy.includes("mkdir -p --")
      && error.remedy.includes("mv --")
      && error.remedy.includes(old),
  )
  assert.ok(!existsSync(marketplacePinDir(root, env)), "the new location was not created")
  assert.ok(existsSync(old), "the old checkout was not moved")
})

test("the pin's size on disk is the checkout's, reached through a symlink or not", () => {
  // Measured before this test existed: `du -sk` on a symlinked checkout
  // measured the link, and `doctor` reported "0.0 MB on disk, sparse" for a
  // 15 MB directory.
  const dir = requirePinForTests()
  const link = join(mkdtempSync(join(tmpdir(), "omakit-pin-link-")), "marketplace")
  symlinkSync(dir, link)
  const direct = pinDiskUsage(dir)
  assert.match(direct, /^\d+(\.\d)? MB on disk$/)
  assert.notEqual(direct, "0.0 MB on disk", "the checkout has a size")
  assert.equal(pinDiskUsage(link), direct, "through the symlink it is the same size")
})

test("the pin's size survives a du that warned about a vanished file, and only a du without a total is unknown", () => {
  // Measured: with `git status` running on the pin in parallel, 1 of 40 du
  // runs warned "cannot access '.git/index.lock'" over git's momentary lock
  // file and exited 1 while still printing the total, and doctor said "size
  // unknown" for a checkout it had the size of; the responsive-output test
  // compared two doctor runs and saw "15 MB on disk" against "size unknown".
  const bin = mkdtempSync(join(tmpdir(), "omakit-du-"))
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  writeFileSync(join(bin, "du"), `#!/bin/sh\necho "du: cannot access '$2/.git/index.lock': No such file or directory" >&2\nprintf '15360\\t%s\\n' "$2"\nexit 1\n`, { mode: 0o755 })
  assert.equal(pinDiskUsage("/any/dir", env), "15 MB on disk", "the printed total is the size, whatever du's exit status")
  writeFileSync(join(bin, "du"), "#!/bin/sh\necho 'du: cannot read directory' >&2\nexit 1\n", { mode: 0o755 })
  assert.equal(pinDiskUsage("/any/dir", env), "size unknown", "no total, no size")
  writeFileSync(join(bin, "du"), "#!/bin/sh\nprintf '5120\\t%s\\n' \"$2\"\n", { mode: 0o755 })
  assert.equal(pinDiskUsage("/any/dir", env), "5.0 MB on disk")
})

// --- two first runs against one cache -------------------------------------------
// Measured on 2026-09-19: two `omakit pin` against one empty cache ran `git
// init` in the same directory, and one died on "cannot copy
// .git/description: File exists" (finding 6 of the acceptance test). The
// fetch now goes into a staging directory under an atomic lock and is
// renamed into place; a process that finds the lock held waits for the
// holder and reads what it left.

test("a held lock is waited for and a stale one is taken over, without a network", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-pin-lock-"))
  try {
    const env = { HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache") }
    const dir = marketplacePinDir(root, env)
    mkdirSync(dirname(dir), { recursive: true })
    // A live holder (this process): the second run waits waitMs and says so.
    mkdirSync(`${dir}.lock`)
    writeFileSync(join(`${dir}.lock`, "holder.json"), JSON.stringify({ pid: process.pid }))
    const lines = []
    assert.throws(() => ensurePin(root, (line) => lines.push(line), env, { populate: () => { throw new Error("must not fetch while another holds the lock") }, waitMs: 300 }), /held the pin's lock .* for 0 s/)
    assert.ok(lines.some((line) => /another omakit is fetching the pin/.test(line.text)))
    // A dead holder: the lock is stale, taken over, and the fetch runs.
    writeFileSync(join(`${dir}.lock`, "holder.json"), JSON.stringify({ pid: 2 ** 22 - 1 }))
    let staged = null
    assert.throws(() => ensurePin(root, () => {}, env, { populate: (staging) => { staged = staging; throw Object.assign(new Error("no network in this test"), { code: "network-unavailable" }) } }), /no network in this test/)
    assert.ok(staged && staged.startsWith(`${dir}.staging-`), "the fetch goes into a staging directory beside the pin")
    assert.equal(existsSync(`${dir}.lock`), false, "the lock is released after a failed fetch")
    assert.equal(existsSync(staged), false, "and the staging directory is removed")
    assert.equal(existsSync(dir), false, "and no pin directory was made")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("two concurrent first runs against one empty cache both succeed, and the pin is whole, sparse and alone", (t) => {
  // The real fetch, twice at once, so it needs the marketplace: skipped when
  // GitHub does not answer within ten seconds.
  const probe = spawnSync("git", ["ls-remote", "--exit-code", MARKETPLACE_PIN.repository, "HEAD"], { timeout: 10_000, encoding: "utf8" })
  if (probe.status !== 0) return t.skip("the marketplace repository is not reachable from here")
  const root = mkdtempSync(join(tmpdir(), "omakit-pin-race-"))
  try {
    // A copy of the tool: this checkout carries a legacy .cache that the migration refusal would name first.
    const tool = join(root, "omakit")
    for (const entry of ["bin", "tools", "package.json"]) cpSync(join(REPO_ROOT, entry), join(tool, entry), { recursive: true })
    const env = { ...process.env, HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache"), TERM: "dumb" }
    const runs = [1, 2].map(() => spawn(process.execPath, [join(tool, "bin/omakit"), "pin"], { env, stdio: ["ignore", "pipe", "pipe"] }))
    return Promise.all(runs.map((child) => new Promise((resolve) => {
      let out = ""
      let err = ""
      child.stdout.on("data", (chunk) => { out += chunk })
      child.stderr.on("data", (chunk) => { err += chunk })
      child.on("exit", (code) => resolve({ code, out, err }))
    }))).then((results) => {
      for (const result of results) assert.equal(result.code, 0, `${result.out}\n${result.err}`)
      assert.ok(results.some((result) => /waiting for it|fetched by the other omakit/.test(result.out)) || results.every((result) => /marketplace pin/.test(result.out)), "one fetched and one waited, or both found it")
      const dir = marketplacePinDir(root, env)
      assert.equal(pinShape(dir).sparse, true)
      assert.deepEqual(readdirSync(dirname(dir)), ["marketplace"], "no lock, no staging, no replaced directory left beside the pin")
      const verify = spawnSync(process.execPath, [join(tool, "bin/omakit"), "pin"], { env, encoding: "utf8", timeout: 120_000 })
      assert.equal(verify.status, 0)
      assert.match(verify.stdout, /present at/)
    }).finally(() => rmSync(root, { recursive: true, force: true }))
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
})
