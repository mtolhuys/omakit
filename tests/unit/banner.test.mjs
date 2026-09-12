// The wordmark is the one place decoration is allowed, so the rules about where
// it may not appear are the part worth testing.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { banner, bannerEnabled, frame, wordmarkRows, GLYPHS, GLYPH_ROWS } from "../../tools/marketplace/banner.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const plain = (text) => String(text).replace(/\[[0-9;]*m/g, "")

test("a piped run gets no banner at all, not even a plain one", async () => {
  const written = []
  await banner({ stream: { isTTY: false, write: (s) => written.push(s) } })
  assert.deepEqual(written, [])
  assert.equal(bannerEnabled({ isTTY: false }, {}), false)
  assert.equal(bannerEnabled({ isTTY: true }, { NO_COLOR: "1" }), false)
  assert.equal(bannerEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(bannerEnabled({ isTTY: true }, { OMAKIT_NO_BANNER: "1" }), false)
  assert.equal(bannerEnabled({ isTTY: true }, {}), true)
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
  const rows = wordmarkRows("omakit")
  const width = rows[0].length
  const early = frame(rows, 3).map(plain)
  const done = frame(rows, width + 2).map(plain)
  assert.ok(early.join("").trim().length > 0, "something is drawn early")
  assert.ok(done.join("").length > early.join("").trim().length, "the finished frame has more")
  for (const [index, line] of done.entries()) {
    assert.equal(line.replace(/ /g, "").length, rows[index].replace(/ /g, "").length,
      "every # in the font ends up drawn")
  }
  // Nothing is drawn to the right of the head.
  for (const line of frame(rows, 5).map(plain)) {
    assert.equal(line.slice(7).trim(), "", "columns beyond the head stay blank")
  }
})

test("a frame emits no colour code it does not use", () => {
  for (const line of frame(wordmarkRows("omakit"), 12)) {
    const codes = line.match(/\[[0-9;]*m/g) || []
    const blocks = (line.match(/█/g) || []).length
    assert.ok(codes.length <= blocks * 2, "more escapes than blocks means stray codes")
    assert.ok(!/\[9?6m /.test(line), "a colour code is never followed by a blank")
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

test("only setup animates; nothing that prints content waits on the scan", () => {
  // Measured: the scan is 28 columns of reveal plus two shine passes, about
  // 1.4 seconds before the first line of usage would appear. `setup` is a first
  // run that fetches 16 MB anyway; `help` and `doctor` exist to put text on the
  // screen now.
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  for (const call of cli.match(/banner\(\{[^}]*\}\)/g) || []) {
    assert.match(call, /animate:\s*false/, `${call} animates inside the CLI; only setup may`)
  }
  const setup = readFileSync(join(REPO_ROOT, "tools/marketplace/setup.mjs"), "utf8")
  assert.match(setup, /banner\(\{[^}]*\}\)/, "setup draws the banner")
  assert.doesNotMatch(setup, /animate:\s*false/, "setup is the one place the scan belongs")
})
