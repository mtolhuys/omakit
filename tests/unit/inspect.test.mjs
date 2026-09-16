// `omakit inspect`: the extractors on the fixtures, every produced document
// against the committed one and against the contract, the report's words
// under colour and without, the four "observed nothing of this kind" lines,
// and the exit codes. A change in extraction is a visible diff against
// tests/fixtures/inspect/<name>.expected.json, never a silent one.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
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
import { extractFunctions } from "../../tools/inspect/functions.mjs"
import { heavyShare, SIZE, overSize, sizeScore, treeRank } from "../../tools/inspect/patterns.mjs"
import { kindOfShebang } from "../../tools/inspect/walk.mjs"
import { DENSITY, INSPECT_VERDICT, overflows, plain, STATUS } from "../../tools/marketplace/style.mjs"
import { INSPECT_FIXTURES, inspectExpectedPath, inspectFixtureDir, materialiseInspectFixture, readFixtureTree } from "../fixtures/inspect.mjs"
import { materialise } from "../fixtures/plugins.mjs"
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

test("the rendered report, in both views, says the same words with and without colour, and nothing is wider than the column", async () => {
  for (const name of INSPECT_FIXTURES) for (const full of [false, true]) {
    const { document } = await documentFor(name)
    const uncoloured = renderInspect(document, { colour: false, full })
    const coloured = renderInspect(document, { colour: true, full })
    assert.equal(plain(coloured), uncoloured, `${name}: colour changed the words`)
    assert.notEqual(coloured, uncoloured, `${name}: colour was applied`)
    for (const line of uncoloured.split("\n")) assert.ok(!overflows(line), `${name}: ${plain(line).length} columns: ${JSON.stringify(line)}`)
    // No verdict mark: the report never says ok or FAIL about anything.
    assert.ok(!uncoloured.includes(`${DENSITY.floor} ${STATUS.pass.word}`), `${name}: the report drew an ok mark`)
    assert.ok(!uncoloured.includes(`${DENSITY.full} ${STATUS.fail.word}`), `${name}: the report drew a FAIL mark`)
    assert.ok(!/\b(?:safe|unsafe|clean)\b/.test(uncoloured), `${name}: the report reads as a verdict`)
    assert.ok(uncoloured.endsWith("static, see docs/INSPECT.md") || /INSPECTED/.test(uncoloured.split("\n").at(-2)), `${name}: the report does not end on the closing line`)
    assert.match(uncoloured, new RegExp(`${DENSITY.light} ${INSPECT_VERDICT}`))
    // What the method cannot see is named at the end of both views: a line of its own in --full, in the closing line of the overview.
    if (full) assert.match(uncoloured, /^not visible   /m)
    else assert.match(uncoloured.replace(/\n {13}/g, " "), /observed; static; --full for every site, --json for the document/)
  }
})

