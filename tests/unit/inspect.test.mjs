// `omakit inspect`: the extractors on the fixtures, every produced document
// against the committed one and against the contract, the report's words
// under colour and without, the four "observed nothing of this kind" lines,
// and the exit codes. A change in extraction is a visible diff against
// tests/fixtures/inspect/<name>.expected.json, never a silent one.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectPlugin, NOT_VISIBLE } from "../../tools/inspect/inspect.mjs"
import { renderInspect } from "../../tools/inspect/report.mjs"
import { validateInspectDocument } from "../../tools/inspect/contract.mjs"
import { PATTERNS } from "../../tools/inspect/patterns.mjs"
import { arrayLiteral, blocks, propertyValue, shellSegments, shellWords, stringLiteral } from "../../tools/inspect/text.mjs"
import { extractProcesses, timeoutMs, toolOf } from "../../tools/inspect/processes.mjs"
import { extractHosts, hostOf, privateAddress } from "../../tools/inspect/hosts.mjs"
import { canonicalPath, classifyPath, extractWrites } from "../../tools/inspect/writes.mjs"
import { extractTimers } from "../../tools/inspect/timers.mjs"
import { kindOfShebang } from "../../tools/inspect/walk.mjs"
import { DENSITY, INSPECT_VERDICT, overflows, plain, STATUS } from "../../tools/marketplace/style.mjs"
import { INSPECT_FIXTURES, inspectExpectedPath, materialiseInspectFixture } from "../fixtures/inspect.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()

const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version
const KNOWN = { patternIds: PATTERNS.map((pattern) => pattern.id), notVisible: [...NOT_VISIBLE] }

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined, ...env },
  })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

/** The document with the three values that differ per materialisation replaced, so it compares with the committed one. */
function normalise(document) {
  const copy = JSON.parse(JSON.stringify(document))
  copy.omakit = "<version>"
  copy.subject.dir = "<dir>"
  copy.subject.commit = "<commit>"
  if (copy.marketplaceBaseline.official) copy.marketplaceBaseline.official.commitSha = "<commit>"
  return copy
}

const documents = new Map()
async function documentFor(name, options = {}) {
  const key = `${name}:${JSON.stringify(options)}`
  if (!documents.has(key)) {
    const fixture = materialiseInspectFixture(name)
    const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: fixture.dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-inspect-")), ...options })
    documents.set(key, { fixture, document })
  }
  return documents.get(key)
}

// --- the fixtures, field by field ---------------------------------------------

test("every fixture the design note lists has a tree and a committed expected document", () => {
  for (const name of ["nothing", "process-with-deadline", "process-without-deadline", "computed-command", "shell-wrapper", "curl-with-caps", "curl-without-caps", "http-host", "write-state", "write-tmp", "timer-180ms", "secret-in-argv", "richtext-sink", "installer-unpinned"]) {
    assert.ok(INSPECT_FIXTURES.includes(name), `${name} is not a fixture`)
  }
  for (const name of INSPECT_FIXTURES) assert.ok(existsSync(inspectExpectedPath(name)), `${name} has no expected document`)
})

for (const name of INSPECT_FIXTURES) {
  test(`${name}: the produced document is the committed one, field by field, and follows the contract`, async () => {
    const { document } = await documentFor(name)
    const expected = JSON.parse(readFileSync(inspectExpectedPath(name), "utf8"))
    const produced = normalise(document)
    for (const key of Object.keys(expected)) {
      if (key === "observed") {
        for (const kind of Object.keys(expected.observed)) assert.deepEqual(produced.observed[kind], expected.observed[kind], `${name}: observed.${kind} differs from the committed document`)
        continue
      }
      assert.deepEqual(produced[key], expected[key], `${name}: ${key} differs from the committed document`)
    }
    assert.deepEqual(produced, expected, `${name}: the produced document has a field the committed one lacks`)
    assert.deepEqual(validateInspectDocument(document, KNOWN), [], `${name}: the document departs from the contract`)
    assert.ok(/^[0-9a-f]{40}$/.test(document.subject.commit))
  })
}

