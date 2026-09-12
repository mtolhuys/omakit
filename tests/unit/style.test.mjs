// The visual system is one thing, defined in style.mjs, and every command
// draws with it. These tests make divergence impossible rather than unlikely:
// they read every source file and fail if a glyph, a status word or an indent
// is typed anywhere else, and they render every report and measure it.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import {
  ARROW, COLUMNS, DENSITY, GUTTER, LABEL, MARK_WIDTH, MOTION, PALETTE, STATUS, STEP,
  action, colourEnabled, field, labelled, mark, motionEnabled, overflows, plain, section, styler, verdict, width, wrap,
} from "../../tools/marketplace/style.mjs"
import { renderDoctor, renderSubmit, renderWatch } from "../../tools/marketplace/report.mjs"
import { renderSummary, renderUsage } from "../../tools/marketplace/usage.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith(".mjs")) out.push(path)
  }
  return out
}

const STYLE = "tools/marketplace/style.mjs"
/** Comments stripped: a comment may name a glyph to explain it; only code may draw one. */
const uncommented = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const sources = walk(join(REPO_ROOT, "tools"))
  .map((path) => ({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") }))

/** The tool's own lines: the marketplace's verbatim report is somebody else's text and is exempt from the width. */
function ownLines(text, exempt = "") {
  const lines = plain(text).split("\n")
  if (!exempt) return lines
  const cut = new Set(plain(exempt).split("\n"))
  return lines.filter((line) => !cut.has(line))
}

function assertWidth(text, label, exempt = "") {
  for (const line of ownLines(text, exempt)) {
    assert.ok(!overflows(line), `${label}: ${line.length} columns: ${JSON.stringify(line)}`)
  }
}

// --- enabling ------------------------------------------------------------------

test("colour follows the terminal, NO_COLOR and FORCE_COLOR", () => {
  assert.equal(colourEnabled({ isTTY: true }, {}), true)
  assert.equal(colourEnabled({ isTTY: false }, {}), false)
  assert.equal(colourEnabled({ isTTY: true }, { NO_COLOR: "1" }), false)
  assert.equal(colourEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "1" }), true)
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "0" }), false)
})