test("the default view is what needs attention, biggest first: one block per class by share, the sites under it with the fact at each, classes under 5% counted, nothing else", async () => {
  const example = (await documentFor("example")).document
  const report = renderInspect(example, { colour: false })
  const unwrapped = report.replace(/\n {14}/g, " ").replace(/\n {13}/g, " ").replace(/\n {8}/g, " ")
  const full = renderInspect(example, { colour: false, full: true })
  assert.match(report, /^subject {7}.* at [0-9a-f]{8}$/m)
  assert.match(unwrapped, /^baseline {6}review-required at pin [0-9a-f]{8}: installer, privilege, package-manager$/m)
  assert.match(unwrapped, /^attention {5}5 classes reviewers raise, biggest first by share of review findings \(M11\); up to 5 sites each$/m)
  // Ordered by share, each block a heading then its sites with the fact there.
  const blocks = [...report.matchAll(new RegExp(`^${DENSITY.dark} note  ([a-z ]+?)  (\\d+) of 100 findings`, "gm"))].map((match) => [match[1], Number(match[2])])
  assert.deepEqual(blocks, [["process lifecycle", 20], ["unbounded buffering", 19], ["file and state boundary", 15], ["environment trust", 7], ["network egress", 5]])
  assert.match(report, new RegExp(`^${DENSITY.dark} note  process lifecycle  20 of 100 findings  2 processes with no deadline\\n {8}Widget\\.qml:20  bash scripts/refresh\\.sh\\n {8}Widget\\.qml:28  command: root\\.cmd$`, "m"))
  assert.match(report, /^ {8}scripts\/refresh\.sh:3  > \/tmp\/fixture\.example\.cache$/m, "a write site shows the write, not the command on the same line")
  assert.match(report, /^ {8}Widget\.qml:12 +curl -fsSL --max-time 5 --max-filesize 65536 ht\.\.\.$/m, "a long command is cut, --full has it whole")
  assert.equal((report.match(/^ {8}Widget\.qml:12 /gm) || []).length, 2, "one line per site per class: cited twice by environment trust, listed once there and once under network egress")
  assert.match(report, /^under 5% {6}privilege disclosure \(1 site\)$/m)
  assert.match(unwrapped, /INSPECTED  5 processes \(3 in qml, 2 shell lines\), 1 host, 2 writes, 2 timers observed; static; --full for every site, --json for the document$/m)
  assert.doesNotMatch(report, /^processes|^hosts|^writes|^timers|^method/m, "no fact section: the facts are --full's")
  assert.match(full, /^processes {5}observed 5/m)
  assert.ok(report.split("\n").length <= 40, `${report.split("\n").length} lines is more than a screen`)
  for (const row of example.patterns) assert.ok(!/\w:\d+/.test(row.summary), `${row.id}: the summary carries a site`)
})

test("long functions come first, longest first, over the measured thresholds, and a tree of short functions has no size block", async () => {
  const { document } = await documentFor("long-function")
  assert.equal(document.counts.functions, 4)
  assert.deepEqual(document.size.thresholds, { lines: SIZE.lines, branches: SIZE.branches, depth: SIZE.depth })
  assert.deepEqual(document.size.over.map((entry) => [entry.name, entry.lines, entry.branches, entry.depth]), [["decide", 21, 9, 3], ["classify", 20, 6, 3]])
  // The score is the tree's position among listed trees by the share of its
  // function lines in long functions; every function still carries its rank.
  for (const entry of document.observed.functions) assert.ok(entry.percentile >= 0 && entry.percentile <= 100, `${entry.name}: rank ${entry.percentile}`)
  const lines = document.observed.functions.reduce((sum, entry) => sum + entry.lines, 0)
  const heavy = document.size.over.reduce((sum, entry) => sum + entry.lines, 0)
  assert.equal(document.size.heavyShare, Math.round((heavy / lines) * 10000) / 10000)
  assert.equal(document.size.score, Math.round((10 - treeRank(document.size.heavyShare) / 10) * 100) / 100)
  // Two of its four functions hold 41 of 47 lines, more than any listed tree: the floor.
  assert.equal(document.size.score, 0)
  assert.deepEqual(document.size.sample, { trees: 50, functions: 6041, heavyShares: [...SIZE.distribution.heavyShare] })
  assert.deepEqual(document.observed.functions.map((entry) => entry.name).sort(), ["classify", "decide", "say", "short"])
  const report = renderInspect(document, { colour: false })
  const blocks = [...report.matchAll(new RegExp(`^${DENSITY.dark} note  ([a-z ]+?)  `, "gm"))].map((match) => match[1])
  assert.deepEqual(blocks, ["long functions", "environment trust"], "size before the review classes")
  assert.match(report, /^ {8}scripts\/helper\.sh:8  decide {4}21 lines, 9 branches, nesting 3, rank \d+$/m)
  assert.match(report, /^ {8}Widget\.qml:12 {8}classify {2}20 lines, 6 branches, nesting 3, rank \d+$/m)
  assert.match(report.replace(/\n {14}/g, " "), /^size score {4}0\.00 of 10; 87% of its function lines sit in functions over the measured size, less than 0 of 49 listed trees \(M12\)$/m)
  assert.match(report.replace(/\n {8}/g, " "), /long functions  2 functions over what 90 of 100 functions in 50 listed trees, 6041 functions stay under: 22 lines, 6 branches or nesting 2 \(M12\)/)
  const full = renderInspect(document, { colour: false, full: true })
  assert.match(full, /^functions {5}observed 4, 2 over/m)
  assert.match(full.replace(/\n {8}/g, " "), /░ info  scripts\/helper\.sh:8  decide, 21 lines, 9 branches, nesting 3, over [\d.]+ of 100 listed/)
  const example = (await documentFor("example")).document
  assert.deepEqual(example.size.over, [])
  assert.doesNotMatch(renderInspect(example, { colour: false }), /long functions/)
  assert.equal(example.size.heavyShare, 0)
  assert.equal(example.size.score, 10, "one handler under every threshold: no heavy line, the ceiling")
  assert.match(renderInspect(example, { colour: false }).replace(/\n {14}/g, " "), /^size score {4}10\.00 of 10; 0% of its function lines sit in functions over the measured size, less than 49 of 49 listed trees \(M12\)$/m)
  const empty = (await documentFor("nothing")).document
  assert.equal(empty.size.score, null, "no function, no score")
  assert.equal(empty.size.heavyShare, 0)
  assert.match(renderInspect(empty, { colour: false }), /^size score {4}none: no function to rank$/m)
  assert.match(renderInspect(document, { colour: false, full: true }).replace(/\n {8}/g, " "), /size score 0\.00 of 10: 87% of its function lines sit in functions over the measured size, less than 0 of 49 listed trees \(M12\)/)
  assert.match(renderInspect((await documentFor("nothing")).document, { colour: false }).replace(/\n {14}/g, " "), /^attention {5}nothing: no function over the size of 50 listed trees, 6041 functions \(M12\), and none of the 10 classes/m)
})