test("the rendered report says the same words with and without colour, and nothing is wider than the column", async () => {
  for (const name of INSPECT_FIXTURES) {
    const { document } = await documentFor(name)
    const uncoloured = renderInspect(document, { colour: false })
    const coloured = renderInspect(document, { colour: true })
    assert.equal(plain(coloured), uncoloured, `${name}: colour changed the words`)
    assert.notEqual(coloured, uncoloured, `${name}: colour was applied`)
    for (const line of uncoloured.split("\n")) assert.ok(!overflows(line), `${name}: ${plain(line).length} columns: ${JSON.stringify(line)}`)
    // No verdict mark: the report never says ok or FAIL about anything.
    assert.ok(!uncoloured.includes(`${DENSITY.floor} ${STATUS.pass.word}`), `${name}: the report drew an ok mark`)
    assert.ok(!uncoloured.includes(`${DENSITY.full} ${STATUS.fail.word}`), `${name}: the report drew a FAIL mark`)
    assert.ok(!/\b(?:safe|unsafe|clean)\b/.test(uncoloured), `${name}: the report reads as a verdict`)
    assert.ok(uncoloured.endsWith("static, see docs/INSPECT.md") || /INSPECTED/.test(uncoloured.split("\n").at(-2)), `${name}: the report does not end on the closing line`)
    assert.match(uncoloured, new RegExp(`${DENSITY.light} ${INSPECT_VERDICT}`))
    assert.match(uncoloured, /^not visible   /m)
  }
})

test("the nothing fixture is reported as observed nothing of this kind, four times, and never as clean", async () => {
  const { document } = await documentFor("nothing")
  const report = renderInspect(document, { colour: false })
  assert.equal((report.match(/observed nothing of this kind/g) || []).length, 4)
  for (const key of ["processes", "hosts", "writes", "timers"]) {
    assert.match(report, new RegExp(`^${key}\\s+observed nothing of this kind$`, "m"))
    assert.deepEqual(document.observed[key], [])
  }
  assert.deepEqual(document.patterns, [])
  assert.doesNotMatch(report, /\bclean\b/)
  assert.match(report, new RegExp(`${DENSITY.light} ${INSPECT_VERDICT}  0 processes, 0 hosts, 0 writes, 0 timers`))
})

test("a command that is not a literal is a ▒ ? row with argv null, listed under notResolvable, never a guess", async () => {
  const { document } = await documentFor("computed-command")
  const [process] = document.observed.processes
  assert.equal(process.argv, null)
  assert.equal(process.argvForm, "computed")
  assert.equal(process.commandText, "root.cmd")
  assert.deepEqual(document.notResolvable, [{ file: "Widget.qml", line: 10, kind: "command", text: "command: root.cmd" }])
  const report = renderInspect(document, { colour: false })
  assert.match(report, new RegExp(`^${DENSITY.medium} \\?\\s+Widget.qml:10  command: root.cmd$`, "m"))
  assert.match(report, /argv not resolvable statically/)
  assert.doesNotMatch(report, /uptime/, "the property's value is never read as the command")
})