test("motion follows the terminal only; NO_COLOR turns colour off and nothing else", () => {
  // The measured divergence this closes: with NO_COLOR set, a terminal run of
  // `omakit` printed a text heading where a colour run drew the wordmark, and
  // `submit` fell silent where a colour run showed its progress. NO_COLOR is
  // a request about colour. The dumb terminal and the pipe are the ones that
  // cannot hold a redraw.
  assert.equal(motionEnabled({ isTTY: true }, {}), true)
  assert.equal(motionEnabled({ isTTY: true }, { NO_COLOR: "1" }), true)
  assert.equal(motionEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(motionEnabled({ isTTY: false }, {}), false)
  assert.equal(motionEnabled({ isTTY: false }, { FORCE_COLOR: "1" }), false)
})

test("a disabled styler is the identity function", () => {
  const off = styler(false)
  assert.equal(off("red.bold", "text"), "text")
  const on = styler(true)
  assert.equal(on("red.bold", "text"), "\u001b[31;1mtext\u001b[0m")
  assert.equal(on("nonsense", "text"), "text")
  assert.equal(plain(on("green", "text")), "text")
})

// --- one vocabulary -----------------------------------------------------------

test("five states, each with one glyph, one word and one tint, all distinct", () => {
  assert.deepEqual(Object.keys(STATUS), ["pass", "fail", "advisory", "info", "unknown"])
  const glyphs = new Set()
  const words = new Set()
  for (const [name, status] of Object.entries(STATUS)) {
    assert.ok(Object.values(DENSITY).includes(status.glyph), `${name}: the glyph is not on the ramp`)
    assert.ok(!glyphs.has(status.glyph), `${name}: shares a glyph`)
    assert.ok(!words.has(status.word), `${name}: shares a word`)
    glyphs.add(status.glyph)
    words.add(status.word)
    for (const part of status.tint.split(".")) assert.ok(part in PALETTE, `${name}: ${part} is not a palette entry`)
  }
  // The one upper-case word is the blocking failure, so it can be found by
  // shape in a column of marks on a theme that shows no hue.
  const upper = Object.entries(STATUS).filter(([, s]) => s.word === s.word.toUpperCase() && /[A-Z]/.test(s.word))
  assert.deepEqual(upper.map(([name]) => name), ["fail"])
  // And the heaviest ink is the blocking failure, the lightest that is not a
  // floor is information.
  assert.equal(STATUS.fail.glyph, DENSITY.full)
  assert.equal(STATUS.pass.glyph, DENSITY.floor)
})

test("the columns are derived from the marks and the keys, not chosen", () => {
  assert.equal(GUTTER, MARK_WIDTH + 2, "a check body starts two columns after the widest mark")
  for (const state of Object.keys(STATUS)) {
    assert.equal(width(mark(state, styler(false))), GUTTER, `${state} is padded to the gutter`)
    assert.equal(width(mark(state, styler(true))), GUTTER, `${state} is padded to the gutter under colour`)
  }
  assert.equal(LABEL, "current HEAD".length + 2, "the label column fits the widest key the tool prints")
  assert.throws(() => field("a key that is too wide", "v", styler(false)), /wider than the label column/)
  assert.equal(STEP, 2)
})

test("no status mark, glyph or arrow is typed anywhere but style.mjs", () => {
  // This is what makes the vocabulary single: every other file has to ask
  // style.mjs for a mark, so a sixth state or a second spelling of "ok" cannot
  // appear without changing the one definition.
  const glyphs = [...Object.values(DENSITY), ARROW]
  const escapes = glyphs.map((glyph) => `\\u${glyph.codePointAt(0).toString(16).padStart(4, "0")}`)
  const words = /c\("[a-z.]+",\s*(?:`|")\s*(?:ok|FAIL|PROBLEM|note|info|\?|REFUSED)\b/
  for (const { path, text: raw } of sources) {
    if (path === STYLE) continue
    const text = uncommented(raw)
    for (const [index, glyph] of glyphs.entries()) {
      assert.ok(!text.includes(glyph) && !text.includes(escapes[index]),
        `${path} draws ${glyph} itself instead of taking it from style.mjs`)
    }
    assert.doesNotMatch(text, words, `${path} paints a status word itself instead of calling mark()`)
  }
})

test("no indent is a number anywhere but style.mjs", () => {
  // The scale has three stops, and a fourth cannot be introduced by typing
  // six spaces into a template.
  for (const { path, text } of sources) {
    if (path === STYLE) continue
    assert.doesNotMatch(text, /" "\.repeat\(\d+\)/, `${path} repeats a literal number of spaces`)
    assert.doesNotMatch(text, /`\s{4,}\$\{/, `${path} starts a template with a hand-typed indent`)
    assert.doesNotMatch(text, /out(?:\.push)?\(`\s{2,}[^`]/, `${path} pushes a hand-indented line`)
  }
})

test("every command that prints a status imports its marks from style.mjs", () => {
  for (const name of ["report.mjs", "setup.mjs", "upgrade.mjs", "cli.mjs"]) {
    const source = sources.find((entry) => entry.path === `tools/marketplace/${name}`)
    assert.ok(source, name)
    assert.match(source.text, /import \{[^}]*\bmark\b[^}]*\} from "\.\/style\.mjs"/, `${name} does not import mark()`)
  }
  for (const name of ["banner.mjs", "progress.mjs"]) {
    const source = sources.find((entry) => entry.path === `tools/marketplace/${name}`)
    assert.match(source.text, /import \{[^}]*\bDENSITY\b[^}]*\} from "\.\/style\.mjs"/, `${name} does not draw from the ramp`)
    assert.match(source.text, /import \{[^}]*\bMOTION\b[^}]*\} from "\.\/style\.mjs"/, `${name} does not take its budget from style.mjs`)
  }
})

test("every animation has a stated budget", () => {
  assert.ok(MOTION.bannerBudgetMs <= 300, `a ${MOTION.bannerBudgetMs}ms scan is an interruption, not a flourish`)
  assert.ok(MOTION.progressFrameMs >= 50 && MOTION.progressFrameMs <= 120, "a progress frame is smooth, not a busy loop")
  for (const { path, text } of sources) {
    if (path === STYLE) continue
    assert.doesNotMatch(text, /setInterval\([^,]+,\s*\d+\)/, `${path} animates on a literal interval`)
    assert.doesNotMatch(text, /BUDGET_MS\s*=\s*\d/, `${path} states its own budget`)
  }
})