test("the size score is line-weighted: splitting a long function raises it, and padding a heavy tree with small functions barely moves it", () => {
  const one = [{ file: "a.js", line: 1, name: "big", kind: "function", lines: 100, branches: 0, depth: 0 }]
  const ten = Array.from({ length: 10 }, (_, index) => ({ file: "a.js", line: 1 + index * 10, name: `part${index}`, kind: "function", lines: 10, branches: 0, depth: 0 }))
  assert.equal(heavyShare(one), 1)
  assert.equal(heavyShare(ten), 0)
  assert.equal(sizeScore(one), 0, "heavier than every listed tree")
  assert.equal(sizeScore(ten), 10, "the same 100 lines in ten functions under the thresholds")
  assert.ok(sizeScore(ten) > sizeScore(one))
  // A heavy tree: one 60-line function beside three short ones.
  const heavy = [{ file: "b.js", line: 1, name: "big", kind: "function", lines: 60, branches: 0, depth: 0 }, ...ten.slice(0, 3)]
  const padded = [...heavy, ...Array.from({ length: 20 }, (_, index) => ({ file: "c.js", line: 1 + index * 3, name: `tiny${index}`, kind: "function", lines: 3, branches: 0, depth: 0 }))]
  const split = [...ten.slice(0, 3), ...Array.from({ length: 6 }, (_, index) => ({ file: "b.js", line: 1 + index * 10, name: `step${index}`, kind: "function", lines: 10, branches: 0, depth: 0 }))]
  assert.equal(heavyShare(heavy), 60 / 90)
  assert.equal(heavyShare(padded), 60 / 150)
  assert.equal(heavyShare(split), 0)
  const bySplitting = sizeScore(split) - sizeScore(heavy)
  const byPadding = sizeScore(padded) - sizeScore(heavy)
  assert.ok(bySplitting > 0)
  assert.ok(byPadding < bySplitting, `padding moved the score by ${byPadding}, splitting by ${bySplitting}`)
  // The rank is the share of listed trees strictly lighter, so the ceiling and the floor are exact.
  assert.equal(treeRank(0), 0)
  assert.equal(treeRank(1), 100)
  assert.equal(sizeScore([]), null)
})

