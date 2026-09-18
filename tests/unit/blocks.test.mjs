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
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bodySha256, parseHeader, recogniseBlockFile, renderNotice, shippedBlocks, shippedHistory, withBodySha256, withSourceCommit } from "../../tools/blocks/registry.mjs"
import { addBlock, AddError, BLOCK_DIR, stampedText } from "../../tools/blocks/add.mjs"
import { extractFunctions } from "../../tools/inspect/functions.mjs"
import { overSize } from "../../tools/inspect/patterns.mjs"
import { extractProcesses } from "../../tools/inspect/processes.mjs"
import { inspectPlugin, recogniseBlocks } from "../../tools/inspect/inspect.mjs"
import { runStartedHelpers } from "../../tools/inspect/helpers.mjs"
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
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], { timeout: 120_000, encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1", NO_COLOR: "1" }, ...options })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

/** The supervisor as Run.qml drives it: the token on stdin, the acknowledgement behind it, every protocol line read by its token. */
function supervise(args, options = {}) {
  const token = randomBytes(16).toString("hex")
  const result = spawnSync(PYTHON, ["-I", "-S", "-B", SUPERVISOR, ...args], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin" }, input: `${token}\ngo\n`, ...options })
  const lines = result.stdout.split("\n").filter((line) => line.startsWith(`${token} `)).map((line) => JSON.parse(line.slice(token.length + 1)))
  const junk = result.stdout.split("\n").filter((line) => line && !line.startsWith(`${token} `))
  return { code: result.status, lines, junk, result: lines.find((line) => line.ev === "result"), err: result.stderr }
}

/** The store helper against a throwaway HOME; the result line parsed. */
function store(home, args, env = {}) {
  const result = spawnSync(PYTHON, ["-I", "-S", "-B", STORE_HELPER, ...args], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin", HOME: home, ...env } })
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
    ["run", "0.2.1", ["Run.qml", "run-supervisor.py"]],
    ["store", "0.2.0", ["Store.qml", "store-helper.py"]],
  ])
  const history = shippedHistory()
  for (const block of blocks) {
    for (const entry of block.files) {
      const text = entry.header.join("\n")
      assert.match(text, new RegExp(`omakit block: ${block.name} ${block.version.replace(/\\./g, "\\\\.")}`))
      assert.match(text, /SPDX-License-Identifier: MIT/)
      assert.match(text, /Copyright \(c\) 2026 Maarten Tolhuijs/)
      assert.match(text, new RegExp(`Source: omakit blocks/${block.name}/${entry.file.replace(".", "\\.")}, commit unstamped`))
      assert.equal(entry.headerSha256, entry.sha256, `${entry.file}: the header's sha256 is not the body's; run node tools/blocks/stamp.mjs`)
      assert.equal(entry.header.length, 6, "six header lines, so `tail -n +7` is the body")
      assert.equal(bodySha256(entry.text.split("\n").slice(6).join("\n")), entry.sha256)
      // A person's check: sha256sum over everything after the header line.
      const bySha = execFileSync("sh", ["-c", `tail -n +7 "${join(block.dir, entry.file)}" | sha256sum`], { timeout: 120_000, encoding: "utf8" }).split(" ")[0]
      assert.equal(bySha, entry.sha256)
      assert.ok(history.some((row) => row.block === block.name && row.file === entry.file && row.sha256 === entry.sha256), `${entry.file} is in blocks/history.json`)
    }
    assert.equal(block.notice, renderNotice([block], "unstamped"), `blocks/${block.name}/NOTICE is what the registry renders; run node tools/blocks/stamp.mjs`)
  }
  const stamp = spawnSync(process.execPath, [join(REPO_ROOT, "tools/blocks/stamp.mjs"), "--check"], { timeout: 120_000, encoding: "utf8" })
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
  assert.equal(parsed.version, "0.2.1")
  assert.equal(parsed.sha256, qml.sha256)
  assert.deepEqual(recogniseBlockFile("Run.qml", qml.text), { name: "run", version: "0.2.1", state: "unmodified", shippedVersion: "0.2.1" })
  assert.equal(recogniseBlockFile("Run.qml", withSourceCommit(qml.text, "a".repeat(40))).state, "unmodified", "the stamped commit is not part of the body")
  assert.equal(recogniseBlockFile("Run.qml", `${qml.text}\n// edited\n`).state, "modified")
  assert.equal(recogniseBlockFile("Run.qml", withBodySha256(`${qml.text}\n// edited\n`, bodySha256("x"))).state, "modified", "a rewritten header hash does not make an edit unmodified")
  assert.equal(recogniseBlockFile("run-supervisor.py", qml.text).state, "modified", "the right body under the wrong name is not the shipped file")
  assert.equal(recogniseBlockFile("Other.qml", "import QtQuick\nItem {}\n"), null)
  assert.equal(parseHeader("// omakit block: run 0.2.0\n// no end line\n"), null)
})