// --- composition ---------------------------------------------------------------

test("wrap counts the indent, keeps a typed span whole, and never breaks a word", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
  for (const indent of [0, GUTTER, LABEL, 40]) {
    for (const line of wrap(text, { indent, width: 60 })) {
      assert.ok(line.length <= 60, `${JSON.stringify(line)} is ${line.length} wide at indent ${indent}`)
      assert.ok(line.startsWith(" ".repeat(indent)))
    }
  }
  const url = "https://github.com/omacom/omarchy-plugin-marketplace/issues/4403#issuecomment-1234567890"
  const lines = wrap(`see ${url} for the thread`, { indent: GUTTER, width: 60 })
  assert.ok(lines.some((line) => line.trim() === url), "an unbreakable word gets a line of its own")
  const typed = wrap("run `omakit pin` and then `omakit submit <target>` again", { width: 22 }, styler(false))
  assert.ok(typed.every((line) => !/omakit$/.test(line)), `a typed span is never split: ${JSON.stringify(typed)}`)
  assert.ok(typed.every((line) => !line.includes("`")), "the backticks do not reach the output")
  // Punctuation clings to the span it follows: no space opens up before a comma.
  assert.deepEqual(wrap("it produced 1,697 `passed`, 1,226 `review-required` and (`needs-fixes`)."), ["it produced 1,697 passed, 1,226 review-required and (needs-fixes)."])
  // And two spans in one sentence are two words, not one word with a space in it.
  assert.deepEqual(
    wrap("`validateRepositoryDocs` at the pin fails a submission with `license-missing`.", { width: 40 }),
    ["validateRepositoryDocs at the pin fails", "a submission with license-missing."],
  )
  // `first` is the room the first line has when a label is already on it.
  const labelled_ = wrap(text, { indent: 10, first: 0, width: 40 })
  assert.ok(!labelled_[0].startsWith(" "))
  assert.ok(labelled_[1].startsWith(" ".repeat(10)))
})

test("the composition helpers keep the words and drop the colour", () => {
  const off = styler(false)
  const on = styler(true)
  const cases = [
    () => verdict("fail", "REFUSED", "two checks failed, so no body is produced.", off),
    () => field("current HEAD", "1ce9f4c189f78ad352915e868dd5a200fdeb006c, read from the API", off),
    () => action("Edit the issue body. That is the only action that moves the pin; a push does not.", off),
    () => labelled("why", "73% of the 464 parked submissions have a HEAD the marketplace never saw.", off),
    () => section("issue body", off),
  ]
  const coloured = [
    () => verdict("fail", "REFUSED", "two checks failed, so no body is produced.", on),
    () => field("current HEAD", "1ce9f4c189f78ad352915e868dd5a200fdeb006c, read from the API", on),
    () => action("Edit the issue body. That is the only action that moves the pin; a push does not.", on),
    () => labelled("why", "73% of the 464 parked submissions have a HEAD the marketplace never saw.", on),
    () => section("issue body", on),
  ]
  for (const [index, render] of cases.entries()) {
    const plainLines = render()
    const colourLines = coloured[index]()
    assert.deepEqual(colourLines.map(plain), plainLines)
    assert.notDeepEqual(colourLines, plainLines, "colour is applied")
    for (const line of plainLines) assert.ok(!overflows(line))
  }
  // The arrow line is the only line that starts with an arrow, and it starts
  // in the gutter.
  const fix = action("do the thing", off)
  assert.equal(fix[0], `${" ".repeat(GUTTER)}${ARROW} do the thing`)
  assert.equal(section("t", off)[1], DENSITY.floor.repeat(COLUMNS))
})

// --- the reports ---------------------------------------------------------------