test("the three extraction fixtures: Python depth is relative to the body at any indent, a literal is not nesting, and a named arrow or method is a function", async () => {
  const python = (await documentFor("python-depth")).document.observed.functions
  assert.deepEqual(python.map((entry) => [entry.file, entry.name, entry.depth, entry.branches]), [
    ["scripts/four.py", "flat", 0, 0], ["scripts/four.py", "one_if", 1, 1], ["scripts/four.py", "two_deep", 2, 2],
    ["scripts/two.py", "flat", 0, 0], ["scripts/two.py", "one_if", 1, 1], ["scripts/two.py", "two_deep", 2, 2],
  ])
  const literal = (await documentFor("literal-nesting")).document.observed.functions
  assert.deepEqual(literal.map((entry) => [entry.name, entry.depth, entry.branches]), [["describe", 1, 1], ["pairs", 0, 0], ["settings", 1, 3]])
  const arrows = (await documentFor("arrow-and-method")).document.observed.functions
  assert.deepEqual(arrows.map((entry) => [entry.name, entry.kind, entry.line]), [["load", "function", 3], ["normalise", "function", 14], ["add", "function", 21], ["flush", "function", 26], ["reset", "function", 33], ["constructor", "function", 38], ["of", "function", 42], ["put", "function", 46]])
  assert.ok(!arrows.some((entry) => entry.line === 55 || entry.line === 59), "the anonymous callbacks are not functions")
  for (const name of ["python-depth", "literal-nesting", "arrow-and-method"]) {
    const { document } = await documentFor(name)
    assert.equal(document.size.heavyShare, 0)
    assert.equal(document.size.score, 10)
  }
})

test("functions: the extractor counts lines, branches and nesting in QML and JavaScript, shell and Python, and overSize orders longest first", () => {
  const qml = extractFunctions({ path: "A.qml", kind: "qml", text: "Item {\n  function f(a) {\n    if (a && b) { return 1 } else { return 2 }\n  }\n  onClicked: {\n    for (var i = 0; i < 3; i++) { x(i) }\n  }\n  onHovered: x()\n  // function g() { never }\n}\n" })
  assert.deepEqual(qml.map((entry) => [entry.name, entry.kind, entry.line, entry.lines, entry.branches, entry.depth]), [["f", "function", 2, 3, 2, 1], ["onClicked", "handler", 5, 3, 1, 1]])
  const sh = extractFunctions({ path: "s.sh", kind: "shell", text: "a() {\n  if x; then\n    for y in z; do\n      w\n    done\n  fi\n}\nfunction b {\n  c\n}\n" })
  assert.deepEqual(sh.map((entry) => [entry.name, entry.line, entry.lines, entry.branches, entry.depth]), [["a", 1, 7, 2, 2], ["b", 8, 3, 0, 0]])
  const py = extractFunctions({ path: "p.py", kind: "python", text: "def f(x):\n    if x:\n        for y in x:\n            pass\n    return 1\n\ndef g():\n    return 2\n" })
  assert.deepEqual(py.map((entry) => [entry.name, entry.line, entry.lines, entry.branches, entry.depth]), [["f", 1, 5, 2, 2], ["g", 7, 2, 0, 0]])
  const rows = [{ file: "a", line: 1, name: "x", kind: "function", lines: 5, branches: 1, depth: 0 }, { file: "a", line: 9, name: "y", kind: "function", lines: 30, branches: 1, depth: 0 }, { file: "b", line: 1, name: "z", kind: "function", lines: 5, branches: 9, depth: 0 }]
  assert.deepEqual(overSize(rows).map((entry) => entry.name), ["y", "z"])
})