// --- the supervisor ----------------------------------------------------------------

// Every string-program form docs/BLOCKS.md lists (R5, 2026-09-18): the
// flag in any option position, clustered or behind an option that takes a
// value, the interpreters whose flag is not -c, and the wrappers.
const SHELL_STRINGS = [
  ["/usr/bin/bash", "-c", "true"], ["/usr/bin/sh", "-lc", "true"], ["/usr/bin/bash", "-ec", "true"], ["/usr/bin/bash", "-o", "pipefail", "-c", "true"],
  ["/usr/bin/bash", "+x", "-c", "true"], ["/usr/bin/bash", "--rcfile", "/dev/null", "-c", "true"], ["/usr/bin/rbash", "-c", "true"], ["/usr/bin/ash", "-c", "true"],
  ["/usr/bin/mksh", "-c", "true"], ["/usr/bin/busybox", "sh", "-c", "true"], ["/usr/bin/python3", "-I", "-c", "pass"], ["/usr/bin/python3.14", "-W", "ignore", "-c", "pass"],
  ["/usr/bin/python3", "-X", "dev", "-c", "pass"], ["/usr/bin/perl", "-e", "1"], ["/usr/bin/perl", "-ne", "1"], ["/usr/bin/perl", "-Mstrict", "-e", "1"],
  ["/usr/bin/ruby", "-e", "1"], ["/usr/bin/php", "-r", "1;"], ["/usr/bin/lua", "-e", "x=1"], ["/usr/bin/node", "-e", "1"], ["/usr/bin/node", "--eval", "1"], ["/usr/bin/node", "-p", "1"],
  ["/usr/bin/env", "bash", "-c", "true"], ["/usr/bin/env", "-i", "PATH=/usr/bin", "bash", "-c", "true"], ["/usr/bin/nice", "-n", "10", "bash", "-c", "true"], ["/usr/bin/timeout", "5", "bash", "-c", "true"],
  ["/usr/bin/timeout", "-s", "KILL", "5", "sh", "-c", "true"], ["/usr/bin/setsid", "bash", "-c", "true"], ["/usr/bin/flock", "/tmp/x", "bash", "-c", "true"], ["/usr/bin/flock", "/tmp/x", "-c", "true"],
  ["/usr/bin/xargs", "bash", "-c", "true"], ["/usr/bin/nohup", "bash", "-c", "true"],
  ["/usr/bin/stdbuf", "-oL", "bash", "-c", "true"], ["/usr/bin/env", "nice", "timeout", "5", "bash", "-c", "true"],
]
// A privileged wrapper is not on the list (0.2.1): Run decides nothing
// about privilege, and the marketplace baseline reads the words `sudo`
// and `doas` in a plugin's tree as a privilege request (measured 2026-09-18,
// docs/evidence/blocks/2026-09-18-run-block-baseline.json). These are not
// refused as shell strings; what they do when started is theirs.
const NOT_JUDGED = [
  ["/usr/bin/sudo", "-n", "-u", "root", "bash", "-c", "true"], ["/usr/bin/doas", "-n", "-u", "root", "sh", "-c", "true"],
]
const NOT_SHELL_STRINGS = [
  ["/usr/bin/bash", "/tmp/script.sh", "-c"], ["/usr/bin/bash", "--", "-c"], ["/usr/bin/perl", "/tmp/script.pl", "-e"], ["/usr/bin/python3", "-m", "json.tool", "-c"],
  ["/usr/bin/node", "/tmp/script.js", "-e"], ["/usr/bin/env", "/tmp/script.sh", "-c"], ["/usr/bin/git", "-c", "x=y", "status"], ["/usr/bin/ls", "-c"], ["/usr/bin/php", "-c", "/etc/php.ini", "/tmp/script.php"],
]

