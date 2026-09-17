// The Run and Store blocks (blocks/run/, blocks/store/), the registry
// behind them, `omakit add` and inspect's recognition of a copy. What the lab suite (tests/lab/run/)
// proves on a real shell is not repeated here; this file holds the parts
// that need no Quickshell: every header carries its body's digest and the
// NOTICE is current, no function crosses the M12 thresholds, the
// supervisor's refusals and its result shape (through /usr/bin/python3,
// where it is), the contract's counts against the M13 record, `add`'s
// three answers (written, current, refused) and that it writes nothing on
// a refusal, and inspect's one row for an unmodified block and none of
// its patterns at the block's lines.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bodySha256, parseHeader, recogniseBlockFile, renderNotice, shippedBlocks, shippedHistory, withBodySha256, withSourceCommit } from "../../tools/blocks/registry.mjs"
import { addBlock, AddError, BLOCK_DIR, stampedText } from "../../tools/blocks/add.mjs"
import { extractFunctions } from "../../tools/inspect/functions.mjs"
import { overSize } from "../../tools/inspect/patterns.mjs"
import { extractProcesses } from "../../tools/inspect/processes.mjs"
import { inspectPlugin, recogniseBlocks } from "../../tools/inspect/inspect.mjs"
import { renderInspect } from "../../tools/inspect/report.mjs"
import { subcommandsOf } from "../../tools/marketplace/completion.mjs"
import { materialiseInspectFixture } from "../fixtures/inspect.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()

const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version
const PYTHON = "/usr/bin/python3"
const SUPERVISOR = join(REPO_ROOT, "blocks/run/run-supervisor.py")
const STORE_HELPER = join(REPO_ROOT, "blocks/store/store-helper.py")
const hasPython = existsSync(PYTHON)

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1", NO_COLOR: "1" }, ...options })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

function supervise(args, options = {}) {
  const result = spawnSync(PYTHON, ["-I", "-S", "-B", SUPERVISOR, ...args], { encoding: "utf8", env: { PATH: "/usr/bin" }, ...options })
  const lines = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  return { code: result.status, lines, result: lines.find((line) => line.ev === "result"), err: result.stderr }
}

/** The store helper against a throwaway HOME; the result line parsed. */
function store(home, args, env = {}) {
  const result = spawnSync(PYTHON, ["-I", "-S", "-B", STORE_HELPER, ...args], { encoding: "utf8", env: { PATH: "/usr/bin", HOME: home, ...env } })
  const line = result.stdout.trim().split("\n").pop()
  return { code: result.status, result: line ? JSON.parse(line) : null, err: result.stderr }
}