// The words are the contract; colour must never change them.
const result = {
  subject: { repository: "https://github.com/example/p", directory: "/tmp/p", commit: "a".repeat(40), cleanTree: true },
  pin: { commit: "b".repeat(40), baselineVersion: "3", enforcementMode: "selective" },
  validationCommit: { local: "a".repeat(40), defaultBranchHead: null, branch: null, matches: null, note: "n" },
  checks: [
    { id: "one", source: "marketplace-pin", severity: "blocking", verdict: "pass", detail: "fine", paths: [], remedy: null, why: "because 1" },
    { id: "two", source: "omakit", severity: "blocking", verdict: "fail", detail: "broken", paths: ["a/b: reason"], remedy: "fix it", why: "because 2" },
    {
      id: "three.with-a-long-name-that-pushes-the-source-tag", source: "marketplace-pin", severity: "advisory", verdict: "fail",
      detail: "needs-fixes (disposition review-required, enforcement selective, blocksApproval false). Findings are present but none of them is selectively blocking.",
      paths: ["skills/publishing/SKILL.md: agent-control file (SKILL.md) inside a directory that is itself very long"],
      remedy: "Move the guidance to a non-agent filename such as DEVELOPMENT.md. Untrack the originals (git rm --cached) so they leave the installable tree.",
      why: "103 marketplace issues mention agent-control files, and 24 of 328 sampled maintainer review comments are about them: `validateRepositoryDocs` at the pin fails a submission with `license-missing`.",
    },
  ],
  ready: false,
  blocking: ["two"],
  advisory: ["three.with-a-long-name-that-pushes-the-source-tag"],
  issue: null,
  baseline: { invoked: true, skipReason: "none", statement: "Official baseline preview over a local snapshot. The marketplace rescans the public commit itself.", officialReport: "## Automated security baseline\n\nA line of the marketplace's own report that is deliberately much longer than eighty columns because it is quoted verbatim and never rewrapped." },
  afterSubmitting: "edit the issue body",
}

const ready = {
  ...result,
  checks: [result.checks[0]],
  ready: true,
  blocking: [],
  advisory: [],
  validationCommit: { local: "a".repeat(40), defaultBranchHead: "a".repeat(40), branch: "main", matches: true, note: "n" },
  issue: { title: "[Plugin]: Fixture Good", body: "### Repository URL\n\nhttps://github.com/example/p\n" },
  baseline: { invoked: false, skipReason: "none", statement: "s" },
}

const watch = {
  read: { issue: "https://github.com/o/r/issues/1", state: "open", title: "t", author: "a", labels: ["submission", "needs-fixes", "security-needs-fixes", "security-review-required"], comments: 1, authorComments: 1, maintainerComments: 0 },
  plugin: { repository: "https://github.com/o/p", repositoryError: null },
  validated: { commit: "c".repeat(40), outcome: "passed", findings: [], capabilities: [], checkedAt: "2026-09-01T00:00:00.000Z" },
  validationCommentFallback: null,
  head: { commit: "d".repeat(40), branch: "main", source: "api", committedAt: "2026-09-02T00:00:00Z" },
  headError: null,
  verdict: { state: "stale", summary: "it is stale", action: "edit the issue body" },
}

const doctor = {
  checks: [
    { id: "omakit.version", state: "info", detail: "omakit 0.1.0", action: null },
    { id: "node", state: "ok", detail: "node 22.23.2 (needs >=22)", action: null },
    { id: "pin.checkout", state: "problem", detail: "no pinned marketplace checkout at /home/someone/.local/share/omakit/.cache/marketplace. Every rule omakit checks is read from that checkout.", action: "omakit pin" },
    { id: "pin.freshness", state: "advice", detail: "the pin is 38060f8; the marketplace's main branch is now at 692f90b", action: "Bumping the pin is a deliberate change: docs/UPSTREAM_CONTRACT.md has the procedure, which ends in re-proving parity and committing its evidence. Nothing here does it for you." },
    { id: "omakit.latest", state: "unknown", detail: "the npm registry did not answer, or this version is unpublished", action: null },
    { id: "github.auth", state: "ok", detail: "read-only, from your `gh` login (gh version 2.100.0); omakit stores nothing", action: null },
  ],
  problems: 1,
}

test("the coloured and uncoloured renderings say exactly the same thing", () => {
  for (const [render, input] of [[renderSubmit, result], [renderSubmit, ready], [renderWatch, watch], [renderDoctor, doctor]]) {
    const off = render(input, { colour: false })
    const on = render(input, { colour: true })
    assert.notEqual(on, off, "colour should actually be applied")
    assert.equal(plain(on), off, "stripping colour must give the uncoloured rendering back")
    assert.equal(/\u001b/.test(off), false, "the uncoloured rendering carries no escapes")
  }
})