test("the attention view over nothing, and the site cap and the threshold", async () => {
  const nothing = renderInspect((await documentFor("nothing")).document, { colour: false })
  assert.match(nothing.replace(/\n {14}/g, " "), /^attention {5}nothing: no function over the size of 50 listed trees, 6041 functions \(M12\), and none of the 10 classes reviewers raise shows in this tree \(M11\)$/m)
  assert.doesNotMatch(nothing, new RegExp(`${DENSITY.dark} note`))
  assert.doesNotMatch(nothing, /^under 5%/m)
  const base = (await documentFor("nothing")).document
  const many = { ...base, size: { ...base.size, over: [] }, patterns: [
    { id: "privilege-disclosure", observedCount: 2, sites: [{ file: "A.qml", line: 1 }, { file: "A.qml", line: 2 }], observation: "observed sudo in argv (A.qml:1, A.qml:2)", summary: "sudo in argv", measurement: "M11", share: 0.03 },
    { id: "process-lifecycle", observedCount: 7, sites: [1, 2, 3, 4, 5, 6, 7].map((line) => ({ file: "A.qml", line })), observation: "observed 7 processes with no deadline (A.qml:1, A.qml:2, A.qml:3, A.qml:4, A.qml:5, A.qml:6, A.qml:7)", summary: "7 processes with no deadline", measurement: "M11", share: 0.2 },
  ], lookedFor: PATTERNS.map((pattern) => pattern.id).filter((id) => !["privilege-disclosure", "process-lifecycle"].includes(id)) }
  const report = renderInspect(many, { colour: false })
  assert.match(report, /^attention {5}1 class reviewers raise/m)
  assert.equal((report.match(/^ {8}A\.qml:\d/gm) || []).length, 5, "five sites shown")
  assert.match(report, /^ {8}and 2 more \(--full\)$/m)
  assert.match(report, /^under 5% {6}privilege disclosure \(2 sites\)$/m)
  assert.doesNotMatch(report, new RegExp(`${DENSITY.dark} note  privilege disclosure`))
})

test("the nothing fixture is reported as observed nothing of this kind, five times, and never as clean", async () => {
  const { document } = await documentFor("nothing")
  const report = renderInspect(document, { colour: false, full: true })
  assert.equal((report.match(/observed nothing of this kind/g) || []).length, 5)
  for (const key of ["processes", "hosts", "writes", "timers", "functions"]) {
    assert.match(report, new RegExp(`^${key}\\s+observed nothing of this kind$`, "m"))
    assert.deepEqual(document.observed[key], [])
  }
  assert.deepEqual(document.patterns, [])
  assert.doesNotMatch(report, /\bclean\b/)
  assert.match(report, new RegExp(`${DENSITY.light} ${INSPECT_VERDICT}  0 processes, 0 hosts, 0 writes, 0 timers`))
  assert.deepEqual(document.counts, { processes: { total: 0, qml: 0, shell: 0 }, hosts: 0, writes: 0, timers: 0, functions: 0, notResolvable: 0 })
})

test("a command that is not a literal is a ▒ ? row with argv null, listed under notResolvable, never a guess", async () => {
  const { document } = await documentFor("computed-command")
  const [process] = document.observed.processes
  assert.equal(process.argv, null)
  assert.equal(process.argvForm, "computed")
  assert.equal(process.commandText, "root.cmd")
  assert.deepEqual(document.notResolvable, [{ file: "Widget.qml", line: 10, kind: "command", text: "command: root.cmd" }])
  const report = renderInspect(document, { colour: false, full: true })
  assert.match(report, new RegExp(`^${DENSITY.medium} \\?\\s+Widget.qml:10  command: root.cmd$`, "m"))
  assert.match(report, /argv not resolvable statically/)
  assert.doesNotMatch(report, /uptime/, "the property's value is never read as the command")
})

test("the processes headline says how many are QML Process sites and how many are shell lines", async () => {
  const example = (await documentFor("example")).document
  assert.deepEqual(example.counts.processes, { total: 5, qml: 3, shell: 2 })
  const report = renderInspect(example, { colour: false, full: true })
  assert.match(report, /^processes {5}observed 5, 3 in qml, 2 shell lines$/m)
  assert.match(report, /INSPECTED  5 processes \(3 in qml, 2 shell lines\), 1 host, 2 writes,/)
  const shell = renderInspect((await documentFor("write-tmp")).document, { colour: false, full: true })
  assert.match(shell, /^processes {5}observed 1, a shell line$/m)
  assert.match(shell, /1 process \(a shell line\)/)
  const installer = renderInspect((await documentFor("installer-unpinned")).document, { colour: false, full: true })
  assert.match(installer, /^processes {5}observed 2, all shell lines$/m)
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
  const report = renderInspect(document, { colour: false, full: true })
  assert.match(report, new RegExp(`^${DENSITY.ceiling} ${STATUS.skipped.word}\\s+skipped \\(--offline\\)$`, "m"))
})