function pluginDir() {
  const dir = mkdtempSync(join(tmpdir(), "omakit-add-"))
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, id: "fixture.add", name: "add", version: "0.0.1" })}\n`)
  return dir
}

// --- the shipped files -----------------------------------------------------------

test("the two blocks ship two files each with a header, the header's sha256 is the body's, and NOTICE and history are current", () => {
  const blocks = shippedBlocks()
  assert.deepEqual(blocks.map((block) => [block.name, block.version, block.files.map((entry) => entry.file)]), [
    ["run", "0.1.0", ["Run.qml", "run-supervisor.py"]],
    ["store", "0.1.0", ["Store.qml", "store-helper.py"]],
  ])
  const history = shippedHistory()
  for (const block of blocks) {
    for (const entry of block.files) {
      const text = entry.header.join("\n")
      assert.match(text, new RegExp(`omakit block: ${block.name} 0\\.1\\.0`))
      assert.match(text, /SPDX-License-Identifier: MIT/)
      assert.match(text, /Copyright \(c\) 2026 Maarten Tolhuijs/)
      assert.match(text, new RegExp(`Source: omakit blocks/${block.name}/${entry.file.replace(".", "\\.")}, commit unstamped`))
      assert.equal(entry.headerSha256, entry.sha256, `${entry.file}: the header's sha256 is not the body's; run node tools/blocks/stamp.mjs`)
      assert.equal(entry.header.length, 6, "six header lines, so `tail -n +7` is the body")
      assert.equal(bodySha256(entry.text.split("\n").slice(6).join("\n")), entry.sha256)
      // A person's check: sha256sum over everything after the header line.
      const bySha = execFileSync("sh", ["-c", `tail -n +7 "${join(block.dir, entry.file)}" | sha256sum`], { encoding: "utf8" }).split(" ")[0]
      assert.equal(bySha, entry.sha256)
      assert.ok(history.some((row) => row.block === block.name && row.file === entry.file && row.sha256 === entry.sha256), `${entry.file} is in blocks/history.json`)
    }
    assert.equal(block.notice, renderNotice([block], "unstamped"), `blocks/${block.name}/NOTICE is what the registry renders; run node tools/blocks/stamp.mjs`)
  }
  const stamp = spawnSync(process.execPath, [join(REPO_ROOT, "tools/blocks/stamp.mjs"), "--check"], { encoding: "utf8" })
  assert.equal(stamp.status, 0, stamp.stdout)
})

test("every block file is ASCII: no control or bidirectional character hides in the code that strips them", () => {
  for (const block of shippedBlocks()) {
    for (const entry of block.files) assert.match(entry.text, /^[\x09\x0a\x20-\x7e]*$/, `${entry.file} carries a byte outside printable ASCII, tab and newline`)
  }
})

test("no function in a block file is over the M12 thresholds, measured with inspect's own extractor", () => {
  for (const block of shippedBlocks()) {
    for (const entry of block.files) {
      const kind = entry.file.endsWith(".py") ? "python" : "qml"
      const functions = extractFunctions({ path: entry.file, kind, text: entry.text })
      assert.ok(functions.length > 5, `${entry.file}: the extractor sees its functions`)
      assert.deepEqual(overSize(functions).map((row) => `${row.name} ${row.lines} lines ${row.branches} branches nesting ${row.depth}`), [], `${entry.file} has a function over the measured size`)
    }
  }
})

test("the registry: a header parses, a body hash recognises the shipped copy, an edit is modified, and no header is a plugin's own file", () => {
  const runBlock = shippedBlocks().find((block) => block.name === "run")
  const qml = runBlock.files.find((entry) => entry.file === "Run.qml")
  const parsed = parseHeader(qml.text)
  assert.equal(parsed.name, "run")
  assert.equal(parsed.version, "0.1.0")
  assert.equal(parsed.sha256, qml.sha256)
  assert.deepEqual(recogniseBlockFile("Run.qml", qml.text), { name: "run", version: "0.1.0", state: "unmodified", shippedVersion: "0.1.0" })
  assert.equal(recogniseBlockFile("Run.qml", withSourceCommit(qml.text, "a".repeat(40))).state, "unmodified", "the stamped commit is not part of the body")
  assert.equal(recogniseBlockFile("Run.qml", `${qml.text}\n// edited\n`).state, "modified")
  assert.equal(recogniseBlockFile("Run.qml", withBodySha256(`${qml.text}\n// edited\n`, bodySha256("x"))).state, "modified", "a rewritten header hash does not make an edit unmodified")
  assert.equal(recogniseBlockFile("run-supervisor.py", qml.text).state, "modified", "the right body under the wrong name is not the shipped file")
  assert.equal(recogniseBlockFile("Other.qml", "import QtQuick\nItem {}\n"), null)
  assert.equal(parseHeader("// omakit block: run 0.1.0\n// no end line\n"), null)
})

// --- the supervisor ----------------------------------------------------------------

test("the supervisor refuses a relative command, a shell string and any interpreter with -c, as spawn-failed with the reason, and starts nothing", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  for (const [argv, reason] of [
    [["bash", "-c", "true"], "not an absolute path"],
    [["/usr/bin/bash", "-c", "true"], "shell string (bash -c)"],
    [["/usr/bin/sh", "-lc", "true"], "shell string (sh -c)"],
    [["/usr/bin/python3", "-I", "-c", "pass"], "shell string (python -c)"],
    [["/usr/bin/perl", "-e", "1", "-c"], null],
  ]) {
    const { result } = supervise(["--deadline-ms", "2000", "--", ...argv])
    if (reason === null) {
      assert.notEqual(result.state, "spawn-failed", `${argv.join(" ")}: -c after a non-option is not a shell string`)
      continue
    }
    assert.equal(result.state, "spawn-failed", argv.join(" "))
    assert.match(result.reason, new RegExp(reason.replace(/[()]/g, "\\$&")))
    assert.equal(result.pgid, undefined, "nothing was started")
  }
  const allowed = supervise(["--allow-shell-string", "--", "/usr/bin/bash", "-c", "echo allowed"])
  assert.equal(allowed.result.state, "ok")
  assert.equal(allowed.result.stdout, "allowed\n")
})

