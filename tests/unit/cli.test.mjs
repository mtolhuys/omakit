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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
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
// disk-lens at the pin: the id the catalog lists, from the repository that lists it.
const LISTED_MANIFEST = JSON.stringify({ ...JSON.parse(GOOD["manifest.json"]), id: "io.github.mtolhuys.disk-lens" }) + "\n"
const own = materialise({ ...GOOD, "manifest.json": LISTED_MANIFEST }, { origin: "https://github.com/mtolhuys/omarchy-disk-lens" })
const taken = materialise({ ...GOOD, "manifest.json": LISTED_MANIFEST }, { origin: "https://github.com/example/omarchy-plugin-fixture-taken" })

test("a piped run, a NO_COLOR run and a coloured run say the same words", () => {
  // The words are the contract. FORCE_COLOR stands in for a terminal here,
  // because a test has no pty; what it proves is that colour is the only thing
  // a terminal adds on stdout.
  for (const args of [["help"], [], ["doctor", "--offline"], ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"], ["submit", own.dir, "--offline"], ["submit", taken.dir, "--offline"]]) {
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

test("nothing omakit writes itself is wider than eighty columns; the two verbatim regions are named, not stripped", () => {
  // The contract (CONTRIBUTING.md, "stdout is an API"): text that will be
  // posted verbatim is never wrapped and may exceed eighty columns, because
  // a wrapped body would not be the body; everything omakit writes itself
  // stays within eighty. Two regions are verbatim: the marketplace's own
  // baseline report, and the issue body rendered from the pinned form. Each
  // is found by its section heading, and each is asserted to be exactly the
  // text `--json` carries for it, line for line, so the exemption covers
  // that text and not a line more. Every other line is held to the rule.
  // Measured on 0.1.6: the old test cut the regions out by two markers
  // apiece, and three lines of 114, 82 and 91 columns inside them were the
  // reason the contract needed stating.
  const regions = [
    { marker: "the marketplace's own baseline report for this commit", text: (json) => json.baseline?.officialReport },
    { marker: "issue body", text: (json) => json.issue?.body?.trimEnd() },
  ]
  for (const args of [["help"], [], ["doctor", "--offline"], ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"], ["submit", own.dir, "--offline"], ["submit", taken.dir, "--offline"]]) {
    const { out } = run(args)
    const lines = out.split("\n")
    const json = args[0] === "submit" ? JSON.parse(run([...args, "--json"]).out) : {}
    const verbatim = new Set()
    for (const region of regions) {
      const text = region.text(json)
      const at = lines.indexOf(region.marker)
      if (!text) {
        assert.equal(at, -1, `${args.join(" ")}: a "${region.marker}" section with nothing verbatim to hold`)
        continue
      }
      assert.ok(at >= 0, `${args.join(" ")}: no "${region.marker}" section`)
      // The heading and its rule are omakit's; the region starts under them.
      const start = at + 2
      const expected = text.split("\n")
      assert.deepEqual(lines.slice(start, start + expected.length), expected, `${args.join(" ")}: the "${region.marker}" region is the verbatim text, line for line`)
      for (let index = start; index < start + expected.length; index += 1) verbatim.add(index)
    }
    for (const [index, line] of lines.entries()) {
      if (verbatim.has(index)) continue
      assert.ok(!overflows(line), `${args.join(" ")}: line ${index + 1}, ${line.length} columns: ${JSON.stringify(line)}`)
    }
  }
})

test("under a pseudo-terminal, a successful doctor writes nothing but its progress line to stderr", (t) => {
  // The contract: stderr carries interactive decoration (the progress line,
  // the chooser) only when stderr is a TTY; a piped stderr is empty on
  // success (the three-way test above); failures go to stderr always. A pipe
  // cannot see the first clause, so this runs the command under script(1)
  // with stdout sent away and stderr left on the terminal, and reads back
  // what reached it: clear-line sequences, the track, a label, and nothing
  // else. util-linux script only; a BSD script has other flags, and a
  // machine without one skips, as the ttfx test does.
  const probe = spawnSync("script", ["--version"], { encoding: "utf8" })
  if (probe.status !== 0 || !/util-linux/.test(probe.stdout)) {
    t.skip("util-linux script(1) is not installed here")
    return
  }
  // A HOME of its own: at a terminal, a command also prints the once-a-day
  // notice when this machine's completion script names another omakit,
  // which is that machine's state and not this contract's. Measured: the
  // test went red on a machine whose script said 0.2.0 the moment
  // package.json said 0.2.1. The pin is still read from the real cache.
  const home = mkdtempSync(join(tmpdir(), "omakit-pty-home-"))
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(join(REPO_ROOT, "bin/omakit"))} doctor --offline >/dev/null`
  const result = spawnSync("script", ["-qec", command, "/dev/null"], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", TERM: "xterm", FORCE_COLOR: undefined, NO_COLOR: undefined, HOME: home, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || join(process.env.HOME, ".cache") },
  })
  assert.equal(result.status, 0, result.stdout)
  const CLEAR = "\r\u001b[2K"
  const frames = result.stdout.split(CLEAR)
  assert.equal(frames[0], "", "the first byte on stderr is a clear")
  assert.equal(frames.at(-1), "", "and so is the last: the line is gone when the command is done")
  assert.ok(frames.length >= 3, "at least one frame was drawn")
  const frame = new RegExp(`^(?:(?:\\u001b\\[[0-9;]*m)?[${DENSITY.floor}${DENSITY.full}]+(?:\\u001b\\[0m)?)+ [^\\r\\n\\u001b]+$`)
  for (const drawn of frames.slice(1, -1)) {
    assert.match(drawn, frame, `a frame that is not the track and a label: ${JSON.stringify(drawn)}`)
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

  // HOME is placed beside the checkout, not above it, so the path is not
  // abbreviated to ~ and the rule is tested on the whole absolute path.
  const { code, out, err } = run(["doctor", "--offline"], { XDG_CACHE_HOME: cache, HOME: join(root, "home") }, root)
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
  // The arrow line wraps at 80 columns and its continuation sits under the
  // arrow's text, so the remedy is read back across those lines. Measured:
  // a fixture under a 55-character tmpdir wrapped the usage remedy onto
  // three lines and this assertion, reading one line, went red only there.
  const arrows = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trimStart().startsWith(`${ARROW} `)) continue
    const indent = lines[index].indexOf(ARROW) + 2
    let text = lines[index].trimStart().slice(2)
    while (index + 1 < lines.length && lines[index + 1].startsWith(" ".repeat(indent)) && lines[index + 1].trim()) {
      index += 1
      text += ` ${lines[index].trim()}`
    }
    arrows.push(text)
  }
  assert.ok(arrows.some((text) => text.includes(remedy)), `the one command that fixes it: ${remedy}\n${err}`)
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
  assert.deepEqual(Object.keys(parsed.usage), ["missing", "categories", "tags", "maximumTags"], "the JSON shape is unchanged")
})

/** A wrapped shell command (` \\` newline, indented continuation) as one line. */
function unwrapped(text) {
  return text.replace(/ \\\n\s+/g, " ")
}

test("an id taken by another repository is refused at identity, never asked for flags, exit 1", () => {
  // Measured on 0.1.5: exit 2 asking for --category and --tags on a plugin
  // that identity.available would then have refused as already listed.
  const { code, out, err } = run(["submit", taken.dir, "--offline"])
  assert.equal(code, 1)
  assert.equal(err, "")
  assert.ok(!out.includes("usage"))
  assert.ok(out.includes(`${DENSITY.full} FAIL  identity.available`))
  assert.ok(out.includes("That id is taken by mtolhuys/omarchy-disk-lens; choose another."))
  assert.ok(out.includes(`${DENSITY.medium} ?     submission.category`))
  assert.ok(out.includes("Fix it, then run submit again:"))
  // The command wraps after 80 columns at a long tmp path; read it unwrapped.
  assert.ok(unwrapped(out).trimEnd().endsWith(`omakit submit ${taken.dir} --offline`), "the report ends with the command line that repeats the run")
  const json = JSON.parse(run(["submit", taken.dir, "--offline", "--json"]).out)
  assert.equal(json.outcome, "refused")
  assert.equal(json.ready, false)
  assert.equal(json.listing, null)
  assert.equal(json.reproduce, `omakit submit ${taken.dir} --offline`)
})

test("the author's own listed plugin is LISTED, exit 0: no failure, no refusal, no fix line, nothing asked", () => {
  // Measured on 0.1.6: `omakit submit ~/Projects/plugins/omarchy-disk-lens`
  // printed FAIL identity.available, REFUSED 1 blocking check failed, and
  // "Fix it, then run submit again" with the reproduce line, under a remedy
  // that said there was nothing to submit.
  const { code, out, err } = run(["submit", own.dir, "--offline"])
  assert.equal(code, 0)
  assert.equal(err, "")
  assert.ok(out.includes(`${DENSITY.floor} ok    identity.available`))
  assert.ok(out.includes("listed by this repository since 2026-08-31, verification commit"))
  assert.ok(out.includes(`${DENSITY.floor} LISTED  io.github.mtolhuys.disk-lens is already listed by this repository, so`))
  assert.ok(out.includes("read from the pin"), "offline, and it says so")
  assert.ok(out.includes("not the listed commit"))
  assert.ok(out.includes('choose "Verify and publish a newer upstream commit"'))
  for (const absent of ["FAIL", "REFUSED", "READY", "Fix it", "Fix them", "omakit submit ", `${DENSITY.medium} ?`, "submission.category", "submission.official-parser", "--body-file"]) {
    assert.ok(!out.includes(absent), `${JSON.stringify(absent)} has no place in a LISTED run:\n${out}`)
  }
  const json = JSON.parse(run(["submit", own.dir, "--offline", "--json"]).out)
  assert.equal(json.outcome, "listed")
  assert.equal(json.ready, false)
  assert.deepEqual(json.blocking, [])
  assert.deepEqual(json.unknown, [])
  assert.equal(json.issue, null)
  assert.deepEqual(Object.keys(json.listing), ["repository", "id", "addedAt", "verificationCommit", "verificationStatus", "verificationCheckedAt", "localCommit", "sameCommit", "source", "updateRoute"])
  assert.equal(json.listing.source, "pin")
  assert.equal(json.listing.sameCommit, false)
  assert.equal(json.listing.localCommit, own.commit)
  assert.equal(json.listing.verificationCommit, "5b98b315cf1bf8ab1a8b5250a0c493dda8b6fa4b")
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

test("every command that has --json gets its progress line through the one helper that silences it", () => {
  // Measured on 0.1.6: submit, watch and doctor built a silent spinner under
  // --json and verify called `progress()` directly, so `verify --json` at a
  // terminal drew a progress line on stderr that the other three never drew.
  // A pipe cannot observe the line (progress needs a TTY on stderr), so
  // this holds the source to the one route, and a fifth command cannot
  // bypass it.
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  const commands = ["cmdSubmit", "cmdWatch", "cmdDoctor", "cmdVerify"]
  for (const name of commands) {
    const body = cli.slice(cli.indexOf(`async function ${name}(`), cli.indexOf("\n}\n", cli.indexOf(`async function ${name}(`)))
    assert.ok(body.includes("spinnerFor(args)"), `${name} takes its spinner from spinnerFor`)
    assert.ok(!body.includes("progress()"), `${name} calls progress() directly`)
  }
  // The bare call survives in exactly two places: the helper, and `pin`,
  // which has no --json and no document to keep clean.
  assert.equal((cli.match(/\bprogress\(\)/g) || []).length, 2)
  assert.match(cli, /function spinnerFor\(args\) \{\n  return args\.includes\("--json"\) \? SILENT : progress\(\)/)
})

test("an option written as --name=value is read the same as --name value, for every command that reads one", () => {
  // Measured on 0.4.1: options.mjs accepted `--out=FILE` (and `--runs=3` was
  // documented as read), but the entry point looked its values up by the
  // token after the name, so `doctor --out=report.json` exited 0, wrote no
  // file and printed the report to stdout, and `submit --category=Widgets
  // --tags=bar` said both flags were missing.
  const dir = mkdtempSync(join(tmpdir(), "omakit-inline-"))
  const out = join(dir, "doctor.json")
  const doctor = run(["doctor", "--offline", `--out=${out}`])
  assert.equal(doctor.code, 0, doctor.err)
  assert.ok(existsSync(out), "--out=FILE writes the file")
  assert.ok(doctor.out.includes(`wrote ${out}`), doctor.out)
  assert.match(readFileSync(out, "utf8"), /^. info {2}omakit\.version$/m, "the report doctor writes to --out FILE")

  const submit = run(["submit", good.dir, "--category=Widgets", "--tags=bar", "--offline", "--json"])
  assert.equal(submit.code, 0, submit.err)
  const result = JSON.parse(submit.out)
  assert.equal(result.outcome, "ready")
  assert.ok(result.checks.find((check) => check.id === "submission.category").detail.endsWith("Widgets"))
  assert.equal(result.checks.find((check) => check.id === "submission.tags").detail.toLowerCase(), "tags: bar")
})
