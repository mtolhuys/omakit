// The entry point, end to end: stdout is an API, and every way a command can
// stop is one failure state in one register.
//
// Measured before these tests existed: a missing pin crashed `submit` with a
// stack trace and named a command that no longer exists; no network crashed
// `watch` and `upgrade` the same way; `setup` printed git's own fatal line and
// then its own; a typo got a bare "unknown command". None of them said what to
// run next.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ARROW, COLUMNS, DENSITY, GUTTER, overflows, plain } from "../../tools/marketplace/style.mjs"
import { materialise, GOOD } from "../fixtures/plugins.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()

function run(args, env = {}, root = REPO_ROOT) {
  const result = spawnSync(process.execPath, [join(root, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined, ...env },
  })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

/**
 * The tool, copied somewhere else: bin/, tools/ and package.json, and no
 * checkout unless one is linked in. The explicit pin override lets these
 * install-shape fixtures stay isolated from the user's shared XDG cache.
 */
function copyOfTool(parent, name = "omakit") {
  const root = join(parent, name)
  for (const entry of ["bin", "tools", "package.json"]) cpSync(join(REPO_ROOT, entry), join(root, entry), { recursive: true })
  return root
}

const good = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })

test("a piped run, a NO_COLOR run and a coloured run say the same words", () => {
  // The words are the contract. FORCE_COLOR stands in for a terminal here,
  // because a test has no pty; what it proves is that colour is the only thing
  // a terminal adds on stdout.
  for (const args of [["help"], [], ["doctor", "--offline"], ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"]]) {
    const piped = run(args)
    const dark = run(args, { NO_COLOR: "1" })
    const lit = run(args, { FORCE_COLOR: "1" })
    assert.equal(dark.out, piped.out, `${args.join(" ")}: NO_COLOR changed the words`)
    assert.equal(plain(lit.out), piped.out, `${args.join(" ")}: colour changed the words`)
    assert.notEqual(lit.out, piped.out, `${args.join(" ")}: colour was applied`)
    assert.equal(piped.err, "", `${args.join(" ")}: nothing on stderr when piped`)
    assert.doesNotMatch(piped.out, /\u001b/, "a piped run carries no escape")
  }
})

test("nothing a command prints is wider than eighty columns", () => {
  for (const args of [["help"], [], ["doctor", "--offline"], ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"]]) {
    const { out } = run(args)
    // Two exemptions, both somebody else's text quoted verbatim: the
    // marketplace's own baseline report, and the issue body, whose checklist
    // sentences are the form's own, character for character.
    const verbatim = [
      ["## Automated security baseline", "Official baseline preview"],
      ["### Repository URL", "This is not posted"],
    ]
    let own = out
    for (const [from, to] of verbatim) {
      if (own.includes(from)) own = own.slice(0, own.indexOf(from)) + own.slice(own.indexOf(to))
    }
    for (const line of own.split("\n")) {
      assert.ok(!overflows(line), `${args.join(" ")}: ${line.length} columns: ${JSON.stringify(line)}`)
    }
  }
})

test("the eighty-column rule does not depend on where the checkout lives", () => {
  // Measured before this test existed: `doctor` prints the pinned checkout's
  // absolute path, so from a 91-column clone path the suite was red and from
  // a 60-column one it was green. The checkout is given a path wider than the
  // whole terminal here (a symlink to the real pin, so nothing is copied), and
  // the rule has to hold: the path is the only thing wider than eighty, it is
  // printed whole on a line of its own, and it is never broken or elided,
  // because an agent reads that line for the path.
  const parent = join(mkdtempSync(join(tmpdir(), "omakit-deep-")), "a/".repeat((COLUMNS - GUTTER) / 2))
  mkdirSync(parent, { recursive: true })
  const root = copyOfTool(parent)
  const cache = join(root, "xdg-cache")
  const deep = join(cache, "omakit/marketplace")
  mkdirSync(join(cache, "omakit"), { recursive: true })
  symlinkSync(requirePinForTests(), deep)
  assert.ok(deep.length > COLUMNS, `the path is deliberately wider than the terminal: ${deep.length}`)

  const { code, out, err } = run(["doctor", "--offline"], { XDG_CACHE_HOME: cache }, root)
  assert.equal(code, 0, err)
  const lines = out.split("\n")
  assert.ok(lines.includes(`${" ".repeat(GUTTER)}${deep}`), `the path is whole, on its own line, in the gutter:\n${out}`)
  for (const line of lines) assert.ok(!overflows(line), `${line.length} columns: ${JSON.stringify(line)}`)
  const wide = lines.filter((line) => line.length > COLUMNS)
  assert.deepEqual(wide.map((line) => line.trim()), [deep], "nothing but the path is wider than eighty")

  // And the failure state that names a missing checkout holds to the same rule.
  const bare = copyOfTool(parent, "omakit-without-a-pin")
  const missing = join(bare, "missing-cache/omakit/marketplace")
  const failure = run(["verify", good.dir], { XDG_CACHE_HOME: join(bare, "missing-cache") }, bare)
  assert.equal(failure.code, 1)
  assertFailureState(failure.err, "marketplace-unavailable", "omakit pin")
  assert.ok(failure.err.includes(missing), "the missing path is named whole")
})

function assertFailureState(err, code, remedy) {
  const lines = err.split("\n")
  assert.equal(lines[0], `${DENSITY.full} FAIL  ${code}`, "what happened, first")
  assert.ok(lines.length >= 3, "what it means, under it")
  assert.ok(lines.some((line) => line.trimStart().startsWith(`${ARROW} `) && line.includes(remedy)), `the one command that fixes it: ${remedy}\n${err}`)
  assert.doesNotMatch(err, /^\s+at /m, "no stack trace")
  for (const line of lines) assert.ok(!overflows(line), `${line.length} columns: ${line}`)
}

test("a missing pin is a failure state naming `omakit pin`, in every command that needs it", () => {
  const nowhere = copyOfTool(mkdtempSync(join(tmpdir(), "omakit-nopin-")))
  const env = { XDG_CACHE_HOME: join(nowhere, "missing-cache") }
  for (const args of [
    ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"],
    ["watch", "https://github.com/omacom/omarchy-plugin-marketplace/issues/1"],
    ["verify", good.dir],
  ]) {
    const { code, out, err } = run(args, env, nowhere)
    assert.equal(code, 1, args.join(" "))
    assert.equal(out, "", "nothing on stdout")
    assertFailureState(err, "marketplace-unavailable", "omakit pin")
  }
  // doctor reports it as a problem rather than stopping, with the same remedy.
  const { code, out } = run(["doctor", "--offline"], env, nowhere)
  assert.equal(code, 1)
  assert.ok(out.includes(`${DENSITY.full} FAIL  pin.checkout`))
  assert.ok(out.includes(`${ARROW} omakit pin`))
  assert.ok(out.includes(`${DENSITY.full} NOT READY  1 problem to fix`))
})

test("an old install reports the one migration command instead of moving the pin", () => {
  const root = copyOfTool(mkdtempSync(join(tmpdir(), "omakit-migrate-")))
  const old = join(root, ".cache/marketplace")
  mkdirSync(join(old, ".git"), { recursive: true })
  const home = join(root, "home")
  const result = run(["pin"], { HOME: home, XDG_CACHE_HOME: undefined }, root)
  assert.equal(result.code, 1)
  assert.equal(result.out, "")
  assertFailureState(result.err, "marketplace-pin-migration-required", "mkdir -p --")
  assert.ok(result.err.includes("mv --"))
  assert.ok(result.err.includes(old))
  assert.ok(!existsSync(join(home, ".cache/omakit/marketplace")), "nothing was moved or created")
})

test("a dirty tree is a failure state, and names the two ways out", () => {
  const dirty = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  writeFileSync(join(dirty.dir, "scratch.txt"), "x\n")
  const { code, out, err } = run(["submit", dirty.dir, "--category", "Widgets", "--tags", "bar", "--offline"])
  assert.equal(code, 1)
  assert.equal(out, "")
  assertFailureState(err, "dirty-worktree", "--allow-dirty")
  assert.ok(err.includes("uncommitted changes"))
})

test("submit without --category or --tags is a usage error before any check runs, with the form's lists on stderr", () => {
  // Measured 2026-09-13: the same run went through every check, the pin
  // spinner and the baseline, and closed with "6 blocking checks failed"
  // for what was two missing flags.
  const { code, out, err } = run(["submit", good.dir])
  assert.equal(code, 2)
  assert.equal(out, "", "nothing on stdout")
  assertFailureState(err, "usage", `omakit submit ${good.dir} --category <c> --tags <a,b>`)
  assert.ok(err.includes("--category and --tags"), "both flags named")
  for (const category of ["Appearance", "Desktop", "Developer Tools", "Hardware", "Kids", "Productivity", "System", "Widgets", "Other"]) {
    assert.ok(err.includes(category), `${category} listed`)
  }
  assert.ok(err.includes("tags, 1 to 3"))
  assert.ok(!err.includes("baseline") && !err.includes("marketplace pin"), "no check ran")
  for (const line of err.split("\n")) assert.ok(!overflows(plain(line)) || /\//.test(line), `${line.length} columns: ${line}`)

  const one = run(["submit", good.dir, "--category", "Widgets"])
  assert.equal(one.code, 2)
  assert.ok(one.err.includes("submit needs --tags"))
  assert.ok(!one.err.includes("--category and"))

  const json = run(["submit", good.dir, "--json"])
  assert.equal(json.code, 2)
  assert.equal(json.err, "")
  const parsed = JSON.parse(json.out)
  assert.deepEqual(parsed.usage.missing, ["--category", "--tags"])
  assert.equal(parsed.usage.categories.length, 9)
  assert.equal(parsed.usage.tags.length, 13)
})

test("a usage error says what was expected and exits 2", () => {
  for (const [args, expected] of [[["submit"], "omakit submit <target>"], [["watch"], "omakit watch <issue-url>"], [["verify"], "omakit verify"]]) {
    const { code, err } = run(args)
    assert.equal(code, 2, args.join(" "))
    assertFailureState(err, "usage", "omakit help")
    assert.ok(err.includes(expected), `${args.join(" ")} names the signature`)
  }
})

test("a typo gets the front door, with the remedy first", () => {
  const { code, out, err } = run(["frobnicate"])
  assert.equal(code, 2)
  assert.equal(out, "")
  assertFailureState(err, "unknown command", "omakit help")
  assert.ok(err.includes("frobnicate"))
  assert.ok(err.includes("omakit setup"), "and lists what exists")
})

test("no network is a failure state, not a stack trace", (t) => {
  // `unshare -rn` gives the process a network namespace with no route out,
  // which is the honest way to take the network away from a real run. Where
  // it is unavailable (not Linux, or user namespaces disabled) this test is
  // skipped rather than faked.
  if (process.platform !== "linux") {
    t.skip("Linux-only: no network is a failure state, not a stack trace (unshare -rn)")
    return
  }
  const probe = spawnSync("unshare", ["-rn", "true"], { encoding: "utf8" })
  if (probe.status !== 0) {
    t.skip("unshare -rn is not available here")
    return
  }
  const offline = (args) => {
    const result = spawnSync("unshare", ["-rn", process.execPath, join(REPO_ROOT, "bin/omakit"), ...args], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined },
    })
    return { code: result.status, out: result.stdout, err: result.stderr }
  }
  const watch = offline(["watch", "https://github.com/omacom/omarchy-plugin-marketplace/issues/4403"])
  assert.equal(watch.code, 1)
  assertFailureState(watch.err, "network-unavailable", "Connect to the network")

  // `submit` without --offline still runs every local check and reports the
  // one that needed the network as the failure it is, with the flag that
  // skips it.
  const submit = offline(["submit", good.dir, "--category", "Widgets", "--tags", "bar"])
  assert.equal(submit.code, 1)
  assert.ok(submit.out.includes(`${DENSITY.full} FAIL  submission.validation-commit`))
  assert.ok(submit.out.includes("--offline"))
  assert.doesNotMatch(submit.err, /^\s+at /m)

  // doctor answers what it can and marks the rest unknown, with the remedy.
  const doctor = offline(["doctor"])
  assert.equal(doctor.code, 0)
  assert.ok(doctor.out.includes(`${DENSITY.medium} ?     pin.freshness`))
  assert.ok(doctor.out.includes("--offline"))
})

test("every command's bytes are the same with and without ttfx on PATH", () => {
  // The one text effect lives behind a terminal; nothing else
  // may change by a byte because a binary happens to be installed.
  const empty = mkdtempSync(join(tmpdir(), "omakit-no-ttfx-"))
  const without = { PATH: `${empty}:${process.env.PATH}` }
  const fake = mkdtempSync(join(tmpdir(), "omakit-fake-ttfx-"))
  writeFileSync(join(fake, "ttfx"), "#!/bin/sh\necho 'ttfx 0.0.0-fake'\n", { mode: 0o755 })
  const withFake = { PATH: `${fake}:${process.env.PATH}` }
  for (const args of [["help"], [], ["doctor", "--offline"], ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"]]) {
    for (const env of [{}, { FORCE_COLOR: "1" }]) {
      const a = run(args, { ...env, ...without })
      const b = run(args, { ...env, ...withFake })
      assert.equal(b.out, a.out, `${args.join(" ")}: stdout changed with ttfx on PATH`)
      assert.equal(b.err, a.err, `${args.join(" ")}: stderr changed with ttfx on PATH`)
      assert.equal(b.code, a.code)
    }
  }
})