test("the supervisor reports a missing program as spawn-failed with the exec's errno text, and a program that exits 127 as exit 127", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const missing = supervise(["--", "/usr/bin/no-such-program-omakit-test"])
  assert.equal(missing.result.state, "spawn-failed")
  assert.match(missing.result.reason, /No such file or directory/)
  const dir = mkdtempSync(join(tmpdir(), "omakit-run-"))
  writeFileSync(join(dir, "exit127.sh"), "#!/usr/bin/bash\nexit 127\n")
  const exits = supervise(["--", "/usr/bin/bash", join(dir, "exit127.sh")])
  assert.equal(exits.result.state, "exit")
  assert.equal(exits.result.exitCode, 127)
})

test("the supervisor's result: the closed environment, the caps counted while reading, control characters removed, the deadline and the group", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const env = supervise(["--", "/usr/bin/env"], { env: { PATH: "/tmp/nowhere:/usr/bin", HOME: "/home/x", BASH_ENV: "/tmp/evil", XDG_RUNTIME_DIR: "/run/user/1000" } })
  assert.equal(env.result.state, "ok")
  // The supervisor passes its own environment through; closing it is Run.qml's clearEnvironment, and this proves nothing is added.
  assert.ok(!env.result.stdout.includes("PYTHONPATH"), "python -I adds nothing")
  const capped = supervise(["--max-bytes", "1000", "--keep-bytes", "10", "--", "/usr/bin/yes"])
  assert.equal(capped.result.state, "overflow")
  assert.ok(capped.result.outBytes > 1000, `counted ${capped.result.outBytes}`)
  assert.equal(capped.result.stdout, "y\ny\ny\ny\ny\n", "kept ten bytes, the rest counted and dropped")
  const zeros = supervise(["--max-bytes", "1000", "--keep-bytes", "10", "--", "/usr/bin/head", "-c", "100000", "/dev/zero"])
  assert.equal(zeros.result.stdout, "", "ten NUL bytes kept, then stripped: NUL is C0")
  const controls = supervise(["--", "/usr/bin/printf", "a\\033[1mb\\177c\\302\\205d\\342\\200\\256e\\tf\\ng\\r\\n"])
  assert.equal(controls.result.stdout, "a[1mbcde\tf\ng\n")
  const started = Date.now()
  const slow = supervise(["--deadline-ms", "300", "--grace-ms", "200", "--", "/usr/bin/sleep", "30"])
  assert.equal(slow.result.state, "timeout")
  assert.equal(slow.result.termSignal, 15, "sleep dies on TERM; no KILL was needed")
  assert.deepEqual(slow.result.signals.map((signal) => signal.sig), ["TERM"])
  assert.ok(Date.now() - started < 3000, "ended within deadline plus grace")
  assert.equal(slow.result.survivors, 0)
  assert.ok(slow.lines.some((line) => line.ev === "leader" && line.pid === line.pgid), "the leader is its own group")
})

// --- the contract and the counts ---------------------------------------------------