test("the facts the fixtures were written to show", async () => {
  const deadline = (await documentFor("process-with-deadline")).document.observed.processes[0]
  assert.deepEqual(deadline.deadline, { observed: true, via: "timer-kill", ms: 8000 })
  assert.deepEqual(deadline.output, { collector: "StdioCollector", capObserved: true, via: "head -c" })
  assert.equal(deadline.shellWrapper, true)
  const none = (await documentFor("process-without-deadline")).document.observed.processes[0]
  assert.deepEqual(none.deadline, { observed: false, via: null, ms: null })
  assert.deepEqual(none.output, { collector: "StdioCollector", capObserved: false, via: null })
  assert.equal((await documentFor("shell-wrapper")).document.observed.processes[0].shellWrapper, true)
  const capped = (await documentFor("curl-with-caps")).document.observed.hosts[0]
  assert.equal(capped.host, "api.example.com")
  assert.equal(capped.tool, "curl")
  assert.deepEqual(capped.timeout, { observed: true, via: "--max-time 5" })
  assert.deepEqual(capped.sizeCap, { observed: true, via: "--max-filesize 65536" })
  const bare = (await documentFor("curl-without-caps")).document.observed.hosts[0]
  assert.deepEqual(bare.timeout, { observed: false, via: null })
  assert.deepEqual(bare.sizeCap, { observed: false, via: null })
  assert.ok(bare.flags.includes("-fsSL"))
  assert.equal((await documentFor("http-host")).document.observed.hosts[0].scheme, "http")
  const state = (await documentFor("write-state")).document.observed.writes[0]
  assert.equal(state.via, "FileView")
  assert.equal(state.controlledDirectory, "observed")
  assert.equal(state.controlledBy, "$XDG_STATE_HOME")
  const temp = (await documentFor("write-tmp")).document.observed.writes[0]
  assert.equal(temp.via, ">")
  assert.equal(temp.controlledDirectory, "not-observed")
  assert.equal(temp.temp, true)
  const timer = (await documentFor("timer-180ms")).document.observed.timers[0]
  assert.equal(timer.intervalMs, 180)
  assert.equal(timer.repeat, true)
  assert.equal(timer.running, true)
  assert.ok((await documentFor("secret-in-argv")).document.observed.processes[0].argv.some((word) => word.startsWith("Authorization: Bearer")))
  const installer = (await documentFor("installer-unpinned")).document.marketplaceBaseline
  assert.equal(installer.invoked, true)
  assert.ok(installer.official.findings.length >= 1, "the baseline records the unpinned clone")
  assert.equal(installer.official.findings[0].evidence[0].path, "scripts/install.sh")
})

test("--offline skips the baseline and says so with the skipped mark; the document says skipped", async () => {
  const { document } = await documentFor("nothing", { offline: true })
  assert.deepEqual(document.marketplaceBaseline, { skipped: true, reason: "--offline" })
  assert.deepEqual(validateInspectDocument(document, KNOWN), [])
  const report = renderInspect(document, { colour: false })
  assert.match(report, new RegExp(`^${DENSITY.ceiling} ${STATUS.skipped.word}\\s+skipped \\(--offline\\)$`, "m"))
})

// --- the entry point ------------------------------------------------------------

test("exit 0 with a report whatever was observed; --json is the document; --out writes it beside the report", async () => {
  const fixture = materialiseInspectFixture("process-without-deadline")
  const report = run(["inspect", fixture.dir])
  assert.equal(report.code, 0, report.err)
  assert.equal(report.err, "")
  assert.match(report.out, /^processes {5}observed 1$/m)
  const json = run(["inspect", fixture.dir, "--json"])
  assert.equal(json.code, 0)
  const document = JSON.parse(json.out)
  assert.equal(document.command, "inspect")
  assert.equal(document.subject.commit, fixture.commit)
  assert.deepEqual(validateInspectDocument(document, KNOWN), [])
  const out = join(mkdtempSync(join(tmpdir(), "omakit-inspect-out-")), "nested", "inspect.json")
  const written = run(["inspect", fixture.dir, "--out", out])
  assert.equal(written.code, 0)
  assert.match(written.out, /INSPECTED/)
  assert.deepEqual(normalise(JSON.parse(readFileSync(out, "utf8"))), normalise(document))
  // The words are the contract: a piped run and a coloured run say the same thing.
  const lit = run(["inspect", fixture.dir], { FORCE_COLOR: "1" })
  assert.equal(plain(lit.out), report.out)
  assert.notEqual(lit.out, report.out)
  const dark = run(["inspect", fixture.dir], { NO_COLOR: "1" })
  assert.equal(dark.out, report.out)
})

