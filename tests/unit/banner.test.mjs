// The wordmark is the one place decoration is allowed, so the rules about where
// it may not appear are the part worth testing.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { banner, bannerEnabled, fitsOnScreen, frame, schedule, wordmarkRows, wordmarkLayout, BUDGET_MS, GLYPHS, GLYPH_ROWS, INK, PREFIX_LETTERS } from "../../tools/marketplace/banner.mjs"
import { DENSITY, MOTION, plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"

test("a piped run gets no banner at all, not even a plain one", async () => {
  const written = []
  await banner({ stream: { isTTY: false, write: (s) => written.push(s) } })
  assert.deepEqual(written, [])
  assert.equal(bannerEnabled({ isTTY: false }, {}), false)
  assert.equal(bannerEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(bannerEnabled({ isTTY: true }, { OMAKIT_NO_BANNER: "1" }), false)
  assert.equal(bannerEnabled({ isTTY: true }, {}), true)
})

test("NO_COLOR takes the colour off the wordmark and leaves the wordmark", async () => {
  // Measured divergence: with NO_COLOR a terminal run of `omakit` printed a
  // text heading where a colour run drew the wordmark. NO_COLOR is a request
  // about colour, so the wordmark is still drawn, without a single escape.
  assert.equal(bannerEnabled({ isTTY: true }, { NO_COLOR: "1" }), true)
  const written = []
  await banner({ stream: { isTTY: true, rows: 40, columns: 80, write: (s) => written.push(s) }, enabled: true, colour: false, tagline: "t" })
  const all = written.join("")
  assert.doesNotMatch(all, /\u001b\[[0-9;]*m/, "no SGR at all")
  assert.match(all, /\u2588/, "the name is drawn")
  assert.match(all, /\u2593/, "and so is the prefix")
})

test("oma and kit differ in density first and in tint second", () => {
  // The measured problem: on Omarchy's Matte Black every ANSI hue resolves to
  // nearly the same grey, so a wordmark whose halves differ only in tint is
  // one flat word there, and bold does not help because a block glyph has no
  // stroke to thicken. Density is ink, and every terminal draws ink.
  const layout = wordmarkLayout("omakit")
  const mono = frame(layout, -2, layout.width + 2, { colour: false }).join("\n")
  assert.doesNotMatch(mono, /\u001b/, "with colour off there is no escape at all")
  assert.equal(INK.prefix, DENSITY.dark)
  assert.equal(INK.suffix, DENSITY.full)
  // Every lit cell of the prefix is the shade; every lit cell of the name is
  // the full block; and both appear, so the split is visible in ink alone.
  const prefixEnd = layout.spans[PREFIX_LETTERS - 1].to
  for (const row of mono.split("\n")) {
    assert.doesNotMatch(row.slice(0, prefixEnd + 1), /\u2588/, "no full block inside the prefix")
    assert.doesNotMatch(row.slice(prefixEnd + 1), /\u2593/, "no shade inside the name")
  }
  assert.match(mono, /\u2593/)
  assert.match(mono, /\u2588/)
  // With colour on, the tints are palette entries and go on top of the ink.
  const drawn = frame(layout, -2, layout.width + 2).join("\n")
  assert.match(drawn, /\u001b\[36m\u2593/, "the prefix takes the ecosystem's cyan on the shade")
  assert.match(drawn, /\u001b\[39m\u2588/, "the name keeps the foreground on the full block")
  assert.doesNotMatch(drawn, /38;[25];|48;/, "a wordmark must not use truecolor or a colour cube")
  assert.equal(PREFIX_LETTERS, 3)
  assert.deepEqual(layout.spans.filter((span) => span.index < PREFIX_LETTERS).map((span) => span.letter), ["o", "m", "a"])
  // And the scanner's head is the one bright, solid thing, over either half.
  const scanning = frame(layout, 3, layout.width + 2).join("\n")
  assert.match(scanning, /\u001b\[1;96m\u2588/, "the head is a full block in bright cyan")
})

test("the font covers the name, and refuses a letter it does not have", () => {
  const rows = wordmarkRows("omakit")
  assert.equal(rows.length, GLYPH_ROWS)
  assert.ok(rows.every((row) => row.length === rows[0].length), "rows must be equal length")
  // Renaming is a one-string change only while the font covers the new name.
  assert.doesNotThrow(() => wordmarkRows("omascan"))
  assert.throws(() => wordmarkRows("omakitt!"), /no glyph for !/)
  for (const [letter, glyph] of Object.entries(GLYPHS)) {
    assert.equal(glyph.length, GLYPH_ROWS, `${letter} must be ${GLYPH_ROWS} rows`)
    assert.ok(glyph.every((row) => row.length === glyph[0].length), `${letter} rows must be equal length`)
    assert.ok(glyph.every((row) => /^[# ]+$/.test(row)), `${letter} may only use # and space`)
  }
})

test("the scan reveals left to right and ends complete", () => {
  const layout = wordmarkLayout("omakit")
  const rows = layout.rows
  const width = layout.width
  const early = frame(layout, 3).map(plain)
  const done = frame(layout, -2, width + 2).map(plain)
  assert.ok(early.join("").trim().length > 0, "something is drawn early")
  assert.ok(done.join("").length > early.join("").trim().length, "the finished frame has more")
  for (const [index, line] of done.entries()) {
    assert.equal(line.replace(/ /g, "").length, rows[index].replace(/ /g, "").length,
      "every # in the font ends up drawn")
  }
  // Nothing is drawn to the right of the head.
  for (const line of frame(layout, 5).map(plain)) {
    assert.equal(line.slice(7).trim(), "", "columns beyond the head stay blank")
  }
})

test("a frame emits no colour code it does not use", () => {
  for (const line of frame(wordmarkLayout("omakit"), 12)) {
    const codes = line.match(/\u001b\[[0-9;]*m/g) || []
    const blocks = (line.match(/[█▓]/g) || []).length
    assert.ok(codes.length <= blocks * 2, "more escapes than blocks means stray codes")
    assert.ok(!/\u001b\[(?!0m)[0-9;]*m /.test(line), "a colour code is never followed by a blank")
  }
})

test("the banner appears on the front door only", () => {
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  // Commands whose output gets pasted into issues or read by an agent.
  for (const command of ["cmdSubmit", "cmdWatch", "cmdVerify", "cmdParity"]) {
    const start = cli.indexOf(`function ${command}`)
    assert.ok(start > 0, `${command} not found`)
    const body = cli.slice(start, cli.indexOf("\n}", start))
    assert.ok(!body.includes("banner("), `${command} draws the banner; it must not`)
  }
  for (const module of ["report.mjs", "submit.mjs", "watch.mjs", "verify.mjs"]) {
    const text = readFileSync(join(REPO_ROOT, "tools/marketplace", module), "utf8")
    assert.ok(!text.includes("banner.mjs"), `${module} imports the banner; it must not`)
  }
})

test("the whole scan fits in one glance, on any name the font can draw", () => {
  // The first version was 28 columns of reveal at 22ms plus two shine passes at
  // 14ms: about 1.4 seconds before the first line of usage appeared, which is
  // long enough to be in the way of someone who ran `help` to read a flag. The
  // schedule is derived from the budget now, so a longer name buys a quicker
  // step instead of a longer wait.
  assert.equal(BUDGET_MS, MOTION.bannerBudgetMs, "the budget is stated once, in style.mjs")
  assert.ok(BUDGET_MS <= 300, `a ${BUDGET_MS}ms scan is an interruption, not a flourish`)
  for (const word of ["omakit", "omascan", "omakitt"]) {
    const { width } = wordmarkLayout(word)
    const plan = schedule(width)
    assert.ok(plan.total <= BUDGET_MS, `${word}: ${plan.total}ms exceeds the budget`)
    assert.ok(plan.delay >= 4, `${word}: ${plan.delay}ms a frame is below what a terminal can show`)
    // Continuous: the head is two columns wide, so it may not jump further.
    assert.ok(plan.stride <= 2, "the reveal would leave undrawn gaps behind the head")
  }
})

test("every front-door command may animate, and no other command draws it at all", () => {
  // The gate that matters is where the banner appears, not whether it moves;
  // that one is asserted above. Both are read out of the CLI rather than
  // trusted, because a banner in `submit` output costs a submission credibility.
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  const calls = cli.match(/banner\(\{[^}]*\}\)|banner\(\)/g) || []
  assert.ok(calls.length >= 2, "the front door draws the banner")
  for (const call of calls) {
    assert.doesNotMatch(call, /animate:\s*false/, `${call} opts out of the scan; the budget replaced that`)
  }
  const setup = readFileSync(join(REPO_ROOT, "tools/marketplace/setup.mjs"), "utf8")
  assert.match(setup, /banner\(\{[^}]*\}\)/, "setup draws the banner")
})

test("a short terminal gets the finished wordmark and no cursor-up at all", async () => {
  // Five rows redrawn with cursor-up in a terminal with no room to hold them
  // means the screen scrolls under the animation and a row from an earlier
  // frame is stranded above the wordmark.
  const written = []
  await banner({ stream: { isTTY: true, rows: 6, columns: 80, write: (s) => written.push(s) }, enabled: true })
  const all = written.join("")
  assert.doesNotMatch(all, /\u001b\[\d+A/, "no frame is redrawn, so nothing can be stranded")
  assert.match(all, /\u2588/, "the wordmark is still drawn")
})

test("the scan runs only when the wordmark will still be on screen after it", () => {
  // Animating into a terminal that is about to scroll spends the budget on
  // something nobody sees, and it is what made a bare `omakit` look static: the
  // reference printed under it is 53 lines, which no terminal is tall enough
  // to hold beneath a 7-line banner.
  const short = "one\ntwo\nthree\n"
  assert.equal(fitsOnScreen(short, { rows: 40 }), true)
  assert.equal(fitsOnScreen(short, { rows: 10 }), false)
  assert.equal(fitsOnScreen("x\n".repeat(53), { rows: 48 }), false)
  // A pty with no window size (which is what `script` hands a program) reports
  // 0 rows. Unknown geometry is not room.
  assert.equal(fitsOnScreen(short, { rows: 0 }), false)
  assert.equal(fitsOnScreen(short, {}), false)
})