test("docs/BLOCKS.md cites every count of the M13 run-requirements record, and the record has no working set in it", () => {
  const record = JSON.parse(readFileSync(join(REPO_ROOT, "docs/evidence/blocks/2026-09-17-run-requirements.json"), "utf8"))
  const contract = readFileSync(join(REPO_ROOT, "docs/BLOCKS.md"), "utf8")
  const measurements = readFileSync(join(REPO_ROOT, "docs/MEASUREMENTS.md"), "utf8")
  assert.equal(record.source.comments, 1001)
  assert.equal(record.commentsRaisingAtLeastOne, 587)
  assert.deepEqual(record.counts, {
    absolute_executable: 366, closed_environment: 351, argv_not_shell_string: 106, hard_deadline: 291, group_teardown: 126,
    reap_order_and_pid_identity: 18, output_cap_while_reading: 313, cancel_on_destruction: 130, untrusted_output_display: 266,
  })
  for (const count of Object.values(record.counts)) {
    assert.match(contract, new RegExp(`\\| ${count} \\|`), `docs/BLOCKS.md cites ${count}`)
    assert.match(measurements, new RegExp(`\\| ${count} \\|`), `docs/MEASUREMENTS.md M13 cites ${count}`)
  }
  assert.match(contract, /587 comments raise at least one/)
  assert.match(measurements, /## M13\./)
  assert.match(record.method, /calibrated classification model/)
  assert.doesNotMatch(record.method, /openai|anthropic|claude|gpt/i, "no vendor name")
  assert.equal(record.workingSet, undefined)
  for (const word of ["passes review", "approved", "certified", "official"]) assert.ok(!contract.includes(word), `docs/BLOCKS.md says "${word}"`)
})

test("the state set Run.qml documents is the one the supervisor and the QML can produce, and no other", () => {
  const qml = readFileSync(join(REPO_ROOT, "blocks/run/Run.qml"), "utf8")
  const py = readFileSync(join(REPO_ROOT, "blocks/run/run-supervisor.py"), "utf8")
  const contract = readFileSync(join(REPO_ROOT, "docs/BLOCKS.md"), "utf8")
  const documented = ["ok", "exit", "timeout", "overflow", "cancelled", "spawn-failed", "supervisor-lost", "python-missing"]
  for (const state of documented) assert.ok(contract.includes(`\`${state}\``), `docs/BLOCKS.md names ${state}`)
  const produced = new Set([...py.matchAll(/begin_end\("([a-z-]+)"\)|"ok" if|"exit"\)|"state": "([a-z-]+)"/g)].flatMap((match) => [match[1], match[2]]).filter(Boolean))
  for (const state of ["cancelled", "overflow", "timeout", "spawn-failed"]) assert.ok(produced.has(state), `the supervisor produces ${state}`)
  for (const state of ["supervisor-lost", "python-missing"]) assert.ok(qml.includes(`state: "${state}"`), `Run.qml produces ${state}`)
  for (const state of produced) assert.ok(documented.includes(state), `${state} is produced but not documented`)
})

// --- omakit add --------------------------------------------------------------------

test("add writes the block's files and NOTICE with the commit stamped, reports current on a second run, and touches nothing else", () => {
  const dir = pluginDir()
  const first = addBlock({ repoRoot: REPO_ROOT, block: "run", dir })
  assert.deepEqual(first.files.map((file) => [file.path, file.state]), [["omakit/Run.qml", "written"], ["omakit/run-supervisor.py", "written"]])
  assert.equal(first.notice.state, "written")
  assert.match(first.commit, /^[0-9a-f]{40}$/)
  assert.deepEqual(readdirSync(join(dir, BLOCK_DIR)).sort(), ["NOTICE", "Run.qml", "run-supervisor.py"])
  assert.deepEqual(readdirSync(dir).sort(), ["manifest.json", "omakit"])
  const copy = readFileSync(join(dir, "omakit/Run.qml"), "utf8")
  assert.match(copy, new RegExp(`Source: omakit blocks/run/Run\\.qml, commit ${first.commit}`))
  assert.equal(recogniseBlockFile("Run.qml", copy).state, "unmodified")
  assert.match(readFileSync(join(dir, "omakit/NOTICE"), "utf8"), new RegExp(`block run 0\\.1\\.0, from omakit commit ${first.commit}`))
  const second = addBlock({ repoRoot: REPO_ROOT, block: "run", dir })
  assert.deepEqual(second.files.map((file) => file.state), ["current", "current"])
  assert.equal(second.notice.state, "current")
})

test("add refuses: a modified copy under --update, an existing differing file without --update, a directory without a manifest, an unknown block; and writes nothing on a refusal", () => {
  const dir = pluginDir()
  addBlock({ repoRoot: REPO_ROOT, block: "run", dir })
  const before = Object.fromEntries(readdirSync(join(dir, BLOCK_DIR)).map((name) => [name, statSync(join(dir, BLOCK_DIR, name)).mtimeMs]))
  writeFileSync(join(dir, "omakit/Run.qml"), `${readFileSync(join(dir, "omakit/Run.qml"), "utf8")}\n// mine\n`)
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "run", dir, update: true }), (error) => error instanceof AddError && error.code === "modified" && /not one omakit shipped/.test(error.message))
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "run", dir }), (error) => error instanceof AddError && error.code === "exists")
  const after = Object.fromEntries(readdirSync(join(dir, BLOCK_DIR)).map((name) => [name, statSync(join(dir, BLOCK_DIR, name)).mtimeMs]))
  assert.equal(after["run-supervisor.py"], before["run-supervisor.py"], "the other file was not rewritten")
  assert.equal(after.NOTICE, before.NOTICE, "NOTICE was not rewritten")
  const bare = mkdtempSync(join(tmpdir(), "omakit-add-bare-"))
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "run", dir: bare }), (error) => error.code === "not-a-plugin")
  assert.deepEqual(readdirSync(bare), [], "nothing was written into a directory that is not a plugin")
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "fetch", dir }), (error) => error.code === "unknown-block")
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "run", dir: join(dir, "missing") }), (error) => error.code === "plugin-dir-not-found")
})

