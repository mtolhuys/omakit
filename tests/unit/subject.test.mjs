// Target parsing. Measured before this test existed: a quoted
// '~/Projects/plugin/example' was refused as
// "no such directory: <cwd>/~/Projects/plugin/example", because the shell
// expands an unquoted ~ and omakit did not expand a literal one. An agent
// assembling a command, or a person quoting a path with a space in it, hit it.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseTarget, resolveSubject, SubjectError } from "../../tools/subject/resolve.mjs"
import { REPO_ROOT } from "./helpers.mjs"

test("a leading ~ is the home directory, and nothing else about a path changes", () => {
  const home = homedir()
  assert.equal(parseTarget("~").path, home)
  assert.equal(parseTarget("~/x").path, join(home, "x"))
  assert.equal(parseTarget("~/x/../y").path, join(home, "y"), "resolved after expansion")
  // ~user needs a password database and is not expanded.
  assert.equal(parseTarget("~x").path, resolve("~x"))
  assert.equal(parseTarget("~x/y").path, resolve("~x/y"))
  // A tilde later in the path is just a character.
  assert.equal(parseTarget("/x/~/y").path, "/x/~/y")
  assert.equal(parseTarget("./x").path, resolve("x"))
  assert.equal(parseTarget("/x").path, "/x")
  assert.equal(parseTarget("").path, resolve(""))
})

test("the quoted and unquoted forms resolve to the same subject", () => {
  // The unquoted form is what the shell hands over: the home directory spelled
  // out. The quoted form is the literal tilde. Both must name one path.
  const spelled = join(homedir(), "Projects/plugin/example")
  assert.equal(parseTarget("~/Projects/plugin/example").path, parseTarget(spelled).path)
})

test("a symbolic link to a repository is the repository: no subdirectory is invented, and inspect, verify and submit agree", () => {
  // Measured on 2026-09-19: `inspect /tmp/tm-link` (a link to /tmp/tm)
  // looked for a manifest at /tmp/tm/link and exited 2, while verify and
  // submit read the same link fine (finding 5 of the acceptance test).
  const root = mkdtempSync(join(tmpdir(), "omakit-symlink-"))
  try {
    const repo = join(root, "tm")
    mkdirSync(repo)
    writeFileSync(join(repo, "manifest.json"), "{}\n")
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture")
    const link = join(root, "tm-link")
    symlinkSync(repo, link)
    const direct = resolveSubject(repo, { cacheRoot: root })
    const linked = resolveSubject(link, { cacheRoot: root })
    assert.equal(linked.subdir, "", "no subdirectory is invented from the link's name")
    assert.equal(linked.dir, direct.dir)
    assert.equal(linked.commit, direct.commit)
    // A link to a directory below the root is that subdirectory.
    mkdirSync(join(repo, "plugin"))
    writeFileSync(join(repo, "plugin/manifest.json"), "{}\n")
    git("add", "-A")
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "sub")
    symlinkSync(join(repo, "plugin"), join(root, "plugin-link"))
    assert.equal(resolveSubject(join(root, "plugin-link"), { cacheRoot: root }).subdir, "plugin")
    // Through the entry point: inspect reads the linked tree and exits 0.
    const inspected = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), "inspect", link, "--offline", "--json"], { timeout: 120_000, encoding: "utf8", env: { ...process.env, TERM: "dumb" } })
    assert.equal(inspected.status, 0, inspected.stderr)
    assert.equal(JSON.parse(inspected.stdout).ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a missing directory is still refused, naming the resolved path", () => {
  const cacheRoot = join(homedir(), ".cache-that-does-not-matter")
  assert.throws(
    () => resolveSubject("~/omakit-no-such-directory-8f3a", { cacheRoot }),
    (error) => error instanceof SubjectError
      && error.code === "subject-not-found"
      && error.message === `no such directory: ${join(homedir(), "omakit-no-such-directory-8f3a")}`,
  )
})