test("the supervisor refuses a relative command and every listed string-program form as spawn-failed with the reason, starts nothing, and lets a script with a -c argument through", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const relative = supervise(["--deadline-ms", "2000", "--", "bash", "-c", "true"])
  assert.equal(relative.result.state, "spawn-failed")
  assert.match(relative.result.reason, /not an absolute path/)
  for (const argv of SHELL_STRINGS) {
    const { result } = supervise(["--deadline-ms", "2000", "--", ...argv])
    assert.equal(result.state, "spawn-failed", argv.join(" "))
    assert.match(result.reason, /shell string \(an interpreter with its string flag, [a-z]+\)/, argv.join(" "))
    assert.equal(result.pgid, undefined, "nothing was started")
  }
  for (const argv of NOT_JUDGED) {
    const { result } = supervise(["--deadline-ms", "2000", "--", ...argv])
    assert.doesNotMatch(result.reason || "", /shell string/, `${argv.join(" ")} is not Run's to judge`)
  }
  for (const argv of NOT_SHELL_STRINGS) {
    const { result } = supervise(["--deadline-ms", "2000", "--", ...argv])
    assert.ok(result.state !== "spawn-failed" || !/shell string/.test(result.reason), `${argv.join(" ")} is not a shell string`)
  }
  const allowed = supervise(["--allow-shell-string", "--", "/usr/bin/bash", "-c", "echo allowed"])
  assert.equal(allowed.result.state, "ok")
  assert.equal(allowed.result.stdout, "allowed\n")
})