test("add --update replaces a copy whose body is one omakit shipped, at any recorded version", () => {
  const dir = pluginDir()
  addBlock({ repoRoot: REPO_ROOT, block: "run", dir })
  // An older shipped body is one blocks/history.json records; the current
  // body under another commit stamp stands in for it here.
  const runBlock = shippedBlocks().find((block) => block.name === "run")
  writeFileSync(join(dir, "omakit/Run.qml"), stampedText(runBlock.files[0], "b".repeat(40)))
  const updated = addBlock({ repoRoot: REPO_ROOT, block: "run", dir, update: true })
  assert.deepEqual(updated.files.map((file) => file.state), ["current", "current"], "the same body is current whatever commit its header names")
})

test("the command line: `omakit add run <dir>` prints one line per file, --json the document, a refusal is a failure state with a remedy, and completion offers the block names", () => {
  const dir = pluginDir()
  const first = run(["add", "run", dir])
  assert.equal(first.code, 0, first.err)
  assert.match(first.out, /written +omakit\/Run\.qml\n/)
  assert.match(first.out, /written +omakit\/run-supervisor\.py\n/)
  assert.match(first.out, /written +omakit\/NOTICE\n/)
  assert.match(first.out, /block +run 0\.1\.0, from omakit commit/)
  assert.match(first.out, /docs\/BLOCKS\.md is the contract/)
  const json = run(["add", "run", dir, "--json"])
  assert.equal(json.code, 0)
  const document = JSON.parse(json.out)
  assert.equal(document.block, "run")
  assert.deepEqual(document.files.map((file) => file.state), ["current", "current"])
  writeFileSync(join(dir, "omakit/run-supervisor.py"), "# mine\n")
  const refused = run(["add", "run", dir, "--update"])
  assert.equal(refused.code, 1)
  assert.match(refused.err, /FAIL +modified/)
  assert.match(refused.err, /→ Move or rename the file/)
  const usage = run(["add"])
  assert.equal(usage.code, 2)
  assert.match(usage.err, /add needs a block/)
  const cwd = run(["add", "run"], { cwd: dir })
  assert.equal(cwd.code, 1, "the modified copy is still there, and the current directory is the plugin")
  const add = subcommandsOf().find((command) => command.name === "add")
  assert.equal(add.target, "block")
  assert.deepEqual(add.blocks, ["run", "store"])
  assert.deepEqual(add.flags.map((flag) => flag.flag), ["--update", "--json"])
})

// --- inspect recognition -----------------------------------------------------------

test("inspect: an unmodified block is one row, its files raise nothing, and the Run site is a process with its deadline observed through the block", async () => {
  const fixture = materialiseInspectFixture("run-block")
  const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: fixture.dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(document.blocks.map((block) => [block.name, block.version, block.state, block.complete, block.files.map((file) => file.state)]), [["run", "0.1.0", "unmodified", true, ["unmodified", "unmodified"]]])
  assert.deepEqual(document.patterns, [], "no pattern row anywhere, and none at the block's lines")
  assert.deepEqual(document.observed.processes.map((row) => [row.file, row.line, row.deadline.via, row.deadline.ms, row.output.collector, row.block]), [["Widget.qml", 10, "block-run", 8000, "Run", "run"]])
  assert.ok(document.observed.functions.every((row) => !row.file.startsWith("omakit/")), "the block's functions are not measured as the plugin's")
  const report = renderInspect(document, { colour: false })
  assert.match(report, /blocks +run 0\.1\.0, 2 files, unmodified: no row of its own/)
  assert.doesNotMatch(report, /omakit\/Run\.qml:\d+/, "no site inside the block")
  const full = renderInspect(document, { colour: false, full: true })
  assert.match(full, /Widget\.qml:10/)
  assert.match(full, /blocks +run 0\.1\.0/)
})