test("exit 2 when the target cannot be read: no directory, no Git checkout, no manifest, no target, an unknown option", () => {
  const missing = run(["inspect", join(tmpdir(), "omakit-no-such-directory")])
  assert.equal(missing.code, 2)
  assert.match(missing.err, /subject-not-found/)
  assert.equal(missing.out, "")
  const plain_ = mkdtempSync(join(tmpdir(), "omakit-inspect-plain-"))
  writeFileSync(join(plain_, "manifest.json"), "{}\n")
  const notGit = run(["inspect", plain_])
  assert.equal(notGit.code, 2)
  assert.match(notGit.err, /not-a-git-repository/)
  const noManifest = mkdtempSync(join(tmpdir(), "omakit-inspect-nomanifest-"))
  mkdirSync(join(noManifest, "src"))
  writeFileSync(join(noManifest, "src", "Widget.qml"), "import QtQuick\nItem { }\n")
  const git = (...args) => spawnSync("git", ["-C", noManifest, ...args], { encoding: "utf8" })
  git("init", "-q", "-b", "main")
  git("-c", "user.name=Omakit tests", "-c", "user.email=tests@example.invalid", "-c", "commit.gpgsign=false", "add", "-A")
  git("-c", "user.name=Omakit tests", "-c", "user.email=tests@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture")
  const nothing = run(["inspect", noManifest])
  assert.equal(nothing.code, 2, nothing.err)
  assert.match(nothing.err, /nothing-to-inspect/)
  assert.match(nothing.err, /no manifest\.json/)
  const noTarget = run(["inspect"])
  assert.equal(noTarget.code, 2)
  assert.match(noTarget.err, /usage/)
  const unknown = run(["inspect", ".", "--strict"])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /--strict is not an option this command knows/)
})

test("a dirty checkout is refused with the same remedy submit gives, and --allow-dirty reads it as it is", () => {
  const fixture = materialiseInspectFixture("nothing")
  writeFileSync(join(fixture.dir, "DIRTY"), "uncommitted\n")
  const refused = run(["inspect", fixture.dir])
  assert.equal(refused.code, 1)
  assert.match(refused.err, /dirty-worktree/)
  assert.match(refused.err, /--allow-dirty/)
  const allowed = run(["inspect", fixture.dir, "--allow-dirty", "--json"])
  assert.equal(allowed.code, 0)
  assert.equal(JSON.parse(allowed.out).subject.filesRead.qml, 1, "the tree at the commit, not the working copy")
})

// --- the extractors on text ------------------------------------------------------

test("the text primitives: blocks, property values, literals and shell words", () => {
  const qml = "Item {\n  Process {\n    id: p\n    command: [\"a\",\n      'b', `c`, root.d]\n    stdout: StdioCollector { id: out }\n  }\n}\n"
  const [block] = blocks(qml, "Process")
  assert.equal(block.id, "p")
  assert.equal(block.line, 2)
  const command = propertyValue(block.body, "command")
  assert.deepEqual(arrayLiteral(command.text).map((entry) => entry.literal), ["a", "b", "c", null])
  assert.equal(propertyValue(block.body, "id").text, "p")
  assert.equal(propertyValue(block.body, "onTriggered"), null)
  assert.equal(stringLiteral("`x ${y}`"), null)
  assert.equal(stringLiteral("\"a\\\"b\""), 'a"b')
  assert.deepEqual(shellWords("curl -H 'X: y z' \"$HOME/a b\" c\\ d"), ["curl", "-H", "X: y z", "$HOME/a b", "c d"])
  assert.deepEqual(shellSegments("a | b && c; d 2>&1 || e").map((segment) => [segment.operator, segment.text]), [[null, "a"], ["|", "b"], ["&&", "c"], [";", "d 2>&1"], ["||", "e"]])
  assert.deepEqual(toolOf(["sudo", "-n", "env", "A=1", "timeout", "-k", "1", "5s", "/usr/bin/curl", "x"]), { tool: "/usr/bin/curl", index: 8 })
  assert.equal(timeoutMs(["timeout", "2m", "x"]), 120000)
  assert.equal(timeoutMs(["timeout", "-k", "1", "5s", "x"]), 5000)
  assert.equal(timeoutMs(["timeout", "$T", "x"]), null)
})