test("a failing check, a stale validation and a problem are marked by the same vocabulary", () => {
  const c = styler(false)
  const submit = renderSubmit(result, { colour: false })
  assert.ok(submit.includes(`${mark("fail", c)}two`), "a blocking failure is FAIL")
  assert.ok(submit.includes(`${mark("pass", c)}one`), "a pass is ok")
  assert.ok(submit.includes(`${mark("advisory", c)}three`), "an advisory failure is a note, not a FAIL")
  assert.ok(!submit.includes("(advisory)"), "the severity is the mark, not a suffix")
  assert.ok(renderWatch(watch, { colour: false }).includes(`${DENSITY.full} VALIDATION STALE`))
  const doc = renderDoctor(doctor, { colour: false })
  assert.ok(doc.includes(`${mark("fail", c)}pin.checkout`))
  assert.ok(doc.includes(`${mark("unknown", c)}omakit.latest`))
  assert.ok(doc.includes(`${mark("info", c)}omakit.version`))
  assert.ok(!doc.includes("PROBLEM"), "doctor has no vocabulary of its own")
  assert.ok(!doc.includes("`"), "a backticked command is tinted, and the backticks do not reach the terminal")
  assert.match(renderSubmit(result, { colour: true }), /\u001b\[31;1m█ FAIL/)
  assert.match(renderSubmit(result, { colour: true }), /\u001b\[32m▁ ok/)
})

test("the remedy is the only line that starts with an arrow, and it is under every failure", () => {
  const submit = renderSubmit(result, { colour: false })
  const arrows = submit.split("\n").filter((line) => line.trimStart().startsWith(ARROW))
  // Under the failing check, under the advisory, and again in the refusal's
  // action list, where the last screen is the one a person is looking at.
  assert.equal(arrows.length, 3)
  assert.ok(arrows.every((line) => line.startsWith(" ".repeat(GUTTER))), "the arrow sits in the gutter")
  const refusal = submit.slice(submit.indexOf("REFUSED"))
  assert.ok(refusal.includes("two"), "the refusal names the failing check")
  assert.ok(refusal.includes(`${ARROW} fix it`), "and repeats its remedy")
  assert.ok(!refusal.includes("three.with"), "an advisory failure does not refuse")
  const doc = renderDoctor(doctor, { colour: false })
  assert.ok(doc.includes(`${ARROW} omakit pin`))
})

test("passing checks run dense, failures stand in their own block", () => {
  const lines = renderSubmit({
    ...result,
    checks: [result.checks[0], { ...result.checks[0], id: "one-b" }, result.checks[1], { ...result.checks[0], id: "one-c" }],
    blocking: ["two"],
  }, { colour: false }).split("\n")
  const at = (id) => lines.findIndex((line) => line.includes(`  ${id}`))
  assert.equal(lines[at("one-b") - 1].trim() !== "", true, "no blank between two passes")
  assert.equal(lines[at("two") - 1], "", "a blank before a failure")
  assert.equal(lines[at("one-c") - 1], "", "and after it")
})

test("nothing the tool composes is wider than eighty columns", () => {
  // Measured before this test existed: the check bodies reached column 85
  // because the wrapper ignored its own indent, the refusal line reached 207,
  // an upgrade refusal 124, and the watch header 99.
  assertWidth(renderSubmit(result, { colour: false }), "submit (refused)", result.baseline.officialReport)
  assertWidth(renderSubmit(ready, { colour: false }), "submit (ready)")
  assertWidth(renderWatch(watch, { colour: false }), "watch")
  assertWidth(renderDoctor(doctor, { colour: false }), "doctor")
  assertWidth(renderUsage({ colour: false }), "help")
  assertWidth(renderSummary({ colour: false }), "front door")
  // And the verbatim report really is left alone.
  assert.ok(renderSubmit(result, { colour: false }).includes(result.baseline.officialReport))
})

test("every line starts on the indent scale", () => {
  // Three stops and their continuations: a label's text, an arrow's text, a
  // verdict's text. Anything else is a fourth indent nobody decided on.
  const allowed = new Set([0, STEP, GUTTER, GUTTER + STEP, LABEL])
  const verdictBodies = new Set()
  for (const text of [renderSubmit(result, { colour: false }), renderSubmit(ready, { colour: false }), renderWatch(watch, { colour: false }), renderDoctor(doctor, { colour: false })]) {
    for (const line of ownLines(text, result.baseline.officialReport)) {
      if (!line.trim()) continue
      const column = line.length - line.trimStart().length
      const verdictHead = line.match(/^[█▁▒] [A-Z ]+ {2}/)
      if (verdictHead) verdictBodies.add(verdictHead[0].length)
      if (line.startsWith(" ".repeat(GUTTER) + "why  ")) verdictBodies.add(GUTTER + "why  ".length)
      assert.ok(allowed.has(column) || verdictBodies.has(column) || line.startsWith("#") || line.startsWith("-") || line.startsWith("http"),
        `column ${column} is not on the scale: ${JSON.stringify(line)}`)
    }
  }
})

test("nothing anywhere pins an actual colour", () => {
  // The Omarchy theme sets the terminal palette, so every colour this tool emits
  // is an ANSI palette index and the theme decides what it looks like. A
  // truecolor or 256-colour escape would look identical on every theme, which
  // means looking wrong on most of them.
  for (const path of walk(REPO_ROOT)) {
    const text = readFileSync(path, "utf8")
    assert.doesNotMatch(text, /\u001b\[38;[25];|\\u001b\[38;[25];|\\x1b\[38;[25];/, `${path} uses a truecolor or 256-colour escape`)
    assert.doesNotMatch(text, /\u001b\[48;|\\u001b\[48;|\\x1b\[48;/, `${path} sets a background colour`)
  }
})

test("no sentence is dimmed anywhere in the tool", () => {
  // Omarchy ships deliberately low-contrast themes. On Matte Black, grey text
  // on near-black is a line the reader's eye slides off, so the rule in
  // style.mjs is that grey carries punctuation and labels and never prose. A
  // sentence is taken to be a literal of four words or more ending in a full
  // stop.
  assert.ok(sources.length >= 10)
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/c\("(?:grey|dim)[^"]*",\s*(`[^`]*`|"[^"]*")/g)) {
      const literal = match[1].slice(1, -1)
      const words = literal.trim().split(/\s+/).length
      assert.ok(!(words >= 4 && /\.$/.test(literal.trim())),
        `${path} dims a sentence: ${literal}`)
    }
  }
})

test("the word pin has one owner: the marketplace checkout the rules are read from", () => {
  // Measured before this test existed: `omakit submit --json` carried a
  // top-level `pin` (the marketplace checkout, 38060f89) and a `pinnedCommit`
  // (the subject's own commit) on one screen, and `omakit watch` closed with
  // `PIN STALE` about a commit that has nothing to do with the pin `omakit pin`
  // fetches. The marketplace pin keeps the word. What the marketplace does at a
  // submission's commit is "validation", which is the marketplace's own word
  // and the one the `validated` field already used. This reads every source,
  // document, skill and recorded capture, so the second sense cannot return.
  const banned = [
    /\bPIN (STALE|CURRENT|UNKNOWN)\b/,
    /\breview pin\b/i,
    /\bpin watch\b/i,
    /\bpinned-commit\b|\bpinnedCommit\b|\bpinVerdict\b|\bpinWatch\b|\bpin-watch\b|\bPIN_WATCH\b/,
    /\bpins (the|its) review\b/i,
    /\breview is (now )?pinned\b/i,
    /\bstale pin\b/i,
  ]
  const prose = []
  ;(function walkAll(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name === ".tmp" || entry.name.endsWith(".tim")) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walkAll(path)
      else if (/\.(mjs|md|json|ansi|out)$/.test(entry.name) || entry.name === "omakit") prose.push(path)
    }
  })(REPO_ROOT)
  assert.ok(prose.length > 40, `walked ${prose.length} files`)
  for (const path of prose) {
    if (relative(REPO_ROOT, path) === "tests/unit/style.test.mjs") continue
    const text = readFileSync(path, "utf8")
    for (const pattern of banned) {
      const hit = text.match(pattern)
      assert.ok(!hit, `${relative(REPO_ROOT, path)} uses "pin" for the validated commit: ${JSON.stringify(hit?.[0])}`)
    }
  }
})