test("inspect: a modified copy is reported modified, its files are read like any other, and Run is not a process the extraction knows", async () => {
  const fixture = materialiseInspectFixture("run-block-modified")
  const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: fixture.dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(document.blocks.map((block) => [block.name, block.state, block.files.map((file) => [file.path, file.state])]), [["run", "modified", [["omakit/Run.qml", "modified"], ["omakit/run-supervisor.py", "unmodified"]]]])
  assert.ok(document.observed.processes.every((row) => row.file === "omakit/Run.qml"), "the Process sites are the modified block's own; the widget's Run site is not a process")
  assert.ok(document.patterns.some((pattern) => pattern.id === "process-lifecycle" && pattern.sites.every((site) => site.file === "omakit/Run.qml")))
  const report = renderInspect(document, { colour: false })
  assert.match(report, /blocks +run 0\.1\.0, modified \(omakit\/Run\.qml\): read like any other file/)
  assert.match(report, /omakit\/Run\.qml:\d+/)
})

test("recogniseBlocks and the Run extraction stand on their own: a tree without the block sees `Run {` as the plugin's own name", () => {
  const widget = readFileSync(join(REPO_ROOT, "tests/fixtures/inspect/run-block/Widget.qml"), "utf8")
  const file = { path: "Widget.qml", kind: "qml", text: widget }
  assert.deepEqual(extractProcesses(file), [], "without the block, Run is not a process")
  const [row] = extractProcesses(file, { runBlock: true })
  assert.equal(row.deadline.via, "block-run")
  assert.equal(row.running, true, "usageRun.start() is observed as running")
  assert.deepEqual(row.argv, ["/usr/bin/df", "-h", "/"])
  const { blocks, skip } = recogniseBlocks([file])
  assert.deepEqual(blocks, [])
  assert.equal(skip.size, 0)
  const shell = { path: "omakit/Run.qml", kind: "qml", text: readFileSync(join(REPO_ROOT, "blocks/run/Run.qml"), "utf8") }
  const seen = recogniseBlocks([shell, { path: "omakit/run-supervisor.py", kind: "python", text: readFileSync(SUPERVISOR, "utf8") }])
  assert.equal(seen.blocks[0].complete, true)
  assert.deepEqual([...seen.skip].sort(), ["omakit/Run.qml", "omakit/run-supervisor.py"])
  const half = recogniseBlocks([shell])
  assert.equal(half.blocks[0].complete, false, "one file of two is incomplete")
})

test("the fixture copies are the shipped files, so a block change is a visible fixture change", () => {
  const same = (fixture, block, name) => assert.equal(readFileSync(join(REPO_ROOT, "tests/fixtures/inspect", fixture, "omakit", name), "utf8"), readFileSync(join(REPO_ROOT, "blocks", block, name), "utf8"), `tests/fixtures/inspect/${fixture}/omakit/${name} is not the shipped file; copy it again`)
  for (const name of ["Run.qml", "run-supervisor.py"]) {
    same("run-block", "run", name)
    same("store-block", "run", name)
    same("store-block-modified", "run", name)
    if (name === "run-supervisor.py") same("run-block-modified", "run", name)
  }
  for (const name of ["Store.qml", "store-helper.py"]) {
    same("store-block", "store", name)
    if (name === "Store.qml") same("store-block-modified", "store", name)
  }
  assert.match(readFileSync(join(REPO_ROOT, "tests/fixtures/inspect/run-block-modified/omakit/Run.qml"), "utf8"), /\/\/ edited by the plugin author/)
  assert.match(readFileSync(join(REPO_ROOT, "tests/fixtures/inspect/store-block-modified/omakit/store-helper.py"), "utf8"), /# edited by the plugin author/)
})

// --- the store helper --------------------------------------------------------------

test("the store helper: a private 0700 directory, a 0600 file through a staging rename, a capped read, a schema, and remove", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-store-"))
  const schema = JSON.stringify({ type: "object", required: ["version"], properties: { version: { type: "integer", minimum: 1 } }, additionalProperties: false })
  const base = ["--kind", "state", "--plugin", "fixture.store", "--name", "memory.json"]
  assert.equal(store(home, ["read", ...base]).result.state, "missing")
  const written = store(home, ["write", ...base, "--schema", schema, "--value", JSON.stringify({ version: 2 })]).result
  assert.equal(written.state, "ok")
  assert.equal(written.path, join(home, ".local/state/fixture.store/memory.json"))
  assert.equal((statSync(join(home, ".local/state/fixture.store")).mode & 0o777).toString(8), "700")
  assert.equal((statSync(written.path).mode & 0o777).toString(8), "600")
  assert.deepEqual(readdirSync(join(home, ".local/state/fixture.store")), ["memory.json"], "no staging file is left")
  const read = store(home, ["read", ...base, "--schema", schema]).result
  assert.equal(read.state, "ok")
  assert.deepEqual(read.value, { version: 2 })
  assert.equal(read.bytes, 18, `{\n "version": 2\n}\n`)
  assert.equal(store(home, ["read", ...base, "--schema", JSON.stringify({ type: "object", required: ["nope"] })]).result.state, "invalid")
  assert.equal(store(home, ["write", ...base, "--schema", schema, "--value", JSON.stringify({ version: 0 })]).result.state, "invalid")
  assert.equal(store(home, ["write", ...base, "--schema", schema, "--value", JSON.stringify({ version: 1, extra: true })]).result.state, "invalid")
  assert.equal(store(home, ["write", ...base, "--value", "not json"]).result.state, "invalid")
  assert.equal(store(home, ["read", ...base, "--max-bytes", "4"]).result.state, "overflow")
  assert.equal(store(home, ["write", ...base, "--max-bytes", "4", "--value", "12345"]).result.state, "overflow")
  assert.equal(store(home, ["remove", ...base]).result.state, "ok")
  assert.equal(store(home, ["remove", ...base]).result.state, "missing")
  assert.equal(store(home, ["read", ...base]).result.state, "missing")
  const cache = store(home, ["write", "--kind", "cache", "--plugin", "fixture.store", "--name", "catalog.json", "--value", "[]"]).result
  assert.equal(cache.path, join(home, ".cache/fixture.store/catalog.json"))
  assert.equal(store(home, ["write", ...base, "--value", "1"], { XDG_STATE_HOME: "/tmp" }).result.state, "refused", "a base outside HOME cannot be walked")
})