test("processes: a Process without a command in its block reads the assignment to its id; execDetached is a detached row; shell builtins start no process", () => {
  const qml = { path: "A.qml", kind: "qml", text: "Item {\n  Process { id: p }\n  function go() { p.command = [\"/usr/bin/ls\", \"-l\"]; p.running = true }\n  Component.onDestruction: p.kill()\n  MouseArea { onClicked: Quickshell.execDetached([\"xdg-open\", root.url]) }\n}\n" }
  const rows = extractProcesses(qml)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].argv, ["/usr/bin/ls", "-l"])
  assert.equal(rows[0].line, 3)
  assert.equal(rows[0].running, true)
  assert.deepEqual(rows[0].deadline, { observed: true, via: "destruction", ms: null })
  assert.equal(rows[1].detached, true)
  assert.deepEqual(rows[1].expressions, [{ index: 1, text: "root.url" }])
  const commented = extractProcesses({ path: "B.qml", kind: "qml", text: "Item {\n  // Process { command: [\"never\"] }\n  /* Process { command: [\"never\"] } */\n}\n" })
  assert.deepEqual(commented, [])
  const shell = extractProcesses({ path: "s.sh", kind: "shell", text: "#!/bin/sh\nset -e\ncd /tmp\nFOO=bar /usr/bin/a --x | head -c 10 > out.txt\nif [ -f x ]; then eval \"$CMD\"; fi\n" })
  assert.deepEqual(shell.map((row) => [row.line, row.argv[0], row.pipedFrom?.argv0 ?? null, row.shellWrapper]), [[4, "/usr/bin/a", null, false], [4, "head", "/usr/bin/a", false], [5, "eval", null, true]])
  assert.equal(shell[0].output.capObserved, true)
})

test("hosts: the literal gives the host, the argv gives the tool and the flags, an expression in the host makes it not resolvable", () => {
  const file = { path: "A.qml", kind: "qml", text: "Item {\n  Process { id: p; command: [\"/usr/bin/sh\", \"-c\", \"curl -q -m 3 https://a.example/x | head -c 100\"] }\n  property string u: \"https://\" + host + \"/y\"\n  function f() { Qt.openUrlExternally(\"http://127.0.0.1:8080/z\") }\n}\n" }
  const { hosts, notResolvable } = extractHosts(file, extractProcesses(file))
  assert.equal(hosts.length, 2)
  assert.equal(hosts[0].host, "a.example")
  assert.equal(hosts[0].tool, "curl")
  assert.deepEqual(hosts[0].timeout, { observed: true, via: "-m 3" })
  assert.deepEqual(hosts[0].sizeCap, { observed: true, via: "head -c 100" })
  assert.equal(hosts[1].host, "127.0.0.1")
  assert.equal(hosts[1].tool, "Qt.openUrlExternally")
  assert.equal(hosts[1].privateAddress, true)
  assert.deepEqual(notResolvable, [{ file: "A.qml", line: 3, kind: "host", text: "https://" }])
  assert.equal(hostOf("https://user@[::1]:8/x"), "[::1]")
  assert.equal(hostOf("https://${h}/x"), null)
  assert.equal(privateAddress("10.0.0.1"), true)
  assert.equal(privateAddress("172.32.0.1"), false)
  assert.equal(privateAddress("api.example.com"), false)
})