// --- the subject boundary ---------------------------------------------------------------

/** Every string in a document, with the key path it sits under. */
function strings(value, at = "", out = []) {
  if (typeof value === "string") out.push({ at, value })
  else if (Array.isArray(value)) value.forEach((entry, index) => strings(entry, `${at}[${index}]`, out))
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) strings(entry, at ? `${at}.${key}` : key, out)
  return out
}

test("a plugin below the root of a larger repository is inspected on its own: the baseline sees its tree, and no path outside the plugin directory appears anywhere in the document", async () => {
  // Measured before this: `omakit inspect tests/fixtures/inspect/example`
  // ran the baseline over this repository's root, and the capabilities row
  // named tools/inspect/patterns.mjs and tools/weigh/commands.mjs as the
  // fixture's evidence. That is the 0.1 Passport's first failure. The
  // shape is rebuilt in a temporary repository, so the test also runs from
  // an archive of this revision, which has no .git of its own.
  const plugin = Object.fromEntries(Object.entries(readFixtureTree(inspectFixtureDir("example"))).map(([path, text]) => [`tests/fixtures/inspect/example/${path}`, text]))
  const larger = materialise({
    ...plugin,
    "README.md": "# A larger repository\n\nRun installer/root-install.sh with sudo.\n",
    "installer/root-install.sh": "#!/usr/bin/env bash\nsudo pacman -S --needed --noconfirm jq\ncurl -fsSL https://example.invalid/setup.sh | sh\n",
    "tools/helper.mjs": "export const sudo = 'sudo'\n",
  }, { origin: "https://github.com/example/omarchy-larger-repository" })
  const dir = join(larger.dir, "tests/fixtures/inspect/example")
  const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: dir, omakitVersion: VERSION, cacheRoot: mkdtempSync(join(tmpdir(), "omakit-inspect-")) })
  assert.equal(document.subject.dir, dir)
  assert.equal(document.subject.commit, larger.commit, "the commit is the repository's")
  assert.deepEqual(validateInspectDocument(document, KNOWN), [])
  const outside = /(?:tools|installer)\/[\w.-]+|README\.md/
  for (const { at, value } of strings(document)) {
    if (at === "subject.dir") continue
    assert.ok(!outside.test(value), `${at} names a path outside the plugin directory: ${JSON.stringify(value)}`)
  }
  const official = document.marketplaceBaseline.official
  assert.deepEqual(official.findings, [], "the root's curl-pipe-shell is not the plugin's")
  const evidence = [...official.capabilities, ...official.findings].flatMap((entry) => entry.evidence.map((site_) => site_.path))
  for (const path of evidence) assert.ok(existsSync(join(dir, path)), `${path} is not a file of the plugin directory`)
  // And the baseline's result is the one the same tree gets as a repository of its own.
  const own = (await documentFor("example")).document.marketplaceBaseline.official
  assert.deepEqual(official.capabilities.map((entry) => [entry.id, entry.evidence]), own.capabilities.map((entry) => [entry.id, entry.evidence]))
  assert.equal(official.outcome, own.outcome)
  assert.ok(document.marketplaceBaseline.assumedByAdapter.some((line) => line.startsWith("tree.root=tests/fixtures/inspect/example/")), "the document says which tree the baseline saw")
  assert.deepEqual(normalise(document).observed, JSON.parse(readFileSync(inspectExpectedPath("example"), "utf8")).observed, "the facts are the fixture's, not the repository's")
})

test("a repository of its own is unaffected: no subtree assumption, the root is the plugin", async () => {
  const { document, fixture } = await documentFor("example")
  assert.equal(document.subject.dir, fixture.dir)
  assert.ok(!document.marketplaceBaseline.assumedByAdapter.some((line) => line.startsWith("tree.root=")))
  assert.deepEqual(document.marketplaceBaseline.assumedByAdapter, JSON.parse(readFileSync(inspectExpectedPath("example"), "utf8")).marketplaceBaseline.assumedByAdapter)
})