test("the store helper refuses a planted link on the directory and on the file, a group-writable file, an unsafe name, and reports an OS error by name", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-store-"))
  const victim = mkdtempSync(join(tmpdir(), "omakit-victim-"))
  writeFileSync(join(victim, "memory.json"), "untouched\n")
  const base = ["--kind", "state", "--plugin", "fixture.store", "--name", "memory.json"]
  execFileSync("mkdir", ["-p", join(home, ".local/state")])
  execFileSync("ln", ["-s", victim, join(home, ".local/state/fixture.store")])
  let refused = store(home, ["write", ...base, "--value", "1"]).result
  assert.equal(refused.state, "refused")
  assert.match(refused.reason, /symbolic link/)
  assert.equal(readFileSync(join(victim, "memory.json"), "utf8"), "untouched\n")
  execFileSync("rm", [join(home, ".local/state/fixture.store")])
  execFileSync("mkdir", ["-m", "700", join(home, ".local/state/fixture.store")])
  execFileSync("ln", ["-s", join(victim, "memory.json"), join(home, ".local/state/fixture.store/memory.json")])
  refused = store(home, ["read", ...base]).result
  assert.equal(refused.state, "refused")
  assert.match(refused.reason, /symbolic link/)
  assert.equal(store(home, ["write", ...base, "--value", "1"]).result.state, "ok", "the write replaces the link with a regular file")
  assert.equal(readFileSync(join(victim, "memory.json"), "utf8"), "untouched\n")
  assert.ok(statSync(join(home, ".local/state/fixture.store/memory.json")).isFile())
  execFileSync("chmod", ["660", join(home, ".local/state/fixture.store/memory.json")])
  refused = store(home, ["read", ...base]).result
  assert.equal(refused.state, "refused")
  assert.match(refused.reason, /writable by the group/)
  assert.equal(store(home, ["read", "--kind", "state", "--plugin", "../up", "--name", "x"]).result.state, "refused")
  assert.equal(store(home, ["read", "--kind", "state", "--plugin", "fixture.store", "--name", ".hidden"]).result.state, "refused")
  assert.equal(store(home, ["read", "--kind", "home", "--plugin", "fixture.store", "--name", "x"]).result.state, "refused")
  const failed = store(join(home, "does-not-exist"), ["read", ...base]).result
  assert.equal(failed.state, "failed")
  assert.match(failed.reason, /FileNotFoundError/)
})