test("writes: the controlled-directory test on canonical prefixes, and the shell forms", () => {
  assert.equal(canonicalPath("~/.local/state/x/y"), "$XDG_STATE_HOME/x/y")
  assert.equal(canonicalPath("${XDG_CACHE_HOME}/x"), "$XDG_CACHE_HOME/x")
  assert.equal(canonicalPath("Quickshell.env(\"HOME\") + \"/.config/omarchy/plugins/a.b/c\""), "$XDG_CONFIG_HOME/omarchy/plugins/a.b/c")
  assert.equal(canonicalPath("root.dir + \"/x\""), null)
  assert.deepEqual(classifyPath("$XDG_CONFIG_HOME/omarchy/plugins/a.b/c", "a.b").controlledDirectory, "observed")
  assert.deepEqual(classifyPath("$XDG_CONFIG_HOME/omarchy/plugins/other/c", "a.b").controlledDirectory, "not-observed")
  assert.deepEqual(classifyPath("$XDG_RUNTIME_DIR/x", null), { controlledDirectory: "observed", controlledBy: "$XDG_RUNTIME_DIR", temp: false })
  assert.deepEqual(classifyPath("/dev/shm/x", null), { controlledDirectory: "not-observed", controlledBy: null, temp: true })
  assert.deepEqual(classifyPath("$OTHER/x", null).controlledDirectory, "unknown")
  assert.deepEqual(classifyPath("relative/x", null).controlledDirectory, "unknown")
  const shell = { path: "i.sh", kind: "shell", text: "umask 077\nmkdir -p -m 700 \"$HOME/.cache/p\"\nt=$(mktemp)\necho x | tee /tmp/a.log >> ~/.local/state/p/log 2>/dev/null\ninstall -m 0644 f /etc/x\ncp a b\nchmod 600 b\n" }
  const rows = extractWrites(shell, { pluginId: "p" })
  assert.deepEqual(rows.map((row) => [row.line, row.via, row.canonicalPath, row.controlledDirectory, row.mode]), [
    [2, "mkdir", "$XDG_CACHE_HOME/p", "observed", "700"],
    [3, "mktemp", "/tmp/tmp.XXXXXX", "not-observed", "0600"],
    [4, ">>", "$XDG_STATE_HOME/p/log", "observed", "umask 077"],
    [4, "tee", "/tmp/a.log", "not-observed", "umask 077"],
    [5, "install", "/etc/x", "not-observed", "0644"],
    [6, "cp", "b", "unknown", "chmod 600"],
  ])
  const js = extractWrites({ path: "a.mjs", kind: "js", text: "writeFileSync(join(dir, \"x\"), data)\nappendFile(\"/tmp/y\", d)\n" })
  assert.deepEqual(js.map((row) => [row.via, row.controlledDirectory]), [["writeFileSync", "unknown"], ["appendFile", "not-observed"]])
  const python = extractWrites({ path: "a.py", kind: "python", text: "with open('/tmp/z', 'w') as f:\n  pass\nopen(p, 'r')\n" })
  assert.deepEqual(python.map((row) => [row.line, row.path]), [[1, "'/tmp/z'"]])
  const read = extractWrites({ path: "R.qml", kind: "qml", text: "FileView { path: \"/etc/hostname\" }\n" })
  assert.deepEqual(read, [], "a FileView without a write is a read")
})

test("timers: interval, repeat, running, triggeredOnStart, the handler that starts it, and an expression interval as not resolvable", () => {
  const file = { path: "T.qml", kind: "qml", text: "Item {\n  Timer { id: a; interval: 1000; repeat: true; running: false; triggeredOnStart: true }\n  Timer { id: b; interval: root.period; running: true }\n  onVisibleChanged: { if (visible) a.start() }\n}\n" }
  const { timers, notResolvable } = extractTimers(file)
  assert.deepEqual(timers[0], { file: "T.qml", line: 2, id: "a", intervalMs: 1000, intervalText: null, repeat: true, running: false, triggeredOnStart: true, startedBy: "onVisibleChanged" })
  assert.equal(timers[1].intervalMs, null)
  assert.equal(timers[1].intervalText, "root.period")
  assert.deepEqual(notResolvable, [{ file: "T.qml", line: 3, kind: "timer-interval", text: "root.period" }])
})

test("the walk reads kinds by extension and by shebang, and prose is not a kind", () => {
  assert.equal(kindOfShebang("#!/usr/bin/env bash"), "shell")
  assert.equal(kindOfShebang("#!/usr/bin/python3"), "python")
  assert.equal(kindOfShebang("#!/usr/bin/env node"), "js")
  assert.equal(kindOfShebang("#!/usr/bin/perl"), "other")
  assert.equal(kindOfShebang("no shebang"), null)
})
