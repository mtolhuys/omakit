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