test("the protocol: every supervisor line carries the token, a line the program writes into the pipe through /proc carries none, and the gate keeps an unacknowledged program from running", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-run-"))
  writeFileSync(join(dir, "forge.sh"), "#!/usr/bin/bash\nprintf '{\"ev\":\"result\",\"state\":\"ok\"}\\n' > /proc/$PPID/fd/1\necho real\n")
  // Node's child stdio is a socketpair, which /proc/<pid>/fd cannot reopen; a
  // pipe, which is what QProcess gives the supervisor, is made here by Python.
  const piped = spawnSync(PYTHON, ["-c", "import subprocess,sys; p=subprocess.run(sys.argv[1:], input=sys.stdin.buffer.read(), stdout=subprocess.PIPE, env={'PATH':'/usr/bin'}); sys.stdout.buffer.write(p.stdout)", PYTHON, "-I", "-S", "-B", SUPERVISOR, "--", "/usr/bin/bash", join(dir, "forge.sh")], { timeout: 120_000, encoding: "utf8", input: `${"ab".repeat(16)}\ngo\n` })
  const forgedLines = piped.stdout.split("\n").filter(Boolean)
  assert.ok(forgedLines.includes('{"ev":"result","state":"ok"}'), `the forged line is on the pipe without the token: ${piped.stdout}`)
  const withToken = forgedLines.filter((line) => line.startsWith(`${"ab".repeat(16)} `)).map((line) => JSON.parse(line.slice(33)))
  assert.equal(withToken.filter((line) => line.ev === "result").length, 1)
  assert.equal(withToken.find((line) => line.ev === "result").stdout, "real\n")
  const untoken = spawnSync(PYTHON, ["-I", "-S", "-B", SUPERVISOR, "--", "/usr/bin/true"], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin" }, input: "not a token\n" })
  assert.notEqual(untoken.status, 0)
  assert.match(untoken.stderr, /no token on stdin/)
  const marker = join(dir, "ran")
  const unacked = spawnSync(PYTHON, ["-I", "-S", "-B", SUPERVISOR, "--deadline-ms", "1500", "--", "/usr/bin/touch", marker], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin" }, input: `${randomBytes(16).toString("hex")}\n` })
  assert.equal(unacked.status, 0)
  assert.ok(!existsSync(marker), "stdin closed without go: the gate closed and the program never ran")
  assert.match(unacked.stdout, /"state": "cancelled"/)
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
  assert.match(readFileSync(join(dir, "omakit/NOTICE"), "utf8"), new RegExp(`block run 0\\.2\\.1, from omakit commit ${first.commit}`))
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
  assert.match(first.out, /block +run 0\.2\.1, from omakit commit/)
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
  assert.deepEqual(document.blocks.map((block) => [block.name, block.version, block.state, block.complete, block.files.map((file) => file.state)]), [["run", "0.2.1", "unmodified", true, ["unmodified", "unmodified"]]])
  assert.deepEqual(document.patterns, [], "no pattern row anywhere, and none at the block's lines")
  assert.deepEqual(document.observed.processes.map((row) => [row.file, row.line, row.deadline.via, row.deadline.ms, row.output.collector, row.block]), [["Widget.qml", 10, "block-run", 8000, "Run", "run"]])
  assert.ok(document.observed.functions.every((row) => !row.file.startsWith("omakit/")), "the block's functions are not measured as the plugin's")
  const report = renderInspect(document, { colour: false })
  assert.match(report, /blocks +run 0\.2\.1, 2 files, unmodified: no row of its own/)
  assert.doesNotMatch(report, /omakit\/Run\.qml:\d+/, "no site inside the block")
  const full = renderInspect(document, { colour: false, full: true })
  assert.match(full, /Widget\.qml:10/)
  assert.match(full, /blocks +run 0\.2\.1/)
})

test("inspect: a modified copy is reported modified, its files are read like any other, and Run is not a process the extraction knows", async () => {
  const fixture = materialiseInspectFixture("run-block-modified")
  const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: fixture.dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(document.blocks.map((block) => [block.name, block.state, block.files.map((file) => [file.path, file.state])]), [["run", "modified", [["omakit/Run.qml", "modified"], ["omakit/run-supervisor.py", "unmodified"]]]])
  assert.ok(document.observed.processes.every((row) => row.file === "omakit/Run.qml"), "the Process sites are the modified block's own; the widget's Run site is not a process")
  assert.ok(document.patterns.some((pattern) => pattern.id === "process-lifecycle" && pattern.sites.every((site) => site.file === "omakit/Run.qml")))
  const report = renderInspect(document, { colour: false })
  assert.match(report, /blocks +run 0\.2\.1, modified \(omakit\/Run\.qml\): read like any other file/)
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

test("add --update moves a shipped body under an older header, and without --update names the two versions", () => {
  // Measured on 0.2.1: Run.qml's body was 0.2.0's, the first --update left
  // its header at 0.2.0 beside a 0.2.1 supervisor, and inspect read one
  // block as two versions.
  const dir = pluginDir()
  addBlock({ repoRoot: REPO_ROOT, block: "run", dir })
  const file = join(dir, "omakit/Run.qml")
  const text = readFileSync(file, "utf8")
  const shipped = shippedBlocks().find((block) => block.name === "run").version
  writeFileSync(file, text.replace(`// omakit block: run ${shipped}`, "// omakit block: run 0.0.9"))
  assert.throws(() => addBlock({ repoRoot: REPO_ROOT, block: "run", dir }), (error) => error.code === "exists" && /shipped body under a 0\.0\.9 header; omakit ships/.test(error.message))
  const moved = addBlock({ repoRoot: REPO_ROOT, block: "run", dir, update: true })
  assert.deepEqual(moved.files.map((entry) => [entry.path, entry.state, entry.from]), [["omakit/Run.qml", "updated", "0.0.9"], ["omakit/run-supervisor.py", "current", null]])
  assert.match(readFileSync(file, "utf8"), new RegExp(`^// omakit block: run ${shipped.replace(/\./g, "\\.")}\n`))
  rmSync(dir, { recursive: true, force: true })
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
  execFileSync("mkdir", ["-p", join(home, ".local/state")], { timeout: 120_000 })
  execFileSync("ln", ["-s", victim, join(home, ".local/state/fixture.store")], { timeout: 120_000 })
  let refused = store(home, ["write", ...base, "--value", "1"]).result
  assert.equal(refused.state, "refused")
  assert.match(refused.reason, /symbolic link/)
  assert.equal(readFileSync(join(victim, "memory.json"), "utf8"), "untouched\n")
  execFileSync("rm", [join(home, ".local/state/fixture.store")], { timeout: 120_000 })
  execFileSync("mkdir", ["-m", "700", join(home, ".local/state/fixture.store")], { timeout: 120_000 })
  execFileSync("ln", ["-s", join(victim, "memory.json"), join(home, ".local/state/fixture.store/memory.json")], { timeout: 120_000 })
  refused = store(home, ["read", ...base]).result
  assert.equal(refused.state, "refused")
  assert.match(refused.reason, /symbolic link/)
  assert.equal(store(home, ["write", ...base, "--value", "1"]).result.state, "ok", "the write replaces the link with a regular file")
  assert.equal(readFileSync(join(victim, "memory.json"), "utf8"), "untouched\n")
  assert.ok(statSync(join(home, ".local/state/fixture.store/memory.json")).isFile())
  execFileSync("chmod", ["660", join(home, ".local/state/fixture.store/memory.json")], { timeout: 120_000 })
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
  execFileSync("touch", ["-d", "-1 hour", join(dir, ".store-99999-0123456789abcdef.tmp")], { timeout: 120_000 })
  writeFileSync(join(dir, ".store-99998-fedcba9876543210.tmp"), "{")
  assert.equal(store(home, ["write", ...base, "--value", "{}"]).result.state, "ok")
  assert.deepEqual(readdirSync(dir).sort(), [".store-99998-fedcba9876543210.tmp", "memory.json"], "the stale one is swept, the fresh one is a live writer's")
})

// 0.2.0 (docs/evidence/blocks/2026-09-18-review.json): S1, S2, S3, S5, S6 at the helper.
test("the store helper refuses a FIFO by name without waiting on it, fails a write it cannot complete and leaves the old file whole, and reads a non-ASCII file as the bytes it holds", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-store-"))
  const base = ["--kind", "state", "--plugin", "fixture.store", "--name", "memory.json"]
  const dir = join(home, ".local/state/fixture.store")
  execFileSync("mkdir", ["-p", "-m", "700", dir], { timeout: 120_000 })
  execFileSync("mkfifo", ["-m", "600", join(dir, "memory.json")], { timeout: 120_000 })
  const started = Date.now()
  const fifo = store(home, ["read", ...base]).result
  assert.equal(fifo.state, "refused")
  assert.match(fifo.reason, /not a regular file/)
  assert.ok(Date.now() - started < 2000, "the FIFO was not waited on")
  assert.equal(store(home, ["write", ...base, "--value", JSON.stringify({ version: 1 })]).result.state, "ok", "the write renames over the FIFO")
  assert.ok(statSync(join(dir, "memory.json")).isFile())
  // RLIMIT_FSIZE on the helper: the first write is short, the next raises; nothing partial is renamed.
  const big = JSON.stringify({ version: 2, big: "x".repeat(9000) })
  const limited = spawnSync("/usr/bin/prlimit", ["--fsize=4096", PYTHON, "-I", "-S", "-B", STORE_HELPER, "write", ...base, "--value", big], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin", HOME: home } })
  const short = JSON.parse(limited.stdout.trim().split("\n").pop())
  assert.equal(short.state, "failed", limited.stderr)
  assert.match(short.reason, /File too large|No space left/)
  assert.deepEqual(readdirSync(dir), ["memory.json"], "no staging file is left")
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "memory.json"), "utf8")), { version: 1 }, "the old file is whole")
  const text = "\u00e9\u20ac\u{1F600}".repeat(5000)
  assert.equal(store(home, ["write", ...base, "--value", JSON.stringify({ text })]).result.state, "ok")
  const raw = spawnSync(PYTHON, ["-I", "-S", "-B", STORE_HELPER, "read", ...base], { timeout: 120_000, env: { PATH: "/usr/bin", HOME: home } })
  assert.ok(raw.stdout.length < 2 * statSync(join(dir, "memory.json")).size, "the result line is about the file's size, not its escaped size")
  assert.deepEqual(JSON.parse(raw.stdout.toString("utf8").trim()).value, { text })
})