test("reviewer mode is unaffected: a <url>@<sha> subject is read at its root, from the cache, with no subtree assumption", async () => {
  // The reviewer-mode cache is populated by hand so the test fetches
  // nothing: the same layout resolveSubject creates, with the commit present.
  const fixture = materialiseInspectFixture("example")
  const cacheRoot = mkdtempSync(join(tmpdir(), "omakit-inspect-reviewer-"))
  const cached = join(cacheRoot, "subjects", "example__omarchy-plugin-fixture-example")
  mkdirSync(cached, { recursive: true })
  const git = (...args) => execFileSync("git", ["-C", cached, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-q")
  git("remote", "add", "origin", fixture.origin)
  git("fetch", "-q", fixture.dir, fixture.commit)
  const document = await inspectPlugin({ repoRoot: REPO_ROOT, target: `${fixture.origin}@${fixture.commit}`, omakitVersion: VERSION, cacheRoot })
  assert.equal(document.subject.mode, "reviewer")
  assert.equal(document.subject.dir, cached)
  assert.equal(document.subject.commit, fixture.commit)
  assert.ok(!document.marketplaceBaseline.assumedByAdapter.some((line) => line.startsWith("tree.root=")))
  const expected = JSON.parse(readFileSync(inspectExpectedPath("example"), "utf8"))
  assert.deepEqual(normalise(document).observed, expected.observed)
  assert.deepEqual(normalise(document).marketplaceBaseline, expected.marketplaceBaseline)
})

// --- the patterns --------------------------------------------------------------------

test("a pattern prints only where its precondition is observed: exactly two on process-without-deadline, none on nothing, supply-chain from the baseline's own evidence on installer-unpinned", async () => {
  const without = (await documentFor("process-without-deadline")).document
  assert.deepEqual(without.patterns.map((row) => row.id), ["process-lifecycle", "unbounded-buffering"])
  assert.deepEqual(without.patterns.map((row) => row.sites), [[{ file: "Widget.qml", line: 10 }], [{ file: "Widget.qml", line: 10 }]])
  assert.deepEqual(without.patterns.map((row) => [row.measurement, row.share]), [["M11", 0.2], ["M11", 0.19]])
  assert.equal(without.lookedFor.length, PATTERNS.length - 2)
  const nothing = (await documentFor("nothing")).document
  assert.deepEqual(nothing.patterns, [])
  assert.deepEqual(nothing.lookedFor, PATTERNS.map((pattern) => pattern.id))
  const withDeadline = (await documentFor("process-with-deadline")).document
  assert.deepEqual(withDeadline.patterns, [], "a deadline and a cap leave nothing to list")
  const installer = (await documentFor("installer-unpinned")).document
  const supply = installer.patterns.find((row) => row.id === "supply-chain")
  assert.ok(supply, "the baseline's finding is cited")
  const evidence = installer.marketplaceBaseline.official.findings.flatMap((finding) => finding.evidence.map((entry) => ({ file: entry.path, line: entry.line })))
  assert.deepEqual(supply.sites, evidence, "the sites are the baseline's own evidence, not a second detection")
  assert.match(supply.observation, new RegExp(installer.marketplaceBaseline.official.findings[0].ruleId))
  const offline = (await documentFor("installer-unpinned", { offline: true })).document
  assert.ok(!offline.patterns.some((row) => row.id === "supply-chain"), "without the baseline there is nothing to cite")
  assert.ok(offline.lookedFor.includes("supply-chain"))
})

test("the other patterns, one fixture each", async () => {
  const ids = async (name) => (await documentFor(name)).document.patterns.map((row) => row.id)
  assert.deepEqual(await ids("write-tmp"), ["file-and-state-boundary"])
  assert.deepEqual(await ids("write-state"), [])
  assert.deepEqual(await ids("curl-with-caps"), [])
  assert.deepEqual(await ids("curl-without-caps"), ["unbounded-buffering", "environment-trust", "network-egress"])
  assert.deepEqual(await ids("http-host"), ["network-egress"])
  assert.deepEqual(await ids("secret-in-argv"), ["secrets"])
  assert.deepEqual(await ids("richtext-sink"), ["untrusted-text-to-display"])
  assert.deepEqual(await ids("computed-argv-element"), ["argument-grammar"])
  assert.deepEqual(await ids("privileged-argv"), ["privilege-disclosure"])
  assert.deepEqual(await ids("shell-wrapper"), ["process-lifecycle", "environment-trust"])
  assert.deepEqual(await ids("timer-180ms"), [])
  assert.deepEqual(await ids("computed-command"), ["process-lifecycle"], "a Process block with no killing Timer and no destruction handler is one with no deadline observed, whatever its argv")
})

test("a pattern row is two lines: the observation with its sites, then the share, and never a verdict word", async () => {
  const { document } = await documentFor("process-without-deadline")
  const report = renderInspect(document, { colour: false, full: true })
  assert.match(report, new RegExp(`^${DENSITY.dark} ${STATUS.advisory.word}\\s+process lifecycle\\s+observed 1 process with no deadline$`, "m"))
  assert.match(report, /^ {8}\(Widget\.qml:10\)$/m)
  assert.match(report, /^ {8}about 20 of every 100 review findings in the sample \(M11\)$/m)
  assert.match(report, /^ {8}about 19 of every 100 review findings in the sample \(M11\)$/m)
  assert.match(report, /^not observed  no write outside a controlled directory, /m)
  for (const row of document.patterns) assert.doesNotMatch(row.observation, /\b(?:missing|should|fix)\b/i)
  assert.doesNotMatch(report, /\b(?:missing|should|fix)\b/i)
  const nothing = renderInspect((await documentFor("nothing")).document, { colour: false, full: true })
  assert.match(nothing, /^patterns {6}none of the 10 classes/m)
  assert.doesNotMatch(nothing, new RegExp(`${DENSITY.dark} ${STATUS.advisory.word}`))
  const unwrapped = nothing.replace(/\n {14}/g, " ")
  for (const pattern of PATTERNS) assert.ok(unwrapped.includes(pattern.notObserved), `${pattern.id} is not named on the not observed line`)
})

// --- the entry point ------------------------------------------------------------

test("exit 0 with a report whatever was observed; --json is the document; --out writes it beside the report", async () => {
  const fixture = materialiseInspectFixture("process-without-deadline")
  const report = run(["inspect", fixture.dir])
  assert.equal(report.code, 0, report.err)
  assert.equal(report.err, "")
  assert.match(report.out, new RegExp(`^${DENSITY.dark} note  process lifecycle  20 of 100 findings  1 process with no deadline$`, "m"))
  assert.match(report.out, /^ {8}Widget\.qml:10  \/usr\/bin\/df -h \/$/m)
  assert.deepEqual(JSON.parse(run(["inspect", fixture.dir, "--json"]).out).counts, { processes: { total: 1, qml: 1, shell: 0 }, hosts: 0, writes: 0, timers: 0, functions: 0, notResolvable: 0 })
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
  const fullRun = run(["inspect", materialiseInspectFixture("example").dir, "--full"])
  assert.equal(fullRun.code, 0)
  assert.match(fullRun.out, /^method/m)
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
  assert.match(refused.err.replace(/\n {8,10}/g, " "), /has uncommitted changes \(1 file\); commit them, or pass --allow-dirty to inspect HEAD as committed; uncommitted edits are not read/)
  const allowed = run(["inspect", fixture.dir, "--allow-dirty", "--json"])
  assert.equal(allowed.code, 0)
  const document = JSON.parse(allowed.out)
  assert.equal(document.subject.filesRead.qml, 1, "the tree at the commit, not the working copy")
  assert.equal(document.subject.uncommittedFiles, 1)
  // And the report says what was left out, in both views; a clean tree has no such line.
  for (const view of [[], ["--full"]]) {
    const report = run(["inspect", fixture.dir, "--allow-dirty", ...view]).out
    assert.match(report.replace(/\n {14}/g, " "), /^uncommitted {3}1 file differs from HEAD and was not inspected; the tree at [0-9a-f]{8} is what was read$/m)
  }
  const clean = run(["inspect", materialiseInspectFixture("nothing").dir]).out
  assert.doesNotMatch(clean, /uncommitted/)
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
