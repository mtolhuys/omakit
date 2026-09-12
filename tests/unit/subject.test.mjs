// Target parsing. Measured before this test existed: a quoted
// '~/Projects/plugin/example' was refused as
// "no such directory: <cwd>/~/Projects/plugin/example", because the shell
// expands an unquoted ~ and omakit did not expand a literal one. An agent
// assembling a command, or a person quoting a path with a space in it, hit it.
import test from "node:test"
import assert from "node:assert/strict"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseTarget, resolveSubject, SubjectError } from "../../tools/subject/resolve.mjs"

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

test("a missing directory is still refused, naming the resolved path", () => {
  const cacheRoot = join(homedir(), ".cache-that-does-not-matter")
  assert.throws(
    () => resolveSubject("~/omakit-no-such-directory-8f3a", { cacheRoot }),
    (error) => error instanceof SubjectError
      && error.code === "subject-not-found"
      && error.message === `no such directory: ${join(homedir(), "omakit-no-such-directory-8f3a")}`,
  )
})
