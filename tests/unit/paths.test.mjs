// A path for a person is written the way a shell takes it. Measured on 0.1.8:
// `omakit doctor` printed the pin as /home/<user>/.cache/omakit/marketplace,
// which is the one path every user has and nobody types that way. `--json`
// keeps every path absolute, so the abbreviation lives in the renderers and
// in this one helper, never in a result.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { withHomeAbbreviated } from "../../tools/marketplace/paths.mjs"
import { renderDoctor } from "../../tools/marketplace/report.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const env = { HOME: "/home/someone" }

test("a path under $HOME is written with ~, at its start and inside prose or a command", () => {
  assert.equal(withHomeAbbreviated("/home/someone/.cache/omakit/marketplace", env), "~/.cache/omakit/marketplace")
  assert.equal(withHomeAbbreviated("/home/someone", env), "~")
  assert.equal(withHomeAbbreviated("pin at /home/someone/.cache/omakit (/home/someone/x) and PATH=\"/home/someone/bin:$PATH\"", env),
    "pin at ~/.cache/omakit (~/x) and PATH=\"~/bin:$PATH\"")
  assert.equal(withHomeAbbreviated("/home/someone/x", { HOME: "/home/someone/" }), "~/x", "a trailing slash on HOME is not part of it")
})

test("a path outside $HOME, or one that merely contains it, is left alone", () => {
  assert.equal(withHomeAbbreviated("/tmp/omakit-fixture/plugin", env), "/tmp/omakit-fixture/plugin")
  assert.equal(withHomeAbbreviated("/home/someoneelse/x", env), "/home/someoneelse/x", "a longer user name")
  assert.equal(withHomeAbbreviated("/tmp/home/someone/x", env), "/tmp/home/someone/x", "the home directory in the middle of a path")
  assert.equal(withHomeAbbreviated("https://github.com/home/someone", env), "https://github.com/home/someone")
})

test("with HOME unset, or not an absolute path, nothing is abbreviated", () => {
  assert.equal(withHomeAbbreviated("/home/someone/x", {}), "/home/someone/x")
  assert.equal(withHomeAbbreviated("/home/someone/x", { HOME: "" }), "/home/someone/x")
  assert.equal(withHomeAbbreviated("/home/someone/x", { HOME: "/" }), "/home/someone/x", "a HOME of / would abbreviate everything")
  assert.equal(withHomeAbbreviated("/home/someone/x", { HOME: "relative" }), "/home/someone/x")
})

test("doctor and pin print the pin path with ~ for a person, and --json keeps it absolute", () => {
  const pinDir = requirePinForTests()
  const run = (args, extra = {}) => spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined, ...extra },
  })
  // The checkout is where it is; a HOME above it makes it a path under HOME.
  const home = pinDir.slice(0, pinDir.indexOf("/.cache/"))
  assert.ok(home, `the pin at ${pinDir} is expected under a .cache directory`)
  const human = run(["doctor", "--offline"], { HOME: home }).stdout
  assert.ok(human.includes(`at\n${" ".repeat(8)}~/.cache/omakit/marketplace`) || human.includes("at ~/.cache/omakit/marketplace"), human)
  assert.ok(!human.includes(pinDir), "the absolute path is not printed for a person")
  const json = JSON.parse(run(["doctor", "--offline", "--json"], { HOME: home }).stdout)
  assert.ok(json.checks.find((check) => check.id === "pin.checkout").detail.includes(pinDir), "--json stays absolute")
  assert.ok(!JSON.stringify(json).includes("~/"), "nowhere in the JSON")
  const pin = run(["pin"], { HOME: home }).stdout
  assert.ok(pin.includes("present at ~/.cache/omakit/marketplace"), pin)

  // The renderer is where it happens, from the result it is given.
  const result = { checks: [{ id: "pin.checkout", state: "ok", detail: "38060f8 at /home/someone/.cache/omakit/marketplace", action: `Remove /home/someone/.cache/omakit/marketplace and run \`omakit pin\`` }], problems: 0 }
  const rendered = renderDoctor(result, { colour: false, env })
  assert.ok(rendered.includes("38060f8 at ~/.cache/omakit/marketplace"))
  assert.ok(rendered.includes("Remove ~/.cache/omakit/marketplace and run"))
  assert.equal(result.checks[0].detail, "38060f8 at /home/someone/.cache/omakit/marketplace", "the result is untouched")
})
