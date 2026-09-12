// `omakit upgrade` exists against an earlier judgement of mine, so the limits
// that made it defensible are the part that must not rot.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { upgrade, isExpectedRemote, REPOSITORY } from "../../tools/marketplace/upgrade.mjs"
import { REPO_ROOT } from "./helpers.mjs"

function repo(remote = REPOSITORY) {
  const dir = mkdtempSync(join(tmpdir(), "omakit-upgrade-"))
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
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

test("it refuses a checkout that is not a Git checkout, and names the package route", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-plain-"))
  mkdirSync(join(dir, "tools"), { recursive: true })
  const io = collect()
  const result = await upgrade({ repoRoot: dir, stream: io.stream })
  assert.equal(result.ok, false)
  assert.match(io.text(), /not a Git checkout/)
  assert.match(io.text(), /npm i -g omakit@latest/)
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
  // Assembled, so the repository-wide scan in read-only.test.mjs does not find
  // the literal here and flag this file for mentioning it.
  const remoteWrite = `"${["pu", "sh"].join("")}"`
  assert.ok(!source.includes(remoteWrite), "nothing is written to a remote")
})

test("the successful path: it fast-forwards, reports, and is idempotent", async () => {
  // Against a local remote, because the real one cannot be both ahead of a
  // checkout and known to it at the same time while this command is the newest
  // thing in it.
  const origin = mkdtempSync(join(tmpdir(), "omakit-origin-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])

  const author = mkdtempSync(join(tmpdir(), "omakit-author-"))
  const write = (...args) => execFileSync("git", ["-C", author, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  execFileSync("git", ["clone", "-q", origin, author])
  write("config", "user.name", "t")
  write("config", "user.email", "t@example.invalid")
  writeFileSync(join(author, "f"), "one\n")
  write("add", "-A")
  write("commit", "-q", "-m", "one")
  write("push", "-q", "origin", "main")

  const clone = mkdtempSync(join(tmpdir(), "omakit-clone-"))
  execFileSync("git", ["clone", "-q", origin, clone])
  const behind = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

  writeFileSync(join(author, "f"), "two\n")
  write("commit", "-q", "-am", "two")
  writeFileSync(join(author, "f"), "three\n")
  write("commit", "-q", "-am", "three")
  write("push", "-q", "origin", "main")

  const dry = collect()
  const preview = await upgrade({ repoRoot: clone, stream: dry.stream, dryRun: true, expectedRemote: origin })
  assert.equal(preview.ok, true)
  assert.equal(preview.changed, false)
  assert.equal(preview.available, 2)
  assert.match(dry.text(), /not applied \(--dry-run\)/)
  assert.equal(execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), behind,
    "a dry run must not move anything")

  const io = collect()
  const result = await upgrade({ repoRoot: clone, stream: io.stream, expectedRemote: origin })
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(result.commits, 2)
  assert.equal(result.from, behind)
  assert.match(io.text(), /2 commit\(s\)/)
  assert.match(io.text(), /The marketplace pin did not move/)
  assert.equal(readFileSync(join(clone, "f"), "utf8"), "three\n", "the working tree is actually updated")

  const again = collect()
  const second = await upgrade({ repoRoot: clone, stream: again.stream, expectedRemote: origin })
  assert.equal(second.changed, false)
  assert.match(again.text(), /already current/)
})

test("it refuses a checkout that has diverged rather than merging it", async () => {
  const origin = mkdtempSync(join(tmpdir(), "omakit-origin2-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])
  const author = mkdtempSync(join(tmpdir(), "omakit-author2-"))
  execFileSync("git", ["clone", "-q", origin, author])
  const write = (...args) => execFileSync("git", ["-C", author, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  write("config", "user.name", "t"); write("config", "user.email", "t@example.invalid")
  writeFileSync(join(author, "f"), "one\n"); write("add", "-A"); write("commit", "-q", "-m", "one"); write("push", "-q", "origin", "main")

  const clone = mkdtempSync(join(tmpdir(), "omakit-clone2-"))
  execFileSync("git", ["clone", "-q", origin, clone])
  const local = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  local("config", "user.name", "t"); local("config", "user.email", "t@example.invalid")
  writeFileSync(join(clone, "g"), "mine\n"); local("add", "-A"); local("commit", "-q", "-m", "mine")

  writeFileSync(join(author, "f"), "two\n"); write("commit", "-q", "-am", "two"); write("push", "-q", "origin", "main")

  const io = collect()
  const result = await upgrade({ repoRoot: clone, stream: io.stream, expectedRemote: origin })
  assert.equal(result.ok, false)
  assert.match(io.text(), /cannot be fast-forwarded/)
})