test("the store helper: a schema outside the subset, a schema over 64 KiB and a value nested too deep are refused or invalid, never a traceback; the importer path closes every descriptor on a refusal", { skip: !hasPython && "no /usr/bin/python3" }, () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-store-"))
  const base = ["--kind", "state", "--plugin", "fixture.store", "--name", "memory.json"]
  for (const [schema, reason] of [
    [{ type: ["string", "null"] }, /wrong kind/],
    [{ type: "integer", minimum: "1" }, /wrong kind/],
    [{ type: "array", items: "string" }, /wrong kind/],
    [{ type: "object", properties: { a: { type: "object", required: "a" } } }, /wrong kind/],
    [[], /not an object/],
  ]) {
    const result = store(home, ["write", ...base, "--schema", JSON.stringify(schema), "--value", "1"])
    assert.equal(result.result.state, "refused", JSON.stringify(schema))
    assert.match(result.result.reason, reason)
    assert.equal(result.err, "", "no traceback")
  }
  const huge = store(home, ["write", ...base, "--schema", JSON.stringify({ type: "string", pattern: "x".repeat(70000) }), "--value", "1"])
  assert.equal(huge.result.state, "refused")
  assert.match(huge.result.reason, /over 65536 bytes/)
  const deep = store(home, ["write", ...base, "--value", "[".repeat(100) + "]".repeat(100)])
  assert.equal(deep.result.state, "invalid")
  assert.match(deep.result.reason, /nested deeper/)
  const deeper = store(home, ["write", ...base, "--value", "[".repeat(5000) + "]".repeat(5000)])
  assert.equal(deeper.result.state, "invalid", deeper.err)
  assert.equal(deeper.err, "", "no traceback")
  // The importer: a refusal on the walk must not leave a descriptor open per operation.
  execFileSync("mkdir", ["-p", join(home, ".local/state")], { timeout: 120_000 })
  execFileSync("ln", ["-s", "/tmp", join(home, ".local/state/fixture.linked")], { timeout: 120_000 })
  const probe = spawnSync(PYTHON, ["-I", "-S", "-B", "-c", `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("store_helper", sys.argv[1]); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
opts = {"op": "read", "kind": "state", "plugin": "fixture.linked", "name": "memory.json", "max_bytes": "1048576"}
before = len(os.listdir("/proc/self/fd"))
states = [mod.result_of(opts, {"HOME": sys.argv[2]})["state"] for _ in range(50)]
print(states[0], len(os.listdir("/proc/self/fd")) - before)
`, STORE_HELPER, home], { timeout: 120_000, encoding: "utf8", env: { PATH: "/usr/bin" } })
  assert.equal(probe.stdout.trim(), "refused 0", probe.stderr)
})