test("ten store writers at once leave one whole file and no staging file; a stale staging file is swept and a fresh one kept", { skip: !hasPython && "no /usr/bin/python3" }, async () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-store-"))
  const base = ["--kind", "state", "--plugin", "fixture.store", "--name", "memory.json"]
  const { spawn } = await import("node:child_process")
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => new Promise((resolve) => {
    const child = spawn(PYTHON, ["-I", "-S", "-B", STORE_HELPER, "write", ...base, "--value", JSON.stringify({ writer: index })], { env: { PATH: "/usr/bin", HOME: home }, stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    child.stdout.on("data", (chunk) => { out += chunk })
    child.on("close", () => resolve(JSON.parse(out.trim())))
  })))
  assert.deepEqual(results.map((result) => result.state), Array(10).fill("ok"))
  const dir = join(home, ".local/state/fixture.store")
  assert.deepEqual(readdirSync(dir), ["memory.json"])
  const value = JSON.parse(readFileSync(join(dir, "memory.json"), "utf8"))
  assert.ok(Number.isInteger(value.writer) && value.writer >= 0 && value.writer < 10, "one whole write")
  writeFileSync(join(dir, ".store-99999-0123456789abcdef.tmp"), "{")
  execFileSync("touch", ["-d", "-1 hour", join(dir, ".store-99999-0123456789abcdef.tmp")])
  writeFileSync(join(dir, ".store-99998-fedcba9876543210.tmp"), "{")
  assert.equal(store(home, ["write", ...base, "--value", "{}"]).result.state, "ok")
  assert.deepEqual(readdirSync(dir).sort(), [".store-99998-fedcba9876543210.tmp", "memory.json"], "the stale one is swept, the fresh one is a live writer's")
})

test("add store brings run along, reports each file's block, and add run alone leaves store out", () => {
  const dir = pluginDir()
  const result = addBlock({ repoRoot: REPO_ROOT, block: "store", dir })
  assert.deepEqual(result.requires, ["run 0.1.0"])
  assert.deepEqual(result.files.map((file) => [file.block, file.path, file.state]), [
    ["run", "omakit/Run.qml", "written"], ["run", "omakit/run-supervisor.py", "written"],
    ["store", "omakit/Store.qml", "written"], ["store", "omakit/store-helper.py", "written"],
  ])
  assert.match(readFileSync(join(dir, "omakit/NOTICE"), "utf8"), /block run 0\.1\.0[\s\S]*block store 0\.1\.0/)
  const other = pluginDir()
  assert.deepEqual(addBlock({ repoRoot: REPO_ROOT, block: "run", dir: other }).files.map((file) => file.block), ["run", "run"])
  assert.deepEqual(readdirSync(join(other, "omakit")).sort(), ["NOTICE", "Run.qml", "run-supervisor.py"])
  const cli = run(["add", "store", other])
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /current +omakit\/Run\.qml \(run, which store uses\)/)
  assert.match(cli.out, /written +omakit\/Store\.qml/)
  assert.match(cli.out, /block +store 0\.1\.0, with run 0\.1\.0/)
})

test("inspect: an unmodified store block is one row beside run's, and the Store site is a write under the plugin's own state directory at mode 0600; a modified copy is read like any other file", async () => {
  const whole = await inspectPlugin({ repoRoot: REPO_ROOT, target: materialiseInspectFixture("store-block").dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(whole.blocks.map((block) => [block.name, block.state, block.complete]), [["run", "unmodified", true], ["store", "unmodified", true]])
  assert.deepEqual(whole.observed.writes.map((row) => [row.file, row.line, row.via, row.path, row.controlledDirectory, row.controlledBy, row.mode, row.block]), [["Widget.qml", 8, "block-store", "$XDG_STATE_HOME/fixture.store-block/memory.json", "observed", "$XDG_STATE_HOME", "0600", "store"]])
  assert.deepEqual(whole.patterns, [])
  const report = renderInspect(whole, { colour: false })
  assert.match(report.replace(/\n +/g, " "), /blocks +run 0\.1\.0, 2 files, unmodified: no row of its own; store 0\.1\.0, 2 files, unmodified: no row of its own/)
  assert.match(renderInspect(whole, { colour: false, full: true }).replace(/\n +/g, " "), /Store \$XDG_STATE_HOME\/fixture\.store-block\/memory\.json \(through the store block\)/)
  const edited = await inspectPlugin({ repoRoot: REPO_ROOT, target: materialiseInspectFixture("store-block-modified").dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(edited.blocks.map((block) => [block.name, block.state]), [["run", "unmodified"], ["store", "modified"]])
  assert.deepEqual(edited.observed.writes, [], "without the whole store block, Store is not a write the extraction knows")
  assert.match(renderInspect(edited, { colour: false }).replace(/\n +/g, " "), /store 0\.1\.0, modified \(omakit\/store-helper\.py\): read like any other file/)
})
