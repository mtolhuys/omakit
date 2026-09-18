// `omakit upgrade` exists against an earlier judgement of mine, so the limits
// that made it defensible are the part that must not rot.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installKind, upgrade, upgradeCommand, isExpectedRemote, NPM_UPGRADE_ARGS, REPOSITORY } from "../../tools/marketplace/upgrade.mjs"
import { REPO_ROOT } from "./helpers.mjs"

function repo(remote = REPOSITORY) {
  const dir = mkdtempSync(join(tmpdir(), "omakit-upgrade-"))
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { timeout: 120_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-q", "-b", "main")
  git("config", "user.name", "t")
  git("config", "user.email", "t@example.invalid")
  if (remote) git("remote", "add", "origin", remote)
  writeFileSync(join(dir, "f"), "one\n")
  git("add", "-A")
  git("commit", "-q", "-m", "one")
  return { dir, git }
}

function collect() {
  const lines = []
  return { stream: { isTTY: false, write: (s) => lines.push(s) }, text: () => lines.join("") }
}

test("the same repository in any spelling is accepted, anything else is not", () => {
  for (const url of [
    "https://github.com/mtolhuys/omakit",
    "https://github.com/mtolhuys/omakit.git",
    "https://github.com/MTolhuys/Omakit/",
    "git@github.com:mtolhuys/omakit.git",
  ]) assert.equal(isExpectedRemote(url), true, url)
  for (const url of ["https://github.com/someone/omakit", "https://example.com/mtolhuys/omakit", "", null]) {
    assert.equal(isExpectedRemote(url), false, String(url))
  }
})

/**
 * An npm install as npm lays it out: <root>/node_modules/omakit with a
 * package.json, and a fake `npm` on PATH that answers `root --global` with
 * that root and, on install, rewrites the version to whatever spec it got and
 * records its argv. Nothing here touches the network or the real npm.
 */
function npmInstall(version) {
  const home = mkdtempSync(join(tmpdir(), "omakit-npm-"))
  const root = join(home, "lib/node_modules")
  const pkg = join(root, "omakit")
  mkdirSync(join(pkg, "tools"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "omakit", version }) + "\n")
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "npm"), [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> "${join(home, "npm-argv")}"`,
    `if [ "$1" = "root" ]; then echo "${root}"; exit 0; fi`,
    "if [ \"$1\" = \"install\" ]; then",
    "  for arg in \"$@\"; do case \"$arg\" in omakit@*) v=${arg#omakit@};; esac; done",
    `  printf '{"name":"omakit","version":"%s"}\\n' "$v" > "${join(pkg, "package.json")}"`,
    "  exit 0",
    "fi",
    "exit 2",
  ].join("\n") + "\n")
  chmodSync(join(bin, "npm"), 0o755)
  return {
    pkg,
    root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    argv: () => { try { return readFileSync(join(home, "npm-argv"), "utf8").trim().split("\n") } catch { return [] } },
  }
}

async function withPath(env, fn) {
  const saved = process.env.PATH
  process.env.PATH = env.PATH
  try { return await fn() } finally { process.env.PATH = saved }
}

test("an npm install is upgraded through the npm that owns it, at the exact version the registry named", async () => {
  const fake = npmInstall("0.1.0")
  const io = collect()
  const result = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: io.stream, latest: async () => "0.1.1" }))
  assert.equal(result.ok, true, io.text())
  assert.deepEqual({ from: result.from, to: result.to }, { from: "0.1.0", to: "0.1.1" })
  assert.match(io.text(), /0\.1\.0 to 0\.1\.1, through the npm that installed it/)
  assert.deepEqual(fake.argv(), ["root --global", `${NPM_UPGRADE_ARGS.join(" ")} omakit@0.1.1`], "npm is called with the frozen arguments and the exact version")
  assert.doesNotMatch(io.text(), /sudo/)
  for (const line of io.text().split("\n")) assert.ok(line.length <= 80, `${line.length} columns: ${line}`)
})

test("an npm install that is already current is left alone, and --dry-run applies nothing", async () => {
  const fake = npmInstall("0.1.0")
  const io = collect()
  const current = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: io.stream, latest: async () => "0.1.0" }))
  assert.deepEqual(current, { ok: true, changed: false, version: "0.1.0" })
  assert.match(io.text(), /already current at 0\.1\.0/)
  const dry = collect()
  const result = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: dry.stream, dryRun: true, latest: async () => "0.1.1" }))
  assert.deepEqual(result, { ok: true, changed: false, version: "0.1.0", available: "0.1.1" })
  assert.match(dry.text(), /0\.1\.1 is published, this is 0\.1\.0; not applied \(--dry-run\)/)
  assert.match(dry.text(), new RegExp(`npm ${NPM_UPGRADE_ARGS.join(" ")} omakit@0\\.1\\.1`), "the command it would run is printed whole")
  assert.deepEqual(fake.argv(), ["root --global", "root --global"], "npm was asked where it installs, and nothing else")
})

test("an npm install that the npm on PATH does not own is refused, with the path named", async () => {
  const fake = npmInstall("0.1.0")
  const elsewhere = join(mkdtempSync(join(tmpdir(), "omakit-elsewhere-")), "node_modules/omakit")
  mkdirSync(elsewhere, { recursive: true })
  writeFileSync(join(elsewhere, "package.json"), JSON.stringify({ name: "omakit", version: "0.1.0" }) + "\n")
  const io = collect()
  const result = await withPath(fake.env, () => upgrade({ repoRoot: elsewhere, stream: io.stream, latest: async () => "0.1.1" }))
  assert.equal(result.ok, false)
  assert.match(io.text(), /installed at[\s\S]*elsewhere[\s\S]*node_modules\/omakit/)
  assert.match(io.text(), /→ npm install --global omakit@latest/)
  assert.deepEqual(fake.argv(), ["root --global"], "nothing was installed")
})

test("npm upgrades never downgrade development versions or execute invalid registry targets", async () => {
  const fake = npmInstall("0.4.0")
  const io = collect()
  const ahead = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: io.stream, latest: async () => "0.3.0" }))
  assert.deepEqual(ahead, { ok: true, changed: false, version: "0.4.0" })
  assert.match(io.text(), /no downgrade\s+applied/)
  const invalid = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: collect().stream, latest: async () => "latest;echo x" }))
  assert.equal(invalid.ok, false)
  assert.deepEqual(fake.argv(), ["root --global", "root --global"], "neither path installs anything")
})

test("an npm install with no registry answer is a refusal with a remedy, not a guess", async () => {
  const fake = npmInstall("0.1.0")
  const io = collect()
  const result = await withPath(fake.env, () => upgrade({ repoRoot: fake.pkg, stream: io.stream, latest: async () => null }))
  assert.equal(result.ok, false)
  assert.match(io.text(), /registry did not answer/)
  assert.match(io.text(), /Connect to the network/)
})

test("package installs name the command that updates them", () => {
  assert.equal(installKind("/usr/lib/node_modules/omakit"), "npm")
  assert.equal(upgradeCommand("/usr/lib/node_modules/omakit"), "omakit upgrade")
  assert.equal(installKind("/usr/lib/omakit"), "distro")
  assert.equal(upgradeCommand("/usr/lib/omakit"), "sudo pacman -Syu omakit")
  // A clone made here, not this checkout: the suite runs green from
  // `git archive`, which has no `.git`.
  const { dir: clone } = repo()
  assert.equal(installKind(clone), "git")
  assert.equal(upgradeCommand(clone), "omakit upgrade")
})

test("it refuses an unexpected remote rather than pulling from it", async () => {
  const { dir } = repo("https://github.com/someone-else/omakit")
  const io = collect()
  const result = await upgrade({ repoRoot: dir, stream: io.stream })
  assert.equal(result.ok, false)
  assert.match(io.text(), /someone-else/)
  assert.match(io.text(), /not this command's business/)
})

test("it refuses a dirty tree", async () => {
  const { dir } = repo()
  writeFileSync(join(dir, "f"), "changed\n")
  const io = collect()
  const result = await upgrade({ repoRoot: dir, stream: io.stream })
  assert.equal(result.ok, false)
  assert.match(io.text(), /local changes/)
})

test("it refuses a detached HEAD", async () => {
  const { dir, git } = repo()
  git("checkout", "-q", "--detach", "HEAD")
  const io = collect()
  const result = await upgrade({ repoRoot: dir, stream: io.stream })
  assert.equal(result.ok, false)
  assert.match(io.text(), /detached HEAD/)
})

test("an origin that cannot be reached is a refusal with a remedy, not a stack trace", async () => {
  // Measured: with the network down, `omakit upgrade` died in git's own error
  // with a Node stack under it. A remote that does not exist fails the same
  // fetch the same way, without needing the network taken away.
  const gone = join(mkdtempSync(join(tmpdir(), "omakit-gone-")), "nowhere.git")
  const { dir } = repo(gone)
  const io = collect()
  const result = await upgrade({ repoRoot: dir, stream: io.stream, expectedRemote: gone })
  assert.equal(result.ok, false)
  assert.match(io.text(), /REFUSED  origin could not be fetched/)
  assert.match(io.text(), /→ Connect to the network, then run omakit upgrade again/)
  assert.doesNotMatch(io.text(), /^\s+at /m)
  for (const line of io.text().split("\n")) assert.ok(line.length <= 80, `${line.length} columns: ${line}`)
})

test("every refusal is in the one register, and fits", async () => {
  const { dir } = repo("https://github.com/someone-else/omakit")
  const io = collect()
  await upgrade({ repoRoot: dir, stream: io.stream })
  const lines = io.text().split("\n")
  assert.match(lines[0], /^█ REFUSED  /)
  assert.ok(lines.some((line) => line.startsWith("→ git -C ")), "the one command to run")
  for (const line of lines) assert.ok(line.length <= 80, `${line.length} columns: ${line}`)
})

test("it never touches the pin, and says so", () => {
  const file = readFileSync(join(REPO_ROOT, "tools/marketplace/upgrade.mjs"), "utf8")
  // Comments stripped: the header explains the distinction in prose, and the
  // check is about what the code does, not about what it explains.
  const source = file.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  // The distinction this command was allowed to exist on.
  for (const name of ["ensurePin", "MARKETPLACE_PIN", ".cache"]) {
    assert.ok(!source.includes(name), `upgrade.mjs references ${name}; it must not`)
  }
  assert.match(source, /--ff-only/, "fast-forward only")
  assert.ok(!source.includes('"rebase"') && !source.includes('"reset"'), "no history rewriting")
  assert.ok(!source.includes('"push"'), "nothing is written to a remote")
})

test("the successful path: it fast-forwards, reports, and is idempotent", async () => {
  // Against a local remote, because the real one cannot be both ahead of a
  // checkout and known to it at the same time while this command is the newest
  // thing in it.
  const origin = mkdtempSync(join(tmpdir(), "omakit-origin-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { timeout: 120_000 })

  const author = mkdtempSync(join(tmpdir(), "omakit-author-"))
  const write = (...args) => execFileSync("git", ["-C", author, ...args], { timeout: 120_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  execFileSync("git", ["clone", "-q", origin, author], { timeout: 120_000 })
  write("config", "user.name", "t")
  write("config", "user.email", "t@example.invalid")
  writeFileSync(join(author, "f"), "one\n")
  write("add", "-A")
  write("commit", "-q", "-m", "one")
  write("push", "-q", "origin", "main")

  const clone = mkdtempSync(join(tmpdir(), "omakit-clone-"))
  execFileSync("git", ["clone", "-q", origin, clone], { timeout: 120_000 })
  const behind = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { timeout: 120_000, encoding: "utf8" }).trim()

  writeFileSync(join(author, "f"), "two\n")
  write("commit", "-q", "-am", "two")
  writeFileSync(join(author, "f"), "three\n")
  write("commit", "-q", "-am", "three")
  write("push", "-q", "origin", "main")

  // The completion refresh is the new omakit's own step, run as a child of
  // the entry point just installed; here the clone has no entry point, so a
  // stub records the call and what root it was given.
  const refreshed = []
  const refreshCompletion = (root, stream) => { refreshed.push(root); stream.write("completion refreshed\n"); return { ran: true, ok: true } }
  const dry = collect()
  const preview = await upgrade({ repoRoot: clone, stream: dry.stream, dryRun: true, expectedRemote: origin, refreshCompletion })
  assert.equal(preview.ok, true)
  assert.equal(preview.changed, false)
  assert.equal(preview.available, 2)
  assert.match(dry.text(), /not applied \(--dry-run\)/)
  assert.equal(execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { timeout: 120_000, encoding: "utf8" }).trim(), behind,
    "a dry run must not move anything")

  const io = collect()
  const result = await upgrade({ repoRoot: clone, stream: io.stream, expectedRemote: origin, refreshCompletion })
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(result.commits, 2)
  assert.equal(result.from, behind)
  assert.match(io.text(), /2 commit\(s\)/)
  assert.match(io.text(), /The marketplace pin did not move/)
  assert.equal(readFileSync(join(clone, "f"), "utf8"), "three\n", "the working tree is actually updated")
  // After the fast-forward, and only then: the completion step of the new
  // omakit, at the clone's root, its output relayed.
  assert.deepEqual(refreshed, [clone], "refreshed once, after the install, never on the dry run")
  assert.match(io.text(), /completion refreshed/)
  assert.deepEqual(result.completion, { ran: true, ok: true })

  const again = collect()
  const second = await upgrade({ repoRoot: clone, stream: again.stream, expectedRemote: origin, refreshCompletion })
  assert.equal(second.changed, false)
  assert.match(again.text(), /already current/)
})

test("it refuses a checkout that has diverged rather than merging it", async () => {
  const origin = mkdtempSync(join(tmpdir(), "omakit-origin2-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { timeout: 120_000 })
  const author = mkdtempSync(join(tmpdir(), "omakit-author2-"))
  execFileSync("git", ["clone", "-q", origin, author], { timeout: 120_000 })
  const write = (...args) => execFileSync("git", ["-C", author, ...args], { timeout: 120_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  write("config", "user.name", "t"); write("config", "user.email", "t@example.invalid")
  writeFileSync(join(author, "f"), "one\n"); write("add", "-A"); write("commit", "-q", "-m", "one"); write("push", "-q", "origin", "main")

  const clone = mkdtempSync(join(tmpdir(), "omakit-clone2-"))
  execFileSync("git", ["clone", "-q", origin, clone], { timeout: 120_000 })
  const local = (...args) => execFileSync("git", ["-C", clone, ...args], { timeout: 120_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  local("config", "user.name", "t"); local("config", "user.email", "t@example.invalid")
  writeFileSync(join(clone, "g"), "mine\n"); local("add", "-A"); local("commit", "-q", "-m", "mine")

  writeFileSync(join(author, "f"), "two\n"); write("commit", "-q", "-am", "two"); write("push", "-q", "origin", "main")

  const io = collect()
  const result = await upgrade({ repoRoot: clone, stream: io.stream, expectedRemote: origin })
  assert.equal(result.ok, false)
  assert.match(io.text(), /cannot be fast-forwarded/)
})