test("add store brings run along, reports each file's block, and add run alone leaves store out", () => {
  const dir = pluginDir()
  const result = addBlock({ repoRoot: REPO_ROOT, block: "store", dir })
  assert.deepEqual(result.requires, ["run 0.2.1"])
  assert.deepEqual(result.files.map((file) => [file.block, file.path, file.state]), [
    ["run", "omakit/Run.qml", "written"], ["run", "omakit/run-supervisor.py", "written"],
    ["store", "omakit/Store.qml", "written"], ["store", "omakit/store-helper.py", "written"],
  ])
  assert.match(readFileSync(join(dir, "omakit/NOTICE"), "utf8"), /block run 0\.2\.1[\s\S]*block store 0\.2\.0/)
  const other = pluginDir()
  assert.deepEqual(addBlock({ repoRoot: REPO_ROOT, block: "run", dir: other }).files.map((file) => file.block), ["run", "run"])
  assert.deepEqual(readdirSync(join(other, "omakit")).sort(), ["NOTICE", "Run.qml", "run-supervisor.py"])
  const cli = run(["add", "store", other])
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /current +omakit\/Run\.qml \(run, which store uses\)/)
  assert.match(cli.out, /written +omakit\/Store\.qml/)
  assert.match(cli.out, /block +store 0\.2\.0, with run 0\.2\.1/)
})

test("inspect: an unmodified store block is one row beside run's, and the Store site is a write under the plugin's own state directory at mode 0600; a modified copy is read like any other file", async () => {
  const whole = await inspectPlugin({ repoRoot: REPO_ROOT, target: materialiseInspectFixture("store-block").dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(whole.blocks.map((block) => [block.name, block.state, block.complete]), [["run", "unmodified", true], ["store", "unmodified", true]])
  assert.deepEqual(whole.observed.writes.map((row) => [row.file, row.line, row.via, row.path, row.controlledDirectory, row.controlledBy, row.mode, row.block]), [["Widget.qml", 8, "block-store", "$XDG_STATE_HOME/fixture.store-block/memory.json", "observed", "$XDG_STATE_HOME", "0600", "store"]])
  assert.deepEqual(whole.patterns, [])
  const report = renderInspect(whole, { colour: false })
  assert.match(report.replace(/\n +/g, " "), /blocks +run 0\.2\.1, 2 files, unmodified: no row of its own; store 0\.2\.0, 2 files, unmodified: no row of its own/)
  assert.match(renderInspect(whole, { colour: false, full: true }).replace(/\n +/g, " "), /Store \$XDG_STATE_HOME\/fixture\.store-block\/memory\.json \(through the store block\)/)
  const edited = await inspectPlugin({ repoRoot: REPO_ROOT, target: materialiseInspectFixture("store-block-modified").dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-blocks-")) })
  assert.deepEqual(edited.blocks.map((block) => [block.name, block.state]), [["run", "unmodified"], ["store", "modified"]])
  assert.deepEqual(edited.observed.writes, [], "without the whole store block, Store is not a write the extraction knows")
  assert.match(renderInspect(edited, { colour: false }).replace(/\n +/g, " "), /store 0\.2\.0, modified \(omakit\/store-helper\.py\): read like any other file/)
})

// --- helpers a Run site resolves to -------------------------------------------------

test("a Run-started helper is the file a site's argv[0] resolves to through the text, never a base name; exec is a process site", () => {
  const picker = {
    path: "v0200/Picker.qml", kind: "qml", text: `import QtQuick
import "../omakit"
Item {
  id: root
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  function localPath(url) {
    var value = String(url || "")
    if (value.indexOf("file://") === 0) value = value.substring(7)
    try { return decodeURIComponent(value) } catch (e) { return value }
  }
  function pluginScriptPath(name) {
    // the host's directory is private, so resolve from this file
    const dir = localPath(Qt.resolvedUrl("../")).replace(/\\/$/, "")
    return dir ? dir + "/" + name : ""
  }
  function scriptPath(name) { return omarchyPath + "/shell/plugins/image-picker/" + name }
  function first() { const script = pluginScriptPath("a.sh"); one.command = [script, "x"]; one.start() }
  function second() { const script = pluginScriptPath("b.sh"); two.command = [script]; two.start() }
  function third() { three.command = [root.scriptPath("list.sh")]; three.start() }
  function fourth() { four.command = Model.arguments(pluginScriptPath("c.sh")); four.start() }
  Run { id: one }
  Run { id: two }
  Run { id: three }
  Run { id: four }
  Run { id: five; command: [root.pluginScriptPath("d.sh")] }
  Child { id: child; helperPath: root.pluginScriptPath("e.sh") }
}
` }
  const child = { path: "v0200/Child.qml", kind: "qml", text: `import QtQuick
import "../omakit"
Item {
  property string helperPath: ""
  Run { id: run; command: [helperPath, "--go"] }
}
` }
  const files = [picker, child, ...["a.sh", "b.sh", "c.sh", "d.sh", "e.sh", "list.sh"].map((path) => ({ path, kind: "shell", text: "#!/usr/bin/bash\nexec /usr/bin/true\n" }))]
  const processes = files.filter((file) => file.kind === "qml").flatMap((file) => extractProcesses(file, { runBlock: true }))
  const { helpers, resolved } = runStartedHelpers(files, processes)
  assert.deepEqual([...helpers].sort(), ["a.sh", "b.sh", "d.sh", "e.sh"])
  const at = (file, line) => resolved.get(`${file}:${line}`)
  assert.equal(at("v0200/Picker.qml", 17), "@/a.sh", "the nearest assignment before the site, not the file's first")
  assert.equal(at("v0200/Picker.qml", 18), "@/b.sh")
  assert.equal(at("v0200/Picker.qml", 19), "$OMARCHY_PATH/shell/plugins/image-picker/list.sh", "Omarchy's tree, not this one")
  assert.equal(at("v0200/Picker.qml", 20), null, "an array from a JavaScript module is computed, not resolved")
  assert.equal(at("v0200/Picker.qml", 25), "@/d.sh", "a call to a same-file function through its return expression")
  assert.equal(at("v0200/Child.qml", 5), "@/e.sh", "a property the parent file binds on the component")
  const shell = extractProcesses({ path: "a.sh", kind: "shell", text: "#!/usr/bin/bash\nexec /usr/bin/flock -n lock true\nexec 3>&1\nexec\n" })
  assert.deepEqual(shell.map((row) => row.argv), [["/usr/bin/flock", "-n", "lock", "true"]], "exec cmd is a process site; exec alone or with a redirection is not")
})
